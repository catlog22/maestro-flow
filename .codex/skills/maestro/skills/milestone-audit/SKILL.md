---
name: maestro-milestone-audit
description: Audit current milestone for cross-phase integration gaps and produce verdict report
argument-hint: "[milestone, e.g., 'v1.0']"
allowed-tools: Read, Write, Bash, Glob, Grep, Agent
---

# Maestro Milestone Audit (Single Agent)

## Usage

```bash
$maestro-milestone-audit ""
$maestro-milestone-audit "v1.0"
$maestro-milestone-audit "MVP"
```

**Flags**:
- `[milestone]`: Milestone identifier (defaults to current_milestone from state.json)

**Output**: Audit report with cross-phase integration analysis, gap list, and PASS/FAIL verdict

---

## Overview

Sequential audit of a milestone's cross-phase integration health. Identifies all phases belonging to the milestone, reads their index.json and verification results, checks for integration gaps across phase boundaries, and produces a structured audit report with a clear verdict.

---

## Implementation

### Step 1: Parse Arguments

Extract milestone identifier from arguments.
If empty: read `current_milestone` from `.workflow/state.json`.
If still empty: error E001.

### Step 2: Load Milestone Context

```bash
cat .workflow/state.json
cat .workflow/roadmap.md
```

Parse roadmap.md to find all phases belonging to this milestone.
If milestone not found in roadmap: error E002.

### Step 3: Collect Phase Data

For each phase in the milestone:

```bash
cat .workflow/phases/{NN}-{slug}/index.json
cat .workflow/phases/{NN}-{slug}/verification.json 2>/dev/null
cat .workflow/phases/{NN}-{slug}/review.json 2>/dev/null
```

Collect:
- Phase status (complete/active/pending)
- Task completion counts
- Verification verdicts
- Review verdicts
- Unresolved gaps

Flag phases without `completed_at` as W001.
If any phase is not complete/verifying: warning E003.

### Step 4: Cross-Phase Integration Analysis

Analyze integration points across phase boundaries:

1. **Shared interfaces**: Grep for types/interfaces defined in one phase and used in another
   ```bash
   grep -r "export.*interface\|export.*type" .workflow/phases/*/
   ```

2. **Data contracts**: Check that data schemas are consistent across phases
   ```bash
   grep -r "schema\|contract\|interface" .workflow/phases/*/
   ```

3. **Dependency chains**: Verify that phase N's outputs satisfy phase N+1's inputs
   - Read each phase's index.json for declared dependencies
   - Check convergence criteria cross-references

4. **API surface consistency**: Look for breaking changes between phases
   ```bash
   grep -r "breaking\|deprecated\|removed" .workflow/phases/*/verification.json
   ```

5. **Test coverage gaps**: Identify integration test blind spots
   - Check if cross-phase interactions have test coverage
   - Flag untested boundaries

### Step 5: Spawn Integration Checker (if complex)

For milestones with 3+ phases, spawn a workflow-integration-checker agent:

```
Agent({
  subagent_type: "workflow-integration-checker",
  prompt: "Check cross-phase integration for milestone {milestone}. Phases: {phase_list}. Focus on: shared interfaces, data contracts, dependency chains.",
  run_in_background: false
})
```

Merge agent findings with Step 4 analysis.

### Step 6: Categorize Findings

Classify each finding:
- **Critical**: Breaking integration gap (blocks milestone completion)
- **High**: Missing integration test coverage
- **Medium**: Inconsistent naming/conventions across phases
- **Low**: Documentation gaps, minor style inconsistencies

### Step 7: Determine Verdict

- **PASS**: No critical or high findings
- **CONDITIONAL**: High findings exist but have clear fix paths
- **FAIL**: Critical findings that block milestone completion

### Step 8: Write Audit Report

Write to `.workflow/milestone-audit-{milestone}.md`:

```markdown
# Milestone Audit: {milestone}
**Date**: {ISO date}
**Verdict**: {PASS|CONDITIONAL|FAIL}

## Phases Audited

| Phase | Status | Verification | Review | Tasks |
|-------|--------|-------------|--------|-------|
| {NN}-{slug} | {status} | {verdict} | {verdict} | {done}/{total} |

## Integration Analysis

### Critical Issues
{list or "None"}

### High Issues
{list or "None"}

### Medium Issues
{list or "None"}

### Low Issues
{list or "None"}

## Cross-Phase Dependencies

{dependency matrix or diagram}

## Recommendations

{prioritized fix suggestions}

## Next Steps

{if PASS}
  Ready for: $maestro-milestone-complete "{milestone}"
{elif CONDITIONAL}
  Fix high issues, then re-audit: $maestro-milestone-audit "{milestone}"
{else}
  Fix critical issues first. See recommendations above.
{endif}
```

### Step 9: Completion Report

```
=== MILESTONE AUDIT: {milestone} ===
Verdict: {PASS|CONDITIONAL|FAIL}

Phases: {count} audited
Findings: {critical} critical, {high} high, {medium} medium, {low} low

Report: .workflow/milestone-audit-{milestone}.md

{if PASS}
Ready for milestone completion: $maestro-milestone-complete "{milestone}"
{else}
Fix {critical+high} blocking issues before completing milestone.
{endif}
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Milestone identifier required | Specify milestone or set current_milestone in state.json |
| E002 | error | Milestone not found in roadmap | Check roadmap.md for valid milestones |
| E003 | error | Phases incomplete for this milestone | Complete phases first, or audit partial |
| W001 | warning | Phase lacks completed_at | May not have been formally transitioned |

---

## Core Rules

1. **Read everything before judging** — collect all phase data before analyzing gaps
2. **Cross-phase focus** — single-phase issues are not this skill's concern; focus on boundaries
3. **Actionable findings** — every finding must include a specific fix suggestion
4. **Clear verdict** — PASS/CONDITIONAL/FAIL with unambiguous criteria
5. **Agent only when needed** — spawn integration-checker only for 3+ phase milestones
