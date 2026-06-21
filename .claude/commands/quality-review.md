---
name: quality-review
description: Use after execution to evaluate code quality across correctness, security, performance, and architecture
argument-hint: "<phase> [--level quick|standard|deep] [--dimensions security,architecture,...] [--skip-specs]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Multi-dimensional code review on a phase's changed files. Three levels (quick/standard/deep), auto-detected from file count. Level and dimension details in workflow review.md.
</purpose>

<required_reading>
@~/.maestro/workflows/review.md
</required_reading>

<deferred_reading>
- [index.json](~/.maestro/templates/index.json) — read when updating phase index after review
</deferred_reading>

<context>
Phase: $ARGUMENTS (required — phase number or slug)

**Flags:**
- `--level quick|standard|deep` — Explicit review level (default: auto-detect from file count)
- `--dimensions <list>` — Comma-separated subset of dimensions to review (overrides level defaults)
- `--skip-specs` — Skip loading project specs as review context

**All context via state.json.artifacts[]:**

```
related = artifacts.filter(a =>
  a.phase === target_phase && a.milestone === current_milestone
).sort_by(completed_at asc)
```

Each artifact's type determines its outputs at `.workflow/{a.path}/`:
- **execute** → .summaries/, .task/, verification.json, plan.json (source of files to review)
- **review** → review.json (prior verdict, findings — for delta comparison)
- **debug** → understanding.md, evidence.ndjson (confirmed root causes)
- **test** → uat.md, .tests/ (user-observable gaps)

### Pre-load (optional, proceed without)
- Codebase docs: `.workflow/codebase/ARCHITECTURE.md` → component boundaries, layer rules
- Wiki constraints: `maestro search "architecture constraint" --json` → documented decisions
- Specs: `maestro spec load --category review` → review standards, checklists, knowhow tools
- Conflict state: `maestro spec conflict list` → 当前已标记冲突的 spec 条目（review 时优先关注）
- Role knowledge: `maestro search --category review` → select relevant → `maestro wiki load`

**Output**: `REVIEW_DIR = .workflow/scratch/{YYYYMMDD}-review-P{N}-{slug}/` (P{N} = phase number, enables directory-level identification as state.json fallback)
</context>

<execution>
Follow '~/.maestro/workflows/review.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Setup → Review**
- REQUIRED: Phase resolved and changed files collected from task summaries. E001/E002 if missing.
- REQUIRED: Review level determined (explicit flag or auto-detected from file count).
- BLOCKED if no changed files: E004.

**GATE 2: Review → Aggregation**
- REQUIRED: All dimension reviews executed (inline for quick, parallel agents for standard/deep).
- REQUIRED: Deep-dive completed if triggered (standard: auto, deep: forced).

**GATE 3: Aggregation → Completion**
- REQUIRED: review.json written with findings, severity distribution, and verdict.
- REQUIRED: Issues auto-created based on level thresholds.
- REQUIRED: index.json updated with review status.
- REQUIRED: Spec conflict check — if any finding directly contradicts a loaded spec entry (code behavior ≠ spec rule), suggest `maestro spec conflict mark` on the spec entry. Code is the single source of truth.

**Output writes to REVIEW_DIR** (not EXEC_DIR):
- `REVIEW_DIR/review.json` — findings, severity distribution, verdict

**Register artifact on completion:**
```
Append to state.json.artifacts[]:
{
  id: nextArtifactId(artifacts, "review"),  // REV-001
  type: "review",
  milestone: current_milestone,
  phase: target_phase,
  scope: "phase",
  path: "scratch/{YYYYMMDD}-review-P{N}-{slug}",    // relative to .workflow/
  status: "completed",
  depends_on: exec_art.id,                 // or prior debug/review if re-review
  harvested: false,
  created_at: start_time,
  completed_at: now()
}
```

Report format defined in workflow review.md Report Format section.
</execution>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY
CONCERNS: {description if applicable}
--- END STATUS ---
```

Status mapping:
- **DONE** — PASS verdict, no critical findings
- **DONE_WITH_CONCERNS** — WARN verdict, issues found but non-blocking
- **NEEDS_RETRY** — BLOCK verdict, critical findings require fix first

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| PASS verdict | `/quality-test {phase}` |
| WARN verdict (non-blocking issues) | `/quality-test {phase}` (proceed with caveats) |
| BLOCK verdict (critical findings) | `/maestro-plan {phase} --gaps` (fix first) |
| Spec contradictions found | `maestro spec conflict list` → `/manage-knowledge-audit --scope spec` |
| Want code cleanup | `/quality-refactor {phase}` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase argument required | Check arguments format, re-run with correct input |
| E002 | error | Phase directory not found | Check arguments format, re-run with correct input |
| E003 | error | No execution results found (no task summaries) | Verify execution completed with task summaries |
| E004 | error | No changed files detected in phase | Verify execution completed with task summaries |
| W001 | warning | Some dimension agents failed, partial results | Retry failed dimensions or accept partial results |
| W002 | warning | Deep-dive iteration limit reached with unresolved criticals | Accept current findings or escalate manually |
</error_codes>

<success_criteria>
- [ ] Phase resolved and changed files collected from task summaries
- [ ] Review level determined (explicit flag or auto-detected)
- [ ] Project specs loaded as review context (unless --skip-specs)
- [ ] Dimension reviews executed (inline for quick, parallel agents for standard/deep)
- [ ] All dimension results aggregated with severity classification
- [ ] Deep-dive completed if triggered (standard: auto, deep: forced)
- [ ] review.json written with complete findings, severity distribution, verdict
- [ ] Issues auto-created based on level thresholds
- [ ] index.json updated with review status
- [ ] Next step routed by verdict (PASS→test, WARN→test with caveats, BLOCK→plan --gaps)
</success_criteria>
