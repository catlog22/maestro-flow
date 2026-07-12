---
name: maestro-execute
description: 按 current-plan 的 DAG 与 waves 执行任务，并产出实现结果与本地自检
argument-hint: "[scope] [-y] [--task TASK-ID]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: plan, alias: current-plan, required: true, require_status: sealed }
  produces:
    - { path: outputs/execution.json, kind: execution, alias: current-execution, role: primary }
    - { path: outputs/task-results.json, kind: task-results, role: attachment }
    - { path: outputs/self-check.json, kind: self-check, role: evidence }
    - { path: outputs/change-manifest.json, kind: change-manifest, role: evidence }
session-mode: run
---

<run_mode>
**Session mode:** `run`. This block is MANDATORY and overrides legacy artifact-path examples below.

1. Before domain work, call `maestro run create maestro-execute -- $ARGUMENTS` and use the returned `run_id`, `run_dir`, and `upstream`.
2. Formal JSON/Markdown deliverables MUST be written under `{run_dir}/outputs/`; evidence goes to `{run_dir}/evidence/`; process narrative and handoff go to `{run_dir}/report.md`.
3. The model MUST NOT edit protocol JSON (`run.json`, `session.json`, `gates.json`, `artifacts.json`, `evidence.json`) or append to project `state.json.artifacts[]`.
4. Run `maestro run check {run_id}` before completion, repair blocking gaps, then run `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Any later reference to `scratch/`, hidden command session directories, `milestones/`, `phases/`, `context-package.json`, `understanding.md`, `evidence.ndjson`, or a secondary `status.json` is a legacy semantic label only. Map formal deliverables to `outputs/`, narrative to `report.md`, evidence attachments to `evidence/`, and orchestration state to the active Session/Run runtime. Never create the legacy formal path.
</run_mode>

<purpose>
消费 `current-plan`，按 DAG/waves 实施代码修改、收集每任务证据并完成 build/test smoke。正式 acceptance verification 已拆到独立 `maestro-verify` Run。
</purpose>

<invariants>
1. 命令自包含；只按 create 返回的 `current-plan` path 工作。
2. 遵守 task deps 与 collision report；同 wave 仅并行无写冲突任务。
3. 每任务最多 3 次：正常执行、聚焦重试、降级执行；仍失败则记录 blocked，禁止伪造完成。
4. Execute 只做实现与 self-check，不产出正式 verification verdict。
5. 只写源码变更与本次 Run 的领域产物，协议状态交由 CLI。
</invariants>

<execution>
1. **Create**：`maestro run create maestro-execute -- $ARGUMENTS`，随后 `maestro run check <run_id> --stage entry`；entry 必须解析到 sealed `current-plan`。
2. **领域工作**：读取 plan、task artifacts、waves、dependency graph 和 collision report；按 wave 执行。每个 task 记录 executor、attempt、files changed、commands/tests、criterion evidence 和 status。阻塞任务向下游传播 blocked refs。
3. 对完成任务执行 scoped test/build/lint；全局只做 smoke self-check。严禁把 self-check 当独立 verify 的 acceptance 结论。
4. 写 `outputs/execution.json`：
   ```json
   {"_meta":{"kind":"execution","schema":"execution/1.0","role":"primary","alias":"current-execution"},"plan_ref":"current-plan","status":"completed|partial|blocked","waves":[],"completed_tasks":[],"blocked_tasks":[]}
   ```
5. 写 `outputs/task-results.json`、`outputs/self-check.json`、`outputs/change-manifest.json`，schemas 分别为 `task-results/1.0`、`self-check/1.0`、`change-manifest/1.0`。`self-check` 只记录 smoke；manifest 记录 repo-relative files、change type 与 task refs。
6. 写 `report.md` 固定骨架；frontmatter verdict 映射：全部任务成功为 `ready`，有非关键阻塞为 `ready_with_concerns`，关键依赖失败为 `blocked`。next 必须为：
   ```yaml
   next:
     - { command: maestro-verify, reason: implementation complete, required: [current-plan, current-execution] }
   ```
7. **Check**：`maestro run check <run_id> --stage exit`；核对计划任务与 task-results 一致、变更文件真实存在、无 TODO-only/stub、self-check 已运行、blocked 未被标 completed。
8. **Complete**：`maestro run complete <run_id>`；CLI 注册 `current-execution` 并 seal。不得内嵌正式 verify。
</execution>

<success_criteria>
- 计划执行状态与真实 diff 一致；task evidence 可追溯到 criteria。
- `execution.json`、`task-results.json`、`self-check.json`、`change-manifest.json` typed metadata 完整。
- handoff 明确路由独立 `maestro-verify`；exit check 与 complete 成功。
</success_criteria>
