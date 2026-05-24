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

import type { RalphSession, RalphStep, RalphStepLoad } from './status-schema.js';
import { RALPH_PROTOCOL_VERSION } from './status-schema.js';
import { resolveSession, writeStatus, workflowRoot } from './status-store.js';
import { checkStatus } from './status-checker.js';
import { hasErrors } from './cmd-check.js';
import { loadSkill, normalizeStoredPath } from './skill-resolver.js';
import { loadSkillConfig } from '../config/skill-config.js';
import { workflowRoot as wfRoot } from './status-store.js';

export interface NextCmdOptions {
  sessionId?: string;
}

export async function runNext(opts: NextCmdOptions): Promise<number> {
  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    console.error('[ralph next] no maestro-* / ralph-* session found in .workflow/.maestro/');
    return 1;
  }
  const { sessionId, statusPath, data } = resolved;

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
    console.error('  → edit status.json manually, then retry');
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
  //   - v1 (split):   /maestro-ralph-execute handoff → /maestro-ralph (S_DECISION_EVAL)
  //   - v1 (codex):   $maestro-ralph-execute handoff → $maestro-ralph
  //   - v2 (single):  /maestro-ralph-beta inline tick (S_TICK_DECISION)
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

  const argsLine = args ? ` args=${JSON.stringify(args)}` : '';
  const meta = [
    '',
    `<!-- maestro ralph: step [${idx}/${total}] skill=${step.skill}${argsLine} session=${sessionId} -->`,
    '<!-- On finish, run exactly one of:',
    `       maestro ralph complete ${idx} --status DONE [--evidence <path>]`,
    `       maestro ralph complete ${idx} --status DONE_WITH_CONCERNS --concerns "..."`,
    `       maestro ralph retry ${idx}`,
    `       maestro ralph complete ${idx} --status BLOCKED --reason "<external blocker>" -->`,
  ].join('\n');

  const tail = configSection ? '\n\n' + configSection + meta : meta;
  process.stdout.write(body + tail + '\n');
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
