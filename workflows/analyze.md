<!-- session-mode: inherited -->
# Workflow: Analyze Run

## Run Contract

```text
maestro run create maestro-analyze
  consumes: current-guidance? | current-blueprint? | latest-debug?
domain pipeline
  produces: outputs/findings.json (current-analysis), outputs/risk-matrix.json
maestro run check <run_id> --stage exit
maestro run complete <run_id>
```

正式状态属于 Run CLI。领域 JSON 自带 `_meta`；过程叙述只写 `report.md`。

## Pipeline

```text
SETUP → EXPLORE → DISCUSS → SCORE → SYNTHESIZE → DECIDE
  quick: SETUP ───────────────────────────────→ DECIDE
  gaps:  SETUP → REPRODUCE → TRACE → DIAGNOSE → DECIDE
```

1. `maestro run create maestro-analyze -- $ARGUMENTS`；读取返回的 `run_dir` 与 `upstream`，执行 entry check。
2. 解析 macro/micro/quick/gaps。纯数字为 micro；文本为 macro；`-q` 跳过探索/评分；`--gaps` 进入 issue 根因路径。
3. 标准模式先做 code anchors 探索，再做至少一个独立 perspective；最多 5 轮讨论，每轮维护 intent coverage、confidence delta 与 technical solution status。
4. 对 architecture、implementation、performance、security、concept、decision 六维评分；至少一次 pressure pass；综合 scope verdict 与 go/no-go。
5. quick 仍必须提取 Locked/Free/Deferred decisions；gaps 只有证据充分时才确认 root cause。
6. 写 `outputs/findings.json`（`analysis-findings/1.0`，primary，alias `current-analysis`）和 `outputs/risk-matrix.json`（`risk-matrix/1.0`，evidence）。
7. 写带 frontmatter 的 `report.md`，固定小节为摘要、Verdict、讨论/复盘、产物、Next；领域数据只用 aref 引用。
8. exit check 验证意图覆盖、typed metadata、risk/decision 一致性；通过后 `maestro run complete <run_id>`。

## Verdict Routing

| Verdict | Next | Required alias |
|---|---|---|
| ready / ready_with_concerns | maestro-plan | current-analysis |
| blocked | quality-debug 或补充输入后重跑 analyze | latest-debug 或明确问题 |
