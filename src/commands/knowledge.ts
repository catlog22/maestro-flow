import type { Command } from 'commander';
import { appendFileSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import {
  recordRunKnowledgeInputs,
  readSessionKnowledgeReconciliation,
  stageRunKnowledgeCandidate,
  summarizeSessionKnowledge,
  type KnowledgeExecutionAuthority,
  type KnowledgeInputSignal,
} from '../run/knowledge.js';
import {
  recordSessionKnowledgeInputs,
  stageSessionKnowledgeCandidate,
} from '../run/session-knowledge.js';
import {
  buildTranscriptUri,
  quoteSha256,
  renderTranscriptEvidence,
  storeTranscriptEvidence,
  transcriptQuoteInputSchema,
} from '../run/transcript-evidence.js';
import { resolveWriteAuthority } from '../run/knowledge-identity.js';
import { auditKnowledge, type KnowledgeAuditScope } from '../knowledge/audit.js';
import {
  applyKnowledgeNormalization,
  planKnowledgeNormalization,
  writeKnowledgeNormalizationReport,
  type KnowledgeNormalizeScope,
} from '../knowledge/normalize.js';
import { SessionStore } from '../run/store.js';
import {
  persistActiveKnowledgeReconciliation,
  persistKnowledgeReconciliation,
  persistSessionKnowledgeReconciliation,
  promoteReconciledSessionKnowledge,
  currentKnowledgeCorpusFingerprint,
  ensureKnowledgeReconciliation,
  ensureSessionKnowledgeReconciliation,
  isKnowledgeReconciliationFresh,
  isSessionKnowledgeReconciliationFresh,
  readKnowledgeReconciliation,
  reconcileRunKnowledge,
  resolveKnowledgeCandidate,
  type KnowledgeResolutionChoice,
} from '../knowledge/reconcile.js';
import type {
  KnowledgeCandidateReconciliation,
} from '../knowledge/reconciliation-schema.js';
import { readReportFrontmatter } from '../run/report.js';
import {
  resolveRepositorySelectorIds,
} from '../repository/context.js';
import {
  EXECUTION_OWNER_KINDS,
  parseNonNegativeInteger,
  parseOwnerKind,
  parsePositiveInteger,
  type ExecutionOwnerKind,
} from './execution-cli-shared.js';

const KNOWLEDGE_INPUT_SIGNALS = ['consumed', 'cited', 'validated', 'contradicted'] as const;
const KNOWLEDGE_CANDIDATE_TARGETS = ['spec', 'knowhow'] as const;
const KNOWLEDGE_CANDIDATE_ACTIONS = ['propose', 'reaffirm', 'supersede', 'contest'] as const;
const KNOWLEDGE_RESOLUTIONS = ['duplicate', 'related', 'conflict', 'supersede', 'unique'] as const;
/** Attribution sources exposed for explicit recording (injection stays automatic-only). */
const KNOWLEDGE_INPUT_SOURCES = ['search', 'load', 'manual'] as const;
const EXECUTION_AUTHORITY_FILE_ENV = 'MAESTRO_EXECUTION_AUTHORITY_FILE';

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

interface KnowledgeExecutionOptions {
  execution?: string;
  generation?: number;
  requestId?: string;
  expectedExecutionRevision?: number;
  ownerId?: string;
  ownerKind?: ExecutionOwnerKind;
  leaseEpoch?: number;
  leaseId?: string;
  executionAuthority?: string;
}

const knowledgeExecutionAuthorityFileSchema = z.object({
  schema_version: z.literal('knowledge-execution-authority/1.0').optional(),
  session_id: z.string().min(1),
  execution_id: z.string().min(1),
  generation: z.number().int().positive(),
  run_id: z.string().min(1),
  request_id: z.string().min(1),
  expected_execution_revision: z.number().int().nonnegative(),
  owner_id: z.string().min(1),
  owner_kind: z.enum(EXECUTION_OWNER_KINDS),
  lease_epoch: z.number().int().positive(),
  lease_id: z.string().min(1),
}).strict();

function suppliedExecutionFields(options: KnowledgeExecutionOptions): Array<[string, unknown]> {
  return [
    ['--execution', options.execution],
    ['--generation', options.generation],
    ['--request-id', options.requestId],
    ['--expected-execution-revision', options.expectedExecutionRevision],
    ['--owner-id', options.ownerId],
    ['--owner-kind', options.ownerKind],
    ['--lease-epoch', options.leaseEpoch],
    ['--lease-id', options.leaseId],
  ];
}

function resolveKnowledgeExecutionAuthority(
  projectRoot: string,
  options: KnowledgeExecutionOptions,
  target: { sessionId: string; runId: string },
  required: boolean,
): KnowledgeExecutionAuthority | undefined {
  const authorityFile = options.executionAuthority ?? process.env[EXECUTION_AUTHORITY_FILE_ENV];
  const explicitFields = suppliedExecutionFields(options);
  const explicitAttempt = explicitFields.some(([, value]) => value !== undefined && value !== '');
  if (authorityFile && explicitAttempt) {
    throw new Error('Use either --execution-authority / MAESTRO_EXECUTION_AUTHORITY_FILE or the explicit Execution flag tuple, not both');
  }

  if (authorityFile) {
    const path = resolve(projectRoot, authorityFile);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Execution authority path must be a regular non-symlink file: ${path}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid Execution authority JSON at ${path}: ${(error as Error).message}`);
    }
    const parsed = knowledgeExecutionAuthorityFileSchema.parse(raw);
    if (parsed.session_id !== target.sessionId || parsed.run_id !== target.runId) {
      throw new Error(
        `Execution authority file targets ${parsed.session_id}/${parsed.run_id}, `
        + `not ${target.sessionId}/${target.runId}`,
      );
    }
    return {
      executionId: parsed.execution_id,
      generation: parsed.generation,
      requestId: parsed.request_id,
      expectedExecutionRevision: parsed.expected_execution_revision,
      lease: {
        ownerId: parsed.owner_id,
        ownerKind: parsed.owner_kind,
        epoch: parsed.lease_epoch,
        leaseId: parsed.lease_id,
      },
    };
  }

  if (!explicitAttempt) {
    if (!required) return undefined;
    throw new Error(
      `Run ${target.runId} is Execution-bound and requires exact sidecar authority. `
      + 'Pass --execution, --generation, --request-id, --expected-execution-revision, '
      + '--owner-id, --owner-kind, --lease-epoch, and --lease-id; or use '
      + `--execution-authority <private-json> / ${EXECUTION_AUTHORITY_FILE_ENV}.`,
    );
  }
  const missing = explicitFields
    .filter(([, value]) => value === undefined || value === '')
    .map(([flag]) => flag);
  if (missing.length > 0) {
    throw new Error(`Execution-bound knowledge mutation requires ${missing.join(', ')}`);
  }
  return {
    executionId: options.execution!,
    generation: options.generation!,
    requestId: options.requestId!,
    expectedExecutionRevision: options.expectedExecutionRevision!,
    lease: {
      ownerId: options.ownerId!,
      ownerKind: options.ownerKind!,
      epoch: options.leaseEpoch!,
      leaseId: options.leaseId!,
    },
  };
}

function signalExecutionAuthority(authority: KnowledgeExecutionAuthority): KnowledgeExecutionAuthority {
  return { ...authority, requestId: `${authority.requestId}-signal` };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// K8 — signal-id existence validation (wiki index, alias-tolerant resolver)
// ---------------------------------------------------------------------------

/**
 * Validate knowledge IDs against the wiki index before they enter any ledger.
 * Unknown IDs are rejected unless --allow-unknown is passed, in which case a
 * degraded-marker JSONL trail is written for audit (ghost IDs must never
 * silently pollute the health contest queue).
 */
async function validateKnowledgeSignalIds(
  projectRoot: string,
  ids: string[],
  allowUnknown: boolean | undefined,
): Promise<void> {
  const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const { withWikiIndexer, findEntry } = await import('./load.js');
  const unknown = await withWikiIndexer(projectRoot, async indexer => {
    const index = await indexer.get();
    return unique.filter(id => !findEntry(index, id));
  });
  if (unknown.length === 0) return;
  if (!allowUnknown) {
    throw new Error(
      `Unknown knowledge ID(s): ${unknown.join(', ')} — no match in the wiki index. `
      + 'Use --allow-unknown to record them with a degraded marker.',
    );
  }
  const dir = join(projectRoot, '.workflow', 'tmp');
  mkdirSync(dir, { recursive: true });
  const trailPath = join(dir, 'knowledge-unknown-signals.jsonl');
  const now = new Date().toISOString();
  const actor = process.env.USER ?? process.env.USERNAME ?? 'unknown';
  const lines = unknown.map(id => JSON.stringify({
    schema_version: 'knowledge-unknown-signal/1.0',
    raw_id: id,
    actor,
    reason: 'wiki-index-miss',
    recorded_at: now,
  }));
  appendFileSync(trailPath, `${lines.join('\n')}\n`, 'utf8');
}

type KnowledgeSessionView = ReturnType<typeof buildKnowledgeSessionView>;

function uniqueRunIds(
  candidates: ReturnType<typeof summarizeSessionKnowledge>['candidates'],
): string[] {
  return [...new Set(candidates.flatMap(candidate => candidate.run_ids))].sort();
}

function resolutionChoices(
  candidateId: string,
  sessionId: string,
  policy: KnowledgeCandidateReconciliation,
): string[] {
  if (policy.promotion_eligibility !== 'review_required') return [];
  const target = policy.canonical_id ?? policy.matches[0]?.knowledge_id;
  // Happy path (§11): inline adjudication + promotion is a single promote
  // --resolve call (TOCTOU fence + resolve + promote). review --resolve stays
  // available as a compatible fallback but is deprecated.
  const base = `maestro knowledge promote ${sessionId} --resolve ${candidateId}`;
  const withTarget = (choice: string): string =>
    `${base} --as ${choice}${target ? ` --target ${target}` : ''} --reason "<reason>"`;
  switch (policy.disposition) {
    case 'semantic_duplicate':
      return [withTarget('duplicate'), withTarget('related'), `${base} --as unique --reason "<reason>"`];
    case 'potential_conflict':
      return [withTarget('conflict'), withTarget('related'), `${base} --as unique --reason "<reason>"`];
    case 'supersede_candidate':
      return [withTarget('supersede'), withTarget('related'), `${base} --as unique --reason "<reason>"`];
    case 'extends':
    case 'related':
      return [withTarget('related'), withTarget('supersede'), `${base} --as unique --reason "<reason>"`];
    default:
      return [];
  }
}

function buildKnowledgeSessionView(projectRoot: string, sessionId: string) {
  const summary = summarizeSessionKnowledge(projectRoot, sessionId);
  const store = new SessionStore(projectRoot);
  const expectedCorpusFingerprint = currentKnowledgeCorpusFingerprint(projectRoot);
  const receiptByRun = new Map(uniqueRunIds(summary.candidates).map(runId => {
    const receipt = readKnowledgeReconciliation(store, sessionId, runId, true);
    const fresh = receipt
      ? isKnowledgeReconciliationFresh(
          projectRoot,
          sessionId,
          runId,
          receipt,
          readReportFrontmatter(store.runDir(sessionId, runId)),
          expectedCorpusFingerprint,
        )
      : false;
    return [runId, { receipt, fresh }] as const;
  }));
  // Session-level receipt state for origin=session candidates (K7a).
  const sessionReceipt = readSessionKnowledgeReconciliation(store, sessionId, true);
  const sessionFresh = sessionReceipt
    ? isSessionKnowledgeReconciliationFresh(projectRoot, sessionId, sessionReceipt, expectedCorpusFingerprint)
    : false;
  const candidates = summary.candidates.map(candidate => {
    if ((candidate.origin ?? 'run') === 'session') {
      const policy = sessionReceipt?.candidates.find(
        item => item.candidate_id === candidate.candidate_id,
      ) ?? null;
      // Per-candidate fence: the session receipt's source list records
      // candidates that failed immutable-source revalidation as blocked.
      // They stay visible but are excluded from promotion (and no refresh
      // can repair them — the fix is a source-side restage).
      const sessionSourceEntry = sessionReceipt?.session_source?.candidates.find(
        item => item.candidate_id === candidate.candidate_id,
      ) ?? null;
      const blockedReason = sessionSourceEntry?.status === 'blocked'
        ? sessionSourceEntry.block_reason
        : null;
      const freshness = blockedReason
        ? 'blocked' as const
        : !policy
          ? 'missing' as const
          : sessionFresh ? 'fresh' as const : 'stale' as const;
      const reconcileCommands = blockedReason
        ? []
        : !policy || !sessionFresh
          ? [`maestro knowledge review ${sessionId} --refresh`]
          : [];
      return {
        ...candidate,
        reconciliation: policy ? { ...policy, freshness } : null,
        review: {
          freshness,
          reconcile_commands: reconcileCommands,
          resolution_commands: policy
            ? resolutionChoices(candidate.candidate_id, sessionId, policy)
            : [],
          ...(blockedReason ? { blocked_reason: blockedReason } : {}),
        },
      };
    }
    const reconciliation = candidate.run_ids.flatMap(runId => {
      const state = receiptByRun.get(runId);
      const policy = state?.receipt?.candidates
        .find(item => item.candidate_id === candidate.candidate_id);
      return policy ? [{ policy, fresh: state!.fresh, runId }] : [];
    });
    const selected = reconciliation.find(
      item => item.policy.promotion_eligibility === 'suppressed',
    ) ?? reconciliation.find(
      item => item.policy.promotion_eligibility === 'review_required',
    ) ?? reconciliation[0]
      ?? null;
    const allSourcesPresent = candidate.run_ids.every(runId => {
      const receipt = receiptByRun.get(runId)?.receipt;
      return receipt?.candidates.some(item => item.candidate_id === candidate.candidate_id) === true;
    });
    const freshness = !allSourcesPresent
      ? 'missing' as const
      : reconciliation.every(item => item.fresh)
        ? 'fresh' as const
        : 'stale' as const;
    // §11: reconcile is internal (auto-run by check); stale/missing run-source
    // receipts are repaired through review --refresh, mirroring the session
    // source branch above.
    const reconcileCommands = candidate.run_ids.some(runId => {
      const state = receiptByRun.get(runId);
      return !state?.receipt || !state.fresh
        || !state.receipt.candidates.some(item => item.candidate_id === candidate.candidate_id);
    })
      ? [`maestro knowledge review ${sessionId} --refresh`]
      : [];
    return {
      ...candidate,
      reconciliation: selected
        ? {
            ...selected.policy,
            freshness,
          }
        : null,
      review: {
        freshness,
        reconcile_commands: reconcileCommands,
        resolution_commands: selected
          ? resolutionChoices(candidate.candidate_id, sessionId, selected.policy)
          : [],
      },
    };
  });
  return { ...summary, candidates };
}

function printKnowledgeReview(view: KnowledgeSessionView, projectRoot: string): void {
  console.log(`Knowledge review: ${view.session_id}`);
  console.log(
    `${view.candidates.length} candidate(s) · `
    + `${view.candidates.filter(candidate => candidate.review.freshness === 'missing').length} missing · `
    + `${view.candidates.filter(candidate => candidate.review.freshness === 'stale').length} stale · `
    + `${view.candidates.filter(candidate => candidate.review.freshness === 'blocked').length} blocked · `
    + `${view.candidates.filter(candidate =>
      candidate.reconciliation?.promotion_eligibility === 'review_required'
    ).length} review required`,
  );
  for (const candidate of view.candidates) {
    const policy = candidate.reconciliation;
    console.log(
      `\n${candidate.candidate_id} [${candidate.stage}/${candidate.status}] `
      + `${candidate.target}:${candidate.category ?? 'uncategorized'} · ${candidate.title}`,
    );
    const body = candidate.content ?? '';
    const snippet = body.replace(/\s+/g, ' ').trim();
    if (snippet) console.log(`  content: ${snippet.slice(0, 140)}${snippet.length > 140 ? '…' : ''}`);
    if (candidate.evidence_refs?.length) {
      // K16 — transcript anchor URIs render as snapshot-present/absent with a
      // desensitized preview and the [untrusted] marker; other refs stay raw.
      const visible = candidate.evidence_refs.slice(0, 5).map(ref =>
        ref.startsWith('transcript:')
          ? renderTranscriptEvidence(ref, projectRoot, view.session_id).summary
          : ref,
      );
      console.log(`  evidence: ${visible.join(', ')}${candidate.evidence_refs.length > 5 ? ' …' : ''}`);
    }
    console.log(
      `  reconciliation: ${policy?.disposition ?? 'missing'}/`
      + `${policy?.promotion_eligibility ?? 'unavailable'} · ${candidate.review.freshness}`,
    );
    if (candidate.review.blocked_reason) {
      console.log(`  blocked: ${candidate.review.blocked_reason}`);
    }
    for (const match of policy?.matches.slice(0, 3) ?? []) {
      console.log(
        `  match: ${match.knowledge_id} [${match.relation}] `
        + `score ${match.scores.composite.toFixed(3)} · ${match.title}`,
      );
      for (const evidence of match.evidence.slice(0, 2)) console.log(`    evidence: ${evidence}`);
    }
    for (const command of candidate.review.reconcile_commands) console.log(`  next: ${command}`);
    for (const command of candidate.review.resolution_commands) console.log(`  resolve: ${command}`);
    if (!candidate.review.blocked_reason
      && policy?.promotion_eligibility === 'eligible'
      && candidate.status === 'pending') {
      console.log(
        `  promote: maestro knowledge promote ${view.session_id} --candidate ${candidate.candidate_id}`,
      );
    }
  }
}

/**
 * TOCTOU fence for inline resolution: refresh every run receipt and the
 * session receipt backing a candidate so resolution is never made against
 * stale evidence (mirrors promoteReconciledSessionKnowledge's ensure+persist
 * refresh in src/knowledge/reconcile.ts). Resolution and promotion happen in
 * the same promote --resolve invocation, so this fence closes the
 * "validated-against-old-corpus" window before the human decision is written.
 */
function refreshResolutionReceipts(
  projectRoot: string,
  sessionId: string,
  candidateIds: string[],
): void {
  const store = new SessionStore(projectRoot);
  const summary = summarizeSessionKnowledge(projectRoot, sessionId, {
    readOnly: true,
    strict: true,
  });
  const requested = new Set(candidateIds);
  const relevant = summary.candidates.filter(candidate =>
    requested.has(candidate.candidate_id)
  );
  const runIds = [...new Set(relevant.flatMap(candidate => candidate.run_ids))].sort();
  const expectedCorpusFingerprint = currentKnowledgeCorpusFingerprint(projectRoot);
  for (const runId of runIds) {
    const frontmatter = readReportFrontmatter(store.runDir(sessionId, runId));
    const receipt = ensureKnowledgeReconciliation(
      projectRoot,
      sessionId,
      runId,
      frontmatter,
      expectedCorpusFingerprint,
    );
    persistKnowledgeReconciliation(projectRoot, receipt);
  }
  // K7a: refresh the session receipt for session-origin candidates (same
  // TOCTOU fence position as the run refresh above).
  if (relevant.some(candidate => (candidate.origin ?? 'run') === 'session')) {
    const sessionReceipt = ensureSessionKnowledgeReconciliation(
      projectRoot,
      sessionId,
      expectedCorpusFingerprint,
    );
    persistSessionKnowledgeReconciliation(projectRoot, sessionReceipt);
  }
}

export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program
    .command('knowledge')
    .description('Inspect project knowledge usage and lifecycle signals');

  knowledge
    .command('audit')
    .description('Audit knowledge health without mutating knowledge sources')
    .option('--scope <scope>', 'Audit scope: spec|knowhow|all', 'all')
    .option('--prune', 'Include a deterministic read-only soft-prune report')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action(async (opts: {
      scope?: string;
      prune?: boolean;
      json?: boolean;
      workflowRoot: string;
    }) => {
      try {
        if (!['spec', 'knowhow', 'all'].includes(opts.scope ?? 'all')) {
          throw new Error('--scope must be one of spec, knowhow, all');
        }
        const result = await auditKnowledge(resolve(opts.workflowRoot), {
          scope: (opts.scope ?? 'all') as KnowledgeAuditScope,
          prune: opts.prune,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Knowledge audit: ${result.findings.length} finding(s)`);
        console.log(
          `Pipeline: ${result.pipeline.ledgers} ledgers · `
          + `${result.pipeline.pending_corroborated} corroborated pending · `
          + `${result.pipeline.pending_observed} observed pending · `
          + `${result.pipeline.promoted} promoted`,
        );
        console.log(
          `Repositories: current ${result.compatibility.current_repository.repo_id ?? 'manifest missing'} · `
          + `${result.compatibility.linked_repositories.length} linked · `
          + `${result.compatibility.counts.invalid_links ?? 0} invalid · `
          + `${result.compatibility.pending_cross_repo_promotions.length} pending cross-repo promotion(s)`,
        );
        console.log(
          `Compatibility: ${result.compatibility.entries.length} legacy entry state(s); `
          + 'audit is read-only (use knowledge normalize with a saved dry-run report)',
        );
        if (result.usage) {
          console.log(
            `Exposure: top10 ${percent(result.usage.impressionConcentration.top10Share)} · `
            + `Gini ${result.usage.impressionConcentration.gini.toFixed(3)}`,
          );
        }
        for (const finding of result.findings) {
          console.log(
            `  ${finding.priority} ${finding.store}/${finding.subtype} `
            + `${finding.target}: ${finding.evidence}`,
          );
        }
        if (opts.prune) console.log(`Prune report: ${result.prune_plan.length} suggested soft action(s); no files were changed`);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  knowledge
    .command('normalize')
    .description('Plan or explicitly apply deterministic legacy knowledge normalization (dry-run report is mandatory first)')
    .requiredOption('--report <path>', 'Dry-run report path; --apply reads this exact pre-existing report')
    .option('--scope <scope>', 'Normalization scope: spec|knowhow|all', 'all')
    .option('--apply', 'Apply the exact saved report after fingerprint validation and backups')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action((opts: {
      report: string;
      scope?: string;
      apply?: boolean;
      json?: boolean;
      workflowRoot: string;
    }) => {
      try {
        if (!['spec', 'knowhow', 'all'].includes(opts.scope ?? 'all')) {
          throw new Error('--scope must be one of spec, knowhow, all');
        }
        const projectRoot = resolve(opts.workflowRoot);
        const reportPath = resolve(projectRoot, opts.report);
        if (opts.apply) {
          const result = applyKnowledgeNormalization(projectRoot, reportPath);
          if (opts.json) console.log(JSON.stringify(result, null, 2));
          else {
            console.log(`Applied ${result.applied} normalized file(s); backup: ${result.backup_dir ?? 'not needed'}.`);
            if (result.unresolved > 0) console.log(`Unresolved compatibility entries: ${result.unresolved} (manual category selection required).`);
          }
          return;
        }
        const report = planKnowledgeNormalization(
          projectRoot,
          (opts.scope ?? 'all') as KnowledgeNormalizeScope,
        );
        writeKnowledgeNormalizationReport(reportPath, report);
        if (opts.json) console.log(JSON.stringify(report, null, 2));
        else {
          const actionable = report.actions.filter(action => action.blocked.length === 0 && action.before_sha256 !== action.after_sha256).length;
          console.log(`Normalization dry-run: ${actionable} file(s) actionable · ${report.unresolved.length} unresolved.`);
          console.log(`Report: ${reportPath}`);
          console.log(`Apply only this reviewed snapshot: maestro knowledge normalize --report "${opts.report}" --apply`);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  knowledge
    .command('stage')
    .description('Stage a reviewable spec or knowhow candidate on the active Run or Session')
    .argument('<target>', `Candidate target: ${KNOWLEDGE_CANDIDATE_TARGETS.join('|')}`)
    .argument('<title>', 'Candidate title')
    .argument('[content]', 'Candidate content (omit when using --content-file)')
    .option('--content-file <path>', 'Read candidate content from a file; "-" reads stdin')
    .option('--action <action>', `Candidate intent: ${KNOWLEDGE_CANDIDATE_ACTIONS.join('|')}`, 'propose')
    .option('--category <category>', 'Spec/knowhow category')
    .option('--type <type>', 'Canonical Knowhow subtype (defaults to tip for Knowhow)')
    .option('--keywords <words>', 'Comma-separated canonical keywords')
    .option('--source-ref <ref>', 'Canonical source URL or document identifier')
    .option('--related-path <path>', 'Project-relative related path (repeatable)', collectOption, [])
    .option('--repo <selector>', 'Immutable physical promotion target repository')
    .option('--applies-to-repo <selector>', 'Applicability repository selector (repeatable)', collectOption, [])
    .option('--language <language>', 'Optional Knowhow content/programming language')
    .option('--decision-state <state>', 'proposed|accepted|superseded (decision Knowhow only)')
    .option('--lifecycle-status <status>', 'active|deprecated', 'active')
    .option('--tool', 'Mark a Knowhow candidate as a tool')
    .option('--evidence <refs>', 'Comma-separated evidence references (required for session-source candidates)')
    .option('--transcript-quote <path>', 'Transcript quote JSON descriptor file: {host_kind, host_session_id, entry_id, quote}; captures a content-addressed snapshot and appends its transcript: URI to the evidence refs')
    .option('--signal <signal>', `Also record a knowledge signal: ${KNOWLEDGE_INPUT_SIGNALS.join('|')}`)
    .option('--signal-ids <ids>', 'Comma-separated knowledge IDs for --signal')
    .option('--run <run-id>', 'Explicit Run ID (run-source staging)')
    .option('--session <session-id>', 'Explicit Session ID (session-source staging; usable without --run)')
    .option('--channel <name>', 'Caller identity channel (write authorization, see knowledge-session-decoupling-mvp.md)')
    .option('--execution <id>', 'exact Execution ID for an Execution-bound Run')
    .option('--generation <n>', 'exact Execution generation', parsePositiveInteger)
    .option('--request-id <id>', 'idempotent knowledge sidecar request ID')
    .option('--expected-execution-revision <n>', 'expected Execution revision', parseNonNegativeInteger)
    .option('--owner-id <id>', 'Execution lease owner ID')
    .option('--owner-kind <kind>', `Execution lease owner kind: ${EXECUTION_OWNER_KINDS.join('|')}`, parseOwnerKind)
    .option('--lease-epoch <n>', 'Execution lease epoch', parsePositiveInteger)
    .option('--lease-id <token>', 'private Execution lease token (prefer --execution-authority to keep it out of argv)')
    .option('--execution-authority <path>', `private knowledge-execution-authority/1.0 JSON file; defaults from ${EXECUTION_AUTHORITY_FILE_ENV}`)
    .option('--allow-unknown', 'Record unknown signal IDs with a degraded marker instead of rejecting')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action(async (
      target: string,
      title: string,
      inlineContent: string | undefined,
      opts: {
        category?: string;
        action?: string;
        type?: string;
        keywords?: string;
        sourceRef?: string;
        relatedPath: string[];
        repo?: string;
        appliesToRepo: string[];
        language?: string;
        decisionState?: string;
        lifecycleStatus?: string;
        tool?: boolean;
        contentFile?: string;
        evidence?: string;
        transcriptQuote?: string;
        signal?: string;
        signalIds?: string;
        run?: string;
        session?: string;
        channel?: string;
        allowUnknown?: boolean;
        json?: boolean;
        workflowRoot: string;
      } & KnowledgeExecutionOptions,
    ) => {
      try {
        if (!KNOWLEDGE_CANDIDATE_TARGETS.includes(target as 'spec' | 'knowhow')) {
          throw new Error(`target must be one of ${KNOWLEDGE_CANDIDATE_TARGETS.join(', ')}`);
        }
        if (!KNOWLEDGE_CANDIDATE_ACTIONS.includes(
          opts.action as typeof KNOWLEDGE_CANDIDATE_ACTIONS[number],
        )) {
          throw new Error(`--action must be one of ${KNOWLEDGE_CANDIDATE_ACTIONS.join(', ')}`);
        }
        if (inlineContent && opts.contentFile) {
          throw new Error('Pass candidate content either positionally or with --content-file, not both');
        }
        if (!inlineContent && !opts.contentFile) {
          throw new Error('Candidate content is required positionally or with --content-file');
        }
        const content = inlineContent ?? readFileSync(
          opts.contentFile === '-' ? 0 : resolve(opts.workflowRoot, opts.contentFile!),
          'utf8',
        );
        const projectRoot = resolve(opts.workflowRoot);
        const appliesToRepoIds = resolveRepositorySelectorIds(opts.appliesToRepo, {
          projectRoot,
          corpus: target as 'spec' | 'knowhow',
          mode: 'read',
        });
        const store = new SessionStore(projectRoot);
        const authority = resolveWriteAuthority({
          projectRoot,
          store,
          explicitRun: opts.run,
          explicitSession: opts.session,
          explicitChannel: opts.channel,
        });
        if (authority.warning) console.error(`Warning: ${authority.warning}`);
        let executionAuthority: KnowledgeExecutionAuthority | undefined;
        if (authority.kind === 'run') {
          const sessionSchema = store.readSessionRecordReadOnly(authority.sessionId).schema_version;
          const hasOpenExecution = sessionSchema !== 'session/3.0'
            && store.readOpenExecution(authority.sessionId) !== null;
          executionAuthority = resolveKnowledgeExecutionAuthority(
            projectRoot,
            opts,
            { sessionId: authority.sessionId, runId: authority.runId },
            hasOpenExecution,
          );
        } else if (opts.executionAuthority
          || process.env[EXECUTION_AUTHORITY_FILE_ENV]
          || suppliedExecutionFields(opts).some(([, value]) => value !== undefined && value !== '')) {
          throw new Error('Execution sidecar authority is valid only with a Run-source target; pass --run <run-id>');
        }

        let signal: KnowledgeInputSignal | null = null;
        let signalIds: string[] = [];
        if (opts.signal && opts.signalIds) {
          if (!KNOWLEDGE_INPUT_SIGNALS.includes(opts.signal as KnowledgeInputSignal)) {
            throw new Error(`--signal must be one of ${KNOWLEDGE_INPUT_SIGNALS.join(', ')}`);
          }
          signal = opts.signal as KnowledgeInputSignal;
          signalIds = opts.signalIds.split(',').map(value => value.trim()).filter(Boolean);
        } else if (opts.signal && !opts.signalIds) {
          throw new Error('--signal requires --signal-ids');
        } else if (!opts.signal && opts.signalIds) {
          throw new Error('--signal-ids requires --signal');
        }
        await validateKnowledgeSignalIds(projectRoot, signalIds, opts.allowUnknown);

        const evidenceRefs = opts.evidence?.split(',').map(ref => ref.trim()).filter(Boolean) ?? [];
        if (opts.transcriptQuote) {
          // K13 — snapshot the quoted fragment before staging and append its
          // K12 anchor URI. The raw quote never enters the process argv: the
          // descriptor arrives via a private file path.
          const raw = readFileSync(
            resolve(opts.workflowRoot, opts.transcriptQuote),
            'utf8',
          );
          let descriptorJson: unknown;
          try {
            descriptorJson = JSON.parse(raw);
          } catch {
            throw new Error('Invalid --transcript-quote descriptor: not valid JSON');
          }
          const descriptor = transcriptQuoteInputSchema.safeParse(descriptorJson);
          if (!descriptor.success) {
            throw new Error(
              'Invalid --transcript-quote descriptor: expected '
              + '{host_kind, host_session_id, entry_id, quote}; missing or invalid: '
              + descriptor.error.issues.map(issue => issue.path.join('.') || 'root').join(', '),
            );
          }
          const host = {
            host_kind: descriptor.data.host_kind,
            host_session_id: descriptor.data.host_session_id,
            entry_id: descriptor.data.entry_id,
          };
          // Validate every deterministic URI field before persisting raw quote
          // bytes; invalid locators must leave no orphan snapshot behind.
          const transcriptUri = buildTranscriptUri(
            host.host_kind,
            host.host_session_id,
            host.entry_id,
            quoteSha256(descriptor.data.quote),
          );
          const snapshot = storeTranscriptEvidence(
            projectRoot,
            authority.sessionId,
            descriptor.data.quote,
            host,
          );
          if (!snapshot.sha256.startsWith(transcriptUri.split(':').at(-1)!)) {
            throw new Error('Transcript evidence snapshot hash does not match its URI');
          }
          evidenceRefs.push(transcriptUri);
        }
        let result: { session_id: string; candidate_id: string; run_id?: string; origin?: 'session' };
        let signalResult: { recorded: number } | null = null;
        if (authority.kind === 'run') {
          result = stageRunKnowledgeCandidate(
            projectRoot,
            authority.runId,
            {
              target: target as 'spec' | 'knowhow',
              action: opts.action as typeof KNOWLEDGE_CANDIDATE_ACTIONS[number],
              title,
              content,
              category: opts.category,
              evidenceRefs,
              repository: opts.repo,
              keywords: opts.keywords?.split(',').map(value => value.trim()).filter(Boolean),
              sourceRef: opts.sourceRef,
              relatedPaths: opts.relatedPath,
              appliesToRepoIds,
              type: opts.type,
              language: opts.language,
              decisionState: opts.decisionState,
              lifecycleStatus: opts.lifecycleStatus,
              tool: opts.tool,
            },
            authority.sessionId,
            executionAuthority,
          );
          if (signal) {
            signalResult = recordRunKnowledgeInputs(
              projectRoot,
              authority.runId,
              signalIds,
              signal,
              'manual',
              authority.sessionId,
              [],
              executionAuthority ? signalExecutionAuthority(executionAuthority) : undefined,
            );
          }
        } else {
          result = stageSessionKnowledgeCandidate(projectRoot, authority.sessionId, {
            target: target as 'spec' | 'knowhow',
            action: opts.action as typeof KNOWLEDGE_CANDIDATE_ACTIONS[number],
            title,
            content,
            category: opts.category,
            evidenceRefs,
            repository: opts.repo,
            keywords: opts.keywords?.split(',').map(value => value.trim()).filter(Boolean),
            sourceRef: opts.sourceRef,
            relatedPaths: opts.relatedPath,
            appliesToRepoIds,
            type: opts.type,
            language: opts.language,
            decisionState: opts.decisionState,
            lifecycleStatus: opts.lifecycleStatus,
            tool: opts.tool,
          });
          if (signal) {
            signalResult = recordSessionKnowledgeInputs(
              projectRoot,
              authority.sessionId,
              signalIds,
              signal,
              'manual',
            );
          }
        }
        if (opts.json) {
          console.log(JSON.stringify({ ...result, signal_recorded: signalResult?.recorded ?? 0 }, null, 2));
          return;
        }
        const where = authority.kind === 'run'
          ? `${result.session_id}/${result.run_id}`
          : `${result.session_id} (session source)`;
        if (!opts.json && !('reused' in result && result.reused)) {
          const summary = summarizeSessionKnowledge(projectRoot, result.session_id, {
            readOnly: true,
            strict: true,
          });
          const normalizedTitle = title.trim().toLowerCase();
          const siblings = summary.candidates.filter(candidate =>
            candidate.candidate_id !== result.candidate_id
            && candidate.title.trim().toLowerCase() === normalizedTitle
            && candidate.status === 'pending'
          );
          if (siblings.length > 0) {
            console.error(
              `Note: same title already staged as ${siblings.map(sibling => sibling.candidate_id).join(', ')} `
              + '(different content creates a new candidate; review may group them as related/duplicate)',
            );
          }
        }
        const reviewTiming = executionAuthority
          ? 'after the Execution is sealed'
          : 'after completion';
        console.log(
          `Staged ${result.candidate_id} on ${where}`
          + ('reused' in result && result.reused ? ' (identical content already staged; existing candidate kept — title/evidence unchanged)' : '')
          + (signalResult ? `; recorded ${signalResult.recorded} signal(s) as ${opts.signal}` : '')
          + `; review ${reviewTiming} with "maestro knowledge review ${result.session_id}".`,
        );
        if (authority.kind !== 'run') {
          // Run-less (session-source) staging has no `run check` finish checklist;
          // inject the next-step card here so the agent knows the review protocol,
          // entry-maintenance channels, and the evidence-freshness timing rule.
          console.log(
            'Next: run the review, present each candidate to the user (title/summary/evidence/matches/recommended disposition), '
            + 'collect decisions, then promote --resolve — never hand the raw command to the user as the whole task.',
          );
          console.log(
            'Entry maintenance: replaced canonical rules → `maestro spec supersede <old-sid> --by <new-sid>`; '
            + 'both stay valid → `maestro spec conflict mark <file> <line> --note "<reason>"`.',
          );
          console.log(
            'Timing: stage after evidence files are finalized — later edits to evidence invalidate the candidate (stale) '
            + 'and require re-staging.',
          );
          console.log(
            'Fast path: for a standalone insight that needs no Run/Session binding or review, skip staging and write it '
            + 'directly with `maestro knowhow add --type <type> --title "<title>" --body-file <path>` — no --evidence, '
            + 'no promote cycle.',
          );
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  knowledge
    .command('record')
    .description('Record explicit knowledge attribution on the active Run or Session without staging a candidate')
    .argument('<knowledge-ids...>', 'Knowledge IDs to attribute')
    .option('--signal <signal>', `Attribution signal: ${KNOWLEDGE_INPUT_SIGNALS.join('|')}`, 'consumed')
    .option('--source <source>', `Attribution source: ${KNOWLEDGE_INPUT_SOURCES.join('|')}`, 'search')
    .option('--evidence <refs>', 'Comma-separated evidence anchors (artifact/output/test refs)')
    .option('--run <run-id>', 'Explicit Run ID (run-source attribution)')
    .option('--session <session-id>', 'Explicit Session ID (session-source attribution; usable without --run)')
    .option('--channel <name>', 'Caller identity channel (write authorization)')
    .option('--execution <id>', 'exact Execution ID for an Execution-bound Run')
    .option('--generation <n>', 'exact Execution generation', parsePositiveInteger)
    .option('--request-id <id>', 'idempotent knowledge sidecar request ID')
    .option('--expected-execution-revision <n>', 'expected Execution revision', parseNonNegativeInteger)
    .option('--owner-id <id>', 'Execution lease owner ID')
    .option('--owner-kind <kind>', `Execution lease owner kind: ${EXECUTION_OWNER_KINDS.join('|')}`, parseOwnerKind)
    .option('--lease-epoch <n>', 'Execution lease epoch', parsePositiveInteger)
    .option('--lease-id <token>', 'private Execution lease token (prefer --execution-authority to keep it out of argv)')
    .option('--execution-authority <path>', `private knowledge-execution-authority/1.0 JSON file; defaults from ${EXECUTION_AUTHORITY_FILE_ENV}`)
    .option('--allow-unknown', 'Record unknown knowledge IDs with a degraded marker instead of rejecting')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action(async (
      knowledgeIds: string[],
      opts: {
        signal?: string;
        source?: string;
        evidence?: string;
        run?: string;
        session?: string;
        channel?: string;
        allowUnknown?: boolean;
        json?: boolean;
        workflowRoot: string;
      } & KnowledgeExecutionOptions,
    ) => {
      try {
        if (!KNOWLEDGE_INPUT_SIGNALS.includes(opts.signal as KnowledgeInputSignal)) {
          throw new Error(`--signal must be one of ${KNOWLEDGE_INPUT_SIGNALS.join(', ')}`);
        }
        if (!KNOWLEDGE_INPUT_SOURCES.includes(opts.source as typeof KNOWLEDGE_INPUT_SOURCES[number])) {
          throw new Error(`--source must be one of ${KNOWLEDGE_INPUT_SOURCES.join(', ')}`);
        }
        const projectRoot = resolve(opts.workflowRoot);
        const store = new SessionStore(projectRoot);
        const authority = resolveWriteAuthority({
          projectRoot,
          store,
          explicitRun: opts.run,
          explicitSession: opts.session,
          explicitChannel: opts.channel,
        });
        if (authority.warning) console.error(`Warning: ${authority.warning}`);
        let executionAuthority: KnowledgeExecutionAuthority | undefined;
        if (authority.kind === 'run') {
          const sessionSchema = store.readSessionRecordReadOnly(authority.sessionId).schema_version;
          const hasOpenExecution = sessionSchema !== 'session/3.0'
            && store.readOpenExecution(authority.sessionId) !== null;
          executionAuthority = resolveKnowledgeExecutionAuthority(
            projectRoot,
            opts,
            { sessionId: authority.sessionId, runId: authority.runId },
            hasOpenExecution,
          );
        } else if (opts.executionAuthority
          || process.env[EXECUTION_AUTHORITY_FILE_ENV]
          || suppliedExecutionFields(opts).some(([, value]) => value !== undefined && value !== '')) {
          throw new Error('Execution sidecar authority is valid only with a Run-source target; pass --run <run-id>');
        }
        await validateKnowledgeSignalIds(projectRoot, knowledgeIds, opts.allowUnknown);
        const evidence = opts.evidence?.split(',').map(ref => ref.trim()).filter(Boolean) ?? [];
        let result: { session_id: string; recorded: number; run_id?: string; origin?: 'session' };
        if (authority.kind === 'run') {
          result = recordRunKnowledgeInputs(
            projectRoot,
            authority.runId,
            knowledgeIds,
            opts.signal as KnowledgeInputSignal,
            opts.source as typeof KNOWLEDGE_INPUT_SOURCES[number],
            authority.sessionId,
            evidence,
            executionAuthority,
          );
        } else {
          result = recordSessionKnowledgeInputs(
            projectRoot,
            authority.sessionId,
            knowledgeIds,
            opts.signal as KnowledgeInputSignal,
            opts.source as typeof KNOWLEDGE_INPUT_SOURCES[number],
            evidence,
          );
        }
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const where = authority.kind === 'run'
          ? `${result.session_id}/${result.run_id}`
          : `${result.session_id} (session source)`;
        console.log(
          `Recorded ${result.recorded} input(s) as ${opts.signal} (source ${opts.source}) `
          + `on ${where}; `
          + `review with "maestro knowledge review ${result.session_id}".`,
        );
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  knowledge
    .command('reconcile')
    .description('[internal] Match Run candidates against existing knowledge (auto-run by check; use review --refresh)')
    .option('--run <run-id>', 'Explicit active or sealed Run ID')
    .option('--session <session-id>', 'Explicit Session ID of the target Run')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action(async (opts: {
      run?: string;
      session?: string;
      json?: boolean;
      workflowRoot: string;
    }) => {
      try {
        if (opts.session && !opts.run) {
          throw new Error(
            'reconcile is Run-scoped: pass --run <run-id> '
            + '(session-level reconciliation uses "maestro knowledge review <session-id> --refresh")',
          );
        }
        const projectRoot = resolve(opts.workflowRoot);
        const store = new SessionStore(projectRoot);
        const active = opts.run
          ? { sessionId: store.findRunRecord(opts.run, opts.session).sessionId, runId: opts.run }
          : store.findUniqueActiveRun();
        if (!active) {
          throw new Error(
            'No active Run to reconcile; pass --run <run-id> '
            + '(session-level reconciliation uses "maestro knowledge review <session-id> --refresh")',
          );
        }
        const receipt = await reconcileRunKnowledge(
          projectRoot,
          active.sessionId,
          active.runId,
        );
        if (opts.run) persistKnowledgeReconciliation(projectRoot, receipt);
        else persistActiveKnowledgeReconciliation(projectRoot, receipt);
        if (opts.json) {
          console.log(JSON.stringify(receipt, null, 2));
          return;
        }
        console.log(
          `Reconciled ${receipt.counts.candidates} candidate(s) on `
          + `${receipt.session_id}/${receipt.run_id}: `
          + `${receipt.counts.duplicates} duplicate · ${receipt.counts.related} related · `
          + `${receipt.counts.conflicts} conflict · ${receipt.counts.review_required} review required.`,
        );
        for (const candidate of receipt.candidates) {
          console.log(
            `  ${candidate.candidate_id} [${candidate.disposition}/`
            + `${candidate.promotion_eligibility}] → ${candidate.canonical_id ?? 'new knowledge'}`,
          );
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  knowledge
    .command('promote')
    .description('Promote selected pending Session knowledge with durable receipts (--resolve performs inline adjudication first)')
    .argument('<session-id>', 'Session identifier')
    .option(
      '--candidate <id>',
      'Candidate ID; repeatable and comma-compatible (with --resolve, promotion follows this set after resolving the --resolve candidate)',
      (value: string, previous: string[] = []) => [
        ...previous,
        ...value.split(',').map(id => id.trim()).filter(Boolean),
      ],
      [],
    )
    .option('--all', 'Promote all eligible pending candidates (observed-only emits a warning); mutually exclusive with --resolve')
    .option('--resolve <candidate-id>', 'Inline-resolve a candidate before promotion (TOCTOU fence + resolve + promote in one step); implies the single promote target unless --candidate is given')
    .option('--as <resolution>', `Resolution for --resolve: ${KNOWLEDGE_RESOLUTIONS.join('|')}`)
    .option('--target <knowledge-id>', 'Evidence-backed canonical knowledge ID for --resolve (forbidden for unique)')
    .option('--reason <reason>', 'Human review reason for --resolve (required, non-empty)')
    .option('--repo <selector>', 'Assert the immutable staged promotion target (never retargets)')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action((
      sessionId: string,
      opts: {
        candidate: string[];
        all?: boolean;
        resolve?: string;
        as?: string;
        target?: string;
        reason?: string;
        repo?: string;
        json?: boolean;
        workflowRoot: string;
      },
    ) => {
      try {
        const projectRoot = resolve(opts.workflowRoot);
        if (opts.resolve) {
          if (opts.all) {
            throw new Error(
              '--resolve is mutually exclusive with --all; resolve a single candidate inline with --resolve, then promote (or combine with --candidate)',
            );
          }
          if (!opts.as) throw new Error('--resolve requires --as (duplicate|related|conflict|supersede|unique); example: maestro knowledge promote <session-id> --resolve <candidate-id> --as unique --reason "<reason>"');
          if (!opts.reason?.trim()) throw new Error('--resolve requires a non-empty --reason; example: maestro knowledge promote <session-id> --resolve <candidate-id> --as unique --reason "<reason>"');
          if (!KNOWLEDGE_RESOLUTIONS.includes(opts.as as KnowledgeResolutionChoice)) {
            throw new Error(`--as must be one of ${KNOWLEDGE_RESOLUTIONS.join(', ')}`);
          }
          // §11 happy path: TOCTOU fence (refresh run/session receipts) →
          // resolve → promote, all inside this single invocation.
          refreshResolutionReceipts(projectRoot, sessionId, [opts.resolve]);
          const resolved = resolveKnowledgeCandidate(
            projectRoot,
            sessionId,
            opts.resolve,
            opts.as as KnowledgeResolutionChoice,
            { targetId: opts.target, reason: opts.reason },
          );
          if (!opts.json) {
            console.log(
              `Resolved ${resolved.candidate_id} as ${resolved.disposition}; `
              + `promotion ${resolved.promotion_eligibility}; `
              + `canonical ${resolved.canonical_id ?? 'new knowledge'}.`,
            );
          }
        }
        // --resolve implies the single candidate to promote when --candidate is
        // not given; when both are given, the --resolve candidate is resolved
        // inline and promotion follows the --candidate set.
        const candidateIds = opts.resolve && opts.candidate.length === 0
          ? [opts.resolve]
          : opts.candidate;
        const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, {
          candidateIds,
          all: opts.all,
          targetRepository: opts.repo,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Promoted ${result.promoted.length} knowledge candidate(s) from ${sessionId}:`);
        for (const item of result.promoted) {
          console.log(
            `  ${item.candidate_id} → ${item.promoted_id} `
            + `(${item.target}, ${item.outcome})`,
          );
        }
        if (result.promoted.length > 0) {
          console.log(
            'If a promoted candidate replaces an existing entry, mark the evolution chain: '
            + '`maestro spec supersede <old-sid> --by <promoted-id>` (or `spec conflict mark <file> <line> --note` when both stay valid).',
          );
        }
        if (result.already_promoted.length > 0) {
          console.log(`Already promoted: ${result.already_promoted.length} candidate(s).`);
        }
        if (result.skipped_observed.length > 0) {
          console.log(`Warning: ${result.skipped_observed.length} observed-only candidate(s) promoted without corroboration.`);
        }
        if (result.skipped_review_required.length > 0) {
          console.log(
            `Skipped ${result.skipped_review_required.length} candidate(s) requiring resolution.`,
          );
        }
        if (result.skipped_suppressed.length > 0) {
          console.log(`Skipped ${result.skipped_suppressed.length} suppressed candidate(s).`);
        }
        if (result.skipped_blocked.length > 0) {
          console.log(`Skipped ${result.skipped_blocked.length} blocked candidate(s).`);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  knowledge
    .command('review')
    .description('Review Session candidates with evidence-backed matches and next commands (fallback surface; inline adjudication lives on promote --resolve)')
    .argument('<session-id>', 'Session identifier')
    .option('--refresh', 'Refresh every candidate source Run before review')
    .option('--resolve <candidate-id>', '[deprecated] Resolve a candidate before review — prefer "promote --resolve" for inline adjudication + promotion')
    .option('--as <resolution>', `[deprecated] Resolution for --resolve: ${KNOWLEDGE_RESOLUTIONS.join('|')} — prefer promote --resolve`)
    .option('--target <knowledge-id>', '[deprecated] Evidence-backed canonical knowledge ID for --resolve — prefer promote --resolve')
    .option('--reason <reason>', '[deprecated] Human review reason for --resolve — prefer promote --resolve')
    .option('--json', 'Output as JSON')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action(async (
      sessionId: string,
      opts: {
        refresh?: boolean;
        resolve?: string;
        as?: string;
        target?: string;
        reason?: string;
        json?: boolean;
        workflowRoot: string;
      },
    ) => {
      try {
        const projectRoot = resolve(opts.workflowRoot);
        if (opts.resolve) {
          if (!opts.json) {
            console.error(
              'Deprecation: "review --resolve" is deprecated; use '
              + '"maestro knowledge promote <session-id> --resolve <candidate-id> --as <choice> [--target <knowledge-id>] --reason \"<reason>\"" '
              + 'for inline adjudication + promotion. review --resolve remains functional as a compatible fallback.',
            );
          }
          if (!opts.as) throw new Error('--resolve requires --as');
          if (!opts.reason) throw new Error('--resolve requires --reason');
          if (!KNOWLEDGE_RESOLUTIONS.includes(opts.as as KnowledgeResolutionChoice)) {
            throw new Error(`--as must be one of ${KNOWLEDGE_RESOLUTIONS.join(', ')}`);
          }
          // Deprecated review resolution keeps the same TOCTOU/freshness fence
          // as promote --resolve before writing the human decision.
          refreshResolutionReceipts(projectRoot, sessionId, [opts.resolve]);
          const resolved = resolveKnowledgeCandidate(
            projectRoot,
            sessionId,
            opts.resolve,
            opts.as as KnowledgeResolutionChoice,
            { targetId: opts.target, reason: opts.reason },
          );
          if (!opts.json) {
            console.log(
              `Resolved ${resolved.candidate_id} as ${resolved.disposition}; `
              + `promotion ${resolved.promotion_eligibility}; `
              + `canonical ${resolved.canonical_id ?? 'new knowledge'}.`,
            );
          }
        }
        let view = buildKnowledgeSessionView(projectRoot, sessionId);
        if (opts.refresh) {
          const store = new SessionStore(projectRoot);
          const expectedCorpusFingerprint = currentKnowledgeCorpusFingerprint(projectRoot);
          for (const runId of uniqueRunIds(view.candidates)) {
            const frontmatter = readReportFrontmatter(store.runDir(sessionId, runId));
            const existing = readKnowledgeReconciliation(store, sessionId, runId, true);
            const receipt = existing && isKnowledgeReconciliationFresh(
              projectRoot,
              sessionId,
              runId,
              existing,
              frontmatter,
              expectedCorpusFingerprint,
            )
              ? existing
              : await reconcileRunKnowledge(projectRoot, sessionId, runId);
            persistKnowledgeReconciliation(projectRoot, receipt);
          }
          if (view.candidates.some(candidate => (candidate.origin ?? 'run') === 'session')) {
            const sessionReceipt = ensureSessionKnowledgeReconciliation(projectRoot, sessionId);
            persistSessionKnowledgeReconciliation(projectRoot, sessionReceipt);
          }
          view = buildKnowledgeSessionView(projectRoot, sessionId);
        }
        if (opts.json) {
          console.log(JSON.stringify(view, null, 2));
          return;
        }
        printKnowledgeReview(view, projectRoot);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
