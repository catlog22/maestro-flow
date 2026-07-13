---
name: maestro-roadmap
description: Generate milestone/phase roadmap from requirements or upstream context
argument-hint: '"<requirements>" [-m progressive|direct|auto] [-y|--yes] [-c]
  [--phases N] [--skip-research] [--from <source>] [--from-brainstorm
  SESSION-ID] [--revise [instructions]] [--review]'
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Generate a milestone/phase roadmap using `spawn_agents_on_csv` with 2-wave analysis:

Wave 1: parallel analysis (scope, risk, dependency). Wave 2: assembly -> roadmap.md with Milestone > Phase hierarchy.

Additional: `--revise` (modify existing roadmap), `--review` (read-only health check).
</purpose>

<context>
$ARGUMENTS -- requirement/idea text or @file reference, plus optional flags.

**Flags**:
- `-y, --yes`: Skip all confirmations
- `-m progressive|direct|auto`: Decomposition strategy (default: auto)
- `--phases N`: Target phase count
- `--revise [instructions]`: Revise existing roadmap preserving completed phases
- `--review`: Read-only roadmap health assessment
- `--from <source>`: Load upstream context package (brainstorm:ID, blueprint:BLP-xxx, analyze:ANL-xxx, @file, or path)
- `--from-brainstorm SESSION-ID`: (backward compat alias for `--from brainstorm:ID`)

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-roadmap-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md, `.workflow/roadmap.md`

### Pre-load (runs unconditionally, including -y auto mode)
1. **Architecture specs**: `maestro load --type spec --category arch` — load architecture constraints for phase decomposition
2. **Wiki search**: `maestro search "{requirement keywords}" --json` → prior knowledge for dependency and scope analysis
3. All optional — proceed without if unavailable (log warning)
</context>

<interview_protocol>
Interview the user relentlessly until shared understanding is reached. Active only in interactive mode; skip ONLY when `-y/--yes`, `--revise`, `--review`, or `-c` is set. Text requirements always require at least scope + strategy confirmation — never auto-classify input as "specific enough" to skip.

- One decision per turn via request_user_input with 2–4 options + a (Recommended) default. The user controls termination — keep interviewing until convergence; they can interrupt naturally at any time.
- Search-first when uncertain: before asking, resolve via `state.json`, existing `roadmap.md`, `project.md`, `maestro load --type spec`, `maestro search`, `maestro explore` (preferred, fallback Glob/Grep/Read). Never ask what code or memory can verify; never bounce your own ambiguity back to the user — search first, then ask only what truly needs human judgment.
- Writeback cadence: each settled decision is immediately appended/updated in the `Roadmap Decisions` section at the top of `.workflow/roadmap.md` (create the section if absent). Do NOT batch writeback to the end — partial decisions must already be on disk before the next question.
- Walk the decision dependency tree strictly: mode → requirement scope → decomposition strategy → phase dependencies/order. Do not open the next branch until the current one is settled.
- Scope guard: only decide the shape of the roadmap. Do not pre-resolve intra-phase task breakdown — that belongs to `plan`.

Decision points: scope (MVP / complete / phased) → strategy (progressive / direct / auto) → milestone boundaries → phase dependencies and order.

Exit: on consensus or explicit user signal to proceed, finalize the `Roadmap Decisions` section (rows already populated incrementally). Schema:
`| # | Decision | Choice | Source (user / code / default) |`
</interview_protocol>

<csv_schema>

### tasks.csv

```csv
id,title,description,analysis_focus,deps,context_from,wave,status,findings,error
"1","Scope Analysis","Identify features, MVP boundaries, must-have vs nice-to-have, size estimates.","scope","","","1","","",""
"2","Risk Analysis","Technical/project risks, unknowns, feasibility, risk levels, mitigations.","risk","","","1","","",""
"3","Dependency Analysis","Feature dependencies, ordering constraints, parallel-safe groups, external deps.","dependency","","","1","","",""
"4","Roadmap Assembly","Synthesize findings into roadmap.md: Milestone > Phase hierarchy, success criteria.","","1;2;3","1;2;3","2","","",""
```

**Column semantics**:
- Input: id (unique string), title, description (detailed instructions), analysis_focus (scope/risk/dependency), deps (semicolon-sep IDs), context_from (IDs whose findings needed), wave (1=analysis, 2=assembly)
- Output: status (pending->completed/failed/skipped), findings (max 500 chars), error

Wave 1: 3 analysis rows (parallel). Wave 2: 1 assembly row.
</csv_schema>

<invariants>
1. **Wave order sacred**: Never execute wave 2 before wave 1 completes
2. **CSV is source of truth**: Master tasks.csv holds all state
3. **Context propagation**: prev_context from master CSV, not memory
4. **Discovery board append-only**: Never modify/delete discoveries.ndjson
5. **Graceful degradation**: Wave 1 fails -> Wave 2 proceeds with seed input only. When degradation activates, flag downstream outputs as LOW CONFIDENCE. Record `degradation_event` in discoveries.ndjson. This is a defined degradation path, not a violation of invariant 6.
6. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation. Defined degradation paths (invariant 5) are not violations.
7. **Requirement mapping completeness** — every Active requirement from project.md MUST be mapped to exactly one phase. No circular dependencies in phase ordering.
8. **Artifact verification before completion** — .workflow/roadmap.md MUST exist with Milestone > Phase hierarchy and progress table. Artifact MUST be registered in state.json. If missing: DO NOT report completion.
9. **Milestone Locking**: If a milestone is marked as 'completed' or 'locked' in state.json, the roadmap generator MUST NOT modify its details or timeline in roadmap.md. Milestone generation/regeneration is restricted only to active or future milestones.
</invariants>

<state_machine>

<states>
S_PARSE      -- 解析参数、检测 operation                    PERSIST: --
S_INPUT      -- 解析输入（text/@file/upstream context）     PERSIST: --
S_CSV_GEN    -- 生成 tasks.csv                              PERSIST: tasks.csv
S_WAVE_1     -- Analysis (parallel spawn)                    PERSIST: findings + tasks.csv
S_WAVE_2     -- Assembly (single agent spawn)                PERSIST: roadmap.md
S_AGGREGATE  -- 精炼、评估、输出                            PERSIST: context.md + .workflow/roadmap.md
</states>

<transitions>

S_PARSE:
  -> S_INPUT        WHEN: create mode (default)
  -> S_REVISE       WHEN: --revise (load roadmap.md, apply changes, preserve completed phases)
  -> S_REVIEW       WHEN: --review (read-only health assessment)

S_REVISE:
  -> S_AGGREGATE    DO: A_REVISE — load .workflow/roadmap.md (E005 if missing), apply --revise instructions, preserve completed phases (status!="pending"), rewrite only pending phases, update state.json milestones

S_REVIEW:
  -> END            DO: A_REVIEW — load .workflow/roadmap.md (E005 if missing), read-only health assessment: phase coverage, dependency integrity, stale phases, progress %. Display report. No writes.

S_INPUT:
  -> S_CSV_GEN      DO: parse requirement (text/@file), load context-package.json if --from, codebase detection, load specs

S_CSV_GEN:
  -> S_WAVE_1       DO: generate analysis CSV

S_WAVE_1:
  -> S_WAVE_2       WHEN: 1+ completed    DO: A_SPAWN_WAVE_1. For failed analysis tasks: exclude from prev_context and append gap_note to W2 instruction listing missing angles.
  -> S_WAVE_1       WHEN: all failed, retry available   DO: retry once
  -> S_WAVE_2       WHEN: all failed, retry exhausted   DO: proceed with seed input only, flag LOW CONFIDENCE (invariant 5 degradation)

S_WAVE_2:
  -> S_AGGREGATE    WHEN: completed    DO: A_SPAWN_WAVE_2
  -> ERROR          WHEN: failed       DO: abort "Roadmap generation failed"

S_AGGREGATE:
  -> END            DO: A_AGGREGATE_RESULTS

</transitions>

<actions>

### Shared Spawn Contract (W1 and W2)

Every `spawn_agents_on_csv` call MUST filter `wave==N AND status=="pending"` and use this strict JSON Schema:

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "output_path":   { "type": "string", "description": "W2 only: absolute path of roadmap.md (empty for W1 agents that just return findings)" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

Merge: `result_status` → master `status`; copy `findings`, `output_path`, `error`.

**Shared termination contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed (W2: roadmap.md MUST exist on disk)
- Failure → result_status=failed with error message
- Blocked → upstream context insufficient → result_status=blocked
- Timeout → near max_runtime_seconds → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv (no recursion).
```

### A_SPAWN_WAVE_1

Filter `wave==1 AND status=="pending"` -> write wave-1.csv -> spawn.

**Agents**: scope analysis (feature inventory + priority), risk analysis (unknowns + mitigations), dependency analysis (dependency graph + critical path). Read-only.

Merge results -> master tasks.csv.

### A_SPAWN_WAVE_2

Filter `wave==2 AND status=="pending"`. Build prev_context from wave 1. Inject strategy + `--phases` constraint. Spawn.

Assembly agent produces roadmap.md with Milestone > Phase hierarchy (goal, depends-on, requirements, success criteria), scope decisions. Verifies roadmap.md on disk before reporting completed.

**Strategy selection** via uncertainty assessment (5 factors):
| Factor | Low | Medium | High |
|--------|-----|--------|------|
| Scope clarity | explicit | some ambiguity | vague/open-ended |
| Technical risk | proven stack | some unknowns | new technology |
| Dependency unknown | all mapped | some unclear | many external |
| Domain familiarity | expert | moderate | new domain |
| Requirement stability | locked | some flux | evolving |

>=3 high -> progressive, >=3 low -> direct, else -> ask (or auto if -y).

### A_AGGREGATE_RESULTS

1. Export results.csv
2. Interactive refinement (max 3 rounds, skip if -y): Approve / Refine / Regenerate
3. Generate context.md (summary + analysis findings + roadmap stats)
4. Write .workflow/roadmap.md with Milestone > Phase hierarchy
5. Update state.json milestones + current_milestone + register RDM artifact
6. **Generate context-package.json** (schema `context-package/1.0`):
   ```jsonc
   {
     "$schema": "context-package/1.0",
     "source": { "type": "roadmap", "artifact_id": "RDM-{id}", "session_path": "...", "generated_at": "..." },
     "requirements": [],       // from milestone phase goals → { id, title, acceptance }
     "constraints": [],         // from scope decisions → locked items
     "domain": {},              // inherit from upstream --from context-package if loaded
     "non_goals": [],           // deferred scope items
     "insights": [],            // from risk analysis and dependency findings
     "open_questions": [],      // unresolved scope areas
     "references": [{ "type": "roadmap", "path": "roadmap.md" }]
   }
   ```
   Register `context_package` path in RDM artifact entry so downstream `--from roadmap:ID` can resolve.
7. **Next-step suggestion** (suggest only, NEVER auto-execute): display the recommended next command. The user decides whether to proceed.
   - Need analysis → `maestro-analyze`
   - Ready to plan → `maestro-plan`
   - UI first → `maestro-impeccable build`
   - Need formal specs → `maestro-blueprint`

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
| Context source not found (--from / --from-brainstorm) | Abort with available sessions/sources list |
| roadmap.md not found (--revise/--review) | Run maestro-roadmap first |
| All Wave 1 agents failed | Wave 2 in degraded mode (seed only) |
| Wave 2 agent failed | Abort: "Roadmap generation failed" |
| Readiness < 60% | Log issues, proceed with available output |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decision table appended to `.workflow/roadmap.md` "Roadmap Decisions" section
- [ ] Wave 1 agents completed (analysis or research)
- [ ] Wave 2 produced output (roadmap.md)
- [ ] .workflow/roadmap.md written with Milestone > Phase hierarchy, state.json updated
- [ ] context.md generated
- [ ] Uncertainty assessed, strategy selected, milestones with phases + success criteria
- [ ] Artifact registered in state.json with milestone entries
- [ ] Ralph-invoked: `maestro ralph complete <idx> --status {STATUS}` called with correct verdict
</success_criteria>

<ralph_completion>
When invoked as a ralph session step, end by calling the CLI (no standalone report):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```
Status verdicts: **DONE** (normal), **DONE_WITH_CONCERNS** (caveats; pass `--concerns`), **NEEDS_RETRY** (transient error), **BLOCKED** (hard blocker; pass `--reason`).
</ralph_completion>
