// ---------------------------------------------------------------------------
// Injection Builder — assembles the framed prompt block emitted when a Run is
// dispatched (currently by `maestro ralph next`; `maestro run next` in P1).
//
// The builder separates two families of sections:
//   - core sections   — grounded in SessionState + per-step details only
//                        (Intent / Boundary Contract / Execution Progress /
//                         Accumulated Signals).
//   - extension sections — grounded in engine-specific metadata; for the ralph
//                        engine these are the Scope line, Goals Overview,
//                        Current Goal and Execution Criteria, all derived from
//                        ralph-meta (task_decomposition / execution_criteria /
//                        goal_ref).
//
// Callers own section ordering: `buildEnvelope` receives a pre-ordered list of
// section strings and wraps them, so an engine adapter can interleave its
// extension sections with core sections in whatever order its anchor requires.
// This keeps the ralph anchor byte-for-byte stable while the ralph-specific
// slices live behind their own builders (reused by the P2 adapter layer).
// ---------------------------------------------------------------------------

// ── Truncation helpers (shared by all section builders) ──────────────────────

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

export function capList(items: string[], n = 3): string {
  const shown = items.slice(0, n).map(s => truncate(s, 200));
  const extra = items.length > n ? ` (+${items.length - n} more)` : '';
  return shown.join('; ') + extra;
}

// ── Core section inputs ──────────────────────────────────────────────────────

export interface BoundaryContractInput {
  in_scope: string[];
  out_of_scope: string[];
  constraints: string[];
  definition_of_done: string;
}

export interface ProgressStep {
  step_id: string;
  command: string;
  stage: string | null;
  summary: string | null;
  caveats: string | null;
}

export interface ProgressInput {
  recent: ProgressStep[];
  done_count: number;
  pending_count: number;
}

export interface SignalsInput {
  caveats: string[];
  deferred: string[];
}

// ── Core section builders ────────────────────────────────────────────────────

export function buildIntentSection(intent: string): string | null {
  const trimmed = intent.trim();
  if (!trimmed) return null;
  return `**Intent**: ${truncate(trimmed, 1200)}`;
}

export function buildBoundaryContractSection(bc: BoundaryContractInput): string | null {
  if (!bc.in_scope.length && !bc.out_of_scope.length && !bc.constraints.length && !bc.definition_of_done) {
    return null;
  }
  const lines = ['**Boundary Contract**:'];
  if (bc.in_scope.length) lines.push(`- In scope: ${capList(bc.in_scope, 8)}`);
  if (bc.out_of_scope.length) lines.push(`- Out of scope: ${capList(bc.out_of_scope, 8)}`);
  if (bc.constraints.length) lines.push(`- Constraints: ${capList(bc.constraints, 8)}`);
  if (bc.definition_of_done) lines.push(`- Done when: ${truncate(bc.definition_of_done, 300)}`);
  return lines.join('\n');
}

export function buildProgressSection(progress: ProgressInput): string | null {
  if (progress.recent.length === 0) return null;
  const lines = ['**Execution Progress**:'];
  for (const s of progress.recent) {
    const summary = s.summary ?? '(no summary)';
    lines.push(`- [${s.step_id}] ${s.command} (${s.stage ?? '—'}): ${truncate(summary, 200)}`);
    if (s.caveats) {
      lines.push(`  ⚠️ ${truncate(s.caveats, 150)}`);
    }
  }
  lines.push(`- Progress: ${progress.done_count} done, ${progress.pending_count} pending`);
  return lines.join('\n');
}

export function buildSignalsSection(signals: SignalsInput): string | null {
  if (signals.caveats.length === 0 && signals.deferred.length === 0) return null;
  const lines = ['**⚠️ Accumulated Signals**:'];
  if (signals.caveats.length) lines.push(`- Caveats: ${signals.caveats.slice(-3).join('; ')}`);
  if (signals.deferred.length) lines.push(`- Deferred work: ${signals.deferred.slice(-5).join('; ')}`);
  lines.push('- **Before proceeding, verify these signals do not conflict with your current task.**');
  return lines.join('\n');
}

// ── Envelope assembly ────────────────────────────────────────────────────────

export interface EnvelopeInput {
  sessionId: string;
  /** Pre-ordered section strings; null/empty entries are dropped. */
  sections: Array<string | null>;
  /** Completion verb wired into the read-only guardrail comment. */
  completionVerb: (n: string) => string;
}

/**
 * Wraps ordered section strings in the `<session_anchor>` frame plus the
 * read-only guardrail comment. Returns null when no section survives (matching
 * the legacy behaviour where an empty intent suppresses the whole anchor — the
 * caller drops the intent section, leaving nothing to wrap).
 */
export function buildEnvelope(input: EnvelopeInput): string | null {
  const parts = input.sections.filter((s): s is string => Boolean(s && s.length));
  if (parts.length === 0) return null;

  return [
    '<session_anchor>',
    `## Session Anchor — ${input.sessionId}`,
    '',
    parts.join('\n\n'),
    '',
    '<!-- session_anchor: read-only grounding. Honor Intent + Boundary Contract before acting.',
    '     If your work would fall outside in_scope (or hit out_of_scope), stop and report via',
    `     \`${input.completionVerb('<N>')} --status BLOCKED --reason "out_of_scope: ..."\` instead of proceeding.`,
    '     If Accumulated Signals suggest prior work conflicts with your task, report via',
    `     \`${input.completionVerb('<N>')} --status BLOCKED --reason "drift_conflict: ..."\` instead of proceeding. -->`,
    '</session_anchor>',
  ].join('\n');
}
