---
name: maestro-next
description: Single-command recommendation — pick the best next command from the pool and execute it
argument-hint: "<intent> [-y] [--dry-run] [--top N] [--list]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---

<purpose>
单链推荐：根据用户输入意图，从 `.claude/commands/` 命令池中挑选**最匹配的单个命令**，确认后通过 `Skill()` 执行。

与 `/maestro` / `/maestro-ralph` 的区别：
- `/maestro`、`/maestro-ralph`、`/maestro-ralph-execute`、`/maestro-ralph-beta`、`/maestro-player`、`/maestro-composer` 是**多步管线编排器**，本命令不会推荐它们
- 本命令始终只推荐 **1 个原子命令**（top pick），最多列出 2-3 个备选；选定后直接执行，无 session、无 chain
- 适用场景：用户意图清晰、只需单步即可完成；或不确定该走哪个具体命令时获取定向推荐
</purpose>

<context>
$ARGUMENTS — 用户意图文本 + 可选 flags。

**Flags:**
- `-y` / `--yes` — 自动模式：跳过确认，直接执行 top pick
- `--dry-run` — 仅显示推荐结果，不执行
- `--top N` — 显示前 N 个候选供选择（默认 3）
- `--list` — 仅列出可推荐命令池，不做推荐

**候选池：** 仅 Step 3 路由表中列出的命令参与推荐。表中未出现的命令（含管线编排器 `maestro` / `maestro-ralph*` / `maestro-player` / `maestro-composer` 等）不会被本命令推荐。
</context>

<execution>

### Step 1: Parse Arguments

解析 `-y` / `--dry-run` / `--top N` / `--list`，剩余文本作为 `intent`。

- `--list` 模式 → 跳到 Step 3（仅列表）
- `intent` 为空且非 `--list` → `AskUserQuestion`：让用户输入意图（最多 1 轮，仍空则 E001）

### Step 2: 读取 Workflow 状态（智能推荐基础）

读取以下项目状态，用于推断"当前生命周期位置"和"自然下一步"：

```bash
# 1. 当前 phase / milestone / 最新 artifact
cat .workflow/state.json 2>$null

# 2. 最近 artifact 目录（按 mtime 倒序，取前 3）
ls -la .workflow/scratch/ 2>$null | head -10

# 3. 是否有进行中的 ralph/maestro session
ls -la .workflow/.maestro/ 2>$null | head -5
```

根据读取结果推断 **lifecycle_position**（用作下一步推荐的核心信号）：

| 项目状态特征 | lifecycle_position | 自然下一步 |
|--------------|-------------------|-----------|
| 无 `.workflow/` + 无源码 | `brainstorm` | `maestro-brainstorm` |
| 无 `.workflow/` + 有源码 | `init` | `maestro-init` |
| 有 state.json，无 roadmap.md，无 milestones | `analyze-macro` | `maestro-analyze` (宏观调研) |
| 有 macro analyze artifact，无 roadmap.md | `roadmap` | `maestro-roadmap` |
| 有 roadmap，未启动 phase | `analyze` | `maestro-analyze {phase}` |
| 最新 artifact = `analyze` | `plan` | `maestro-plan {phase}` |
| 最新 artifact = `plan` | `execute` | `maestro-execute {phase}` |
| 最新 artifact = `execute` | `verify` | `maestro-verify {phase}` |
| 最新 artifact = `verify`，passed | `review` | `quality-review {phase}` |
| 最新 artifact = `review`，verdict=PASS | `test-gen` | `quality-auto-test {phase}` |
| 最新 artifact = `test`，全绿 | `milestone-audit` | `maestro-milestone-audit` |
| 当前 milestone 全部 phase 完成 | `milestone-complete` | `maestro-milestone-complete` |
| 任一 stage 产物含 gaps/failed | `debug` | `quality-debug {gap}` |

**Maestro Lifecycle 主线（核心 workflow，供推断"下一步"使用）：**

```
brainstorm → blueprint → init → analyze-macro → roadmap
   → [per phase] analyze → plan → execute → verify
   → [quality gate] review → auto-test → test
   → milestone-audit → milestone-complete → milestone-release
```

**辅助 workflow 簇**（按场景触发，非主线）：

| Workflow 簇 | 触发场景 | 主推命令 |
|-------------|---------|---------|
| Learning | 接触新代码/未知模块 | `learn-follow` → `learn-decompose` → `learn-second-opinion` |
| Knowledge | 提炼经验 / 沉淀知识 | `manage-harvest` → `manage-knowhow-capture` → `spec-add` |
| Wiki 维护 | 知识图谱整理 | `manage-wiki` → `wiki-connect` → `wiki-digest` |
| Issue 治理 | 缺陷管理 | `manage-issue-discover` → `manage-issue` |
| 文档同步 | 代码大改后 | `quality-sync` → `manage-codebase-refresh` |
| 重构 | 技术债积累 | `quality-refactor` → `quality-review` |
| 发布 | 里程碑结束 | `maestro-milestone-audit` → `maestro-milestone-release` |
| 并行开发 | 多 milestone 并行 | `maestro-fork` → ... → `maestro-merge` |

### Step 2.5: Semantic Match & Rank

综合以下信号对路由表中的命令评分（高→低）：

| 信号 | 权重 | 说明 |
|------|------|------|
| intent 命中路由表行的关键词 | 高 | 字面匹配主依据 |
| **lifecycle_position 的"自然下一步"** | **高** | 当 intent 含"继续/下一步/next/接下来"或为空时，此信号上升为决定性 |
| `name` 关键词命中 intent | 中 | 如 intent 含 "test" → quality-test/quality-auto-test 加分 |
| Workflow 簇匹配 | 中 | intent 涉及学习/知识/issue 等场景时触发对应簇 |
| Recent activity 反向避免 | 低 | 刚完成的 stage 在短期内降权 |

**特殊意图处理：**

| Intent 模式 | 处理 |
|------------|------|
| 空 / "继续" / "下一步" / "next" / "接下来怎么走" | 直接按 lifecycle_position 的"自然下一步"作为 top pick |
| "什么状态" / "现在到哪了" / "status" | top pick = `manage-status` |
| 字面命中路由表关键词 | 路由表优先，lifecycle 作为加分项 |
| 无任何匹配 | top pick = lifecycle 自然下一步 + W002 警告 |

**意图 → 命令路由表**（候选池等于本表 + 上方"自然下一步"建议）：

| 意图关键词 | 推荐命令 |
|-----------|---------|
| 头脑风暴 / 探索 / brainstorm / ideate | `maestro-brainstorm` |
| 规格 / 正式文档 / spec-generate / blueprint | `maestro-blueprint` |
| 分析 / analyze / 多维度调研 | `maestro-analyze` |
| 规划 / plan / 任务分解 | `maestro-plan` |
| 实现 / 执行 / execute | `maestro-execute` |
| 验证 / verify / 验收 | `maestro-verify` |
| 调试 / debug / 排查 / bug | `quality-debug` |
| 审查 / review / 代码审查 | `quality-review` |
| 测试 / test / UAT | `quality-test` / `quality-auto-test` |
| 重构 / refactor / 技术债 | `quality-refactor` |
| 同步文档 / sync docs | `quality-sync` |
| 回顾 / retro | `quality-retrospective` / `learn-retro` |
| issue / 缺陷管理 | `manage-issue` / `manage-issue-discover` |
| wiki / 知识图谱 | `manage-wiki` / `wiki-connect` / `wiki-digest` |
| spec / 规则 / 约束 | `spec-load` / `spec-add` / `spec-setup` |
| 项目初始化 / init | `maestro-init` |
| 状态 / status / 仪表盘 | `manage-status` |
| 文档重建 / codebase 文档 | `manage-codebase-rebuild` / `manage-codebase-refresh` |
| 安全 / security / OWASP | `security-audit` |
| 跟读 / 学习 / 阅读源码 | `learn-follow` / `learn-investigate` |
| 第二意见 / challenge / consult | `learn-second-opinion` |
| 提取知识 / harvest | `manage-harvest` / `manage-knowhow-capture` |
| 设计 / UI / 前端打磨 | `maestro-impeccable` |
| 里程碑 / milestone | `maestro-milestone-audit` / `maestro-milestone-release` / `maestro-milestone-complete` |
| fork / 分支 / 并行开发 | `maestro-fork` / `maestro-merge` |
| 覆盖层 / overlay / amend | `maestro-overlay` / `maestro-amend` |

输出 ranked candidates，取 top N（默认 3）。

### Step 3: Present & Confirm

**`--list` 模式：** 按类别（maestro / manage / quality / learn / spec / wiki / security）分组展示所有候选 + description，结束。

**正常模式：**

显示：
```
🎯 推荐 (top pick): /<command-name>
   <description>
   推荐理由: <一句话说明为什么命中>

备选:
  2. /<alt-1> — <description>
  3. /<alt-2> — <description>

执行参数: <args-to-pass>
```

- `--dry-run` → 显示后结束
- `-y` → 直接执行 top pick
- 否则 → `AskUserQuestion` 让用户：执行 top pick / 选备选 / 修改参数 / 取消

### Step 4: Execute

通过 `Skill({ skill: "<chosen-command-name>", args: "<args>" })` 执行。

**参数传递：**
- 默认把 intent 原文作为第一个参数传给目标命令
- 若用户在 Step 3 修改了参数，使用修改后的版本
- `-y` flag 透传给目标命令（如果目标命令支持）

执行完成后显示：
```
✅ 已执行 /<command-name>
```

不创建 session、不写 status.json、不做后续 chain — 由目标命令自行管理其产出。

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | 未提供 intent 且 clarification 后仍为空 | 提供意图描述或使用 `--list` 浏览命令池 |
| E002 | error | 候选池为空（commands 目录不存在或无 .md 文件） | 检查 `.claude/commands/` 是否存在 |
| E003 | error | 用户选择的命令名无法解析为有效 skill | 列出有效命令名让用户重选 |
| W001 | warning | 多个命令得分接近（top1 与 top2 差距 < 阈值） | 强制展示前 3，让用户裁决 |
| W002 | warning | intent 与所有候选匹配度均低 | 提示用户考虑 `/maestro` 或 `/maestro-ralph` 走管线 |
</error_codes>

<success_criteria>
- [ ] Intent 解析 + flags 提取完成
- [ ] 读取 `.workflow/state.json` + scratch artifacts 推断 lifecycle_position
- [ ] 候选池等于路由表（管线编排器自然不在表中）
- [ ] 评分综合：intent 字面匹配 + lifecycle 自然下一步 + workflow 簇 + recent activity
- [ ] 空 intent / "继续" / "下一步" → 直接采用 lifecycle 推断的下一步
- [ ] top pick 展示时附"推荐理由"（命中规则 + lifecycle 位置）
- [ ] `--dry-run` 仅展示，不执行
- [ ] `-y` 自动执行 top pick
- [ ] 非自动模式下，用户通过 AskUserQuestion 确认或选择备选
- [ ] 选定命令通过 `Skill()` 单次调用执行
- [ ] 不创建 session、不生成 status.json、不触发后续 chain
- [ ] `--list` 模式按 workflow 簇（主线 / Learning / Knowledge / Wiki / Issue / 文档 / 重构 / 发布 / 并行）分组展示
</success_criteria>
