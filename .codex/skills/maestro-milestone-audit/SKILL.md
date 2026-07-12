---
name: maestro-milestone-audit
description: Audit current milestone for cross-phase integration gaps
argument-hint: "[milestone, e.g., 'M1'] [-y]"
allowed-tools: spawn_agents_on_csv, Read, Write, Bash, Glob, Grep, request_user_input
session-mode: deprecated
---

<deprecated_command>
This Codex skill is retained for compatibility only. Route to the Session/Run replacement named by the canonical Claude command and stop; do not execute legacy milestone/session writes below.
</deprecated_command>

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
id,title,description,scope,check_targets,deps,wave,status,audit_verdict,findings,gaps_found,severity,error
"integ-1","Interface & dependency chains","Verify shared interfaces are consistent across phases: re-exports match, dependency chains unbroken, no circular imports between phase outputs","cross-phase imports, shared types, re-exports","grep for shared type names across phase output dirs; verify export/import consistency","","1","pending","","","","",""
"integ-2","Data contracts & API consistency","Verify request/response schemas match across phases: API signatures consistent, error codes aligned, no contract drift","request/response schemas, API signatures, error codes","diff API type definitions across phases; check error code enum consistency","","1","pending","","","","",""
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
| `status` | Lifecycle | `pending` (initial) → `completed`/`failed` (set by merge step from worker's `result_status`) |
| `audit_verdict` | Lifecycle | `pass` / `warning` / `fail` — audit check outcome per dimension (merged from worker output) |
| `findings` | Lifecycle | Detailed findings per dimension (max 500 chars; merged) |
| `gaps_found` | Lifecycle | Semicolon-separated list of integration gaps (merged) |
| `severity` | Lifecycle | `critical` / `warning` / `info` per gap (merged) |
| `error` | Lifecycle | Error message if check failed (merged) |

**Column separation rule**: Wave CSV (input to `spawn_agents_on_csv`) contains Input columns only. Workers return Output columns exclusively via `output_schema` using `result_status` (NOT `status`). Merge maps `result_status` → master `status`.

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-audit-{milestone}/
+-- tasks.csv
+-- wave-1.csv (temporary, deleted after merge)
+-- wave-1-results.csv (temporary, deleted after merge)
```
</csv_schema>

<invariants>
1. **Artifact registry is source of truth** — don't scan directories, read state.json
2. **Non-blocking warnings** — missing analyze is warning, missing execute is error
3. **Integration check is required** — always spawn checker via CSV wave
4. **Clear verdict** — PASS or FAIL with specific reasons
5. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation.
6. **Evidence required on audit checks** — every audit check result MUST cite what was examined and what was found. PASS: "Phase 1 chain complete: ANL-001 → PLN-001 → EXC-001". FAIL: "Phase 2 missing EXC artifact". Do NOT mark checks as PASS without verifying the artifact exists and contains expected content.
7. **Artifact verification before completion** — audit-report.md with clear PASS/FAIL verdict MUST exist before reporting completion. If missing: DO NOT report completion.
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

### Step 5: Confirmation Gate

Unless `-y` flag is set, display audit scope summary and ask user via `request_user_input`:
- Show: milestone name, phase count, artifact count, integration dimensions to check
- Options: "Proceed with audit" / "Cancel"
- If cancelled → END

### Step 6: Integration Check via CSV Wave

1. Create session folder: `.workflow/.csv-wave/{dateStr}-audit-{milestone}/`
2. Build `tasks.csv` from csv_schema — populate `scope` and `check_targets` columns using phase artifacts discovered in Step 2
3. Write `wave-1.csv` from pending rows, then execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,     // rows where wave==1 AND status=="pending"
  id_column: "id",
  instruction: AUDIT_INTEGRATION_INSTRUCTION,   // see "Integration Checker Worker Contract" below
  max_concurrency: 2,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:            { type: "string" },
      result_status: { type: "string", enum: ["completed", "failed"] },
      audit_verdict: { type: "string", enum: ["pass", "fail", "warning"], description: "Audit check outcome" },
      findings:      { type: "string", maxLength: 500 },
      gaps_found:    { type: "string", description: "Semicolon-separated list of gaps" },
      severity:      { type: "string", enum: ["critical", "warning", "info", ""] },
      error:         { type: "string" }
    },
    required: ["id", "result_status", "audit_verdict", "findings", "severity"]
  }
})
```

4. Merge results into master `tasks.csv`: map `result_status` → master `status` column, copy `audit_verdict`, `findings`, `gaps_found`, `severity`, `error`. Delete temporary files (`wave-1.csv`, `wave-1-results.csv`) after merge.

#### Integration Checker Worker Contract (AUDIT_INTEGRATION_INSTRUCTION)

```
You are an integration checker for milestone {milestone}. ONE integration dimension row is assigned to you.

INPUT (from your CSV row):
  - id (integ-N), title, description, scope, check_targets

REQUIRED STEPS:
  1. Examine scope and check_targets fields
  2. Run check_targets — grep / read phase output dirs / diff API definitions
  3. Identify inconsistencies, contract drift, broken dependencies across phase outputs
  4. Record findings with file:line references for every gap
  5. Call report_agent_job_result EXACTLY ONCE

TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Pass path  → no gaps found → result_status=completed, audit_verdict=pass, severity="info"
  - Warning path → minor gaps → result_status=completed, audit_verdict=warning, severity="warning"
  - Fail path → critical contract drift or broken dependencies → result_status=completed, audit_verdict=fail, severity="critical"
  - Failure path → cannot read scope, tool error → result_status=failed with error message
  - Timeout path → near 600s, finalize current findings → report with what was collected
  - NEVER skip report_agent_job_result.

OUTPUT (must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "audit_verdict": "pass" | "warning" | "fail",
    "findings": "<one-sentence summary, max 500 chars>",
    "gaps_found": "<semicolon-separated list of gaps, each with file:line; empty if pass>",
    "severity": "critical" | "warning" | "info" | "",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Read-only inspection. Do NOT modify phase outputs.
  - Do NOT write to tasks.csv, wave-*.csv, audit-report.md (orchestrator owns those).
  - Do NOT call spawn_agents_on_csv (no recursion).
```
5. Parse `gaps_found` from all workers — aggregate into `.workflow/milestones/{milestone}/audit-report.md`
6. Verdict determination:
   - Any worker with `result_status == "failed"` (worker error, no verdict produced) → milestone verdict = **INCOMPLETE** (audit cannot pass with missing dimensions; re-run required)
   - Any worker with `audit_verdict == "fail"` and `severity == "critical"` → milestone verdict = **FAIL**
   - All workers completed with `audit_verdict` in `["pass", "warning"]` → milestone verdict = **PASS**

### Step 7: Verdict

**PASS**: All phases have completed EXC artifacts, no critical integration gaps, all adhoc completed, all integration workers completed successfully.
**FAIL**: Missing EXC artifacts or critical integration gaps found.
**INCOMPLETE**: One or more integration check workers failed (result_status="failed") — audit cannot produce a reliable verdict. Fix worker errors and re-run.

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
