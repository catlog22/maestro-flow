---
name: learn-follow
description: Guided follow-along reading of code or wiki entries. Section-by-section walk-through with 4 forcing questions, pattern extraction, and understanding map generation. Persists insights to lessons.jsonl.
argument-hint: "<path|wiki-id|topic> [--depth shallow|deep] [--save-wiki]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Guided reading experience for code files, wiki entries, or topics. Walks through content
section by section using 4 forcing questions to extract patterns, identify assumptions,
and build a structured understanding map. Insights persist to `lessons.jsonl`.

Unlike `learn-decompose` which is parallel pattern extraction, this is sequential
deep reading that builds understanding incrementally.
</purpose>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution (auto-detected):**
- File path → Read source file
- Wiki ID (`type-slug`) → Fetch via `maestro wiki get`
- Topic string → Search via `maestro wiki search`, use top result

**Flags:**
- `--depth shallow` — Key patterns and structure only (default)
- `--depth deep` — Every function, branch, assumption
- `--save-wiki` — Create wiki note with reading notes

**Output**: `.workflow/learning/follow-{slug}-{date}.md`
</context>

<execution>

### Stage 1: Resolve Target + Load Context Web
- File: verify exists, parse imports for dependency files
- Wiki ID: fetch + load forward/backlinks
- Topic: search wiki, take top result
- Build 1-hop context neighborhood (imports/exports or wiki links)

### Stage 2: Build Reading Order
- Single file: split into logical sections (function/class boundaries)
- Directory: entry point → core modules → utilities → tests
- `--depth shallow`: top-level structure only
- `--depth deep`: every function body, every branch

### Stage 3: Guided Reading (4 Forcing Questions per Section)
1. **"What pattern is being used here?"** — design patterns, idioms, conventions
2. **"Why this approach instead of alternatives?"** — trade-offs made
3. **"What assumption does this depend on?"** — external state, input shape, ordering
4. **"What would break if this changed?"** — fragility, downstream effects

### Stage 4: Extract Patterns + Produce Understanding Map
From forcing question answers, extract: design patterns (with file:line anchors), naming conventions, error handling approach, data flow, assumptions.

Cross-reference against `coding-conventions.md`: documented vs undocumented patterns.

### Stage 5: Persist
1. Write `follow-{slug}-{date}.md` with understanding map
2. Append new patterns to `lessons.jsonl` (source: "follow", stable INS-ids)
3. If `--save-wiki`: create wiki note entry

**Next steps:** `/learn-decompose <path>`, `/spec-add coding ...`, `/learn-second-opinion <file>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target not resolvable | Check path/ID or rephrase topic |
| W001 | warning | Wiki graph unavailable | Proceed with code-only context |
| W002 | warning | coding-conventions.md not found | Patterns flagged "unknown status" |
| W003 | warning | Large target (>1000 lines) | Auto-switch to shallow depth |
</error_codes>

<success_criteria>
- [ ] Target resolved to concrete content
- [ ] Context web loaded (imports/exports or wiki links)
- [ ] All 4 forcing questions applied per section
- [ ] Patterns extracted with file:line anchors
- [ ] Understanding map produced with concepts, patterns, assumptions, questions
- [ ] `follow-{slug}-{date}.md` written
- [ ] `lessons.jsonl` appended with stable INS-ids
</success_criteria>
