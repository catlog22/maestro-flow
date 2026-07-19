// ---------------------------------------------------------------------------
// `maestro ralph next` — adapter over the shared `run next` step driver.
//
// Ralph owns the lease semantics and the single-shot prompt shape its executor
// expects; the generic step-driving trunk (locate pending step → createRun →
// advance chain, plus the running/decision/no-pending/no-content guards and the
// upstream/prev-handoff collection) lives in src/run/next.ts. This file:
//   1. Resolves the ralph session + verifies the lease (ralph-specific).
//   2. Calls runNextStep() to advance the chain and mint the Run.
//   3. Assembles the executor prompt = session anchor + upstream/handoff birth
//      sections + workflow body + run-mode + skill config + completion meta.
//
// The stdout structure the ralph-executor / maestro-ralph.md FSM depend on
// (completion meta comment format, exit codes, flags) is unchanged.
//
// Exit codes (unchanged, mirror runNextStep):
//   0 — printed a step
//   2 — no more pending steps, or next is a decision node
//   3 — refused: a step is already running (caller must complete first)
//   1 — generic error
// ---------------------------------------------------------------------------

import { resolveStepContent } from '../run/contract.js';
import { runNextStep, type NextResult } from '../run/next.js';
import { summarizeRunMode, type RunUpstream, type PrevHandoff } from '../run/runtime.js';
import { SessionStore } from '../run/store.js';
import { checkLease } from '../run/lease.js';
import {
  buildEnvelope,
  buildIntentSection,
  buildBoundaryContractSection,
  buildProgressSection,
  buildSignalsSection,
  truncate,
  capList,
} from '../run/inject.js';
import { loadSkillConfig } from '../config/skill-config.js';
import {
  resolveRalphSession,
  effectiveDecomposition,
  effectiveLease,
  effectivePosition,
  workflowRoot,
  type RalphMeta,
  type RalphStepDetail,
} from './session-adapter.js';
import type { SessionState } from '../run/schemas.js';

export interface NextCmdOptions {
  sessionId?: string;
  executionOwner?: string;
  ownerEpoch?: number;
  leaseId?: string;
}

export async function runNext(opts: NextCmdOptions): Promise<number> {
  const projectRoot = workflowRoot();
  const resolved = resolveRalphSession(projectRoot, opts.sessionId);
  if (!resolved) {
    const msg = opts.sessionId
      ? `[ralph next] no ralph session found with id "${opts.sessionId}"`
      : '[ralph next] no running ralph session found in .workflow/sessions/';
    console.error(msg);
    return 1;
  }

  const { sessionId, bundle, meta } = resolved;
  const session = bundle.session;

  const leaseConflict = checkLease(effectiveLease(session, meta), {
    executionOwner: opts.executionOwner,
    ownerEpoch: opts.ownerEpoch,
    leaseId: opts.leaseId,
  });
  if (leaseConflict) {
    console.error(`[ralph next] ${leaseConflict}`);
    return 1;
  }

  if (session.status !== 'running') {
    console.error(`[ralph next] session is "${session.status}", not running`);
    return 1;
  }

  // Determine the pending step's args from ralph-meta before advancing, so they
  // are forwarded to createRun (preserving the pre-adapter behaviour where the
  // Run records the step args) and to the skill-config / current-goal sections.
  const pendingArgs = pendingStepArgs(session, meta);

  // Advance the chain + mint the Run via the shared driver. It owns the
  // running/decision/no-pending/no-content guards; re-brand its generic messages
  // as ralph so executor-facing stderr keeps the `[ralph next]` prefix.
  const outcome = runNextStep(projectRoot, {
    sessionId,
    args: pendingArgs,
    executionOwner: opts.executionOwner,
    ownerEpoch: opts.ownerEpoch,
    leaseId: opts.leaseId,
  });
  if (outcome.exitCode !== 0 || !outcome.result) {
    console.error(rebrand(outcome.message));
    return outcome.exitCode;
  }

  // Build the prompt from the pre-advance session snapshot: the legacy emitter
  // counted the just-dispatched step as pending in the anchor's Progress line,
  // so re-reading post-flip state here would shift pending_count by one.
  const result = outcome.result;
  const chainStep = session.orchestration.chain[result.step.index];
  const stepDetail = meta.step_details?.[chainStep.step_id] ?? null;
  const content = resolveStepContent(projectRoot, chainStep.command);

  emitPrompt(sessionId, session, meta, result, chainStep, stepDetail, content);
  return 0;
}

/**
 * `--session`-scoped rebrand: swap the generic `[run next]` prefix the shared
 * driver emits for ralph's `[ralph next]`, keeping the human-readable body and
 * pointing users at the ralph completion verb rather than `run complete`.
 */
function rebrand(message: string): string {
  return message
    .replace(/\[run next\]/g, '[ralph next]')
    .replace(/maestro run complete (\S+) --session (\S+)/g, 'maestro ralph complete $1 --session $2')
    .replace('not via run next', 'not via ralph next');
}

/** Args of the next pending execution step, read from ralph-meta step_details. */
function pendingStepArgs(session: SessionState, meta: RalphMeta): string[] {
  const chain = session.orchestration.chain;
  for (const step of chain) {
    if (step.status !== 'pending' || step.decision_ref) continue;
    const detail = meta.step_details?.[step.step_id];
    const args = step.args ?? detail?.args;
    return args ? [args] : [];
  }
  return [];
}

function emitPrompt(
  sessionId: string,
  session: SessionState,
  meta: RalphMeta,
  result: NextResult,
  chainStep: SessionState['orchestration']['chain'][number],
  detail: RalphStepDetail | null,
  content: ReturnType<typeof resolveStepContent>,
): void {
  const stepIndex = result.step.index;
  const total = result.step.total;
  const command = chainStep.command;
  const runId = result.run_id;
  const args = (chainStep.args ?? detail?.args ?? '').trim();

  // Build body from workflow content (primary) or prepare content
  let body = '';
  if (content.workflow) {
    body = content.workflow.raw;
  } else if (content.prepare) {
    body = content.prepare.raw;
  }

  // Inject run-mode as a summary (not the raw full text). Progressive control
  // injection (plan P2.5/G8): the run-mode protocol is not re-shipped in full to
  // the orchestrated executor — the summary carries the essentials and a
  // generated control line compensates for the artifact-boundary guidance lost
  // when the full "Start or Resume" section (which tells a standalone executor to
  // `maestro run create`) is dropped. The Run is already created here.
  if (content.runMode) {
    const control = [
      `<!-- run-mode: summary only — full protocol at ${content.runMode.path} -->`,
      `Run already created: ${runId} — write formal artifacts to ${result.run_dir}/outputs/, human synthesis to ${result.run_dir}/report.md. Do NOT call \`maestro run create\`.`,
    ].join('\n');
    body = summarizeRunMode(content.runMode.raw) + '\n\n' + control + '\n\n---\n\n' + body;
  }

  // Deferred-reading manifest (plan P2.5/G3): list prepare-declared refs as
  // path + when so the executor can Read on demand. Manifest only — ref bodies
  // are never inlined.
  const refsSection = buildRefsSection(content.refs);
  if (refsSection) {
    body = body + '\n\n' + refsSection;
  }

  // Skill config defaults
  const configSection = buildSkillConfigSection(command, args);
  const store = new SessionStore(workflowRoot());
  const anchor = buildSessionAnchor(store, sessionId, session, meta, chainStep, detail);
  const upstreamSection = buildUpstreamSection(result.upstream, result.prev_handoff);
  const headParts = [anchor, upstreamSection].filter((s): s is string => Boolean(s));
  const head = headParts.length > 0 ? headParts.join('\n\n') + '\n\n' : '';

  const argsLine = args ? ` args=${JSON.stringify(args)}` : '';
  const completionMeta = [
    '',
    `<!-- maestro ralph: step [${stepIndex}/${total}] command=${command}${argsLine} session=${sessionId} run=${runId} -->`,
    '<!-- On finish, run exactly one of:',
    `       maestro ralph complete ${stepIndex} --session ${sessionId} --status DONE --summary "..." [--evidence <path>] [--decisions "..."] [--caveats "..."] [--deferred "..."]`,
    `       maestro ralph complete ${stepIndex} --session ${sessionId} --status DONE_WITH_CONCERNS --summary "..." --concerns "..."`,
    `       maestro ralph retry ${stepIndex} --session ${sessionId}`,
    `       maestro ralph complete ${stepIndex} --session ${sessionId} --status BLOCKED --reason "<external blocker>"`,
    '     --summary is REQUIRED for DONE/DONE_WITH_CONCERNS (verb-led, ≤100 chars, core outcome). -->',
  ].join('\n');

  const tail = configSection ? '\n\n' + configSection + completionMeta : completionMeta;
  process.stdout.write(head + body + tail + '\n');
}

/**
 * Deferred-reading manifest from prepare-declared refs (path + when). Manifest
 * only — ref bodies are never inlined (plan P2.5/G3). Null when there are none.
 */
function buildRefsSection(refs: Array<{ path: string; when: string }>): string | null {
  if (refs.length === 0) return null;
  const lines = ['**按需参考（Read when needed）**:'];
  for (const ref of refs) {
    lines.push(ref.when ? `- ${ref.path} — ${ref.when}` : `- ${ref.path}`);
  }
  return lines.join('\n');
}

// ── Upstream + prev-handoff birth sections (from NextResult) ──────────────────

/**
 * Surfaces the upstream alias→path map and the previous step's handoff carried
 * by NextResult. The pre-adapter emitPrompt dropped createRun's upstream map
 * (the "丢弃 bug" the refactor plan calls out); this restores it.
 */
function buildUpstreamSection(
  upstream: Record<string, RunUpstream>,
  prev: PrevHandoff | null,
): string | null {
  const lines: string[] = [];
  const aliases = Object.keys(upstream);
  if (aliases.length > 0) {
    lines.push('**Upstream inputs**:');
    for (const alias of aliases) {
      const u = upstream[alias];
      lines.push(`- ${alias} → ${u.path} (${u.kind}, ${u.status})`);
    }
  }
  if (prev) {
    if (lines.length > 0) lines.push('');
    lines.push(`**Previous step** (${prev.run_id}, ${prev.verdict}):`);
    lines.push(`- ${prev.summary || '(no summary)'}`);
    if (prev.concerns.length > 0) {
      lines.push(`- ⚠️ concerns: ${prev.concerns.join('; ')}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

function buildSessionAnchor(
  store: SessionStore,
  sessionId: string,
  session: SessionState,
  meta: RalphMeta,
  chainStep: SessionState['orchestration']['chain'][number],
  detail: RalphStepDetail | null,
): string | null {
  // Core section — Intent. Empty intent suppresses the whole anchor: it drops
  // the only guaranteed-first section, and buildEnvelope wraps nothing.
  const intentSection = buildIntentSection(session.intent);
  if (!intentSection) return null;

  const chain = session.orchestration.chain;
  const completedSteps = chain.filter(s => s.status === 'completed' || s.status === 'sealed');
  const position = effectivePosition(session, meta);
  const decomposition = effectiveDecomposition(session, meta);

  // Sections are composed in the ralph anchor's canonical order. Core sections
  // (Intent / Boundary / Progress / Signals) come from src/run/inject.ts; the
  // interleaved ralph extension sections (Scope / Goals / Current Goal /
  // Criteria) are built here from ralph-meta.
  return buildEnvelope({
    sessionId,
    completionVerb: (n) => `maestro ralph complete ${n} --session ${sessionId}`,
    sections: [
      intentSection,
      buildScopeSection(position),
      buildBoundaryContractSection(session.boundary_contract),
      buildProgressSection({
        recent: completedSteps.length > 0
          ? completedSteps.slice(-5).map(s => {
              const handoff = readStepHandoff(store, sessionId, s.run_id);
              const d = meta.step_details?.[s.step_id];
              // Progress summary/caveats prefer the completed Run's handoff
              // (single source), falling back to ralph-meta step_details during
              // the dual-write transition. Stage has no handoff analogue, so it
              // always comes from step_details.
              return {
                step_id: s.step_id,
                command: s.command,
                stage: s.stage ?? d?.stage ?? null,
                summary: handoff?.summary || (d?.completion_summary ?? null),
                caveats: concernsAsCaveat(handoff) ?? (d?.completion_caveats ?? null),
              };
            })
          : [],
        done_count: completedSteps.length,
        pending_count: chain.filter(s => s.status === 'pending').length,
      }),
      buildGoalsSection(decomposition),
      buildCurrentGoalSection(decomposition, chainStep.goal_ref ?? detail?.goal_ref ?? null),
      buildCriteriaSection(decomposition),
      buildSignalsSection(collectSignals(store, sessionId, meta, completedSteps)),
    ],
  });
}

/** Handoff of a completed chain step's Run, or null when unreadable/absent. */
function readStepHandoff(
  store: SessionStore,
  sessionId: string,
  runId: string | null,
): { summary: string; concerns: string[] } | null {
  if (!runId) return null;
  try {
    const handoff = store.readRun(sessionId, runId).handoff;
    return handoff ? { summary: handoff.summary, concerns: handoff.concerns } : null;
  } catch {
    return null;
  }
}

/** A handoff's concerns joined into the single Progress caveats slot. */
function concernsAsCaveat(handoff: { concerns: string[] } | null): string | null {
  return handoff && handoff.concerns.length > 0 ? handoff.concerns.join('; ') : null;
}

// ── Ralph extension sections (ralph-meta grounded) ───────────────────────────

function buildScopeSection(position: ReturnType<typeof effectivePosition>): string {
  const phase = position.phase ?? '—';
  const scope = position.scope_verdict ?? 'unknown';
  return `**Scope**: ${scope} | Phase ${phase} | Milestone: ${position.milestone || '—'}`;
}

function buildGoalsSection(decomposition: ReturnType<typeof effectiveDecomposition>): string | null {
  const activeGoals = decomposition.goals.filter(g => g.status !== 'superseded');
  if (activeGoals.length === 0) return null;
  const gLines = ['**Goals Overview**:'];
  for (const g of activeGoals) {
    const icon = g.status === 'done' ? '✓' : '○';
    gLines.push(`- [${icon}] ${g.id}: ${truncate(g.goal, 100)} — done_when: ${truncate(g.done_when ?? '', 80)}`);
  }
  if (decomposition.changelog.length) {
    gLines.push(`- Course corrections: ${decomposition.changelog.length} applied`);
  }
  return gLines.join('\n');
}

function buildCurrentGoalSection(
  decomposition: ReturnType<typeof effectiveDecomposition>,
  goalRef: string | null,
): string | null {
  if (!goalRef) return null;
  const goal = decomposition.goals.find(t => t.id === goalRef);
  if (!goal) return null;
  const lines = [`**Current Goal** (${goalRef}):`];
  lines.push(`- Goal: ${truncate(goal.goal, 300)}`);
  if (goal.boundary) lines.push(`- Boundary: ${truncate(goal.boundary, 200)}`);
  if (goal.done_when) lines.push(`- Done when: ${truncate(goal.done_when, 200)}`);
  if (goal.origin) lines.push(`- Origin: ${goal.origin}`);
  return lines.join('\n');
}

function buildCriteriaSection(decomposition: ReturnType<typeof effectiveDecomposition>): string | null {
  if (!decomposition.execution_criteria.length) return null;
  return `**Execution Criteria**: ${capList(decomposition.execution_criteria, 5)}`;
}

function collectSignals(
  store: SessionStore,
  sessionId: string,
  meta: RalphMeta,
  completedSteps: SessionState['orchestration']['chain'],
): { caveats: string[]; deferred: string[] } {
  const caveats: string[] = [];
  const deferred: string[] = [];
  for (const s of completedSteps) {
    const handoff = readStepHandoff(store, sessionId, s.run_id);
    const d = meta.step_details?.[s.step_id];
    // Caveats prefer the completed Run's handoff.concerns (single source),
    // falling back to step_details.completion_caveats during the dual-write
    // transition. Deferred work has no handoff analogue — concerns folds the
    // caveats+deferred semantics — so it always reads step_details (hybrid).
    if (handoff && handoff.concerns.length > 0) caveats.push(...handoff.concerns);
    else if (d?.completion_caveats) caveats.push(d.completion_caveats);
    if (d?.completion_deferred?.length) deferred.push(...d.completion_deferred);
  }
  return { caveats, deferred };
}

function buildSkillConfigSection(skillName: string, args: string): string | null {
  if (!skillName) return null;
  let config;
  try {
    config = loadSkillConfig(workflowRoot());
  } catch {
    return null;
  }
  const defaults = config.skills[skillName];
  if (!defaults || !defaults.params || Object.keys(defaults.params).length === 0) {
    return null;
  }
  const lines: string[] = [];
  for (const [param, value] of Object.entries(defaults.params)) {
    if (args.includes(param)) continue;
    lines.push(`${param}: ${value}`);
  }
  if (lines.length === 0) return null;
  return [
    `## Skill Config Defaults (${skillName})`,
    'The following parameter defaults are configured. Apply these unless the user explicitly specified otherwise:',
    ...lines,
  ].join('\n');
}
