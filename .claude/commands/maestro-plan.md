---
name: maestro-plan
description: 将已确认分析或需求拆解为可执行 DAG、waves 与无冲突任务
argument-hint: "[scope] [--gaps] [-y]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: findings, alias: current-analysis, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
    - { kind: blueprint, alias: current-blueprint, required: false }
  produces:
    - { path: outputs/plan.json, kind: plan, alias: current-plan, role: primary }
    - { path: outputs/waves.json, kind: execution-waves, role: attachment }
    - { path: outputs/dependency-graph.json, kind: dependency-graph, role: evidence }
    - { path: outputs/collision-report.json, kind: collision-report, role: evidence }
session-mode: run
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
把 `$ARGUMENTS` 与上游 typed artifacts 转为任务 DAG。保留需求映射、依赖分析、wave 调度、文件碰撞检测、计划确认和 `--gaps` 修复规划语义。
</purpose>

<invariants>
1. 命令自包含；不得依赖其他 prompt 的隐式步骤。
2. 正式状态只由 Run CLI 管理；领域步骤不得直接维护协议状态。
3. 每个任务必须映射 acceptance/requirement refs，声明依赖、预期文件、验证方式与 convergence criteria。
4. JSON 产物由文件名推断 kind，`_meta` 可选覆盖（仅同 kind 多文件或非常规 schema 时使用）；任务文件位于 `{run_dir}/outputs/tasks/TASK-*.json`，同 kind 多文件需 `_meta` 覆盖。
</invariants>

<execution>
1. **Create**：`maestro run create maestro-plan -- $ARGUMENTS`。读取返回的 upstream paths；优先消费 `current-analysis`，`--gaps` 时消费 `latest-debug`。
2. **领域工作**：提取范围、locked/deferred constraints、requirements、风险和 fix directions；拆任务；构建依赖 DAG；按无依赖并行生成 waves；检测同 wave 文件写冲突并重排；执行 plan pressure check。
3. 写 `outputs/plan.json`：
   ```json
   {"objective":"","requirement_refs":[],"task_ids":[],"wave_ids":[],"confidence":0,"constraints":[],"acceptance_criteria":[]}
   ```
4. 每个任务写 `outputs/tasks/TASK-NNN.json`：
   ```json
   {"_meta":{"kind":"plan-task","schema":"plan-task/1.0","role":"attachment"},"id":"TASK-001","title":"","description":"","requirement_refs":[],"deps":[],"files":[],"convergence_criteria":[],"verify":[],"status":"pending"}
   ```
5. 写 `outputs/waves.json`、`outputs/dependency-graph.json`、`outputs/collision-report.json`，分别使用 schema `execution-waves/1.0`、`dependency-graph/1.0`、`collision-report/1.0`；若执行计划检查，写 `outputs/evidence/plan-check.json`，role 为 `evidence`。
6. 写 `report.md`，frontmatter 至少包含 `verdict`、`summary`、`constraints`、`decisions`、`concerns` 和：
   ```yaml
   next:
     - { command: maestro-execute, reason: plan ready, needs: [current-plan] }
   ```
   正文固定为 `摘要`、`结论/Verdict`、`讨论/复盘`、`产物`、`交接/Next`，使用 aref 引用 `current-plan`。
7. **Complete**：`maestro run complete <run_id>`。CLI 扫描 outputs、校验 exit gate、注册 `current-plan` 并 seal。
</execution>

<success_criteria>
- plan、tasks、waves、dependency graph、collision report 均为 typed artifacts。
- 内部 Plan FSM（理解→拆解→依赖→碰撞→确认）完整，所有 criteria 有 task refs。
- exit check 与 complete 通过，handoff 指向 `maestro-execute`。
</success_criteria>
