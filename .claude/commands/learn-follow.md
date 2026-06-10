---
name: learn-follow
description: Guided reading of code or wiki to extract patterns
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

**Storage read**: target file + wiki forward/backlinks + `coding-conventions.md` + `.workflow/specs/learnings.md` (dedup)
**Storage write**: `.workflow/knowhow/KNW-follow-{slug}-{date}.md` + append `.workflow/specs/learnings.md`
</context>

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
  → END           DO: write KNW-follow + append .workflow/specs/learnings.md [+ wiki note if --save-wiki]

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
