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

Verify `.workflow/` exists (E001 if not). If `.workflow/learning/lessons.jsonl` missing: create directory, empty `lessons.jsonl`, and initialize `learning-index.json` with `{"version":1,"entries":[]}`.

### Step 3: Execute Mode

#### Capture Mode

1. **Infer category** from keywords (no LLM):

| Keywords | Category |
|----------|----------|
| always, should, prefer, best practice | pattern |
| never, avoid, don't, pitfall, breaks | antipattern |
| decided, chose, tradeoff, because | decision |
| tool, library, framework, package | tool |
| gotcha, surprising, unexpected | gotcha |
| technique, approach, method | technique |

2. **Auto-link phase** from `state.json` artifact registry. `--phase 0` forces null.
3. **Generate INS-id**: `INS-{8 hex}` from `hash(insightText + timestamp)`.
4. **Build row** with fields: id, title (first 80 chars), summary, source="manual", lens=null, category, tags (includes "manual"), phase, phase_slug, confidence, routed_to=null, created_at.
5. **Append** JSON line to `lessons.jsonl` (append-only, never rewrite).
6. **Update** `learning-index.json`: push entry with id, title, category, tags, phase, created_at.

#### List Mode

Read `learning-index.json`, apply filters (`--tag`, `--category`, `--phase`, `--lens`), sort newest-first, display up to `--limit` rows (default 20) as table.

#### Search Mode

Grep `lessons.jsonl` for query. Rank by field weight: title (3) > tags (2) > summary (1). Display top matches.

#### Show Mode

Validate `INS-[0-9a-f]{8}` format. Find matching row, display full record. Show linked artifact if `routed_to` is set.

### Step 4: Display Confirmation

Capture mode: display ID, category, phase, confidence, tags, and next-step commands (`$manage-learn "list"`, `$manage-learn "search ..."`).
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `$maestro-init` first | parse_input |
| E002 | error | Unknown `--category` value | parse_input |
| E003 | error | `show` mode requires INS-id argument | show |
| E004 | error | INS-id not found in lessons.jsonl | show |
| W001 | warning | Auto-phase detection: no matching artifact directory found; phase set to null | capture |
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
