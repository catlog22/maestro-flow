import { resolve } from 'node:path';

import type { Command } from 'commander';
import { z } from 'zod';

import {
  artifactRegistrySchema,
  evidenceStoreSchema,
  sessionStateV30Schema,
  type RunV30,
  type SessionStateV30,
} from '../run/schemas.js';
import { SessionStore } from '../run/store.js';
import { mutateChainV3, type ChainMutation } from '../run/v3/chain-mutations.js';
import { V3StructuredError } from '../run/v3/errors.js';
import { applyV3Migration, readAppliedV3Migration } from '../run/v3/migrate-v3.js';
import { loadLegacyV3MigrationInput } from '../run/v3/migrate-v3-loader.js';
import {
  canonicalPayloadHash,
  createRequestReceipt,
  createTransitionReceipt,
  replayRequestReceipt,
  transitionReceiptRef,
} from '../run/v3/receipts.js';
import { completeSessionV3, type V3MutationResult } from '../run/v3/mutation-engine.js';
import { projectResumeMapV1 } from '../run/v3/resume-view.js';
import {
  addV3MutationOptions,
  addV3ReadOptions,
  assertV3ParticipantIdentity,
  emitV3Error,
  emitV3Success,
  listLegacyV3MigrationCandidates,
  listV3Sessions,
  mutateSessionStatusV3,
  mutationIdentity,
  parseV3Revision,
  resolveV3Options,
  type V3CommonOptions,
  v3Store,
} from './v3-cli-shared.js';

const expectedLegacyRevisionsSchema = z.object({
  identity_revision: z.number().int().nonnegative(),
  activity_revision: z.number().int().nonnegative(),
}).strict();

const expectedLegacyRevisionsManifestSchema = z.record(z.string().min(1), expectedLegacyRevisionsSchema);

type ExpectedLegacyRevisions = z.infer<typeof expectedLegacyRevisionsSchema>;
type ExpectedLegacyRevisionsManifest = z.infer<typeof expectedLegacyRevisionsManifestSchema>;

function parseExpectedLegacyRevisionsManifest(value: string): ExpectedLegacyRevisionsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new V3StructuredError(
      'INVALID_ARGUMENT',
      `--expected-revisions must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = expectedLegacyRevisionsManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new V3StructuredError(
      'INVALID_ARGUMENT',
      '--expected-revisions must be a JSON object keyed by Session ID with identity_revision and activity_revision',
    );
  }
  return result.data;
}

function requiredSingleMigrationRevisions(options: {
  expectedIdentityRevision?: number;
  expectedActivityRevision?: number;
}): ExpectedLegacyRevisions {
  if (options.expectedIdentityRevision === undefined) {
    throw new V3StructuredError('INVALID_ARGUMENT', '--expected-identity-revision is required with --session');
  }
  if (options.expectedActivityRevision === undefined) {
    throw new V3StructuredError('INVALID_ARGUMENT', '--expected-activity-revision is required with --session');
  }
  return {
    identity_revision: options.expectedIdentityRevision,
    activity_revision: options.expectedActivityRevision,
  };
}

function runIds(session: SessionStateV30): string[] {
  return [...new Set([...session.active_run_ids, ...session.chain.flatMap(step => step.run_ids)])].sort();
}

function readRuns(
  options: { session: string; workflowRoot: string },
  session: SessionStateV30,
): RunV30[] {
  const store = v3Store(options);
  return runIds(session).map(runId => store.readRunV30(options.session, runId));
}

function chainMutationAction(
  operation: 'session-chain-insert' | 'session-chain-skip' | 'session-chain-replace' | 'session-chain-update',
  build: (options: V3CommonOptions & {
    stepId: string; command?: string; afterStep?: string; arg?: string[];
    goalRef?: string; stage?: string; decisionRef?: string;
  }) => ChainMutation,
) {
  return (options: V3CommonOptions & {
    stepId: string; command?: string; afterStep?: string; arg?: string[];
    goalRef?: string; stage?: string; decisionRef?: string;
  }): void => {
    try {
      const { store, options: resolved } = resolveV3Options(options);
      const mutation = mutateChainV3(store, {
        ...mutationIdentity(resolved),
        expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!,
        mutation: build(options),
      });
      emitV3Success({ operation, sessionId: resolved.session, requestId: resolved.requestId,
        result: mutation.transition.result, mutation });
    } catch (error) {
      emitV3Error(operation, error, { session: options.session, requestId: options.requestId });
    }
  };
}

export interface OpenSessionV3Input {
  objective: string;
  sessionId: string;
  actorId: string;
  requestId: string;
  reason: string;
  evidence?: readonly string[];
  definitionOfDone?: string;
  chain?: readonly string[];
}

/**
 * Open a session/3.0 Session idempotently. Replays the original receipt when
 * the same request-id is retried against an existing Session. Shared by the
 * `maestro session open` CLI and the v3 plan-publish producer flow.
 */
export function openSessionV3(store: SessionStore, input: OpenSessionV3Input): V3MutationResult {
  assertV3ParticipantIdentity({ participant: input.actorId, actor: input.actorId });
  const sessionId = input.sessionId.trim();
  if (!sessionId) throw new V3StructuredError('INVALID_ARGUMENT', 'Session ID is required');
  const now = new Date().toISOString();
  const evidence = [...(input.evidence ?? [])];
  const payloadHash = canonicalPayloadHash({
    operation: 'session-open',
    objective: input.objective,
    definition_of_done: input.definitionOfDone ?? '',
    actor_id: input.actorId,
    reason: input.reason,
    evidence_refs: [...evidence].sort(),
  });
  const state = sessionStateV30Schema.parse({
    schema_version: 'session/3.0', session_id: sessionId, objective: input.objective,
    definition_of_done: input.definitionOfDone ?? '', status: 'open',
    orchestration_revision: 1, activity_revision: 1,
    chain: (input.chain ?? []).map((command, index) => ({
      step_id: `s-${index + 1}`, command, args: [], status: 'pending' as const,
      run_ids: [], goal_ref: null, decision_ref: null, decision_refs: [], stage: null,
    })),
    decisions: [], active_run_ids: [],
    artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: now, updated_at: now, completed_at: null, archived_at: null,
  });
  const transition = createTransitionReceipt({
    transitionId: `open-${input.requestId}`, requestId: input.requestId, sessionId,
    activityRevision: 1, targetType: 'orchestration', targetId: sessionId,
    revisionBefore: 0, revisionAfter: 1, actorId: input.actorId, participantId: input.actorId,
    reason: input.reason, evidenceRefs: evidence, recordedAt: now, result: state,
  });
  const request = createRequestReceipt({
    requestId: input.requestId, participantId: input.actorId, payloadHash,
    transitionReceiptRef: transitionReceiptRef(1, transition.transition_id),
  });
  return store.withV30Transaction(sessionId, tx => {
    if (tx.sessionExists()) {
      const replayed = replayRequestReceipt({
        tx, sessionId, requestId: input.requestId, participantId: input.actorId, payloadHash,
      });
      if (!replayed) throw new V3StructuredError('INVALID_STATE_TRANSITION', `Session already exists: ${sessionId}`);
      return { status: 'replayed' as const, transition: replayed };
    }
    tx.writeSession(state);
    tx.writeJson(resolve(store.sessionDir(sessionId), state.artifacts_ref), {
      schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
    }, artifactRegistrySchema);
    tx.writeJson(resolve(store.sessionDir(sessionId), state.evidence_ref), {
      schema_version: 'evidence/1.0', revision: 0, records: {},
    }, evidenceStoreSchema);
    tx.writeTransitionReceipt(transition);
    tx.writeRequestReceipt(request);
    return { status: 'applied' as const, transition };
  });
}

export function registerSessionV3Command(program: Command): void {
  const session = program.command('session').description('Manage session/3.0 Sessions');

  addV3ReadOptions(session.command('open <objective>').description('Open a new session/3.0 Session'))
    .requiredOption('--id <id>', 'new Session ID')
    .requiredOption('--participant <id>', 'participant opening the Session')
    .requiredOption('--actor <id>', 'authorized actor')
    .requiredOption('--request-id <id>', 'idempotency request ID')
    .requiredOption('--reason <text>', 'audit reason')
    .option('--evidence <ref>', 'evidence reference (repeatable)', (value, previous: string[] = []) => [...previous, value], [])
    .option('--definition-of-done <text>', 'definition of done', '')
    .option('--chain <commands...>', 'initial chain commands')
    .action((objective: string, options: V3CommonOptions & { id: string; definitionOfDone: string; chain?: string[] }) => {
      try {
        assertV3ParticipantIdentity(options);
        const store = v3Store(options);
        const mutation = openSessionV3(store, {
          objective, sessionId: options.id.trim(), actorId: options.actor,
          requestId: options.requestId, reason: options.reason, evidence: options.evidence,
          definitionOfDone: options.definitionOfDone, chain: options.chain,
        });
        emitV3Success({ operation: 'session-open', sessionId: mutation.transition.session_id,
          requestId: options.requestId, result: mutation.transition.result, mutation });
      } catch (error) {
        emitV3Error('session-open', error, { session: options.id, requestId: options.requestId });
      }
    });

  session.command('migrate')
    .description('Migrate legacy Session files after selecting the session/3.0 writer (or migrate every non-v3 Session with --all)')
    .option('--session <id>', 'legacy Session ID (mutually exclusive with --all)')
    .option('--all', 'migrate every non-session/3.0 Session')
    .requiredOption('--to-v3', 'confirm migration to session/3.0')
    .requiredOption('--participant <id>', 'participant performing the migration; must equal --actor')
    .requiredOption('--actor <id>', 'authorized actor')
    .requiredOption('--request-id <id>', 'migration audit request ID')
    .requiredOption('--reason <text>', 'migration audit reason')
    .option('--expected-identity-revision <n>', 'expected legacy Session identity revision', parseV3Revision)
    .option('--expected-activity-revision <n>', 'expected legacy Session activity revision', parseV3Revision)
    .option('--expected-revisions <json>', 'JSON revisions manifest keyed by Session ID for --all')
    .option('--evidence <ref>', 'migration evidence reference (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--definition-of-done <text>', 'override definition of done')
    .option('--json', 'emit run-response/1.2 JSON')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((options: {
      session?: string; all?: boolean; toV3: boolean; participant: string; actor: string;
      requestId: string; reason: string; evidence?: string[];
      expectedIdentityRevision?: number; expectedActivityRevision?: number;
      expectedRevisions?: string;
      definitionOfDone?: string; workflowRoot: string;
    }) => {
      try {
        assertV3ParticipantIdentity(options);
        const store = new SessionStore(resolve(options.workflowRoot));
        if (store.sessionSchemaSelection().writer !== 'session/3.0') {
          throw new V3StructuredError(
            'SESSION_SCHEMA_UNSUPPORTED',
            'v3 migration requires selecting the session/3.0 writer before migrating legacy Session files',
            { next_actions: ['select-session/3.0-writer', 'retry-session-migrate'] },
          );
        }
        if (options.session !== undefined && options.all) {
          throw new V3StructuredError('INVALID_ARGUMENT', '--all and --session are mutually exclusive');
        }
        if (options.all) {
          if (options.expectedIdentityRevision !== undefined || options.expectedActivityRevision !== undefined) {
            throw new V3StructuredError(
              'INVALID_ARGUMENT',
              '--expected-identity-revision and --expected-activity-revision cannot be used with --all',
            );
          }
          if (options.expectedRevisions === undefined) {
            throw new V3StructuredError('INVALID_ARGUMENT', '--expected-revisions is required with --all');
          }
          const expectedRevisions = parseExpectedLegacyRevisionsManifest(options.expectedRevisions);
          type MigrateAllResult = {
            session_id: string;
            source_schema_version: string;
            outcome: 'migrated' | 'failed';
            error?: string;
          };
          // Batch migration: enumerate every non-session/3.0 Session and
          // migrate each one independently. A single failure is recorded in
          // its result entry and never interrupts the remaining Sessions;
          // both full success and partial failure surface in `result`.
          const results: MigrateAllResult[] = listLegacyV3MigrationCandidates(store).map(candidate => {
            try {
              if (!Object.hasOwn(expectedRevisions, candidate.session_id)) {
                throw new V3StructuredError(
                  'INVALID_ARGUMENT',
                  `expected revisions missing for Session ${candidate.session_id}`,
                );
              }
              const expected = expectedRevisions[candidate.session_id]!;
              applyV3Migration(store, loadLegacyV3MigrationInput(store, candidate.session_id), {
                actor_id: options.actor,
                request_id: options.requestId,
                reason: options.reason,
                evidence_refs: options.evidence,
                definition_of_done: options.definitionOfDone,
                expected_identity_revision: expected.identity_revision,
                expected_activity_revision: expected.activity_revision,
              });
              return {
                session_id: candidate.session_id,
                source_schema_version: candidate.source_schema_version,
                outcome: 'migrated' as const,
              };
            } catch (error) {
              return {
                session_id: candidate.session_id,
                source_schema_version: candidate.source_schema_version,
                outcome: 'failed' as const,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          });
          emitV3Success({ operation: 'session-migrate', sessionId: null, result: results });
          return;
        }
        if (options.session === undefined) {
          throw new Error('one of --session or --all is required');
        }
        const record = store.readSessionRecord(options.session);
        const result = record.schema_version === 'session/3.0'
          ? readAppliedV3Migration(store, options.session)
          : (() => {
            if (options.expectedRevisions !== undefined) {
              throw new Error('--expected-revisions can only be used with --all');
            }
            const expected = requiredSingleMigrationRevisions(options);
            return applyV3Migration(store, loadLegacyV3MigrationInput(store, options.session!), {
              actor_id: options.actor,
              request_id: options.requestId,
              reason: options.reason,
              evidence_refs: options.evidence,
              definition_of_done: options.definitionOfDone,
              expected_identity_revision: expected.identity_revision,
              expected_activity_revision: expected.activity_revision,
            });
          })();
        emitV3Success({ operation: 'session-migrate', sessionId: options.session, result });
      } catch (error) {
        emitV3Error('session-migrate', error, { session: options.session });
      }
    });

  for (const [name, operation, target] of [
    ['archive', 'session-archive', 'archived'],
    ['unarchive', 'session-unarchive', 'open'],
  ] as const) {
    addV3MutationOptions(session.command(name).description(`${name} a Session`), 'orchestration')
      .action((options: V3CommonOptions) => {
        try {
          const { store, options: resolved } = resolveV3Options(options);
          const mutation = mutateSessionStatusV3(store, resolved, target, operation);
          emitV3Success({ operation, sessionId: resolved.session, requestId: resolved.requestId,
            result: mutation.transition.result, mutation });
        } catch (error) {
          emitV3Error(operation, error, { session: options.session, requestId: options.requestId });
        }
      });
  }

  addV3MutationOptions(session.command('complete').description('Complete a Session'), 'orchestration')
    .action((options: V3CommonOptions) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const mutation = completeSessionV3(store, {
          ...mutationIdentity(resolved),
          expectedOrchestrationRevision: resolved.expectedOrchestrationRevision!,
        });
        emitV3Success({ operation: 'session-complete', sessionId: resolved.session,
          requestId: resolved.requestId, result: mutation.transition.result, mutation });
        // child-reap：按 maestro session 归因回收其 delegate/team 资源（best-effort，不影响完成结果）
        void import('../async/child-reap.js')
          .then(({ reapBestEffort }) => reapBestEffort({ host: 'maestro', hostSessionId: resolved.session, maestroSessionId: resolved.session }))
          .catch(() => { /* best-effort */ });
      } catch (error) {
        emitV3Error('session-complete', error, { session: options.session, requestId: options.requestId });
      }
    });

  addV3ReadOptions(session.command('status').description('Read Session status'))
    .action((options: { session?: string; workflowRoot: string }) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const state = store.readSessionV30(resolved.session);
        emitV3Success({ operation: 'session-status', sessionId: resolved.session, result: state });
      } catch (error) {
        emitV3Error('session-status', error, { session: options.session });
      }
    });

  addV3ReadOptions(session.command('list').description('List session/3.0 Sessions'))
    .action((options: { session?: string; workflowRoot: string }) => {
      try {
        const store = v3Store(options);
        const sessions = listV3Sessions(store)
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at)
            || left.session_id.localeCompare(right.session_id))
          .map(item => ({
            session_id: item.session_id,
            status: item.status,
            objective: item.objective,
            orchestration_revision: item.orchestration_revision,
            activity_revision: item.activity_revision,
            active_run_ids: [...item.active_run_ids].sort(),
            updated_at: item.updated_at,
          }));
        emitV3Success({ operation: 'session-list', sessionId: null, result: sessions });
      } catch (error) {
        emitV3Error('session-list', error, { session: options.session });
      }
    });

  addV3ReadOptions(session.command('resume-view').description('Project ResumeMapV1'))
    .action((options: { session?: string; workflowRoot: string }) => {
      try {
        const { store, options: resolved } = resolveV3Options(options);
        const state = store.readSessionV30(resolved.session);
        const runs = readRuns(resolved, state);
        const artifacts = store.readJsonFileReadOnly(
          resolve(store.sessionDir(resolved.session), state.artifacts_ref),
          artifactRegistrySchema,
        );
        const pendingPublications = Object.entries(artifacts.artifacts)
          .filter(([, artifact]) => artifact.status === 'draft')
          .map(([artifactId, artifact]) => ({ publicationId: artifactId, resourceUri: artifact.relative_path }));
        const map = projectResumeMapV1({
          session: state,
          runs,
          blockingGates: [],
          openDecisions: state.decisions.filter(item => item.status !== 'resolved').map(item => item.decision_id),
          pendingPublications,
          nextActions: [
            ...runs.map(item => ({ action: 'run-check', targetId: item.run_id, expectedRevision: item.revision })),
            ...pendingPublications.map(publication => ({
              action: 'publication-review', targetId: publication.publicationId, expectedRevision: artifacts.revision,
            })),
            { action: 'session-status', targetId: state.session_id, expectedRevision: state.orchestration_revision },
          ],
        });
        emitV3Success({ operation: 'session-resume-view', sessionId: resolved.session, result: map });
      } catch (error) {
        emitV3Error('session-resume-view', error, { session: options.session });
      }
    });

  const chain = session.command('chain').description('Inspect or mutate the Session chain');
  addV3MutationOptions(chain.command('insert').description('Insert a pending chain step'), 'orchestration')
    .requiredOption('--step-id <id>', 'new chain step ID')
    .requiredOption('--command <name>', 'step command')
    .option('--arg <value>', 'step argument (repeatable)', (value, previous: string[] = []) => [...previous, value], [])
    .option('--after-step <id>', 'insert after this step; default appends')
    .option('--goal-ref <id>', 'chain step goal reference')
    .option('--stage <name>', 'chain step stage')
    .option('--decision-ref <id>', 'post-step decision gate; resolve it before advancing past the completed step')
    .action(chainMutationAction('session-chain-insert', options => ({
      kind: 'insert', stepId: options.stepId, command: options.command!, args: options.arg ?? [],
      afterStepId: options.afterStep ?? null, goalRef: options.goalRef ?? null, stage: options.stage ?? null,
      decisionRef: options.decisionRef ?? null,
    })));

  addV3MutationOptions(chain.command('skip').description('Skip a non-running chain step with evidence'), 'orchestration')
    .requiredOption('--step-id <id>', 'chain step ID')
    .action(chainMutationAction('session-chain-skip', options => ({ kind: 'skip', stepId: options.stepId })));

  addV3MutationOptions(chain.command('replace').description('Replace a non-running chain step command'), 'orchestration')
    .requiredOption('--step-id <id>', 'chain step ID')
    .requiredOption('--command <name>', 'replacement command')
    .option('--arg <value>', 'replacement argument (repeatable)', (value, previous: string[] = []) => [...previous, value], [])
    .action(chainMutationAction('session-chain-replace', options => ({
      kind: 'replace', stepId: options.stepId, command: options.command!, args: options.arg ?? [],
    })));

  addV3MutationOptions(chain.command('update')
    .description('Update supplied metadata on a pending chain step; omitted fields are preserved and clearing is unsupported'), 'orchestration')
    .requiredOption('--step-id <id>', 'chain step ID')
    .option('--command <name>', 'new step command')
    .option('--arg <value>', 'new step argument (repeatable; supplying args replaces the existing args)', (value, previous: string[] = []) => [...previous, value])
    .option('--goal-ref <id>', 'new chain step goal reference')
    .option('--stage <name>', 'new chain step stage')
    .option('--decision-ref <id>', 'new post-step decision gate; must be missing or open')
    .action(chainMutationAction('session-chain-update', options => ({
      kind: 'update', stepId: options.stepId, command: options.command, args: options.arg,
      goalRef: options.goalRef, stage: options.stage, decisionRef: options.decisionRef,
    })));

}
