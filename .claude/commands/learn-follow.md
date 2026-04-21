---
name: learn-follow
description: Guided follow-along reading of code or wiki entries, extracting patterns and building understanding
argument-hint: "<path|wiki-id|topic> [--depth shallow|deep] [--save-wiki]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Guided reading experience for code files, wiki entries, or topics. Instead of just reading code, this command walks through content section by section using forcing questions (inspired by gstack `/office-hours` brainstorming) to extract patterns, identify assumptions, and build a structured understanding map.

Outputs reading notes with extracted patterns, open questions, and connection points. Insights persist to `lessons.jsonl` and optionally become wiki note entries for the knowledge graph.
</purpose>

<context>
Arguments: $ARGUMENTS

**Target resolution (auto-detected from first argument):**
- File path (e.g., `src/commands/wiki.ts`) → Read source file
- Wiki ID (e.g., `spec-auth`, `phase-planning`) → Fetch via `maestro wiki get`
- Topic string (e.g., `"authentication flow"`) → Search via `maestro wiki search`, use top result

**Flags:**
- `--depth shallow` — Quick pass: key patterns and structure only (default)
- `--depth deep` — Thorough: every function, every branch, every assumption
- `--save-wiki` — Create a wiki note entry with the reading notes via `maestro wiki create --type note`

**Storage written:**
- `.workflow/learning/follow-{slug}-{YYYY-MM-DD}.md` — Reading notes with understanding map
- `.workflow/learning/lessons.jsonl` — Appended pattern/technique insights
- `.workflow/learning/learning-index.json` — Updated index
- If `--save-wiki`: new wiki note entry

**Storage read:**
- Target source file or wiki entry
- `maestro wiki backlinks <id>` / `maestro wiki forward <id>` — Relationship context
- `.workflow/specs/coding-conventions.md` — Convention reference for pattern matching
- `.workflow/learning/lessons.jsonl` — Prior insights for dedup and cross-reference
</context>

<execution>

### Stage 1: Resolve Target
- If argument looks like a file path (contains `/` or `\`, or matches a glob): verify file exists via Read
- If argument matches wiki ID pattern (`<type>-<slug>`): fetch via `maestro wiki get <id>` (offline mode)
- Otherwise: treat as topic string, run `maestro wiki search "<topic>"`, take the top result. If no result, fall back to Grep across `src/` for the topic.
- If target cannot be resolved, AskUserQuestion with suggestions.

### Stage 2: Load Context Web
For the resolved target, build a 1-hop context neighborhood:

**If wiki entry:**
- `maestro wiki forward <id>` — What this entry references
- `maestro wiki backlinks <id>` — What references this entry
- Read the body of top 3 related entries for context

**If code file:**
- Parse imports/requires to identify dependency files
- Grep for exports used by other files (reverse dependencies)
- Read the first 50 lines of top 3 dependent files for context

**If directory:**
- List files, identify entry points (index.ts, main.ts, cli.ts)
- Build reading order: entry point → core modules → utilities → tests

### Stage 3: Build Reading Order
- For a single file: split into logical sections (function boundaries, class boundaries, export groups)
- For a wiki entry: split by markdown headings
- For a directory: order files by dependency (entry points first, leaf modules last)
- For `--depth shallow`: limit to top-level structure (function signatures, section headers)
- For `--depth deep`: include every function body, every branch

### Stage 4: Guided Reading with Forcing Questions
Walk through each section in reading order. For each section, apply 4 forcing questions:

1. **"What pattern is being used here?"** — Identify design patterns, idioms, conventions. Compare against `coding-conventions.md`.
2. **"Why this approach instead of alternatives?"** — What trade-offs were made? What was the simpler approach not chosen?
3. **"What assumption does this depend on?"** — What must be true for this code/content to be correct? External state? Input shape? Ordering?
4. **"What would break if this changed?"** — Fragility analysis. What downstream effects would a change have?

Record answers as structured annotations per section.

### Stage 5: Extract Patterns
From the forcing question answers, extract:
- **Design patterns**: named patterns with code anchors (file:line)
- **Naming conventions**: how things are named and why
- **Error handling approach**: how errors flow through this code/content
- **Data flow**: how data enters, transforms, and exits
- **Assumptions**: explicit and implicit assumptions identified

Cross-reference each pattern against existing `coding-conventions.md` entries:
- Already documented → note as "confirmed convention"
- Not documented → flag as "undocumented pattern" (candidate for `spec-add`)

### Stage 6: Produce Understanding Map
Build a structured summary document:

```markdown
# Follow-Along: {target name}

## Key Concepts
- {concept}: {one-line explanation}

## Patterns Identified
| Pattern | Location | Convention Status |
|---------|----------|-------------------|
| {name} | {file:line} | documented / undocumented |

## Assumptions
- {assumption}: {what depends on it}

## Open Questions
- {question}: {why it matters}

## Connections
- Links to: {forward link entries}
- Referenced by: {backlink entries}
- Related lessons: {matching lessons.jsonl entries}
```

### Stage 7: Persist
1. Write `.workflow/learning/follow-{slug}-{date}.md` with the understanding map
2. Append each new pattern/technique as an insight to `lessons.jsonl`:
   - `source: "follow"`, `category: "pattern"` or `"technique"`
   - Tags: `["follow", "{target-slug}"]`
   - Stable INS-id from `hash("follow" + target + pattern_name)`
3. Update `learning-index.json`
4. If `--save-wiki`: run `maestro wiki create --type note --slug follow-{slug} --title "Follow-Along: {target}" --body-file .workflow/learning/follow-{slug}-{date}.md`
5. Display summary with key findings and next steps

**Next-step routing:**
- Deep dive into a discovered pattern → `/learn-decompose <path>`
- Add undocumented pattern to specs → `/spec-add coding <description>`
- Get second opinion on a finding → `/learn-second-opinion <file>`
- Browse related wiki entries → `/wiki-digest <topic>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target not resolvable (file not found, wiki ID not found, search returned 0) | Check path/ID, or rephrase topic for search |
| E002 | error | `.workflow/` not initialized | Run `/maestro-init` first |
| W001 | warning | Wiki graph unavailable (no .workflow/ wiki entries) — skipping context web | Proceed with code-only context (imports/exports) |
| W002 | warning | coding-conventions.md not found — skipping convention comparison | Patterns flagged as "unknown convention status" |
| W003 | warning | Target is very large (>1000 lines) — auto-switching to shallow depth | Use --depth deep to override |
</error_codes>

<success_criteria>
- [ ] Target resolved to concrete content (file, wiki entry, or search result)
- [ ] Context web loaded (forward/backlinks for wiki, imports/exports for code)
- [ ] Reading order established (sections/files ordered logically)
- [ ] All 4 forcing questions applied per section
- [ ] Patterns extracted with file:line anchors
- [ ] Convention comparison performed against coding-conventions.md
- [ ] Understanding map produced with: concepts, patterns, assumptions, questions, connections
- [ ] `follow-{slug}-{date}.md` written
- [ ] `lessons.jsonl` appended with discovered patterns (stable INS-ids)
- [ ] `learning-index.json` updated
- [ ] If --save-wiki: wiki note entry created
- [ ] No files modified outside `.workflow/learning/` (and optionally wiki)
- [ ] Summary displayed with next-step routing
</success_criteria>
