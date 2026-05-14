---
name: maestro-brainstorm
description: Brainstorm with auto pipeline or single-role analysis
argument-hint: "[topic] [-y|--yes] [-c|--concurrency N] [--continue] [--count N] [--skip-questions]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-role brainstorming via `spawn_agents_on_csv`. Diamond topology:
Wave 1 (guidance spec) → Wave 2 (parallel role analysis, 3-9 agents) → Wave 3 (synthesis + feature index).
</purpose>

<context>
$ARGUMENTS — topic text and optional flags.

**Flags**: `-y` (auto), `-c N` (concurrency, default 6), `--continue` (resume), `--count N` (roles, default 3 max 9), `--skip-questions`

**9 valid roles**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-brainstorm-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md, `.brainstorming/` (guidance-specification.md, feature-index.json, synthesis-changelog.md, feature-specs/, {role}/analysis*.md)
</context>

<csv_schema>
```csv
id,title,description,role,topic,guidance_spec,deps,context_from,wave,status,findings,analysis_file,error
"1","Guidance Spec","...","guidance-generator","<topic>","","","","1","","","",""
"2","System Architect","...","system-architect","<topic>","","1","1","2","","","",""
"3","UI Designer","...","ui-designer","<topic>","","1","1","2","","","",""
"4","Synthesis","...","synthesis","<topic>","","2;3","2;3","3","","","",""
```
Wave 1: 1 guidance row. Wave 2: N role rows (parallel). Wave 3: 1 synthesis row.
</csv_schema>

<invariants>
1. **Wave order sacred**: Guidance (W1) MUST complete before roles (W2)
2. **CSV source of truth**: Master tasks.csv holds all state
3. **Discovery board append-only**: Never modify/delete discoveries.ndjson
4. **Skip on failure**: Guidance fails → abort. All roles fail → skip synthesis.
5. **9 valid roles only**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert
6. **DO NOT STOP**: Continuous until all waves complete; only pause at [CHECKPOINT] (skipped with -y)
</invariants>

<state_machine>

<states>
S_PARSE      — 解析 topic、flags、mode                    PERSIST: —
S_ROLES      — 选择 roles（-y auto / interactive）        PERSIST: —
S_CSV_GEN    — 生成 tasks.csv                              PERSIST: tasks.csv
S_WAVE_1     — Guidance Spec (single agent)                PERSIST: guidance-specification.md
S_CHECK_1    — Checkpoint: 用户审阅 guidance（-y 跳过）    PERSIST: —
S_WAVE_2     — Role Analysis (parallel spawn)              PERSIST: role analyses
S_CHECK_2    — Checkpoint: 用户审阅 roles（-y 跳过）       PERSIST: —
S_WAVE_3     — Synthesis + Feature Index (single agent)    PERSIST: synthesis artifacts
S_AGGREGATE  — 生成报告、注册 artifact                     PERSIST: context.md + results.csv
</states>

<transitions>
S_PARSE → S_ROLES      DO: parse args, detect mode (phase/scratch), load specs
S_ROLES → S_CSV_GEN    DO: select roles (-y: auto top N; interactive: request_user_input)
S_CSV_GEN → S_WAVE_1   DO: generate tasks.csv (1 guidance + N roles + 1 synthesis)

S_WAVE_1 → S_CHECK_1   WHEN: completed    DO: spawn wave-1, merge results, read guidance-spec
S_WAVE_1 → END         WHEN: failed       DO: abort pipeline

S_CHECK_1 → S_WAVE_2   WHEN: -y OR user "Proceed"
S_CHECK_1 → S_CHECK_1  WHEN: user "Revise"    DO: edit guidance-spec, re-display
S_CHECK_1 → END        WHEN: user "Abort"

S_WAVE_2 → S_CHECK_2   DO: spawn wave-2 (parallel), merge results
S_WAVE_2 → S_WAVE_3    WHEN: all failed       DO: skip synthesis

S_CHECK_2 → S_WAVE_3   WHEN: -y OR user "Proceed"
S_CHECK_2 → S_WAVE_2   WHEN: user "Add Roles"  DO: add new role rows, spawn only new

S_WAVE_3 → S_AGGREGATE DO: spawn wave-3, merge results

S_AGGREGATE → END      DO: A_AGGREGATE
</transitions>

<actions>

### Wave agent responsibilities

**Guidance (W1)**: Analyze topic → extract 5-10 terms → define non-goals → decompose features (max 8, F-{3digit}) → RFC 2119 keywords → write guidance-specification.md

**Role (W2)**: Read guidance-spec → analyze through role lens → feature-point organization (analysis.md index + analysis-cross-cutting.md + per-feature analysis-F-{id}.md) or fallback single analysis.md. system-architect MUST include: Data Model, State Machine, Error Handling, Observability, Config Model.

**Synthesis (W3)**: Cross-role consensus/conflicts/unique → conflict tags [RESOLVED]/[SUGGESTED]/[UNRESOLVED] → feature-specs or synthesis-specification.md → feature-index.json + synthesis-changelog.md. Four-layer: Direct Reference → Structured Extraction → Conflict Distillation → Cross-Feature Annotation.

### A_AGGREGATE

1. Export results.csv
2. Generate context.md (summary, guidance, per-role findings, synthesis, feature index, next steps)
3. Confidence scoring: 5 dimensions (role_coverage, cross_role_consistency, feature_completeness, spec_quality, design_feasibility). Quality gate: >3 UNRESOLVED → warn.
4. Copy artifacts to target .brainstorming/
5. Next-step routing: UI features detected → maestro-ui-craft --chain build; else → maestro-analyze / maestro-plan / maestro-roadmap

</actions>
</state_machine>

<discovery_board>
| Type | Dedup Key | Data |
|------|-----------|------|
| terminology | term | {term, definition, aliases[], category} |
| non_goal | title | {title, rationale} |
| feature_candidate | id | {id, slug, description, roles[], priority} |
| role_insight | role+topic | {role, topic, insight, confidence} |
| cross_role_conflict | area | {area, roles[], positions[], resolution} |

Protocol: read before analysis, append-only, dedup by type+key.
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| Guidance agent failed | Abort pipeline (W2 depends on guidance) |
| All role agents failed | Skip synthesis, report partial |
| Synthesis failed | Use W2 results directly |
| Role count > 9 | Cap at 9 with warning |
</error_codes>

<success_criteria>
- [ ] 3 waves executed: guidance → parallel roles → synthesis
- [ ] guidance-specification.md + role analyses + synthesis artifacts produced
- [ ] feature-index.json + context.md generated
- [ ] discoveries.ndjson append-only throughout
- [ ] Confidence scored, conflict quality gate evaluated
</success_criteria>
