// ---------------------------------------------------------------------------
// `maestro ralph next` — load next pending step.
//
// Flow:
//   1. Resolve session (must be `running`)
//   2. Consistency check: active_step_index must be null (or point to a
//      completed step we can clear). Decision nodes are skipped — caller
//      (ralph-execute.md) handles those via Skill("maestro-ralph") handoff.
//   3. Pick next `status==pending` execution step.
//   4. Load command_path .md + required_reading (via skill-resolver).
//   5. Write status.json: active_step_index = N, step.status = "running",
//      step.load.* populated.
//   6. stdout: framed prompt block + completion protocol.
//
// Exit codes:
//   0 — printed a step
//   2 — no more pending steps; session may need completion
//   3 — refused due to active_step_index already held (caller must complete first)
//   1 — generic error (E007 missing required_reading, etc.)
// ---------------------------------------------------------------------------

import type { RalphSession, RalphStep, RalphStepLoad, RalphTaskDecompositionItem } from './status-schema.js';
import { RALPH_PROTOCOL_VERSION } from './status-schema.js';
import { resolveSession, writeStatus, workflowRoot } from './status-store.js';
import { checkStatus } from './status-checker.js';
import { hasErrors } from './cmd-check.js';
import { loadSkill, normalizeStoredPath } from './skill-resolver.js';
import { loadSkillConfig } from '../config/skill-config.js';
import { workflowRoot as wfRoot } from './status-store.js';

export interface NextCmdOptions {
  sessionId?: string;
  executionOwner?: string;
  ownerEpoch?: number;
  leaseId?: string;
}

export async function runNext(opts: NextCmdOptions): Promise<number> {
  if (!opts.sessionId) {
    console.error('[ralph next] error: --session <id> is required for all state-writing operations.');
    return 1;
  }

  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    console.error(`[ralph next] no session found with id "${opts.sessionId}" in .workflow/.maestro/`);
    return 1;
  }
  const { sessionId, statusPath, data } = resolved;

  // Lease verification
  if (data.execution_owner && data.execution_owner !== opts.executionOwner) {
    console.error(`[ralph next] lease conflict: session owned by "${data.execution_owner}", got "${opts.executionOwner}"`);
    return 1;
  }
  if (data.lease_id && data.lease_id !== opts.leaseId) {
    console.error(`[ralph next] lease conflict: session lease_id is "${data.lease_id}", got "${opts.leaseId}"`);
    return 1;
  }
  if (data.owner_epoch !== undefined && opts.ownerEpoch !== undefined && data.owner_epoch > opts.ownerEpoch) {
    console.error(`[ralph next] lease conflict: session owner_epoch is ${data.owner_epoch}, got older epoch ${opts.ownerEpoch}`);
    return 1;
  }

  if (data.status !== 'running') {
    console.error(`[ralph next] session is "${data.status}", not running — edit status.json to resume`);
    return 1;
  }

  // E-level prerequisites — refuse if any.
  const findings = checkStatus(data);
  if (hasErrors(findings)) {
    console.error('[ralph next] status.json has errors:');
    for (const f of findings) {
      if (f.level !== 'E') continue;
      const loc = f.step_index !== undefined ? ` [step ${f.step_index}]` : '';
      console.error(`  ${f.code}${loc}: ${f.message}`);
    }
    // invariant 8: an E-level prerequisite (e.g. E007 missing required) must
    // PAUSE the session, not just return. A bare `return 1` leaves
    // status="running", so a goal-loop that re-invokes `next` retries the same
    // error forever (the R7/R10 "infinite-retry trap"). Pausing breaks the loop
    // — the next runNext() refuses at the status!=="running" gate above — and
    // surfaces the blocker. Mirrors the BLOCKED branch in cmd-complete.ts.
    data.status = 'paused';
    data.active_step_index = null;
    writeStatus(statusPath, data);
    console.error('  → session paused; fix status.json then set status="running" to resume');
    return 1;
  }

  // Auto-clear stale active_step_index pointing to a completed step (W005).
  if (data.active_step_index !== null && data.active_step_index !== undefined) {
    const cur = data.steps[data.active_step_index];
    if (cur && cur.status === 'completed') {
      data.active_step_index = null;
    } else {
      console.error(`[ralph next] step ${data.active_step_index} is still active (status=${cur?.status})`);
      console.error(`  → run: maestro ralph complete ${data.active_step_index} --status DONE|...`);
      console.error('    or:  maestro ralph retry ' + data.active_step_index);
      return 3;
    }
  }

  // Pick next pending execution step. Decision nodes (step.decision != null)
  // are intentionally skipped — this CLI only loads executable skill steps.
  // Decision evaluation belongs to the calling skill, which may either:
  //   - split: /maestro-ralph-execute handoff → /maestro-ralph (S_DECISION_EVAL)
  //   - codex: $maestro-ralph-execute handoff → $maestro-ralph
  // The CLI must NOT prescribe a specific skill name — that's the caller's
  // routing concern.
  const next = data.steps.find(s => s.status === 'pending' && !s.decision);
  if (!next) {
    // All execution steps done. Surface decision nodes as a hint.
    const pendingDecision = data.steps.find(s => s.status === 'pending' && s.decision);
    if (pendingDecision) {
      console.error(`[ralph next] no pending execution step; next is a decision node: ${pendingDecision.decision}`);
      console.error('  → decision nodes are not loadable via this CLI — the calling skill must evaluate them');
      console.error('    inline (e.g. S_DECISION_EVAL / S_TICK_DECISION via `maestro delegate --role analyze`)');
      console.error('  → do NOT re-invoke `maestro ralph next` for the same step; route by step.decision instead');
      return 2;
    }
    console.error('[ralph next] no pending steps — all complete');
    return 2;
  }

  // Validate command_path one more time at load time.
  if (!next.command_path) {
    console.error(`[ralph next] step ${next.index} has no command_path (skill="${next.skill}")`);
    return 1;
  }

  let loaded: ReturnType<typeof loadSkill>;
  try {
    loaded = loadSkill(normalizeStoredPath(next.command_path));
  } catch (err) {
    console.error(`[ralph next] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // Persist load record + mark running.
  const now = new Date().toISOString();
  const loadRecord: RalphStepLoad = {
    loaded_at: now,
    required_files: loaded.requiredPaths,
    deferred_files: loaded.deferredPaths,
    resolve_version: '1',
  };
  next.load = loadRecord;
  next.deferred_reads = loaded.deferredPaths;
  next.status = 'running';
  data.active_step_index = next.index;
  data.ralph_protocol_version = data.ralph_protocol_version ?? RALPH_PROTOCOL_VERSION;
  if (opts.executionOwner) data.execution_owner = opts.executionOwner;
  if (opts.leaseId) data.lease_id = opts.leaseId;
  if (opts.ownerEpoch !== undefined) data.owner_epoch = opts.ownerEpoch;
  writeStatus(statusPath, data);

  // stdout: framed prompt
  emitPrompt(sessionId, data, next, loaded);
  return 0;
}

function emitPrompt(
  sessionId: string,
  session: RalphSession,
  step: RalphStep,
  loaded: ReturnType<typeof loadSkill>,
): void {
  const total = session.steps.length;
  const idx = step.index;
  const args = (step.args ?? '').trim();

  // Inline <required_reading> @ references with their actual content so the
  // LLM sees a fully-expanded skill body (no separate banner blocks).
  const body = inlineRequiredReading(loaded.body, loaded.requiredBodies);

  // Skill config defaults — mirrors `src/hooks/skill-context.ts` behavior so
  // ralph-driven invocations get the same param injection as direct
  // `/<skill>` calls in Claude Code.
  const configSection = buildSkillConfigSection(step.skill, args);

  const anchor = buildSessionAnchor(session, step);
  const head = anchor ? anchor + '\n\n' : '';

  const argsLine = args ? ` args=${JSON.stringify(args)}` : '';
  const meta = [
    '',
    `<!-- maestro ralph: step [${idx}/${total}] skill=${step.skill}${argsLine} session=${sessionId} -->`,
    '<!-- On finish, run exactly one of:',
    `       maestro ralph complete ${idx} --session ${sessionId} --status DONE --summary "..." [--evidence <path>] [--decisions "..."] [--caveats "..."] [--deferred "..."]`,
    `       maestro ralph complete ${idx} --session ${sessionId} --status DONE_WITH_CONCERNS --summary "..." --concerns "..."`,
    `       maestro ralph retry ${idx} --session ${sessionId}`,
    `       maestro ralph complete ${idx} --session ${sessionId} --status BLOCKED --reason "<external blocker>"`,
    '     --summary is REQUIRED for DONE/DONE_WITH_CONCERNS (verb-led, ≤100 chars, core outcome). -->',
  ].join('\n');

  const tail = configSection ? '\n\n' + configSection + meta : meta;
  process.stdout.write(head + body + tail + '\n');
}

// Read-only grounding — skill must NOT echo or write back anchor fields.
function buildSessionAnchor(session: RalphSession, step: RalphStep): string | null {
  const intent = (session.intent ?? '').trim();
  if (!intent) return null;

  const parts: string[] = [];
  parts.push(`**Intent**: ${truncateAnchor(intent, 1200)}`);
  const phase = session.phase ?? '—';
  const scope = session.scope_verdict ?? 'unknown';
  parts.push(`**Scope**: ${scope} | Phase ${phase} | Milestone: ${session.milestone || '—'}`);

  const bc = session.boundary_contract;
  if (bc && (bc.in_scope?.length || bc.out_of_scope?.length || bc.constraints?.length || bc.definition_of_done)) {
    const lines = ['**Boundary Contract**:'];
    if (bc.in_scope?.length) lines.push(`- In scope: ${capAnchorList(bc.in_scope, 8)}`);
    if (bc.out_of_scope?.length) lines.push(`- Out of scope: ${capAnchorList(bc.out_of_scope, 8)}`);
    if (bc.constraints?.length) lines.push(`- Constraints: ${capAnchorList(bc.constraints, 8)}`);
    if (bc.definition_of_done) lines.push(`- Done when: ${truncateAnchor(bc.definition_of_done, 300)}`);
    parts.push(lines.join('\n'));
  }

  // Execution progress — sliding window of recent completed steps
  const completedSteps = session.steps.filter(
    s => s.status === 'completed' && s.completion_summary,
  );
  if (completedSteps.length > 0) {
    const recent = completedSteps.slice(-5);
    const pLines = ['**Execution Progress**:'];
    for (const s of recent) {
      pLines.push(`- [${s.index}] ${s.skill} (${s.stage}): ${truncateAnchor(s.completion_summary!, 200)}`);
      if (s.completion_caveats) {
        pLines.push(`  ⚠️ ${truncateAnchor(s.completion_caveats, 150)}`);
      }
    }
    const total = session.steps.filter(s => s.status === 'completed').length;
    const pending = session.steps.filter(s => s.status === 'pending').length;
    pLines.push(`- Progress: ${total} done, ${pending} pending`);
    parts.push(pLines.join('\n'));
  }

  // Task decomposition global view (current goals only, skip superseded)
  const activeGoals = (session.task_decomposition ?? []).filter(g => g.status !== 'superseded');
  if (activeGoals.length > 0) {
    const gLines = ['**Goals Overview**:'];
    for (const g of activeGoals) {
      const icon = g.status === 'done' ? '✓' : '○';
      gLines.push(`- [${icon}] ${g.id}: ${truncateAnchor(g.goal, 100)} — done_when: ${truncateAnchor(g.done_when ?? '', 80)}`);
    }
    if (session.goal_changelog?.length) {
      gLines.push(`- Course corrections: ${session.goal_changelog.length} applied`);
    }
    parts.push(gLines.join('\n'));
  }

  const goal = resolveGoalContext(session, step);
  if (goal) {
    const lines = [`**Current Goal** (${step.goal_ref}):`];
    lines.push(`- Goal: ${truncateAnchor(goal.goal, 300)}`);
    if (goal.boundary) lines.push(`- Boundary: ${truncateAnchor(goal.boundary, 200)}`);
    if (goal.done_when) lines.push(`- Done when: ${truncateAnchor(goal.done_when, 200)}`);
    if (goal.origin) lines.push(`- Origin: ${goal.origin}`);
    parts.push(lines.join('\n'));
  }

  if (session.execution_criteria?.length) {
    parts.push(`**Execution Criteria**: ${capAnchorList(session.execution_criteria, 5)}`);
  }

  // Accumulated signals — drift-prone caveats and deferred work from prior steps
  const allCaveats = session.steps
    .filter(s => s.status === 'completed' && s.completion_caveats)
    .map(s => s.completion_caveats!);
  const allDeferred = session.steps
    .filter(s => s.status === 'completed' && s.completion_deferred?.length)
    .flatMap(s => s.completion_deferred!);
  if (allCaveats.length > 0 || allDeferred.length > 0) {
    const sLines = ['**⚠️ Accumulated Signals**:'];
    if (allCaveats.length) sLines.push(`- Caveats: ${allCaveats.slice(-3).join('; ')}`);
    if (allDeferred.length) sLines.push(`- Deferred work: ${allDeferred.slice(-5).join('; ')}`);
    sLines.push('- **Before proceeding, verify these signals do not conflict with your current task.**');
    parts.push(sLines.join('\n'));
  }

  return [
    '<session_anchor>',
    `## Session Anchor — ${session.session_id}`,
    '',
    parts.join('\n\n'),
    '',
    '<!-- session_anchor: read-only grounding. Honor Intent + Boundary Contract before acting.',
    '     If your work would fall outside in_scope (or hit out_of_scope), stop and report via',
    `     \`maestro ralph complete <N> --session ${session.session_id} --status BLOCKED --reason "out_of_scope: ..."\` instead of proceeding.`,
    '     If Accumulated Signals suggest prior work conflicts with your task, report via',
    `     \`maestro ralph complete <N> --session ${session.session_id} --status BLOCKED --reason "drift_conflict: ..."\` instead of proceeding. -->`,
    '</session_anchor>',
  ].join('\n');
}

function resolveGoalContext(
  session: RalphSession,
  step: RalphStep,
): RalphTaskDecompositionItem | null {
  if (!step.goal_ref || !session.task_decomposition) return null;
  return session.task_decomposition.find(t => t.id === step.goal_ref) ?? null;
}

function truncateAnchor(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function capAnchorList(items: string[], n = 3): string {
  const shown = items.slice(0, n).map(s => truncateAnchor(s, 200));
  const extra = items.length > n ? ` (+${items.length - n} more)` : '';
  return shown.join('; ') + extra;
}

/**
 * Render skill-config defaults as a markdown section the LLM can read.
 *
 * Skip any parameter whose name appears literally in `args` — that's the same
 * "user explicitly specified — don't override" rule the hook uses.
 *
 * Returns null when there are no defaults or all are already overridden.
 */
function buildSkillConfigSection(skillName: string, args: string): string | null {
  if (!skillName) return null;
  let config;
  try {
    config = loadSkillConfig(wfRoot());
  } catch {
    return null;
  }
  const defaults = config.skills[skillName];
  if (!defaults || !defaults.params || Object.keys(defaults.params).length === 0) {
    return null;
  }
  const lines: string[] = [];
  for (const [param, value] of Object.entries(defaults.params)) {
    if (args.includes(param)) continue; // user already specified
    lines.push(`${param}: ${value}`);
  }
  if (lines.length === 0) return null;
  return [
    `## Skill Config Defaults (${skillName})`,
    'The following parameter defaults are configured. Apply these unless the user explicitly specified otherwise:',
    ...lines,
  ].join('\n');
}

/**
 * Replace every `@path` line inside the `<required_reading>` block with the
 * actual file content. Iterates `requiredBodies` in declaration order — the
 * same order `parseSkillManifest` produced them. If there are extra @ lines
 * without a matching loaded body (shouldn't happen if loadSkill succeeded),
 * they're left untouched.
 */
function inlineRequiredReading(
  body: string,
  requiredBodies: ReadonlyArray<{ path: string; content: string }>,
): string {
  const re = /<required_reading>([\s\S]*?)<\/required_reading>/i;
  const match = re.exec(body);
  if (!match) return body;

  const inner = match[1];
  const lines = inner.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  for (const line of lines) {
    const m = /@(\S+)/.exec(line);
    if (m && i < requiredBodies.length) {
      out.push(`<!-- inlined @${m[1]} -->`);
      out.push(requiredBodies[i].content);
      out.push('<!-- /inlined -->');
      i++;
      continue;
    }
    out.push(line);
  }
  return body.slice(0, match.index) +
    `<required_reading>\n${out.join('\n')}\n</required_reading>` +
    body.slice(match.index + match[0].length);
}
