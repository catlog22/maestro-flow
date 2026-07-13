<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Test Run

## Run Contract

```text
maestro run create quality-test
  consumes: latest-verification + latest-review? + latest-debug?
domain pipeline
  produces: test-plan, test-results, acceptance, coverage, e2e-results?
maestro run check <run_id> --stage exit
maestro run complete <run_id> → alias latest-test
```

结构化 UAT 真相在 typed JSON，过程叙述在 `report.md`。

## Pipeline

```text
RESOLVE → SMOKE? → DESIGN → PRESENT ONE SCENARIO → RECORD RESPONSE
                         ↘ gaps → DIAGNOSE/ROUTE → optional closure max 2
          → CONFIDENCE → PRESSURE PASS → VERDICT
```

1. create + entry check；从 latest-verification 获取 requirements/criteria，从 review/debug 补充风险与回归场景。
2. 写 typed `test-plan.json`；场景标明 source、requirement ref、steps、expected、evidence method。
3. 对话 UAT 每次只呈现一个场景。pass/skip 明确记录；其他响应为 issue，severity 按语义自动推断，禁止询问等级。
4. frontend verify 对每条 UI-observable criterion 验证入口→写请求 2xx→DOM 结果；timeout/无入口为 fail。
5. gaps 按 component/flow 聚类。`--auto-fix` 通过新的 plan→execute→verify Runs 闭环，最多 2 轮，再复测；本 Run 不直接改源码。
6. 写 `test-results.json`（primary/latest-test）、`acceptance.json`、`coverage.json`，frontend 时写 `e2e-results.json`；全部含 `_meta`。
7. 计算 scenario coverage、diagnostic depth、observation quality、closure completeness；>80% pass 必做 edge pressure pass。
8. `report.md`：全过路由 next/audit，已诊断 gaps 路由 maestro-plan，未诊断路由 quality-debug。
9. exit check 确认场景零遗漏、coverage 可复算、gaps 未静默放行、frontend 证据确定；通过后 complete。

## Severity Inference

crash/exception/cannot use→blocker；wrong/broken→major；works but/slow/inconsistent→minor；visual typo→cosmetic；默认 major。
