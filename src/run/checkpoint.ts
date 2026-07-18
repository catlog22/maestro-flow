import {
  dispatchExpectationSchema,
  runCheckpointSchema,
  type DispatchExpectation,
  type RunCheckpoint,
} from './schemas.js';
import { SessionStore } from './store.js';

export interface RegisterDispatchInput {
  chain_step_id: string;
  team_task_id: string;
  revision?: number;
  dispatched_at?: string;
}

/** Register the checkpoint identity before a worker is dispatched. */
export function registerDispatchExpectation(
  projectRoot: string,
  runId: string,
  input: RegisterDispatchInput,
  sessionId?: string,
): DispatchExpectation {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  return store.update(located.sessionId, (_bundle, tx) => {
    const run = tx.readRun(runId);
    if (!run.chain_step_id) throw new Error(`Run ${runId} is not bound to a chain step`);
    if (run.chain_step_id !== input.chain_step_id) {
      throw new Error(`checkpoint chain step mismatch: expected ${run.chain_step_id}, got ${input.chain_step_id}`);
    }
    const expectation = dispatchExpectationSchema.parse({
      run_id: runId,
      chain_step_id: input.chain_step_id,
      team_task_id: input.team_task_id,
      revision: input.revision ?? 0,
      dispatched_at: input.dispatched_at ?? new Date().toISOString(),
    });
    if (run.checkpoint_expectation) {
      const current = run.checkpoint_expectation;
      const same = current.run_id === expectation.run_id
        && current.chain_step_id === expectation.chain_step_id
        && current.team_task_id === expectation.team_task_id
        && current.revision === expectation.revision;
      if (!same) throw new Error(`dispatch expectation already registered for task ${current.team_task_id}`);
      return current;
    }
    run.checkpoint_expectation = expectation;
    tx.writeRun(run);
    return expectation;
  });
}

export interface RecordCheckpointInput {
  run_id: string;
  chain_step_id: string;
  team_task_id: string;
  revision: number;
  artifact_id: string | null;
  verdict: RunCheckpoint['verdict'];
  updated_at?: string;
}

/**
 * Validate a checkpoint against dispatch identity and ArtifactRegistry authority.
 * Null-artifact observations are retained but cannot claim a passing verdict.
 */
export function recordRunCheckpoint(
  projectRoot: string,
  runId: string,
  input: RecordCheckpointInput,
  sessionId?: string,
): RunCheckpoint {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  return store.update(located.sessionId, (bundle, tx) => {
    const run = tx.readRun(runId);
    const expected = run.checkpoint_expectation;
    if (!expected) throw new Error(`Run ${runId} has no dispatch expectation`);
    if (input.run_id !== runId || expected.run_id !== runId) {
      throw new Error(`checkpoint run mismatch: expected ${runId}, got ${input.run_id}`);
    }
    if (input.chain_step_id !== expected.chain_step_id || input.chain_step_id !== run.chain_step_id) {
      throw new Error(`checkpoint chain step mismatch: expected ${expected.chain_step_id}, got ${input.chain_step_id}`);
    }
    if (input.team_task_id !== expected.team_task_id) {
      throw new Error(`checkpoint task mismatch: expected ${expected.team_task_id}, got ${input.team_task_id}`);
    }
    if (input.revision < expected.revision) {
      throw new Error(`checkpoint revision ${input.revision} precedes dispatch revision ${expected.revision}`);
    }
    if (run.checkpoint && input.revision <= run.checkpoint.revision) {
      throw new Error(`checkpoint revision must increase beyond ${run.checkpoint.revision}`);
    }

    let authoritative = false;
    if (input.artifact_id) {
      const artifact = bundle.artifacts.artifacts[input.artifact_id];
      if (!artifact) throw new Error(`checkpoint artifact not registered: ${input.artifact_id}`);
      if (artifact.producer_run_id !== runId) {
        throw new Error(`checkpoint artifact ${input.artifact_id} belongs to Run ${artifact.producer_run_id}`);
      }
      authoritative = artifact.status === 'sealed';
    }
    if (input.verdict === 'pass' && !authoritative) {
      throw new Error('passing checkpoint requires a sealed ArtifactRegistry artifact produced by this Run');
    }

    const checkpoint = runCheckpointSchema.parse({
      ...input,
      authoritative,
      updated_at: input.updated_at ?? new Date().toISOString(),
    });
    run.checkpoint = checkpoint;
    tx.writeRun(run);
    return checkpoint;
  });
}
