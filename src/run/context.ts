import { relative, sep } from 'node:path';
import type { TargetPlatform } from '../core/skill-converter.js';
import {
  goalBindingSchema,
  targetPlatformSchema,
  type CommandRun,
  type GoalBinding,
  type RunCheckpoint,
  type SessionState,
} from './schemas.js';
import { SessionStore } from './store.js';

export interface ResolvedRunContext {
  session_id: string;
  run_id: string;
  run_dir: string;
  chain_step_id: string | null;
  resolved_platform: TargetPlatform;
  command_source_hash: string;
  goal_binding: GoalBinding | null;
  checkpoint: RunCheckpoint | null;
}

export function resolveTargetPlatform(
  explicit: TargetPlatform | undefined,
  run: CommandRun | undefined,
  session: SessionState,
): TargetPlatform {
  if (explicit) return targetPlatformSchema.parse(explicit);
  if (run) return run.resolved_platform;
  const executor = targetPlatformSchema.safeParse(session.orchestration.executor?.platform);
  return executor.success ? executor.data : 'claude';
}

export function canonicalRunDir(store: SessionStore, sessionId: string, runId: string): string {
  return relative(store.projectRoot, store.runDir(sessionId, runId)).split(sep).join('/');
}

export function resolveRunContext(
  projectRoot: string,
  runId: string,
  sessionId?: string,
  platformOverride?: TargetPlatform,
): ResolvedRunContext {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const session = store.readBundle(located.sessionId).session;
  const resolvedPlatform = resolveTargetPlatform(undefined, located.run, session);
  if (platformOverride && platformOverride !== resolvedPlatform) {
    throw new Error(
      `Run ${runId} is bound to platform "${resolvedPlatform}"; cannot re-attach as "${platformOverride}"`,
    );
  }
  return {
    session_id: located.sessionId,
    run_id: runId,
    run_dir: canonicalRunDir(store, located.sessionId, runId),
    chain_step_id: located.run.chain_step_id,
    resolved_platform: resolvedPlatform,
    command_source_hash: located.run.command.resolved_prompt_hash,
    goal_binding: located.run.goal_binding,
    checkpoint: located.run.checkpoint,
  };
}

export interface ObserveGoalBindingInput {
  provider: string;
  external_id?: string | null;
  step_goal_ref?: string | null;
  observed_status: GoalBinding['observed_status'];
  observed_at?: string;
}

/** Store an external Goal observation. It never changes Run or Session status. */
export function observeGoalBinding(
  projectRoot: string,
  runId: string,
  input: ObserveGoalBindingInput,
  sessionId?: string,
): GoalBinding {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const binding = goalBindingSchema.parse({
    provider: input.provider,
    external_id: input.external_id ?? null,
    step_goal_ref: input.step_goal_ref ?? null,
    observed_status: input.observed_status,
    observed_at: input.observed_at ?? new Date().toISOString(),
  });
  return store.update(located.sessionId, (_bundle, tx) => {
    const run = tx.readRun(runId);
    run.goal_binding = binding;
    tx.writeRun(run);
    return binding;
  });
}
