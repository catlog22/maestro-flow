<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Verify Run

## Run Contract

```text
maestro run create maestro-verify
  consumes: current-plan + current-execution
domain pipeline
  produces: verification, requirement-coverage, antipattern-report
maestro run check <run_id> --stage exit
maestro run complete <run_id> → alias latest-verification
```

Verify 是独立只读 Run，不在 execute 内嵌，不修源码。

## Pipeline

```text
RESOLVE CRITERIA → VERIFY EACH → COVERAGE AUDIT → ANTIPATTERN SCAN
                 → REGRESSION CHECK → VERDICT
```

1. create + entry check；读取 plan criteria、execution task results/self-check/change manifest。
2. 每条 criterion 按指定方法运行：test、grep、review 或 manual evidence；状态只能 passed/failed/blocked。
3. existence：期望文件存在；substance：不是 stub/TODO-only；convergence：行为符合 criterion；regression：相关测试通过。
4. 扫描 TODO/FIXME/HACK、disabled tests、debug logs、绕过验证和 silent fallback。
5. 写 `outputs/verification.json`（primary/latest-verification）、`outputs/requirement-coverage.json`、`outputs/antipattern-report.json`，均带 `_meta`。
6. verdict：全部 passed=`pass`；仅非阻断 concerns=`warn`；任一 failed=`fail`；关键前置缺失=`blocked`。
7. `report.md` pass/warn 路由 quality-review，fail/blocked 路由 maestro-plan；领域数字用 aref。
8. exit check 要求 criteria 零遗漏、失败有 gaps、verdict 可复算；通过后 complete。

## Iron Gate

禁止降低 acceptance 标准或用 self-check 替代逐条验证。任何未检查 criterion 都使 exit check 失败。
