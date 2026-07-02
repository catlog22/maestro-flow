---
name: learn-follow
description: Guided reading of code or wiki to extract patterns
argument-hint: "<path|wiki-id|topic> [--depth shallow|deep] [--save-wiki] [-y]"
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
Guided reading: walk through content section-by-section using forcing questions to extract patterns, identify assumptions, and build an understanding map. Findings persist to `.workflow/specs/learnings.md` as `<spec-entry>` blocks.
</purpose>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution** (auto-detected):
| Input | Resolution |
|-------|-----------|
| File path (contains `/` or `\`) | Read source file |
| Wiki ID (`<type>-<slug>`) | `maestro wiki get <id>` |
| Topic string | `maestro search "<topic>"` → top result; fallback: Grep src/ |

**Flags**:
- `--depth shallow` (default): key patterns and structure only
- `--depth deep`: every function, every branch, every assumption
- `--save-wiki`: create wiki note entry with reading notes
- `-y`: Skip confirmation prompts for knowhow/spec writes

**Storage read**: target file + wiki forward/backlinks + `coding-conventions.md` + `.workflow/specs/learnings.md` (dedup)
**Storage write**: `.workflow/knowhow/KNW-follow-{slug}-{date}.md` + append `.workflow/specs/learnings.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-follow-{slug}-{date}.md` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only traversal** — NEVER modify source code or wiki entries under analysis; all writes go to `.workflow/` only
2. **Forcing questions mandatory** — each section MUST have all 4 forcing questions applied; NEVER skip questions even for trivial sections
3. **Anchor requirement** — every extracted pattern MUST include a `file:line` anchor; unanchored patterns SHALL NOT be persisted to learnings.md
4. **Convention cross-ref** — MUST check every finding against `coding-conventions.md` and mark status (documented/candidate); NEVER persist without status tag
5. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
6. **Confirmation gate** — unless `-y` is set, MUST present findings and target files via AskUserQuestion before any writes
7. **Depth contract** — `--depth shallow` MUST NOT descend into function bodies; `--depth deep` MUST cover every branch and sub-expression
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Resolve → Context Building** (S_RESOLVE → S_CONTEXT)
- REQUIRED: Target resolved to a readable source (file path, wiki entry, or search result).
- BLOCKED if: target unresolvable after user prompt (E001/E002).

**GATE 2: Reading → Extraction** (S_READ → S_EXTRACT)
- REQUIRED: All sections traversed with 4 forcing questions applied per section.
- REQUIRED: Depth contract honored — shallow stays at top-level, deep covers every branch.
- BLOCKED if: any section skipped without forcing questions.

**GATE 3: Extraction → Persistence** (S_EXTRACT → S_PERSIST)
- REQUIRED: All extracted patterns have file:line anchors.
- REQUIRED: Convention cross-ref completed against coding-conventions.md (or marked "unknown status" if W002).
- BLOCKED if: unanchored patterns remain in extraction results.

**GATE 4: Persistence → Completion** (S_PERSIST → END)
- REQUIRED: Unless `-y`, AskUserQuestion showing files to write and spec-entries to append — user must confirm.
- REQUIRED: KNW-follow-{slug}-{date}.md written with understanding map.
- REQUIRED: learnings.md appended (not overwritten) with new spec-entry blocks.
- BLOCKED if: user declines confirmation — offer to adjust findings before retry.

</execution>

<state_machine>

<states>
S_RESOLVE      — 解析 target (file/wiki/topic)              PERSIST: —
S_CONTEXT      — 构建 1-hop 上下文邻域                       PERSIST: —
S_ORDER        — 确定阅读顺序                                PERSIST: —
S_READ         — 逐节应用 forcing questions                   PERSIST: —
S_EXTRACT      — 提取 patterns、cross-ref conventions         PERSIST: —
S_PERSIST      — 写 understanding map + spec-entry 块         PERSIST: knowhow files
</states>

<transitions>

S_RESOLVE:
  → S_CONTEXT     WHEN: target resolved
  → S_RESOLVE     WHEN: unresolvable                       DO: AskUserQuestion with suggestions

S_CONTEXT:
  → S_ORDER       DO: A_BUILD_CONTEXT_WEB

S_ORDER:
  → S_READ        DO: A_BUILD_READING_ORDER

S_READ:
  → S_EXTRACT     DO: A_GUIDED_READ (apply 4 forcing questions per section)

S_EXTRACT:
  → S_PERSIST     DO: A_EXTRACT_PATTERNS

S_PERSIST:
  → END           GATE: unless -y, AskUserQuestion showing files to write and spec-entries to append — proceed only on confirm
                  DO: write KNW-follow + append .workflow/specs/learnings.md [+ wiki note if --save-wiki]

</transitions>

<actions>

### A_BUILD_CONTEXT_WEB

| Target type | Context |
|-------------|---------|
| Wiki entry | `maestro wiki forward <id>` + `maestro wiki backlinks <id>` → read top 3 related |
| Code file | Parse imports → dependency files; grep exports → reverse deps; read top 3 dependents (50 lines) |
| Directory | List files, identify entry points → build reading order: entry → core → utils → tests |

### A_BUILD_READING_ORDER

- Single file: split by function/class/export boundaries
- Wiki entry: split by markdown headings
- Directory: order by dependency (entry points first, leaf last)
- `--depth shallow`: top-level structure only; `--depth deep`: every body and branch

### A_GUIDED_READ

For each section, apply 4 forcing questions:

| # | Question | Extracts |
|---|----------|----------|
| 1 | "What pattern is being used here?" | Design patterns, idioms, conventions |
| 2 | "Why this approach instead of alternatives?" | Trade-offs, rejected options |
| 3 | "What assumption does this depend on?" | Implicit contracts, input shape, ordering |
| 4 | "What would break if this changed?" | Fragility, downstream effects |

### A_EXTRACT_PATTERNS

Extract: design patterns (with file:line anchors), naming conventions, error handling approach, data flow, assumptions.
Cross-ref against `coding-conventions.md`: documented → "confirmed convention", undocumented → "candidate for spec-add".

Write understanding map: Key Concepts, Patterns (table: name/location/convention status), Assumptions, Open Questions, Connections.

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No target path/wiki-id/topic provided | Prompt user for target |
| E002 | Target path not found and wiki/grep search returned no results | Check path or broaden search terms |
| W001 | Wiki forward/backlinks unavailable | Proceed without context web; note reduced coverage |
| W002 | coding-conventions.md not found | All patterns marked "unknown status" |
| W003 | Target > 1000 lines | Auto-switch to shallow; use --depth deep to override |
</error_codes>

<success_criteria>
- [ ] 4 forcing questions applied per section
- [ ] Patterns extracted with file:line anchors and convention cross-ref
- [ ] Understanding map + spec-entry blocks written
</success_criteria>

<next_step_routing>
- Deep pattern dive → `/learn-decompose <path>`
- Add to specs → `/spec-add coding <description>`
- Second opinion → `/learn-second-opinion <file>`
</next_step_routing>
