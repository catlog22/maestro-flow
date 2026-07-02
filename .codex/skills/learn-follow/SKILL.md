---
name: learn-follow
description: Guided reading of code or wiki to extract patterns
argument-hint: "<path|wiki-id|topic> [--depth shallow|deep] [--save-wiki]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Guided reading experience for code files, wiki entries, or topics. Walks through content
section by section using 4 forcing questions to extract patterns, identify assumptions,
and build a structured understanding map. Insights persist to `.workflow/specs/learnings.md`.
</purpose>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution (auto-detected):**
- File path → Read source file
- Wiki ID (`type-slug`) → Fetch via `maestro wiki get`
- Topic string → Search via `maestro search`, use top result

**Flags:**
- `--depth shallow` — Key patterns and structure only (default)
- `--depth deep` — Every function, branch, assumption
- `--save-wiki` — Create wiki note with reading notes

**Output**: `.workflow/knowhow/KNW-follow-{slug}-{date}.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-follow-{slug}-{date}.md` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only traversal** — NEVER modify source code or wiki entries under analysis; all writes go to `.workflow/` only
2. **Forcing questions mandatory** — each section MUST have all 4 forcing questions applied; NEVER skip questions even for trivial sections
3. **Anchor requirement** — every extracted pattern MUST include a `file:line` anchor; unanchored patterns SHALL NOT be persisted to learnings.md
4. **Convention cross-ref** — MUST check every finding against `coding-conventions.md` and mark status (documented/candidate); NEVER persist without status tag
5. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
6. **Confirmation gate** — unless `-y` is set, MUST present findings and target files via `request_user_input` before any writes
7. **Depth contract** — `--depth shallow` MUST NOT descend into function bodies; `--depth deep` MUST cover every branch and sub-expression
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Resolve → Context Building**
- REQUIRED: Target resolved to a readable source (file path, wiki entry, or search result).
- BLOCKED if: target unresolvable after user prompt (E001).

**GATE 2: Reading → Extraction**
- REQUIRED: All sections traversed with 4 forcing questions applied per section.
- REQUIRED: Depth contract honored — shallow stays at top-level, deep covers every branch.
- BLOCKED if: any section skipped without forcing questions.

**GATE 3: Extraction → Persistence**
- REQUIRED: All extracted patterns have file:line anchors.
- REQUIRED: Convention cross-ref completed against coding-conventions.md (or marked "unknown status" if W002).
- BLOCKED if: unanchored patterns remain in extraction results.

**GATE 4: Persistence → Completion**
- REQUIRED: Unless `-y`, `request_user_input` showing files to write and spec-entries to append — user must confirm.
- REQUIRED: KNW-follow-{slug}-{date}.md written with understanding map.
- REQUIRED: learnings.md appended (not overwritten) with new spec-entry blocks.
- BLOCKED if: user declines confirmation — offer to adjust findings before retry.

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

### Stage 5: Persist (confirmation-gated)
1. Display understanding map summary to user
2. **Confirmation gate**: prompt user via `request_user_input` — "Save knowhow and specs? (y/n/edit)"
   - `y` → proceed to write
   - `n` → skip persistence, display summary only
   - `edit` → let user modify findings before writing
3. On confirmation: write `KNW-follow-{slug}-{date}.md` with understanding map
4. On confirmation: append new patterns to `.workflow/specs/learnings.md` (source: "follow", stable INS-ids)
5. If `--save-wiki`: create wiki note entry (also gated by step 2 confirmation)

**Next steps:** `$learn-decompose <path>`, `$spec-add coding ...`, `$learn-second-opinion <file>`
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
- [ ] User confirmation obtained before persistence
- [ ] `KNW-follow-{slug}-{date}.md` written (if confirmed)
- [ ] `.workflow/specs/learnings.md` appended with stable INS-ids (if confirmed)
</success_criteria>
