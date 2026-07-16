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
import { scanOutputs, type ArtifactScanResult, type DiscoveredArtifact } from './artifacts.js';
import {
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
  type SessionState,
} from './schemas.js';
import {
  buildIntentSection,
  buildBoundaryContractSection,
  buildProgressSection,
} from './inject.js';
import { SessionStore, type SessionBundle } from './store.js';
import {
  requeueChainStepForRetry,
  nextPendingDecisionIndex,
  nextPendingIndex,
  updateChainStepStatus,
} from './chain.js';
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
}

export interface CreateRunOptions {
  projectRoot: string;
  command: string;
  sessionId?: string;
  intent?: string;
  args?: string[];
  parentRunId?: string;
}

export interface CreateRunResult {
  session_id: string;
  run_id: string;
  run_dir: string;
  upstream: Record<string, RunUpstream>;
  entry_gates: GateSummary;
  next: { command: string; reason: string };
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
}

export interface CompleteRunResult extends CheckRunResult {
  sealed: boolean;
  primary_artifact_id: string | null;
  artifact_ids: string[];
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

export interface BriefRunResult {
  session_id: string;
  run_id: string;
  status: CommandRun['status'];
  command: string;
  goal: string;
  gates: GateSummary;
  workflow: { path: string; content: string } | null;
  run_mode: { path: string; summary: string } | null;
  /** Prepare-declared deferred-reading refs (path + when). Manifest only. */
  refs: Array<{ path: string; when: string }>;
  outputs: Array<{ artifact_id: string; kind: string; role: string; path: string; status: string }>;
  goal_mode: { platform: string; instructions: string } | null;
  /** Aliases this Run consumed, resolved back to upstream artifacts. */
  upstream: Record<string, RunUpstream>;
  /** Handoff of the most recent sealed Run before this one (null if none). */
  prev_handoff: PrevHandoff | null;
  /** Session anchor grounding (Intent / Boundary Contract / Execution Progress). */
  anchor: AnchorSection;
  /** Next lifecycle verb pointer, closing next→brief→check→complete. */
  next: { command: string; reason: string };
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
  next: { command: string; reason: string };
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
}

const explicitGateCheckSchema = gateSchema.shape.check;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

function validateSessionSlug(value: string): void {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
    throw new Error(`Invalid session ID: "${value}". Use lowercase alphanumeric + hyphens (e.g. 20260715-odyssey-jwt-auth).`);
  }
  if (value.length > 128) {
    throw new Error(`Session ID too long (${value.length} > 128): "${value.slice(0, 40)}..."`);
  }
}

function resolveSessionId(store: SessionStore, state: StateJsonV2, requested: string | undefined, intent: string, command: string): string {
  if (requested) {
    validateSessionSlug(requested);
    return requested;
  }
  const intentKey = slug(intent, command);
  const candidates = (state.sessions ?? []).filter(entry =>
    (entry.status === 'running' || entry.status === 'paused')
    && slug(entry.intent, command) === intentKey
    && store.sessionExists(entry.session_id),
  );
  if (state.active_session_id) {
    const active = candidates.find(entry => entry.session_id === state.active_session_id);
    if (active) return active.session_id;
  }
  if (candidates.length > 0) return candidates.at(-1)!.session_id;
  const base = `${dateId()}-${slug(intent, command)}`;
  if (!store.sessionExists(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${String(index).padStart(2, '0')}`;
    if (!store.sessionExists(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate session ID for: ${intent}`);
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

function collectUpstream(
  sessionId: string,
  registry: ArtifactRegistry,
  contract: CommandContract,
): Record<string, RunUpstream> {
  const all: Record<string, RunUpstream> = {};
  for (const [alias, artifactId] of Object.entries(registry.aliases)) {
    const artifact = registry.artifacts[artifactId];
    if (!artifact) continue;
    all[alias] = {
      artifact_id: artifactId,
      path: `sessions/${sessionId}/${artifact.relative_path}`,
      kind: artifact.kind,
      status: artifact.status === 'sealed' ? 'sealed' : 'draft',
    };
  }
  if (contract.consumes.length === 0) return all;
  const selected: Record<string, RunUpstream> = {};
  for (const consume of contract.consumes) {
    const alias = consume.alias ?? Object.keys(all).find(key => all[key].kind === consume.kind);
    if (alias && all[alias]) selected[alias] = all[alias];
  }
  return selected;
}

/**
 * Reverse-lookup the aliases a Run actually consumed (run.input.consumes holds
 * artifact_ids) back into the registry alias map, yielding alias → upstream.
 * Used by `run brief` where the Run already exists and its consume set is fixed.
 */
function upstreamForConsumedIds(
  sessionId: string,
  registry: ArtifactRegistry,
  consumedIds: string[],
): Record<string, RunUpstream> {
  const idToAlias = new Map<string, string>();
  for (const [alias, artifactId] of Object.entries(registry.aliases)) {
    if (!idToAlias.has(artifactId)) idToAlias.set(artifactId, alias);
  }
  const result: Record<string, RunUpstream> = {};
  for (const artifactId of consumedIds) {
    const artifact = registry.artifacts[artifactId];
    if (!artifact) continue;
    const alias = idToAlias.get(artifactId) ?? artifactId;
    result[alias] = {
      artifact_id: artifactId,
      path: `sessions/${sessionId}/${artifact.relative_path}`,
      kind: artifact.kind,
      status: artifact.status === 'sealed' ? 'sealed' : 'draft',
    };
  }
  return result;
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
  const recent = completed.slice(-5).map(s => {
    let summary: string | null = null;
    if (s.run_id) {
      try {
        summary = store.readRun(session.session_id, s.run_id).handoff?.summary ?? null;
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
    add({
      key: `produce-${produce.kind}`,
      title: `Produce ${produce.kind}`,
      scope: 'exit',
      run_id: runId,
      required: true,
      blocking: true,
      applicable_modes: [],
      status: 'pending',
      check: { type: 'artifact', kind: produce.kind, ...(produce.alias ? { alias: produce.alias } : {}) },
      evidence_refs: [],
      waiver: null,
    });
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
    if (check.alias) {
      const artifactId = context.registry.aliases[check.alias];
      const artifact = artifactId ? context.registry.artifacts[artifactId] : undefined;
      if (artifact && artifact.kind === check.kind) return { status: artifact.status, schema: artifact.schema_version };
      return null;
    }
    const artifact = Object.values(context.registry.artifacts).find(item => item.kind === check.kind);
    if (artifact) return { status: artifact.status, schema: artifact.schema_version };
    return null;
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

function contractForRun(projectRoot: string, run: CommandRun): CommandContract {
  const source = resolveCommandSource(projectRoot, run.command.name);
  if (source.contentHash !== run.command.content_hash) {
    throw new Error(`Command definition changed after run creation: ${run.command.name}`);
  }
  return source.contract;
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
  const intent = options.intent?.trim() || options.command;
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

  const sessionId = resolveSessionId(store, state, options.sessionId, intent, options.command);
  if (!store.sessionExists(sessionId)) store.createSession(sessionId, intent);

  return store.update(sessionId, (bundle, tx) => {
    const freshState = projectState(options.projectRoot);
    const sequence = nextSequence(store, sessionId);
    const runId = `${dateId()}-${String(sequence).padStart(3, '0')}-${slug(options.command, 'run')}`;
    const runDir = ensureRunShell(store, sessionId, runId);
    const gateIds = registerRunGates(bundle.gates, source.contract, runId, sequence);
    const upstream = collectUpstream(sessionId, bundle.artifacts, source.contract);
    const now = localISO();
    const run: CommandRun = {
      schema_version: 'command-run/1.0',
      session_id: sessionId,
      run_id: runId,
      sequence,
      parent_run_id: options.parentRunId ?? null,
      command: {
        name: options.command,
        version: '1.0',
        source_path: source.relativePath,
        content_hash: source.contentHash,
        resolved_prompt_hash: sha256(source.raw),
      },
      status: 'running',
      input: {
        args: options.args ?? [],
        consumes: Object.values(upstream).map(item => item.artifact_id),
        context_identity_revision: bundle.session.identity_revision,
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
    };
    for (const id of gateIds) {
      const gate = bundle.gates.gates[id];
      if (gate?.scope === 'entry') gate.status = evaluateGate(gate, entryContext);
    }
    summarizeRegistry(bundle.gates);
    const entrySummary = gateSummary(bundle.gates, gateIds.filter(id => bundle.gates.gates[id]?.scope === 'entry'));
    if (entrySummary.blocking.length > 0) run.status = 'blocked';

    bundle.session.active_run_id = runId;
    bundle.session.activity_revision++;
    bundle.session.status = 'running';
    bundle.gates.revision++;
    tx.writeRun(run);
    const nextState = ensureSessionProjection(freshState, projectSessionEntry(bundle.session));
    tx.writeJson(join(store.workflowRoot, 'state.json'), nextState);
    const runDirRel = `.workflow/sessions/${sessionId}/runs/${runId}`;
    const hasWorkflow = resolveStepContent(options.projectRoot, options.command).workflow !== null;
    const readyReason = hasWorkflow
      ? 'load the workflow execution manual, execute it, then run: maestro run check → maestro run complete'
      : `write deliverables to ${runDirRel}/outputs/, then run: maestro run check → maestro run complete`;
    return {
      session_id: sessionId,
      run_id: runId,
      run_dir: runDirRel,
      upstream,
      entry_gates: entrySummary,
      next: {
        command: `maestro run brief ${runId}`,
        reason: entrySummary.blocking.length > 0
          ? 'entry gates blocking — inspect gate status, resolve missing upstream before executing'
          : readyReason,
      },
    };
  });
}

export function checkRun(projectRoot: string, runId: string, sessionId?: string): CheckRunResult {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  const contract = contractForRun(projectRoot, located.run);
  const scan = scanOutputs(store.runDir(located.sessionId, runId), store.sessionDir(located.sessionId), contract);
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
    };
    const gates = evaluateRunGates(bundle, run, context);
    if (run.status === 'created') run.status = 'running';
    tx.writeRun(run);
    return {
      session_id: located.sessionId,
      run_id: runId,
      status: run.status,
      gates,
      artifacts: scanSummary(scan),
      warnings: scan.warnings,
      errors: scan.errors,
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
      replaces: previous?.replaces ?? null,
    };
    const alias = item.alias ?? (item.role === 'primary' ? defaultAlias(item.kind, run.command.name) : undefined);
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

export function completeRun(
  projectRoot: string,
  runId: string,
  sessionId?: string,
  options: CompleteRunOptions = {},
): CompleteRunResult {
  const store = new SessionStore(projectRoot);
  const located = store.findRun(runId, sessionId);
  if (located.run.status === 'sealed') throw new Error(`Run ${runId} is sealed and immutable`);
  const contract = contractForRun(projectRoot, located.run);
  const runDir = store.runDir(located.sessionId, runId);
  const sessionDir = store.sessionDir(located.sessionId);
  const scan = scanOutputs(runDir, sessionDir, contract);
  const extraArtifacts = discoverExtraArtifacts(runDir, sessionDir, options.extraArtifacts ?? []);
  const frontmatter = readReportFrontmatter(runDir);
  const notes = options.notes ?? [];

  return store.update(located.sessionId, (bundle, tx) => {
    const run = tx.readRun(runId);
    if (run.status === 'sealed') throw new Error(`Run ${runId} is sealed and immutable`);
    run.status = 'completed';
    run.completed_at = localISO();
    const state = projectState(projectRoot);
    const context: EvaluationContext = {
      projectRoot,
      runDir: store.runDir(located.sessionId, runId),
      session: bundle.session,
      registry: bundle.artifacts,
      scan,
      evidence: bundle.evidence,
      reportDecisions: frontmatter.decisions.map(item => ({ id: item.id, status: item.status })),
    };
    const gates = evaluateRunGates(bundle, run, context);
    const blocked = scan.errors.length > 0 || gates.blocking.length > 0;
    if (blocked) {
      run.status = 'blocked';
      tx.writeRun(run);
      return {
        session_id: located.sessionId,
        run_id: runId,
        status: run.status,
        gates,
        artifacts: scanSummary(scan),
        warnings: scan.warnings,
        errors: scan.errors,
        sealed: false,
        primary_artifact_id: null,
        artifact_ids: [],
      };
    }

    const artifactIds = registerArtifacts(bundle.artifacts, run, [...scan.artifacts, ...extraArtifacts]);
    const primary = artifactIds.find(id => bundle.artifacts.artifacts[id]?.role === 'primary') ?? null;
    const evidenceRefs = recordCompletionEvidence(bundle, run, artifactIds, frontmatter);
    run.output = {
      produces: artifactIds,
      primary_artifact_id: primary,
      verdict: frontmatter.verdict,
    };
    run.handoff = deriveHandoff(frontmatter, runId, run.command.name, artifactIds, evidenceRefs);
    if (!run.handoff.summary.trim() && options.summaryFallback?.trim()) {
      run.handoff.summary = options.summaryFallback.trim();
    }
    mergeNotesIntoConcerns(run.handoff, notes);
    mergeDecisionsIntoHandoff(run.handoff, options.decisions ?? []);
    run.status = 'sealed';
    run.sealed_at = localISO();
    bundle.session.latest_completed_run_id = runId;
    if (bundle.session.active_run_id === runId) bundle.session.active_run_id = null;
    bundle.session.activity_revision++;
    summarizeRegistry(bundle.gates);
    tx.writeRun(run);

    const nextState = ensureSessionProjection(state, projectSessionEntry(bundle.session));
    tx.writeJson(join(store.workflowRoot, 'state.json'), nextState);
    return {
      session_id: located.sessionId,
      run_id: runId,
      status: run.status,
      gates,
      artifacts: scanSummary(scan),
      warnings: scan.warnings,
      errors: scan.errors,
      sealed: true,
      primary_artifact_id: primary,
      artifact_ids: artifactIds,
    };
  });
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
function completionNextPointer(session: SessionState): { command: string; reason: string } {
  const sessionId = session.session_id;
  if (session.status === 'paused') {
    return {
      command: `maestro run next --session ${sessionId}`,
      reason: 'session paused (blocked step) — resolve the blocker, then resume',
    };
  }
  if (nextPendingIndex(session, true) !== null) {
    return {
      command: `maestro run next --session ${sessionId}`,
      reason: 'more pending steps — advance the chain',
    };
  }
  if (nextPendingDecisionIndex(session) !== null) {
    return {
      command: `maestro run next --session ${sessionId}`,
      reason: 'next node is a decision — the orchestrator evaluates it',
    };
  }
  return {
    command: `maestro run seal-session ${sessionId}`,
    reason: 'all steps complete — seal the session',
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
  const session = store.readBundle(sessionId).session;
  const boundStep = chainStepForRun(session, runId);

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
  });

  // Non-chain run: verdict is advisory, chain/session untouched. Signals already
  // landed on the handoff via completeRun above.
  if (!boundStep) {
    const current = store.readBundle(sessionId).session;
    return {
      session_id: sessionId,
      run_id: runId,
      verdict,
      run_sealed: seal.sealed,
      chain: null,
      session_status: current.status,
      next: completionNextPointer(current),
      seal,
    };
  }

  // Drive the bound chain step. A blocked seal (exit gates / scan errors) leaves
  // the run un-sealed; the verdict still applies to the chain so the orchestrator
  // sees the intended transition, but the un-sealed run status is reported.
  let retry: { count: number; max: number; exhausted: boolean } | null = null;
  let stepStatus: string;
  switch (verdict) {
    case 'done':
    case 'done-with-concerns':
      updateChainStepStatus(projectRoot, sessionId, boundStep.index, 'sealed', runId);
      stepStatus = 'sealed';
      break;
    case 'needs-retry': {
      retry = requeueChainStepForRetry(projectRoot, sessionId, boundStep.index);
      stepStatus = 'pending';
      break;
    }
    case 'blocked':
      updateChainStepStatus(projectRoot, sessionId, boundStep.index, 'failed', runId);
      store.update(sessionId, (draft) => {
        draft.session.status = 'paused';
        draft.session.activity_revision++;
        return null;
      });
      stepStatus = 'failed';
      break;
  }

  const after = store.readBundle(sessionId).session;
  return {
    session_id: sessionId,
    run_id: runId,
    verdict,
    run_sealed: seal.sealed,
    chain: {
      step_id: boundStep.step_id,
      index: boundStep.index,
      step_status: stepStatus,
      retry,
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
    return { handoff: null, consumes: [] };
  }
  const bundle = store.readBundle(sessionId);
  const handoff = handoffByLatestCompleted(store, bundle.session);
  const contract = resolveCommandSource(projectRoot, stepName).contract;
  const consumes: PrepareConsumeStatus[] = contract.consumes.map(consume => {
    const alias = consume.alias
      ?? Object.keys(bundle.artifacts.aliases).find(key => {
        const id = bundle.artifacts.aliases[key];
        return bundle.artifacts.artifacts[id]?.kind === consume.kind;
      })
      ?? null;
    const artifactId = alias ? bundle.artifacts.aliases[alias] : undefined;
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
  return { handoff, consumes };
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
  const located = store.findRun(runId, sessionId);
  const bundle = store.readBundle(located.sessionId);
  const run = located.run;
  const suffix = platform ? PLATFORM_SUFFIX[platform] : undefined;
  const content = resolveStepContent(projectRoot, run.command.name, suffix);
  const tx = (raw: string) => platform ? transformContentForPlatform(raw, platform) : raw;

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

  const upstream = upstreamForConsumedIds(located.sessionId, bundle.artifacts, run.input.consumes);
  const prevHandoff = latestHandoffBefore(store, located.sessionId, run.sequence);
  const anchor = buildAnchorSections(store, bundle.session);

  return {
    session_id: located.sessionId,
    run_id: runId,
    status: run.status,
    command: run.command.name,
    goal: run.handoff?.summary || bundle.session.intent,
    gates: gateSummary(bundle.gates, run.gate_ids),
    workflow: content.workflow
      ? { path: content.workflow.path, content: tx(content.workflow.raw) }
      : null,
    run_mode: content.runMode
      ? { path: content.runMode.path, summary: summarizeRunMode(tx(content.runMode.raw)) }
      : null,
    refs: content.refs,
    outputs,
    goal_mode: resolveGoalMode(content.prepare?.raw, platform ?? 'claude'),
    upstream,
    prev_handoff: prevHandoff,
    anchor,
    next: briefNext(located.sessionId, runId, run.status),
  };
}

/**
 * Next lifecycle verb after `run brief`, closing next→brief→check→complete
 * (plan P2.5/G4). A live Run points at `run check` (pre-completion gate check —
 * does not seal); a sealed Run points at `run next` to advance the chain.
 */
function briefNext(
  sessionId: string,
  runId: string,
  status: CommandRun['status'],
): { command: string; reason: string } {
  if (status === 'sealed' || status === 'completed') {
    return {
      command: `maestro run next --session ${sessionId}`,
      reason: 'run sealed — advance the chain',
    };
  }
  return {
    command: `maestro run check ${runId}`,
    reason: `pre-completion gate check (does not seal); when clean, run: maestro run complete ${runId}`,
  };
}
