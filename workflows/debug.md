<!-- session-mode: inherited -->
# Workflow: Debug Run

## Iron Law

没有复现、日志/代码 trace 与 file:line 根因证据，不得提出确定性修复。

## Run Contract

```text
maestro run create quality-debug
  consumes: latest-test? + latest-review? + current-execution?
domain pipeline
  produces: diagnosis, hypotheses, reproduction, fix-directions
maestro run check <run_id> --stage exit
maestro run complete <run_id> → alias latest-debug
```

禁止源码修改；结构化调查证据属于 typed outputs，过程叙述属于 `report.md`。

## FSM

```text
SYMPTOMS → REPRODUCE → HYPOTHESES → TEST → BACKWARD TRACE → DIAGNOSE
                              ↘ refuted (max 3) ↗        ↘ INCONCLUSIVE
DIAGNOSE → PRESSURE PASS → FIX DIRECTION → COMPLETE
```

1. create + entry check。standalone 收集 expected/actual/errors/timeline/reproduction；from-test 从 latest-test gaps 建 symptom baseline；parallel 仅按独立 cluster 并行。
2. 为每 cluster 建 2-3 个可证伪 hypotheses。逐个记录 action、observation、file:line evidence、confirmed/refuted/testing。
3. 从错误首次出现点沿 call/data flow 反向追踪，直到正确数据变坏的源头；禁止在症状点止步。
4. 三个 hypothesis 失败后停止新猜测，执行 architecture check，并把所需新上下文写入 open questions。
5. 写 `outputs/reproduction.json`、`outputs/hypotheses.json`、`outputs/diagnosis.json`（primary/latest-debug）、`outputs/fix-directions.json`；全部带 `_meta`。
6. confidence 维度：hypothesis quality、evidence completeness、root-cause isolation、fix confidence；confirmed 前必须 pressure pass 且无矛盾证据。
7. fix direction 只描述根因级修改位置、regression tests 与 risks，不应用 patch。
8. `report.md` confirmed 路由 maestro-plan；partial/inconclusive 路由新的 quality-debug Run 并声明缺失证据。
9. exit check：confirmed root cause 必有 reproduction + file:line + pressure pass + fix direction；通过后 complete。

## Red Flags

“先试着改”“错误显然”“加 try/catch”“多个改动一起试”都意味着返回证据收集阶段。
