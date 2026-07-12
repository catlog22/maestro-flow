---
name: quality-test
description: 对已验证交付执行 UAT、coverage 与可选浏览器验收
argument-hint: "[scope] [--smoke] [--auto-fix] [--frontend-verify]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: verification, alias: latest-verification, required: true, require_status: sealed }
    - { kind: review-findings, alias: latest-review, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
  produces:
    - { path: outputs/test-plan.json, kind: test-plan, role: attachment }
    - { path: outputs/test-results.json, kind: test-results, alias: latest-test, role: primary }
    - { path: outputs/acceptance.json, kind: acceptance, role: evidence }
    - { path: outputs/coverage.json, kind: coverage, role: evidence }
    - { path: outputs/e2e-results.json, kind: e2e-results, role: evidence, optional: true }
session-mode: run
---

<run_mode>
**Session mode:** `run`. This block is MANDATORY and overrides legacy artifact-path examples below.

1. Before domain work, call `maestro run create quality-test -- $ARGUMENTS` and use the returned `run_id`, `run_dir`, and `upstream`.
2. Formal JSON/Markdown deliverables MUST be written under `{run_dir}/outputs/`; evidence goes to `{run_dir}/evidence/`; process narrative and handoff go to `{run_dir}/report.md`.
3. The model MUST NOT edit protocol JSON (`run.json`, `session.json`, `gates.json`, `artifacts.json`, `evidence.json`) or append to project `state.json.artifacts[]`.
4. Run `maestro run check {run_id}` before completion, repair blocking gaps, then run `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Any later reference to `scratch/`, hidden command session directories, `milestones/`, `phases/`, `context-package.json`, `understanding.md`, `evidence.ndjson`, or a secondary `status.json` is a legacy semantic label only. Map formal deliverables to `outputs/`, narrative to `report.md`, evidence attachments to `evidence/`, and orchestration state to the active Session/Run runtime. Never create the legacy formal path.
</run_mode>

<purpose>
保留逐场景 UAT、severity 自动推断、confidence/readiness gate、pressure pass、frontend deterministic assertions 与最多 2 轮 gap closure 语义。
</purpose>

<invariants>
1. 命令自包含；测试 Run 观察行为，默认不修改源码。
2. 每次只呈现一个 UAT 场景；severity 从用户描述推断，不询问等级。
3. timeout、无响应或缺 UI 入口不得判 pass。
4. `--auto-fix` 只编排新的 plan→execute→verify Runs，最多 2 轮；本 Run 不直接改源码。
5. UAT 结构化真相写 `acceptance.json`，过程写 `report.md`，协议状态交由 CLI。
</invariants>

<execution>
1. **Create**：`maestro run create quality-test -- $ARGUMENTS`，再运行 `maestro run check <run_id> --stage entry`；读取 `latest-verification` 及可选 review/debug aliases。
2. **设计**：把 requirements、failed review risks、debug regressions 与已注册 test knowhow 映射为场景；`--smoke` 先跑启动/核心路径；写 typed `test-plan.json`。
3. **执行**：逐场景收集 pass/issue/skipped；issue 自动推断 blocker/major/minor/cosmetic 并聚类。`--frontend-verify` 对每个 UI-observable criterion 断言 UI 入口、写请求 2xx、DOM 结果并记录可复核证据。
4. **收敛**：计算 scenario coverage、diagnostic depth、observation quality、closure completeness；>80% pass 执行 pressure pass。`--auto-fix` 对 gaps 启动最多 2 轮 plan→execute→verify，再回到本 Run 复测。
5. 写 typed outputs：`test-results.json`（schema `test-results/1.0`，alias `latest-test`）、`acceptance.json`（`acceptance/1.0`）、`coverage.json`（`coverage/1.0`）；frontend 模式另写 `e2e-results.json`（`e2e-results/1.0`）。所有 JSON 顶层必须有 `_meta`。
6. 写标准 frontmatter/固定五小节 `report.md`。全过路由 session next/audit；失败且已诊断路由 `maestro-plan`；未诊断路由 `quality-debug`，required 包含 `latest-test`。
7. **Check**：`maestro run check <run_id> --stage exit`；确保所有场景有状态、coverage 可复算、confidence gate 通过、frontend 每条均有确定性证据、未解决 gaps 未静默放行。
8. **Complete**：`maestro run complete <run_id>`；CLI 注册 `latest-test` 并 seal。
</execution>

<success_criteria>
- UAT pipeline、frontend mode、confidence gate 与 2 轮 closure 上限保留。
- typed outputs 与 `_meta` 完整；`latest-test` 为 primary。
- report handoff 与 verdict 一致，exit check 与 complete 成功。
</success_criteria>
