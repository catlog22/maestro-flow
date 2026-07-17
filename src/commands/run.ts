import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  briefRun,
  checkRun,
  completeRun,
  completeRunWithVerdict,
  createRun,
  prepareStep,
  skillContent,
  sealSession,
  type CompletionVerdict,
} from '../run/runtime.js';
import { runNextStep } from '../run/next.js';
import { resolveRunningRun } from '../run/resolve.js';
import { runDecide, type DecisionConfidence, type DecisionVerdict } from '../run/decide.js';
import { checkLease } from '../run/lease.js';
import { SessionStore } from '../run/store.js';
import { logMutation, readLedger } from '../run/mutation-ledger.js';
import type { TargetPlatform } from '../core/skill-converter.js';

const VALID_VERDICTS: CompletionVerdict[] = ['done', 'done-with-concerns', 'needs-retry', 'blocked'];

/** Normalise a --verdict token: lowercase, accept DONE_WITH_CONCERNS spellings. */
function parseVerdict(raw: string | undefined): CompletionVerdict | null {
  if (!raw) return 'done';
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
  return (VALID_VERDICTS as string[]).includes(normalized) ? (normalized as CompletionVerdict) : null;
}

const VALID_PLATFORMS: TargetPlatform[] = ['claude', 'codex', 'agy', 'agents-standard', 'pi'];

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function reportError(error: unknown): void {
  console.error(`[maestro run] ${(error as Error).message}`);
  process.exitCode = 1;
}

export function registerRunCommand(program: Command): void {
  const run = program
    .command('run')
    .description('Manage canonical Session/Run lifecycle');

  run
    .command('prepare <step>')
    .description('Return prepare file + workflow metadata for pre-task thinking (read-only, stateless)')
    .option('--session <id>', 'attach prior-step context from a Session (read-only)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .action((step: string, opts: { session?: string; workflowRoot: string; platform?: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        print(prepareStep(resolve(opts.workflowRoot), step, platform, opts.session));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('next')
    .description('Advance a Session chain: create the next pending Run and emit a compact birth packet')
    .option('--session <id>', 'explicit Session ID')
    .option('--pick <step-id>', 'advance a specific pending execution step instead of the queue head')
    .option('--json', 'emit structured JSON instead of the human-readable birth packet')
    .option('--execution-owner <owner>', 'lease execution owner (checked against session.orchestration.lease)')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: {
      session?: string;
      pick?: string;
      json?: boolean;
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      workflowRoot: string;
    }) => {
      try {
        const outcome = runNextStep(resolve(opts.workflowRoot), {
          sessionId: opts.session,
          pick: opts.pick,
          json: opts.json,
          executionOwner: opts.executionOwner,
          ownerEpoch: opts.ownerEpoch,
          leaseId: opts.leaseId,
        });
        const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
        stream.write(outcome.message + '\n');
        if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('create <command> [args...]')
    .description('Create a Run in an existing or new Session')
    .option('--session <id>', 'explicit Session ID')
    .option('--intent <text>', 'intent used when creating a Session')
    .option('--parent-run <id>', 'parent Run ID for retries')
    .option('--arg <value>', 'command argument (repeatable)', collect, [])
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((command: string, positionalArgs: string[], opts: {
      session?: string;
      intent?: string;
      parentRun?: string;
      arg: string[];
      workflowRoot: string;
    }) => {
      try {
        print(createRun({
          projectRoot: resolve(opts.workflowRoot),
          command,
          sessionId: opts.session,
          intent: opts.intent,
          parentRunId: opts.parentRun,
          args: [...opts.arg, ...positionalArgs],
        }));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('check <run-id>')
    .description('Idempotently scan outputs and evaluate Run gates')
    .option('--session <id>', 'explicit Session ID')
    .option('--stage <stage>', 'compatibility hint: entry or exit', 'exit')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runId: string, opts: { session?: string; workflowRoot: string }) => {
      try {
        print(checkRun(resolve(opts.workflowRoot), runId, opts.session));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('complete [run-id]')
    .description('Seal a Run and advance its chain step by verdict (免参: resolves the active step)')
    .option('--session <id>', 'explicit Session ID')
    .option('--verdict <verdict>', `chain-advance verdict: ${VALID_VERDICTS.join('|')} (default done)`)
    .option('--summary <text>', 'handoff.summary fallback when the report frontmatter left it empty')
    .option('--reason <text>', 'blocker reason (blocked) merged into handoff concerns')
    .option('--note <text>', 'supplementary concern merged into the handoff (repeatable)', collect, [])
    .option('--decision <text>', 'decision appended to handoff.decisions (repeatable)', collect, [])
    .option('--evidence <path>', 'run-relative evidence path registered as an artifact (repeatable)', collect, [])
    .option('--artifact <path>', 'run-relative path registered as evidence beyond the outputs scan (repeatable)', collect, [])
    .option('--execution-owner <owner>', 'lease execution owner (checked against session.orchestration.lease)')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runIdArg: string | undefined, opts: {
      session?: string;
      verdict?: string;
      summary?: string;
      reason?: string;
      note: string[];
      decision: string[];
      evidence: string[];
      artifact: string[];
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      workflowRoot: string;
    }) => {
      try {
        const projectRoot = resolve(opts.workflowRoot);

        // Backward-compatible fast path: an explicit run-id with no verbs stays on
        // the plain seal path (identical to the pre-M2 behaviour). Any verdict, or
        // 免参 (no run-id), routes through the chain-driving verdict path.
        const verbless = !opts.verdict && (opts.decision?.length ?? 0) === 0
          && (opts.evidence?.length ?? 0) === 0 && !opts.reason
          && !opts.executionOwner && !opts.leaseId && opts.ownerEpoch === undefined;
        if (runIdArg && verbless) {
          const result = completeRun(projectRoot, runIdArg, opts.session, {
            notes: opts.note,
            extraArtifacts: opts.artifact,
            summaryFallback: opts.summary,
          });
          print(result);
          if (!result.sealed) process.exitCode = 1;
          return;
        }

        const verdict = parseVerdict(opts.verdict);
        if (!verdict) {
          console.error(`[maestro run] invalid --verdict "${opts.verdict}"; valid: ${VALID_VERDICTS.join(', ')}`);
          process.exitCode = 2;
          return;
        }

        // Resolve the target run + session. 免参 uses the active chain step; an
        // explicit run-id needs its session located for the lease + chain drive.
        const store = new SessionStore(projectRoot);
        let sessionId: string;
        let runId: string;
        if (runIdArg) {
          const located = store.findRun(runIdArg, opts.session);
          sessionId = located.sessionId;
          runId = runIdArg;
        } else {
          const resolved = resolveRunningRun(projectRoot, store, opts.session);
          if (resolved.kind === 'error') {
            console.error(resolved.message);
            process.exitCode = 1;
            return;
          }
          sessionId = resolved.sessionId;
          runId = resolved.step.run_id;
        }

        // Lease guard — mirrors the ralph rejection path (exit 1, "lease conflict").
        const lease = store.readBundle(sessionId).session.orchestration.lease;
        const conflict = checkLease(lease, {
          executionOwner: opts.executionOwner,
          ownerEpoch: opts.ownerEpoch,
          leaseId: opts.leaseId,
        });
        if (conflict) {
          console.error(`[maestro run] ${conflict}`);
          process.exitCode = 1;
          return;
        }

        const result = completeRunWithVerdict(projectRoot, runId, sessionId, {
          verdict,
          notes: opts.note,
          decisions: opts.decision,
          extraArtifacts: [...opts.artifact, ...opts.evidence],
          summaryFallback: opts.summary,
          reason: opts.reason,
          leaseClaim: {
            executionOwner: opts.executionOwner,
            ownerEpoch: opts.ownerEpoch,
            leaseId: opts.leaseId,
          },
        });
        print(result);
        process.stderr.write(`next: ${result.next.command}\n      ${result.next.reason}\n`);
        if (!result.run_sealed) process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('brief <run-id>')
    .description('Return Resume Packet for a running Run (re-attach workflow + goals + gate status)')
    .option('--session <id>', 'explicit Session ID')
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((runId: string, opts: { session?: string; platform?: string; workflowRoot: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        print(briefRun(resolve(opts.workflowRoot), runId, opts.session, platform));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('skill <step>')
    .description('Load prepare + workflow content for a step (stateless, no Session)')
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((step: string, opts: { platform?: string; workflowRoot: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        print(skillContent(resolve(opts.workflowRoot), step, platform));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('decide <point-id>')
    .description('Record a decision point verdict and advance the chain (evaluation stays in the prompt layer)')
    .requiredOption('--session <id>', 'Session ID')
    .requiredOption('--verdict <verdict>', 'decision verdict: proceed|fix|escalate')
    .requiredOption('--confidence <level>', 'evaluation confidence: high|medium|low')
    .option('--summary <text>', 'one-line rationale, recorded in decisions.ndjson + evidence_ref fallback')
    .option('--evidence <path>', 'evidence path/reference recorded on decision_point.evidence_ref')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((pointId: string, opts: {
      session: string;
      verdict: string;
      confidence: string;
      summary?: string;
      evidence?: string;
      workflowRoot: string;
    }) => {
      try {
        const verdict = opts.verdict.trim().toLowerCase();
        if (!['proceed', 'fix', 'escalate'].includes(verdict)) {
          console.error(`[maestro run] invalid --verdict "${opts.verdict}"; valid: proceed, fix, escalate`);
          process.exitCode = 2;
          return;
        }
        const confidence = opts.confidence.trim().toLowerCase();
        if (!['high', 'medium', 'low'].includes(confidence)) {
          console.error(`[maestro run] invalid --confidence "${opts.confidence}"; valid: high, medium, low`);
          process.exitCode = 2;
          return;
        }
        const result = runDecide(resolve(opts.workflowRoot), opts.session, pointId, {
          verdict: verdict as DecisionVerdict,
          confidence: confidence as DecisionConfidence,
          summary: opts.summary,
          evidence: opts.evidence,
        });
        print(result);
        process.stderr.write(`next: ${result.next.command}\n      ${result.next.reason}\n`);
        if (result.retry?.exhausted) {
          process.stderr.write(
            `warning: decision point ${pointId} retry ${result.retry.count}/${result.retry.max} exhausted `
            + `— the orchestrator (FSM) decides whether to force escalate\n`,
          );
        }
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('seal-session <session-id>')
    .description('Seal a Session after all Runs and Session gates are complete')
    .option('--summary <text>', 'human-readable seal summary', '')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string, opts: { summary: string; workflowRoot: string }) => {
      try {
        print(sealSession(resolve(opts.workflowRoot), sessionId, opts.summary));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('log-mutation <target>')
    .description('Record an out-of-run file mutation to the mutations ledger')
    .requiredOption('--actor <name>', 'command or hook that performed the mutation')
    .option('--type <type>', 'mutation type: write|append|delete|patch', 'write')
    .option('--hash <hash>', 'content hash of the written file')
    .option('--run-id <id>', 'associated run ID (if within a run)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((target: string, opts: { actor: string; type: string; hash?: string; runId?: string; workflowRoot: string }) => {
      try {
        if (!['write', 'append', 'delete', 'patch'].includes(opts.type)) {
          throw new Error(`invalid mutation type "${opts.type}" (write|append|delete|patch)`);
        }
        const root = resolve(opts.workflowRoot);
        logMutation(root, opts.actor, resolve(root, target), {
          contentHash: opts.hash,
          mutationType: opts.type as 'write' | 'append' | 'delete' | 'patch',
          runId: opts.runId,
        });
        print({ status: 'ok', target, actor: opts.actor });
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('mutations')
    .description('List recorded out-of-run mutations')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .option('--json', 'emit raw JSON lines')
    .action((opts: { workflowRoot: string; json?: boolean }) => {
      try {
        const entries = readLedger(resolve(opts.workflowRoot));
        if (opts.json) {
          for (const entry of entries) console.log(JSON.stringify(entry));
        } else {
          if (entries.length === 0) { console.log('No mutations recorded.'); return; }
          for (const entry of entries) {
            console.log(`${entry.timestamp}  ${entry.actor.padEnd(20)}  ${entry.mutation_type.padEnd(7)}  ${entry.target}`);
          }
        }
      } catch (error) {
        reportError(error);
      }
    });
}
