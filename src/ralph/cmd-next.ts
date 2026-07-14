// ---------------------------------------------------------------------------
// `maestro ralph next` — load next pending step via standard Session/Run.
//
// Flow:
//   1. Resolve ralph session (engine='ralph', status='running')
//   2. Find next pending execution step in orchestration.chain[]
//   3. Load step content via resolveStepContent()
//   4. Create a standard Run via createRun()
//   5. Update chain[].status = 'running', chain[].run_id = run_id
//   6. stdout: framed prompt block + completion protocol
//
// Exit codes:
//   0 — printed a step
//   2 — no more pending steps; session may need completion
//   3 — refused: a step is already running (caller must complete first)
//   1 — generic error
// ---------------------------------------------------------------------------

import { resolveStepContent } from '../run/contract.js';
import { createRun } from '../run/runtime.js';
import { loadSkillConfig } from '../config/skill-config.js';
import {
  resolveRalphSession,
  readMeta,
  activeStepIndex,
  nextPendingIndex,
  nextPendingDecisionIndex,
  updateChainStepStatus,
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

  const { sessionId, sessionDir, bundle, meta } = resolved;
  const session = bundle.session;

  // Lease verification against ralph-meta
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

  // Check if a step is already running
  const runningIdx = activeStepIndex(session);
  if (runningIdx !== null) {
    const step = session.orchestration.chain[runningIdx];
    console.error(`[ralph next] step ${runningIdx} is still running (command=${step.command})`);
    console.error(`  → run: maestro ralph complete ${runningIdx} --status DONE|...`);
    return 3;
  }

  // Find next pending execution step (skip decision nodes)
  const nextIdx = nextPendingIndex(session, true);
  if (nextIdx === null) {
    const decisionIdx = nextPendingDecisionIndex(session);
    if (decisionIdx !== null) {
      const dp = session.orchestration.chain[decisionIdx];
      console.error(`[ralph next] no pending execution step; next is a decision node: ${dp.decision_ref}`);
      console.error('  → decision nodes are evaluated by the orchestrator, not via ralph next');
      return 2;
    }
    console.error('[ralph next] no pending steps — all complete');
    return 2;
  }

  const chainStep = session.orchestration.chain[nextIdx];
  const stepCommand = chainStep.command;

  // Load step content via standard resolver
  const content = resolveStepContent(projectRoot, stepCommand);
  if (!content.prepare && !content.workflow) {
    console.error(`[ralph next] step ${nextIdx} command "${stepCommand}" has no prepare or workflow content`);
    return 1;
  }

  // Create a standard Run for this step
  const stepDetail = meta.step_details?.[chainStep.step_id];
  const args = stepDetail?.args ? [stepDetail.args] : [];
  let runResult;
  try {
    runResult = createRun({
      projectRoot,
      command: stepCommand,
      sessionId,
      intent: session.intent,
      args,
    });
  } catch (err) {
    console.error(`[ralph next] failed to create run: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // Update chain step status + run_id
  updateChainStepStatus(projectRoot, sessionId, nextIdx, 'running', runResult.run_id);

  // Update lease in meta
  if (opts.executionOwner || opts.leaseId) {
    updateRalphMeta(projectRoot, sessionId, (m) => {
      if (opts.executionOwner) m.execution_owner = opts.executionOwner;
      if (opts.leaseId) m.lease_id = opts.leaseId;
      if (opts.ownerEpoch !== undefined) m.owner_epoch = opts.ownerEpoch;
    });
  }

  // Emit prompt
  emitPrompt(sessionId, session, meta, nextIdx, chainStep, stepDetail ?? null, content, runResult.run_id);
  return 0;
}

function emitPrompt(
  sessionId: string,
  session: SessionState,
  meta: RalphMeta,
  stepIndex: number,
  chainStep: { step_id: string; command: string },
  detail: RalphStepDetail | null,
  content: ReturnType<typeof resolveStepContent>,
  runId: string,
): void {
  const total = session.orchestration.chain.length;
  const command = chainStep.command;
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
  const head = anchor ? anchor + '\n\n' : '';

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

function buildSessionAnchor(
  sessionId: string,
  session: SessionState,
  meta: RalphMeta,
  chainStep: { step_id: string; command: string },
  detail: RalphStepDetail | null,
): string | null {
  const intent = session.intent.trim();
  if (!intent) return null;

  const parts: string[] = [];
  parts.push(`**Intent**: ${truncate(intent, 1200)}`);

  const phase = meta.phase ?? '—';
  const scope = meta.scope_verdict ?? 'unknown';
  parts.push(`**Scope**: ${scope} | Phase ${phase} | Milestone: ${meta.milestone || '—'}`);

  const bc = session.boundary_contract;
  if (bc.in_scope.length || bc.out_of_scope.length || bc.constraints.length || bc.definition_of_done) {
    const lines = ['**Boundary Contract**:'];
    if (bc.in_scope.length) lines.push(`- In scope: ${capList(bc.in_scope, 8)}`);
    if (bc.out_of_scope.length) lines.push(`- Out of scope: ${capList(bc.out_of_scope, 8)}`);
    if (bc.constraints.length) lines.push(`- Constraints: ${capList(bc.constraints, 8)}`);
    if (bc.definition_of_done) lines.push(`- Done when: ${truncate(bc.definition_of_done, 300)}`);
    parts.push(lines.join('\n'));
  }

  // Execution progress from completed chain steps
  const chain = session.orchestration.chain;
  const completedSteps = chain.filter(s => s.status === 'completed' || s.status === 'sealed');
  if (completedSteps.length > 0 && meta.step_details) {
    const recent = completedSteps.slice(-5);
    const pLines = ['**Execution Progress**:'];
    for (const s of recent) {
      const d = meta.step_details[s.step_id];
      const summary = d?.completion_summary ?? '(no summary)';
      pLines.push(`- [${s.step_id}] ${s.command} (${d?.stage ?? '—'}): ${truncate(summary, 200)}`);
      if (d?.completion_caveats) {
        pLines.push(`  ⚠️ ${truncate(d.completion_caveats, 150)}`);
      }
    }
    const doneCount = completedSteps.length;
    const pendingCount = chain.filter(s => s.status === 'pending').length;
    pLines.push(`- Progress: ${doneCount} done, ${pendingCount} pending`);
    parts.push(pLines.join('\n'));
  }

  // Task decomposition
  const activeGoals = (meta.task_decomposition ?? []).filter(g => g.status !== 'superseded');
  if (activeGoals.length > 0) {
    const gLines = ['**Goals Overview**:'];
    for (const g of activeGoals) {
      const icon = g.status === 'done' ? '✓' : '○';
      gLines.push(`- [${icon}] ${g.id}: ${truncate(g.goal, 100)} — done_when: ${truncate(g.done_when ?? '', 80)}`);
    }
    if (meta.goal_changelog?.length) {
      gLines.push(`- Course corrections: ${meta.goal_changelog.length} applied`);
    }
    parts.push(gLines.join('\n'));
  }

  // Current goal
  if (detail?.goal_ref && meta.task_decomposition) {
    const goal = meta.task_decomposition.find(t => t.id === detail.goal_ref);
    if (goal) {
      const lines = [`**Current Goal** (${detail.goal_ref}):`];
      lines.push(`- Goal: ${truncate(goal.goal, 300)}`);
      if (goal.boundary) lines.push(`- Boundary: ${truncate(goal.boundary, 200)}`);
      if (goal.done_when) lines.push(`- Done when: ${truncate(goal.done_when, 200)}`);
      if (goal.origin) lines.push(`- Origin: ${goal.origin}`);
      parts.push(lines.join('\n'));
    }
  }

  if (meta.execution_criteria?.length) {
    parts.push(`**Execution Criteria**: ${capList(meta.execution_criteria, 5)}`);
  }

  // Accumulated signals from completed steps
  const allCaveats: string[] = [];
  const allDeferred: string[] = [];
  if (meta.step_details) {
    for (const s of completedSteps) {
      const d = meta.step_details[s.step_id];
      if (d?.completion_caveats) allCaveats.push(d.completion_caveats);
      if (d?.completion_deferred?.length) allDeferred.push(...d.completion_deferred);
    }
  }
  if (allCaveats.length > 0 || allDeferred.length > 0) {
    const sLines = ['**⚠️ Accumulated Signals**:'];
    if (allCaveats.length) sLines.push(`- Caveats: ${allCaveats.slice(-3).join('; ')}`);
    if (allDeferred.length) sLines.push(`- Deferred work: ${allDeferred.slice(-5).join('; ')}`);
    sLines.push('- **Before proceeding, verify these signals do not conflict with your current task.**');
    parts.push(sLines.join('\n'));
  }

  return [
    '<session_anchor>',
    `## Session Anchor — ${sessionId}`,
    '',
    parts.join('\n\n'),
    '',
    '<!-- session_anchor: read-only grounding. Honor Intent + Boundary Contract before acting.',
    '     If your work would fall outside in_scope (or hit out_of_scope), stop and report via',
    `     \`maestro ralph complete <N> --session ${sessionId} --status BLOCKED --reason "out_of_scope: ..."\` instead of proceeding.`,
    '     If Accumulated Signals suggest prior work conflicts with your task, report via',
    `     \`maestro ralph complete <N> --session ${sessionId} --status BLOCKED --reason "drift_conflict: ..."\` instead of proceeding. -->`,
    '</session_anchor>',
  ].join('\n');
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function capList(items: string[], n = 3): string {
  const shown = items.slice(0, n).map(s => truncate(s, 200));
  const extra = items.length > n ? ` (+${items.length - n} more)` : '';
  return shown.join('; ') + extra;
}
