---
name: maestro-plan
description: Plan phase execution with exploration and verification
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--dir <path>] [--gaps] [--spec SPEC-xxx] [--collab]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based planning via `spawn_agents_on_csv`. Wave 1 explores codebase in parallel across multiple angles, Wave 2 generates verified execution plan consuming all exploration findings.

Supports: Create (default), Revise (`--revise`), Check (`--check`), Gaps (`--gaps`).
</purpose>

<context>
$ARGUMENTS — phase number/text and optional flags.

**Flags**: `-y` (auto), `-c N` (concurrency, default 4), `--continue` (resume), `--dir <path>`, `--gaps` (issue-linked), `--spec SPEC-xxx`, `--collab`, `--revise`, `--check`

**Scope routing** (priority): --dir → from parent artifact; no args → milestone; digit → phase; text → adhoc/standalone.

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-plan-P{N}-{slug}/`
**Scratch**: `.workflow/scratch/{YYYYMMDD}-plan-P{N}-{slug}/` (.task/ subdir)

**Pre-load** (optional): context.md (prior analyze), conclusions.json, codebase ARCHITECTURE.md, `maestro wiki search`, `maestro spec load --category arch`, team preflight `maestro collab preflight`.
</context>

<csv_schema>
```csv
id,title,description,angle,deps,context_from,wave,status,findings,output_path,error
"1","Explore: Architecture","Map module boundaries and dependencies","architecture","","","1","","","",""
"2","Explore: Patterns","Find existing similar implementations","patterns","","","1","","","",""
"3","Explore: Tests","Map test infrastructure and conventions","tests","","","1","","","",""
"4","Generate Plan","Consume explorations, produce plan.json + TASK files","planning","1;2;3","1;2;3","2","","","",""
```
Wave 1: N exploration rows (parallel). Wave 2: 1 planning row (sequential).
</csv_schema>

<invariants>
1. **Wave order sacred**: Explorations (W1) before planning (W2)
2. **CSV source of truth**: Master tasks.csv holds all state
3. **Discovery board append-only**: Never modify/delete
4. **Skip on failure**: If all explorations fail, planner proceeds with available context
5. **DO NOT STOP**: Continuous until all waves complete
</invariants>

<state_machine>

<states>
S_PARSE       — 解析参数、确定 scope                       PERSIST: —
S_RESUME      — 恢复已有 session（--continue）              PERSIST: —
S_CONTEXT     — 加载上下文（context.md, specs, wiki）       PERSIST: —
S_CSV_GEN     — 确定探索角度、生成 tasks.csv                PERSIST: tasks.csv
S_WAVE_1      — Parallel Exploration (spawn)                PERSIST: discoveries.ndjson
S_WAVE_2      — Plan Generation (spawn single agent)        PERSIST: plan.json + .task/
S_CHECK       — Plan checking (max 3 iterations)            PERSIST: plan updates
S_CONFIRM     — 用户确认（-y 跳过）                         PERSIST: —
S_REGISTER    — 注册 PLN artifact、更新 index.json           PERSIST: state.json
</states>

<transitions>
S_PARSE → S_RESUME     WHEN: --continue
S_PARSE → S_CONTEXT    WHEN: phase/dir resolved
S_PARSE → ERROR        WHEN: no args and no roadmap

S_RESUME → S_WAVE_1    WHEN: W1 incomplete    DO: load session, resume
S_RESUME → S_WAVE_2    WHEN: W1 done, W2 pending
S_RESUME → S_CHECK     WHEN: W2 done, check pending

S_CONTEXT → S_CSV_GEN  DO: load context.md, conclusions.json, specs, wiki, codebase docs

S_CSV_GEN → S_WAVE_1   DO: determine exploration angles, generate tasks.csv, user validates (skip -y)

S_WAVE_1 → S_WAVE_2    DO: spawn parallel explorations, merge results, build prev_context

S_WAVE_2 → S_CHECK     DO: spawn planning agent, merge results

S_CHECK → S_CONFIRM    WHEN: plan passes or max 3 iterations    DO: A_PLAN_CHECK
S_CHECK → S_WAVE_2     WHEN: plan fails check, iterations < 3   DO: feed checker feedback back

S_CONFIRM → S_REGISTER WHEN: -y OR user confirms
S_CONFIRM → S_CSV_GEN  WHEN: user wants to modify
S_CONFIRM → END        WHEN: user cancels

S_REGISTER → END       DO: A_REGISTER
</transitions>

<actions>

### Exploration agent responsibilities (W1)
Each explores one angle: architecture (module boundaries, deps), patterns (similar implementations), tests (framework, conventions), risks (complexity, blockers). Reads files, maps dependencies, shares via discoveries.ndjson.

### Planning agent responsibilities (W2)
Consumes all exploration findings + context.md + specs. Produces:
- `plan.json`: summary, approach, task_ids, waves (with phase labels), confidence section
- `.task/TASK-*.json`: each with read_first[], convergence.criteria[] (grep-verifiable), concrete action/implementation
- Deep Work Rules: every task has read_first with file being modified + source of truth files

### A_PLAN_CHECK
Run plan-checker: coverage, dependency validity, criteria quality, pressure pass on highest-complexity task.
Confidence: 5-dimension factor model + readiness gate.
Collision detection against same-milestone plans.

### A_REGISTER
1. Register PLN artifact in state.json (scope, milestone, phase, depends_on)
2. Update index.json with plan metadata
3. If --gaps: link TASK files back to issues bidirectionally (task_refs[], task_plan_dir in issues.jsonl)
4. Display: phase, task count, wave count, check status, confidence, next steps

</actions>
</state_machine>

<discovery_board>
| Type | Dedup Key | Data |
|------|-----------|------|
| existing_pattern | name | {name, file, description, usage} |
| dependency_map | module | {module, imports[], exports[], dependents[]} |
| risk_factor | risk | {risk, severity, mitigation, affected_files[]} |
| convention | singleton | {naming, imports, formatting} |
| test_command | command | {command, scope, framework} |
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| No args and no roadmap | Provide phase number or topic |
| --gaps but no gap source | Run maestro-verify first |
| Planning agent fails | Retry once with simplified context |
| Plan-checker exceeds 3 rounds | Accept with warnings |
</error_codes>

<success_criteria>
- [ ] Parallel explorations + sequential planning via spawn_agents_on_csv
- [ ] plan.json + TASK files with read_first and grep-verifiable convergence criteria
- [ ] Plan confidence scored, readiness gate checked, collision detected
- [ ] PLN artifact registered, issues linked if --gaps
</success_criteria>
