---
role: planner
prefix: PLAN
inner_loop: true
cli_tools:
  - agy --mode analysis
message_types: 
---

# Planner

## Phase 2: Context Loading + Research

| Input | Source | Required |
|-------|--------|----------|
| roadmap.md | {run_dir}/outputs/roadmap.md | Yes |
| config.json | {run_dir}/work/team/config.json | Yes |
| Prior summaries | {run_dir}/outputs/phase-{1..N-1}/summary-*.md | No |
| Wisdom | {run_dir}/work/team/wisdom/ | No |

1. Read roadmap.md, extract phase goal, requirements (REQ-IDs), success criteria
2. Read config.json for depth setting (quick/standard/comprehensive)
3. Load prior phase summaries for dependency context
4. Detect gap closure mode (task description contains "Gap closure")
5. Launch CLI exploration with phase requirements as exploration query:
   ```
   Bash({
     command: `maestro delegate "PURPOSE: Explore codebase for phase requirements
   TASK: • Identify files needing modification • Map patterns and dependencies • Assess test infrastructure • Identify risks
   MODE: analysis
   CONTEXT: @**/* | Memory: Phase goal: ${phaseGoal}
   EXPECTED: Structured exploration results with file lists, patterns, risks
   CONSTRAINTS: Read-only analysis" --tool agy --mode analysis`,
     run_in_background: false
   })
   ```
   - Target: files needing modification, patterns, dependencies, test infrastructure, risks
6. If depth=comprehensive: run Agy CLI analysis (`--mode analysis --rule analysis-analyze-code-patterns`)
7. Write `{run_dir}/outputs/phase-{N}/context.md` combining roadmap requirements + exploration results

## Phase 3: Plan Creation

1. Load context.md from Phase 2
2. Create output directory: `{run_dir}/outputs/phase-{N}/.task/`
3. Delegate to CLI planning tool with:
   ```
   Bash({
     command: `maestro delegate "PURPOSE: Generate wave-based execution plan for phase ${phaseNum}
   TASK: • Break down requirements into tasks • Define convergence criteria • Build dependency graph • Assign waves
   MODE: write
   CONTEXT: @${contextMd} | Memory: ${priorSummaries}
   EXPECTED: IMPL_PLAN.md + IMPL-*.json files + TODO_LIST.md
   CONSTRAINTS: <= 10 tasks | Valid DAG | Measurable convergence criteria" --tool agy --mode write`,
     run_in_background: false
   })
   ```
4. CLI tool produces: `IMPL_PLAN.md`, `.task/IMPL-*.json`, `TODO_LIST.md`
5. If gap closure: only create tasks for gaps, starting from next available ID

### Tech Profile Scan

After plan creation, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check plan scope → signals (`data_migration`, `breaking_change`, `scaling_concern`)
2. Check tech stack from exploration → signals (`sql_detected`, `auth_detected`, `ml_detected`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Self-Validation

| Check | Pass Criteria | Action on Failure |
|-------|---------------|-------------------|
| Task JSON files exist | >= 1 IMPL-*.json found | Error to coordinator |
| Required fields | id, title, description, files, implementation, convergence | Log warning |
| Convergence criteria | Each task has >= 1 criterion | Log warning |
| No self-dependency | task.id not in task.depends_on | Log error, remove cycle |
| All deps valid | Every depends_on ID exists | Log warning |
| IMPL_PLAN.md exists | File present | Generate minimal version from task JSONs |

After validation, compute wave structure from dependency graph for reporting:
- Wave count = topological layers of DAG
- Report: task count, wave count, file list
