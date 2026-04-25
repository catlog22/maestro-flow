# Learn Workflow

Atomic insight capture, search, and retrieval. Lightweight gstack-style "eureka moment" log that complements the retrospective workflow: where retrospective extracts insights from completed phases in bulk, `manage-learn` captures one insight at a time during active work.

Storage:
- `.workflow/learning/lessons.jsonl` — append-only JSONL row per insight (shared with retrospective output)
- `.workflow/learning/learning-index.json` — searchable index (searchable index)

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
| `--category <name>` | One of: pattern, antipattern, decision, tool, gotcha, technique. Default: inferred. |
| `--tag t1,t2` | Comma-separated tags. Always implicitly adds `manual` for capture mode. |
| `--phase <N>` | Override auto-detected phase link. Use `--phase 0` to force "no phase". |
| `--confidence <level>` | high / medium / low. Default: medium. |

---

## Stage 1: parse_input

```
1. Verify .workflow/ exists; else error E001.
2. Tokenize $ARGUMENTS:
   - First token determines mode:
       "list"   → list mode
       "search" → search mode (next token = query)
       "show"   → show mode (next token = INS-id)
       anything else → capture mode (entire quoted text = insight body)
3. If empty arguments → AskUserQuestion: prompt for insight text.
4. Validate --category against allowed set; unknown → error E002.
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
phase = null
phase_slug = null

IF .workflow/state.json exists:
  state = read JSON
  artifacts = state.artifacts ?? []

  # Derive current phase from artifacts (first phase with in_progress, or first without completed execute)
  phase = null
  inProgressArt = artifacts.find(a => a.type === 'execute' && a.status === 'in_progress')
  IF inProgressArt:
    phase = inProgressArt.phase
  ELSE:
    phaseNums = [...new Set(artifacts.map(a => a.phase).filter(Boolean))].sort()
    phase = phaseNums.find(p => !artifacts.some(a => a.phase === p && a.type === 'execute' && a.status === 'completed'))

  IF phase is not null:
    # Resolve slug from artifact registry
    art = artifacts.find(a => a.phase === phase)
    phase_slug = art?.slug ?? "phase-" + phase
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

### Step 2.6: Append to lessons.jsonl

```
Serialize row as single JSON line (no pretty print)
Append to .workflow/learning/lessons.jsonl
```

### Step 2.7: Update learning-index.json

```
Read .workflow/learning/learning-index.json
Append to entries[]:
  {
    id: row.id,
    type: "insight",
    timestamp: row.captured_at,
    file: "lessons.jsonl",
    summary: row.title,
    tags: row.tags,
    lens: null,
    category: row.category,
    phase: row.phase,
    phase_slug: row.phase_slug,
    confidence: row.confidence,
    routed_to: "none",
    routed_id: null
  }
Write .workflow/learning/learning-index.json
```

### Step 2.8: Confirmation banner

```
=== INSIGHT CAPTURED ===
ID:         {INS-id}
Category:   {category}
Confidence: {confidence}
Tags:       {tags joined by ", "}
Phase:      {phase or "none"}{IF phase_slug: " ({phase_slug})"}

  {title}

File: .workflow/learning/lessons.jsonl

To browse: Skill({ skill: "manage-learn", args: "list" })
To search: Skill({ skill: "manage-learn", args: "search <query>" })
```

---

## Stage 3: list mode

### Step 3.1: Read entries

```
Read .workflow/learning/learning-index.json
entries = index.entries

Apply filters from flags:
  --tag t1,t2  → keep entries where any tag matches any filter tag
  --category X → keep entries where category == X
  --phase N    → keep entries where phase == N
  --lens X     → keep entries where lens == X (retrospective insights only)

Sort by timestamp DESCENDING
Default limit: 20 (override with --limit N)
```

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

```
query = next token after "search"
If empty → AskUserQuestion: "What text to search for?"
```

### Step 4.2: Scan lessons.jsonl

```
matches = []
FOR each line in .workflow/learning/lessons.jsonl:
  row = JSON.parse(line)
  haystack = lower(row.title + " " + row.summary + " " + row.tags.join(" ") + " " + row.category + " " + (row.lens or ""))
  needle = lower(query)
  IF haystack contains needle:
    # Compute simple match rank
    rank = 0
    IF row.title contains needle: rank += 3
    IF row.tags contains needle:  rank += 2
    IF row.summary contains needle: rank += 1
    matches.push({ row, rank })

Sort matches by rank DESCENDING, then by captured_at DESCENDING
```

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

```
target_id = next token after "show"
If missing → error E003: "Provide an INS-id (e.g. INS-a1b2c3d4)"

row = null
FOR each line in .workflow/learning/lessons.jsonl:
  parsed = JSON.parse(line)
  IF parsed.id == target_id:
    row = parsed
    break

IF row is null → error E004: "Insight {target_id} not found"
```

### Step 5.2: Resolve linked phase context (if any)

```
phase_context = null
IF row.phase_slug is not null:
  // Resolve phase dir from artifact registry
  Read .workflow/state.json → state
  artifacts = state.artifacts ?? []
  phase_dir = null
  art = artifacts.find(a => a.phase === row.phase && a.path)
  IF art: phase_dir = ".workflow/" + art.path

  IF phase_dir AND directory exists:
    phase_context = {
      title: read index.json.title from phase_dir,
      status: read index.json.status,
      retrospective_exists: file exists at phase_dir + "/retrospective.md"
    }
```

### Step 5.3: Resolve routed artifact (if any)

```
routed_path = null
IF row.routed_id is not null:
  IF row.routed_to == "spec":
    routed_path = ".workflow/specs/" + row.routed_id
  ELIF row.routed_to == "issue":
    routed_path = ".workflow/issues/issues.jsonl#" + row.routed_id
  ELIF row.routed_to == "note":
    routed_path = ".workflow/memory/" + row.routed_id + ".md"
```

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

## Error Codes

| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | `.workflow/` not initialized — run `Skill({ skill: "maestro-init" })` first |
| E002 | error | Unknown `--category` (allowed: pattern, antipattern, decision, tool, gotcha, technique) |
| E003 | error | `show` mode requires an INS-id argument |
| E004 | error | Insight id not found in lessons.jsonl |
| W001 | warning | Auto-phase detection found no matching artifact in registry; phase set to null |
| W002 | warning | learning-index.json out of sync with lessons.jsonl (different row count); offer to rebuild |

---

## Success Criteria

- [ ] Mode correctly routed (capture / list / search / show)
- [ ] Capture mode: `lessons.jsonl` row appended, valid JSON, all required fields present
- [ ] Capture mode: `learning-index.json` updated with matching entry
- [ ] Capture mode: phase auto-link resolves correctly from artifact registry
- [ ] Capture mode: category inference produces a sensible default when --category absent
- [ ] List mode: filters apply; output sorted newest-first
- [ ] Search mode: results ranked by title > tags > summary match
- [ ] Show mode: full insight displayed with phase context and routed artifact link if any
- [ ] No file modifications outside `.workflow/learning/`

---

## Relationship to other workflows

| Workflow | Relationship |
|----------|--------------|
| `quality-retrospective` | Producer. Writes insights into the same `lessons.jsonl` with `source: "retrospective"` and a populated `lens` field. |
| `manage-memory-capture` | Sibling. Captures session state for recovery; `learn` captures timeless insights. They share the JSONL+index pattern but live in different directories so retrieval semantics stay clean. |
| `phase-transition` | Reader (informally). Phase-transition's free-form `.workflow/specs/learnings.md` is a distinct file with a different audience; do not merge them. |
| `maestro-plan` | Future consumer. Should query `lessons.jsonl` filtered by tag/lens/category to inform planning decisions. (Out of scope for this command.) |
