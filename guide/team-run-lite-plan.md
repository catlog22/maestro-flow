---
title: "Team Skill × Run 轻量接入规划（run-lite）"
status: draft
date: 2026-07-16
---

# Team Skill × Run 轻量接入规划（run-lite）

## 一、背景与已验证结论

架构定位来自 `session-run-simplification-plan.md` §7.6：team-* 全家归第二档 **Run-aware Skill**——保留 Skill 入口、自己调 run 动词、产物进 Run。本规划落地其**宽松形态**：team skill 不遵循完整 run-mode 协议，只做 `create`（拿 run_dir）+ `complete`（登记产物收口），不调 `prepare`/`brief`，不加载任何协议/workflow 正文。

2026-07-16 冒烟验证（临时 workflow-root，`team-review`/`team-ux-improve`）：

| 事实 | 结论 |
|------|------|
| `run create` 返回包仅 `run_id/run_dir/upstream/entry_gates/next`，无正文 | 正文注入在 `prepare`/`skill`/`brief` 三个独立动词，不调即静默 |
| 无 prepare/contract（命令源回退 SKILL.md，无 contract 块）→ 空门禁、空 upstream | check/complete 永不阻塞，纯产物登记器 |
| complete 无 report.md 可 seal；产物 kind=文件名 stem 自发现、role 自动 primary、alias 自动派生 | report.md 可选（missing `_meta` 仅 warning） |
| 零产物也能 seal | 只改代码不产 artifact 的 team skill 同样适用 |

**CLI 零修改**（除 §C5 一处可选文案）。

## 二、不动清单（宽松模式边界）

- `.workflow/.team/` 总线目录、`team-session.json`、`.msg/`、`role-specs/`、beat 模型、resume 扫描机制——全部保留。run-mode.md 已豁免：team 总线可作 transient coordination 存在。
- `wisdom/ discussions/ explorations/` 留在 `.team/`，不搬 `evidence/`。
- 不补 `prepare/team-*.md` contract——渐进式，某 skill 日后要产物进 artifact 链（alias 供下游 step 消费）再单独加。
- `team-executor` 维持 `session-mode: none`，不接入。
- 严格版迁移（team-session.json 降级、resume 走 brief）不在本规划范围。

## 三、变更清单

### C1 新增 `workflows/run-mode-lite.md`（协议单源）

约 12 行，替代 team skill 中约 50 行的完整 run-mode.md 嵌入。内容要求：

1. **Create**：领域工作前 `maestro run create <skill-name> --session <slug> --intent "<一句话>"`；slug 格式 `YYYYMMDD-<skill>-<topic>`，**ASCII、≤64 字符、禁止让 runtime 从中文 intent 自动生成**（历史坑，规则必须保留）。留存返回的 `run_id`/`run_dir`。
2. **产物边界**：正式交付物写 `{run_dir}/outputs/`（文件名即 kind）；团队协调文件（总线/role-specs/过程记录）留在 `.team/`，不属正式产物。
3. **Complete**：收口时 `maestro run complete <run_id>`（`check` 可选，complete 内含同样求值）。推荐先写 `{run_dir}/report.md`（frontmatter：`verdict`/`summary`/`concerns`），complete 会自动派生 handoff；不写也合法。
4. 明示：本协议不使用 `prepare`/`brief`，不加载 workflow 正文。

平台中立（无宿主工具引用），单文件覆盖全平台，无需 codex 变体。

### C2 引用替换（24 skill、214 个文件含 `run-mode.md` 引用）

按文件层级分三类规则：

| 层 | 文件 | 处理 |
|----|------|------|
| 入口层 | `SKILL.md` | `@~/.maestro/workflows/run-mode.md` → `@~/.maestro/workflows/run-mode-lite.md` |
| 编排层 | `roles/coordinator/role.md` | 同上替换 |
| 执行层 | `roles/coordinator/commands/*.md`、非 coordinator 的 `roles/*/role.md` | **删除** required_reading 块——生命周期动词只属于 coordinator 入口，内层文件不需要协议；worker 的输出路径经 spawn prompt 传递（C4） |

`session-mode: run` frontmatter 保持不变（声明性标记，无 runtime 消费者）。

### C3 coordinator 生命周期接线（每 skill 的 `role.md` + `commands/monitor.md`）

1. **Create 时机**：Phase 0/1 session 初始化后、生成 role-specs 前，调 `run create`；`run_id`/`run_dir` 写入 `team-session.json` 新增字段：
   ```json
   "run": { "run_id": "<id>", "run_dir": "<path>" }
   ```
   canonical session slug 与 `TC-*` 总线 ID 是两个命名空间：前者 `YYYYMMDD-team-<x>-<topic>`（ASCII）显式传参，后者仅作总线标识。
2. **Resume**：从 `team-session.json.run` 取 `run_id`，`maestro run check <run_id>` 取 status（幂等、无正文加载）；status=sealed 则同 session 再 create 新 run 并更新字段。
3. **handleComplete**（team-coordinate 锚点 `monitor.md:217`）：pipeline 完成 → 汇总写 `{run_dir}/report.md`（frontmatter）→ `run complete <run_id>` → 再走既有 AskUserQuestion completion action。complete 失败不阻塞 completion action，记 warning（对齐既有「Completion action fails → Keep Active」错误策略）。

### C4 worker 交付物路径重定向

正式交付物的家从 `.team/<session>/artifacts/` 改为 `{run_dir}/outputs/`：

| 文件 | 锚点 | 改动 |
|------|------|------|
| 各 SKILL.md「Coordinator Spawn Template」 | Role Assignment 块 | 新增 `run_dir: <run-dir>` 字段 |
| 各 skill `specs/role-spec-template.md` | 如 team-coordinate 的 L102/L112 | `<session>/artifacts/` → `{run_dir}/outputs/`，交付物命名保留 `<prefix>-<task-id>-<name>.md`（stem 即 kind） |
| `.claude/agents/team-worker.md` | L91/L204 | 同步路径 |
| 各 skill 内引用 `<session>/artifacts/` 的聚合/导出逻辑（monitor.md、completion export 等） | 逐 skill 确认 | 同步路径 |

> 备选方案（不推荐）：worker 仍写 `.team/artifacts/`，complete 前由 coordinator 归集拷贝到 `outputs/`。worker 链零修改，但产物双份、违背同源原则（reference, don't duplicate）。

### C5（可选）`src/run/runtime.ts:615-620` next.reason 文案分支

create 返回的提示固定说 "load the workflow execution manual…"，对无 workflow 正文的命令是误导。当 `resolveStepContent(command).workflow == null` 时改为：
`"write deliverables to {run_dir}/outputs/, then run: maestro run check → maestro run complete"`。

### C6 镜像同步

只编辑 `.claude/` 源、`workflows/`、`.claude/agents/`（不动 `~/.maestro/` 安装副本）。完成后：

```bash
npm run build:mirrors   # agy / agents / codex 自动转换 + lint-session-run-mirrors
```

若 `lint-session-run-mirrors.mjs` 硬编码校验 `run-mode.md` 引用，同步放宽以识别 `run-mode-lite.md`。

## 四、实施顺序

1. **C1**：落 `workflows/run-mode-lite.md`。
2. **打样**：在 team-coordinate 单 skill 完成 C2+C3+C4 全链。
3. **真实冒烟**：跑一次小任务的 team-coordinate，验证 `.workflow/sessions/` 下产生 sealed run、交付物注册为 artifact（alias 自动）、全程无 prepare/brief、resume 路径可用。
4. **批量铺开**：其余 23 个 skill 按分类规则模式化修改（引用替换可脚本化，产物路径逐 skill 核对）；同步 C5。
5. **C6**：build:mirrors + lint + git diff 审查。
6. install 传播到本地 `~/.maestro`。

## 五、验收标准

- 任一 team skill 调用后：`.workflow/sessions/<slug>/runs/` 存在一个 sealed run，正式交付物出现在 `outputs/` 并注册进 `artifacts.json`。
- 全程 CLI 调用仅 `create`/`check`(可选)/`complete`，无协议/workflow 正文注入。
- 既有行为零回归：beat 模型、`.msg` 总线协议、TC-* resume、completion action 交互不变。
- `npm run lint:codex-skills` 通过。

## 六、风险与对策

| 风险 | 对策 |
|------|------|
| slug 纪律失守（中文 intent 生成乱 ID） | lite 协议保留 ASCII slug 硬规则 + 示例 |
| coordinator 遗忘 create/complete（纯提示层，无强制力） | 打样阶段观察遵循率；若不达标，后续以 SkillStart hook 检测补强（独立工作，不在本规划） |
| 214 文件批量替换误伤 | 三类分层规则 + 逐 skill git diff 审查 + mirrors lint |
| 聚合/导出逻辑漏改路径导致交付物找不到 | 打样 skill 全链冒烟先行，批量时按 grep `<session>/artifacts/` 清单核销 |
