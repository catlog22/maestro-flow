---
name: maestro-analyze
description: 对主题或现有实现进行多维分析，并产出可供 plan 消费的 typed artifacts
argument-hint: "[topic] [-y] [-q] [--from <artifact-alias>] [--gaps [ISS-ID]]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: guidance, alias: current-guidance, required: false }
    - { kind: blueprint, alias: current-blueprint, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
  produces:
    - { path: outputs/findings.json, kind: findings, alias: current-analysis, role: primary }
    - { path: outputs/risk-matrix.json, kind: risk-matrix, role: evidence }
session-mode: run
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
以多视角探索、交互讨论、六维评分和决策提取分析 `$ARGUMENTS`。保留 macro/micro、quick、gaps 与最多 5 轮收敛语义；所有正式产物进入本次 Run。
</purpose>

<invariants>
1. 命令自包含，不读取其他 command/workflow prompt。
2. 先运行 `maestro run create maestro-analyze -- $ARGUMENTS`；只使用返回的 `run_id`、`run_dir` 和 `upstream`。
3. 上游只从 `upstream` 的 alias→path 读取，不按 mtime 猜 latest。
4. LLM 不写 `run.json`、`session.json`、`artifacts.json` 或 handoff JSON。
5. JSON 产物由文件名推断 kind，`_meta` 可选覆盖（仅同 kind 多文件或非常规 schema 时使用）；过程叙述只写 `{run_dir}/report.md`。
6. `-q` 仅跳过探索与六维评分，不跳过决策提取；`--gaps` 保留 issue 根因分析语义。
</invariants>

<execution>
1. **Create**：执行 `maestro run create maestro-analyze -- $ARGUMENTS`。
2. **解析模式**：纯数字为 micro；文本为 macro；`-q` 为 quick；`--gaps` 为 gap analysis。加载 create 返回的 upstream typed JSON、项目 specs、domain glossary 与必要代码证据。
3. **领域工作**：
   - 标准模式：完成代码探索、至少一个独立 CLI/agent 视角、交互讨论（最多 5 轮）、六维评分、pressure pass、意图覆盖与 Go/No-Go 综合。
   - quick：直接抽取 Locked/Free/Deferred 决策与 next route。
   - gaps：逐 issue 形成症状、根因证据、影响面与 fix direction；无证据不得确认根因。
4. 写 `{run_dir}/outputs/findings.json`：
   ```json
   {"mode":"macro|micro|quick|gaps","topic":"","dimensions":[],"findings":[],"decisions":[],"scope_verdict":"small|medium|large","recommendation":"go|go_with_conditions|no_go"}
   ```
5. 写 `{run_dir}/outputs/risk-matrix.json`：
   ```json
   {"risks":[],"assumptions":[],"open_questions":[]}
   ```
6. 写唯一 `{run_dir}/report.md`，必须包含下列 frontmatter 与固定小节：
   ```md
   ---
   verdict: ready
   summary: 分析结论一句话摘要
   constraints: []
   decisions: []
   concerns: []
   next:
     - { command: maestro-plan, reason: analysis ready, needs: [current-analysis] }
   ---
   ## 摘要
   ## 结论/Verdict
   ## 讨论/复盘
   ## 产物
   ## 交接/Next
   ```
   报告中的领域数值用 `{{aref:current-analysis#/...}}` 或 `aref` block 引用，禁止复制 JSON 真相。
7. **Complete**：执行 `maestro run complete <run_id>`。CLI 扫描 outputs、校验 exit gate、注册 alias、派生 handoff 并 seal。
</execution>

<success_criteria>
- `findings.json` 与 `risk-matrix.json` typed metadata 完整；`current-analysis` 指向 primary artifact。
- 标准模式保留探索→讨论→评分→综合 FSM；quick/gaps 分支语义不丢失。
- `report.md` frontmatter 可派生 verdict、decisions、next；exit check 与 complete 成功。
</success_criteria>
