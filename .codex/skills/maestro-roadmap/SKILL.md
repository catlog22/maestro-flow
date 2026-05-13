---
name: maestro-roadmap
description: Generate roadmap from requirements (light or full mode)
argument-hint: "\"<requirements>\" [--mode light|full] [-y|--yes] [-c] [--phases N] [--skip-research] [--from-brainstorm SESSION-ID] [--revise [instructions]] [--review]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Unified 2-wave roadmap generation using `spawn_agents_on_csv` with dual modes:

- **Light** (default): Wave 1 parallel analysis (scope, risk, dependency). Wave 2 assembly -> roadmap.md.
- **Full** (`--mode full`): Wave 1 parallel research (domain, competitive, tech stack). Wave 2 synthesis -> 7-phase spec chain + roadmap.md.

Additional: `--revise` (modify existing roadmap), `--review` (read-only health check).
</purpose>

<context>
$ARGUMENTS -- requirement/idea text or @file reference, plus optional flags.

**Flags**:
- `--mode light|full`: Execution mode (default: light)
- `-y, --yes`: Skip all confirmations
- `-m progressive|direct|auto`: Decomposition strategy (default: auto, light only)
- `--phases N`: Target phase count (light only)
- `--revise [instructions]`: Revise existing roadmap preserving completed phases (light only)
- `--review`: Read-only roadmap health assessment (light only)
- `--skip-research`: Skip Wave 1, jump to doc generation (full only)
- `--from-brainstorm SESSION-ID`: Import guidance-specification.md as seed

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-roadmap[-full]-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md, `.workflow/roadmap.md`
**Full mode additional**: Spec package in `.workflow/.spec/SPEC-{slug}-{date}/`
</context>

<csv_schema>

### tasks.csv -- Light Mode

```csv
id,title,description,analysis_focus,deps,context_from,wave,status,findings,error
"1","Scope Analysis","Identify features, MVP boundaries, must-have vs nice-to-have, size estimates.","scope","","","1","","",""
"2","Risk Analysis","Technical/project risks, unknowns, feasibility, risk levels, mitigations.","risk","","","1","","",""
"3","Dependency Analysis","Feature dependencies, ordering constraints, parallel-safe groups, external deps.","dependency","","","1","","",""
"4","Roadmap Assembly","Synthesize findings into roadmap.md: phases, milestones, success criteria.","","1;2;3","1;2;3","2","","",""
```

### tasks.csv -- Full Mode

```csv
id,title,description,research_focus,doc_phase,deps,context_from,wave,status,findings,output_file,error
"1","Domain Research","Target users, market needs, existing solutions, terminology.","domain","","","","1","","","",""
"2","Competitive Analysis","Feature comparison, UX patterns, gaps, opportunities.","competitive","","","","1","","","",""
"3","Tech Stack Analysis","Languages, frameworks, databases, constraints, scalability.","tech_stack","","","","1","","","",""
"4","Document Chain","7-phase spec: Product Brief, PRD (REQ-*/NFR-*), Architecture (ADR-*), Data Model, API, UI Wireframes, Epic-to-Roadmap (EPIC-*). + glossary.json.","","1-7","1;2;3","1;2;3","2","","","",""
```

**Shared column semantics**:
- Input: id (unique string), title, description (detailed instructions), deps (semicolon-sep IDs), context_from (IDs whose findings needed), wave (1=analysis/research, 2=assembly/synthesis)
- Output: status (pending->completed/failed/skipped), findings (max 500 chars), error
- Light-only: analysis_focus (scope/risk/dependency)
- Full-only: research_focus (domain/competitive/tech_stack), doc_phase (1-7), output_file

Wave 1: 3 analysis/research rows (parallel). Wave 2: 1 assembly/synthesis row.
</csv_schema>

<invariants>
1. **Wave order sacred**: Never execute wave 2 before wave 1 completes
2. **CSV is source of truth**: Master tasks.csv holds all state
3. **Context propagation**: prev_context from master CSV, not memory
4. **Discovery board append-only**: Never modify/delete discoveries.ndjson
5. **Graceful degradation**: Wave 1 fails -> Wave 2 proceeds with seed input only
</invariants>

<state_machine>

<states>
S_PARSE      -- 解析参数、检测 mode/operation              PERSIST: --
S_INPUT      -- 解析输入（text/@file/brainstorm）          PERSIST: --
S_CSV_GEN    -- 生成 tasks.csv                              PERSIST: tasks.csv
S_WAVE_1     -- Analysis/Research (parallel spawn)           PERSIST: findings + tasks.csv
S_WAVE_2     -- Assembly/Synthesis (single agent spawn)      PERSIST: roadmap.md [+ spec package]
S_SPEC_GEN   -- Spec package generation (full mode only)     PERSIST: .workflow/.spec/SPEC-*/
S_AGGREGATE  -- 精炼、评估、输出                            PERSIST: context.md + .workflow/roadmap.md
</states>

<transitions>

S_PARSE:
  -> S_INPUT        WHEN: create mode (default)
  -> REVISE_FLOW    WHEN: --revise (load roadmap.md, apply changes, preserve completed phases)
  -> REVIEW_FLOW    WHEN: --review (read-only health assessment)

S_INPUT:
  -> S_CSV_GEN      DO: parse requirement (text/@file), import brainstorm if --from-brainstorm, codebase detection, load specs

S_CSV_GEN:
  -> S_WAVE_1       WHEN: normal pipeline     DO: generate mode-specific CSV
  -> S_WAVE_2       WHEN: --skip-research     DO: generate wave 2 only

S_WAVE_1:
  -> S_WAVE_2       DO: A_SPAWN_WAVE_1

S_WAVE_2:
  -> S_SPEC_GEN     WHEN: full mode           DO: A_SPAWN_WAVE_2
  -> S_AGGREGATE    WHEN: light mode           DO: A_SPAWN_WAVE_2

S_SPEC_GEN:
  -> S_AGGREGATE    DO: generate 7-phase spec package per spec-generate.md

S_AGGREGATE:
  -> END            DO: A_AGGREGATE_RESULTS

</transitions>

<actions>

### A_SPAWN_WAVE_1

Filter wave==1 -> write wave-1.csv -> `spawn_agents_on_csv`.

**Light mode agents**: scope analysis (feature inventory + priority), risk analysis (unknowns + mitigations), dependency analysis (dependency graph + critical path).
**Full mode agents**: domain research (users, market, solutions), competitive analysis (feature matrix, gaps), tech stack analysis (feasibility, constraints).

Merge results -> master tasks.csv.

### A_SPAWN_WAVE_2

Build prev_context from wave 1. Inject strategy + --phases constraint (light mode). Spawn.

**Light mode**: Assembly agent produces roadmap.md with phases (goal, depends-on, requirements, success criteria), milestones, scope decisions.

**Strategy selection** via uncertainty assessment (5 factors):
| Factor | Low | Medium | High |
|--------|-----|--------|------|
| Scope clarity | explicit | some ambiguity | vague/open-ended |
| Technical risk | proven stack | some unknowns | new technology |
| Dependency unknown | all mapped | some unclear | many external |
| Domain familiarity | expert | moderate | new domain |
| Requirement stability | locked | some flux | evolving |

>=3 high -> progressive, >=3 low -> direct, else -> ask (or auto if -y).
**Full mode**: Document chain agent produces 7-phase spec package + glossary.json.

### A_AGGREGATE_RESULTS

1. Export results.csv
2. Interactive refinement (max 3 rounds, skip if -y): Approve / Refine / Regenerate
3. **Full mode readiness** (4 dimensions, 25% each): Completeness, Consistency, Traceability, Depth. Gate: >=80% pass, 60-79% review with caveats, <60% auto-fix attempt
4. Generate context.md (light: summary + analysis findings + roadmap stats; full: research findings + doc chain status + readiness scores)
5. Write .workflow/roadmap.md (both modes)
6. Write spec package to .workflow/.spec/SPEC-{slug}-{date}/ (full mode):
   ```
   SPEC-{slug}-{date}/
   +-- spec-config.json, product-brief.md, glossary.json, spec-summary.md
   +-- requirements/ (_index.md, REQ-NNN-{slug}.md, NFR-{type}-NNN-{slug}.md)
   +-- architecture/ (_index.md, ADR-NNN-{slug}.md)
   +-- epics/ (_index.md, EPIC-NNN-{slug}.md)
   +-- readiness-report.md
   ```
7. Update state.json milestones + current_milestone
8. Next-step routing: need analysis -> maestro-analyze; ready to plan -> maestro-plan; UI first -> maestro-ui-design; full mode setup -> maestro-init

</actions>

</state_machine>

<discovery_board>

| Type | Dedup Key | Data |
|------|-----------|------|
| scope_boundary | data.feature | {feature, inclusion, rationale} |
| risk_factor | data.name | {name, severity, probability, mitigation} |
| dependency_constraint | data.from+data.to | {from, to, type, strength} |
| domain_term | data.term | {term, definition, aliases} |
| competitor | data.name | {name, features[], gaps[]} |
| tech_constraint | data.name | {name, type, severity, mitigation} |

Protocol: read before analysis, append-only, dedup by type+key.
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| No requirement text provided | Abort: "Requirement text or @file required" |
| Brainstorm session not found | Abort with available sessions list |
| roadmap.md not found (--revise/--review) | Run maestro-roadmap first |
| All Wave 1 agents failed | Wave 2 in degraded mode (seed only) |
| Wave 2 agent failed (light) | Abort: "Roadmap generation failed" |
| Wave 2 agent failed (full) | Export partial output, log issues |
| Readiness < 60% (full) | Log issues, proceed with available output |
</error_codes>

<success_criteria>
- [ ] Wave 1 agents completed (analysis or research)
- [ ] Wave 2 produced output (roadmap.md + optional spec package)
- [ ] .workflow/roadmap.md written, state.json updated
- [ ] context.md generated
- [ ] Light: uncertainty assessed, strategy selected, phases with milestones + success criteria
- [ ] Full: spec package in .workflow/.spec/, readiness scored on 4 dimensions
</success_criteria>
</output>
