---
name: maestro-analyze
description: Use when a topic needs structured multi-dimensional investigation before planning or decision-making
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] [--from <source>] \"<phase|topic> [-q|--quick] [--gaps [ISS-ID]]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-dimensional analysis using `spawn_agents_on_csv`. Diamond topology:
Wave 1 (CLI exploration, parallel) -> Wave 2 (6-dimension scoring, parallel) -> Wave 3 (decision synthesis).

**Tri-depth**: Full mode (all 3 waves), Quick mode (`-q`, Wave 3 only), Gaps mode (`--gaps`, issue root cause pipeline).

**Dual-layer scope (D-003)**:
- **Macro layer** (text argument, e.g. `analyze "auth refactor"`): broad impact exploration. Produces `scope_verdict ∈ {small, medium, large}` to drive downstream routing (roadmap vs plan).
- **Phase layer** (numeric argument, e.g. `analyze 1`): phase-scoped deep analysis under `current_milestone`. Milestone resolved via D-007 `phase_slugs` reverse lookup, NEVER direct `current_milestone` read.

Produces context-package.json (standardized cross-command context contract) in all modes.
</purpose>

<context>
$ARGUMENTS -- phase number, topic text, and optional flags.

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents per wave (default: 6)
- `--continue`: Resume existing session
- `-q, --quick`: Skip exploration + scoring, Wave 3 only
- `--gaps [ISS-ID]`: Issue root cause analysis. If ISS-ID: single issue. If omitted: all open/registered from issues.jsonl.
- `--from <source>`: Load upstream context package (brainstorm:ID, analyze:ID, @file, or path). Resolves to context-package.json for upstream context inheritance.

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-analyze-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md, context-package.json (all modes), analysis.md + conclusions.json (full mode AND quick mode; quick writes minimal conclusions.json with `scope_verdict` + `implementation_scope[]` only)
</context>

<interview_protocol>
Interview the user relentlessly until shared understanding is reached. Active only in interactive mode; skip when `-y/--yes`, `--continue`, or input is already specific (explicit phase number or unambiguous topic).

- One decision per turn via request_user_input with 2–4 options + a (Recommended) default. The user controls termination — keep interviewing until convergence; they can interrupt naturally at any time.
- Search-first when uncertain: before asking, resolve via `state.json`, `roadmap.md`, `issues.jsonl`, `maestro spec load`, `maestro search`, Grep, Read, or — for open-ended multi-file scans — `maestro delegate ... --role explore`. Never ask what code or memory can verify; never bounce your own ambiguity back to the user — search first, then ask only what truly needs human judgment.
- Writeback cadence: each settled decision is immediately appended/updated in `context.md` "Interview Decisions" (and mirrored into `analysis.md` in full mode). Do NOT batch writeback to the end — partial decisions must already be on disk before the next question.
- Walk the decision dependency tree strictly: scope → depth → dimensions → Go/No-Go threshold. Do not open the next branch until the current one is settled.
- Scope guard: only ask about decisions owned by `analyze`. Do not prejudge plan/execute concerns.

Decision points: scope (phase / topic / milestone-wide / adhoc / --gaps) → depth (quick / standard / deep) → dimensions (which of the 6 to keep) → Go/No-Go threshold.

Exit: when all decision points are settled (or user explicitly signals to proceed), finalize session metadata. The decision table (populated incrementally during interview) uses this schema:
`| # | Decision | Choice | Source (user / code / default) |`
</interview_protocol>

<csv_schema>

### tasks.csv

```csv
id,title,description,dimension,analysis_type,deps,context_from,wave,status,findings,score,recommendations,error
"1","Explore: Architecture","Explore codebase for architecture patterns: module boundaries, dependency graph, design patterns. 3-layer: module discovery, structure tracing, code anchor extraction.","architecture","explore","","","1","","","","",""
"2","Explore: Implementation","Explore codebase for implementation patterns: code structure, error handling, type safety. Extract code anchors with file:line.","implementation","explore","","","1","","","","",""
"3","Explore: Performance","Explore codebase for performance: hot paths, resource utilization, concurrency, bottlenecks.","performance","explore","","","1","","","","",""
"4","Score: Feasibility","Score feasibility (0-100): technical difficulty, team capability, time estimate, tooling.","feasibility","score","1;2;3","1;2;3","2","","","","",""
"5","Score: Impact","Score impact (0-100): user value, business value, tech debt reduction, DX.","impact","score","1;2;3","1;2;3","2","","","","",""
"6","Score: Risk","Score risk (0-100): failure modes, security, scalability, regression.","risk","score","1;2;3","1;2;3","2","","","","",""
"7","Score: Complexity","Score complexity (0-100): integration points, dependencies, learning curve, testing.","complexity","score","1;2;3","1;2;3","2","","","","",""
"8","Score: Alignment","Score alignment (0-100): project vision, roadmap consistency, architecture principles.","alignment","score","1;2;3","1;2;3","2","","","","",""
"9","Score: Maintainability","Score maintainability (0-100): code clarity, docs, test coverage, refactoring safety.","maintainability","score","1;2;3","1;2;3","2","","","","",""
"10","Decision Synthesis","Compile scores into analysis.md. Gray areas. Locked/Free/Deferred decisions for context.md. Go/No-Go + conclusions.json.","synthesis","decide","4;5;6;7;8;9","4;5;6;7;8;9","3","","","","",""
```

**Column semantics**:
- Input: id (unique string), title, description (detailed agent instructions), dimension (architecture/implementation/performance/feasibility/impact/risk/complexity/alignment/maintainability/synthesis), analysis_type (explore/score/decide), deps (semicolon-sep task IDs), context_from (IDs whose findings this task needs), wave (1=explore, 2=score, 3=decide)
- Output: status (pending->completed/failed/skipped), findings (key summary, max 500 chars), score (0-100 for scoring tasks, empty for explore/decide), recommendations, confidence_score (0-100 per dimension), error

Wave 1: N exploration rows (parallel). Wave 2: 6 scoring rows (parallel). Wave 3: 1 synthesis row.
Quick mode: 1 synthesis row only. Gaps mode: 1 row per issue (W1) + 1 per group (W2).

Available exploration dimensions: architecture, implementation, performance, security, concept, comparison, decision, external_research.
</csv_schema>

<invariants>
1. **Wave order sacred**: Never execute wave N+1 before wave N completes
2. **CSV is source of truth**: Master tasks.csv holds all state
3. **Context propagation**: prev_context from master CSV, not memory
4. **Discovery board append-only**: Never modify/delete discoveries.ndjson
5. **Quick mode shortcut**: -q generates only wave 3 task
6. **Gaps mode pipeline**: --gaps follows: Load issues from issues.jsonl -> Classify & group by location/component -> CSV gen (W1: 1 explore row per issue, W2: 1 synthesis per group) -> Execute waves -> Write issue.analysis record per issue -> Append history `{ action: "analyzed", at: <ISO>, by: "maestro-analyze --gaps" }` -> Output context.md for plan --gaps
7. **Graceful degradation**: Missing exploration reduces scoring quality; missing scoring reduces synthesis quality
8. **Tri-output**: context.md + context-package.json always. analysis.md (full only) + conclusions.json (full + quick — quick writes minimal with `scope_verdict` + `implementation_scope[]`). Gaps mode writes to issues.jsonl + context.md + context-package.json
9. **D-007 milestone resolution**: numeric scope MUST reverse-lookup `state.json.milestones[].phase_slugs`. NEVER read `current_milestone` directly for phase-scoped artifact registration.
10. **scope_verdict mandatory** (D-003): macro/adhoc/standalone scopes MUST produce `scope_verdict ∈ {small, medium, large}` in conclusions.json. Drives downstream chain (roadmap vs plan).
11. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation. Do NOT bypass for "efficiency" or "clear intent" reasons.
12. **Evidence required on decisions** — every decision in context.md MUST cite evidence from Wave 1 exploration findings or Wave 2 scores. Decisions citing only orchestrator's manual file reading are flagged LOW CONFIDENCE.
13. **Degradation must be marked** — when graceful degradation (invariant 7) activates, ALL downstream outputs inherit a LOW CONFIDENCE flag. Record in discoveries.ndjson: `{ type: "degradation_event", data: { wave, failed_tasks, impact } }`.
</invariants>

<state_machine>

<states>
S_PARSE      -- 解析参数、确定 scope/depth/mode           PERSIST: --
S_CONTEXT    -- 加载先验上下文（project/roadmap/specs）   PERSIST: --
S_CSV_GEN    -- 生成 tasks.csv                            PERSIST: tasks.csv
S_WAVE_1     -- CLI Exploration (parallel spawn)           PERSIST: per-dimension findings + tasks.csv
S_WAVE_2     -- 6-Dimension Scoring (parallel spawn)       PERSIST: scores + tasks.csv
S_WAVE_3     -- Decision Synthesis (single agent spawn)    PERSIST: context.md + analysis.md + conclusions.json
S_AGGREGATE  -- 注册 artifact、输出摘要                    PERSIST: state.json + results.csv
</states>

<transitions>

S_PARSE:
  -> S_CONTEXT    WHEN: scope resolved (milestone/phase/macro/adhoc/standalone/gaps)
  -> ERROR(E001)  WHEN: no args and no roadmap

  **Scope routing** (text → macro layer, numeric → phase layer per D-003):
  | Condition | Scope | Layer | Slug |
  |-----------|-------|-------|------|
  | --gaps flag | gaps | — | ISS-ID slugified or "issue-gaps" |
  | Empty subject + milestone + roadmap | milestone | phase | milestone name slugified |
  | Empty subject, no roadmap | ERROR E001 | — | -- |
  | Numeric + milestone + roadmap | phase | phase | phase slug from roadmap |
  | Text subject + milestone | macro | macro | subject slugified (max 40) |
  | Text subject, no milestone | macro | macro | subject slugified (max 40) |

  **D-007 milestone reverse lookup** (numeric scope only):
  ```
  resolve_milestone(phase_number):
    for ms in state.json.milestones[]:
      if str(phase_number) in ms.phase_slugs: return ms.id
    return state.json.current_milestone   # fallback (standalone)
  ```
  Write resolved milestone into `session.milestone` and artifact registration; NEVER use `current_milestone` directly for phase-scoped runs.

S_CONTEXT:
  -> S_CSV_GEN    DO: load project.md, roadmap.md, state.json, prior artifacts, specs, upstream context-package (if --from)

S_CSV_GEN:
  -> S_WAVE_1     WHEN: full mode         DO: generate N explore + 6 score + 1 synthesis rows
  -> S_WAVE_3     WHEN: quick mode         DO: generate 1 synthesis row only
  -> S_WAVE_1     WHEN: gaps mode          DO: generate per-issue explore + per-group synthesis rows

S_WAVE_1:
  -> S_WAVE_2     WHEN: full mode, 1+ completed    DO: A_SPAWN_WAVE_1
  -> S_WAVE_3     WHEN: gaps mode, 1+ completed    DO: merge results
  -> ERROR        WHEN: all failed

S_WAVE_2:
  -> S_WAVE_3     DO: A_SPAWN_WAVE_2

S_WAVE_3:
  -> S_AGGREGATE  DO: A_SPAWN_WAVE_3

S_AGGREGATE:
  -> END          DO: A_AGGREGATE_RESULTS

</transitions>

<actions>

### Shared Spawn Contract (all three waves)

Every `spawn_agents_on_csv` call in this skill MUST use the strict JSON Schema below and the shared termination contract.

**Output Schema**:

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "score":         { "type": "string", "description": "0-100 (wave 2 scoring only)" },
    "evidence":      { "type": "string", "description": "Code refs file:line (wave 1/2)" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

Merge step: `result_status` → master `status`; copy `findings`, `score`, `evidence`, `error`.

**Termination contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed
- Failure → result_status=failed with error message
- Blocked → upstream missing → result_status=blocked
- Timeout → near max_runtime_seconds → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv (no recursion).
```

### A_SPAWN_WAVE_1

Filter `wave==1 AND status=="pending"` -> write wave-1.csv -> `spawn_agents_on_csv({ csv_path, id_column:"id", instruction: EXPLORATION_INSTRUCTION + SHARED_TERMINATION_CONTRACT, max_concurrency, max_runtime_seconds: 3600, output_csv_path, output_schema })`.

**Exploration agent** (3-layer per dimension):
1. Module Discovery (breadth): keyword search, relevant files, module boundaries
2. Structure Tracing (depth): top 3-5 files, call chains 2-3 levels, data flow
3. Code Anchor Extraction (detail): code snippet 20-50 lines with file:line per finding

Share via discovery board. Merge results -> master tasks.csv (map `result_status` → master `status`).

### A_SPAWN_WAVE_2

Filter `wave==2 AND status=="pending"` -> build prev_context from wave 1 findings -> write wave-2.csv -> spawn with `SCORING_INSTRUCTION + SHARED_TERMINATION_CONTRACT`.

**Scoring agent** (6 dimensions: feasibility, impact, risk, complexity, alignment, maintainability):
Score 0-100 with specific evidence (code refs from exploration). Each score MUST reference exploration findings.

Merge results -> master tasks.csv (map `result_status` → master `status`).

### A_SPAWN_WAVE_3

Filter `wave==3 AND status=="pending"` -> build prev_context from wave 2 scores (or project context for quick mode) -> spawn with `SYNTHESIS_INSTRUCTION + SHARED_TERMINATION_CONTRACT`.

**Synthesis agent**:
- Full mode: analysis.md (executive summary, per-dimension scores, risk matrix, Go/No-Go), context.md (Locked/Free/Deferred decisions), context-package.json, conclusions.json (with `scope_verdict` + `implementation_scope[]`)
- Quick mode: context.md + context-package.json + **minimal conclusions.json** (`scope_verdict` + `implementation_scope[]` only — seeds plan task generation per redesign §8.3)
- Gaps mode: per-issue analysis records -> issues.jsonl + context.md + context-package.json for plan --gaps

**`scope_verdict` evaluation** (D-003 §5.3, macro/standalone/adhoc scopes only):
| Verdict | Criteria |
|---------|----------|
| `large` | 3+ independent subsystems, OR hard dependencies requiring serialized verification points |
| `medium` | 1-2 subsystems, parallel-safe |
| `small` | Single file or few files, directly executable |

Write to `conclusions.json.scope_verdict` (all modes that produce conclusions); mirror into `context.md` and `context-package.json.source.scope_verdict`. Phase-scoped runs may omit (default null).

Gray area detection: domain-aware (things users SEE/CALL/RUN/READ), phase-specific (skip prior decided areas).

### A_AGGREGATE_RESULTS

1. Export results.csv
2. **Confidence scoring** (full mode): factors -- findings_depth(.30), evidence_strength(.25), coverage_breadth(.20), user_validation(.15), consistency(.10). Thresholds: <60% deeper, 60-80% optional, 80-95% converging, >95% converge.
3. Auto-create issues from Deferred items -> issues.jsonl
4. Spec enrichment: Locked decisions -> `maestro spec add arch "<title>" "<content>" --keywords <kw> --description "<summary>"`; code patterns -> `maestro spec add coding "<title>" "<content>" --keywords <kw> --description "<summary>"`
5. Register artifact in state.json (type: analyze, includes context_package field pointing to context-package.json)
6. Copy outputs to scratchDir, display summary
7. **Next-step routing** (D-003 §5.3 — macro scope uses `scope_verdict` for downstream chain selection):

   | Scope | Condition | Next |
   |-------|-----------|------|
   | Phase/Milestone | Go + UI work needed | `$maestro-impeccable build {target}` |
   | Phase/Milestone | Go + ready to plan | `$maestro-plan` or `$maestro-plan {phase}` |
   | Phase/Milestone | No-Go | `$maestro-brainstorm {topic}` |
   | Macro/Adhoc/Standalone | `scope_verdict == "large"` | `$maestro-roadmap --from analyze:{ANL_ID}` |
   | Macro/Adhoc/Standalone | `scope_verdict == "medium"` | `$maestro-plan --from analyze:{ANL_ID}` |
   | Macro/Adhoc/Standalone | `scope_verdict == "small"` | `$maestro-plan --from analyze:{ANL_ID}` |
   | Macro/Adhoc/Standalone | Need more exploration | `$maestro-analyze {topic} --continue` |
   | Gaps | Issues analyzed | `$maestro-plan --gaps` |
   | Gaps | Need more context | `$maestro-analyze --gaps {ISS-ID}` |

</actions>

### Artifact Verification (before S_AGGREGATE)

Before transitioning to S_AGGREGATE, verify ALL expected outputs exist:
```
FULL_MODE_REQUIRED = ["tasks.csv", "context.md", "context-package.json", "analysis.md", "conclusions.json"]
QUICK_MODE_REQUIRED = ["tasks.csv", "context.md", "context-package.json", "conclusions.json"]
GAPS_MODE_REQUIRED = ["tasks.csv", "context.md", "context-package.json"]
```
If any artifact is missing for the active mode: DO NOT proceed to S_AGGREGATE. Go back and produce the missing artifact.

</state_machine>

<discovery_board>

| Type | Dedup Key | Data |
|------|-----------|------|
| exploration_finding | data.file+data.line | {file, line, snippet, dimension, significance} |
| dimension_score | data.dimension | {dimension, score, evidence, confidence} |
| risk_item | data.description | {description, probability, impact, mitigation} |
| decision_candidate | data.area | {area, options[], recommendation, classification} |
| alternative | data.name | {name, description, pros[], cons[], fit_score} |

Protocol: read before analysis, append-only, dedup by type+key.
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| Subject argument missing (non-gaps) | Abort: "Analysis subject required" |
| --gaps but no issues found | Abort: "No open/registered issues" |
| --gaps ISS-ID not found | Abort: "Issue not found" |
| Phase directory not found | List available phases, abort |
| All exploration agents failed | Retry once. If still fails: proceed to scoring but flag ALL downstream decisions as LOW CONFIDENCE in discoveries.ndjson |
| All scoring agents failed | Retry once. If still fails: produce decision-only context.md but flag ALL decisions as LOW CONFIDENCE |
| Synthesis agent failed | Minimal context.md from raw scores/exploration |
| Continue mode: no session found | List available sessions |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decision table written to `context.md` "Interview Decisions" (mirrored into `analysis.md` in full mode)
- [ ] All waves executed in order (or skipped per mode)
- [ ] context.md produced (all modes); analysis.md (full mode); conclusions.json (full mode AND quick mode with at minimum `scope_verdict` + `implementation_scope[]`)
- [ ] context-package.json produced (all modes) with constraints, requirements, insights, open_questions
- [ ] `scope_verdict ∈ {small, medium, large}` written into conclusions.json + context.md (macro/adhoc/standalone scopes)
- [ ] D-007 milestone reverse lookup applied for numeric scope; `session.milestone` populated via `phase_slugs`, never via direct `current_milestone` read
- [ ] context.md contains all decisions classified as Locked/Free/Deferred
- [ ] Decision Recording Protocol applied to all decisions
- [ ] Confidence scored per dimension with factor-based model (full mode)
- [ ] Readiness gate checked before synthesis (wave 3)
- [ ] Pressure pass completed ≥ 1 time on highest-risk dimension before synthesis
- [ ] Deferred items auto-created as issues
- [ ] Scope creep redirected to Deferred section
- [ ] Artifact registered in state.json (includes context_package field)
- [ ] Upstream context loaded via `--from` when specified
- [ ] discoveries.ndjson append-only throughout
- [ ] Next step routed (plan for Go, brainstorm for No-Go, plan --gaps for Gaps)
- [ ] Session sealed via finish-work (archive.json written, optional spec/knowhow extraction)
</success_criteria>

<on_complete>
@~/.maestro/workflows/finish-work.md — SESSION_DIR=OUTPUT_DIR, SESSION_TYPE=analyze, SESSION_ID={artifact_id}, LINKED_MILESTONE={target_milestone or null}
</on_complete>
</output>
