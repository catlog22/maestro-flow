import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { hashDirectory, hashFile, scanOutputs, type ArtifactScanResult, type DiscoveredArtifact } from './artifacts.js';
import { parseArgumentHint, type SkillParamDef } from '../config/argument-hint-parser.js';
import {
  hashCommandContract,
  resolveCommandSource,
  resolveStepContent,
  type CommandContract,
  type ContractGateDefinition,
  type SessionMode,
} from './contract.js';
import {
  PLATFORM_SUFFIX,
  transformContentForPlatform,
  type TargetPlatform,
} from '../core/skill-converter.js';
import { deriveHandoff, readReportFrontmatter } from './report.js';
import {
  gateSchema,
  type ArtifactRegistry,
  type CommandRun,
  type Gate,
  type GateRegistry,
  type Handoff,
  type ReportFrontmatter,
  type SessionState,
} from './schemas.js';
import {
  briefResultV10Schema,
  commandRebindAuditSchema,
  completeInputSnapshotSchema,
  executionContractV11Schema,
  guidanceSnapshotSchema,
  type BriefResult,
  type CompleteInputSnapshot,
  type CreationProvenance,
  type ExecutionContract,
  type ArgumentRequirement,
  type GuidanceSnapshot,
  type IntentIdentity,
  type SessionProvenance,
  type PersistedTransitionRecord,
  type TransitionPointer,
} from './protocol-schemas.js';
import { createIntentIdentity } from './intent-identity.js';
import { createTopicIdentity, normalizeTopic, sameTopicIdentity, type TopicIdentity } from './topic-identity.js';
import { assessArtifactReuse, type ReuseAssessment } from './reuse-assessment.js';
import {
  buildIntentSection,
  buildBoundaryContractSection,
  buildProgressSection,
  buildSignalsSection,
} from './inject.js';
import { SessionStore, type SessionBundle, type StoreTransaction } from './store.js';
import { createGateRegistry } from './defaults.js';
import {
  nextPendingDecisionIndex,
  nextPendingIndex,
  issueRetryToken,
} from './chain.js';
import { canonicalRunDir, resolveRunContext, resolveTargetPlatform } from './context.js';
import { checkLease, claimLease, type LeaseClaim } from './lease.js';
import {
  assertTransitionMutationRevisions,
  createTransitionOutcome,
  prepareTransitionMutation,
  stableJsonUtf8,
  transitionMutationReceipt,
  TransitionReceiptError,
  validatePersistedTransitionRecord,
  type TransitionMutationOptions,
  type TransitionMutationReceipt,
} from './transition-receipts.js';
import { validateSessionId } from './ids.js';
import {
  ensureSessionProjection,
  localISO,
  migrateV1toV2,
  readStateJson,
  writeStateJson,
  type ProjectSessionEntry,
  type StateJsonV2,
} from '../utils/state-schema.js';

export interface RunUpstream {
  artifact_id: string;
  path: string;
  kind: string;
  status: 'sealed' | 'draft';
}

/** Compact view of a prior Run's handoff, shared by next/brief/prepare read-sides. */
export interface PrevHandoff {
  run_id: string;
  command: string;
  verdict: Handoff['verdict'];
  summary: string;
  decisions: string[];
  concerns: string[];
}

/** Session anchor grounding block reused by brief (Intent / Boundary / Progress). */
export interface AnchorSection {
  intent: string | null;
  boundary_contract: string | null;
  progress: string | null;
  signals: string | null;
}

export interface NamedGateBlocker {
  gate_id: string;
  title: string;
  status: Gate['status'];
}

export interface CreateRunOptions {
  projectRoot: string;
  command: string;
  sessionId?: string;
  intent?: string;
  /** Command-independent topic used for Session selection. Defaults to intent. */
  topic?: string;
  args?: string[];
  /** Explicit platform for first creation; persisted and immutable on re-attach. */
  platform?: TargetPlatform;
  /** Opaque token issued by a needs-retry transition. */
  retryToken?: string;
  /** Atomically bind the new Run to this pending chain step. */
  chainStepId?: string;
  /** Preflight revision from `run next`, revalidated inside the SessionStore lock. */
  expectedActivityRevision?: number;
  /** Preflight identity revision from `run next`, revalidated inside the SessionStore lock. */
  expectedIdentityRevision?: number;
  /** Lease claim validated and persisted with the chain binding. */
  leaseClaim?: LeaseClaim;
  /** Explicit exact identity supplied by recall/fork/import consumers. */
  intentIdentity?: IntentIdentity;
  /** Session lineage for a newly allocated Session. */
  sessionProvenance?: SessionProvenance;
  /** Audited creation authority supplied by confirmation/transition consumers. */
  creation?: {
    requestId: string | null;
    mode: 'explicit-create' | 'chain-next' | 'retry' | 'resume' | 'fork' | 'import';
    authority: 'explicit-command' | 'chain-transition' | 'confirmation-token' | 'legacy-inferred';
    confirmationTokenHash: string | null;
    provenance: CreationProvenance;
    transition?: TransitionPointer | null;
  };
}

export interface CreateRunResult {
  session_id: string;
  run_id: string;
  run_dir: string;
  chain_step_id: string | null;
  resolved_platform: TargetPlatform;
  upstream: Record<string, RunUpstream>;
  topic_identity: TopicIdentity;
  reuse_assessments: ReuseAssessment[];
  argument_requirements: ArgumentRequirement[];
  entry_gates: GateSummary;
  entry_blockers: NamedGateBlocker[];
  next: { command: string; reason: string };
}

export interface RebindRunResult {
  session_id: string;
  run_id: string;
  rebind_kind: 'legacy_contract_backfill' | 'compatible_contract_rebind' | 'prompt_only_rebind';
  old_content_hash: string;
  content_hash: string;
  old_contract_hash: string | null;
  contract_hash: string;
  old_snapshot_hash: string | null;
  snapshot_hash: string;
  audit_path: string;
}

export interface AcceptReuseResult {
  session_id: string;
  run_id: string;
  artifact_id: string;
  assessment_hash: string;
  run_status: CommandRun['status'];
  consumes: string[];
  entry_gates: GateSummary;
  transition: TransitionMutationReceipt;
}

export interface AcceptReuseOptions extends Partial<TransitionMutationOptions> {
  actor: string;
  reason: string;
  evidence: string[];
}

export interface SealSessionResult {
  session_id: string;
  status: 'sealed';
  sealed_at: string;
  run_count: number;
}

export interface GateSummary {
  passed: string[];
  failed: string[];
  skipped: string[];
  blocking: string[];
}

export interface CheckRunResult {
  session_id: string;
  run_id: string;
  status: CommandRun['status'];
  gates: GateSummary;
  artifacts: Array<{ path: string; kind: string; role: string; alias?: string }>;
  warnings: string[];
  errors: string[];
  upstream: Record<string, RunUpstream>;
  reuse_assessments: ReuseAssessment[];
  /** Populated by `run check`: repair loop while gates block, complete when clean, advance when sealed. */
  next?: { command: string; reason: string };
  /**
   * Finish-work checklist, populated by `run check` only once every gate is
   * clean: core handoff/record/verdict norms plus workflow frontmatter
   * `finish:` lines. Prompt-layer guidance — never a blocking gate.
   */
  finish?: string[];
}

export interface CompleteRunResult extends CheckRunResult {
  sealed: boolean;
  primary_artifact_id: string | null;
  artifact_ids: string[];
  /** Suggest-only post-completion action; never allocates or executes another Run. */
  next_action?: CompleteNextSuggestion;
  /** Present when completeRun atomically applied a chain verdict. */
  chain_transition?: {
    step_id: string;
    index: number;
    step_status: string;
    retry: { count: number; max: number; exhausted: boolean } | null;
  } | null;
  transition: TransitionMutationReceipt;
}

export interface PrepareConsumeStatus {
  alias: string | null;
  kind: string;
  required: boolean;
  present: boolean;
  status: 'sealed' | 'draft' | null;
  path: string | null;
}

export interface PreparePrevious {
  handoff: PrevHandoff | null;
  consumes: PrepareConsumeStatus[];
  upstream: Record<string, RunUpstream>;
  reuse_assessments: ReuseAssessment[];
  selected_refs: Array<{ alias: string; artifact_id: string; path: string; assessment_hash: string }>;
}

export interface PrepareStepResult {
  step: string;
  platform: string;
  prepare: { path: string; content: string } | null;
  workflow: { path: string; line_count: number } | null;
  run_mode: { path: string; summary: string } | null;
  refs: Array<{ path: string; when: string }>;
  goal_mode: { platform: string; instructions: string } | null;
  /** Present only when `sessionId` is supplied — read-only prior-step context. */
  previous?: PreparePrevious;
}

export interface SkillContentResult {
  step: string;
  platform: string;
  prepare: { path: string; content: string } | null;
  workflow: { path: string; content: string } | null;
  refs: Array<{ path: string; when: string }>;
  goal_mode: { platform: string; instructions: string } | null;
}

export type BriefRunResult = BriefResult;

export type ExecutionContractView = ExecutionContract;

export interface CompleteNextSuggestion {
  suggest_only: true;
  action: 'repair_run' | 'resolve_session' | 'dispatch_next' | 'evaluate_decision' | 'seal_session';
  command: string | null;
  reason: string;
  preconditions: string[];
}

export interface CompleteRunOptions {
  /** Extra concerns merged (append + dedupe) into the derived handoff. */
  notes?: string[];
  /** Run-relative paths registered as evidence artifacts beyond the outputs scan. */
  extraArtifacts?: string[];
  /**
   * Used as handoff.summary only when the report frontmatter yielded an empty
   * one. Report frontmatter stays the primary source; this is the CLI fallback
   * (e.g. ralph complete --summary when the executor wrote no frontmatter).
   */
  summaryFallback?: string;
  /**
   * CLI-supplied decisions appended to the derived handoff.decisions (status
   * `accepted`). Aligns ralph `--decisions` onto the P3 handoff single-source:
   * ralph parked them in ralph-meta; here they ride the run's handoff so the
   * next step's birth packet can surface them via prev_handoff.
   */
  decisions?: string[];
  /** Lease claim checked inside the same transaction that seals the Run. */
  leaseClaim?: LeaseClaim;
  /** Internal chain transition used by completeRunWithVerdict. */
  chainVerdict?: CompletionVerdict;
  /** Audited retry/revision/lease authority for completion. */
  transition?: Partial<TransitionMutationOptions>;
}

/** Chain-advancement instruction carried by `run complete --verdict`. */
export type CompletionVerdict = 'done' | 'done-with-concerns' | 'needs-retry' | 'blocked';

export interface CompleteVerdictResult {
  session_id: string;
  run_id: string;
  verdict: CompletionVerdict;
  /** True when the run sealed (done / done-with-concerns / needs-retry paths). */
  run_sealed: boolean;
  /** The chain step this run was bound to, or null for a non-chain run. */
  chain: {
    step_id: string;
    index: number;
    /** The chain step's status after the verdict was applied. */
    step_status: string;
    /** Retry counter after a needs-retry bump (null otherwise). */
    retry: { count: number; max: number; exhausted: boolean } | null;
  } | null;
  /** Session status after the verdict (paused on blocked, unchanged otherwise). */
  session_status: SessionState['status'];
  /** Next-step pointer closing the loop back to `run next` / decide / seal. */
  next: CompleteNextSuggestion;
  /** The underlying seal result (run gates, artifacts, warnings, errors). */
  seal: CompleteRunResult;
}

interface EvaluationContext {
  projectRoot: string;
  runDir: string;
  session: SessionState;
  registry: ArtifactRegistry;
  scan: ArtifactScanResult;
  evidence: SessionBundle['evidence'];
  reportDecisions?: Array<{ id: string; status: string }>;
  /** Entry artifact gates must bind to this Run's actual consumes authority. */
  run: CommandRun;
}

const explicitGateCheckSchema = gateSchema.shape.check;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function protocolSha256(value: string | Buffer): string {
  return `sha256:${sha256(value)}`;
}

function buildGuidanceSnapshot(
  projectRoot: string,
  command: string,
  source: ReturnType<typeof resolveCommandSource>,
): GuidanceSnapshot {
  const guidance = resolveStepContent(projectRoot, command);
  return guidanceSnapshotSchema.parse({
    schema_version: 'guidance-snapshot/1.0',
    source_path: source.relativePath,
    content_hash: protocolSha256(source.raw),
    resolved_prompt_hash: protocolSha256(source.raw),
    prepare_hash: guidance.prepare ? protocolSha256(guidance.prepare.raw) : null,
    workflow_hash: guidance.workflow ? protocolSha256(guidance.workflow.raw) : null,
    run_mode_hash: guidance.runMode ? protocolSha256(guidance.runMode.raw) : null,
  });
}

function guidanceFreshness(
  projectRoot: string,
  run: CommandRun,
): BriefResult['guidance']['freshness'] {
  const source = resolveCommandSource(projectRoot, run.command.name);
  const current = buildGuidanceSnapshot(projectRoot, run.command.name, source);
  const captured = run.guidance_snapshot ?? null;
  if (!captured) return { status: 'unavailable', changed: [], captured, current };

  const comparisons: Array<[
    BriefResult['guidance']['freshness']['changed'][number],
    string | null,
    string | null,
  ]> = [
    ['command', captured.content_hash, current.content_hash],
    ['resolved_prompt', captured.resolved_prompt_hash, current.resolved_prompt_hash],
    ['prepare', captured.prepare_hash, current.prepare_hash],
    ['workflow', captured.workflow_hash, current.workflow_hash],
    ['run_mode', captured.run_mode_hash, current.run_mode_hash],
  ];
  const changed = comparisons.filter(([, before, after]) => before !== after).map(([key]) => key);
  return { status: changed.length > 0 ? 'changed' : 'none', changed, captured, current };
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function contractHash(contract: CommandContract): string {
  return hashCommandContract(contract);
}

function dateId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function emptyProjectState(projectRoot: string): StateJsonV2 {
  return migrateV1toV2({ project_name: basename(projectRoot), status: 'active' });
}

function projectState(projectRoot: string): StateJsonV2 {
  const empty = emptyProjectState(projectRoot);
  const current = readStateJson(projectRoot);
  if (!current) return empty;
  return {
    ...empty,
    ...current,
    milestones: current.milestones ?? [],
    artifacts: current.artifacts ?? [],
    accumulated_context: current.accumulated_context ?? empty.accumulated_context,
    transition_history: current.transition_history ?? [],
    milestone_history: current.milestone_history ?? [],
    sessions: current.sessions ?? [],
    active_session_id: current.active_session_id ?? null,
  };
}

function projectSessionEntry(session: SessionState): ProjectSessionEntry {
  return {
    session_id: session.session_id,
    intent: session.intent,
    status: session.status,
    depends_on: [],
    roadmap_artifact_id: null,
    seed_ref: null,
  };
}

function compatibleTopic(session: SessionState, identity: TopicIdentity): boolean {
  return session.topic_identity
    ? sameTopicIdentity(session.topic_identity, identity)
    : normalizeTopic(session.intent) === identity.normalized;
}

function uniqueTopicCandidate(
  label: string,
  candidates: Array<{ sessionId: string; session: SessionState }>,
): string | null {
  if (candidates.length > 1) {
    throw new Error(`${label} is ambiguous; pass --session: ${candidates.map(item => item.sessionId).join(', ')}`);
  }
  return candidates[0]?.sessionId ?? null;
}

function runningTopicCandidatesLocked(
  store: SessionStore,
  identity: TopicIdentity,
  currentDraft?: SessionState,
): Array<{ sessionId: string; session: SessionState }> {
  if (!existsSync(store.sessionsRoot)) return [];
  const running = readdirSync(store.sessionsRoot).sort().flatMap(sessionId => {
    if (!store.sessionExists(sessionId)) return [];
    try {
      const session = currentDraft?.session_id === sessionId
        ? currentDraft
        : store.readBundle(sessionId).session;
      return session.status === 'running' ? [{ sessionId, session }] : [];
    } catch {
      return [];
    }
  });
  const native = running.filter(item => item.session.topic_identity
    && sameTopicIdentity(item.session.topic_identity, identity));
  if (native.length > 0) return native;
  return running.filter(item => !item.session.topic_identity
    && normalizeTopic(item.session.intent) === identity.normalized);
}

/** Read-only command-independent topic lookup used by prepare and recall. */
export function resolveTopicSessionId(
  projectRoot: string,
  topic: string,
  requested?: string,
): string | null {
  const store = new SessionStore(projectRoot);
  const identity = createTopicIdentity(projectRoot, topic);
  if (requested) {
    validateSessionId(requested);
    if (!store.sessionExists(requested)) return null;
    const session = store.readBundle(requested).session;
    if (!compatibleTopic(session, identity)) {
      throw new Error(`Explicit Session ${requested} is incompatible with topic ${JSON.stringify(topic)}`);
    }
    return requested;
  }
  const running = store.listSessions({ statuses: ['running'] }).candidates;
  const native = running.filter(item => item.session.topic_identity
    && sameTopicIdentity(item.session.topic_identity, identity));
  const nativeId = uniqueTopicCandidate('Running topic match', native);
  if (nativeId) return nativeId;
  const legacy = running.filter(item => !item.session.topic_identity
    && normalizeTopic(item.session.intent) === identity.normalized);
  return uniqueTopicCandidate('Legacy exact intent match', legacy);
}

function resolveSessionId(
  store: SessionStore,
  requested: string | undefined,
  topic: string,
  source: 'explicit' | 'workflow' | 'legacy-intent',
): { sessionId: string; topicIdentity: TopicIdentity } {
  const topicIdentity = createTopicIdentity(store.projectRoot, topic, { source });
  if (requested) {
    validateSessionId(requested);
    if (store.sessionExists(requested)) {
      const existing = store.readBundle(requested).session;
      if (!compatibleTopic(existing, topicIdentity)) {
        throw new Error(`Explicit Session ${requested} is incompatible with topic ${JSON.stringify(topic)}`);
      }
    }
    return { sessionId: requested, topicIdentity };
  }
  const matched = resolveTopicSessionId(store.projectRoot, topic);
  if (matched) return { sessionId: matched, topicIdentity };
  const base = `${dateId()}-${slug(topic, 'session')}`;
  if (!store.sessionExists(base)) return { sessionId: base, topicIdentity };
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${String(index).padStart(2, '0')}`;
    if (!store.sessionExists(candidate)) return { sessionId: candidate, topicIdentity };
  }
  throw new Error(`Unable to allocate session ID for topic: ${topic}`);
}

function nextSequence(store: SessionStore, sessionId: string): number {
  const runsDir = join(store.sessionDir(sessionId), 'runs');
  if (!existsSync(runsDir)) return 1;
  let max = 0;
  for (const name of readdirSync(runsDir)) {
    const match = name.match(/^\d{8}-(\d{3})-/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function defaultAlias(kind: string, command: string): string | undefined {
  const value = `${kind} ${command}`.toLowerCase();
  if (value.includes('analy') || value.includes('finding')) return 'current-analysis';
  if (value.includes('plan')) return 'current-plan';
  if (value.includes('execut') || value.includes('change-manifest')) return 'latest-execution';
  if (value.includes('verif')) return 'latest-verification';
  if (value.includes('review')) return 'latest-review';
  if (value.includes('test') || value.includes('acceptance')) return 'latest-test';
  if (value.includes('debug') || value.includes('diagnos')) return 'latest-debug';
  return undefined;
}

interface CollectedReuse {
  upstream: Record<string, RunUpstream>;
  assessments: ReuseAssessment[];
}

function observedArtifactHash(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    const hash = stat.isDirectory() ? hashDirectory(path).hash : hashFile(path).hash;
    return `sha256:${hash}`;
  } catch {
    return null;
  }
}

function producerContractDrift(
  projectRoot: string,
  run: CommandRun,
  artifact: ArtifactRegistry['artifacts'][string],
): { producerHash: string | null; currentHash: string | null; drift: 'none' | 'prompt_only' | 'compatible_output' | 'breaking' | 'unknown' } {
  if (!run.contract_snapshot) return { producerHash: null, currentHash: null, drift: 'unknown' };
  const current = resolveCommandSource(projectRoot, run.command.name);
  const producerHash = run.contract_snapshot.snapshot_hash;
  const currentHash = current.contractSnapshot.snapshot_hash;
  if (producerHash === currentHash) {
    return {
      producerHash,
      currentHash,
      drift: current.contentHash === run.command.content_hash ? 'none' : 'prompt_only',
    };
  }
  const compatible = current.contract.produces.some(output => output.kind === artifact.kind
    && (!output.schema || output.schema === artifact.schema_version)
    && (!output.role || output.role === artifact.role));
  return { producerHash, currentHash, drift: compatible ? 'compatible_output' : 'breaking' };
}

/**
 * Enumerate and assess only artifacts already registered in the target Session.
 * The caller invokes this while holding the SessionStore update lock, so the
 * observed bytes and registry revision are the fence bound into the new Run.
 */
function collectReusableUpstream(
  projectRoot: string,
  store: SessionStore,
  session: SessionState,
  registry: ArtifactRegistry,
  gates: GateRegistry,
  contract: CommandContract,
): CollectedReuse {
  if (contract.consumes.length === 0) return { upstream: {}, assessments: [] };
  const candidates = Object.entries(registry.artifacts)
    .map(([artifactId, artifact]) => {
      let producer: CommandRun | null = null;
      try { producer = store.readRun(session.session_id, artifact.producer_run_id); } catch { /* assessed as unavailable */ }
      const path = join(store.sessionDir(session.session_id), artifact.relative_path);
      return { artifactId, artifact, producer, observedHash: observedArtifactHash(path) };
    })
    .filter(item => item.producer !== null)
    .sort((left, right) => (right.producer?.sequence ?? 0) - (left.producer?.sequence ?? 0)
      || left.artifactId.localeCompare(right.artifactId));

  const assessments: ReuseAssessment[] = [];
  const upstream: Record<string, RunUpstream> = {};
  for (const consume of contract.consumes) {
    const aliasTargetId = consume.alias ? registry.aliases[consume.alias] : undefined;
    const matchingKind = candidates.filter(item => item.artifact.kind === consume.kind);
    const scopedCandidates = consume.alias
      ? matchingKind.filter(item => item.artifactId === aliasTargetId)
      : matchingKind;
    const assessed = scopedCandidates.map(item => {
      const producer = item.producer!;
      const supersededBy = Object.entries(registry.artifacts)
        .filter(([, candidate]) => candidate.replaces === item.artifactId)
        .map(([id]) => id);
      const acceptedSchemas = consume.schema
        ? [consume.schema]
        : (contract.contract_version ?? 1) === 1 ? [item.artifact.schema_version] : [];
      const acceptedRoles: string[] = consume.role ? [consume.role] : [];
      const currentSameRoleCandidates = matchingKind
        .filter(peer => peer.artifact.role === item.artifact.role)
        .filter(peer => peer.artifact.status === 'sealed')
        .filter(peer => !Object.values(registry.artifacts).some(candidate => candidate.replaces === peer.artifactId))
        .filter(peer => consume.alias ? peer.artifactId === aliasTargetId : true);
      const sameRoleCandidates = currentSameRoleCandidates
        .map(peer => ({
        artifactId: peer.artifactId,
        artifactHash: peer.artifact.content_hash ? `sha256:${peer.artifact.content_hash}` : null,
        eligible: peer.producer?.status === 'sealed'
          && peer.artifact.status === 'sealed'
          && peer.observedHash === `sha256:${peer.artifact.content_hash}`
          && (acceptedSchemas.length === 0 || acceptedSchemas.includes(peer.artifact.schema_version))
          && (acceptedRoles.length === 0 || acceptedRoles.includes(peer.artifact.role)),
        }));
      const assessmentInput = {
        candidate: {
          workspaceId: createTopicIdentity(projectRoot, session.intent, { source: 'legacy-intent' }).workspace_id,
          sessionId: session.session_id,
          producerRunId: producer.run_id,
          producerRunHash: observedArtifactHash(join(store.runDir(session.session_id, producer.run_id), 'run.json')),
          producerStatus: producer.status,
          artifactId: item.artifactId,
          artifactRole: item.artifact.role,
          artifactStatus: item.artifact.status,
          artifactHash: `sha256:${item.artifact.content_hash}`,
          observedArtifactHash: item.observedHash,
          artifactSchema: item.artifact.schema_version,
          artifactRegistryRevision: registry.revision,
        },
        consumer: {
          kind: consume.kind,
          alias: consume.alias ?? null,
          schema: consume.schema ?? null,
          role: consume.role ?? null,
        },
        acceptedArtifactSchemas: acceptedSchemas,
        acceptedArtifactRoles: acceptedRoles,
        contract: producerContractDrift(projectRoot, producer, item.artifact),
        freshness: item.artifact.status === 'superseded' || supersededBy.length > 0
          ? 'stale'
          : consume.alias
            ? (aliasTargetId === item.artifactId ? 'fresh' : 'unknown')
            : currentSameRoleCandidates.length > 0 ? 'fresh' : 'unknown',
        quality: {
          status: producer.status !== 'sealed'
            || producer.output.verdict === 'blocked'
            || producer.output.verdict === 'failed'
            || producer.handoff?.verdict === 'blocked'
            || producer.handoff?.verdict === 'failed'
            || producer.gate_ids.some(id => {
              const status = gates.gates[id]?.status;
              return status !== undefined && !['passed', 'waived', 'skipped'].includes(status);
            })
            ? 'low'
            : (producer.handoff?.concerns.length ?? 0) > 0
              || producer.handoff?.verdict === 'ready_with_concerns'
              || producer.output.verdict === 'ready_with_concerns'
              ? 'medium'
              : producer.handoff?.verdict === 'ready' && producer.output.verdict === 'ready'
                ? 'high'
                : 'unknown',
          concernCodes: producer.handoff?.concerns ?? [],
        },
        supersession: {
          status: item.artifact.status === 'superseded' || supersededBy.length > 0 ? 'superseded' : 'current',
          supersedesArtifactIds: item.artifact.replaces ? [item.artifact.replaces] : [],
          supersededByArtifactIds: supersededBy,
        },
        conflicts: { sameRoleCandidates },
      } satisfies Parameters<typeof assessArtifactReuse>[0];
      let assessment = assessArtifactReuse(assessmentInput);
      const finalArtifactHash = observedArtifactHash(join(store.sessionDir(session.session_id), item.artifact.relative_path));
      const finalRunHash = observedArtifactHash(join(store.runDir(session.session_id, producer.run_id), 'run.json'));
      if (finalArtifactHash !== assessment.source_fence.observed_artifact_hash
        || finalRunHash !== assessment.source_fence.producer_run_hash) {
        const producerFenceStable = finalRunHash === assessment.source_fence.producer_run_hash;
        assessment = assessArtifactReuse({
          ...assessmentInput,
          candidate: {
            ...assessmentInput.candidate,
            observedArtifactHash: finalArtifactHash,
            producerRunHash: producerFenceStable ? finalRunHash : null,
          },
        });
      }
      assessments.push(assessment);
      return { item, assessment };
    });
    const selected = assessed.find(item => item.assessment.decision === 'REUSE');
    if (!selected) continue;
    const alias = consume.alias
      ?? Object.entries(registry.aliases).find(([, id]) => id === selected.item.artifactId)?.[0]
      ?? selected.item.artifactId;
    upstream[alias] = {
      artifact_id: selected.item.artifactId,
      path: `sessions/${session.session_id}/${selected.item.artifact.relative_path}`,
      kind: selected.item.artifact.kind,
      status: 'sealed',
    };
  }
  return { upstream, assessments };
}

export function assessSessionReuse(
  projectRoot: string,
  sessionId: string,
  command: string,
): CollectedReuse {
  const store = new SessionStore(projectRoot);
  return store.withLock(() => {
    const bundle = store.readBundle(sessionId);
    return collectReusableUpstream(
      projectRoot,
      store,
      bundle.session,
      bundle.artifacts,
      bundle.gates,
      resolveCommandSource(projectRoot, command).contract,
    );
  });
}

interface RevalidatedRunReuse {
  upstream: Record<string, RunUpstream>;
  assessments: ReuseAssessment[];
  blockers: string[];
}

function hasAcceptedReviewReceipt(
  bundle: SessionBundle,
  run: CommandRun,
  assessment: ReuseAssessment,
): boolean {
  return bundle.session.requests.some(item => {
    if (item.type !== 'transition' || !('outcome' in item)
      || item.outcome.operation !== 'accept-reuse' || item.outcome.status !== 'applied') return false;
    const acceptance = item.outcome.result.acceptance;
    if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) return false;
    const raw = acceptance as Record<string, unknown>;
    return raw.run_id === run.run_id
      && raw.assessment_hash === assessment.assessment_hash
      && raw.artifact_id === assessment.source_fence.artifact_id
      && stableJsonUtf8(raw.source_fence) === stableJsonUtf8(assessment.source_fence);
  });
}

function revalidateRunReuse(
  projectRoot: string,
  store: SessionStore,
  bundle: SessionBundle,
  run: CommandRun,
): RevalidatedRunReuse {
  const stored = (run.input.reuse_assessments ?? []) as ReuseAssessment[];
  if (stored.length === 0) {
    return {
      upstream: {},
      assessments: [],
      blockers: run.input.consumes.length > 0 ? ['consumed artifacts have no reusable source fence'] : [],
    };
  }
  const current = collectReusableUpstream(
    projectRoot,
    store,
    bundle.session,
    bundle.artifacts,
    bundle.gates,
    contractForRun(projectRoot, run).contract,
  );
  const upstream: Record<string, RunUpstream> = {};
  const assessments: ReuseAssessment[] = [];
  const blockers: string[] = [];
  for (const original of stored) {
    const refreshed = current.assessments.find(item =>
      item.source_fence.artifact_id === original.source_fence.artifact_id
      && item.consumer.kind === original.consumer.kind
      && item.consumer.alias === original.consumer.alias);
    const aliasCurrent = original.consumer.alias === null
      || bundle.artifacts.aliases[original.consumer.alias] === original.source_fence.artifact_id;
    const sourceFenceCurrent = refreshed !== undefined
      && refreshed.source_fence.artifact_registry_revision === original.source_fence.artifact_registry_revision
      && refreshed.source_fence.artifact_hash === original.source_fence.artifact_hash
      && refreshed.source_fence.observed_artifact_hash === original.source_fence.observed_artifact_hash
      && refreshed.source_fence.producer_run_hash === original.source_fence.producer_run_hash
      && aliasCurrent;
    const originalReuseCurrent = original.decision === 'REUSE'
      && refreshed?.decision === 'REUSE'
      && sourceFenceCurrent;
    const acceptedReviewCurrent = original.decision === 'REVIEW'
      && refreshed?.decision === 'REVIEW'
      && refreshed.assessment_hash === original.assessment_hash
      && stableJsonUtf8(refreshed.source_fence) === stableJsonUtf8(original.source_fence)
      && sourceFenceCurrent
      && hasAcceptedReviewReceipt(bundle, run, original);
    if (!originalReuseCurrent && !acceptedReviewCurrent) {
      const assessment: ReuseAssessment = refreshed
        ? {
            ...refreshed,
            decision: refreshed.decision === 'REUSE' ? 'REVIEW' : refreshed.decision,
            reason_codes: refreshed.decision === 'REUSE'
              ? [...new Set([...refreshed.reason_codes, 'FRESHNESS_UNKNOWN' as const])]
              : refreshed.reason_codes,
          }
        : { ...original, decision: 'REJECT', reason_codes: [...new Set([...original.reason_codes, 'ARTIFACT_INVALID' as const])] };
      assessments.push(assessment);
      if (run.input.consumes.includes(original.source_fence.artifact_id)) {
        blockers.push(`artifact ${original.source_fence.artifact_id} reuse fence is no longer current or accepted`);
      }
      continue;
    }
    assessments.push(refreshed);
    if (!run.input.consumes.includes(original.source_fence.artifact_id)) {
      blockers.push(`artifact ${original.source_fence.artifact_id} is not bound in run.input.consumes`);
      continue;
    }
    const alias = original.consumer.alias ?? original.source_fence.artifact_id;
    const artifact = bundle.artifacts.artifacts[original.source_fence.artifact_id];
    upstream[alias] = {
      artifact_id: original.source_fence.artifact_id,
      path: `sessions/${bundle.session.session_id}/${artifact.relative_path}`,
      kind: artifact.kind,
      status: 'sealed',
    };
  }
  return { upstream, assessments, blockers };
}

/**
 * Explicitly accept one REVIEW assessment. The receipt binds the exact
 * assessment hash and source fence; run.input.consumes is updated in the same
 * authority transaction, so an Artifact Registry candidate alone never opens
 * the required consume gate.
 */
export function acceptRunReuse(
  projectRoot: string,
  runId: string,
  assessmentHash: string,
  sessionId: string | undefined,
  options: AcceptReuseOptions,
): AcceptReuseResult {
  const actor = options.actor.trim();
  const reason = options.reason.trim();
  const evidence = options.evidence.map(item => item.trim()).filter(Boolean);
  if (!actor) throw new Error('reuse acceptance requires a non-empty actor');
  if (!reason) throw new Error('reuse acceptance requires a non-empty reason');
  if (evidence.length === 0) throw new Error('reuse acceptance requires at least one evidence reference');
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const initialBundle = store.readBundle(located.sessionId);
  const initialRun = located.run;
  const assessment = (initialRun.input.reuse_assessments as ReuseAssessment[])
    .find(item => item.assessment_hash === assessmentHash);
  if (!assessment) throw new Error(`reuse assessment not found: ${assessmentHash}`);
  if (assessment.decision !== 'REVIEW') {
    throw new Error(`reuse assessment ${assessmentHash} is ${assessment.decision}, expected REVIEW`);
  }
  const resolvedContract = contractForRun(projectRoot, initialRun).contract;
  const prepared = prepareTransitionMutation({
    session: initialBundle.session,
    currentFence: store.readSessionFence(located.sessionId, runId),
    operation: 'accept-reuse',
    subject: { session_id: located.sessionId, run_id: runId, chain_step_id: initialRun.chain_step_id },
    payload: {
      run_id: runId,
      assessment_hash: assessment.assessment_hash,
      artifact_id: assessment.source_fence.artifact_id,
      source_fence: assessment.source_fence,
      actor,
      reason,
      evidence,
    },
    options,
  });
  const evaluated = store.replayOrApplyTransition(located.sessionId, prepared.request, (draft, tx) => {
    assertTransitionMutationRevisions(draft.session, prepared.options);
    const leaseConflict = checkLease(draft.session.orchestration.lease, prepared.options.leaseClaim ?? {});
    if (leaseConflict) throw new Error(leaseConflict);
    const run = tx.readRun(runId);
    if (run.status === 'sealed' || run.status === 'completed') {
      throw new Error(`Run ${runId} is ${run.status} and immutable`);
    }
    const stored = (run.input.reuse_assessments as ReuseAssessment[])
      .find(item => item.assessment_hash === assessment.assessment_hash);
    const current = collectReusableUpstream(
      projectRoot, store, draft.session, draft.artifacts, draft.gates, resolvedContract,
    ).assessments.find(item => item.assessment_hash === assessment.assessment_hash);
    if (!stored || stored.decision !== 'REVIEW'
      || !current || current.decision !== 'REVIEW'
      || stableJsonUtf8(stored.source_fence) !== stableJsonUtf8(assessment.source_fence)
      || stableJsonUtf8(current.source_fence) !== stableJsonUtf8(assessment.source_fence)) {
      throw new TransitionReceiptError(
        'FENCE_CONFLICT',
        `reuse assessment ${assessment.assessment_hash} no longer matches its REVIEW source fence`,
      );
    }
    if (!run.input.consumes.includes(assessment.source_fence.artifact_id)) {
      run.input.consumes.push(assessment.source_fence.artifact_id);
    }
    const context: EvaluationContext = {
      projectRoot,
      runDir: store.runDir(located.sessionId, runId),
      session: draft.session,
      registry: draft.artifacts,
      scan: { artifacts: [], warnings: [], errors: [] },
      evidence: draft.evidence,
      run,
    };
    for (const gateId of run.gate_ids) {
      const gate = draft.gates.gates[gateId];
      if (gate?.scope === 'entry') gate.status = evaluateGate(gate, context);
    }
    summarizeRegistry(draft.gates);
    const entryGates = gateSummary(
      draft.gates,
      run.gate_ids.filter(gateId => draft.gates.gates[gateId]?.scope === 'entry'),
    );
    if (run.status === 'blocked' && entryGates.blocking.length === 0) run.status = 'running';
    draft.session.activity_revision++;
    tx.writeRun(run);
    const acceptance = {
      run_id: runId,
      assessment_hash: assessment.assessment_hash,
      artifact_id: assessment.source_fence.artifact_id,
      source_fence: assessment.source_fence,
      actor,
      reason,
      evidence,
    };
    const result = {
      session_id: located.sessionId,
      run_id: runId,
      artifact_id: assessment.source_fence.artifact_id,
      assessment_hash: assessment.assessment_hash,
      run_status: run.status,
      consumes: [...run.input.consumes],
      entry_gates: entryGates,
    };
    return createTransitionOutcome({
      request_id: prepared.request.request_id,
      request_hash: prepared.request.normalized_request_hash,
      operation: 'accept-reuse', status: 'applied', applied_at: new Date().toISOString(),
      subject: prepared.request.subject,
      postconditions: {
        session_identity_revision: draft.session.identity_revision,
        session_activity_revision: draft.session.activity_revision,
        active_run_id: draft.session.active_run_id,
        run_hash: protocolSha256(`${JSON.stringify(run, null, 2)}\n`),
        artifact_registry_revision: draft.artifacts.revision,
      },
      exit_code: 0, error_code: null, result: { acceptance, value: result },
    });
  });
  return {
    ...(structuredClone(evaluated.outcome.result.value) as Omit<AcceptReuseResult, 'transition'>),
    transition: transitionMutationReceipt(prepared.request, evaluated.outcome, evaluated.replayed),
  };
}

function argumentHint(raw: string): string {
  const match = raw.match(/^---\s*\r?\n[\s\S]*?^argument-hint:\s*(["']?)(.*?)\1\s*$[\s\S]*?^---\s*$/m);
  return match?.[2]?.trim() ?? '';
}

function argumentDefinitions(source: ReturnType<typeof resolveCommandSource>): SkillParamDef[] {
  if (source.contract.contract_version === 2.1 && source.contract.arguments.length > 0) {
    return source.contract.arguments.map(item => ({ ...item, positional: !item.name.startsWith('-') }));
  }
  return parseArgumentHint(argumentHint(source.raw));
}

export function resolveArgumentRequirements(
  projectRoot: string,
  command: string,
  args: string[],
): ArgumentRequirement[] {
  const source = resolveCommandSource(projectRoot, command);
  const definitions = argumentDefinitions(source);
  const strictDefaults = new Map(source.contract.arguments.map(item => [item.name, item.default]));
  const actual = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const byName = new Map(definitions.map(item => [item.name, item]));
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('-')) {
      positionals.push(value);
      continue;
    }
    const equals = value.indexOf('=');
    const name = equals === -1 ? value : value.slice(0, equals);
    const definition = byName.get(name);
    if (!definition) {
      if (equals === -1 && index + 1 < args.length && !args[index + 1].startsWith('-')) index++;
      continue;
    }
    if (definition.type === 'boolean') {
      actual.set(name, true);
    } else if (equals !== -1) {
      actual.set(name, value.slice(equals + 1));
    } else if (index + 1 < args.length && !args[index + 1].startsWith('-')) {
      actual.set(name, args[++index]);
    }
  }
  let positionalIndex = 0;
  return definitions.map(definition => {
    const value = definition.positional
      ? positionals[positionalIndex++]
      : actual.get(definition.name);
    const fallback = strictDefaults.get(definition.name);
    const sourceKind: ArgumentRequirement['source'] = value !== undefined
      ? 'actual-arg'
      : fallback !== undefined
        ? 'contract-default'
        : 'unresolved';
    const required = definition.required === true;
    const missing = required && value === undefined && fallback === undefined;
    const strict = source.contract.arguments.find(item => item.name === definition.name);
    return {
      name: definition.name,
      required,
      missing,
      type: definition.type,
      source: sourceKind,
      ...(fallback !== undefined ? { default: fallback } : {}),
      ...(missing ? { question: strict?.question ?? `Provide required argument ${definition.name}` } : {}),
    };
  });
}

/** Compact a full Handoff into the shared PrevHandoff summary shape. */
function toPrevHandoff(handoff: Handoff): PrevHandoff {
  return {
    run_id: handoff.producer_run_id,
    command: handoff.command,
    verdict: handoff.verdict,
    summary: handoff.summary,
    decisions: handoff.decisions.map(d => d.text),
    concerns: handoff.concerns,
  };
}

/**
 * Latest sealed Run's handoff at or before `beforeSequence` (exclusive), scanning
 * the session's runs by descending sequence. When `beforeSequence` is undefined
 * the newest sealed handoff wins. Returns null when no sealed handoff exists.
 */
function latestHandoffBefore(
  store: SessionStore,
  sessionId: string,
  beforeSequence?: number,
): PrevHandoff | null {
  const runsDir = join(store.sessionDir(sessionId), 'runs');
  if (!existsSync(runsDir)) return null;
  const runIds = readdirSync(runsDir).filter(name => existsSync(join(runsDir, name, 'run.json')));
  let best: { sequence: number; handoff: Handoff } | null = null;
  for (const runId of runIds) {
    let run: CommandRun;
    try {
      run = store.readRun(sessionId, runId);
    } catch {
      continue;
    }
    if (!run.handoff) continue;
    if (beforeSequence !== undefined && run.sequence >= beforeSequence) continue;
    if (!best || run.sequence > best.sequence) best = { sequence: run.sequence, handoff: run.handoff };
  }
  return best ? toPrevHandoff(best.handoff) : null;
}

/** Prev handoff via session.latest_completed_run_id (fast path for step-drivers). */
function handoffByLatestCompleted(store: SessionStore, session: SessionState): PrevHandoff | null {
  const runId = session.latest_completed_run_id;
  if (!runId) return null;
  try {
    const run = store.readRun(session.session_id, runId);
    return run.handoff ? toPrevHandoff(run.handoff) : null;
  } catch {
    return null;
  }
}

/**
 * Build the shared session anchor grounding sections (Intent / Boundary
 * Contract / Execution Progress). Progress is derived from the orchestration
 * chain crossed with each completed Run's handoff.summary; an empty chain omits
 * the Progress section. Reuses the P0 inject builders.
 */
function buildAnchorSections(store: SessionStore, session: SessionState): AnchorSection {
  const chain = session.orchestration.chain;
  const completed = chain.filter(s => (s.status === 'completed' || s.status === 'sealed') && s.run_id);
  const completedHandoffs: Handoff[] = [];
  const recent = completed.slice(-5).map(s => {
    let summary: string | null = null;
    if (s.run_id) {
      try {
        const handoff = store.readRun(session.session_id, s.run_id).handoff;
        summary = handoff?.summary ?? null;
        if (handoff) completedHandoffs.push(handoff);
      } catch {
        summary = null;
      }
    }
    return {
      step_id: s.step_id,
      command: s.command,
      stage: null,
      summary,
      caveats: null,
    };
  });
  const progress = chain.length > 0
    ? buildProgressSection({
        recent,
        done_count: completed.length,
        pending_count: chain.filter(s => s.status === 'pending').length,
      })
    : null;
  return {
    intent: buildIntentSection(session.intent),
    boundary_contract: buildBoundaryContractSection(session.boundary_contract),
    progress,
    signals: buildSignalsSection({
      caveats: completedHandoffs.flatMap(handoff => handoff.concerns).slice(-3),
      deferred: completedHandoffs.flatMap(handoff => handoff.next.map(item => item.reason || item.command)).slice(-5),
    }),
  };
}

function explicitGate(
  definition: ContractGateDefinition,
  scope: 'entry' | 'exit',
  runId: string,
  id: string,
): Gate {
  if (typeof definition === 'string') {
    return {
      key: definition,
      title: definition,
      scope,
      run_id: runId,
      required: false,
      blocking: false,
      applicable_modes: [],
      status: 'skipped',
      check: { type: 'manual', prompt: definition },
      evidence_refs: [],
      waiver: null,
    };
  }
  return gateSchema.parse({
    key: definition.key,
    title: definition.title ?? definition.key,
    scope,
    run_id: runId,
    required: definition.required,
    blocking: definition.blocking,
    applicable_modes: definition.applicable_modes,
    status: 'pending',
    check: explicitGateCheckSchema.parse(definition.check),
    evidence_refs: [],
    waiver: null,
  });
}

function registerRunGates(registry: GateRegistry, contract: CommandContract, runId: string, sequence: number): string[] {
  let ordinal = 0;
  const ids: string[] = [];
  const add = (gate: Gate): void => {
    ordinal++;
    const id = `GATE-${String(sequence).padStart(3, '0')}-${String(ordinal).padStart(2, '0')}`;
    registry.gates[id] = gate;
    ids.push(id);
  };
  for (const consume of contract.consumes) {
    add({
      key: `consume-${consume.alias ?? consume.kind}`,
      title: `Resolve required ${consume.kind} input`,
      scope: 'entry',
      run_id: runId,
      required: consume.required,
      blocking: consume.required,
      applicable_modes: [],
      status: 'pending',
      check: {
        type: 'artifact',
        kind: consume.kind,
        ...(consume.alias ? { alias: consume.alias } : {}),
        ...(consume.require_status ? { require_status: consume.require_status } : {}),
      },
      evidence_refs: [],
      waiver: null,
    });
  }
  for (const definition of contract.gates.entry) {
    ordinal++;
    const id = `GATE-${String(sequence).padStart(3, '0')}-${String(ordinal).padStart(2, '0')}`;
    registry.gates[id] = explicitGate(definition, 'entry', runId, id);
    ids.push(id);
  }
  for (const produce of contract.produces) {
    // Legacy v1 contracts do not have enforceable output requiredness. The
    // parser deliberately normalizes those outputs to required=false; only an
    // explicit v2/v2.1 `required: true` declaration may create a blocking gate.
    const required = produce.required === true;
    add({
      key: `produce-${produce.kind}`,
      title: `Produce ${produce.kind}`,
      scope: 'exit',
      run_id: runId,
      required,
      blocking: required,
      applicable_modes: [],
      status: 'pending',
      check: { type: 'artifact', kind: produce.kind, ...(produce.alias ? { alias: produce.alias } : {}) },
      evidence_refs: [],
      waiver: null,
    });
    if ((contract.contract_version === 2 || contract.contract_version === 2.1) && produce.schema) {
      add({
        key: `produce-schema-${produce.alias ?? produce.kind}`,
        title: `Validate ${produce.kind} schema`,
        scope: 'exit',
        run_id: runId,
        required,
        blocking: required,
        applicable_modes: [],
        status: 'pending',
        check: { type: 'schema', artifact_ref: produce.alias ?? produce.kind, schema_id: produce.schema },
        evidence_refs: [],
        waiver: null,
      });
    }
  }
  for (const definition of contract.gates.exit) {
    ordinal++;
    const id = `GATE-${String(sequence).padStart(3, '0')}-${String(ordinal).padStart(2, '0')}`;
    registry.gates[id] = explicitGate(definition, 'exit', runId, id);
    ids.push(id);
  }
  registry.revision++;
  summarizeRegistry(registry);
  return ids;
}

function artifactForGate(gate: Gate, context: EvaluationContext): { status: string; schema: string } | null {
  const check = gate.check;
  if (check.type !== 'artifact' && check.type !== 'schema') return null;
  if (check.type === 'artifact') {
    if (gate.scope === 'exit') {
      const found = context.scan.artifacts.find(item =>
        item.kind === check.kind && (!check.alias || item.alias === check.alias),
      );
      return found ? { status: 'draft', schema: found.schemaVersion } : null;
    }
    const consumed = new Set(context.run.input.consumes);
    if (check.alias) {
      const artifactId = context.registry.aliases[check.alias];
      const artifact = artifactId ? context.registry.artifacts[artifactId] : undefined;
      if (artifactId && consumed.has(artifactId) && artifact && artifact.kind === check.kind) {
        return { status: artifact.status, schema: artifact.schema_version };
      }
      return null;
    }
    const artifact = Object.entries(context.registry.artifacts)
      .find(([artifactId, item]) => consumed.has(artifactId) && item.kind === check.kind)?.[1];
    if (artifact) return { status: artifact.status, schema: artifact.schema_version };
    return null;
  }
  if (gate.scope === 'exit') {
    const found = context.scan.artifacts.find(item =>
      item.alias === check.artifact_ref || item.kind === check.artifact_ref,
    );
    if (found) return { status: 'draft', schema: found.schemaVersion };
  }
  const byAlias = context.registry.aliases[check.artifact_ref];
  const artifact = context.registry.artifacts[byAlias ?? check.artifact_ref];
  return artifact ? { status: artifact.status, schema: artifact.schema_version } : null;
}

function dottedValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function evaluateGate(gate: Gate, context: EvaluationContext): Gate['status'] {
  if (gate.waiver) return 'waived';
  if (gate.applicable_modes.length > 0 && !gate.applicable_modes.includes(context.session.orchestration.quality_mode)) {
    return 'skipped';
  }
  switch (gate.check.type) {
    case 'artifact': {
      const artifact = artifactForGate(gate, context);
      if (!artifact) return gate.required ? 'failed' : 'skipped';
      if (gate.check.require_status === 'sealed' && artifact.status !== 'sealed') return 'failed';
      return 'passed';
    }
    case 'schema': {
      const artifact = artifactForGate(gate, context);
      return artifact?.schema === gate.check.schema_id ? 'passed' : 'failed';
    }
    case 'session':
      return Object.is(dottedValue(context.session, gate.check.field), gate.check.equals) ? 'passed' : 'failed';
    case 'file': {
      const path = gate.check.path.startsWith('outputs/')
        ? join(context.runDir, gate.check.path)
        : join(context.projectRoot, gate.check.path);
      return existsSync(path) === gate.check.exists ? 'passed' : 'failed';
    }
    case 'decision': {
      const check = gate.check;
      const reportMatch = context.reportDecisions?.some(decision =>
        decision.id === check.point && decision.status === check.outcome,
      );
      if (reportMatch) return 'passed';
      const matched = Object.values(context.evidence.records).some(record =>
        record.point === check.point && record.outcome === check.outcome && record.status === 'accepted',
      );
      return matched ? 'passed' : 'failed';
    }
    case 'command': {
      const result = spawnSync(gate.check.argv[0], gate.check.argv.slice(1), {
        cwd: context.projectRoot,
        shell: process.platform === 'win32',
        stdio: 'ignore',
      });
      return result.status === gate.check.expect_exit ? 'passed' : 'failed';
    }
    case 'manual':
      return gate.required ? 'pending' : 'skipped';
  }
}

function evaluateRunGates(bundle: SessionBundle, run: CommandRun, context: EvaluationContext): GateSummary {
  let changed = false;
  for (const id of run.gate_ids) {
    const gate = bundle.gates.gates[id];
    if (gate) {
      const next = evaluateGate(gate, context);
      if (next !== gate.status) {
        gate.status = next;
        changed = true;
      }
    }
  }
  if (changed) bundle.gates.revision++;
  summarizeRegistry(bundle.gates);
  return gateSummary(bundle.gates, run.gate_ids);
}

function isFailureVerdict(verdict: CompletionVerdict | undefined): boolean {
  return verdict === 'needs-retry' || verdict === 'blocked';
}

/**
 * A failed attempt is allowed to end without pretending that its successful
 * output contract was satisfied. Exit gates belong to the success path, so
 * mark them not-applicable while retaining entry-gate and scan diagnostics.
 */
function skipExitGatesForFailedAttempt(bundle: SessionBundle, run: CommandRun): GateSummary {
  let changed = false;
  for (const id of run.gate_ids) {
    const gate = bundle.gates.gates[id];
    if (!gate || gate.scope !== 'exit' || gate.status === 'passed' || gate.status === 'waived') continue;
    gate.status = 'skipped';
    changed = true;
  }
  if (changed) bundle.gates.revision++;
  summarizeRegistry(bundle.gates);
  return gateSummary(bundle.gates, run.gate_ids);
}

function summarizeRegistry(registry: GateRegistry): void {
  const entries = Object.entries(registry.gates);
  const active = entries.filter(([, gate]) => ['pending', 'running', 'failed', 'blocked'].includes(gate.status));
  const blocking = active.find(([, gate]) => gate.blocking);
  registry.summary = {
    total: entries.length,
    passed: entries.filter(([, gate]) => gate.status === 'passed').length,
    blocked: entries.filter(([, gate]) => gate.status === 'blocked').length,
    failed: entries.filter(([, gate]) => gate.status === 'failed').length,
    active_gate_ids: active.map(([id]) => id),
    blocking_run_id: blocking?.[1].run_id ?? null,
  };
}

function gateSummary(registry: GateRegistry, ids: string[]): GateSummary {
  const summary: GateSummary = { passed: [], failed: [], skipped: [], blocking: [] };
  for (const id of ids) {
    const gate = registry.gates[id];
    if (!gate) continue;
    if (gate.status === 'passed' || gate.status === 'waived') summary.passed.push(id);
    else if (gate.status === 'skipped') summary.skipped.push(id);
    else summary.failed.push(id);
    if (gate.blocking && !['passed', 'waived', 'skipped'].includes(gate.status)) summary.blocking.push(id);
  }
  return summary;
}

function contractForRun(
  projectRoot: string,
  run: CommandRun,
): { contract: CommandContract; warning: string | null } {
  const source = resolveCommandSource(projectRoot, run.command.name);
  const currentContractHash = contractHash(source.contract);
  if (run.contract_snapshot) {
    if (source.contractSnapshot.snapshot_hash !== run.contract_snapshot.snapshot_hash) {
      throw new Error(
        `Command lifecycle contract changed after run creation: ${run.command.name} `
        + `(expected ${run.contract_snapshot.snapshot_hash}, got ${source.contractSnapshot.snapshot_hash})`,
      );
    }
    return {
      contract: source.contract,
      warning: source.contentHash === run.command.content_hash
        ? null
        : `Command prompt changed after run creation: ${run.command.name}; lifecycle contract is unchanged`,
    };
  }
  if (run.command.contract_hash) {
    if (currentContractHash !== run.command.contract_hash) {
      throw new Error(
        `Command lifecycle contract changed after run creation: ${run.command.name} `
        + `(expected ${run.command.contract_hash}, got ${currentContractHash})`,
      );
    }
    return {
      contract: source.contract,
      warning: source.contentHash === run.command.content_hash
        ? null
        : `Command prompt changed after run creation: ${run.command.name}; lifecycle contract is unchanged`,
    };
  }
  if (source.contentHash !== run.command.content_hash) {
    throw new Error(
      `Command definition changed after run creation: ${run.command.name}; `
      + `legacy Run has no contract_hash. Rebind prompt-only drift with: `
      + `maestro run rebind ${run.run_id} --session ${run.session_id} --reason "<reason>"`,
    );
  }
  return { contract: source.contract, warning: null };
}

function gateContractShape(gate: Gate): string {
  return stableJson({
    key: gate.key,
    title: gate.title,
    scope: gate.scope,
    run_id: gate.run_id,
    required: gate.required,
    blocking: gate.blocking,
    applicable_modes: gate.applicable_modes,
    check: gate.check,
  });
}

function assertRebindCompatible(
  registry: GateRegistry,
  run: CommandRun,
  source: ReturnType<typeof resolveCommandSource>,
): void {
  const expectedRegistry = createGateRegistry();
  const expectedIds = registerRunGates(expectedRegistry, source.contract, run.run_id, run.sequence);
  if (stableJson(expectedIds) !== stableJson(run.gate_ids)) {
    throw new Error('Cannot rebind: current lifecycle contract produces a different Run gate set');
  }
  for (const id of expectedIds) {
    const expected = expectedRegistry.gates[id];
    const actual = registry.gates[id];
    if (!actual || gateContractShape(actual) !== gateContractShape(expected)) {
      throw new Error(`Cannot rebind: registered gate ${id} differs from the current lifecycle contract`);
    }
  }
  if (run.contract_snapshot) {
    if (stableJson(run.contract_snapshot.normalized) !== stableJson(source.contractSnapshot.normalized)) {
      throw new Error('Cannot rebind: stored and current lifecycle contract semantics differ');
    }
    return;
  }
  const unrecoverableProduce = source.contract.produces.find(produce => produce.path || produce.primary);
  if (unrecoverableProduce) {
    throw new Error(
      `Cannot rebind: legacy Run cannot prove path/primary compatibility for produce ${unrecoverableProduce.kind}; `
      + 'create a retry Run instead',
    );
  }
}

function scanSummary(scan: ArtifactScanResult): CheckRunResult['artifacts'] {
  return scan.artifacts.map(item => ({
    path: item.relativePath,
    kind: item.kind,
    role: item.role,
    ...(item.alias ? { alias: item.alias } : {}),
  }));
}

function ensureRunShell(store: SessionStore, sessionId: string, runId: string): string {
  const runDir = store.runDir(sessionId, runId);
  mkdirSync(join(runDir, 'outputs'), { recursive: true });
  mkdirSync(join(runDir, 'evidence'), { recursive: true });
  mkdirSync(join(runDir, 'work'), { recursive: true });
  const report = join(runDir, 'report.md');
  if (!existsSync(report)) {
    writeFileSync(report, '---\nverdict: ready\nsummary: ""\nconstraints: []\ndecisions: []\ncaveats: []\nopen_questions: []\nnext: []\n---\n## 摘要\n\n## 结论/Verdict\n\n## 讨论/复盘\n\n## 产物\n\n## 交接/Next\n', 'utf8');
  }
  writeFileSync(join(runDir, 'diagnostics.ndjson'), '', { flag: 'a' });
  return runDir;
}

function validateSealedIntegrity(
  run: CommandRun,
  registry: ArtifactRegistry,
  scan: ArtifactScanResult,
): void {
  const sealed = Object.entries(registry.artifacts).filter(([, item]) => item.producer_run_id === run.run_id);
  if (sealed.length !== scan.artifacts.length) throw new Error(`Sealed run ${run.run_id} artifact set changed`);
  for (const [, artifact] of sealed) {
    const current = scan.artifacts.find(item => item.relativePath === artifact.relative_path);
    if (!current || current.contentHash !== artifact.content_hash) {
      throw new Error(`Sealed artifact is immutable: ${artifact.relative_path}`);
    }
  }
}

export function createRun(options: CreateRunOptions): CreateRunResult {
  const store = new SessionStore(options.projectRoot);
  const state = projectState(options.projectRoot);
  const explicitSession = options.sessionId && store.sessionExists(options.sessionId)
    ? store.readBundle(options.sessionId).session
    : null;
  const intent = options.intent?.trim() || explicitSession?.intent || options.command;
  const topic = options.topic?.trim()
    || explicitSession?.topic_identity?.verbatim
    || explicitSession?.intent
    || intent;
  const intentIdentity = options.intentIdentity ?? createIntentIdentity(options.projectRoot, options.command, intent);
  const source = resolveCommandSource(options.projectRoot, options.command);

  if (source.sessionMode === 'none') {
    throw new Error(
      `Command "${options.command}" declares session-mode: none and cannot create a Run. `
      + `Use it directly without the run lifecycle.`,
    );
  }
  if (source.sessionMode === 'brief') {
    throw new Error(
      `Command "${options.command}" declares session-mode: brief. `
      + `Use "maestro run skill ${options.command}" instead of "maestro run create".`,
    );
  }
  const argumentRequirements = resolveArgumentRequirements(options.projectRoot, options.command, options.args ?? []);
  const missingArguments = argumentRequirements.filter(item => item.required && item.missing);
  if (missingArguments.length > 0) {
    throw new Error(`Missing required arguments: ${missingArguments.map(item => `${item.name} (${item.question})`).join(', ')}`);
  }

  const resolvedSession = resolveSessionId(
    store,
    options.sessionId,
    topic,
    options.topic ? 'explicit' : options.chainStepId ? 'workflow' : 'legacy-intent',
  );
  const { sessionId, topicIdentity } = resolvedSession;
  const sessionExisted = store.sessionExists(sessionId);
  if (!sessionExisted) {
    store.createSession(sessionId, intent, {
      command: options.command,
      intentIdentity,
      ...(options.sessionProvenance ? { provenance: options.sessionProvenance } : {}),
    });
  }

  return store.update(sessionId, (bundle, tx) => {
    if (bundle.session.active_run_id) {
      throw new Error(
        `Session ${sessionId} already has active Run ${bundle.session.active_run_id}; `
        + `inspect it with: maestro run brief ${bundle.session.active_run_id} --session ${sessionId}`,
      );
    }
    if ((bundle.session.topic_identity && !sameTopicIdentity(bundle.session.topic_identity, topicIdentity))
      || (!bundle.session.topic_identity && sessionExisted && normalizeTopic(bundle.session.intent) !== topicIdentity.normalized)) {
      throw new Error(`Session ${sessionId} topic identity changed after resolution`);
    }
    if (!bundle.session.intent_identity) {
      bundle.session.intent_identity = intentIdentity;
    }
    let boundStep: SessionState['orchestration']['chain'][number] | null = null;
    let chainStepId = options.chainStepId;
    if (options.retryToken && !chainStepId) {
      const retryStep = bundle.session.orchestration.chain.find(
        step => step.pending_retry?.token === options.retryToken,
      );
      if (!retryStep) throw new Error('invalid, expired, or already-consumed retry token');
      chainStepId = retryStep.step_id;
    }
    if (chainStepId) {
      if (bundle.session.status !== 'running') {
        throw new Error(`Session ${sessionId} is ${bundle.session.status}; chain dispatch requires running status`);
      }
      if (
        options.expectedActivityRevision !== undefined
        && bundle.session.activity_revision !== options.expectedActivityRevision
      ) {
        throw new Error(
          `Session ${sessionId} changed after run-next preflight `
          + `(expected activity_revision ${options.expectedActivityRevision}, got ${bundle.session.activity_revision})`,
        );
      }
      if (
        options.expectedIdentityRevision !== undefined
        && bundle.session.identity_revision !== options.expectedIdentityRevision
      ) {
        throw new Error(
          `Session ${sessionId} identity changed after run-next preflight `
          + `(expected identity_revision ${options.expectedIdentityRevision}, got ${bundle.session.identity_revision})`,
        );
      }
      const conflict = checkLease(bundle.session.orchestration.lease, options.leaseClaim ?? {});
      if (conflict) throw new Error(conflict);
      const running = bundle.session.orchestration.chain.find(step => step.status === 'running');
      if (running) throw new Error(`chain step already running: ${running.step_id}`);
      boundStep = bundle.session.orchestration.chain.find(step => step.step_id === chainStepId) ?? null;
      if (!boundStep) throw new Error(`chain step not found: ${chainStepId}`);
      if (boundStep.status !== 'pending') {
        throw new Error(`chain step ${boundStep.step_id} is ${boundStep.status}, not pending`);
      }
      if (boundStep.decision_ref) throw new Error(`chain step ${boundStep.step_id} is a decision node`);
      if (boundStep.command !== options.command) {
        throw new Error(`chain step ${boundStep.step_id} expects command ${boundStep.command}, got ${options.command}`);
      }
      const boundIndex = bundle.session.orchestration.chain.findIndex(step => step.step_id === boundStep!.step_id);
      const earlierDecision = bundle.session.orchestration.chain
        .slice(0, boundIndex)
        .find(step => {
          if (!step.decision_ref) return false;
          const point = bundle.session.orchestration.decision_points
            .find(item => item.point_id === step.decision_ref);
          const stepTerminal = step.status === 'sealed' || step.status === 'completed';
          return !stepTerminal || point?.status !== 'passed';
        });
      if (earlierDecision) {
        const point = bundle.session.orchestration.decision_points
          .find(item => item.point_id === earlierDecision.decision_ref);
        throw new Error(
          `earlier decision ${earlierDecision.decision_ref} is ${point?.status ?? 'pending'} `
          + `and gates chain step ${boundStep.step_id}`,
        );
      }
    }

    if (!bundle.session.topic_identity) {
      bundle.session.topic_identity = topicIdentity;
      bundle.session.identity_revision++;
    }
    if (!options.sessionId) {
      const candidates = runningTopicCandidatesLocked(store, topicIdentity, bundle.session);
      const resolved = uniqueTopicCandidate(
        candidates.some(item => item.session.topic_identity) ? 'Running topic match' : 'Legacy exact intent match',
        candidates,
      );
      if (resolved !== sessionId) {
        throw new Error(`Topic Session selection changed after resolution; expected ${sessionId}, got ${resolved ?? 'none'}`);
      }
    }

    const freshState = projectState(options.projectRoot);
    const sequence = nextSequence(store, sessionId);
    const runId = `${dateId()}-${String(sequence).padStart(3, '0')}-${slug(options.command, 'run')}`;
    const now = localISO();
    const resolvedPlatform = resolveTargetPlatform(options.platform, undefined, bundle.session);
    let parentRunId: string | null = null;
    if (boundStep?.pending_retry) {
      const pending = boundStep.pending_retry;
      if (!options.retryToken) throw new Error(`chain step ${boundStep.step_id} requires its pending retry token`);
      if (pending.token !== options.retryToken) throw new Error('retry token does not match the requested chain step');
      if (pending.session_id !== sessionId) throw new Error(`retry token belongs to Session ${pending.session_id}`);
      if (pending.chain_step_id !== boundStep.step_id) throw new Error('retry token chain step mismatch');
      if (pending.command !== options.command) throw new Error(`retry token is for command ${pending.command}`);
      if (Date.parse(pending.expires_at) <= Date.now()) throw new Error('retry token has expired');
      const parent = tx.readRun(pending.parent_run_id);
      if (parent.session_id !== sessionId) throw new Error(`retry parent belongs to Session ${parent.session_id}`);
      if (parent.command.name !== options.command) throw new Error('retry parent command mismatch');
      if (parent.chain_step_id !== boundStep.step_id) throw new Error('retry parent chain step mismatch');
      if (parent.sequence >= sequence) throw new Error('retry parent must precede the replacement Run');
      if (!parent.retry_fence || parent.retry_fence.token !== pending.token) {
        throw new Error('retry parent fence does not match the pending token');
      }
      if (parent.retry_fence.consumed_at) throw new Error('retry token was already consumed');
      parent.retry_fence.consumed_at = now;
      boundStep.pending_retry = null;
      parentRunId = parent.run_id;
      tx.writeRun(parent);
    } else if (options.retryToken) {
      throw new Error('invalid, expired, or already-consumed retry token');
    }
    const runDir = ensureRunShell(store, sessionId, runId);
    const gateIds = registerRunGates(bundle.gates, source.contract, runId, sequence);
    const reuse = collectReusableUpstream(
      options.projectRoot,
      store,
      bundle.session,
      bundle.artifacts,
      bundle.gates,
      source.contract,
    );
    const upstream = reuse.upstream;
    const guidanceSnapshot = buildGuidanceSnapshot(options.projectRoot, options.command, source);
    const creationMode = options.creation?.mode
      ?? (options.retryToken ? 'retry' : boundStep ? 'chain-next' : 'explicit-create');
    const run: CommandRun = {
      schema_version: 'command-run/1.3',
      session_id: sessionId,
      run_id: runId,
      sequence,
      parent_run_id: parentRunId,
      chain_step_id: boundStep?.step_id ?? null,
      resolved_platform: resolvedPlatform,
      goal_binding: null,
      checkpoint_expectation: null,
      checkpoint: null,
      retry_fence: null,
      contract_snapshot: source.contractSnapshot,
      guidance_snapshot: guidanceSnapshot,
      creation_decision: {
        schema_version: 'creation-decision/1.0',
        decision_id: `dec_${sha256(`${sessionId}\u0000${runId}\u0000${now}`).slice(0, 24)}`,
        request_id: options.creation?.requestId ?? null,
        mode: creationMode,
        authority: options.creation?.authority ?? (boundStep ? 'chain-transition' : 'explicit-command'),
        decided_at: now,
        session_identity_revision: bundle.session.identity_revision,
        session_activity_revision: bundle.session.activity_revision,
        confirmation_token_hash: options.creation?.confirmationTokenHash ?? null,
      },
      creation_provenance: options.creation?.provenance ?? {
        schema_version: 'creation-provenance/1.0',
        provenance: 'native-v2',
        source_workspace_id: null,
        source_session_id: null,
        source_run_id: parentRunId,
        imported_artifact_hashes: [],
      },
      transition: options.creation?.transition ?? null,
      command: {
        name: options.command,
        version: '1.0',
        source_path: source.relativePath,
        content_hash: source.contentHash,
        resolved_prompt_hash: sha256(source.raw),
        contract_hash: contractHash(source.contract),
      },
      status: 'running',
      input: {
        args: options.args ?? [],
        consumes: Object.values(upstream).map(item => item.artifact_id),
        context_identity_revision: bundle.session.identity_revision,
        reuse_assessments: reuse.assessments,
      },
      gate_ids: gateIds,
      output: { produces: [], primary_artifact_id: null, verdict: null },
      handoff: null,
      started_at: now,
      completed_at: null,
      sealed_at: null,
    };

    const emptyScan: ArtifactScanResult = { artifacts: [], warnings: [], errors: [] };
    const entryContext: EvaluationContext = {
      projectRoot: options.projectRoot,
      runDir,
      session: bundle.session,
      registry: bundle.artifacts,
      scan: emptyScan,
      evidence: bundle.evidence,
      run,
    };
    for (const id of gateIds) {
      const gate = bundle.gates.gates[id];
      if (gate?.scope === 'entry') gate.status = evaluateGate(gate, entryContext);
    }
    summarizeRegistry(bundle.gates);
    const entrySummary = gateSummary(bundle.gates, gateIds.filter(id => bundle.gates.gates[id]?.scope === 'entry'));
    const entryBlockers = entrySummary.blocking.slice(0, 5).map(gateId => {
      const gate = bundle.gates.gates[gateId]!;
      return { gate_id: gateId, title: gate.title, status: gate.status };
    });
    if (entrySummary.blocking.length > 0) run.status = 'blocked';

    bundle.session.active_run_id = runId;
    if (boundStep) {
      boundStep.status = 'running';
      boundStep.run_id = runId;
      const lease = claimLease(bundle.session.orchestration.lease, options.leaseClaim ?? {});
      if (lease) bundle.session.orchestration.lease = lease;
    }
    bundle.session.activity_revision++;
    bundle.session.status = 'running';
    bundle.gates.revision++;
    tx.writeRun(run);
    const nextState = ensureSessionProjection(freshState, projectSessionEntry(bundle.session));
    tx.writeJson(join(store.workflowRoot, 'state.json'), nextState);
    const runDirRel = canonicalRunDir(store, sessionId, runId);
    const hasWorkflow = resolveStepContent(options.projectRoot, options.command).workflow !== null;
    const readyReason = hasWorkflow
      ? 'load the workflow execution manual, execute it, then run: maestro run check → maestro run complete'
      : `write deliverables to ${runDirRel}/outputs/, then run: maestro run check → maestro run complete`;
    return {
      session_id: sessionId,
      run_id: runId,
      run_dir: runDirRel,
      chain_step_id: run.chain_step_id,
      resolved_platform: run.resolved_platform,
      upstream,
      topic_identity: bundle.session.topic_identity ?? topicIdentity,
      reuse_assessments: reuse.assessments,
      argument_requirements: argumentRequirements,
      entry_gates: entrySummary,
      entry_blockers: entryBlockers,
      next: {
        command: `maestro run brief ${runId}`,
        reason: entrySummary.blocking.length > 0
          ? 'entry gates blocking — inspect gate status, resolve missing upstream before executing'
          : readyReason,
      },
    };
  });
}

/**
 * Finish-work checklist injected when `run check` finds every gate clean.
 * Core norms (handoff frontmatter, knowledge record, verdict semantics) are
 * runtime-built; workflow frontmatter `finish:` lines extend them. Mirrors the
 * core/extension split of the injection builder (inject.ts).
 */
function buildFinishChecklist(projectRoot: string, run: CommandRun, frontmatter: ReportFrontmatter): string[] {
  const lines: string[] = [];
  if (!frontmatter.summary.trim()) {
    lines.push('report.md handoff frontmatter is empty — fill summary (plus concerns/decisions) before completing; the sealed handoff is derived from it.');
  }
  lines.push('Record new knowledge before sealing: constraints/rules → `maestro spec add`, reusable recipes/pitfalls → `/maestro-manage knowledge capture`; skip only if nothing new was learned.');
  lines.push('Mark every spec/knowhow entry this Run contradicted: replaced by a better rule → `maestro spec add ... --json` then `maestro spec supersede <old-sid> --by <new-sid>`; both sides defensible → `maestro spec conflict mark <file> <line> --note "<reason>"` and let `/maestro-manage knowledge audit` adjudicate. Never seal with a known-stale entry unmarked.');
  lines.push('Pick the verdict honestly: `done` (clean) or `done-with-concerns` (works but carries caveats — list every caveat in concerns).');
  lines.push(...resolveStepContent(projectRoot, run.command.name).finish);
  return lines;
}

function checkNext(
  sessionId: string,
  runId: string,
  status: CommandRun['status'],
  clean: boolean,
): { command: string; reason: string } {
  if (status === 'sealed' || status === 'completed') {
    return {
      command: `maestro run next --session ${sessionId}`,
      reason: 'run sealed — advance the chain',
    };
  }
  if (!clean) {
    return {
      command: `maestro run check ${runId}`,
      reason: 'blocking gates or scan errors — repair outputs, then re-run check',
    };
  }
  return {
    command: `maestro run complete ${runId}`,
    reason: 'all gates clean — work through the finish checklist, then complete (--verdict done|done-with-concerns)',
  };
}

function validateStrictArtifactContract(
  runDir: string,
  contract: CommandContract,
  scan: ArtifactScanResult,
): void {
  if (contract.contract_version !== 2 && contract.contract_version !== 2.1) return;
  for (const expected of contract.produces) {
    const expectedPath = expected.path?.replaceAll('\\', '/').replace(/^\.\//, '');
    const actual = expectedPath
      ? scan.artifacts.find(item => relative(runDir, item.absolutePath).replaceAll('\\', '/') === expectedPath)
      : undefined;
    if (!actual) {
      if (expected.required) scan.errors.push(`Missing required contract v2 output: ${expectedPath ?? expected.kind}`);
      continue;
    }
    if (actual.kind !== expected.kind) {
      scan.errors.push(`${expectedPath}: _meta.kind ${actual.kind} does not match contract ${expected.kind}`);
    }
    if (expected.schema && actual.schemaVersion !== expected.schema) {
      scan.errors.push(`${expectedPath}: _meta.schema ${actual.schemaVersion} does not match contract ${expected.schema}`);
    }
    const expectedRole = expected.role ?? (expected.primary ? 'primary' : 'attachment');
    if (actual.role !== expectedRole) {
      scan.errors.push(`${expectedPath}: _meta.role ${actual.role} does not match contract ${expectedRole}`);
    }
  }
}

export function checkRun(projectRoot: string, runId: string, sessionId?: string): CheckRunResult {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const resolvedContract = contractForRun(projectRoot, located.run);
  const reuse = revalidateRunReuse(projectRoot, store, store.readBundle(located.sessionId), located.run);
  const scan = scanOutputs(
    store.runDir(located.sessionId, runId),
    store.sessionDir(located.sessionId),
    resolvedContract.contract,
  );
  validateStrictArtifactContract(store.runDir(located.sessionId, runId), resolvedContract.contract, scan);
  scan.errors.push(...reuse.blockers);
  if (resolvedContract.warning) scan.warnings.unshift(resolvedContract.warning);
  const frontmatter = readReportFrontmatter(store.runDir(located.sessionId, runId));

  if (located.run.status === 'sealed') {
    const bundle = store.readBundle(located.sessionId);
    validateSealedIntegrity(located.run, bundle.artifacts, scan);
    return {
      session_id: located.sessionId,
      run_id: runId,
      status: 'sealed',
      gates: gateSummary(bundle.gates, located.run.gate_ids),
      artifacts: scanSummary(scan),
      warnings: scan.warnings,
      errors: scan.errors,
      upstream: reuse.upstream,
      reuse_assessments: reuse.assessments,
      next: checkNext(located.sessionId, runId, 'sealed', true),
    };
  }

  return store.update(located.sessionId, (bundle, tx) => {
    const run = tx.readRun(runId);
    const context: EvaluationContext = {
      projectRoot,
      runDir: store.runDir(located.sessionId, runId),
      session: bundle.session,
      registry: bundle.artifacts,
      scan,
      evidence: bundle.evidence,
      reportDecisions: frontmatter.decisions.map(item => ({ id: item.id, status: item.status })),
      run,
    };
    const gates = evaluateRunGates(bundle, run, context);
    if (run.status === 'created') run.status = 'running';
    tx.writeRun(run);
    const clean = gates.blocking.length === 0 && scan.errors.length === 0;
    return {
      session_id: located.sessionId,
      run_id: runId,
      status: run.status,
      gates,
      artifacts: scanSummary(scan),
      warnings: scan.warnings,
      errors: scan.errors,
      upstream: reuse.upstream,
      reuse_assessments: reuse.assessments,
      next: checkNext(located.sessionId, runId, run.status, clean),
      ...(clean ? { finish: buildFinishChecklist(projectRoot, run, frontmatter) } : {}),
    };
  });
}

export function rebindRunCommand(
  projectRoot: string,
  runId: string,
  reason: string,
  sessionId?: string,
): RebindRunResult {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('Rebind requires a non-empty reason');
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const source = resolveCommandSource(projectRoot, located.run.command.name);
  const nextContractHash = contractHash(source.contract);

  return store.update(located.sessionId, (bundle, tx) => {
    const run = tx.readRun(runId);
    if (run.status === 'sealed') throw new Error(`Run ${runId} is sealed and immutable`);
    assertRebindCompatible(bundle.gates, run, source);

    const oldSourcePath = run.command.source_path;
    const oldContentHash = run.command.content_hash;
    const oldResolvedPromptHash = run.command.resolved_prompt_hash;
    const oldContractHash = run.command.contract_hash ?? null;
    const oldContractSnapshot = run.contract_snapshot;
    const oldSnapshotHash = oldContractSnapshot?.snapshot_hash ?? null;
    const oldGuidanceSnapshot = run.guidance_snapshot;
    const nextResolvedPromptHash = sha256(source.raw);
    const nextGuidanceSnapshot = oldGuidanceSnapshot
      ? buildGuidanceSnapshot(projectRoot, run.command.name, source)
      : null;
    const alreadyCurrent = oldSourcePath === source.relativePath
      && oldContentHash === source.contentHash
      && oldResolvedPromptHash === nextResolvedPromptHash
      && oldContractHash === nextContractHash
      && oldSnapshotHash === source.contractSnapshot.snapshot_hash
      && (!oldGuidanceSnapshot || stableJson(oldGuidanceSnapshot) === stableJson(nextGuidanceSnapshot));
    if (alreadyCurrent) throw new Error(`Run ${runId} is already bound to the current command definition`);

    const rebindKind: RebindRunResult['rebind_kind'] = oldContractHash === null
      ? 'legacy_contract_backfill'
      : oldContractHash !== nextContractHash || oldSnapshotHash !== source.contractSnapshot.snapshot_hash
        ? 'compatible_contract_rebind'
        : 'prompt_only_rebind';
    run.command.source_path = source.relativePath;
    run.command.content_hash = source.contentHash;
    run.command.resolved_prompt_hash = nextResolvedPromptHash;
    run.command.contract_hash = nextContractHash;
    run.contract_snapshot = source.contractSnapshot;
    if (oldGuidanceSnapshot) run.guidance_snapshot = nextGuidanceSnapshot;
    tx.writeRun(run);

    const auditPath = join(store.runDir(located.sessionId, runId), 'command-rebind.json');
    const audit = commandRebindAuditSchema.parse({
      schema_version: 'command-rebind/1.1',
      run_id: runId,
      command: run.command.name,
      rebind_kind: rebindKind,
      reason: normalizedReason,
      old_source_path: oldSourcePath,
      source_path: source.relativePath,
      old_content_hash: oldContentHash,
      content_hash: source.contentHash,
      old_resolved_prompt_hash: oldResolvedPromptHash,
      resolved_prompt_hash: nextResolvedPromptHash,
      old_contract_hash: oldContractHash,
      contract_hash: nextContractHash,
      old_snapshot_hash: oldSnapshotHash,
      snapshot_hash: source.contractSnapshot.snapshot_hash,
      old_contract_snapshot: oldContractSnapshot,
      contract_snapshot: source.contractSnapshot,
      old_guidance_snapshot: oldGuidanceSnapshot,
      guidance_snapshot: nextGuidanceSnapshot,
      creation_decision_id: run.creation_decision?.decision_id ?? null,
      transition: run.transition,
      rebound_at: localISO(),
    });
    tx.writeJson(auditPath, audit);
    return {
      session_id: located.sessionId,
      run_id: runId,
      rebind_kind: rebindKind,
      old_content_hash: oldContentHash,
      content_hash: source.contentHash,
      old_contract_hash: oldContractHash,
      contract_hash: nextContractHash,
      old_snapshot_hash: oldSnapshotHash,
      snapshot_hash: source.contractSnapshot.snapshot_hash,
      audit_path: relative(projectRoot, auditPath).replaceAll('\\', '/'),
    };
  });
}

export function sealSession(projectRoot: string, sessionId: string, summary = ''): SealSessionResult {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) throw new Error(`Session not found: ${sessionId}`);
  const runsDir = join(store.sessionDir(sessionId), 'runs');
  const runIds = existsSync(runsDir)
    ? readdirSync(runsDir).filter(name => existsSync(join(runsDir, name, 'run.json')))
    : [];

  const result = store.update(sessionId, (bundle) => {
    const unsealed = runIds.filter(runId => store.readRun(sessionId, runId).status !== 'sealed');
    if (unsealed.length > 0) throw new Error(`Session has unsealed Runs: ${unsealed.join(', ')}`);
    const claimed = bundle.session.requests.filter(request => request.status === 'claimed');
    if (claimed.length > 0) throw new Error(`Session has claimed requests: ${claimed.map(item => item.request_id).join(', ')}`);
    const blocking = Object.entries(bundle.gates.gates)
      .filter(([, gate]) => gate.scope === 'session' && gate.required && gate.blocking)
      .filter(([, gate]) => !['passed', 'waived', 'skipped'].includes(gate.status))
      .map(([id]) => id);
    if (blocking.length > 0) throw new Error(`Session gates are not complete: ${blocking.join(', ')}`);

    const sealedAt = localISO();
    bundle.session.status = 'sealed';
    bundle.session.active_run_id = null;
    bundle.session.identity_revision++;
    bundle.session.activity_revision++;
    bundle.session.lifecycle.sealed_at = sealedAt;
    bundle.session.lifecycle.seal_summary = summary || `Sealed with ${runIds.length} Run(s)`;
    return { session_id: sessionId, status: 'sealed' as const, sealed_at: sealedAt, run_count: runIds.length };
  });

  const state = projectState(projectRoot);
  const bundle = store.readBundle(sessionId);
  const projected = ensureSessionProjection(state, projectSessionEntry(bundle.session), false);
  if (projected.active_session_id === sessionId) projected.active_session_id = null;
  writeStateJson(projectRoot, projected);
  return result;
}

function artifactId(sequence: number, ordinal: number): string {
  return `ART-${String(sequence).padStart(3, '0')}-${String(ordinal).padStart(3, '0')}`;
}

function registerArtifacts(
  registry: ArtifactRegistry,
  run: CommandRun,
  discovered: DiscoveredArtifact[],
): string[] {
  const ids: string[] = [];
  let ordinal = 0;
  for (const item of discovered) {
    ordinal++;
    const existing = Object.entries(registry.artifacts).find(([, artifact]) =>
      artifact.producer_run_id === run.run_id && artifact.relative_path === item.relativePath,
    );
    const id = existing?.[0] ?? artifactId(run.sequence, ordinal);
    const previous = existing?.[1];
    if (previous?.status === 'sealed' && previous.content_hash !== item.contentHash) {
      throw new Error(`Sealed artifact is immutable: ${item.relativePath}`);
    }
    const alias = item.alias ?? (item.role === 'primary' ? defaultAlias(item.kind, run.command.name) : undefined);
    const priorAliasId = alias ? registry.aliases[alias] : undefined;
    if (priorAliasId && priorAliasId !== id) {
      const prior = registry.artifacts[priorAliasId];
      if (prior && prior.status === 'sealed') prior.status = 'superseded';
    }
    registry.artifacts[id] = {
      kind: item.kind,
      role: item.role,
      producer_run_id: run.run_id,
      relative_path: item.relativePath,
      media_type: item.mediaType,
      schema_version: item.schemaVersion,
      content_hash: item.contentHash,
      size: item.size,
      status: 'sealed',
      derived_from: run.input.consumes,
      replaces: priorAliasId && priorAliasId !== id ? priorAliasId : previous?.replaces ?? null,
    };
    if (alias) registry.aliases[alias] = id;
    ids.push(id);
  }
  registry.revision++;
  return ids;
}

function recordCompletionEvidence(
  bundle: SessionBundle,
  run: CommandRun,
  artifactIds: string[],
  frontmatter: ReturnType<typeof readReportFrontmatter>,
): string[] {
  const refs: string[] = [];
  let ordinal = 0;
  for (const decision of frontmatter.decisions) {
    ordinal++;
    const id = `EVD-${String(run.sequence).padStart(3, '0')}-${String(ordinal).padStart(3, '0')}`;
    bundle.evidence.records[id] = {
      run_id: run.run_id,
      command: run.command.name,
      kind: 'decision',
      point: decision.id,
      claim: decision.text,
      outcome: decision.status,
      rationale: decision.text.slice(0, 2000),
      status: decision.status,
      artifact_refs: artifactIds,
      gate_refs: [],
      source_refs: ['report.md'],
    };
    refs.push(id);
  }
  for (const gateId of run.gate_ids) {
    const gate = bundle.gates.gates[gateId];
    if (!gate) continue;
    ordinal++;
    const id = `EVD-${String(run.sequence).padStart(3, '0')}-${String(ordinal).padStart(3, '0')}`;
    bundle.evidence.records[id] = {
      run_id: run.run_id,
      command: run.command.name,
      kind: 'gate',
      point: gate.key,
      claim: gate.title,
      outcome: gate.status,
      rationale: `Gate ${gateId} evaluated as ${gate.status}`,
      status: gate.status === 'passed' || gate.status === 'waived' ? 'accepted' : 'proposed',
      artifact_refs: artifactIds,
      gate_refs: [gateId],
      source_refs: [],
    };
    gate.evidence_refs = [id];
    refs.push(id);
  }
  if (run.gate_ids.length > 0) bundle.gates.revision++;
  if (refs.length > 0) bundle.evidence.revision++;
  return refs;
}

function inferExtraMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.md': return 'text/markdown';
    case '.yaml':
    case '.yml': return 'application/yaml';
    case '.txt':
    case '.log': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

/**
 * Resolve `--artifact` run-relative paths into DiscoveredArtifact records for
 * registration. Each path must resolve inside run_dir (else throw) and must
 * exist (else throw). kind = filename stem, role = 'evidence'. Directories hash
 * recursively via the same content model as scanOutputs.
 */
function discoverExtraArtifacts(
  runDir: string,
  sessionDir: string,
  paths: string[],
): DiscoveredArtifact[] {
  const runDirAbs = resolvePath(runDir);
  const discovered: DiscoveredArtifact[] = [];
  for (const rel of paths) {
    const abs = resolvePath(runDir, rel);
    const within = abs === runDirAbs || abs.startsWith(runDirAbs + sep);
    if (!within) {
      throw new Error(`--artifact path escapes run directory: ${rel}`);
    }
    if (!existsSync(abs)) {
      throw new Error(`--artifact path does not exist: ${rel}`);
    }
    const stat = statSync(abs);
    const data = stat.isDirectory() ? null : readFileSync(abs);
    const contentHash = data
      ? createHash('sha256').update(data).digest('hex')
      : createHash('sha256').update(abs).digest('hex');
    const size = data ? data.byteLength : 0;
    const kind = basename(abs, extname(abs)) || basename(abs);
    discovered.push({
      absolutePath: abs,
      relativePath: relative(sessionDir, abs).replaceAll('\\', '/'),
      kind,
      schemaVersion: `${kind}/1.0`,
      role: 'evidence',
      mediaType: stat.isDirectory() ? 'application/vnd.maestro.directory' : inferExtraMediaType(abs),
      contentHash,
      size,
    });
  }
  return discovered;
}

/** Append `notes` to a derived handoff's concerns, de-duplicated, preserving order. */
function mergeNotesIntoConcerns(handoff: Handoff, notes: string[]): void {
  if (notes.length === 0) return;
  const seen = new Set(handoff.concerns);
  for (const note of notes) {
    const trimmed = note.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    handoff.concerns.push(trimmed);
  }
}

/**
 * Append CLI-supplied decisions to a derived handoff, de-duplicated by text. IDs
 * continue the report-frontmatter decision numbering (D-CLI-n) so they never
 * collide with report decisions; status is `accepted` (the orchestrator asserted
 * them). Report-frontmatter decisions remain the primary channel.
 */
function mergeDecisionsIntoHandoff(handoff: Handoff, decisions: string[]): void {
  if (decisions.length === 0) return;
  const seen = new Set(handoff.decisions.map(d => d.text));
  let ordinal = 0;
  for (const decision of decisions) {
    const trimmed = decision.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordinal++;
    handoff.decisions.push({ id: `D-CLI-${ordinal}`, status: 'accepted', text: trimmed });
  }
}

function applyChainVerdict(
  session: SessionState,
  run: CommandRun,
  verdict: CompletionVerdict,
): NonNullable<CompleteRunResult['chain_transition']> | null {
  const index = session.orchestration.chain.findIndex(step => step.run_id === run.run_id);
  if (index < 0) return null;
  const step = session.orchestration.chain[index];
  let retry: NonNullable<CompleteRunResult['chain_transition']>['retry'] = null;
  switch (verdict) {
    case 'done':
    case 'done-with-concerns':
      step.status = 'sealed';
      break;
    case 'needs-retry': {
      const current = step.retry ?? { count: 0, max: 2 };
      const next = { count: current.count + 1, max: current.max };
      step.retry = next;
      issueRetryToken(session.session_id, step, run);
      step.status = 'pending';
      step.run_id = null;
      retry = { ...next, exhausted: next.count >= next.max };
      break;
    }
    case 'blocked':
      step.status = 'failed';
      session.status = 'paused';
      break;
  }
  return { step_id: step.step_id, index, step_status: step.status, retry };
}

interface PreparedCompleteFile {
  path: string;
  hash: string | null;
}

export interface PreparedCompleteInputs {
  projectRoot: string;
  sessionId: string;
  runId: string;
  runDir: string;
  sessionDir: string;
  store: SessionStore;
  contract: CommandContract;
  warning: string | null;
  scan: ArtifactScanResult;
  extraArtifacts: DiscoveredArtifact[];
  frontmatter: ReportFrontmatter;
  state: StateJsonV2;
  options: CompleteRunOptions;
  files: PreparedCompleteFile[];
  completionInputSnapshot: CompleteInputSnapshot;
}

type CompleteAuthorityResult = Omit<CompleteRunResult, 'transition'>;

function preparedPathHash(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return stat.isDirectory()
    ? protocolSha256(hashDirectory(path).hash)
    : protocolSha256(readFileSync(path));
}

function completeInputSnapshot(runDir: string, paths: readonly string[]): CompleteInputSnapshot {
  const runRoot = resolvePath(runDir);
  const files = [...new Set(paths.map(path => resolvePath(path)))]
    .map(path => {
      if (path !== runRoot && !path.startsWith(`${runRoot}${sep}`)) {
        throw new Error(`complete input path escapes run directory: ${path}`);
      }
      return {
        path: relative(runRoot, path).replaceAll('\\', '/') || '.',
        content_hash: preparedPathHash(path),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const unhashed = { schema_version: 'complete-input-snapshot/1.0' as const, files };
  return completeInputSnapshotSchema.parse({
    ...unhashed,
    snapshot_hash: protocolSha256(stableJsonUtf8(unhashed)),
  });
}

function assertCompleteReplayInputs(
  runDir: string,
  record: PersistedTransitionRecord,
): void {
  const parsed = completeInputSnapshotSchema.safeParse(record.payload.payload.completion_input_snapshot);
  if (!parsed.success) {
    throw new TransitionReceiptError('INVALID_TRANSITION_RECEIPT', 'complete receipt has no valid input snapshot');
  }
  const { snapshot_hash: _storedHash, ...unhashed } = parsed.data;
  if (protocolSha256(stableJsonUtf8(unhashed)) !== parsed.data.snapshot_hash) {
    throw new TransitionReceiptError('INVALID_TRANSITION_RECEIPT', 'complete receipt input snapshot hash is invalid');
  }
  let current: CompleteInputSnapshot;
  try {
    const paths = parsed.data.files.map(file => resolvePath(runDir, file.path));
    current = completeInputSnapshot(runDir, paths);
  } catch {
    throw new TransitionReceiptError('INVALID_TRANSITION_RECEIPT', 'complete receipt input snapshot contains an unsafe path');
  }
  if (stableJsonUtf8(current) !== stableJsonUtf8(parsed.data)) {
    throw new TransitionReceiptError(
      'FENCE_CONFLICT',
      `complete request ${record.request_id} external input bytes changed since the original application`,
    );
  }
}

/** Prepare report/output/state inputs and immutable hashes outside the transition lock. */
export function prepareCompleteInputs(
  projectRoot: string,
  runId: string,
  sessionId: string | undefined,
  options: CompleteRunOptions,
): PreparedCompleteInputs {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const replayRequestId = options.transition?.requestId?.trim();
  if (replayRequestId) {
    const replayRecord = store.readBundle(located.sessionId).session.requests.find(item => (
      item.type === 'transition' && 'outcome' in item && item.request_id === replayRequestId
    ));
    if (replayRecord) {
      const validated = validatePersistedTransitionRecord(replayRecord);
      if (validated.payload.operation !== 'complete'
        || validated.payload.subject.session_id !== located.sessionId
        || validated.payload.subject.run_id !== runId) {
        throw new TransitionReceiptError(
          'REQUEST_CONFLICT',
          `request_id ${replayRequestId} was already used for another transition subject`,
        );
      }
      assertCompleteReplayInputs(
        store.runDir(located.sessionId, runId),
        validated,
      );
    }
  }
  const resolved = contractForRun(projectRoot, located.run);
  const runDir = store.runDir(located.sessionId, runId);
  const sessionDir = store.sessionDir(located.sessionId);
  const scan = scanOutputs(runDir, sessionDir, resolved.contract);
  if (!isFailureVerdict(options.chainVerdict)) {
    validateStrictArtifactContract(runDir, resolved.contract, scan);
  }
  const extraArtifacts = discoverExtraArtifacts(runDir, sessionDir, options.extraArtifacts ?? []);
  const completionPaths = [
    join(runDir, 'report.md'),
    ...resolved.contract.produces.flatMap(item => item.path ? [join(runDir, item.path)] : []),
    ...scan.artifacts.map(item => item.absolutePath),
    ...extraArtifacts.map(item => item.absolutePath),
  ];
  const paths = new Set<string>([
    join(runDir, 'run.json'),
    join(runDir, 'report.md'),
    join(runDir, 'outputs'),
    join(store.workflowRoot, 'state.json'),
    ...scan.artifacts.map(item => item.absolutePath),
    ...extraArtifacts.map(item => item.absolutePath),
  ]);
  return {
    projectRoot,
    sessionId: located.sessionId,
    runId,
    runDir,
    sessionDir,
    store,
    contract: resolved.contract,
    warning: resolved.warning,
    scan,
    extraArtifacts,
    frontmatter: readReportFrontmatter(runDir),
    state: projectState(projectRoot),
    options,
    files: [...paths].sort().map(path => ({ path, hash: preparedPathHash(path) })),
    completionInputSnapshot: completeInputSnapshot(runDir, completionPaths),
  };
}

function revalidatePreparedCompleteInputs(prepared: PreparedCompleteInputs): void {
  for (const file of prepared.files) {
    if (preparedPathHash(file.path) !== file.hash) {
      throw new TransitionReceiptError('FENCE_CONFLICT', `prepared completion input changed: ${file.path}`);
    }
  }
}

/** Apply complete authority using only the prepared inputs and StoreTransaction. */
export function applyCompleteRunMutation(
  draft: SessionBundle,
  tx: StoreTransaction,
  prepared: PreparedCompleteInputs,
): { result: CompleteAuthorityResult; run: CommandRun } {
  const { store, runId, projectRoot, scan, frontmatter, options } = prepared;
  const run = tx.readRun(runId);
  if (run.status === 'sealed') throw new Error(`Run ${runId} is sealed and immutable`);
  const reuse = revalidateRunReuse(projectRoot, store, draft, run);
  scan.errors.push(...reuse.blockers.filter(blocker => !scan.errors.includes(blocker)));
  if (prepared.warning && !scan.warnings.includes(prepared.warning)) scan.warnings.unshift(prepared.warning);
  run.status = 'completed';
  run.completed_at = localISO();
  const context: EvaluationContext = {
    projectRoot,
    runDir: prepared.runDir,
    session: draft.session,
    registry: draft.artifacts,
    scan,
    evidence: draft.evidence,
    reportDecisions: frontmatter.decisions.map(item => ({ id: item.id, status: item.status })),
    run,
  };
  const failureVerdict = isFailureVerdict(options.chainVerdict);
  const gates = failureVerdict
    ? skipExitGatesForFailedAttempt(draft, run)
    : evaluateRunGates(draft, run, context);
  const blocked = !failureVerdict && (scan.errors.length > 0 || gates.blocking.length > 0);
  draft.session.activity_revision++;
  if (blocked) {
    run.status = 'blocked';
    tx.writeRun(run);
    tx.writeJson(join(store.workflowRoot, 'state.json'), ensureSessionProjection(
      prepared.state, projectSessionEntry(draft.session),
    ));
    return {
      run,
      result: {
        session_id: prepared.sessionId, run_id: runId, status: run.status, gates,
        artifacts: scanSummary(scan), warnings: scan.warnings, errors: scan.errors,
        upstream: reuse.upstream, reuse_assessments: reuse.assessments, sealed: false,
        primary_artifact_id: null, artifact_ids: [],
        next_action: {
          suggest_only: true, action: 'repair_run', command: `maestro run check ${runId}`,
          reason: 'Run gates are blocking; fix outputs before advancing the chain',
          preconditions: ['repair blocking outputs or gates', 'run check must report no blocking gates'],
        },
        chain_transition: null,
      },
    };
  }

  const artifactIds = registerArtifacts(draft.artifacts, run, [...scan.artifacts, ...prepared.extraArtifacts]);
  const primary = artifactIds.find(id => draft.artifacts.artifacts[id]?.role === 'primary') ?? null;
  const evidenceRefs = recordCompletionEvidence(draft, run, artifactIds, frontmatter);
  run.output = { produces: artifactIds, primary_artifact_id: primary, verdict: frontmatter.verdict };
  run.handoff = deriveHandoff(frontmatter, runId, run.command.name, artifactIds, evidenceRefs);
  if (!run.handoff.summary.trim() && options.summaryFallback?.trim()) {
    run.handoff.summary = options.summaryFallback.trim();
  }
  mergeNotesIntoConcerns(run.handoff, options.notes ?? []);
  mergeDecisionsIntoHandoff(run.handoff, options.decisions ?? []);
  run.status = 'sealed';
  run.sealed_at = localISO();
  draft.session.latest_completed_run_id = runId;
  if (draft.session.active_run_id === runId) draft.session.active_run_id = null;
  const chainTransition = options.chainVerdict
    ? applyChainVerdict(draft.session, run, options.chainVerdict)
    : null;
  summarizeRegistry(draft.gates);
  tx.writeRun(run);
  tx.writeJson(join(store.workflowRoot, 'state.json'), ensureSessionProjection(
    prepared.state, projectSessionEntry(draft.session),
  ));
  return {
    run,
    result: {
      session_id: prepared.sessionId, run_id: runId, status: run.status, gates,
      artifacts: scanSummary(scan), warnings: scan.warnings, errors: scan.errors,
      upstream: reuse.upstream, reuse_assessments: reuse.assessments, sealed: true,
      primary_artifact_id: primary, artifact_ids: artifactIds,
      next_action: completionNextPointer(draft.session, runId), chain_transition: chainTransition,
    },
  };
}

export function completeRun(
  projectRoot: string,
  runId: string,
  sessionId?: string,
  options: CompleteRunOptions = {},
): CompleteRunResult {
  const preparedInputs = prepareCompleteInputs(projectRoot, runId, sessionId, options);
  const { store } = preparedInputs;
  const initialBundle = store.readBundle(preparedInputs.sessionId);
  const requestId = options.transition?.requestId?.trim();
  const priorRecord = requestId
    ? initialBundle.session.requests.find(item => item.type === 'transition'
      && 'outcome' in item && item.request_id === requestId) as PersistedTransitionRecord | undefined
    : undefined;
  const priorSnapshot = priorRecord?.payload.payload.completion_input_snapshot;
  const prepared = prepareTransitionMutation({
    session: initialBundle.session,
    currentFence: store.readSessionFence(preparedInputs.sessionId, runId),
    operation: 'complete',
    subject: { session_id: preparedInputs.sessionId, run_id: runId, chain_step_id: store.readRun(preparedInputs.sessionId, runId).chain_step_id },
    payload: {
      run_id: runId,
      notes: options.notes ?? [],
      extra_artifacts: options.extraArtifacts ?? [],
      summary_fallback: options.summaryFallback ?? null,
      decisions: options.decisions ?? [],
      chain_verdict: options.chainVerdict ?? null,
      completion_input_snapshot: priorSnapshot ?? preparedInputs.completionInputSnapshot,
    },
    options: options.transition ?? { leaseClaim: options.leaseClaim },
  });
  const evaluated = store.replayOrApplyTransition(preparedInputs.sessionId, prepared.request, (draft, tx) => {
    assertTransitionMutationRevisions(draft.session, prepared.options);
    const leaseConflict = checkLease(draft.session.orchestration.lease, prepared.options.leaseClaim ?? {});
    if (leaseConflict) throw new Error(leaseConflict);
    if (draft.artifacts.revision !== prepared.request.preconditions.artifact_registry_revision) {
      throw new TransitionReceiptError('FENCE_CONFLICT', 'complete authority fence changed after preparation');
    }
    revalidatePreparedCompleteInputs(preparedInputs);
    const applied = applyCompleteRunMutation(draft, tx, preparedInputs);
    return createTransitionOutcome({
      request_id: prepared.request.request_id,
      request_hash: prepared.request.normalized_request_hash,
      operation: 'complete', status: 'applied', applied_at: new Date().toISOString(),
      subject: prepared.request.subject,
      postconditions: {
        session_identity_revision: draft.session.identity_revision,
        session_activity_revision: draft.session.activity_revision,
        active_run_id: draft.session.active_run_id,
        run_hash: protocolSha256(`${JSON.stringify(applied.run, null, 2)}\n`),
        artifact_registry_revision: draft.artifacts.revision,
      },
      exit_code: applied.result.sealed ? 0 : 1,
      error_code: applied.result.sealed ? null : 'RUN_GATES_BLOCKING',
      result: { value: applied.result },
    });
  }, record => assertCompleteReplayInputs(preparedInputs.runDir, record));
  return {
    ...(structuredClone(evaluated.outcome.result.value) as CompleteAuthorityResult),
    transition: transitionMutationReceipt(prepared.request, evaluated.outcome, evaluated.replayed),
  };
}

export interface CompleteVerdictOptions extends CompleteRunOptions {
  /** Chain-advancement instruction. Defaults to `done`. */
  verdict?: CompletionVerdict;
  /** Reason text (blocked) merged into the handoff concerns, ralph `--reason`. */
  reason?: string;
}

/**
 * Locate the chain step a Run is bound to (run_id match), or null when the Run is
 * not part of the session's predefined chain (an ad-hoc `run create`).
 */
function chainStepForRun(session: SessionState, runId: string): { index: number; step_id: string } | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].run_id === runId) return { index: i, step_id: chain[i].step_id };
  }
  return null;
}

/**
 * The next-step pointer after a verdict is applied, closing complete → next.
 * Reads the post-verdict session: a paused session (blocked verdict) points at
 * resuming; a pending execution step points at `run next`; a pending decision
 * node hands off to the orchestrator; a fully-drained chain points at
 * `run seal-session`.
 */
function completionNextPointer(session: SessionState, completedRunId?: string): CompleteNextSuggestion {
  const sessionId = session.session_id;
  if (session.status === 'paused') {
    return {
      suggest_only: true,
      action: 'resolve_session',
      command: null,
      reason: 'session paused — dispatch is forbidden until the blocker or escalation is explicitly resolved',
      preconditions: ['resolve the named blocker or escalated decision', 'perform an authorized Session resume transition'],
    };
  }
  const reconcilable = completedRunId
    ? session.orchestration.chain.find(step => step.status === 'running' && step.run_id === completedRunId)
    : null;
  if (reconcilable) {
    return {
      suggest_only: true,
      action: 'dispatch_next',
      command: `maestro run next --session ${sessionId}`,
      reason: `Run ${completedRunId} is sealed; run next reconciles chain step ${reconcilable.step_id} before continuing`,
      preconditions: ['session_status=running', `chain_step=${reconcilable.step_id}`, `sealed_run_id=${completedRunId}`],
    };
  }
  if (nextPendingIndex(session, true) !== null) {
    return {
      suggest_only: true,
      action: 'dispatch_next',
      command: `maestro run next --session ${sessionId}`,
      reason: 'more pending steps — advance the chain',
      preconditions: ['session_status=running', 'active_run_id=null', 'no earlier pending decision'],
    };
  }
  if (nextPendingDecisionIndex(session) !== null) {
    return {
      suggest_only: true,
      action: 'evaluate_decision',
      command: `maestro run next --session ${sessionId}`,
      reason: 'next node is a decision — the orchestrator evaluates it',
      preconditions: ['session_status=running', 'decision remains pending'],
    };
  }
  return {
    suggest_only: true,
    action: 'seal_session',
    command: `maestro run seal-session ${sessionId}`,
    reason: 'all steps complete — seal the session',
    preconditions: ['all Runs are sealed', 'all chain steps are terminal'],
  };
}

/**
 * `run complete` with a chain-advancement verdict — the generic-layer equivalent
 * of `ralph complete <idx> --status <S>`. All four verdicts first run the
 * standard seal path (completeRun: derive handoff + register artifacts + seal the
 * Run), so run.json is sealed regardless of the chain outcome. The verdict then
 * drives the bound chain step:
 *
 *   done / done-with-concerns → step `sealed`   (terminal; matches next.ts
 *                                                 reconcileSealedSteps)
 *   needs-retry               → step `pending`, run_id cleared, retry.count++
 *   blocked                   → step `failed`,  session `paused`
 *
 * A non-chain Run (no chain step bound to its run_id) still seals and carries its
 * signals via the handoff, but the chain and session status are left untouched —
 * the verdict is advisory there, never an error.
 *
 * Signals ride the handoff (P3 single-source): reason (blocked) and an auto
 * done-with-concerns note fold into notes → handoff.concerns; decisions append to
 * handoff.decisions; evidence paths register as extra artifacts. No handoff
 * schema field is added — the verdict itself lives only in the chain transition.
 */
export function completeRunWithVerdict(
  projectRoot: string,
  runId: string,
  sessionId: string,
  options: CompleteVerdictOptions = {},
): CompleteVerdictResult {
  const verdict = options.verdict ?? 'done';
  const store = new SessionStore(projectRoot);

  // Compose the notes channel: caller notes + blocked reason + an auto concern
  // for done-with-concerns when the caller left the notes empty (ralph appended a
  // `concerns` string on DONE_WITH_CONCERNS; here the equivalent is a handoff
  // concern so the signal survives on the P3 single-source).
  const notes = [...(options.notes ?? [])];
  if (verdict === 'blocked' && options.reason?.trim()) {
    notes.push(options.reason.trim());
  }
  if (verdict === 'done-with-concerns' && notes.length === 0) {
    notes.push('completed with concerns');
  }

  const seal = completeRun(projectRoot, runId, sessionId, {
    notes,
    extraArtifacts: options.extraArtifacts,
    summaryFallback: options.summaryFallback,
    decisions: options.decisions,
    leaseClaim: options.leaseClaim,
    chainVerdict: verdict,
    transition: options.transition,
  });

  const after = store.readBundle(sessionId).session;
  if (!seal.sealed) {
    const bound = chainStepForRun(after, runId);
    const current = bound ? after.orchestration.chain[bound.index] : null;
    return {
      session_id: sessionId,
      run_id: runId,
      verdict,
      run_sealed: false,
      chain: current ? {
        step_id: current.step_id,
        index: bound!.index,
        step_status: current.status,
        retry: current.retry ? { ...current.retry, exhausted: current.retry.count >= current.retry.max } : null,
      } : null,
      session_status: after.status,
      next: {
        suggest_only: true,
        action: 'repair_run',
        command: `maestro run check ${runId}`,
        reason: 'Run gates are blocking; fix outputs before advancing the chain',
        preconditions: ['repair blocking outputs or gates', 'run check must report no blocking gates'],
      },
      seal,
    };
  }

  const transition = seal.chain_transition ?? null;
  if (!transition) {
    return {
      session_id: sessionId,
      run_id: runId,
      verdict,
      run_sealed: seal.sealed,
      chain: null,
      session_status: after.status,
      next: completionNextPointer(after),
      seal,
    };
  }
  return {
    session_id: sessionId,
    run_id: runId,
    verdict,
    run_sealed: seal.sealed,
    chain: {
      step_id: transition.step_id,
      index: transition.index,
      step_status: transition.step_status,
      retry: transition.retry,
    },
    session_status: after.status,
    next: completionNextPointer(after),
    seal,
  };
}

export function summarizeRunMode(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  return lines.slice(0, 8).join('\n');
}

// ---------------------------------------------------------------------------
// Goal mode — prepare frontmatter 声明 `goal: true` 的 step，加载时按平台附带
// goal 创建模式。用户选择加载带标志的 step 即构成显式启用（满足 codex goal
// 工具「仅用户明确要求时使用」的约束）。平台无对应工具时返回 null。
// ---------------------------------------------------------------------------

const GOAL_MODE_BLOCKS: Partial<Record<TargetPlatform, string>> = {
  codex: [
    'Goal 模式（该 step 声明 goal 标志，用户加载即为明确启用）：',
    '1. Run 开始时 `create_goal({ objective: "{step}: <用户意图一句话>" })`（用户给定预算时加 `token_budget`）；单一活跃 goal，若已有未完成 goal 先收口。',
    '2. 过程中可用 `get_goal({})` 查看已用时间与剩余 token 预算。',
    '3. Run 完成时 `update_goal({ status: "complete" })`；同一阻塞持续无法推进时 `update_goal({ status: "blocked" })`。',
    '4. 完成后向用户报告工具返回的最终 token 用量。',
  ].join('\n'),
};

function extractGoalFlag(raw: string): boolean {
  const fm = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  return /^goal:\s*true\s*$/m.test(fm[1]);
}

function resolveGoalMode(
  prepareRaw: string | undefined,
  platform: TargetPlatform,
): { platform: string; instructions: string } | null {
  if (!prepareRaw || !extractGoalFlag(prepareRaw)) return null;
  const block = GOAL_MODE_BLOCKS[platform];
  return block ? { platform, instructions: block } : null;
}

/**
 * Read-only prior-step context for `run prepare --session`: the latest completed
 * Run's handoff plus the present state of each contract-declared consume alias.
 * Never mutates state and never creates directories.
 */
function preparePreviousContext(
  projectRoot: string,
  stepName: string,
  sessionId: string,
): PreparePrevious {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) {
    return { handoff: null, consumes: [], upstream: {}, reuse_assessments: [], selected_refs: [] };
  }
  const bundle = store.readBundle(sessionId);
  const handoff = handoffByLatestCompleted(store, bundle.session);
  const contract = resolveCommandSource(projectRoot, stepName).contract;
  const reuse = assessSessionReuse(projectRoot, sessionId, stepName);
  const consumes: PrepareConsumeStatus[] = contract.consumes.map(consume => {
    const selected = Object.entries(reuse.upstream).find(([alias, item]) =>
      (consume.alias ? alias === consume.alias : item.kind === consume.kind));
    const alias = selected?.[0] ?? consume.alias ?? null;
    const artifactId = selected?.[1].artifact_id;
    const artifact = artifactId ? bundle.artifacts.artifacts[artifactId] : undefined;
    return {
      alias,
      kind: consume.kind,
      required: consume.required,
      present: Boolean(artifact),
      status: artifact ? (artifact.status === 'sealed' ? 'sealed' : 'draft') : null,
      path: artifact ? `sessions/${sessionId}/${artifact.relative_path}` : null,
    };
  });
  const selectedRefs = Object.entries(reuse.upstream).map(([alias, item]) => ({
    alias,
    artifact_id: item.artifact_id,
    path: item.path,
    assessment_hash: reuse.assessments.find(assessment => assessment.source_fence.artifact_id === item.artifact_id)?.assessment_hash ?? '',
  }));
  return {
    handoff,
    consumes,
    upstream: reuse.upstream,
    reuse_assessments: reuse.assessments,
    selected_refs: selectedRefs,
  };
}

export function prepareStep(
  projectRoot: string,
  stepName: string,
  platform?: TargetPlatform,
  sessionId?: string,
): PrepareStepResult {
  const suffix = platform ? PLATFORM_SUFFIX[platform] : undefined;
  const content = resolveStepContent(projectRoot, stepName, suffix);
  const tx = (raw: string) => platform ? transformContentForPlatform(raw, platform) : raw;
  const result: PrepareStepResult = {
    step: stepName,
    platform: platform ?? 'claude',
    prepare: content.prepare ? { path: content.prepare.path, content: tx(content.prepare.raw) } : null,
    workflow: content.workflow
      ? { path: content.workflow.path, line_count: content.workflow.raw.split(/\r?\n/).length }
      : null,
    run_mode: content.runMode
      ? { path: content.runMode.path, summary: summarizeRunMode(content.runMode.raw) }
      : null,
    refs: content.refs,
    goal_mode: resolveGoalMode(content.prepare?.raw, platform ?? 'claude'),
  };
  if (sessionId) {
    result.previous = preparePreviousContext(projectRoot, stepName, sessionId);
  }
  return result;
}

export function skillContent(
  projectRoot: string,
  stepName: string,
  platform?: TargetPlatform,
): SkillContentResult {
  const suffix = platform ? PLATFORM_SUFFIX[platform] : undefined;
  const content = resolveStepContent(projectRoot, stepName, suffix);
  const tx = (raw: string) => platform ? transformContentForPlatform(raw, platform) : raw;
  return {
    step: stepName,
    platform: platform ?? 'claude',
    prepare: content.prepare ? { path: content.prepare.path, content: tx(content.prepare.raw) } : null,
    workflow: content.workflow
      ? { path: content.workflow.path, content: tx(content.workflow.raw) }
      : null,
    refs: content.refs,
    goal_mode: resolveGoalMode(content.prepare?.raw, platform ?? 'claude'),
  };
}

export function briefRun(
  projectRoot: string,
  runId: string,
  sessionId?: string,
  platform?: TargetPlatform,
): BriefRunResult {
  const store = new SessionStore(projectRoot);
  const context = resolveRunContext(projectRoot, runId, sessionId, platform);
  const located = store.findRun(runId, context.session_id);
  const bundle = store.readBundle(located.sessionId);
  const run = located.run;
  const resolvedPlatform = context.resolved_platform;
  const suffix = PLATFORM_SUFFIX[resolvedPlatform];
  const content = resolveStepContent(projectRoot, run.command.name, suffix);
  const tx = (raw: string) => transformContentForPlatform(raw, resolvedPlatform);

  const outputs = run.output.produces
    .map(id => {
      const artifact = bundle.artifacts.artifacts[id];
      if (!artifact) return null;
      return {
        artifact_id: id,
        kind: artifact.kind,
        role: artifact.role,
        path: artifact.relative_path,
        status: artifact.status,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const validatedReuse = revalidateRunReuse(projectRoot, store, bundle, run);
  const upstream = validatedReuse.upstream;
  const prevHandoff = latestHandoffBefore(store, located.sessionId, run.sequence);
  const anchor = buildAnchorSections(store, bundle.session);
  const freshness = guidanceFreshness(projectRoot, run);
  const resolvedContract = contractForRun(projectRoot, run);
  const contract = resolvedContract.contract;
  const argumentRequirements = resolveArgumentRequirements(projectRoot, run.command.name, run.input.args);
  const reuseAssessments = validatedReuse.assessments;
  const inputs: ExecutionContractView['inputs'] = contract.consumes.map(consume => ({
    kind: consume.kind,
    alias: consume.alias ?? null,
    required: consume.required,
    require_status: consume.require_status ?? null,
    schema: consume.schema ?? null,
    resolved: consume.alias
      ? upstream[consume.alias] ?? null
      : Object.values(upstream).find(item => item.kind === consume.kind) ?? null,
  }));
  const declaredOutputs: ExecutionContractView['outputs']['declared'] = contract.produces.map(produce => ({
    kind: produce.kind,
    alias: produce.alias ?? null,
    role: produce.role ?? (produce.primary ? 'primary' : 'attachment'),
    required: produce.required ?? false,
    primary: produce.primary,
    path: produce.path ?? null,
    schema: typeof produce.schema === 'string' ? produce.schema : null,
  }));
  const gateItems: ExecutionContractView['gates']['items'] = run.gate_ids
    .map(gateId => {
      const gate = bundle.gates.gates[gateId];
      return gate ? {
        gate_id: gateId,
        title: gate.title,
        scope: gate.scope,
        status: gate.status,
        required: gate.required,
        blocking: gate.blocking,
      } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const executionContract: ExecutionContractView = executionContractV11Schema.parse({
    schema_version: 'execution-contract/1.1',
    command: run.command.name,
    invocation: { args: [...run.input.args] },
    guidance: {
      prepare_path: content.prepare?.path ?? null,
      workflow_path: content.workflow?.path ?? null,
      run_mode_path: content.runMode?.path ?? null,
    },
    inputs,
    outputs: { declared: declaredOutputs, actual: outputs },
    gates: { registry_revision: bundle.gates.revision, items: gateItems },
    contract: {
      version: run.contract_snapshot?.contract_version
        ?? (contract.contract_version === 2.1
          ? 'command-contract/2.1'
          : contract.contract_version === 2 ? 'command-contract/2.0' : 'command-contract/1.0'),
      snapshot_hash: run.contract_snapshot?.snapshot_hash ?? null,
      warnings: contract.compatibility_warnings ?? [],
      drift: resolvedContract.warning ? 'prompt-only' : 'none',
    },
    freshness: {
      captured_at: localISO(),
      run_context_identity_revision: run.input.context_identity_revision,
      session_identity_revision: bundle.session.identity_revision,
      session_activity_revision: bundle.session.activity_revision,
      identity_current: run.input.context_identity_revision === bundle.session.identity_revision,
      command_contract_hash: run.command.contract_hash ?? null,
    },
    argument_requirements: argumentRequirements,
    reuse_assessments: reuseAssessments,
  });

  return briefResultV10Schema.parse({
    schema_version: 'brief-result/1.0',
    session_id: located.sessionId,
    run_id: runId,
    run_dir: context.run_dir,
    upstream,
    session: {
      session_id: located.sessionId,
      intent: bundle.session.intent,
      status: bundle.session.status,
      identity_revision: bundle.session.identity_revision,
      activity_revision: bundle.session.activity_revision,
      active_run_id: bundle.session.active_run_id,
      open_decisions: bundle.session.orchestration.decision_points
        .filter(point => point.status !== 'passed'),
    },
    run: {
      run_id: runId,
      run_dir: context.run_dir,
      chain_step_id: context.chain_step_id,
      resolved_platform: resolvedPlatform,
      status: run.status,
    },
    guidance: {
      prepare: content.prepare
        ? { path: content.prepare.path, content: tx(content.prepare.raw) }
        : null,
      workflow: content.workflow
        ? { path: content.workflow.path, content: tx(content.workflow.raw) }
        : null,
      run_mode: content.runMode
        ? { path: content.runMode.path, content: tx(content.runMode.raw) }
        : null,
      refs: content.refs,
      goal_mode: resolveGoalMode(content.prepare?.raw, resolvedPlatform),
      freshness,
    },
    execution_contract: executionContract,
    continuity: { prev_handoff: prevHandoff, anchor },
    recovery: { next: briefNext(bundle.session, runId, run.status) },
  });
}

/**
 * Next lifecycle verb after `run brief`, closing next→brief→check→complete
 * (plan P2.5/G4). A live Run points at `run check` (pre-completion gate check —
 * does not seal); a sealed Run points at `run next` to advance the chain.
 */
function briefNext(
  session: SessionState,
  runId: string,
  status: CommandRun['status'],
): BriefResult['recovery']['next'] {
  if (session.status !== 'running') {
    return {
      suggest_only: true,
      command: null,
      reason: `session ${session.session_id} is ${session.status}; resolve or resume Session authority before continuing`,
    };
  }
  if (session.active_run_id && session.active_run_id !== runId) {
    return {
      suggest_only: true,
      command: `maestro run brief ${session.active_run_id} --session ${session.session_id}`,
      reason: `session already has active Run ${session.active_run_id}; re-attach it instead of allocating another Run`,
    };
  }
  if (status === 'sealed' || status === 'completed') {
    const nextExecutionIndex = nextPendingIndex(session, true);
    const decisionIndex = nextPendingDecisionIndex(session);
    if (decisionIndex !== null && (nextExecutionIndex === null || decisionIndex < nextExecutionIndex)) {
      const decision = session.orchestration.chain[decisionIndex];
      return {
        suggest_only: true,
        command: `maestro run next --session ${session.session_id}`,
        reason: `next chain node is unresolved decision ${decision.decision_ref}; run next surfaces its decision card without allocating a Run`,
      };
    }
    return {
      suggest_only: true,
      command: `maestro run next --session ${session.session_id}`,
      reason: 'run sealed — advance the chain',
    };
  }
  return {
    suggest_only: true,
    command: `maestro run check ${runId}`,
    reason: `pre-completion gate check (does not seal); when clean it emits the finish checklist — work through it, then run: maestro run complete ${runId}`,
  };
}
