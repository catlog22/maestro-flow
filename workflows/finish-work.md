# Workflow: finish-work

## Inputs

`SESSION_DIR`, `SESSION_TYPE` (grill | brainstorm | analyze | blueprint | plan | execute | verify), `SESSION_ID`, `LINKED_MILESTONE` (optional).

## Steps

### 1. Detect outputs

Scan `SESSION_DIR` for known files. Missing file → log W0xx, flag [LOW CONFIDENCE]. None found → skip to Step 4 with `extraction.harvested = false`.

| File | Session types | Yields |
|------|---------------|--------|
| `context-package.json` | grill/brainstorm/analyze/blueprint | constraints + insights |
| `terminology.md` | grill | domain terms |
| `grill-report.md` | grill | decisions + risk register |
| `conclusions.json` | analyze | decisions + recommendations |
| `reflection-log.md` | execute | lessons + pitfalls |
| `{role}/analysis.md` | brainstorm | role decisions |

### 2. Extract fragments

Build `fragments[]` from detected files. Each: `{ kind, category, title, content, keywords[], confidence, ref }`.

**Routing table** — `locked` status or `priority ≥ medium` required unless noted:

| Source | → Store | Category |
|--------|---------|----------|
| `context-package.json#constraints[locked]` | spec (rule) | `arch` if module/layer/boundary, else `coding` |
| `context-package.json#insights[]` | knowhow (`DCS`/`RCP`) | `arch` for decisions, `coding` for patterns |
| `conclusions.json#decisions[locked]` | spec (rule) | `arch` |
| `conclusions.json#recommendations[≥medium]` | knowhow (`REF`) | area-derived |
| `reflection-log.md` §Lessons/§Pitfalls | < 200 chars → spec (`learning`), else knowhow (`KNW`) | `learning` |
| `{role}/analysis.md` §Decisions[locked] | spec (rule) | role-derived |
| `grill-report.md` §Synthesis[locked] | spec (rule) | `arch` if scope/integration/security, else `coding` |
| `grill-report.md` §Risk Register[≥medium] | knowhow (`REF`) | `debug` |
| `terminology.md` locked terms | knowhow (`REF`) | `coding` |

**Confidence** (drop if < 0.5): locked/decisions heading +0.3 · ≥3 keywords +0.2 · has rationale +0.2 · length 50-2000 +0.2 · has ref +0.1

**Keywords**: 3-5 lowercased domain terms, frequency-ranked nouns/identifiers, stop words filtered.

**Dedup**: hash `(kind, content[:100])` — skip if existing entry matches. MANDATORY via `maestro spec list --json` + `maestro knowhow list --json`.

**Conflict detection**: for `kind == "rule"` fragments, search existing spec in same category (`maestro search "<keywords>" --type spec`). If an existing entry contradicts the fragment, attach `conflicting_entry = { file, line }` and `conflict_note`. Do NOT drop — proceed with metadata.

### 3. Route fragments

Prompt once (unless `-y` auto mode):
```
Found {N} fragments — {S_spec} spec / {S_knowhow} knowhow. Apply? (auto | spec-only | knowhow-only | skip)
```

Routing — all CLI calls MANDATORY, NOT SUBSTITUTABLE:

- **spec**: `maestro spec add <category> "<title>" "<content>" --keywords {csv} --description "<summary>" --source finish-work` → capture id into `spec_ids[]`
- **spec + conflict**: after adding, mark the old entry: `maestro spec conflict mark <file> <line> --note "<note>"`. Sets `confidence="contested"` → search scores ×0.5 + `[CONTESTED]` badge. Resolution deferred to `/manage-knowledge-audit`.
- **knowhow**: `maestro knowhow add --type {DCS|RCP|REF|KNW} --title "<title>" --body "<content>" --keywords {csv}` → capture id into `knowhow_ids[]`
- **below threshold**: increment `skipped_count`
- **CLI failure**: log W002, continue; flag [LOW CONFIDENCE]

### 3.5 Domain term extraction

Skip if `.workflow/domain/` absent or no term sources or all candidates already registered.

Sources (priority order): `terminology.md` → `context-package.json#domain.terminology[]` → `conclusions.json#recommendations` with domain keywords.

Process: collect candidates → filter registered terms → interactive confirm (always, `-y` does NOT bypass) → MANDATORY `maestro domain add` → record in `extraction.domain_ids[]`.

### 4. Write archive.json

Idempotent overwrite. Schema `session-archive/1.0`:

```jsonc
{
  "$schema": "session-archive/1.0",
  "session_id": "", "session_type": "", "session_path": "",
  "lifecycle": { "status": "sealed", "sealed_at": "", "archived_at": null, "linked_milestone": null },
  "content_refs": [/* { type, path } per detected file */],
  "extraction": {
    "harvested": true, "harvested_at": "",
    "spec_ids": [], "knowhow_ids": [], "domain_ids": [],
    "conflict_marks": [/* { file, line, note } */],
    "skipped_count": 0
  },
  "pruned": null
}
// No fragments or user skip: "extraction": { "harvested": false, "reason": "no-signal | user-skip | harvest-failed" }
```

### 5. Report

```
=== SESSION SEALED ===
Session:    {SESSION_ID} ({SESSION_TYPE})
Knowledge:  {spec} spec / {knowhow} knowhow extracted, {skipped} skipped
Conflicts:  {conflict_count} entries marked [CONTESTED] — resolve via /manage-knowledge-audit
Next:       /maestro-milestone-complete → archive + prune
```

## Boundary

- Does NOT flip `archived_at` or move files (milestone-complete Step 2.3)
- Does NOT prune `context-package.json` (milestone-complete only)
- Does NOT touch `state.json` (caller handles)
- Does NOT create issues (use `/manage-harvest` or `/manage-issue-discover`)

## Errors

| Code | Condition |
|------|-----------|
| E001 | SESSION_DIR missing |
| E002 | SESSION_TYPE unknown |
| W001 | No substantive outputs (seals with empty content_refs) |
| W002 | CLI invocation failed (continue with remaining) |
