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
import type { RunUpstream, PrevHandoff } from '../run/runtime.js';
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
  updateRalphMeta,
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

  // Lease verification against ralph-meta (ralph-specific — messages unchanged).
  if (meta.execution_owner && meta.execution_owner !== opts.executionOwner) {
    console.error(`[ralph next] lease conflict: session owned by "${meta.execution_owner}", got "${opts.executionOwner}"`);
    return 1;
  }
  if (meta.lease_id && meta.lease_id !== opts.leaseId) {
    console.error(`[ralph next] lease conflict: session lease_id is "${meta.lease_id}", got "${opts.leaseId}"`);
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
  const outcome = runNextStep(projectRoot, { sessionId, args: pendingArgs });
  if (outcome.exitCode !== 0 || !outcome.result) {
    console.error(rebrand(outcome.message));
    return outcome.exitCode;
  }

  // Persist the lease into meta now that the step is live.
  if (opts.executionOwner || opts.leaseId) {
    updateRalphMeta(projectRoot, sessionId, (m) => {
      if (opts.executionOwner) m.execution_owner = opts.executionOwner;
      if (opts.leaseId) m.lease_id = opts.leaseId;
      if (opts.ownerEpoch !== undefined) m.owner_epoch = opts.ownerEpoch;
    });
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
    return detail?.args ? [detail.args] : [];
  }
  return [];
}

function emitPrompt(
  sessionId: string,
  session: SessionState,
  meta: RalphMeta,
  result: NextResult,
  chainStep: { step_id: string; command: string },
  detail: RalphStepDetail | null,
  content: ReturnType<typeof resolveStepContent>,
): void {
  const stepIndex = result.step.index;
  const total = result.step.total;
  const command = chainStep.command;
  const runId = result.run_id;
  const args = (detail?.args ?? '').trim();

  // Build body from workflow content (primary) or prepare content
  let body = '';
  if (content.workflow) {
    body = content.workflow.raw;
  } else if (content.prepare) {
    body = content.prepare.raw;
  }

  // Inject run-mode if available
  if (content.runMode) {
    body = content.runMode.raw + '\n\n---\n\n' + body;
  }

  // Skill config defaults
  const configSection = buildSkillConfigSection(command, args);
  const anchor = buildSessionAnchor(sessionId, session, meta, chainStep, detail);
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
  sessionId: string,
  session: SessionState,
  meta: RalphMeta,
  chainStep: { step_id: string; command: string },
  detail: RalphStepDetail | null,
): string | null {
  // Core section — Intent. Empty intent suppresses the whole anchor: it drops
  // the only guaranteed-first section, and buildEnvelope wraps nothing.
  const intentSection = buildIntentSection(session.intent);
  if (!intentSection) return null;

  const chain = session.orchestration.chain;
  const completedSteps = chain.filter(s => s.status === 'completed' || s.status === 'sealed');

  // Sections are composed in the ralph anchor's canonical order. Core sections
  // (Intent / Boundary / Progress / Signals) come from src/run/inject.ts; the
  // interleaved ralph extension sections (Scope / Goals / Current Goal /
  // Criteria) are built here from ralph-meta.
  return buildEnvelope({
    sessionId,
    completionVerb: (n) => `maestro ralph complete ${n} --session ${sessionId}`,
    sections: [
      intentSection,
      buildScopeSection(meta),
      buildBoundaryContractSection(session.boundary_contract),
      buildProgressSection({
        recent: completedSteps.length > 0 && meta.step_details
          ? completedSteps.slice(-5).map(s => {
              const d = meta.step_details![s.step_id];
              return {
                step_id: s.step_id,
                command: s.command,
                stage: d?.stage ?? null,
                summary: d?.completion_summary ?? null,
                caveats: d?.completion_caveats ?? null,
              };
            })
          : [],
        done_count: completedSteps.length,
        pending_count: chain.filter(s => s.status === 'pending').length,
      }),
      buildGoalsSection(meta),
      buildCurrentGoalSection(meta, detail),
      buildCriteriaSection(meta),
      buildSignalsSection(collectSignals(meta, completedSteps)),
    ],
  });
}

// ── Ralph extension sections (ralph-meta grounded) ───────────────────────────

function buildScopeSection(meta: RalphMeta): string {
  const phase = meta.phase ?? '—';
  const scope = meta.scope_verdict ?? 'unknown';
  return `**Scope**: ${scope} | Phase ${phase} | Milestone: ${meta.milestone || '—'}`;
}

function buildGoalsSection(meta: RalphMeta): string | null {
  const activeGoals = (meta.task_decomposition ?? []).filter(g => g.status !== 'superseded');
  if (activeGoals.length === 0) return null;
  const gLines = ['**Goals Overview**:'];
  for (const g of activeGoals) {
    const icon = g.status === 'done' ? '✓' : '○';
    gLines.push(`- [${icon}] ${g.id}: ${truncate(g.goal, 100)} — done_when: ${truncate(g.done_when ?? '', 80)}`);
  }
  if (meta.goal_changelog?.length) {
    gLines.push(`- Course corrections: ${meta.goal_changelog.length} applied`);
  }
  return gLines.join('\n');
}

function buildCurrentGoalSection(meta: RalphMeta, detail: RalphStepDetail | null): string | null {
  if (!detail?.goal_ref || !meta.task_decomposition) return null;
  const goal = meta.task_decomposition.find(t => t.id === detail.goal_ref);
  if (!goal) return null;
  const lines = [`**Current Goal** (${detail.goal_ref}):`];
  lines.push(`- Goal: ${truncate(goal.goal, 300)}`);
  if (goal.boundary) lines.push(`- Boundary: ${truncate(goal.boundary, 200)}`);
  if (goal.done_when) lines.push(`- Done when: ${truncate(goal.done_when, 200)}`);
  if (goal.origin) lines.push(`- Origin: ${goal.origin}`);
  return lines.join('\n');
}

function buildCriteriaSection(meta: RalphMeta): string | null {
  if (!meta.execution_criteria?.length) return null;
  return `**Execution Criteria**: ${capList(meta.execution_criteria, 5)}`;
}

function collectSignals(
  meta: RalphMeta,
  completedSteps: SessionState['orchestration']['chain'],
): { caveats: string[]; deferred: string[] } {
  const caveats: string[] = [];
  const deferred: string[] = [];
  if (meta.step_details) {
    for (const s of completedSteps) {
      const d = meta.step_details[s.step_id];
      if (d?.completion_caveats) caveats.push(d.completion_caveats);
      if (d?.completion_deferred?.length) deferred.push(...d.completion_deferred);
    }
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
