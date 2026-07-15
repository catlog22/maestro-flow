<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Issue Gaps Analysis (Codex — CSV Wave)

## Pipeline

```
Load Issues → Classify & Group → Generate tasks.csv → Wave 1: Explore (parallel per issue) → Wave 2: Synthesize (per group) → Write issue.analysis → Output context.md
```

---

### Step 1: Load Issues

```
If ISS-ID provided:
  Load single issue from .workflow/issues/issues.jsonl
  → fatal if file missing or ID not found (E_ISSUE_NOT_FOUND)
  → skip Step 2 (single issue = single group)

If no ISS-ID:
  Load all issues where status == "open" || status == "registered"
  → fatal if none found (E_NO_ISSUES)
```

---

### Step 2: Classify & Group (batch mode only)

```
Group loaded issues by affected area overlap:

Classification dimensions:
  - location: file path prefix (first 2 segments, e.g. src/auth/)
  - component: affected_components field overlap
  - category: issue.category or severity

Grouping rules:
  1. Same location prefix → same group
  2. Shared affected_components → same group
  3. Remaining ungrouped → individual groups (1 issue each)

Output: GROUPS[] = { group_id, label, issues[], shared_keywords[] }

Display group breakdown (skip if AUTO_YES).
```

---

### Step 3: Generate tasks.csv

Generate CSV with two waves:
- **Wave 1**: One exploration row per issue (parallel within wave)
- **Wave 2**: One synthesis row per group (parallel across groups, depends on its issues in wave 1)

```csv
id,title,description,iss_id,group_id,group_label,deps,context_from,wave,status,findings,analysis_json,error
```

**Wave 1 rows** — one per issue:

```csv
"1","Explore: ISS-xxx {title}","Root cause exploration for ISS-xxx: {description}. Location: {location}. Severity: {severity}. Fix hint: {fix_direction}. Search keywords: {keywords from title+description+components}. TASK: maestro explore keywords (preferred) or grep keywords → read top matches → trace call chain → identify root cause (file:line) → assess impact → list related files → rate confidence → suggest fix. EXPECTED: JSON { root_cause, impact, related_files[], confidence, suggested_approach }. CONSTRAINTS: Evidence-only, use file reads to verify.","ISS-xxx","G1","src/auth","","","1","","","",""
```

**Wave 2 rows** — one per group:

```csv
"N","Synthesize: {group_label}","Compile exploration findings for group [{group_label}]. For each issue: validate root cause evidence, identify cross-issue relationships, build analysis record. Output: JSON array [{ iss_id, root_cause, affected_files, impact_scope, fix_direction, confidence, cross_refs }]. Note shared root causes and dependency chains across issues in this group.","","G1","src/auth","1;2;3","1;2;3","2","","","",""
```

**Column definitions**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier |
| `title` | Input | Short task title |
| `description` | Input | Full exploration/synthesis instructions |
| `iss_id` | Input | Issue ID (wave 1 only, empty for wave 2) |
| `group_id` | Input | Group identifier |
| `group_label` | Input | Group label for display |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Task IDs whose findings this task needs |
| `wave` | Input | 1 = explore, 2 = synthesize |
| `status` | Output | `pending` → `completed` / `failed` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `analysis_json` | Output | Structured analysis JSON (wave 2 only) |
| `error` | Output | Error message if failed |

Write `tasks.csv` to session folder.

---

### Step 4: Wave 1 — Explore (parallel per issue)

Filter `wave == 1 && status == pending`. Write `wave-1.csv`.

```javascript
MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep:
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: `You are analyzing a specific issue for root cause. Read the 'description' column for full instructions. Use file reads and grep to gather evidence. Write findings as a concise summary with file:line references. Write analysis_json as a JSON object: { root_cause, impact, related_files[], confidence, suggested_approach }.`,
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, analysis_json, error }
})
```

Merge results into master `tasks.csv`, delete `wave-1.csv`.

**Per-issue agent responsibilities**:
1. **Keyword Search** — grep issue keywords in source, find top 20 relevant paths
2. **Context Read** — read top 5 matches with 10 lines surrounding context
3. **Call Chain Trace** — trace 2-3 levels from issue location
4. **Root Cause Identification** — pinpoint file:line with evidence
5. **Impact Assessment** — scope of affected functionality

---

### Step 5: Wave 2 — Synthesize (parallel per group)

Filter `wave == 2 && status == pending`. Build `prev_context` from wave 1 findings of issues in same group. Write `wave-2.csv` with `prev_context` column.

```javascript
MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep:
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: `You are synthesizing root cause analysis for a group of related issues. Read prev_context for per-issue exploration findings. Validate evidence, identify cross-issue relationships and shared root causes. Output analysis_json as a JSON array: [{ iss_id, root_cause, affected_files, impact_scope, fix_direction, confidence, cross_refs }].`,
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, analysis_json, error }
})
```

Merge results into master `tasks.csv`, delete `wave-2.csv`.

**Synthesis agent responsibilities**:
1. Parse per-issue findings from prev_context
2. Validate root cause evidence (file:line exists, logic holds)
3. Identify cross-issue relationships within group
4. Build consolidated analysis array with cross_refs
5. Flag shared root causes that affect multiple issues

---

### Step 6: Write Analysis to issues.jsonl

```
Parse analysis_json from wave 2 results.

For each issue in the analysis array:
  Build IssueAnalysis record:
    {
      root_cause,
      affected_files,
      impact_scope,
      fix_direction,
      confidence,
      cross_refs,
      analyzed_at: NOW_ISO,
      tool: "spawn_agents_on_csv",
      depth: DEPTH
    }

  Read-modify-write issues.jsonl (single pass):
    Set issue.analysis = ANALYSIS, updated_at = NOW_ISO
    Append issue.history: { action: "analyzed", at: NOW_ISO, by: "maestro-analyze --gaps" }
    Status unchanged (non-destructive enrichment).

Verify: re-read, confirm analysis field present for all updated issues.
```

---

### Step 7: Output context.md

```
Aggregate results organized by group:

  # Context: Issue Gaps Analysis

  **Date**: {date}
  **Issues analyzed**: {count}
  **Groups**: {group_count}
  **Session**: {sessionFolder}

  ## Group: {group.label}

  ### ISS-{id}: {title}
  - **Root cause**: {root_cause}
  - **Affected files**: {affected_files}
  - **Impact scope**: {impact_scope}
  - **Fix direction**: {fix_direction}
  - **Confidence**: {confidence}
  - **Cross-refs**: {related ISS-IDs}

  (repeat per issue, per group)

  ## Cross-Group Dependencies
  {issues sharing root causes across groups}

  ## Constraints

  ### Locked
  {constraints from root cause evidence}

  ### Free
  {implementation choices left to planner}

Write context.md to session folder + copy to scratchDir.
Register artifact in state.json.
```

---

### Step 8: Display Summary and Next Steps

```
Display: group breakdown, per-issue root cause, confidence, cross-refs.

Next steps:
  - plan --gaps (plan fix tasks linked to analyzed issues)
  - analyze --gaps {ISS-ID} (re-analyze specific issue)
  - $manage issue list (review all issues)
```

---

## Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-analyze-{slug}/
├── tasks.csv            # master state
├── results.csv          # final export
├── wave-1.csv           # temporary (deleted after merge)
├── wave-2.csv           # temporary (deleted after merge)
├── discoveries.ndjson   # shared board (append-only)
├── context.md           # decisions for plan --gaps
```

## Output

- **Updated**: `.workflow/issues/issues.jsonl` — enriched with `analysis` field per issue
- **Created**: `context.md` — grouped root causes for downstream `plan --gaps`
- **Created**: `results.csv` — full task execution results

## Quality Criteria

- Issues classified into groups before CSV generation
- Wave 1 agents run parallel (one per issue, bounded by maxConcurrency)
- Wave 2 agents run parallel (one per group, after wave 1 deps met)
- Cross-issue relationships captured via cross_refs
- Single-pass JSONL update preserves integrity
- context.md organized by group with cross-group section
