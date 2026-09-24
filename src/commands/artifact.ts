import type { Command } from 'commander';
import { resolve } from 'node:path';

import { inspectArtifactCompatibility } from '../run/artifact-compatibility.js';
import { createRunResponseSuccess, emitRunResponse } from '../run/response.js';
import { republishArtifactLegacy } from '../run/runtime.js';
import { SessionStore } from '../run/store.js';
import { republishArtifactV3 } from '../run/v3/mutation-engine.js';
import {
  applyV3MutationIdentityDefaults,
  assertV3ParticipantIdentity,
  collectV3,
  emitV3Error,
  emitV3Success,
  parseV3Revision,
} from './v3-cli-shared.js';

interface ArtifactReadOptions {
  session: string;
  consumer: string;
  alias: string;
  json: boolean;
  workflowRoot: string;
}

interface ArtifactRepublishCliOptions extends ArtifactReadOptions {
  assessmentHash: string;
  requestId: string;
  expectedArtifactRevision: number;
  expectedOrchestrationRevision?: number;
  /** @deprecated alias of --expected-orchestration-revision */
  expectedSessionRevision?: number;
  participant: string;
  actor: string;
  reason: string;
  evidence: string[];
}

function artifactRoot(program: Command): Command {
  return program.command('artifact').description('Inspect and republish Artifact compatibility authority');
}

function addReadOptions(command: Command): Command {
  return command
    .requiredOption('--session <id>', 'exact Session ID')
    .requiredOption('--consumer <command>', 'exact consumer command')
    .requiredOption('--alias <alias>', 'exact consumer alias slot')
    .requiredOption('--json', 'emit run-response/1.2 JSON')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd());
}

export function registerArtifactCommand(program: Command): void {
  const artifact = artifactRoot(program);
  addReadOptions(artifact.command('inspect <artifact-id>').description('Assess one Artifact against an exact consumer slot'))
    .action((artifactId: string, options: ArtifactReadOptions) => {
      try {
        const projectRoot = resolve(options.workflowRoot);
        const assessment = inspectArtifactCompatibility(projectRoot, {
          sessionId: options.session,
          artifactId,
          consumerCommand: options.consumer,
          alias: options.alias,
        });
        emitRunResponse(createRunResponseSuccess({
          schema_version: 'run-response/1.2',
          operation: 'artifact-inspect',
          request_id: null,
          locator: { session_id: options.session, run_id: assessment.source.producer_run_id },
          revision: {
            target_type: 'artifact',
            target_id: artifactId,
            revision: assessment.source.artifact_registry_revision,
          },
          replay: null,
          warnings: [],
          result: assessment,
        }));
      } catch (error) {
        emitV3Error('artifact-inspect', error, { session: options.session });
      }
    });

  addReadOptions(artifact.command('republish <artifact-id>').description('Publish audited compatibility authority without rewriting the source'))
    .requiredOption('--assessment-hash <sha256>', 'exact inspect assessment hash')
    .option('--request-id <id>', 'idempotency request ID (default: derived from the invocation)')
    .requiredOption('--expected-artifact-revision <n>', 'expected Artifact registry revision', parseV3Revision)
    .option('--expected-orchestration-revision <n>', 'expected Session orchestration revision', parseV3Revision)
    .option('--expected-session-revision <n>', 'deprecated alias of --expected-orchestration-revision', parseV3Revision)
    .option('--participant <id>', 'participant performing the mutation (default: --actor)')
    .option('--actor <id>', 'authorized actor (default: $MAESTRO_ACTOR)')
    .option('--reason <text>', 'audit reason (default: cli:<command>)')
    .option('--evidence <ref>', 'evidence reference (repeatable)', collectV3, [])
    .hook('preAction', applyV3MutationIdentityDefaults)
    .action((artifactId: string, options: ArtifactRepublishCliOptions) => {
      try {
        assertV3ParticipantIdentity(options);
        const expectedSessionRevision = options.expectedOrchestrationRevision ?? options.expectedSessionRevision;
        if (expectedSessionRevision === undefined) {
          throw new Error('--expected-orchestration-revision is required');
        }
        const projectRoot = resolve(options.workflowRoot);
        const store = new SessionStore(projectRoot);
        const common = {
          sessionId: options.session,
          artifactId,
          consumerCommand: options.consumer,
          alias: options.alias,
          assessmentHash: options.assessmentHash,
          requestId: options.requestId,
          expectedArtifactRevision: options.expectedArtifactRevision,
          expectedSessionRevision,
          participantId: options.participant,
          actorId: options.actor,
          reason: options.reason,
          evidenceRefs: options.evidence,
        };
        if (store.sessionSchemaSelection().writer === 'session/3.0') {
          const mutation = republishArtifactV3(store, common);
          emitV3Success({
            operation: 'artifact-republish',
            sessionId: options.session,
            runId: null,
            requestId: options.requestId,
            result: mutation.transition.result,
            mutation,
          });
          return;
        }
        const result = republishArtifactLegacy(projectRoot, common);
        emitRunResponse(createRunResponseSuccess({
          schema_version: 'run-response/1.2',
          operation: 'artifact-republish',
          request_id: options.requestId,
          locator: { session_id: options.session, run_id: result.compatibility_run_id },
          revision: {
            target_type: 'artifact',
            target_id: result.artifact_id,
            revision: result.artifact_registry_revision,
          },
          replay: result.replay,
          warnings: [],
          result,
        }));
      } catch (error) {
        emitV3Error('artifact-republish', error, {
          session: options.session,
          requestId: options.requestId,
        });
      }
    });
}
