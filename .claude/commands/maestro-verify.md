---
name: maestro-verify
description: 独立验证 current-execution 对 current-plan 的需求覆盖、行为正确性与反模式风险
argument-hint: "[scope] [--strict]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: plan, alias: current-plan, required: true }
    - { kind: execution, alias: current-execution, required: true }
  produces:
    - { path: outputs/verification.json, kind: verification, alias: latest-verification, role: primary }
    - { path: outputs/requirement-coverage.json, kind: requirement-coverage, role: evidence }
    - { path: outputs/antipattern-report.json, kind: antipattern-report, role: evidence }
session-mode: run
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
作为独立 Run 对实现进行 iron-gate 验证。逐条核验 acceptance criteria，运行测试并检查存在性、实质性、回归与反模式；失败必须给出可执行 gap。
</purpose>

<invariants>
1. 命令自包含，验证源是 sealed `current-plan` 与 `current-execution` typed artifacts。
2. 每条 criterion 必须有客观 pass/fail/blocked 结果与证据；禁止 close enough。
3. 验证阶段默认只读源码；不得顺手修复。
4. 不复用 execute 的 self-check 作为最终结论，但可作为辅助证据。
</invariants>

<execution>
1. **Create**：`maestro run create maestro-verify -- $ARGUMENTS`。
2. **领域工作**：从 plan 提取 criteria/requirements，从 execution/change manifest 获取实现范围；逐条运行指定 tests/grep/CLI review/manual evidence；检查期望文件、stub/TODO/FIXME/HACK、disabled tests、debug logs 与回归风险。
3. 写 `outputs/verification.json`：
   ```json
   {"verdict":"pass|warn|fail|blocked","criteria":[{"id":"AC1","status":"passed|failed|blocked","method":"test|grep|review|manual","evidence":[]}],"gaps":[]}
   ```
4. 写 `outputs/requirement-coverage.json` 与 `outputs/antipattern-report.json`，schemas 为 `requirement-coverage/1.0`、`antipattern-report/1.0`，role 为 evidence。
5. 写 `report.md` 固定骨架。pass 时 next 为 `quality-review`；warn 时携带 concerns；fail/blocked 时 next 为 `maestro-plan` 且 needs 包含 `latest-verification`。正文通过 aref 引用 verification 数值。
6. **Complete**：`maestro run complete <run_id>`。CLI 扫描 outputs、校验 exit gate、注册 `latest-verification` 并 seal。
</execution>

<success_criteria>
- 每个 criterion 都有方法、状态和证据，verdict 可复算。
- 三个 typed artifacts 完整，`latest-verification` 可供 review/test 消费。
- exit check 与 complete 成功。
</success_criteria>
