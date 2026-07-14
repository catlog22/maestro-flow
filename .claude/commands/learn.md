---
name: learn
description: Understand code through guided reading, investigation, pattern extraction, or second opinions
argument-hint: "<subcommand> [args...] where subcommand = follow|investigate|decompose|consult"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: none
contract:
  discovery: self-described
  consumes: []
  produces: []
---
<purpose>
Learning toolkit for building understanding of code, decisions, and plans. Four subcommands:
- `follow` — guided section-by-section reading with forcing questions → understanding map
- `investigate` — hypothesis-driven scientific investigation of a question → evidence-backed report
- `decompose` — parallel multi-dimension pattern extraction → reusable pattern catalog
- `consult` — alternative perspectives via review / challenge / interactive Q&A

All findings persist to `.workflow/knowhow/` and append `<spec-entry>` blocks to `.workflow/specs/learnings.md`.
</purpose>

<routing>
$ARGUMENTS — parse first token as `<subcommand>`, remainder as that subcommand's args.

| Subcommand | Section |
|------------|---------|
| `follow`      | [Subcommand: follow](#subcommand-follow) |
| `investigate` | [Subcommand: investigate](#subcommand-investigate) |
| `decompose`   | [Subcommand: decompose](#subcommand-decompose) |
| `consult`     | [Subcommand: consult](#subcommand-consult) |

**Routing errors:**
| Code | Condition | Recovery |
|------|-----------|----------|
| E_NO_SUBCOMMAND | No subcommand provided in $ARGUMENTS | Display valid subcommands (follow, investigate, decompose, consult), prompt user to select |
| E_INVALID_SUBCOMMAND | Unrecognized first token | Display valid subcommands with usage hints |
</routing>

---

## Subcommand: follow

**Usage**: `/learn follow <path|wiki-id|topic> [--depth shallow|deep] [--save-wiki] [-y]`

<purpose>
Guided reading: walk through content section-by-section using forcing questions to extract patterns, identify assumptions, and build an understanding map. Findings persist to `.workflow/specs/learnings.md` as `<spec-entry>` blocks.
</purpose>

<context>
Arguments — target and optional flags.

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
Cross-ref against `coding-conventions.md`: documented → "confirmed convention", undocumented → "candidate for spec add".

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
- Deep pattern dive → `/learn decompose <path>`
- Add to specs → `/spec add coding <description>`
- Second opinion → `/learn consult <file>`
</next_step_routing>

---

## Subcommand: investigate

**Usage**: `/learn investigate <question> [--scope <path>] [--max-hypotheses N] [-y]`

<purpose>
Systematic investigation for understanding questions (not bug-fixing).
4-phase scientific method with scope lock, 3-strike escalation, and evidence persistence.
</purpose>

<context>
Arguments — question text and optional flags.

**Flags**:
- `--scope <path>`: Restrict to files under this dir (default: entire project)
- `--max-hypotheses N`: Max hypotheses before escalation (default: 3)
- `-y`: Skip confirmation prompts for report/spec writes

**Storage write**:
- `.workflow/knowhow/KNW-investigate-{slug}/evidence.ndjson` — structured evidence (one JSON line per item)
- `.workflow/knowhow/KNW-investigate-{slug}/understanding.md` — evolving understanding
- `.workflow/knowhow/KNW-investigate-{slug}/report.md` — final report
- `.workflow/specs/learnings.md` — appended `<spec-entry>` blocks

**Storage read**: source files in scope + `maestro search` + `.workflow/specs/learnings.md` + `debug-notes.md` + `codebase/architecture.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-investigate-{slug}/` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only investigation** — NEVER modify source code files; all writes go to `.workflow/` only
2. **Evidence append-only** — `evidence.ndjson` MUST be appended line-by-line; NEVER overwrite or truncate existing evidence entries
3. **Scope lock** — once `--scope` is resolved in S_FRAME, NEVER expand search scope without explicit user confirmation via S_ESCALATE
4. **Hypothesis cap** — MUST NOT generate more than `--max-hypotheses` (default 3) before triggering escalation; NEVER silently exceed the cap
5. **Structured evidence format** — every evidence entry MUST include `{ts, type, source, relevance, content, note}`; incomplete entries SHALL NOT be appended
6. **3-strike escalation** — after all hypotheses fail, MUST escalate to user via AskUserQuestion; NEVER silently conclude as INCONCLUSIVE without user interaction
7. **Confirmation gate** — unless `-y` is set, MUST present report.md path and spec-entries via AskUserQuestion before final writes
</invariants>

<state_machine>

<states>
S_FRAME          — 解析问题、确定 scope、搜索先验知识          PERSIST: understanding.md (initial)
S_EVIDENCE       — 系统收集证据                                PERSIST: evidence.ndjson
S_PATTERN        — 比对已知模式                                PERSIST: understanding.md (patterns)
S_HYPOTHESIZE    — 生成假设列表                                PERSIST: understanding.md (hypotheses)
S_CLI_EXPLORE    — CLI 辅助探索（可选）                         PERSIST: evidence.ndjson (append)
S_TEST           — 逐假设测试                                  PERSIST: evidence.ndjson + understanding.md
S_ESCALATE       — 3-strike 升级                               PERSIST: —
S_REPORT         — 综合报告 + persist                          PERSIST: report.md + .workflow/specs/learnings.md
</states>

<transitions>

S_FRAME:
  → S_EVIDENCE    DO: A_FRAME_QUESTION

S_EVIDENCE:
  → S_PATTERN     DO: A_COLLECT_EVIDENCE

S_PATTERN:
  → S_HYPOTHESIZE DO: match evidence against debug-notes.md + .workflow/specs/learnings.md patterns

S_HYPOTHESIZE:
  → S_CLI_EXPLORE WHEN: CLI tools enabled (at least one tool in cli-tools.json enabled) AND hypotheses non-trivial (require cross-file tracing or data-flow analysis)    DO: A_FORM_HYPOTHESES
  → S_TEST        WHEN: no CLI tools OR trivial hypotheses (answerable by local Grep/Read)    DO: A_FORM_HYPOTHESES

S_CLI_EXPLORE:
  → S_TEST        DO: A_CLI_SUPPLEMENT (maestro delegate --to <first-enabled-tool> --mode analysis, run_in_background, STOP)

S_TEST:
  → S_REPORT      WHEN: hypothesis confirmed                  DO: A_TEST_HYPOTHESIS
  → S_REPORT      WHEN: all hypotheses tested (some confirmed) DO: A_TEST_HYPOTHESIS
  → S_ESCALATE    WHEN: max_hypotheses all failed              DO: A_TEST_HYPOTHESIS

S_ESCALATE:
  → S_HYPOTHESIZE WHEN: user broadens scope or provides new hypothesis   DO: AskUserQuestion
  → S_REPORT      WHEN: user selects "Escalate" or still stuck          DO: mark INCONCLUSIVE

S_REPORT:
  → END           GATE: unless -y, AskUserQuestion showing report.md path and spec-entries to append — proceed only on confirm
                  DO: A_SYNTHESIZE_REPORT

</transitions>

<actions>

### A_FRAME_QUESTION

1. Parse question, generate slug, create KNW-investigate-{slug}/
2. Search prior knowledge: `maestro search "<question>"` + search .workflow/specs/learnings.md + read debug-notes.md
3. Write initial understanding.md (question, prior knowledge summary, scope, timestamp)

### A_COLLECT_EVIDENCE

Parallel evidence gathering:
1. Code search: Grep keywords from question
2. File inspection: Read most relevant files
3. Import tracing: follow dependency chain
4. Git history: `git log --oneline -10 -- <relevant-files>`

Each item → append evidence.ndjson: `{ts, type (code|git|search|doc), source (file:line), relevance (high|medium|low), content, note}`

### A_FORM_HYPOTHESES

Generate ranked hypotheses: each is specific, testable claim about "how/why".
Rank by plausibility (evidence strength). Write to understanding.md:
- `[HIGH]` hypothesis — Evidence: {refs}
- `[MEDIUM]` hypothesis — Evidence: {refs}

### A_CLI_SUPPLEMENT

```
maestro delegate "PURPOSE: Gather evidence for hypotheses
TASK: Trace call chains and data flows per hypothesis | Find corroborating/contradicting patterns
EXPECTED: JSON [{hypothesis_rank, evidence: [{file, line, supports: bool, explanation}]}]
" --to <first-enabled-tool> --mode analysis
```
Run_in_background, STOP, wait. On callback: append to evidence.ndjson.

### A_TEST_HYPOTHESIS

For each hypothesis (rank order):
1. Design test: what evidence would confirm/disprove?
2. Execute: code trace, targeted search, data inspection
3. Record: append evidence.ndjson with type: "test"
4. Update: mark hypothesis confirmed / disproved / inconclusive

### A_SYNTHESIZE_REPORT

Write report.md: Answer (or INCONCLUSIVE), Evidence Trail table, Hypotheses Tested table, Key Learnings, Open Questions.
Append to .workflow/specs/learnings.md: confirmed → roles="implement", disproved → roles="analyze" (gotcha).

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No question text provided | Prompt user for investigation question |
| E002 | --scope path not found | Check path |
| W001 | Prior knowledge search returned no results | Proceed without prior context; note cold-start |
| W002 | Very few evidence matches (<3) | Broaden search terms or expand scope |
| W003 | All hypotheses inconclusive | Investigation marked INCONCLUSIVE |
</error_codes>

<success_criteria>
- [ ] Evidence collected and logged to evidence.ndjson (structured NDJSON)
- [ ] At least 1 hypothesis formed and tested
- [ ] 3-strike escalation triggered if all fail
- [ ] Report + spec-entry blocks written
</success_criteria>

<next_step_routing>
- Save to specs → `/spec add debug <finding>`
- Follow code → `/learn follow <path>`
- Decompose patterns → `/learn decompose <module>`
</next_step_routing>

---

## Subcommand: decompose

**Usage**: `/learn decompose <path|module> [--patterns <list>] [--save-spec] [--save-wiki] [-y]`

<purpose>
Systematic pattern extraction: analyze module across 4 dimensions using parallel agents, catalog findings with code anchors, persist to specs/wiki. Produces reusable pattern catalog.
</purpose>

<context>
Arguments — target path/module and optional flags.

**Target resolution**: file path → that file; directory → all source files; module name → Glob `src/**/{module}*`.

**Flags**:
- `--patterns <list>`: Comma-separated pattern names to look for (default: detect all)
- `--save-spec`: `Skill("spec")` (add subcommand) for each new pattern
- `--save-wiki`: create wiki note per dimension group
- `-y`: Skip confirmation prompts for knowhow/spec writes

**Storage read**: target files + `coding-conventions.md` + `.workflow/specs/learnings.md` (dedup)
**Storage write**: `.workflow/knowhow/KNW-decompose-{slug}-{date}.md` + append `.workflow/specs/learnings.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-decompose-{slug}-{date}.md` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — NEVER modify source code files under analysis; all writes go to `.workflow/` only
2. **Evidence-anchored findings** — every pattern MUST include at least one `file:line` anchor from source; unanchored patterns SHALL NOT be persisted
3. **Dedup before persist** — MUST cross-reference against existing `learnings.md` and `coding-conventions.md` before writing; duplicate entries SHALL NOT be appended
4. **Parallel agent isolation** — each dimension agent operates independently; NEVER share state between agents during analysis
5. **Confirmation gate** — unless `-y` is set, MUST present all findings and target files via AskUserQuestion before any writes
6. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
</invariants>

<state_machine>

<states>
S_RESOLVE    — 解析 target 为具体文件列表                PERSIST: —
S_DEDUP      — 加载已有 patterns 用于去重                PERSIST: —
S_ANALYZE    — 4 维度并行 Agent 分析                     PERSIST: —
S_CROSSREF   — 交叉引用、去重、标记状态                   PERSIST: —
S_CATALOG    — 生成 pattern catalog 报告                  PERSIST: outputs
S_PERSIST    — 写文件 + 可选 spec add/wiki create         PERSIST: knowhow files
</states>

<transitions>

S_RESOLVE:
  → S_DEDUP       WHEN: file list resolved
  → S_RESOLVE     WHEN: unresolvable                     DO: AskUserQuestion

S_DEDUP:
  → S_ANALYZE     DO: read coding-conventions.md + .workflow/specs/learnings.md → build known pattern set

S_ANALYZE:
  → S_CROSSREF    DO: A_PARALLEL_DIMENSION_ANALYSIS

S_CROSSREF:
  → S_CATALOG     DO: A_CROSSREF_DEDUP

S_CATALOG:
  → S_PERSIST     DO: write KNW-decompose report (grouped by dimension: pattern table + details)

S_PERSIST:
  → END           GATE: unless -y, AskUserQuestion showing files to write and patterns to persist — proceed only on confirm
                  DO: append .workflow/specs/learnings.md [+ spec add if --save-spec] [+ wiki note if --save-wiki]

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
| known | In .workflow/specs/learnings.md (if file exists) |
| new | Not seen before (or learnings.md absent — treat all as new) |

Flag contradictions (finding conflicts with documented convention). Merge duplicates across agents (same pattern found by multiple dimensions).

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No target path/module provided | Prompt user for target |
| E002 | No source files in target | Check target has .ts/.js files |
| W001 | One+ dimension agent failed | Proceed with available dimensions |
| W002 | .workflow/specs/learnings.md missing or malformed | Treat all patterns as new; create file on persist |
| W003 | Large target (>50 files) | Consider --patterns filter |
</error_codes>

<success_criteria>
- [ ] 4 dimension agents spawned in parallel, findings with anchors
- [ ] Cross-reference: documented/known/new status assigned
- [ ] Pattern catalog written + .workflow/specs/learnings.md appended
</success_criteria>

<next_step_routing>
- Follow-along → `/learn follow <anchor-file>`
- Second opinion → `/learn consult <target>`
- Add to specs → `/spec add coding ...`
</next_step_routing>

---

## Subcommand: consult

**Usage**: `/learn consult <target> [--mode review|challenge|consult] [-y]`

<purpose>
Structured second-opinion on code, decisions, or plans via three modes: review (3 parallel agents),
challenge (adversarial), or consult (interactive Q&A). Findings persist to learnings.md.
</purpose>

<context>
Arguments — target and optional mode flag.

**Target resolution** (auto-detected):
| Input | Resolution |
|-------|-----------|
| File path | Read file content |
| Wiki ID (`<type>-<slug>`) | `maestro wiki get <id>` |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | Resolve the sealed plan artifact through the selected Session's ArtifactRegistry |

**Flags**:
- `--mode review|challenge|consult` (default: review)
- `-y`: Skip confirmation prompts for knowhow/spec writes

**Pre-load** (optional): `Skill("spec")` (load subcommand) for conventions + `maestro search "<target topic>"` for related entries.

**Output**: `.workflow/knowhow/KNW-opinion-{slug}-{YYYY-MM-DD}.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-opinion-{slug}-{YYYY-MM-DD}.md` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — NEVER modify source code, wiki entries, or plan files under review; all writes go to `.workflow/` only
2. **Agent independence** — in review mode, each of the 3 agents (Pragmatist/Purist/Strategist) MUST operate independently without shared state; NEVER pass one agent's findings to another
3. **Evidence-backed verdicts** — every finding MUST include a `location` reference (file:line or section); ungrounded opinions SHALL NOT appear in the report
4. **Mode contract** — MUST execute exactly the mode specified (review/challenge/consult); NEVER mix mode behaviors within a single execution
5. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
6. **Confirmation gate** — unless `-y` is set, MUST present findings and target files via AskUserQuestion before any writes
</invariants>

<state_machine>

<states>
S_RESOLVE    — 解析 target                          PERSIST: —
S_CONTEXT    — 加载 specs/wiki 上下文                PERSIST: —
S_EXECUTE    — 按 mode 执行分析                      PERSIST: —
S_SYNTHESIZE — 综合观点、生成报告                     PERSIST: outputs
S_PERSIST    — 写文件、append .workflow/specs/learnings.md      PERSIST: knowhow files
</states>

<transitions>

S_RESOLVE:
  → S_CONTEXT     WHEN: target resolved                DO: read target content
  → S_RESOLVE     WHEN: unresolvable                   DO: AskUserQuestion for clarification

S_CONTEXT:
  → S_EXECUTE     DO: load specs + wiki search (optional, proceed without)

S_EXECUTE:
  → S_SYNTHESIZE  WHEN: mode == review                 DO: A_REVIEW
  → S_SYNTHESIZE  WHEN: mode == challenge              DO: A_CHALLENGE
  → S_SYNTHESIZE  WHEN: mode == consult                DO: A_CONSULT

S_SYNTHESIZE:
  → S_PERSIST     DO: merge perspectives → agreements, disagreements, verdict, top 3 recommendations

S_PERSIST:
  → END           GATE: unless -y, AskUserQuestion showing files to write and spec-entries to append — proceed only on confirm
                  DO: write KNW-opinion + append <spec-entry> blocks to .workflow/specs/learnings.md

</transitions>

<actions>

### A_REVIEW
Spawn 3 Agents in single message:

| Agent | Focus | Question |
|-------|-------|----------|
| Pragmatist | simplicity, YAGNI, maintenance | "Simplest thing that works? Maintenance burden?" |
| Purist | correctness, edge cases, type safety | "What assumptions can be violated?" |
| Strategist | scalability, architecture alignment | "Supports future growth? Fits architecture?" |

Each returns: persona, verdict (approve/concern/reject), confidence, findings[{severity, description, location, suggestion}], summary.

### A_CHALLENGE
Spawn 1 adversarial Agent:
- Find weakest assumption
- Propose concrete breaking scenario
- Identify single biggest risk
- Suggest alternative approach
- Apply forcing questions: "What invalidates this?", "Simplest thing that breaks this?", "What would you regret in 6 months?", "What implicit contract isn't enforced?"

### A_CONSULT
Interactive loop:
1. Agent studies target
2. Display "Target loaded. What would you like to know?"
3. AskUserQuestion → Agent answers with code refs → repeat until "done"
4. Compile Q&A into report

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No target provided | Prompt user for target (path, wiki ID, HEAD, staged, or phase) |
| E002 | Unknown --mode value | Use: review, challenge, or consult |
| E003 | Target resolution failed — path not found, wiki ID invalid, or no staged changes | Check target exists |
| W001 | One review agent failed | Proceed with available perspectives |
| W002 | Specs/wiki pre-load unavailable | Proceed without convention context; note reduced coverage |
</error_codes>

<success_criteria>
- [ ] Mode executed: review (3 parallel agents) / challenge (adversarial) / consult (interactive Q&A)
- [ ] Synthesis with agreements, disagreements, verdict
- [ ] Report written + findings appended to .workflow/specs/learnings.md
</success_criteria>

<next_step_routing>
- Create issue → `/manage issue create <description>`
- Decompose patterns → `/learn decompose <path>`
- Follow code → `/learn follow <path>`
</next_step_routing>
