# Learn Workflow

Atomic insight capture, search, and retrieval. Lightweight gstack-style "eureka moment" log that complements the retrospective workflow: where retrospective extracts insights from completed phases in bulk, `manage-learn` captures one insight at a time during active work.

Storage:
- `.workflow/learning/lessons.jsonl` — append-only JSONL row per insight (shared with retrospective output)
- `.workflow/learning/learning-index.json` — searchable index

**Shared store rationale:** Manual captures (`source: "manual"`), tips (`source: "tip"`), retrospective-distilled insights (`source: "retrospective"`, `lens: <name>` from `quality-retrospective`), and learn-retro insights (`source: "retro-git"` or `source: "retro-decision"` from `learn-retro`) all live in the same store so search and list see the entire knowledge corpus. The `source` field disambiguates origin.

This workflow does NOT spawn agents or call CLI tools. It is a thin file operation: parse → infer → append → confirm.

---

## Prerequisites

- `.workflow/` initialized (`.workflow/state.json` exists). If missing, error E001.
- The `learning/` directory and its files are created on first use; do not require them to exist upfront.

---

## Argument Shape

```
/manage-learn "<insight text>"                                  → capture, infer category, auto-link phase
/manage-learn "<insight>" --category pattern --tag auth,jwt    → capture with explicit category and tags
/manage-learn list                                              → show recent 20 insights
/manage-learn list --tag auth                                   → filtered list
/manage-learn search <query>                                    → text search across lessons.jsonl
/manage-learn show <INS-id>                                     → full insight + linked phase context
```

| Flag | Effect |
|------|--------|
| `--category <name>` | One of: pattern, antipattern, decision, tool, gotcha, technique, tip. Default: inferred (tip mode defaults to `tip`). |
| `--tag t1,t2` | Comma-separated tags. Insight mode implicitly adds `manual`, tip mode implicitly adds `tip`. |
| `--phase <N>` | Override auto-detected phase link. Use `--phase 0` to force "no phase". |
| `--confidence <level>` | high / medium / low. Default: medium (insight), low (tip). |
| `--lens <name>` | Filter by retrospective lens: technical, process, quality, decision, git (list/search only). |
| `--limit <N>` | List mode row limit (default 20). |

---

## Stage 1: parse_input

```
Verify .workflow/ exists (else E001). Route by first token:
  "list" → list | "search" → search (next token = query) | "show" → show (next token = INS-id)
  "tip"  → tip capture (source="tip", category="tip", confidence="low", implicit tag "tip")
  else   → capture mode (full quoted text = insight body)
Empty args → AskUserQuestion. Invalid --category → E002.
```

---

## Stage 2: capture mode

### Step 2.1: Bootstrap storage

```bash
LEARN_DIR=".workflow/learning"
LESSONS_FILE="$LEARN_DIR/lessons.jsonl"
INDEX_FILE="$LEARN_DIR/learning-index.json"

mkdir -p "$LEARN_DIR"
touch "$LESSONS_FILE"

if [ ! -f "$INDEX_FILE" ]; then
  echo '{"entries":[],"_metadata":{"created":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","version":"1.0"}}' > "$INDEX_FILE"
fi
```

### Step 2.2: Generate ID

`INS-{8 lowercase hex chars}` from a stable hash of `(insight_text + timestamp)`. Re-running with the same text produces a different id (timestamp differs), so accidental duplicates are still appended — duplicate detection is the user's job at search time.

### Step 2.3: Auto-detect phase link

Unless `--phase` is set:
```
From .workflow/state.json artifacts, detect current phase:
  1. Find first artifact with type=execute, status=in_progress
  2. Else find first phase without a completed execute artifact
  3. Resolve phase_slug from matching artifact (fallback: "phase-{N}")
If no state.json → phase=null, phase_slug=null
```

If `--phase 0` is passed, force `phase = null, phase_slug = null` regardless.

### Step 2.4: Infer category (if --category not set)

Simple keyword heuristics — no LLM call. Match the insight text (lowercased) against keyword sets in priority order:

| Category | Keywords (any match wins) |
|----------|---------------------------|
| antipattern | "avoid", "don't", "never", "anti-pattern", "antipattern", "bug", "broken", "fails", "wrong" |
| gotcha | "gotcha", "surprise", "unexpected", "hidden", "easy to miss", "watch out", "footgun" |
| decision | "decided", "chose", "rationale", "trade-off", "tradeoff", "instead of", "rejected" |
| tool | "library", "package", "tool", "cli", "framework", "version" |
| pattern | "pattern", "convention", "always", "should", "use", "prefer", "standardize" |
| technique | (default fallback) |

First match wins. If nothing matches, category = `technique`.

### Step 2.5: Build row

```
row = {
  id: "INS-{hex}",
  phase: phase,
  phase_slug: phase_slug,
  lens: null,                  // null for manual capture (only retrospective sets this)
  category: category,
  title: first 80 chars of insight text (truncated on word boundary),
  summary: full insight text,
  confidence: --confidence value or "medium",
  tags: parsed --tag values + ["manual"],
  evidence_refs: [],           // empty for manual capture
  routed_to: "none",
  routed_id: null,
  source: "manual",
  captured_at: now ISO 8601 UTC
}
```

### Step 2.6: Persist

Append row as single JSON line to `.workflow/learning/lessons.jsonl`.

Update `.workflow/learning/learning-index.json` — append an index entry mirroring key row fields: `id`, `type:"insight"`, `timestamp`, `file:"lessons.jsonl"`, `summary` (=title), `tags`, `lens`, `category`, `phase`, `phase_slug`, `confidence`, `routed_to:"none"`, `routed_id:null`.

### Step 2.7: Confirmation banner

Display: ID, category, confidence, tags, phase (+slug if present), title, file path, and hints for `list` / `search` commands.

---

## Stage 3: list mode

### Step 3.1: Read entries

Read `.workflow/learning/learning-index.json`. Filter by `--tag`, `--category`, `--phase`, `--lens` flags. Sort by timestamp descending. Limit to 20 (or `--limit N`).

### Step 3.2: Display table

```
=== LEARNING INSIGHTS ({shown}/{total}) ===

  ID              Category    Phase   Conf   Tags                 Title
  ──────────────  ──────────  ──────  ─────  ───────────────────  ────────────────────────────
  INS-a1b2c3d4    pattern      1      high   auth,jwt,security    JWT refresh tokens must rota...
  INS-b2c3d4e5    gotcha       —      med    redis                Redis MULTI not transactional...
  INS-c3d4e5f6    decision     2      high   manual,arch          Chose Express over Fastify b...
  ...

Filters: {active filters or "none"}

View:    Skill({ skill: "manage-learn", args: "show <INS-id>" })
Search:  Skill({ skill: "manage-learn", args: "search <query>" })
Capture: Skill({ skill: "manage-learn", args: "<insight text>" })
```

If empty:
```
No insights yet.
Capture your first: Skill({ skill: "manage-learn", args: "\"...\"" })
```

---

## Stage 4: search mode

### Step 4.1: Validate query

Next token after "search". Empty → AskUserQuestion.

### Step 4.2: Scan lessons.jsonl

Case-insensitive search across each row's `title`, `summary`, `tags`, `category`, `lens`. Rank matches: title match +3, tags +2, summary +1. Sort by rank desc, then captured_at desc.

### Step 4.3: Display results

```
=== SEARCH RESULTS for "{query}" — {count} match{es} ===

  [{INS-id}] [{category}] phase {phase or "—"} ({source})
    {title}
    Tags: {tags}
    Captured: {captured_at}

  [{INS-id}] ...
    ...

View full: Skill({ skill: "manage-learn", args: "show <INS-id>" })
```

If no matches:
```
No insights match "{query}".
List all: Skill({ skill: "manage-learn", args: "list" })
```

---

## Stage 5: show mode

### Step 5.1: Locate row

Find row matching target INS-id in `lessons.jsonl`. Missing arg → E003. Not found → E004.

### Step 5.2: Resolve linked phase context (if any)

If `row.phase_slug` set: look up phase directory from `state.json` artifacts, read its `index.json` for title/status, check for `retrospective.md`.

### Step 5.3: Resolve routed artifact (if any)

Map `routed_to` → path: `spec` → `.workflow/specs/{id}`, `issue` → `.workflow/issues/issues.jsonl#{id}`, `note` → `.workflow/knowhow/{id}.md`.

### Step 5.4: Display

```
=========================================
  INSIGHT: {row.id}
  CATEGORY: {row.category}
  CONFIDENCE: {row.confidence}
  SOURCE: {row.source}{IF row.lens: " (" + row.lens + " lens)"}
=========================================

CAPTURED:    {row.captured_at}
PHASE:       {row.phase or "none"}{IF phase_slug: " (" + phase_slug + ")"}
TAGS:        {row.tags joined by ", "}

TITLE:
  {row.title}

SUMMARY:
  {row.summary}

EVIDENCE:
  {FOR ref in row.evidence_refs:} - {ref}{END FOR}
  {OR "(none — manual capture)"}

ROUTED:
  Target: {row.routed_to}
  ID:     {row.routed_id or "—"}
  Path:   {routed_path or "—"}

{IF phase_context:}
PHASE CONTEXT:
  Title:        {phase_context.title}
  Status:       {phase_context.status}
  Retrospective: {phase_context.retrospective_exists ? "yes" : "no"}
=========================================
```

---

## Relationship to other workflows

| Workflow | Relationship |
|----------|--------------|
| `quality-retrospective` | Producer. Writes insights into the same `lessons.jsonl` with `source: "retrospective"` and a populated `lens` field. |
| `manage-knowhow-capture` | Sibling. Captures session state for recovery; `learn` captures timeless insights. They share the JSONL+index pattern but live in different directories so retrieval semantics stay clean. |
| `phase-transition` | Reader (informally). Phase-transition's free-form `.workflow/specs/learnings.md` is a distinct file with a different audience; do not merge them. |
| `maestro-plan` | Future consumer. Should query `lessons.jsonl` filtered by tag/lens/category to inform planning decisions. (Out of scope for this command.) |
