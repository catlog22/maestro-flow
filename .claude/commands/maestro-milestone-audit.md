---
name: maestro-milestone-audit
description: Audit current milestone for cross-phase integration gaps
argument-hint: "[<milestone>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<purpose>
Audit milestone completion using the artifact registry. Checks:
1. Phase coverage — every phase in roadmap has plan + execute artifacts (completed)
2. Ad-hoc completeness — all adhoc artifacts are completed (or explicitly skipped)
3. Execution completeness — all tasks in executed plans are completed
4. Cross-artifact integration — interfaces, data contracts, configuration consistency

Data source: `state.json.artifacts[]` filtered by current milestone.
Produces audit report at `.workflow/milestones/{milestone}/audit-report.md`.

Pipeline position: downstream of maestro-execute (which includes verification), upstream of maestro-milestone-complete.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-audit.md
</required_reading>

<context>
Milestone: $ARGUMENTS (optional -- defaults to current_milestone from state.json).

**Requires:** All phases in the milestone should have completed execute artifacts.

**Data source:**
- `.workflow/state.json` — artifacts[], current_milestone, milestones[]
- `.workflow/roadmap.md` — milestone-to-phase mapping (standard milestones only)
- Plan scratch dirs — for task status verification

**Adhoc milestone support (D-008):** When the target milestone has `type == "adhoc"` (or `type` field is missing, defaulting to `"standard"`), the audit skips roadmap.md parsing and phase coverage checks. It only validates artifact chain completeness (PLN→EXC exists) and runs integration checks.

### Pre-load

1. **Codebase docs**: IF `.workflow/codebase/doc-index.json` exists → Read ARCHITECTURE.md for integration checks
2. **Specs**: `maestro spec load --category review` — load review standards for audit
3. All optional — proceed without if unavailable

### Role Knowledge

1. Browse: `maestro search --category review`
2. Select entries relevant to milestone integration audit
3. Load: `maestro wiki load <id1> [id2...]`
</context>

<execution>
Follow '~/.maestro/workflows/milestone-audit.md' completely.

Audit checklist steps (phase coverage, ad-hoc completeness, execution completeness, cross-artifact integration) are defined in workflow `milestone-audit.md`.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Load → Phase Coverage Check**
- REQUIRED: state.json loaded with artifacts[] filtered by target milestone.
- REQUIRED: Milestone phases identified from roadmap (standard) or milestone_obj.phases (adhoc).
- BLOCKED if no execute artifacts found: error E003.

**GATE 2: Phase Coverage → Integration Check**
- REQUIRED: Every phase checked for artifact chain completeness (ANL→PLN→EXC for standard, PLN→EXC for adhoc).
- REQUIRED: Execution completeness verified — all tasks in executed plans checked for status.
- Do NOT skip incomplete chains — each gap MUST be logged in audit report.

**GATE 3: Integration Check → Report**
- REQUIRED: Cross-artifact integration check completed (shared interfaces, data contracts, configuration consistency).
- REQUIRED: Clear PASS/FAIL verdict determined with evidence for each check.

### Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  ".workflow/milestones/{milestone}/audit-report.md"  // Clear PASS/FAIL verdict
]
```
If missing: DO NOT report completion. Write the audit report first.

### Evidence Requirement

Every audit check result MUST cite what was examined and what was found:
- PASS: "Phase 1 chain complete: ANL-001 → PLN-001 → EXC-001, all tasks completed"
- FAIL: "Phase 2 missing EXC artifact — PLN-002 exists but no execution found"
- Do NOT mark checks as PASS without verifying the actual artifact exists and contains expected content.
</execution>

<completion>
### Standalone report

```
=== MILESTONE AUDIT READY ===
Milestone: {milestone}
Verdict: {PASS|FAIL}
Phases audited: {N}
Integration gaps: {N}
Report: .workflow/milestones/{milestone}/audit-report.md
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence .workflow/milestones/{milestone}/audit-report.md]
```

Status verdicts:
- **DONE** — Audit passed, no gaps found
- **DONE_WITH_CONCERNS** — Audit passed with minor caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Verdict PASS | `/maestro-milestone-complete {milestone}` |
| Verdict FAIL, integration gaps | `/maestro-plan --gaps` |
| Verdict FAIL, incomplete execution | `/maestro-execute` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone identifier required | Check arguments format |
| E002 | error | Milestone not found in state.json | Check milestone ID |
| E003 | error | No execute artifacts found for milestone | Run maestro-execute first |
| W001 | warning | Some phases lack complete artifact chains | Review incomplete phases |
</error_codes>

<success_criteria>
- [ ] All phases in milestone identified from roadmap (standard) or milestone_obj.phases (adhoc)
- [ ] Artifact chains verified: ANL→PLN→EXC per phase (standard) or PLN→EXC exists (adhoc)
- [ ] Ad-hoc artifacts checked for completion
- [ ] Integration check completed (shared interfaces, data contracts)
- [ ] Audit report written with clear PASS/FAIL verdict
- [ ] Next-step routing provided
</success_criteria>
