import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import {
  compareReleaseLifecycleLock,
  LifecycleFsHelperError,
  readLifecycleFileBound,
  withVerifiedLifecycleFsHelper,
} from '../utils/lifecycle-fs-helper.js';
import type { BoundLock } from '../utils/lifecycle-fs-wire.js';
import type { RepositoryMutationContext } from '../repository/context.js';
import type {
  KnowhowEvolutionLink,
  KnowhowLifecycleResult,
} from './knowhow-lifecycle.js';

const LIFECYCLE_WORKER_TIMEOUT_MS = 15_000;
const LIFECYCLE_LOCK_RELATIVE_PATH = '.workflow/knowhow/.lifecycle.lock';

export const LIFECYCLE_WORKER_ACTIVE_LIMIT = 4;
export const LIFECYCLE_WORKER_QUEUE_LIMIT = 32;

export type KnowhowLifecycleRequest =
  | {
    operation: 'supersede';
    projectRoot: string;
    oldId: string;
    newId: string;
    repositoryContext?: RepositoryMutationContext;
  }
  | {
    operation: 'history';
    projectRoot: string;
    id: string;
  }
  | {
    operation: 'recover';
    projectRoot: string;
    repositoryContext?: RepositoryMutationContext;
  };

export type KnowhowLifecycleWorkerRequest =
  KnowhowLifecycleRequest & { ownerGeneration: string };

export type KnowhowLifecycleWorkerResult =
  | {
    operation: 'supersede';
    result: KnowhowLifecycleResult;
  }
  | {
    operation: 'history';
    entries: KnowhowEvolutionLink[];
  }
  | {
    operation: 'recover';
    result: KnowhowLifecycleResult;
  };

export type KnowhowLifecycleWorkerMessage =
  | {
    type: 'knowhow-lifecycle-result';
    ok: true;
    result: KnowhowLifecycleWorkerResult;
  }
  | {
    type: 'knowhow-lifecycle-result';
    ok: false;
    error: string;
  };

export interface KnowhowLifecycleWorkerBridgeOptions {
  workerUrl?: URL;
  timeoutMs?: number;
}

export class KnowhowLifecycleBridgeError extends Error {
  constructor(
    readonly code: 'KNOWHOW_LIFECYCLE_BUSY' | 'KNOWHOW_LIFECYCLE_CLEANUP_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'KnowhowLifecycleBridgeError';
  }
}

interface ScheduledLifecycleRequest {
  mutationKey: string | null;
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function canonicalProjectRoot(projectRoot: string): {
  path: string;
  key: string;
} {
  const path = realpathSync.native(resolve(projectRoot));
  return {
    path,
    key: process.platform === 'win32' ? path.toLowerCase() : path,
  };
}

export class LifecycleWorkerScheduler {
  private active = 0;
  private readonly queue: ScheduledLifecycleRequest[] = [];
  private readonly activeMutationKeys = new Set<string>();

  schedule<T>(
    request: KnowhowLifecycleRequest,
    execute: (
      request: KnowhowLifecycleWorkerRequest,
      canonicalRoot: string,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.queue.length >= LIFECYCLE_WORKER_QUEUE_LIMIT) {
      return Promise.reject(new KnowhowLifecycleBridgeError(
        'KNOWHOW_LIFECYCLE_BUSY',
        `Lifecycle Worker queue is full (${LIFECYCLE_WORKER_ACTIVE_LIMIT} active, `
          + `${LIFECYCLE_WORKER_QUEUE_LIMIT} queued)`,
      ));
    }

    let canonical: ReturnType<typeof canonicalProjectRoot>;
    try {
      canonical = canonicalProjectRoot(request.projectRoot);
    } catch (error) {
      return Promise.reject(error);
    }
    const ownerGeneration = randomUUID();
    const workerRequest = {
      ...request,
      projectRoot: canonical.path,
      ownerGeneration,
    } as KnowhowLifecycleWorkerRequest;
    const mutationKey = request.operation === 'history' ? null : canonical.key;

    return new Promise<T>((resolvePromise, rejectPromise) => {
      this.queue.push({
        mutationKey,
        execute: () => execute(workerRequest, canonical.path),
        resolve: value => resolvePromise(value as T),
        reject: rejectPromise,
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < LIFECYCLE_WORKER_ACTIVE_LIMIT) {
      const nextIndex = this.queue.findIndex(
        entry => entry.mutationKey === null
          || !this.activeMutationKeys.has(entry.mutationKey),
      );
      if (nextIndex < 0) return;

      const [entry] = this.queue.splice(nextIndex, 1);
      this.active++;
      if (entry.mutationKey !== null) {
        this.activeMutationKeys.add(entry.mutationKey);
      }
      void Promise.resolve()
        .then(entry.execute)
        .then(
          value => this.finish(entry, { ok: true, value }),
          error => this.finish(entry, { ok: false, error }),
        );
    }
  }

  private finish(
    entry: ScheduledLifecycleRequest,
    outcome: { ok: true; value: unknown } | { ok: false; error: unknown },
  ): void {
    this.active--;
    if (entry.mutationKey !== null) {
      this.activeMutationKeys.delete(entry.mutationKey);
    }
    this.drain();
    if (outcome.ok) entry.resolve(outcome.value);
    else entry.reject(outcome.error);
  }
}

const lifecycleWorkerScheduler = new LifecycleWorkerScheduler();

function defaultLifecycleWorkerUrl(): URL | null {
  const colocated = new URL('./knowhow-lifecycle-worker.js', import.meta.url);
  if (existsSync(fileURLToPath(colocated))) return colocated;
  const sourceWorker = new URL('./knowhow-lifecycle-worker.ts', import.meta.url);
  if (existsSync(fileURLToPath(sourceWorker))) return null;
  return new URL('../../dist/src/tools/knowhow-lifecycle-worker.js', import.meta.url);
}

async function runSourceLifecycleDirect(
  request: KnowhowLifecycleWorkerRequest,
): Promise<KnowhowLifecycleWorkerResult> {
  const lifecycle = await import('./knowhow-lifecycle.js');
  switch (request.operation) {
    case 'supersede':
      return {
        operation: request.operation,
        result: lifecycle.supersedeKnowhowEntry(
          request.projectRoot,
          request.oldId,
          request.newId,
          {
            ownerGeneration: request.ownerGeneration,
            repositoryContext: request.repositoryContext,
          },
        ),
      };
    case 'history':
      return {
        operation: request.operation,
        entries: lifecycle.getKnowhowEvolutionChain(request.projectRoot, request.id),
      };
    case 'recover':
      return {
        operation: request.operation,
        result: lifecycle.recoverKnowhowLifecycleIntent(
          request.projectRoot,
          {
            ownerGeneration: request.ownerGeneration,
            repositoryContext: request.repositoryContext,
          },
        ),
      };
  }
}

function isMissingLifecycleFile(error: unknown): boolean {
  return error instanceof LifecycleFsHelperError && error.code === 'MISSING';
}

function parseMatchingBoundLock(
  bytesBase64: string,
  generation: BoundLock['generation'],
  ownerGeneration: string,
): BoundLock | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytesBase64, 'base64').toString('utf8'));
  } catch {
    throw new Error('Lifecycle lock contains invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Lifecycle lock has an invalid owner envelope');
  }
  const owner = value as Record<string, unknown>;
  if (owner.ownerGeneration !== ownerGeneration) return null;
  if (Object.keys(owner).sort().join(',') !== 'ownerGeneration,pid,token'
    || !Number.isInteger(owner.pid)
    || (owner.pid as number) <= 0
    || typeof owner.token !== 'string'
    || owner.token.length === 0
    || (generation.ownerGeneration !== null
      && generation.ownerGeneration !== ownerGeneration)) {
    throw new Error('Lifecycle lock does not match its bound owner generation');
  }
  return {
    lockRelativePath: LIFECYCLE_LOCK_RELATIVE_PATH,
    token: owner.token,
    ownerGeneration,
    generation: {
      ...generation,
      ownerGeneration,
    },
  };
}

function releaseMatchingLifecycleLock(
  projectRoot: string,
  request: KnowhowLifecycleWorkerRequest,
): void {
  if (request.operation === 'history') return;
  withVerifiedLifecycleFsHelper(() => {
    let read;
    try {
      read = readLifecycleFileBound(projectRoot, LIFECYCLE_LOCK_RELATIVE_PATH);
    } catch (error) {
      if (isMissingLifecycleFile(error)) return;
      throw error;
    }
    const lock = parseMatchingBoundLock(
      read.bytesBase64,
      read.generation,
      request.ownerGeneration,
    );
    if (!lock) return;
    const release = compareReleaseLifecycleLock(projectRoot, lock);
    if (release !== 'released' && release !== 'missing' && release !== 'replaced') {
      throw new Error(`Unexpected lifecycle lock cleanup result: ${release}`);
    }
  });
}

function cleanupFailure(errors: unknown[]): KnowhowLifecycleBridgeError {
  const detail = errors
    .map(error => error instanceof Error ? error.message : String(error))
    .join('; ');
  return new KnowhowLifecycleBridgeError(
    'KNOWHOW_LIFECYCLE_CLEANUP_FAILED',
    `Lifecycle Worker termination or bound lock cleanup failed: ${detail}`,
    { cause: errors.length === 1 ? errors[0] : new AggregateError(errors) },
  );
}

async function cleanupAfterWorker(
  worker: Worker | null,
  canonicalRoot: string,
  request: KnowhowLifecycleWorkerRequest,
): Promise<void> {
  const errors: unknown[] = [];
  if (worker) {
    try {
      await worker.terminate();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    releaseMatchingLifecycleLock(canonicalRoot, request);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw cleanupFailure(errors);
}

async function runAdmittedWorker(
  request: KnowhowLifecycleWorkerRequest,
  canonicalRoot: string,
  options: KnowhowLifecycleWorkerBridgeOptions,
): Promise<KnowhowLifecycleWorkerResult> {
  const workerUrl = options.workerUrl ?? defaultLifecycleWorkerUrl();
  const timeoutMs = options.timeoutMs ?? LIFECYCLE_WORKER_TIMEOUT_MS;
  if (!workerUrl) return runSourceLifecycleDirect(request);
  let worker: Worker;
  try {
    worker = new Worker(workerUrl, {
      execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
    });
  } catch (error) {
    await cleanupAfterWorker(null, canonicalRoot, request);
    throw error;
  }

  return new Promise<KnowhowLifecycleWorkerResult>((resolvePromise, rejectPromise) => {
    let settling = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const detach = (): void => {
      if (timer) clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const settle = (
      outcome: { ok: true; result: KnowhowLifecycleWorkerResult }
        | { ok: false; error: Error },
    ): void => {
      if (settling) return;
      settling = true;
      detach();
      void cleanupAfterWorker(worker, canonicalRoot, request).then(
        () => {
          if (outcome.ok) resolvePromise(outcome.result);
          else rejectPromise(outcome.error);
        },
        cleanupError => rejectPromise(cleanupError),
      );
    };
    const fail = (error: Error): void => settle({ ok: false, error });
    const onMessage = (message: KnowhowLifecycleWorkerMessage): void => {
      if (message?.type !== 'knowhow-lifecycle-result') {
        fail(new Error('Knowhow lifecycle worker returned an invalid message'));
        return;
      }
      if (!message.ok) {
        fail(new Error(message.error));
        return;
      }
      if (message.result.operation !== request.operation) {
        fail(new Error('Knowhow lifecycle worker returned a mismatched operation'));
        return;
      }
      settle({ ok: true, result: message.result });
    };
    const onError = (error: Error): void => {
      fail(new Error(`Knowhow lifecycle worker error: ${error.message}`));
    };
    const onExit = (code: number): void => {
      fail(new Error(`Knowhow lifecycle worker exited with code ${code}`));
    };

    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    timer = setTimeout(() => {
      fail(new Error(`Knowhow lifecycle worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    try {
      worker.postMessage(request);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function runKnowhowLifecycleAsync(
  request: KnowhowLifecycleRequest,
  options: KnowhowLifecycleWorkerBridgeOptions = {},
): Promise<KnowhowLifecycleWorkerResult> {
  return lifecycleWorkerScheduler.schedule(
    request,
    (workerRequest, canonicalRoot) => runAdmittedWorker(
      workerRequest,
      canonicalRoot,
      options,
    ),
  );
}
