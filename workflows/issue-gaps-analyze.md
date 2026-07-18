<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Issue Gaps Analysis

> **CLI variants**: see `issue-gaps-analyze.codex.md` for codex-specific notes (CSV-wave variant using `spawn_agents_on_csv`).

Root cause analysis for issues using CLI exploration and codebase context gathering.
Supports single issue (ISS-ID) or batch (all open/registered) with classification and parallel analysis.
Produces analysis records in issues.jsonl and context.md for downstream `plan --gaps`.

**Invoked by**: `analyze --gaps [ISS-ID]`

## Input

- `ISS-ID` (optional): Specific issue to analyze. If omitted, analyze all open/registered issues.
- `TOOL`: CLI tool for exploration (default: gemini)
- `DEPTH`: `standard` or `deep` (default: standard)

## Pipeline

```
Load Issues → Classify & Group → Parallel Analysis (per group) → Write issue.analysis → Output context.md
```

---

### Step 1: Load Issues

```
If ISS-ID provided:
  Load single issue from .workflow/issues/issues.jsonl
  → fatal if file missing or ID not found (E_ISSUE_NOT_FOUND)
  → skip Step 2 (classification), go directly to Step 3

If no ISS-ID:
  Load all issues where status == "open" || status == "registered"
  → fatal if none found (E_NO_ISSUES)

Validate: at least 1 issue loaded.
```

---

### Step 2: Classify & Group (batch mode only)

```
Group loaded issues by overlap in affected area:

Classification dimensions:
  - location: file path prefix (e.g. src/auth/, src/api/)
  - component: affected_components field overlap
  - category: issue.category or severity level

Grouping rules:
  1. Same location prefix (first 2 path segments) → same group
  2. Shared affected_components → same group
  3. Remaining ungrouped → individual groups (1 issue each)

Output: GROUPS[] where each group = { group_id, label, issues[], shared_context_keywords[] }

Display group breakdown to user (skip if AUTO_YES).
```

---

### Step 3: Gather Codebase Context (per group)

```
For each group:
  Merge keywords from all issues in group: title, description, location, affected_components.
  Deduplicate keywords.

  Standard depth: maestro explore per group (keywords as prompt), fallback grep; flag analysis as [LOW CONFIDENCE] (grep fallback, semantic depth lost).
  Deep depth: maestro explore multi-prompt + semantic Agent search (error handling,
    data flow, deps), merge results.

  Build GROUP_CONTEXT: related files, key snippets (max 50 lines), dependency chain.
  Shared context benefits co-located issues — avoids redundant exploration.
```

---

### Step 4: Run Analysis (per group, parallel across groups)

```
MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Launch analysis for each group in parallel using Agent tool:

  Agent({
    subagent_type: "general-purpose",
    prompt: "Root cause analysis for issues in group [{group.label}]:
      {for each issue in group}
        ISS-{id}: {title} — {description}, severity: {severity}, location: {location}
      {end}
      CODEBASE CONTEXT: {GROUP_CONTEXT}
      TASK: For EACH issue — identify root cause (file:line) → assess impact → list related files → rate confidence → suggest fix direction. Note cross-issue relationships within this group.
      EXPECTED: JSON array [{ iss_id, root_cause, impact, related_files[], confidence, suggested_approach, cross_refs[] }]
      CONSTRAINTS: Evidence-only, no speculation. Use Read/Grep to verify before concluding."
  })

Alternatively, attempt CLI delegate first per group:

  MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: maestro delegate "<same prompt>" --role analyze --mode analysis

  If delegate fails (timeout, unavailable, parse error):
    Fall back to Agent tool with same prompt; set analysis confidence=low and flag as [LOW CONFIDENCE] (delegate failed).
    Record fallback in analysis metadata: { tool: "agent-fallback", reason: "<error>" }

Validate response per issue: all required fields present.
Parse failure → save raw output to issue feedback for review.
```

---

### Step 5: Build Analysis Record (per issue)

```
For each issue from Step 4 results:

Construct IssueAnalysis:
  {
    root_cause,
    affected_files: related_files,
    impact_scope: impact,
    fix_direction: suggested_approach,
    confidence,
    cross_refs: [ISS-IDs of related issues in same group],
    analyzed_at: NOW_ISO,
    tool: TOOL or "agent-fallback",
    depth: DEPTH
  }
```

---

### Step 6: Update Issues in JSONL

```
Read-modify-write issues.jsonl (single pass for all analyzed issues):
  For each issue:
    Set issue.analysis = ANALYSIS, updated_at = NOW_ISO
    Append issue.history: { action: "analyzed", at: NOW_ISO, by: "analyze --gaps" }
    Status unchanged (analysis is metadata enrichment).
Verify: re-read file, confirm analysis field present for all updated issues.
```

---

### Step 7: Output context.md

```
Aggregate all analyzed issues into context.md, organized by group:

  # Context: Issue Gaps Analysis

  **Date**: {date}
  **Issues analyzed**: {count}
  **Groups**: {group_count}

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
  {issues that span multiple groups or share root causes}

  ## Constraints

  ### Locked
  {constraints derived from root cause evidence}

  ### Free
  {implementation choices left to planner}

Write context.md to session output directory.
```

---

### Step 8: Display Summary and Next Steps

```
Display: group breakdown, per-issue root cause, confidence, cross-refs.

Next steps:
  - plan --gaps (plan fix tasks linked to analyzed issues)
  - analyze --gaps {ISS-ID} (re-analyze specific issue with deeper context)
  - /maestro-manage issue list (review all issues)
```

---

## Output

- **Updated**: `.workflow/issues/issues.jsonl` -- issue records enriched with `analysis` field
- **Created**: `context.md` -- aggregated root causes grouped for downstream `plan --gaps`
- **Analysis fields**: root_cause, affected_files, impact_scope, fix_direction, confidence, cross_refs, analyzed_at, tool, depth

## Quality Criteria

- Issues classified by location/component overlap before analysis
- Groups analyzed in parallel (Agent or delegate per group)
- CLI delegate attempted first; Agent fallback on failure
- Analysis grounded in actual codebase evidence (file:line references)
- Cross-issue relationships captured within groups (cross_refs)
- JSON result validated before writing to JSONL
- Issue status unchanged (analysis is non-destructive enrichment)
- Single-pass read-modify-write preserves JSONL integrity
- context.md organized by group with cross-group dependencies
- Next-step routing guides to plan --gaps
