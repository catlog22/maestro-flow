---
name: quality-debug
description: 用科学方法复现、假设检验和反向追踪定位根因
argument-hint: "[issue] [--from-test] [--parallel] [-c]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: test-results, alias: latest-test, required: false }
    - { kind: review-findings, alias: latest-review, required: false }
    - { kind: execution, alias: current-execution, required: false }
  produces:
    - { path: outputs/diagnosis.json, kind: diagnosis, alias: latest-debug, role: primary }
    - { path: outputs/hypotheses.json, kind: hypotheses, role: evidence }
    - { path: outputs/reproduction.json, kind: reproduction, role: evidence }
    - { path: outputs/fix-directions.json, kind: fix-directions, role: attachment }
session-mode: run
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
保留 standalone/from-test/parallel、三击升级、backward tracing、多因子 confidence、pressure pass 与 continuation FSM。Debug 只产诊断和 fix directions，不执行修复。
</purpose>

<invariants>
1. 命令自包含；无复现或代码/日志证据不得确认 root cause。
2. 调查只读源码；禁止 quick fix、试改源码或同时修改多个变量。
3. 每个 hypothesis 必须记录 tested action、evidence、status；3 个假设失败后停止并升级架构检查。
4. 结构化证据写 typed JSON，叙述写唯一 `report.md`，协议状态交由 CLI。
</invariants>

<execution>
1. **Create**：`maestro run create quality-debug -- $ARGUMENTS`，再运行 `maestro run check <run_id> --stage entry`。`--from-test` 读取 `latest-test` gaps；standalone 从 args 收集 expected、actual、errors、timeline、reproduction。
2. **领域工作 FSM**：症状基线→稳定复现→按 cluster 形成 2-3 hypotheses→逐个证伪/证实→从错误首次出现点 backward trace→隔离根因→pressure pass。`--parallel` 可按无交叉 cluster 并行；`-c` 由 Run parent/retry 关联恢复，不扫描旧目录。
3. 写 `outputs/reproduction.json`（schema `reproduction/1.0`）与 `outputs/hypotheses.json`（`hypotheses/1.0`）；每项含命令/步骤、观察、file:line、状态和矛盾证据。
4. 写 primary `outputs/diagnosis.json`：
   ```json
   {"_meta":{"kind":"diagnosis","schema":"diagnosis/1.0","role":"primary","alias":"latest-debug"},"status":"confirmed|partial|inconclusive","clusters":[],"root_causes":[],"confidence":{"overall":0,"dimensions":{}},"pressure_pass":{}}
   ```
5. 写 `outputs/fix-directions.json`（schema `fix-directions/1.0`），只含根因级修改方向、affected files、regression tests 与 risks，不含实际 patch。
6. 写标准 frontmatter/固定五小节 `report.md`。confirmed 路由 `maestro-plan` 且 required `[latest-debug]`；inconclusive 的 next 为新的 `quality-debug` Run，并在 caveats/open_questions 记录缺失证据。
7. **Check**：`maestro run check <run_id> --stage exit`；确认 confirmed root causes 均有 reproduction、file:line、反证压力测试和具体 fix direction；inconclusive 不得伪装 ready。
8. **Complete**：`maestro run complete <run_id>`；CLI 注册 `latest-debug` 并 seal。
</execution>

<success_criteria>
- scientific debug FSM、3-strike、parallel cluster、confidence/readiness 语义保留。
- 四个 typed artifacts `_meta` 完整；root cause 证据可复核。
- report verdict/next 与 diagnosis status 一致，exit check 与 complete 成功。
</success_criteria>
