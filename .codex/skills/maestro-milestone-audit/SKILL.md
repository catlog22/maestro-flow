---
name: maestro-milestone-audit
description: Audit current milestone for cross-phase integration gaps
argument-hint: "[milestone, e.g., 'M1']"
allowed-tools: spawn_agents_on_csv, Read, Write, Bash, Glob, Grep
---

<purpose>
Sequential audit based on artifact registry in state.json. Checks phase coverage (ANL->PLN->EXC chains), ad-hoc completeness, execution completeness, and cross-artifact integration via `spawn_agents_on_csv`. Produces PASS/FAIL verdict report.

**Core workflow**: Load Artifacts -> Coverage Check -> Completeness Check -> CSV Wave (Integration Check) -> Verdict
</purpose>

<context>

```bash
$maestro-milestone-audit ""
$maestro-milestone-audit "M1"
```

**Output**: `.workflow/milestones/{milestone}/audit-report.md` with artifact chain verification, integration analysis, and PASS/FAIL verdict

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-audit-{milestone}/`
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,scope,check_targets,deps,wave,status,findings,gaps_found,severity,error
"integ-1","Interface & dependency chains","Verify shared interfaces are consistent across phases: re-exports match, dependency chains unbroken, no circular imports between phase outputs","cross-phase imports, shared types, re-exports","grep for shared type names across phase output dirs; verify export/import consistency","","1","","","","",""
"integ-2","Data contracts & API consistency","Verify request/response schemas match across phases: API signatures consistent, error codes aligned, no contract drift","request/response schemas, API signatures, error codes","diff API type definitions across phases; check error code enum consistency","","1","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Worker identifier: `integ-{N}` |
| `title` | Input | Integration dimension name |
| `description` | Input | Detailed check instructions |
| `scope` | Input | What to examine |
| `check_targets` | Input | Specific verification commands/grep patterns |
| `deps` | Input | Dependencies (empty — all wave 1) |
| `wave` | Computed | Wave number (always 1 — single parallel wave) |
| `status` | Output | `pending` -> `pass` / `fail` / `warning` |
| `findings` | Output | Detailed findings per dimension (max 500 chars) |
| `gaps_found` | Output | Semicolon-separated list of integration gaps |
| `severity` | Output | `critical` / `warning` / `info` per gap |
| `error` | Output | Error message if check failed |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-audit-{milestone}/
+-- tasks.csv
+-- wave-1.csv (temporary)
+-- wave-1-results.csv
```
</csv_schema>

<invariants>
1. **Artifact registry is source of truth** — don't scan directories, read state.json
2. **Non-blocking warnings** — missing analyze is warning, missing execute is error
3. **Integration check is required** — always spawn checker via CSV wave
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

### Step 5: Integration Check via CSV Wave

1. Create session folder: `.workflow/.csv-wave/{dateStr}-audit-{milestone}/`
2. Build `tasks.csv` from csv_schema — populate `scope` and `check_targets` columns using phase artifacts discovered in Step 2
3. Write `wave-1.csv` from pending rows, then execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: `You are an integration checker for milestone ${milestone}. For each row, examine the scope and check_targets. Search the codebase for inconsistencies, contract drift, and broken dependencies across phase outputs. Report findings with file:line references. Set status to pass/fail/warning. List specific gaps in gaps_found (semicolon-separated).`,
  max_concurrency: 2, max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { id, status: [pass|fail|warning], findings, gaps_found, severity, error }
})
```

4. Merge results into master `tasks.csv`
5. Parse `gaps_found` from all workers — aggregate into `.workflow/milestones/{milestone}/audit-report.md`
6. Any worker with `status == fail` and `severity == critical` → milestone verdict = FAIL

### Step 6: Verdict

**PASS**: All phases have completed EXC artifacts, no critical integration gaps, all adhoc completed.
**FAIL**: Missing EXC artifacts or critical integration gaps found.

Display structured audit report.

**Next-step routing:**

| Verdict | Next Step |
|---------|-----------|
| PASS | `$maestro-milestone-complete "{milestone}"` |
| FAIL, integration gaps | `$maestro-plan "--gaps"` |
| FAIL, incomplete execution | `$maestro-execute` |

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
- [ ] Integration check performed via spawn_agents_on_csv (2 parallel workers)
- [ ] Audit report written to milestones/ directory
- [ ] Clear PASS/FAIL verdict with specific reasons
</success_criteria>
