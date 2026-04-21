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

Extract milestone identifier from arguments.
If empty: read `current_milestone` from `.workflow/state.json`.
If still empty: error E001.

### Step 2: Load Artifact Registry

```bash
cat .workflow/state.json
cat .workflow/roadmap.md
```

- Parse `state.json.artifacts[]` filtered by milestone
- Parse `roadmap.md` for phase list in this milestone
- Group artifacts by type and phase

### Step 3: Phase Coverage Check

For each phase in roadmap:
- Check for completed analyze artifact (optional but noted)
- Check for completed plan artifact (required)
- Check for completed execute artifact (required)

Report coverage matrix.

### Step 4: Ad-hoc & Execution Completeness

- Check all adhoc-scoped artifacts are completed
- For each execute artifact, verify tasks in plan dir are all completed

### Step 5: Integration Check

Spawn Agent for cross-phase integration validation:
- Shared interfaces compatibility
- Dependency chain satisfaction
- Data contract consistency
- API endpoint consistency

Write report to `.workflow/milestones/{milestone}/audit-report.md`

### Step 6: Verdict

```
PASS if:
  - All phases have EXC artifacts (completed)
  - No critical integration gaps
  - All adhoc artifacts completed

FAIL if:
  - Missing EXC artifacts for any phase
  - Critical integration gaps found
```

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
