# Workflow: finish-work

> Knowledge model: session-level decoupling MVP. Wrap-up **stages candidates** (run-source when a run is linked, session-source otherwise); it NEVER writes the spec/knowhow corpus directly. Corpus writes happen only via `maestro knowledge promote` after the source is sealed with a fresh reconciliation receipt.

## Inputs

Caller passes: `SESSION_DIR`, `SESSION_TYPE` (grill | brainstorm | analyze | blueprint | plan | execute | verify), `SESSION_ID`, `LINKED_RUN` (optional).

## Steps

### 1. Detect outputs

Scan basis: when `LINKED_RUN` is present, scan that Run's `{run_dir}/outputs/` (run-mode contracts declare artifacts there); otherwise scan `SESSION_DIR` (standalone grill/brainstorm sessions). In either case look for these files; if absent: log W0xx "<file> missing" and continue; flag harvest as [LOW CONFIDENCE] (partial fragments):

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

| Source field | kind | Candidate type | Default category |
|--------------|------|----------------|------------------|
| `context-package.json#constraints[status=locked]` | rule | spec | `arch` if area matches arch keywords (module/layer/boundary), else `coding` |
| `context-package.json#insights[]` | knowhow | knowhow | `arch` for decisions, `coding` for patterns |
| `conclusions.json#decisions[status=locked]` | rule | spec | `arch` |
| `conclusions.json#recommendations[]` (priority ≥ medium) | knowhow | knowhow | derived from area |
| `reflection-log.md` "## Lessons" / "## Pitfalls" sections | learning | spec (category `learning`) if < 200 chars, else knowhow | `learning` |
| `{role}/analysis.md` §2 Decisions[status=locked] | rule | spec | role-derived (`arch` for system-architect, `coding` for code-quality, etc.) |
| `grill-report.md` "## Synthesis" locked decisions | rule | spec | `arch` if scope/integration/security branch, else `coding` |
| `grill-report.md` "## Risk Register" items (severity ≥ medium) | knowhow | knowhow | `debug` |
| `terminology.md` locked terms | knowhow | knowhow | `coding` |

**Confidence scoring** (drop if < 0.5):
- +0.3 if `status == "locked"` or section is explicit "## Decisions"
- +0.2 if has ≥ 3 keywords (extracted from content)
- +0.2 if has explicit `rationale` field
- +0.2 if content length 50-2000 chars (not too thin, not too verbose)
- +0.1 if explicit `ref` to source file

**Quality-bar exclusions (drop regardless of score)**: process notes ("did X", "produced document Y"); re-descriptions of existing project patterns that code/config already documents; trivial or obvious operations; run-state narration (read-only declarations, worktree observations); raw traces (tool outputs, log or error fragments) that were not distilled into a reusable lesson. A harvest that stages zero fragments is a legitimate outcome — never pad the candidate list.

**Keyword extraction**: take 3-5 lowercased domain terms (filter stop words, take frequency-ranked nouns/identifiers from content).

**Duplicate pre-check** (cheap, advisory): `maestro search "<title keywords>" --json` per fragment; if an entry with the same title already exists in the corpus, skip staging that fragment (`skipped_count++`, reason `duplicate-in-corpus`). Fine-grained duplicate/related/conflict disposition happens later at `maestro knowledge promote --resolve` (or the deprecated `review --resolve` fallback) — do not block staging on fuzzy matches here.

### 3. Stage fragments as candidates

Write authority (per the knowledge model):
- `LINKED_RUN` present → run-source: `--run {LINKED_RUN}`.
- No linked run → session-source: write authority resolves through identity tiers (`--channel`/`MAESTRO_CHANNEL` → host lease → single live hook channel → narrowed scan); with nothing running a daily synthetic knowledge Session (`ksyn-*`) is created idempotently. Session-source staging requires non-empty `--evidence`.

Auto mode (`-y`): stage all approved fragments. Otherwise prompt once with batch summary:
```
Found {N} fragments — {S_spec} spec / {S_knowhow} knowhow candidates.
Stage? (auto | spec-only | knowhow-only | skip)
```

For each fragment in approved buckets — MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep, and NEVER inline content (write each fragment body to a temp file first; spaces/quotes/unicode/newlines/leading dashes shift positional arguments):

```bash
# run-source (LINKED_RUN present)
maestro knowledge stage spec|knowhow "<title>" --content-file <tmpfile> --run {LINKED_RUN} \
  --category <mapping> --evidence "<source-file>:<section>" [--signal cited --signal-ids <ids>] \
  [--repo <host-authorized selector-or-UUID>]
# session-source (no linked run; --evidence mandatory)
maestro knowledge stage spec|knowhow "<title>" --content-file <tmpfile> \
  --category <mapping> --evidence "<source-file>:<section>" [--session <session-id> | --channel <name>] \
  [--repo <host-authorized selector-or-UUID>]
```

Canonical parameter contract: ordinary Knowhow requires only `type/title/content`; ordinary Spec requires only `category/title/content`. Finish-work adds evidence and other advanced fields only when the candidate actually needs them. For CLI staging, omit repository selection for the current repository; for an explicitly selected linked physical target, append `--repo <host-authorized selector-or-UUID>`. The host must authorize that selector/UUID and provide a live write capability for the matching corpus; never infer it from cwd/name/alias/path. `targetRepoId` is host/MCP-only, is not a CLI flag, and MUST NOT appear in a `maestro knowledge stage` CLI invocation. Never persist an alias/path as identity. Finish-work never normalizes the corpus; migration requires a separately reviewed `knowledge normalize --report` followed by explicit `--apply`.

- Capture returned candidate IDs into `staged_candidates[]` (`{candidate_id, origin: run|session, kind}`).
- Below confidence threshold: increment `skipped_count`, do nothing.
- CLI failure: log W002, continue with remaining fragments; flag harvest as [LOW CONFIDENCE] (CLI failure).

**Timing law**: staging must happen BEFORE the run/session is sealed (sealed targets reject writes). Promotion is a separate, later step (Step 5 note).

### 3.5 Domain Term Extraction (interactive, conditional)

Prerequisites:
  - `.workflow/domain/` directory exists (skip the entire step if it does not)
  - Session contains terminology source files

Source priority:
  1. `terminology.md` (grill session) — locked terms with code references
  2. `context-package.json#domain.terminology[]` — produced by brainstorm/grill/import
  3. `conclusions.json#recommendations` with domain-like keywords

Process:
  1. Collect term candidates from session outputs
  2. Filter out terms already registered in `glossary.yaml`
  3. 0 new candidates → skip (silent)
  4. ≥ 1 new candidate → interactive confirmation (domain registration always requires user confirmation; `-y` has no effect on domain)
  5. MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: write confirmed terms to `glossary.yaml` via `maestro domain add`
  6. Record to `extraction.domain_ids[]` in `archive.json`

Skip conditions:
  - `.workflow/domain/` does not exist
  - Session has no terminology source files
  - All candidate terms already registered

> Domain glossary writes are a separate store (explicit knowledge-management work), not the governed spec/knowhow corpus — direct `domain add` remains correct here.

### 4. Write `archive.json`

Overwrites; idempotent. Schema `session-archive/1.1`. `archive.json` is session-level metadata owned by this workflow (not a run artifact): it lives in `SESSION_DIR`, is never registered in `artifacts.json`, and is not consumed by the CLI.

```jsonc
{
  "$schema": "session-archive/1.1",
  "session_id": "{SESSION_ID}",
  "session_type": "{SESSION_TYPE}",
  "session_path": "{SESSION_DIR relative to .workflow/}",
  "lifecycle": { "status": "completed", "completed_at": "{ISO now}", "archived_at": null, "linked_run": "{LINKED_RUN or null}" },
  "content_refs": [ /* one entry per file detected in Step 1, schema { type, path } */ ],
  "extraction": {
    "harvested": true,
    "harvested_at": "{ISO now}",
    "staged_candidates": [ /* { candidate_id, origin: run|session, kind } from Step 3 */ ],
    "domain_ids": [ /* from Step 3.5 */ ],
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
=== SESSION COMPLETE ===
Session: {SESSION_ID} ({SESSION_TYPE})
Candidates: {N} staged ({S_spec} spec / {S_knowhow} knowhow), {skipped_count} skipped
Next: seal the run/session, then `maestro knowledge review <session-id> --refresh` → resolve → promote
        (candidates become corpus/searchable only after promotion)
```

## Idempotency

- Re-running re-stages only fragments whose duplicate pre-check finds no corpus match; review-time disposition (`--as duplicate`) absorbs any residual double-staging. `archive.json` is overwritten, not appended.

## Boundary

- Does NOT write the spec/knowhow corpus directly — staging only; the corpus is written exclusively by `maestro knowledge promote` (dual-source gates: run-source = sealed run + fresh receipt; session-source = sealed Session + fresh session receipt + non-empty stage `--evidence`).
- Does NOT flip `archived_at` or move files.
- Does NOT prune `context-package.json`.
- Does NOT touch `state.json` — caller handles artifact registration.
- Does NOT create issues — issue creation is out of single-session completion scope (use `/maestro-knowledge harvest` or `/maestro-issue discover` for that).

## Errors

| Code | Condition |
|------|-----------|
| E001 | SESSION_DIR missing |
| E002 | SESSION_TYPE unknown |
| W001 | No substantive outputs (still completes with empty content_refs) |
| W002 | A `knowledge stage` CLI invocation failed (continue with remaining fragments) |
