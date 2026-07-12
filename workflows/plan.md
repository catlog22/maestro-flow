<!-- session-mode: inherited -->
# Workflow: Plan Run

## Run Contract

```text
maestro run create maestro-plan
  consumes: current-analysis? | latest-debug? | current-blueprint?
domain pipeline
  produces: plan + tasks + waves + dependency graph + collision report
maestro run check <run_id> --stage exit
maestro run complete <run_id> → alias current-plan
```

领域工作只写本次 Run 的 typed outputs；协议索引由 complete 阶段派生。

## Pipeline

```text
RESOLVE → EXTRACT CONSTRAINTS → DECOMPOSE → BUILD DAG → FORM WAVES
        → DETECT COLLISIONS → PRESSURE CHECK → CONFIRM
```

1. create + entry check；只读取返回的 upstream typed paths。`--gaps` 优先使用 `latest-debug`，普通规划优先 `current-analysis`。
2. 提取 objective、requirements、acceptance criteria、locked/deferred constraints、risk 和 fix directions。
3. 每个任务必须有 id、description、requirement refs、deps、files、convergence criteria、verify methods。
4. 构建无环 DAG；按 ready-set 形成 waves；同 wave 有写冲突则串行化或拆分 ownership。
5. 写 `outputs/plan.json`（primary/current-plan）、`outputs/tasks/TASK-*.json`、`outputs/waves.json`、`outputs/dependency-graph.json`、`outputs/collision-report.json`；可选 `outputs/evidence/plan-check.json`。全部含 `_meta`。
6. `report.md` frontmatter 的 next 为 `maestro-execute`，required `[current-plan]`；正文用 aref，不复制任务统计。
7. exit check：DAG 无环、criteria 全覆盖、deps 全存在、collision 无 unresolved blocker、任务 metadata 完整。
8. complete 由 CLI 扫描注册 aliases 并 seal。

## Plan Quality Gate

- Coverage：每个 criterion 至少被一个 task 覆盖。
- Executability：每个 task 有明确文件范围和验证方法。
- Parallel safety：wave 内无未处理写碰撞。
- Traceability：plan→task→criterion 可双向追踪。
