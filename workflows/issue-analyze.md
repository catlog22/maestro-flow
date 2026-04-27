# Workflow: Issue Analysis

> **DEPRECATED**: This workflow was used by the deleted `manage-issue-analyze` command.
> Use `maestro-analyze --gaps [ISS-ID]` instead, which integrates issue root cause analysis
> into the unified analyze pipeline. See `~/.maestro/workflows/issue-gaps-analyze.md`.

Root cause analysis for a specific issue using CLI exploration and codebase context gathering.

## Input

- `$ARGUMENTS`: `<ISS-ID> [--tool gemini|qwen] [--depth standard|deep]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Arguments

```
Extract ISS-ID (required, pattern ISS-\d{8}-\d{3}).
Flags: --tool gemini|qwen (default: gemini), --depth standard|deep (default: standard)
```

---

### Step 2: Load Issue and Validate

```
Load ISS-ID from .workflow/issues/issues.jsonl → fatal if file missing or ID not found.
Status check: open/registered → proceed; other → warn but continue (non-destructive).
```

---

### Step 3: Gather Codebase Context

```
Extract keywords from issue title, description, location, affected_components.

Standard depth: grep keywords in source files → top 20 paths, read 10 lines around
  top 5 matches.
Deep depth: standard grep + semantic Agent search (error handling, data flow, deps),
  merge results.

Build CODEBASE_CONTEXT: related files, key snippets (max 50 lines), dependency chain.
```

---

### Step 4: Run CLI Analysis

```
Delegate root cause analysis with issue details + CODEBASE_CONTEXT:

  maestro delegate "Root cause analysis for {ISS-ID}: {ISSUE.title}
  ISSUE: title, description, severity, location, fix_direction
  CODEBASE CONTEXT: {CODEBASE_CONTEXT}
  TASK: Identify root cause (file:line) → assess impact → list related files → rate confidence → suggest fix
  EXPECTED: JSON { root_cause, impact, related_files[], confidence, suggested_approach }
  CONSTRAINTS: Evidence-only, no speculation
  " --to {TOOL} --mode analysis

Validate response: all required fields present.
Parse failure → save raw output to issue feedback for review.
```

---

### Step 5: Build Analysis Record

```
Construct IssueAnalysis:
  { root_cause, impact, related_files, confidence, suggested_approach, analyzed_at: NOW_ISO, analyzed_by: TOOL }
```

---

### Step 6: Update Issue in JSONL

```
Read-modify-write issues.jsonl:
  Set issue.analysis = ANALYSIS, updated_at = NOW_ISO
  Append issue_history: actor "analysis-agent", note "confidence: {confidence}"
  Status unchanged (analysis is metadata enrichment).
Verify: re-read file, confirm analysis field present.
```

---

### Step 7: Display Summary and Next Steps

```
Display: root cause, impact, confidence, related files, suggested approach.

Next steps:
  - manage-issue-plan {ISS-ID} (generate solution | --tool {TOOL})
  - manage-issue status {ISS-ID}
```

---

## Output

- **Updated**: `.workflow/issues/issues.jsonl` -- issue record enriched with `analysis` field
- **Analysis fields**: root_cause, impact, related_files, confidence, suggested_approach, analyzed_at, analyzed_by

## Quality Criteria

- Analysis grounded in actual codebase evidence (file:line references)
- JSON result validated before writing to JSONL
- Issue status unchanged (analysis is non-destructive enrichment)
- Read-modify-write pattern preserves other issues in JSONL
- Next-step routing guides user to solution planning
