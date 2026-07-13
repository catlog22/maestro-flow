---
name: quality-review
description: 对已验证实现进行多维代码审查并形成可追踪 findings
argument-hint: "[scope] [--quick|--deep] [--skip-specs]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
contract:
  consumes:
    - { kind: execution, alias: current-execution, required: true }
    - { kind: verification, alias: latest-verification, required: false }
  produces:
    - { path: outputs/findings.json, kind: review-findings, alias: latest-review, role: primary }
    - { path: outputs/spec-conflicts.json, kind: spec-conflicts, role: evidence }
    - { path: outputs/issue-candidates.json, kind: issue-candidates, role: attachment }
session-mode: run
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
保留 quick/standard/deep、多维并行审查、严重度聚合、deep-dive 与 spec conflict 检查语义；结果以 typed artifacts 交给 test 或 plan。
</purpose>

<invariants>
1. 命令自包含；不读取其他 prompt。
2. 只从 create 返回的 aliases 读取变更清单和 verification。
3. Review 默认只读源码；发现问题不在本 Run 修复。
4. findings 必须包含 file:line、severity、evidence、impact 与 recommendation。
</invariants>

<execution>
1. **Create**：`maestro run create quality-review -- $ARGUMENTS`。
2. **领域工作**：从 `current-execution`/change manifest 解析文件；加载 review specs（除非 `--skip-specs`）；按 correctness、security、performance、maintainability、tests、architecture/spec consistency 审查。quick inline；standard 并行视角；deep 强制 deep-dive。聚合并去重 findings。
3. 写 `outputs/findings.json`：
   ```json
   {"level":"quick|standard|deep","verdict":"pass|warn|block","findings":[],"severity_counts":{}}
   ```
4. 写 `outputs/spec-conflicts.json` 和 `outputs/issue-candidates.json`，schemas 为 `spec-conflicts/1.0` 与 `issue-candidates/1.0`。候选只描述问题，不手工写 issue registry。
5. 写带标准 frontmatter/固定五小节的 `report.md`。pass/warn 路由 `quality-test`，block 路由 `maestro-plan`；required aliases 分别包含 `latest-review` 与必要的 `latest-verification`。
6. **Complete**：`maestro run complete <run_id>`。CLI 扫描 outputs、校验 exit gate、注册 `latest-review` 并 seal。
</execution>

<success_criteria>
- 多维 review pipeline 与 quick/deep 分支保留。
- 三个 typed artifacts 元数据完整，所有 findings 有 file:line evidence。
- report handoff 路由正确，exit check 与 complete 成功。
</success_criteria>
