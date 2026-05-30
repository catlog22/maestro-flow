# Workflow: finish-work

Last step of session commands. Inline-extracts spec/knowhow from this single session, then writes `archive.json` so the session enters `wiki search` (strategy 2: only sealed/archived sessions are indexed).

## Inputs

Caller passes: `SESSION_DIR`, `SESSION_TYPE` (grill | brainstorm | analyze | blueprint | plan | execute | verify), `SESSION_ID`, `LINKED_MILESTONE` (optional).

## Steps

### 1. Detect outputs

Scan `SESSION_DIR` for any of these files (any absent → skip silently):

| File | Source | Used for |
|------|--------|----------|
| `context-package.json` | grill/brainstorm/analyze/blueprint | constraints + insights |
| `terminology.md` | grill | domain terms with code references |
| `grill-report.md` | grill | stress-test decisions + risk register |
| `conclusions.json` | analyze | decisions |
| `reflection-log.md` | execute | lessons + pitfalls |
| `{role}/analysis.md` | brainstorm | role decisions |

If none present → skip Steps 2-3, continue with empty `content_refs` and `extraction.harvested = false`.

### 2. Extract fragments (inline)

Iterate detected files; build a `fragments[]` array. Each fragment: `{ kind, category, title, content, keywords[], confidence, ref }`.

| Source field | kind | Target store | Default category |
|--------------|------|--------------|------------------|
| `context-package.json#constraints[status=locked]` | rule | spec | `arch` if area matches arch keywords (module/layer/boundary), else `coding` |
| `context-package.json#insights[]` | knowhow | knowhow (type: `DCS` for decisions, `RCP` for patterns) | `arch` for decisions, `coding` for patterns |
| `conclusions.json#decisions[status=locked]` | rule | spec | `arch` |
| `conclusions.json#recommendations[]` (priority ≥ medium) | knowhow | knowhow (`REF`) | derived from area |
| `reflection-log.md` "## Lessons" / "## Pitfalls" sections | learning | spec (category `learning`) or knowhow (`KNW`) by length: < 200 chars → spec, else knowhow | `learning` |
| `{role}/analysis.md` §2 Decisions[status=locked] | rule | spec | role-derived (`arch` for system-architect, `coding` for code-quality, etc.) |
| `grill-report.md` "## Synthesis" locked decisions | rule | spec | `arch` if scope/integration/security branch, else `coding` |
| `grill-report.md` "## Risk Register" items (severity ≥ medium) | knowhow | knowhow (`REF`) | `debug` |
| `terminology.md` locked terms | knowhow | knowhow (`REF`) | `coding` |

**Confidence scoring** (drop if < 0.5):
- +0.3 if `status == "locked"` or section is explicit "## Decisions"
- +0.2 if has ≥ 3 keywords (extracted from content)
- +0.2 if has explicit `rationale` field
- +0.2 if content length 50-2000 chars (not too thin, not too verbose)
- +0.1 if explicit `ref` to source file

**Keyword extraction**: take 3-5 lowercased domain terms (filter stop words, take frequency-ranked nouns/identifiers from content).

**Deduplication**: hash `(kind, content[:100])` — skip if any existing spec/knowhow entry has matching hash (check via `maestro spec list --json` + `maestro knowhow list --json`).

### 3. Route fragments

Auto mode (`-y`): apply all. Otherwise prompt once with batch summary:
```
Found {N} fragments — {S_spec} spec / {S_knowhow} knowhow.
Apply? (auto | spec-only | knowhow-only | skip)
```

Then for each fragment in approved buckets:

- **spec**: `maestro spec add <category> "<title>" "<content>" --keywords {csv} --source finish-work` (capture returned id into `extracted_spec_ids[]`)
- **knowhow**: `maestro knowhow add --type {DCS|RCP|REF|KNW} --title "{title}" --body "{content}" --keywords {csv}` (capture id into `extracted_knowhow_ids[]`)
- Below confidence threshold: increment `skipped_count`, do nothing
- CLI failure: log W002, continue with remaining fragments

### 4. Write `archive.json`

Overwrites; idempotent. Schema `session-archive/1.0`:

```jsonc
{
  "$schema": "session-archive/1.0",
  "session_id": "{SESSION_ID}",
  "session_type": "{SESSION_TYPE}",
  "session_path": "{SESSION_DIR relative to .workflow/}",
  "lifecycle": { "status": "sealed", "sealed_at": "{ISO now}", "archived_at": null, "linked_milestone": "{LINKED_MILESTONE or null}" },
  "content_refs": [ /* one entry per file detected in Step 1, schema { type, path } */ ],
  "extraction": {
    "harvested": true,
    "harvested_at": "{ISO now}",
    "spec_ids": [/* from Step 3 */],
    "knowhow_ids": [/* from Step 3 */],
    "skipped_count": 0
  },
  "pruned": null
}
```

If Step 2 produced zero fragments or user chose skip:
```jsonc
"extraction": { "harvested": false, "reason": "no-signal | user-skip | harvest-failed" }
```

### 5. Report

```
=== SESSION SEALED ===
Session: {SESSION_ID} ({SESSION_TYPE})
Wiki:    searchable via `maestro wiki search` (category {arch|coding|review})
Knowledge: {len(spec_ids)} spec / {len(knowhow_ids)} knowhow extracted, {skipped_count} skipped
Next: /maestro-milestone-complete will flip lifecycle.status → archived and prune context-package.json
```

## Idempotency

Re-running on same session: archive.json overwritten with fresh timestamps. Steps 2-3 skipped when existing `archive.json.extraction.harvested == true` (avoids duplicate spec/knowhow). Force re-extract: delete `archive.json` first.

## Boundary

- Does NOT flip `archived_at` or move files — that is milestone-complete Step 2.3.
- Does NOT prune `context-package.json` — pruning is milestone-complete only.
- Does NOT touch `state.json` — caller handles artifact registration.
- Does NOT create issues — issue creation is out of single-session sealing scope (use `/manage-harvest` or `/manage-issue-discover` for that).

## Errors

| Code | Condition |
|------|-----------|
| E001 | SESSION_DIR missing |
| E002 | SESSION_TYPE unknown |
| W001 | No substantive outputs (still seals with empty content_refs) |
| W002 | A `spec add` / `knowhow add` CLI invocation failed (continue with remaining fragments) |
