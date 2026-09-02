import { parentPort } from 'node:worker_threads';

import {
  getKnowhowEvolutionChain,
  recoverKnowhowLifecycleIntent,
  supersedeKnowhowEntry,
} from './knowhow-lifecycle.js';
import type {
  KnowhowLifecycleWorkerMessage,
  KnowhowLifecycleWorkerRequest,
  KnowhowLifecycleWorkerResult,
} from './knowhow-lifecycle-async.js';

function assertRequest(value: unknown): asserts value is KnowhowLifecycleWorkerRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid knowhow lifecycle worker request');
  }
  const request = value as Record<string, unknown>;
  if (typeof request.projectRoot !== 'string') {
    throw new Error('Invalid knowhow lifecycle worker projectRoot');
  }
  if (typeof request.ownerGeneration !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(request.ownerGeneration)) {
    throw new Error('Invalid knowhow lifecycle worker ownerGeneration');
  }
  if (request.operation === 'supersede'
    && typeof request.oldId === 'string'
    && typeof request.newId === 'string'
    && Object.keys(request).sort().join(',')
      === [
        'newId', 'oldId', 'operation', 'ownerGeneration', 'projectRoot',
        ...(request.repositoryContext === undefined ? [] : ['repositoryContext']),
      ].sort().join(',')) {
    return;
  }
  if (request.operation === 'history'
    && typeof request.id === 'string'
    && Object.keys(request).sort().join(',')
      === 'id,operation,ownerGeneration,projectRoot') return;
  if (request.operation === 'recover'
    && Object.keys(request).sort().join(',')
      === [
        'operation', 'ownerGeneration', 'projectRoot',
        ...(request.repositoryContext === undefined ? [] : ['repositoryContext']),
      ].sort().join(',')) return;
  throw new Error('Invalid knowhow lifecycle worker operation');
}

function dispatch(request: KnowhowLifecycleWorkerRequest): KnowhowLifecycleWorkerResult {
  switch (request.operation) {
    case 'supersede':
      return {
        operation: request.operation,
        result: supersedeKnowhowEntry(
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
        entries: getKnowhowEvolutionChain(request.projectRoot, request.id),
      };
    case 'recover':
      return {
        operation: request.operation,
        result: recoverKnowhowLifecycleIntent(
          request.projectRoot,
          {
            ownerGeneration: request.ownerGeneration,
            repositoryContext: request.repositoryContext,
          },
        ),
      };
  }
}

const port = parentPort;
if (!port) throw new Error('Knowhow lifecycle worker requires parentPort');

port.once('message', (value: unknown) => {
  let message: KnowhowLifecycleWorkerMessage;
  try {
    assertRequest(value);
    message = {
      type: 'knowhow-lifecycle-result',
      ok: true,
      result: dispatch(value),
    };
  } catch (error) {
    message = {
      type: 'knowhow-lifecycle-result',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(message);
});
