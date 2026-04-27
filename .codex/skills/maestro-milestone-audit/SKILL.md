---
name: maestro-milestone-audit
description: Audit current milestone using artifact registry for cross-phase integration gaps and produce verdict report
argument-hint: "[milestone, e.g., 'M1']"
allowed-tools: Read, Write, Bash, Glob, Grep, Agent
---

<purpose>
Sequential audit based on artifact registry in state.json. Checks phase coverage (ANL->PLN->EXC chains), ad-hoc completeness, execution completeness, and cross-artifact integration. Produces PASS/FAIL verdict report.
</purpose>

<context>

```bash
$maestro-milestone-audit ""
$maestro-milestone-audit "M1"
```

**Output**: Audit report with artifact chain verification, integration analysis, and PASS/FAIL verdict

</context>

<invariants>
1. **Artifact registry is source of truth** — don't scan directories, read state.json
2. **Non-blocking warnings** — missing analyze is warning, missing execute is error
3. **Integration check is required** — always spawn checker agent
4. **Clear verdict** — PASS or FAIL with specific reasons
</invariants>

<execution>

### Step 1: Parse Arguments

Extract milestone identifier from arguments. Fallback: read `current_milestone` from `.workflow/state.json`. If still empty: E001.

### Step 2: Load Artifact Registry

Read `.workflow/state.json` and `.workflow/roadmap.md`. Filter `artifacts[]` by milestone, parse phase list, group by type and phase.

### Step 3: Phase Coverage Check

For each phase: check for completed analyze (optional), plan (required), execute (required) artifacts. Report coverage matrix.

### Step 4: Ad-hoc & Execution Completeness

Verify all adhoc-scoped artifacts completed. For each execute artifact, verify all tasks in plan dir completed.

### Step 5: Integration Check

Spawn Agent for cross-phase validation: shared interfaces, dependency chains, data contracts, API consistency. Write report to `.workflow/milestones/{milestone}/audit-report.md`.

### Step 6: Verdict

**PASS**: All phases have completed EXC artifacts, no critical integration gaps, all adhoc completed.
**FAIL**: Missing EXC artifacts or critical integration gaps found.

Display structured audit report with next-step routing.

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Milestone identifier required | Specify milestone or ensure current_milestone is set |
| E002 | error | Milestone not found in state.json | Check milestone ID |
| E003 | error | No execute artifacts found | Run maestro-execute first |
| W001 | warning | Some phases lack analyze artifacts | Note: analysis optional but recommended |

</error_codes>

<success_criteria>
- [ ] Artifact registry loaded and filtered by milestone
- [ ] Phase coverage matrix generated
- [ ] Ad-hoc and execution completeness verified
- [ ] Integration check performed via agent
- [ ] Audit report written to milestones/ directory
- [ ] Clear PASS/FAIL verdict with specific reasons
</success_criteria>
