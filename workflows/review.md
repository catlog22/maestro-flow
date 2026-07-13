<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Review Run

## Run Contract

```text
maestro run create quality-review
  consumes: current-execution + latest-verification?
domain pipeline
  produces: review-findings, spec-conflicts, issue-candidates
maestro run check <run_id> --stage exit
maestro run complete <run_id> → alias latest-review
```

Review 只读源码；领域结果只写 typed outputs 与 `report.md`。

## Pipeline

```text
RESOLVE CHANGES → SELECT LEVEL → LOAD SPECS → DIMENSION REVIEWS
                → DEDUP → DEEP-DIVE → VERDICT
```

1. create + entry check；从 current-execution/change manifest 获取真实 changed files。
2. level：quick 做核心 correctness/security；standard 做全维度并行；deep 强制调用链、边界和跨模块 deep-dive。
3. 维度：correctness、security、performance、maintainability、tests、architecture/spec consistency。
4. finding 必含 id、severity、file:line、evidence、impact、recommendation、criterion/spec refs；跨视角重复项合并并提升 confidence。
5. 写 `outputs/findings.json`（primary/latest-review）、`outputs/spec-conflicts.json`、`outputs/issue-candidates.json`，全部带 `_meta`。
6. verdict：critical=`block`；high/medium 非阻断=`warn`；无实质 finding=`pass`。
7. `report.md` pass/warn 路由 quality-test，block 路由 maestro-plan；用 aref 展示 findings。
8. exit check 覆盖全部 changed files、severity/verdict 一致、spec conflicts 分类完整；通过后 complete。
