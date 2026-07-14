# Issue Gaps Analysis — Root-Cause Protocol

Root-cause analysis for registered issues, triggered by `analyze --gaps [ISS-ID]`. Supports single issue (`ISS-ID`) or batch (all open/registered) with classification and parallel analysis. Produces `analysis` enrichment on each issue record plus a `context.md` for downstream `plan --gaps`.

## Input

- `ISS-ID` (optional): specific issue to analyze. If omitted, analyze all `open` / `registered` issues.
- `DEPTH`: `standard` or `deep` (default `standard`).

## Pipeline

```
Load Issues → Classify & Group → Gather Context (per group) → Parallel Analysis → Write issue.analysis → Output context.md
```

### 1. Load issues

- `ISS-ID` given: load that single issue from the issue registry; fatal if missing (`E_ISSUE_NOT_FOUND`). Skip classification, go straight to context gathering.
- No `ISS-ID`: load all issues where `status ∈ {open, registered}`; fatal if none (`E_NO_ISSUES`).

### 2. Classify & group (batch mode only)

Group issues by affected area so co-located issues share one exploration pass:

- Same location prefix (first 2 path segments) → same group.
- Shared `affected_components` → same group.
- Remaining ungrouped → individual groups (1 issue each).

Each group: `{ group_id, label, issues[], shared_context_keywords[] }`. Display the breakdown (skip on `-y`).

### 3. Gather codebase context (per group)

Merge and deduplicate keywords from every issue in the group (title, description, location, affected_components).

- **standard**: `maestro explore` per group; grep fallback flags the analysis `[LOW CONFIDENCE]` (semantic depth lost).
- **deep**: `maestro explore` multi-prompt + semantic Agent search (error handling, data flow, deps), merged.

Build `GROUP_CONTEXT`: related files, key snippets (≤50 lines), dependency chain.

### 4. Run analysis (per group, parallel across groups) — mandatory, not substitutable by manual Read/Grep

Dispatch analysis per group via Agent (or `maestro delegate --role analyze --mode analysis`). For each issue: identify root cause (`file:line`) → assess impact → list related files → rate confidence → suggest fix direction, noting cross-issue relationships within the group.

Expected per issue: `{ iss_id, root_cause, impact, related_files[], confidence, suggested_approach, cross_refs[] }`. Evidence-only, no speculation.

If delegate fails (timeout / unavailable / parse error), fall back to Agent with the same prompt, set `confidence=low`, flag `[LOW CONFIDENCE]`, and record `{ tool: "agent-fallback", reason }`.

### 5. Write issue analysis

For each analyzed issue, set `issue.analysis = { root_cause, affected_files, impact_scope, fix_direction, confidence, cross_refs, analyzed_at, tool, depth }`, update `updated_at`, and append a `{ action: "analyzed" }` history entry. Status is unchanged — analysis is metadata enrichment. Re-read the registry to confirm the field is present.

### 6. Output context.md

Aggregate all analyzed issues into `context.md`, organized by group: per-issue root cause, affected files, impact scope, fix direction, confidence, cross-refs; a Cross-Group Dependencies section; and a Constraints section split into **Locked** (derived from root-cause evidence) and **Free** (implementation choices left to the planner).

## Output

- Issue registry: each analyzed record enriched with an `analysis` field.
- `context.md`: grouped root-cause summary consumed by `plan --gaps`.
