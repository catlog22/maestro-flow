---
name: manage-learn
description: Capture atomic learning insights into .workflow/learning/lessons.jsonl. Lightweight CRUD over the shared learning store — supports capture, list, search, and show modes. No LLM or CLI calls; all operations are pure file reads and writes.
argument-hint: "[\"<insight text>\"|list|search <query>|show <INS-id>] [--category pattern|antipattern|decision|tool|gotcha|technique] [--tag t1,t2] [--phase N] [--confidence high|medium|low]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Pure file-operation CRUD skill for the workflow learning library. No agent spawning, no CLI calls, no LLM inference — just parse-infer-append-confirm. Complements `quality-retrospective`: where retrospective extracts insights in bulk from completed phases, `manage-learn` captures one timeless insight at a time during active work. Both write to the same `lessons.jsonl` store, disambiguated by `source` and `lens` fields.

```
Parse Mode  →  Bootstrap Store  →  Execute Mode  →  Confirm
(capture /       (on first use)     (Bash/Read/      (INS-id
  list /          Bash+Write)        Write/Grep)      + hints)
  search /
  show)
```
</purpose>

<context>
$ARGUMENTS — mode token followed by options.

```bash
$manage-learn "Always read state.json before planning to detect current phase"
$manage-learn "list --limit 10 --category antipattern"
$manage-learn "search context propagation"
$manage-learn "show INS-a3f7b2c1"
$manage-learn "\"Zod v4 breaks z.object().strict() API\" --category gotcha --tag zod,typescript"
```

**Flags** (capture mode):
- `--category <name>` — `pattern|antipattern|decision|tool|gotcha|technique`. Default: inferred from text keywords.
- `--tag t1,t2` — Comma-separated tags. Always adds `manual` implicitly.
- `--phase <N>` — Override auto-detected current phase. `--phase 0` forces no phase link.
- `--confidence high|medium|low` — Default: medium.

**Flags** (list/search mode):
- `--tag t1,t2` — Filter by tag
- `--category <name>` — Filter by category
- `--phase <N>` — Filter by phase
- `--lens <name>` — Filter by retrospective lens (technical|process|quality|decision)
- `--limit <N>` — Row limit (default 20)

**Storage**:
- `.workflow/learning/lessons.jsonl` — append-only JSONL (shared with `quality-retrospective`)
- `.workflow/learning/learning-index.json` — searchable index
</context>

<invariants>
1. **No LLM or CLI calls**: This skill is pure file I/O — parse, infer, append, confirm. No `exec_command`, no `spawn_agent`.
2. **Bootstrap on demand**: Create `.workflow/learning/` structure on first use; do not require it to exist.
3. **Append-only lessons.jsonl**: Never rewrite or delete existing rows.
4. **Stable INS-ids**: `INS-{8hex}` from `hash(insightText + timestamp)` — same text at different times gets different ids.
5. **Source field**: Always `"manual"` for captures from this skill; `"retrospective"` is reserved for `quality-retrospective`.
6. **Phase auto-link**: Read `state.json` automatically; `--phase 0` is the only way to force null.
7. **Keyword inference is approximate**: When in doubt, default to `pattern` category rather than prompting user.
</invariants>

<execution>

### Step 1: Parse Mode and Validate Arguments

Parse the first non-flag token from `$ARGUMENTS`:

| First token | Mode |
|-------------|------|
| `list` | list |
| `search` followed by query | search |
| `show` followed by INS-id | show |
| Empty | Prompt with `functions.request_user_input` |
| Any other text (quoted or not) | capture |

Validate `--category` if provided (allowed: pattern, antipattern, decision, tool, gotcha, technique). E002 if unknown.

### Step 2: Bootstrap Learning Store (on first use)

Check if `.workflow/learning/lessons.jsonl` exists. If not:
```javascript
// Create directory and empty files — use Bash + Write (apply_patch cannot create empty files reliably)
Bash('mkdir -p .workflow/learning && touch .workflow/learning/lessons.jsonl')
Write('.workflow/learning/learning-index.json', '{"version":1,"entries":[]}\n')
```

Verify `.workflow/` exists (E001 if not).

### Step 3: Execute Mode

#### Capture Mode

1. **Infer category** from insight text (keyword heuristics, no LLM):

| Keywords present in text | Inferred category |
|--------------------------|-------------------|
| always, should, prefer, best practice | pattern |
| never, avoid, don't, pitfall, breaks | antipattern |
| decided, chose, tradeoff, because, reason | decision |
| tool, library, framework, package, cli | tool |
| gotcha, surprising, unexpected, watch out | gotcha |
| technique, approach, method, pattern for | technique |

2. **Auto-link phase**: Read `.workflow/state.json` for `current_phase`. Resolve matching directory slug from `.workflow/phases/`. `--phase 0` forces null.

3. **Generate stable INS-id**: `INS-{8 lowercase hex}` from `hash(insightText + timestamp)`.

4. **Build lessons.jsonl row**:
```json
{
  "id": "INS-a3f7b2c1",
  "title": "<first 80 chars of insight>",
  "summary": "<full insight text>",
  "source": "manual",
  "lens": null,
  "category": "<inferred or explicit>",
  "tags": ["manual", "<user tags...>"],
  "phase": "<N or null>",
  "phase_slug": "<slug or null>",
  "confidence": "<high|medium|low>",
  "routed_to": null,
  "routed_id": null,
  "created_at": "<ISO>"
}
```

5. **Append to lessons.jsonl**:
```javascript
// Append single JSON line — Bash echo avoids rewriting the whole file
Bash(`echo '${JSON.stringify(insightRow)}' >> .workflow/learning/lessons.jsonl`)
```

6. **Update learning-index.json**: Read, push entry, write back:
```javascript
const index = JSON.parse(Read('.workflow/learning/learning-index.json'))
index.entries.push({ id: insightRow.id, title: insightRow.title, category: insightRow.category, tags: insightRow.tags, phase: insightRow.phase, created_at: insightRow.created_at })
Write('.workflow/learning/learning-index.json', JSON.stringify(index, null, 2) + '\n')
```

#### List Mode

Read `learning-index.json` entries array. Apply filters (`--tag`, `--category`, `--phase`, `--lens`). Sort newest-first. Display up to `--limit` rows (default 20):

```
ID              Category     Phase  Tags              Title
INS-a3f7b2c1   gotcha       3      manual,zod        Zod v4 breaks z.object().strict() API
INS-b1c2d3e4   pattern      2      manual            Always read state.json before planning
```

#### Search Mode

Grep across `lessons.jsonl` for the query string. Rank by field match weight: title (3) > tags (2) > summary (1). Display top matches with ID, category, phase, title.

#### Show Mode

Validate INS-id format `INS-[0-9a-f]{8}`. Find row in `lessons.jsonl` where `id` matches. Display full record with all fields. If `routed_to` is set, display the linked artifact path.

### Step 4: Display Confirmation

Capture mode:
```
=== INSIGHT CAPTURED ===
ID:         INS-a3f7b2c1
Category:   gotcha
Phase:      3 (phase-03-api-layer)
Confidence: medium
Tags:       manual, zod, typescript

Next: $manage-learn "list"  or  $manage-learn "search zod"
```
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `$maestro-init` first | parse_input |
| E002 | error | Unknown `--category` value | parse_input |
| E003 | error | `show` mode requires INS-id argument | show |
| E004 | error | INS-id not found in lessons.jsonl | show |
| W001 | warning | Auto-phase detection: current_phase found but no matching directory; phase set to null | capture |
| W002 | warning | `learning-index.json` row count differs from `lessons.jsonl`; offer to rebuild index | list/search |
</error_codes>

<success_criteria>
- [ ] Mode parsed correctly (capture, list, search, show)
- [ ] Learning store bootstrapped on first use
- [ ] Capture: category inferred from keywords, phase auto-linked, INS-id generated
- [ ] Capture: row appended to lessons.jsonl (append-only), index updated
- [ ] List: filters applied, newest-first, respects --limit
- [ ] Search: grep with weighted ranking across title/tags/summary
- [ ] Show: full record displayed for valid INS-id
- [ ] No LLM or CLI calls — pure file I/O only
</success_criteria>
