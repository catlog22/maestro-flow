import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeControl = vi.hoisted(() => ({
  options: null as { workerUrl: URL; timeoutMs: number } | null,
}));

vi.mock('../knowhow-lifecycle-async.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../knowhow-lifecycle-async.js')>();
  return {
    ...actual,
    runKnowhowLifecycleAsync: (
      request: import('../knowhow-lifecycle-async.js').KnowhowLifecycleRequest,
      options?: import('../knowhow-lifecycle-async.js').KnowhowLifecycleWorkerBridgeOptions,
    ) => actual.runKnowhowLifecycleAsync(
      request,
      bridgeControl.options ?? options,
    ),
  };
});

import { ccwResultToMcp } from '../../types/tool-schema.js';
import {
  acquireLifecycleLockBound,
  compareReleaseLifecycleLock,
  verifyLifecycleFsHelperBinary,
} from '../../utils/lifecycle-fs-helper.js';
import type { BoundLock } from '../../utils/lifecycle-fs-wire.js';
import * as lifecycle from '../knowhow-lifecycle.js';
import { runKnowhowLifecycleAsync } from '../knowhow-lifecycle-async.js';
import { handler } from '../store-knowhow.js';

const OLD_STEM = 'tip-20260723-mcp-old';
const NEW_STEM = 'tip-20260723-mcp-new';
const OLD_ID = `knowhow-${OLD_STEM}`;
const NEW_ID = `knowhow-${NEW_STEM}`;

function dataWorker(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function controlledWorker(markerDir: string): URL {
  return dataWorker(`
    import { appendFileSync, existsSync } from "node:fs";
    import { basename, join } from "node:path";
    import { parentPort } from "node:worker_threads";
    parentPort.once("message", request => {
      const label = basename(request.projectRoot);
      appendFileSync(${JSON.stringify(join(markerDir, 'starts.log'))}, label + "\\n");
      const releasePath = join(${JSON.stringify(markerDir)}, label + ".release");
      const timer = setInterval(() => {
        if (!existsSync(releasePath)) return;
        clearInterval(timer);
        const result = request.operation === "history"
          ? { operation: "history", entries: [] }
          : {
            operation: request.operation,
            result: { success: true, replayed: false },
          };
        parentPort.postMessage({
          type: "knowhow-lifecycle-result",
          ok: true,
          result,
        });
      }, 5);
    });
  `);
}

function immediateWorker(): URL {
  return dataWorker(`
    import { parentPort } from "node:worker_threads";
    parentPort.once("message", request => {
      const result = request.operation === "history"
        ? { operation: "history", entries: [] }
        : {
          operation: request.operation,
          result: { success: true, replayed: false },
        };
      parentPort.postMessage({
        type: "knowhow-lifecycle-result",
        ok: true,
        result,
      });
    });
  `);
}

function hangingLockWorker(markerDir: string): URL {
  const helperPath = verifyLifecycleFsHelperBinary().path;
  return dataWorker(`
    import { spawnSync } from "node:child_process";
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { parentPort } from "node:worker_threads";
    parentPort.once("message", request => {
      const nativeRequest = {
        protocol: "lifecycle-fs-helper/1.0",
        requestId: "worker-lock-" + request.ownerGeneration,
        projectRoot: request.projectRoot,
        op: "acquire-lock",
        lockRelativePath: ".workflow/knowhow/.lifecycle.lock",
        owner: {
          pid: process.pid,
          token: "worker-" + request.ownerGeneration,
          ownerGeneration: request.ownerGeneration,
        },
        staleAfterMs: 10000,
      };
      const response = spawnSync(${JSON.stringify(helperPath)}, [], {
        encoding: "utf8",
        windowsHide: true,
        input: JSON.stringify(nativeRequest) + "\\n",
      });
      if (response.status !== 0) throw new Error(response.stderr);
      const parsed = JSON.parse(response.stdout.trim());
      if (!parsed.ok) throw new Error(parsed.code + ": " + parsed.message);
      writeFileSync(
        join(${JSON.stringify(markerDir)}, "bound-lock.json"),
        JSON.stringify(parsed.result),
      );
      let heartbeat = 0;
      setInterval(() => {
        heartbeat++;
        writeFileSync(
          join(${JSON.stringify(markerDir)}, "heartbeat.txt"),
          String(heartbeat),
        );
      }, 10);
    });
  `);
}

function starts(markerDir: string): string[] {
  const path = join(markerDir, 'starts.log');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean);
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function project(root: string, name: string): string {
  const path = join(root, name);
  mkdirSync(join(path, '.workflow', 'knowhow'), { recursive: true });
  return path;
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('store_knowhow MCP lifecycle worker', () => {
  let root: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-worker-'));
    previousRoot = process.env.MAESTRO_PROJECT_ROOT;
    process.env.MAESTRO_PROJECT_ROOT = root;
    bridgeControl.options = null;
    for (const stem of [OLD_STEM, NEW_STEM]) {
      expect(await handler({
        operation: 'add',
        id: stem,
        type: 'tip',
        title: stem,
        body: 'worker lifecycle fixture',
      })).toMatchObject({ success: true });
    }
  });

  afterEach(() => {
    bridgeControl.options = null;
    vi.restoreAllMocks();
    if (previousRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
    else process.env.MAESTRO_PROJECT_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps the MCP event loop responsive during lifecycle lock contention', async () => {
    const knowhowDir = join(root, '.workflow', 'knowhow');
    const lockPath = join(knowhowDir, '.lifecycle.lock');
    mkdirSync(knowhowDir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      schema_version: 'knowhow-lifecycle-lock/1.0',
      token: 'live-mcp-contention-token',
      pid: process.pid,
      acquiredAt: Date.now(),
    }));
    bridgeControl.options = {
      workerUrl: dataWorker(`
        import { existsSync } from "node:fs";
        import { parentPort } from "node:worker_threads";
        parentPort.once("message", request => {
          const complete = () => {
            if (request.operation === "supersede"
              && existsSync(${JSON.stringify(lockPath)})) return;
            const result = request.operation === "history"
              ? { operation: "history", entries: [] }
              : {
                operation: request.operation,
                result: {
                  success: true,
                  schema_version: "knowhow-supersede-result/1.0",
                  operation: "supersede",
                  oldId: request.oldId,
                  newId: request.newId,
                  replayed: false,
                },
              };
            parentPort.postMessage({
              type: "knowhow-lifecycle-result",
              ok: true,
              result,
            });
            clearInterval(timer);
          };
          const timer = setInterval(complete, 5);
          complete();
        });
      `),
      timeoutMs: 1_000,
    };

    const supersede = handler({
      operation: 'supersede',
      oldId: OLD_ID,
      newId: NEW_ID,
    });
    let timerFired = false;
    const mainThreadTimer = new Promise<void>(resolve => {
      setTimeout(() => {
        timerFired = true;
        resolve();
      }, 25);
    });
    const parallelHistory = handler({ operation: 'history', id: OLD_ID });

    const [_timer, historyResult] = await settleWithin(
      Promise.all([mainThreadTimer, parallelHistory]),
      750,
      'MCP event loop did not remain responsive during lifecycle lock contention',
    );
    expect(timerFired).toBe(true);
    expect(ccwResultToMcp(historyResult)).toMatchObject({
      content: [{ type: 'text' }],
    });
    expect(ccwResultToMcp(historyResult).isError).not.toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    rmSync(lockPath);
    const supersedeResult = await settleWithin(
      supersede,
      1_000,
      'store_knowhow supersede did not finish within 1s after lock release',
    );
    expect(supersedeResult).toMatchObject({
      success: true,
      result: {
        schema_version: 'knowhow-supersede-result/1.0',
        operation: 'supersede',
        oldId: OLD_ID,
        newId: NEW_ID,
      },
    });
    expect(ccwResultToMcp(supersedeResult).isError).not.toBe(true);
  });

  it('never falls back to synchronous lifecycle work when the worker is unavailable', async () => {
    const synchronous = [
      vi.spyOn(lifecycle, 'supersedeKnowhowEntry'),
      vi.spyOn(lifecycle, 'getKnowhowEvolutionChain'),
      vi.spyOn(lifecycle, 'recoverKnowhowLifecycleIntent'),
    ];
    const scenarios = [
      {
        name: 'missing worker',
        options: {
          workerUrl: pathToFileURL(join(root, 'missing-lifecycle-worker.mjs')),
          timeoutMs: 200,
        },
      },
      {
        name: 'worker error',
        options: {
          workerUrl: dataWorker('throw new Error("injected lifecycle worker error");'),
          timeoutMs: 200,
        },
      },
      {
        name: 'worker timeout',
        options: {
          workerUrl: dataWorker(
            'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});',
          ),
          timeoutMs: 40,
        },
      },
      {
        name: 'non-zero worker exit',
        options: {
          workerUrl: dataWorker('process.exit(7);'),
          timeoutMs: 200,
        },
      },
    ];

    for (const scenario of scenarios) {
      bridgeControl.options = scenario.options;
      const before = synchronous.map(spy => spy.mock.calls.length);
      const result = await handler({
        operation: 'supersede',
        oldId: OLD_ID,
        newId: NEW_ID,
      });
      const mcp = ccwResultToMcp(result);

      expect(result.success, scenario.name).toBe(false);
      expect(mcp.isError, scenario.name).toBe(true);
      expect(
        synchronous.map((spy, index) => spy.mock.calls.length - before[index]),
        scenario.name,
      ).toEqual([0, 0, 0]);
    }
  });

  it('admits Workers before construction with bounded FIFO project scheduling', async () => {
    const markerDir = join(root, 'admission-markers');
    mkdirSync(markerDir);
    const workerUrl = controlledWorker(markerDir);
    const sameRoot = project(root, 'same-project');
    const otherRoots = [
      project(root, 'other-1'),
      project(root, 'other-2'),
      project(root, 'other-3'),
    ];
    const options = { workerUrl, timeoutMs: 3_000 };

    const sameFirst = runKnowhowLifecycleAsync({
      operation: 'recover',
      projectRoot: sameRoot,
    }, options);
    const sameSecond = runKnowhowLifecycleAsync({
      operation: 'supersede',
      projectRoot: `${sameRoot}${sep}.`,
      oldId: OLD_ID,
      newId: NEW_ID,
    }, options);
    const others = otherRoots.map(projectRoot => runKnowhowLifecycleAsync({
      operation: 'history' as const,
      projectRoot,
      id: OLD_ID,
    }, options));

    await waitUntil(
      () => starts(markerDir).length === 4,
      'Four admitted Workers did not start',
    );
    expect(starts(markerDir).filter(label => label === basename(sameRoot))).toHaveLength(1);
    expect(new Set(starts(markerDir))).toEqual(new Set([
      basename(sameRoot),
      ...otherRoots.map(path => basename(path)),
    ]));

    writeFileSync(join(markerDir, `${basename(otherRoots[0])}.release`), '');
    await others[0];
    expect(starts(markerDir).filter(label => label === basename(sameRoot))).toHaveLength(1);
    writeFileSync(join(markerDir, `${basename(sameRoot)}.release`), '');
    await sameFirst;
    await waitUntil(
      () => starts(markerDir).filter(label => label === basename(sameRoot)).length === 2,
      'Same-project mutation did not start after its predecessor settled',
    );
    for (const path of otherRoots.slice(1)) {
      writeFileSync(join(markerDir, `${basename(path)}.release`), '');
    }
    await Promise.all([sameSecond, ...others.slice(1)]);

    rmSync(join(markerDir, 'starts.log'));
    for (let index = 0; index < 6; index++) {
      project(root, `fifo-${index}`);
    }
    const fifo = Array.from({ length: 6 }, (_value, index) => (
      runKnowhowLifecycleAsync({
        operation: 'history',
        projectRoot: join(root, `fifo-${index}`),
        id: OLD_ID,
      }, options)
    ));
    await waitUntil(
      () => starts(markerDir).length === 4,
      'Initial FIFO Workers did not start',
    );
    expect(new Set(starts(markerDir))).toEqual(new Set([
      'fifo-0',
      'fifo-1',
      'fifo-2',
      'fifo-3',
    ]));
    writeFileSync(join(markerDir, 'fifo-0.release'), '');
    await fifo[0];
    await waitUntil(
      () => starts(markerDir).includes('fifo-4'),
      'First queued Worker did not start in FIFO order',
    );
    expect(starts(markerDir)).not.toContain('fifo-5');
    writeFileSync(join(markerDir, 'fifo-1.release'), '');
    await fifo[1];
    await waitUntil(
      () => starts(markerDir).includes('fifo-5'),
      'Second queued Worker did not start in FIFO order',
    );
    for (let index = 2; index < 6; index++) {
      writeFileSync(join(markerDir, `fifo-${index}.release`), '');
    }
    await Promise.all(fifo.slice(2));
  });

  it('rejects queue overflow before Worker creation', async () => {
    const markerDir = join(root, 'overflow-markers');
    mkdirSync(markerDir);
    const workerUrl = controlledWorker(markerDir);
    const options = { workerUrl, timeoutMs: 5_000 };
    const projectRoots = Array.from(
      { length: 37 },
      (_value, index) => project(root, `overflow-${index}`),
    );
    const admitted = projectRoots.slice(0, 36).map(projectRoot => (
      runKnowhowLifecycleAsync({
        operation: 'history',
        projectRoot,
        id: OLD_ID,
      }, options)
    ));

    await waitUntil(
      () => starts(markerDir).length === 4,
      'Active Worker limit was not reached',
    );
    process.env.MAESTRO_PROJECT_ROOT = projectRoots[36];
    bridgeControl.options = options;
    const overflow = await handler({
      operation: 'history',
      id: OLD_ID,
    });
    process.env.MAESTRO_PROJECT_ROOT = root;
    bridgeControl.options = null;
    expect(overflow).toEqual({
      success: false,
      error: expect.stringContaining('KNOWHOW_LIFECYCLE_BUSY'),
    });
    expect(ccwResultToMcp(overflow).isError).toBe(true);
    expect(starts(markerDir)).toHaveLength(4);
    expect(starts(markerDir)).not.toContain('overflow-36');
    expect(readdirSync(join(projectRoots[36], '.workflow', 'knowhow'))).toEqual([]);

    for (let index = 0; index < 36; index++) {
      writeFileSync(join(markerDir, `overflow-${index}.release`), '');
    }
    await Promise.all(admitted);
  });

  it('settles after termination and bound cleanup', async () => {
    const markerDir = join(root, 'timeout-cleanup-markers');
    mkdirSync(markerDir);
    mkdirSync(join(root, '.workflow', 'knowhow'), { recursive: true });
    const lockPath = join(root, '.workflow', 'knowhow', '.lifecycle.lock');
    const request = runKnowhowLifecycleAsync({
      operation: 'recover',
      projectRoot: root,
    }, {
      workerUrl: hangingLockWorker(markerDir),
      timeoutMs: 300,
    });

    await waitUntil(
      () => existsSync(join(markerDir, 'bound-lock.json'))
        && existsSync(join(markerDir, 'heartbeat.txt')),
      'Timed Worker did not acquire a bound lifecycle lock',
    );
    await expect(request).rejects.toThrow('timed out');
    expect(existsSync(lockPath)).toBe(false);
    const heartbeat = readFileSync(join(markerDir, 'heartbeat.txt'), 'utf8');
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(readFileSync(join(markerDir, 'heartbeat.txt'), 'utf8')).toBe(heartbeat);

    await expect(runKnowhowLifecycleAsync({
      operation: 'recover',
      projectRoot: root,
    }, {
      workerUrl: immediateWorker(),
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ operation: 'recover' });
  });

  it('recovers real timed-out bound lock holder without deleting replacement', async () => {
    const markerDir = join(root, 'replacement-cleanup-markers');
    mkdirSync(markerDir);
    mkdirSync(join(root, '.workflow', 'knowhow'), { recursive: true });
    const lockPath = join(root, '.workflow', 'knowhow', '.lifecycle.lock');
    const request = runKnowhowLifecycleAsync({
      operation: 'supersede',
      projectRoot: root,
      oldId: OLD_ID,
      newId: NEW_ID,
    }, {
      workerUrl: hangingLockWorker(markerDir),
      timeoutMs: 2_500,
    });

    await waitUntil(
      () => existsSync(join(markerDir, 'bound-lock.json')),
      'Timed Worker did not expose its BoundLock',
      8_000,
    );
    const timedLock = JSON.parse(
      readFileSync(join(markerDir, 'bound-lock.json'), 'utf8'),
    ) as BoundLock;
    expect(compareReleaseLifecycleLock(root, timedLock)).toBe('released');
    const replacementGeneration = randomUUID();
    const replacement = acquireLifecycleLockBound(
      root,
      '.workflow/knowhow/.lifecycle.lock',
      {
        pid: process.pid,
        token: `replacement-${replacementGeneration}`,
        ownerGeneration: replacementGeneration,
      },
      10_000,
    );

    await expect(request).rejects.toThrow('timed out');
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual({
      pid: process.pid,
      token: `replacement-${replacementGeneration}`,
      ownerGeneration: replacementGeneration,
    });
    expect(compareReleaseLifecycleLock(root, replacement)).toBe('released');
    await expect(runKnowhowLifecycleAsync({
      operation: 'history',
      projectRoot: root,
      id: OLD_ID,
    }, {
      workerUrl: immediateWorker(),
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ operation: 'history' });
  });
});
