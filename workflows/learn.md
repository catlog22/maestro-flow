<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Learn Workflow

Storage:
- `.workflow/specs/learnings.md` — append-only container of `<spec-entry>` sub-entries (shared with retrospective output)
- Auto-indexed by WikiIndexer (no manual index required)

---

## Prerequisites

- `.workflow/` initialized (`.workflow/state.json` exists). If missing, error E001.
- The `specs/` directory and `learnings.md` are created on first use; do not require them to exist upfront.

---

## Argument Shape

```
/manage-learn "<insight text>"                                  → capture, infer category, auto-link phase
/manage-learn "<insight>" --category pattern --keywords auth,jwt → capture with explicit category and keywords
/manage-learn list                                              → show recent 20 insights
/manage-learn list --keywords auth                              → filtered list
/manage-learn search <query>                                    → search via maestro wiki search
/manage-learn show <INS-id>                                     → full insight + linked phase context
```

| Flag | Effect |
|------|--------|
| `--category <name>` | One of: pattern, antipattern, decision, tool, gotcha, technique, tip. Default: inferred (tip mode defaults to `tip`). |
| `--keywords t1,t2` | Comma-separated keywords. Insight mode implicitly adds `manual`, tip mode implicitly adds `tip`. |
| `--phase <N>` | Override auto-detected phase link. Use `--phase 0` to force "no phase". |
| `--confidence <level>` | high / medium / low. Default: medium (insight), low (tip). |
| `--lens <name>` | Filter by retrospective lens: technical, process, quality, decision, git (list/search only). |
| `--limit <N>` | List mode row limit (default 20). |

---

## Stage 1: parse_input

```
Verify .workflow/ exists (else E001). Route by first token:
  "list" → list | "search" → search (next token = query) | "show" → show (next token = INS-id)
  "tip"  → tip capture (source="tip", category="tip", confidence="low", implicit keyword "tip")
  else   → capture mode (full quoted text = insight body)
Empty args → AskUserQuestion. Invalid --category → E002.
```

---

## Stage 2: capture mode

### Step 2.1: Bootstrap storage

```bash
SPECS_DIR=".workflow/specs"
INSIGHTS_FILE="$SPECS_DIR/learnings.md"

mkdir -p "$SPECS_DIR"

if [ ! -f "$INSIGHTS_FILE" ]; then
  cat > "$INSIGHTS_FILE" << 'EOF'
---
title: "Learning Insights"
type: spec
roles: [implement]
tags: [insights, learning]
created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
---
# Learning Insights

Atomic insights captured during active work.

## Entries

EOF
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

### Step 2.5: Build spec-entry

```
entry = <spec-entry
  category="{category}"
  keywords="{category},{parsed --keywords values joined by comma}"
  date="{YYYY-MM-DD}"
  id="INS-{hex}"
  source="manual"
>

### {title: first 80 chars of insight text, truncated on word boundary}

{full insight text}

- **Phase**: {phase or "none"} ({phase_slug or "—"})
- **Confidence**: {--confidence value or "medium"}
- **Tags**: {parsed --keywords values + ["manual"]}

</spec-entry>
```

### Step 2.6: Persist

Append the `<spec-entry>` block to `.workflow/specs/learnings.md`.

WikiIndexer auto-indexes the entry — no manual index update required.

### Step 2.7: Confirmation banner

Display: ID, category, confidence, tags, phase (+slug if present), title, file path, and hints for `list` / `search` commands.

---

## Stage 3: list mode

### Step 3.1: Read entries

Query via `maestro wiki list --type knowhow --role implement --json`. Filter by `--keywords`, `--category`, `--phase`, `--lens` flags. Sort by timestamp descending. Limit to 20 (or `--limit N`).

### Step 3.2: Display table

```
=== KNOWHOW INSIGHTS ({shown}/{total}) ===

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

### Step 4.2: Search via wiki

Execute `maestro wiki search "<query>" --type knowhow --json`. Results are ranked by BM25 relevance. Sort by rank desc, then date desc.

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

### Step 5.1: Locate entry

Find `<spec-entry>` matching target INS-id in `learnings.md`. Missing arg → E003. Not found → E004.

### Step 5.2: Resolve linked phase context (if any)

If `entry.phase_slug` is set, resolve the matching Session/Run through `.workflow/sessions/*/runs/*/run.json`, then resolve any retrospective through that Session's `artifacts.json`.

### Step 5.3: Resolve routed artifact (if any)

Map `routed_to` → path: `spec` → `.workflow/specs/{id}`, `issue` → `.workflow/issues/issues.jsonl#{id}`, `knowhow` → `.workflow/knowhow/{id}.md`.

### Step 5.4: Display

```
=========================================
  INSIGHT: {entry.id}
  CATEGORY: {entry.category}
  CONFIDENCE: {entry.confidence}
  SOURCE: {entry.source}{IF entry.lens: " (" + entry.lens + " lens)"}
=========================================

CAPTURED:    {entry.date}
PHASE:       {entry.phase or "none"}{IF phase_slug: " (" + phase_slug + ")"}
TAGS:        {entry.keywords}

TITLE:
  {entry.title}

SUMMARY:
  {entry.content}

EVIDENCE:
  {parsed from entry content, or "(none — manual capture)"}

ROUTED:
  Target: {entry.routed_to or "none"}
  ID:     {entry.routed_id or "—"}
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
| `retrospective` (step) | Producer. Appends `<spec-entry>` to the same `specs/learnings.md` with `source: "retrospective"` and a populated `lens` field. |
| `/manage knowledge capture` | Sibling. Captures session state for recovery; `learn` captures timeless insights. Both write to `.workflow/knowhow/` with different prefixes. |
| `phase-transition` | Reader (informally). Phase-transition's free-form `.workflow/specs/learnings.md` is a distinct file with a different audience; do not merge them. |
| `plan` (step) | Future consumer. Should query via `maestro wiki search` or `maestro wiki list --type knowhow --role implement` to inform planning decisions. (Out of scope for this command.) |
