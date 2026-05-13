---
name: learn-decompose
description: Extract design patterns from code into specs and wiki
argument-hint: "<path|module> [--patterns <list>] [--save-spec] [--save-wiki]"
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
Systematic pattern extraction: analyze module across 4 dimensions using parallel agents, catalog findings with code anchors, persist to specs/wiki. Produces reusable pattern catalog.
</purpose>

<context>
$ARGUMENTS — target path/module and optional flags.

**Target resolution**: file path → that file; directory → all source files; module name → Glob `src/**/{module}*`.

**Flags**:
- `--patterns <list>`: Comma-separated pattern names to look for (default: detect all)
- `--save-spec`: `Skill("spec-add")` for each new pattern
- `--save-wiki`: create wiki note per dimension group

**Storage read**: target files + `coding-conventions.md` + `specs/learnings.md` (dedup)
**Storage write**: `.workflow/knowhow/KNW-decompose-{slug}-{date}.md` + append `specs/learnings.md`
</context>

<state_machine>

<states>
S_RESOLVE    — 解析 target 为具体文件列表                PERSIST: —
S_DEDUP      — 加载已有 patterns 用于去重                PERSIST: —
S_ANALYZE    — 4 维度并行 Agent 分析                     PERSIST: —
S_CROSSREF   — 交叉引用、去重、标记状态                   PERSIST: —
S_CATALOG    — 生成 pattern catalog 报告                  PERSIST: outputs
S_PERSIST    — 写文件 + 可选 spec-add/wiki create         PERSIST: knowhow files
</states>

<transitions>

S_RESOLVE:
  → S_DEDUP       WHEN: file list resolved
  → S_RESOLVE     WHEN: unresolvable                     DO: AskUserQuestion

S_DEDUP:
  → S_ANALYZE     DO: read coding-conventions.md + specs/learnings.md → build known pattern set

S_ANALYZE:
  → S_CROSSREF    DO: A_PARALLEL_DIMENSION_ANALYSIS

S_CROSSREF:
  → S_CATALOG     DO: A_CROSSREF_DEDUP

S_CATALOG:
  → S_PERSIST     DO: write KNW-decompose report (grouped by dimension: pattern table + details)

S_PERSIST:
  → END           DO: append specs/learnings.md [+ spec-add if --save-spec] [+ wiki note if --save-wiki]

</transitions>

<actions>

### A_PARALLEL_DIMENSION_ANALYSIS

Spawn 4 Agents in single message:

| Agent | Dimension | Looks for |
|-------|-----------|-----------|
| 1 | Structural | Class hierarchy, composition, DI/IoC, Factory/Builder/Singleton, barrel exports |
| 2 | Behavioral | Event flow, middleware chains, observer/pub-sub, command/strategy, state machines |
| 3 | Data | Repository/DAO, DTO pipelines, caching (memo/LRU/TTL), serialization, schema validation |
| 4 | Error | Error boundaries, retry/backoff/circuit-breaker, fallback chains, guard clauses, logging |

If `--patterns` specified: agents focus only on named patterns.

Each agent returns: `[{ name, dimension, confidence (high/medium/low), anchors [file:line], description, rationale, tradeoffs }]`

### A_CROSSREF_DEDUP

For each finding, match against known pattern set:
| Status | Condition |
|--------|-----------|
| documented | Already in coding-conventions.md |
| known | In specs/learnings.md |
| new | Not seen before |

Flag contradictions (finding conflicts with documented convention). Merge duplicates across agents (same pattern found by multiple dimensions).

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E002 | No source files in target | Check target has .ts/.js files |
| W001 | One+ dimension agent failed | Proceed with available dimensions |
| W003 | Large target (>50 files) | Consider --patterns filter |
</error_codes>

<success_criteria>
- [ ] 4 dimension agents spawned in parallel, findings with anchors
- [ ] Cross-reference: documented/known/new status assigned
- [ ] Pattern catalog written + specs/learnings.md appended
</success_criteria>

<next_step_routing>
- Follow-along → `/learn-follow <anchor-file>`
- Second opinion → `/learn-second-opinion <target>`
- Add to specs → `/spec-add coding ...`
</next_step_routing>
