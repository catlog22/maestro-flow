<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Execute Run

## Run Contract

```text
maestro run create maestro-execute
  consumes: current-plan (required)
domain pipeline
  produces: execution, task-results, self-check, change-manifest
maestro run check <run_id> --stage exit
maestro run complete <run_id> → alias current-execution
```

Execute 不再包含正式 verification；只保留 task convergence 与 smoke self-check。

## Pipeline

```text
LOAD PLAN → READY SET → EXECUTE WAVE → TASK CHECK → MERGE RESULTS
          ↘ retry max 3 / blocked propagation ↗
          → SMOKE SELF-CHECK → HANDOFF VERIFY
```

1. create + entry check，读取 sealed `current-plan` 及 tasks/waves/dependency graph/collision report。
2. 每轮选择 deps 已完成的 ready tasks；仅并行无写冲突任务。
3. 单任务执行契约：先读现状→最小实现→运行 task verify→记录 files/commands/evidence。最多 3 次：正常、聚焦重试、降级执行；失败标 blocked。
4. blocked task 向依赖任务传播，未执行任务不得标 completed。
5. 写 `outputs/execution.json`（primary/current-execution）、`outputs/task-results.json`、`outputs/change-manifest.json`。
6. 对 completed changes 跑 build/test/lint smoke，写 `outputs/self-check.json`；它不是 acceptance verdict。
7. `report.md` frontmatter next 固定为 `maestro-verify`，required `[current-plan, current-execution]`。
8. exit check 对照 plan 与真实 diff，检查 stub/TODO-only、结果完整性与 blocked 传播；通过后 complete。

## Status Mapping

| Task/Run state | Meaning |
|---|---|
| completed | 实现与 task-level check 均通过 |
| partial | 部分非依赖链任务完成，存在 concerns |
| blocked | 关键 task 或其依赖无法完成 |
