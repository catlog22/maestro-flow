# Workflow: Issue Planning

> **DEPRECATED**: This workflow was used by the deleted `manage-issue-plan` command.
> Use `maestro-plan --gaps` instead, which generates TASK files linked to issues via `task_refs`.

Solution planning for a specific issue with codebase-aware step generation and prompt template construction.

## Input

- `$ARGUMENTS`: `<ISS-ID> [--tool gemini|qwen] [--from-analysis]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Arguments

```
Extract ISS-ID (required, pattern ISS-\d{8}-\d{3}).
Flags: --tool gemini|qwen (default: gemini), --from-analysis (default: auto-detect)
```

---

### Step 2: Load Issue and Validate

```
Load ISS-ID from .workflow/issues/issues.jsonl → fatal if file missing or ID not found.
Status check: open/registered → proceed; other → warn but continue (non-destructive).
If solution already exists → confirm overwrite with user (abort if declined).
```

---

### Step 3: Load Analysis Context

```
If ISSUE.analysis exists → build ANALYSIS_CONTEXT from root_cause, impact,
related_files, confidence, suggested_approach.
If null and --from-analysis explicit → warn (suggest running analyze first).
Otherwise ANALYSIS_CONTEXT = "" (proceed without).
```

---

### Step 4: Generate Solution via CLI

```
Delegate planning prompt with issue details + ANALYSIS_CONTEXT:

  maestro delegate "Generate step-by-step solution for {ISS-ID}: {ISSUE.title}
  ISSUE: title, description, severity, location, fix_direction
  {ANALYSIS_CONTEXT}
  TASK: Break into atomic steps with action types (create|modify|delete|test)
  EXPECTED: JSON { steps: [{ title, description, files[], action }], context, promptTemplate }
  CONSTRAINTS: Concrete, file-specific steps
  " --to {TOOL} --mode analysis

Validate response: steps[] non-empty, each with title/description/files/action.
Parse failure → save raw output to issue feedback for review.
```

---

### Step 5: Build Solution Record

```
Construct IssueSolution:
  { steps, context, promptTemplate, planned_at: NOW_ISO, planned_by: TOOL }
```

---

### Step 6: Update Issue in JSONL

```
Read-modify-write issues.jsonl:
  Set issue.solution = SOLUTION, updated_at = NOW_ISO
  Append issue_history: actor "planning-agent", note "{N} steps generated"
  Status unchanged (planning is metadata enrichment).
Verify: re-read file, confirm solution field present.
```

---

### Step 7: Display Solution Steps Table and Next Steps

```
Display: approach summary, steps table (# | action | title | files), prompt template.

Next steps:
  - manage-issue-execute {ISS-ID} (execute | --dry-run | --executor codex)
  - manage-issue status {ISS-ID}
```

---

## Output

- **Updated**: `.workflow/issues/issues.jsonl` -- issue record enriched with `solution` field
- **Solution fields**: steps[], context, promptTemplate, planned_at, planned_by

## Quality Criteria

- Solution steps are concrete with specific file targets and action types
- Analysis context included when available for better accuracy
- Prompt template is self-contained and executable by an agent
- JSON result validated before writing to JSONL
- Issue status unchanged (planning is non-destructive enrichment)
- Read-modify-write pattern preserves other issues in JSONL
- Next-step routing guides user to execution
