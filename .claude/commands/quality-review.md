---
name: quality-review
description: Tiered code review (quick/standard/deep) with parallel agents, severity classification, and auto-issue creation
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
Run multi-dimensional code review on a completed phase's changed files. Answers the question "is this code good?" -- complementing maestro-verify ("is the goal met?") and quality-test ("does it work for users?"). Three review levels (quick/standard/deep) scale with task depth, auto-detected from file count. Level definitions, dimension lists, deep-dive rules, and issue creation thresholds defined in workflow review.md.
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

Extract conclusions from related artifacts that may affect this review. Pass as prior quality context to reviewer agents — avoid redundant work, focus on gaps and regressions.

**Output**: `REVIEW_DIR = .workflow/scratch/{YYYYMMDD}-review-P{N}-{slug}/` (P{N} = phase number, enables directory-level identification as state.json fallback)
</context>

<execution>
Follow '~/.maestro/workflows/review.md' completely.

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

Report format and next-step routing by verdict defined in workflow review.md Report Format and Next Step Routing sections.

**Next-step routing summary:**
- PASS → `/quality-test {phase}`
- WARN → `/quality-test {phase}` (proceed with caveats)
- BLOCK → `/maestro-plan {phase} --gaps` (fix critical findings first)
</execution>

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
