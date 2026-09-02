import { createHash, randomUUID } from 'node:crypto';
import type { Command } from 'commander';

import { resolve } from 'node:path';

import { SessionStore } from '../run/store.js';
import type { RunV30 } from '../run/schemas.js';
import { artifactRegistrySchema, type ArtifactRegistry } from '../run/schemas.js';
import { V3StructuredError } from '../run/v3/errors.js';
import { buildRetryMetadata } from '../run/v3/run-machine.js';
import {
  v3CheckNext,
  v3CompleteNext,
  v3RunNext,
  v3SessionCompleteNext,
} from '../run/v3/continuation-v3.js';
import {
  completeRunAndAdvance,
  createRunningRunV3,
  mutateRunV3,
  recoverSealRunV3,
  v3BirthPacket,
} from '../run/v3/mutation-engine.js';
import {
  decideV3,
  type DecideV3Confidence,
  type DecideV3Verdict,
} from '../run/v3/decide-v3.js';
import {
  generateV3RunKnowledgeReconciliation,
  readV3KnowledgeReconciliation,
  v3ReconciliationSummary,
} from '../run/v3/knowledge-v3.js';
import { ensureV3RunShell } from '../run/v3/run-shell.js';
import {
  addV3MutationOptions,
  addV3ReadOptions,
  collectV3,
  emitV3Error,
  emitV3Success,
  listV3Sessions,
  mutationIdentity,
  parseV3Revision,
  resolveV3Options,
  type V3CommonOptions,
  v3Store,
} from './v3-cli-shared.js';

type RunMutationOptions = V3CommonOptions & { run: string };

function runResult(mutation: ReturnType<typeof mutateRunV3>): unknown {
  return mutation.transition.result;
}

function readRunOrThrow(store: SessionStore, sessionId: string, runId: string): RunV30 {
  try {
    return store.readRunV30(sessionId, runId);
  } catch (error) {
    if (error instanceof Error && /Missing authoritative file/i.test(error.message)) {
      throw new V3StructuredError('RUN_NOT_FOUND', `Run ${runId} was not found`, {
        target_type: 'run', target_id: runId,
        next_actions: ['check-run-id', 'read-session-status'],
      });
    }
    throw error;
  }
}

export function registerRunV3Command(program: Command): void {
  const run = program.command('run').description('Manage session/3.0 Runs');

  addV3MutationOptions(run.command('next').description('Create the next pending chain Run'), 'orchestration')
    .option('--run <id>', 'new Run ID (default: generated)')
    .action((options: V3CommonOptions & { run?: string }) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        // Default Run ID is derived deterministically from the request ID:
        // a response-loss retry with the same request-id must rebuild the SAME
        // canonical payload so the engine replays the original receipt instead
        // of failing with REQUEST_CONFLICT (audit §14.2). Explicit --run still
        // wins (caller-controlled).
        const runId = resolved.run?.trim()
          || `run-${createHash('sha256').update(resolved.requestId).digest('hex').slice(0, 12)}`;
        const state = store.readSessionV30(resolved.session);
        const existingRun = (() => {
          try { return store.readRunV30(resolved.session, runId); } catch { return null; }
        })();
        const pendingStep = existingRun ? null : state.chain.find(item => item.status === 'pending');
        const step = existingRun
          ? state.chain.find(item => item.step_id === existingRun.step_id && item.run_ids.includes(existingRun.run_id))
          : pendingStep;
        if (!step) throw new Error('Session chain has no pending step');
        const now = new Date().toISOString();
        const candidate: RunV30 = existingRun ? {
          ...existingRun,
          status: 'pending',
          revision: 0,
          started_at: null,
          ended_at: null,
          sealed_at: null,
          // Input refs are engine-injected inside the transaction; a replay
          // candidate must not carry them or the canonical payload hash
          // drifts from the original mutation (audit H1-⑤).
          input_refs: [],
        } : {
          schema_version: 'run/3.0', run_id: runId, session_id: resolved.session,
          step_id: step.step_id, parent_run_id: null, retry_of_run_id: null, attempt: 1,
          command: step.command, args: step.args, goal: step.goal_ref, status: 'pending', revision: 0,
          actor_id: resolved.actor,
          input_refs: [], output_refs: [], primary_artifact_id: null,
          verdict: null, summary: null, created_at: now, started_at: null, ended_at: null, sealed_at: null,
        };
        // Run shell before the mutation commits (audit H1-⑥): a shell failure
        // must not leave a committed Run without its working directory, and a
        // failed mutation may leave an idempotent shell behind harmlessly.
        ensureV3RunShell(store, resolved.session, runId);
        const mutation = createRunningRunV3(store, {
          ...mutationIdentity(resolved), expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!, run: candidate,
        });
        emitV3Success({ operation: 'next', sessionId: resolved.session, runId,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('next', error, { session: options.session, runId: options.run, requestId: options.requestId });
      }
    });

  addV3MutationOptions(run.command('create <command> [args...]').description('Create and start a Run'), 'orchestration')
    .requiredOption('--run <id>', 'new Run ID')
    .requiredOption('--step <id>', 'target chain step ID')
    .option('--parent-run <id>', 'parent Run ID')
    .option('--retry-of-run <id>', 'derive retry lineage from an existing failed Run')
    .option('--goal <text>', 'Run goal')
    .option('--input <artifact-id>', 'sealed same-Session Artifact ID (repeatable)', collectV3, [])
    .action((command: string, args: string[], options: V3CommonOptions & {
      run: string; step: string; parentRun?: string; retryOfRun?: string;
      goal?: string; input: string[];
    }) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const now = new Date().toISOString();
        const retrySource = resolved.retryOfRun
          ? readRunOrThrow(store, resolved.session, resolved.retryOfRun)
          : null;
        const retry = retrySource
          ? retrySource.status === 'sealed'
            ? buildRetryMetadata({
              runId: retrySource.run_id,
              attempt: retrySource.attempt,
              status: retrySource.status,
              verdict: retrySource.verdict,
            })
            : buildRetryMetadata({
              runId: retrySource.run_id,
              attempt: retrySource.attempt,
              status: retrySource.status,
            })
          : null;
        const candidate: RunV30 = {
          schema_version: 'run/3.0', run_id: resolved.run, session_id: resolved.session,
          step_id: resolved.step, parent_run_id: resolved.parentRun ?? null,
          retry_of_run_id: retry?.retryOfRunId ?? null, attempt: retry?.attempt ?? 1,
          command, args, goal: resolved.goal ?? null, status: 'pending', revision: 0,
          actor_id: resolved.actor,
          input_refs: resolved.input, output_refs: [],
          primary_artifact_id: null, verdict: null, summary: null,
          created_at: now, started_at: null, ended_at: null, sealed_at: null,
        };
        // Run shell before the mutation commits (audit H1-⑥).
        ensureV3RunShell(store, resolved.session, resolved.run);
        const mutation = createRunningRunV3(store, {
          ...mutationIdentity(resolved),
          expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!,
          requestOperation: 'run-create',
          run: candidate,
        });
        emitV3Success({ operation: 'create', sessionId: resolved.session, runId: resolved.run,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('create', error, { session: options.session, runId: options.run, requestId: options.requestId });
      }
    });

  addV3MutationOptions(run.command('complete <run-id>').description('Complete and seal a Run atomically'), 'run')
    .option('--summary <text>', 'completion summary (fallback: report.md frontmatter summary)')
    .option('--verdict <verdict>', 'done or done_with_concerns', 'done')
    .option('--advance', 'required: complete the Run and its chain step atomically')
    .requiredOption('--expected-orchestration-revision <n>', 'expected Session orchestration revision', parseV3Revision)
    .action((runId: string, options: V3CommonOptions & {
      summary?: string; verdict: string; advance?: boolean;
    }) => {
      try {
        if (!options.advance) {
          throw new V3StructuredError(
            'INVALID_ARGUMENT',
            'run complete requires --advance to update the chain step atomically',
          );
        }
        if (options.verdict !== 'done' && options.verdict !== 'done_with_concerns') {
          throw new V3StructuredError('INVALID_ARGUMENT', '--verdict must be done or done_with_concerns');
        }
        const { store, options: resolved } = resolveV3Options(options);
        const verdict = resolved.verdict as 'done' | 'done_with_concerns';
        // Knowledge reconciliation is generated BEFORE the mutation (pure
        // computation, no writes) and committed atomically with the staged
        // knowledge delta inside completeRunAndAdvance — receipt and delta
        // can never diverge. A missing/unreadable report yields null and both
        // are omitted.
        // Missing report.md yields null. Generation errors must not abort the
        // official seal; completeRunAndAdvance retries under lock and records
        // concerns when reconciliation still fails without candidates.
        let knowledgeReconciliation = null;
        try {
          knowledgeReconciliation = generateV3RunKnowledgeReconciliation(
            store.projectRoot, resolved.session, runId,
          );
        } catch {
          knowledgeReconciliation = null;
        }
        const mutation = completeRunAndAdvance(store, {
          ...mutationIdentity(resolved), runId,
          expectedRunRevision: resolved.expectedRunRevision!,
          expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!,
          summary: resolved.summary, verdict,
          knowledgeReconciliation,
        });
        emitV3Success({ operation: 'complete', sessionId: resolved.session, runId,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('complete', error, { session: options.session, runId, requestId: options.requestId });
      }
    });

  addV3MutationOptions(run.command('transition <run-id> <status>').description('Transition a Run between active states'), 'run')
    .option('--expected-orchestration-revision <n>', 'required when failed transition updates the Session chain', parseV3Revision)
    .action((runId: string, status: string, options: RunMutationOptions) => {
      try {
        if (!['running', 'blocked', 'failed'].includes(status)) {
          throw new V3StructuredError('INVALID_ARGUMENT', 'status must be running, blocked, or failed');
        }
        const { store, options: resolved } = resolveV3Options(options);
        const toStatus = status as 'running' | 'blocked' | 'failed';
        const mutation = mutateRunV3(store, {
          ...mutationIdentity(resolved), runId,
          expectedRunRevision: resolved.expectedRunRevision!,
          expectedOrchestrationRevision: resolved.expectedOrchestrationRevision,
          toStatus,
          transitionEvidence: { reason: resolved.reason, evidence: resolved.evidence },
          verdict: toStatus === 'blocked' ? 'blocked' : toStatus === 'failed' ? 'needs_retry' : undefined,
        });
        emitV3Success({ operation: 'run-transition', sessionId: resolved.session, runId,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('run-transition', error, { session: options.session, runId, requestId: options.requestId });
      }
    });

  addV3MutationOptions(run.command('cancel <run-id>').description('Cancel a Run'), 'run')
    .requiredOption('--expected-orchestration-revision <n>', 'expected Session orchestration revision', parseV3Revision)
    .action((runId: string, options: RunMutationOptions) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const mutation = mutateRunV3(store, {
          ...mutationIdentity(resolved), runId,
          expectedRunRevision: resolved.expectedRunRevision!,
          expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!,
          toStatus: 'cancelled',
        });
        emitV3Success({ operation: 'run-cancel', sessionId: resolved.session, runId,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('run-cancel', error, { session: options.session, runId, requestId: options.requestId });
      }
    });

  addV3MutationOptions(run.command('seal <run-id>').description('Deprecated recovery seal for an already terminal pre-upgrade Run'), 'run')
    .action((runId: string, options: RunMutationOptions) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const mutation = recoverSealRunV3(store, {
          ...mutationIdentity(resolved), runId,
          expectedRunRevision: resolved.expectedRunRevision!,
        });
        emitV3Success({ operation: 'run-seal', sessionId: resolved.session, runId,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('run-seal', error, { session: options.session, runId, requestId: options.requestId });
      }
    });

  addV3MutationOptions(run.command('decide <point-id>').description('Record a decision point verdict'), 'orchestration')
    .requiredOption('--verdict <verdict>', 'proceed|fix|escalate')
    .option('--confidence <level>', 'high|medium|low', 'medium')
    .option('--summary <text>', 'decision summary')
    .option('--after-step <id>', 'chain step the decision gates (default: first pending step)')
    .action((pointId: string, options: V3CommonOptions & {
      verdict: string; confidence: string; summary?: string; afterStep?: string;
    }) => {
      try {
        if (!['proceed', 'fix', 'escalate'].includes(options.verdict)) {
          throw new V3StructuredError('INVALID_ARGUMENT', '--verdict must be proceed, fix, or escalate');
        }
        if (!['high', 'medium', 'low'].includes(options.confidence)) {
          throw new V3StructuredError('INVALID_ARGUMENT', '--confidence must be high, medium, or low');
        }
        const { store, options: resolved } = resolveV3Options(options);
        const mutation = decideV3(store, {
          ...mutationIdentity(resolved),
          pointId,
          verdict: resolved.verdict as DecideV3Verdict,
          confidence: resolved.confidence as DecideV3Confidence,
          summary: resolved.summary,
          expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!,
          afterStepId: resolved.afterStep,
        });
        emitV3Success({ operation: 'run-decide', sessionId: resolved.session,
          requestId: resolved.requestId, result: runResult(mutation), mutation });
      } catch (error) {
        emitV3Error('run-decide', error, { session: options.session, requestId: options.requestId });
      }
    });

  addV3ReadOptions(run.command('brief <run-id>').description('Return the v3 Resume Packet for a Run'))
    .action((runId: string, options: { session?: string; workflowRoot: string }) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const value = readRunOrThrow(store, resolved.session, runId);
        const sessionState = store.readSessionV30(resolved.session);
        const artifactsPath = resolve(store.sessionDir(resolved.session), sessionState.artifacts_ref);
        const registry = store.readJsonFileReadOnly<ArtifactRegistry>(
          artifactsPath,
          artifactRegistrySchema,
          { schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {} },
        );
        const packet = v3BirthPacket(store, sessionState, value, registry);
        const pendingStep = sessionState.chain.find(item => item.status === 'pending');
        const continuation = value.status === 'running'
          ? v3CompleteNext({
            sessionId: sessionState.session_id,
            runId,
            orchestrationRevision: sessionState.orchestration_revision,
            runRevision: value.revision,
            reason: 'Run running - execute and complete it with run complete --advance',
          })
          : value.status === 'sealed'
            ? pendingStep
              ? v3RunNext({
                sessionId: sessionState.session_id,
                orchestrationRevision: sessionState.orchestration_revision,
                reason: 'Run sealed - dispatch the next pending step with run next',
              })
              : v3SessionCompleteNext({
                sessionId: sessionState.session_id,
                orchestrationRevision: sessionState.orchestration_revision,
                reason: 'Chain complete - complete the Session',
              })
            : v3CheckNext({
              sessionId: sessionState.session_id,
              runId,
              reason: `Run is ${value.status} - inspect canonical Run state before continuing`,
            });
        emitV3Success({
          operation: 'brief',
          sessionId: resolved.session,
          runId,
          result: {
            schema_version: 'brief-result/3.0',
            session: {
              session_id: sessionState.session_id,
              status: sessionState.status,
              orchestration_revision: sessionState.orchestration_revision,
              objective: sessionState.objective,
              definition_of_done: sessionState.definition_of_done,
              active_run_ids: sessionState.active_run_ids,
            },
            run: value,
            ...packet,
            ...continuation,
          },
        });
      } catch (error) {
        emitV3Error('brief', error, { session: options.session, runId });
      }
    });

  addV3ReadOptions(run.command('recall <command> [args...]').description('Read-only topic search across session/3.0 Sessions'))
    .action((command: string, args: string[], options: { session?: string; workflowRoot: string }) => {
      try {
        const store = v3Store(options);
        const query = [command, ...args].join(' ').trim().toLowerCase();
        const matches: Array<{
          session_id: string;
          status: string;
          objective: string;
          updated_at: string;
          matched: string[];
        }> = [];
        if (query) {
          for (const session of listV3Sessions(store)) {
            const matched: string[] = [];
            const consider = (value: string): void => {
              if (value.toLowerCase().includes(query)) matched.push(value);
            };
            consider(session.objective);
            consider(session.definition_of_done);
            for (const step of session.chain) consider(step.command);
            const unique = [...new Set(matched)];
            if (unique.length > 0) {
              matches.push({
                session_id: session.session_id,
                status: session.status,
                objective: session.objective,
                updated_at: session.updated_at,
                matched: unique,
              });
            }
          }
        }
        matches.sort((left, right) => right.updated_at.localeCompare(left.updated_at)
          || left.session_id.localeCompare(right.session_id));
        emitV3Success({ operation: 'recall', sessionId: null, result: matches });
      } catch (error) {
        emitV3Error('recall', error, { session: options.session });
      }
    });

  addV3ReadOptions(run.command('check <run-id>').description('Check Run state and available transitions'))
    .action((runId: string, options: { session?: string; workflowRoot: string }) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const value = readRunOrThrow(store, resolved.session, runId);
        const transitions: Record<RunV30['status'], string[]> = {
          pending: ['running', 'cancelled'], running: ['completed', 'failed', 'blocked', 'cancelled'],
          blocked: ['running', 'failed', 'cancelled'], completed: ['sealed'], failed: ['sealed'],
          cancelled: ['sealed'], sealed: [],
        };
        const result: Record<string, unknown> = {
          run_id: runId, status: value.status, revision: value.revision,
          available_transitions: transitions[value.status],
        };
        // Read-only receipt attach: check never re-runs reconciliation (run
        // complete performs the one-shot reconcile). A missing or unreadable
        // receipt omits the field entirely without warnings.
        const receipt = readV3KnowledgeReconciliation(store, resolved.session, runId);
        if (receipt) result.knowledge_reconciliation = v3ReconciliationSummary(receipt);
        emitV3Success({ operation: 'check', sessionId: resolved.session, runId, result });
      } catch (error) {
        emitV3Error('check', error, { session: options.session, runId });
      }
    });

}
