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
单链推荐：解析 intent + project state → 路由表评分 → 推荐**单个原子命令** → 确认后通过 `Skill()` 执行。

与 `/maestro` / `/maestro-ralph` 区别：
- 不创建 session、不构建 chain、不写 status.json
- 始终只推 1 个 top pick，最多列 2-3 个备选
- 适用场景：意图清晰且单步即可完成；或需要定向推荐时
</purpose>

<context>
$ARGUMENTS — 意图文本 + 可选 flags。

**Flags:**
- `-y` / `--yes` — 跳过确认，直接执行 top pick
- `--dry-run` — 仅显示推荐结果，不执行
- `--top N` — 显示前 N 个候选（默认 3）
- `--list` — 仅列出可推荐命令池，不做推荐

**候选池：** 仅 A_SCORE_CANDIDATES 路由表中列出的命令。管线编排器（`maestro` / `maestro-ralph*` / `maestro-player` / `maestro-composer`）**永远不在候选池**。
</context>

<invariants>
1. **不创建 session / 不写 status.json / 不触发后续 chain** — 单次原子执行，产出由目标命令自行管理
2. **管线编排器不在候选池** — 仅推荐原子命令
3. **空 intent 或 "继续/下一步/next/接下来"** → 直接采用 lifecycle_position 推断的自然下一步
4. **字面命中路由表优先** — lifecycle 仅作加分；命中失败时 lifecycle 上升为决定性信号
5. **参数传递** — 默认 intent 原文作为第一个 arg；用户可在确认环节修改；`-y` 仅当用户传入时透传到 skill args
6. **`--list` 模式跳过 lifecycle 推断与评分**，仅按 workflow 簇分组列出全部候选
</invariants>

<state_machine>

<states>
S_PARSE     — 解析 ARGUMENTS、提取 flags                       PERSIST: —
S_STATE     — 读 project state、推断 lifecycle_position         PERSIST: —
S_RANK      — 路由表评分、生成 top-N candidates                 PERSIST: —
S_LIST      — `--list` 模式：分组展示候选池                     PERSIST: —
S_PRESENT   — 显示 top pick + 备选 + 推荐理由 + 执行参数        PERSIST: —
S_CONFIRM   — AskUserQuestion 选择/修改参数（auto_mode 跳过）    PERSIST: —
S_EXECUTE   — `Skill({ skill, args })` 单次调用                 PERSIST: —
S_FALLBACK  — intent 空且 clarification 失败                    PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_LIST       WHEN: --list flag
  → S_STATE      WHEN: intent text present
  → S_STATE      WHEN: keyword "continue"/"next"/"go"/"继续"/"下一步"/"接下来"
  → S_PARSE      WHEN: no intent (max 1 clarify round)    DO: AskUserQuestion
  → S_FALLBACK   WHEN: clarification empty

S_STATE:
  → S_RANK       DO: A_INFER_LIFECYCLE

S_RANK:
  → S_PRESENT    DO: A_SCORE_CANDIDATES

S_LIST:
  → END          DO: 按 workflow 簇分组列出全部候选 + description

S_PRESENT:
  → END          WHEN: --dry-run
  → S_EXECUTE    WHEN: -y / --yes
  → S_CONFIRM    WHEN: not auto_mode

S_CONFIRM:
  → S_EXECUTE    WHEN: 用户确认 top pick / 选备选 / 改参数
  → END          WHEN: 用户取消

S_EXECUTE:
  → END          DO: Skill({ skill: <chosen>, args: <args> }) → 输出 "✅ 已执行 /<command>"

S_FALLBACK:
  → END          DO: raise E001

</transitions>

<actions>

### A_INFER_LIFECYCLE

读 project state 推断 `lifecycle_position`（核心信号）：

```bash
cat .workflow/state.json 2>$null              # phase / milestone / artifacts
ls -la .workflow/scratch/ 2>$null | head -10  # 最近 artifact (mtime DESC)
ls -la .workflow/.maestro/ 2>$null | head -5  # 进行中的 session
```

**项目状态 → lifecycle_position → 自然下一步：**

| 项目状态 | lifecycle_position | 自然下一步 |
|---------|-------------------|-----------|
| 无 `.workflow/` + 无源码 | brainstorm | `maestro-brainstorm` |
| 无 `.workflow/` + 有源码 | init | `maestro-init` |
| 有 state.json，无 roadmap，无 milestones | analyze-macro | `maestro-analyze` (宏观调研) |
| 有 macro analyze artifact，无 roadmap | roadmap | `maestro-roadmap` |
| 有 roadmap，未启动 phase | analyze | `maestro-analyze {phase}` |
| 最新 artifact = analyze | plan | `maestro-plan {phase}` |
| 最新 artifact = plan | execute | `maestro-execute {phase}` |
| 最新 artifact = execute | review | `quality-review {phase}` |
| review verdict=PASS | test-gen | `quality-auto-test {phase}` |
| 测试全绿 | milestone-audit | `maestro-milestone-audit` |
| 当前 milestone 全 phase 完成 | milestone-complete | `maestro-milestone-complete` |
| 任一 stage 产物含 gaps/failed | debug | `quality-debug {gap}` |

**Maestro Lifecycle 主线：**
```
brainstorm → blueprint → init → analyze-macro → roadmap
   → [per phase] analyze → plan → execute (includes verification)
   → [quality gate] review → auto-test → test
   → milestone-audit → milestone-complete → milestone-release
```

### A_SCORE_CANDIDATES

**评分信号**（高→低）：

| 信号 | 权重 | 说明 |
|------|------|------|
| intent 命中路由表关键词 | 高 | 字面匹配主依据 |
| **lifecycle 自然下一步** | **高** | 空 intent / "继续" / "next" 时为决定性 |
| `name` 关键词命中 intent | 中 | intent 含 "test" → quality-test/quality-auto-test 加分 |
| Workflow 簇匹配 | 中 | intent 涉及学习/知识/issue 等场景触发对应簇 |
| Recent activity 反向避免 | 低 | 刚完成的 stage 短期内降权 |

**特殊意图处理：**

| Intent 模式 | top pick |
|------------|---------|
| 空 / "继续" / "下一步" / "next" / "接下来" | lifecycle 自然下一步 |
| "什么状态" / "现在到哪了" / "status" | `manage-status` |
| 字面命中路由表 | 路由表优先（lifecycle 仅加分） |
| 无任何匹配 | lifecycle 下一步 + raise W002 |

**意图 → 命令路由表**（候选池）：

| 意图关键词 | 推荐命令 |
|-----------|---------|
| 头脑风暴 / 探索 / brainstorm / ideate | `maestro-brainstorm` |
| 规格 / 正式文档 / spec-generate / blueprint | `maestro-blueprint` |
| 分析 / analyze / 多维度调研 | `maestro-analyze` |
| 规划 / plan / 任务分解 | `maestro-plan` |
| 实现 / 执行 / execute | `maestro-execute` |
| 验证 / verify / 验收 | `maestro-execute` |
| 调试 / debug / 排查 / bug | `quality-debug` |
| 审查 / review / 代码审查 | `quality-review` |
| 测试 / test / UAT | `quality-test` / `quality-auto-test` |
| 重构 / refactor / 技术债 | `quality-refactor` |
| 同步文档 / sync docs | `quality-sync` |
| 回顾 / retro | `quality-retrospective` |
| issue / 缺陷管理 | `manage-issue` / `manage-issue-discover` |
| wiki / 知识图谱 | `manage-wiki` (含 connect/digest 子命令) |
| spec / 规则 / 约束 | `spec-load` / `spec-add` / `spec-setup` |
| 项目初始化 / init | `maestro-init` |
| 状态 / status / 仪表盘 | `manage-status` |
| 文档重建 / codebase 文档 | `manage-codebase-rebuild` / `quality-sync` |
| 安全 / security / OWASP | `security-audit` |
| 跟读 / 学习 / 阅读源码 | `learn-follow` / `learn-investigate` |
| 第二意见 / challenge / consult | `learn-second-opinion` |
| 提取知识 / harvest | `manage-harvest` / `manage-knowhow-capture` |
| 设计 / UI / 前端打磨 | `maestro-impeccable` |
| 里程碑 / milestone | `maestro-milestone-audit` / `maestro-milestone-release` / `maestro-milestone-complete` |
| fork / 分支 / 并行开发 | `maestro-fork` / `maestro-merge` |
| 覆盖层 / overlay / amend | `maestro-overlay` / `maestro-amend` |

**辅助 workflow 簇**（场景触发，非主线）：

| 簇 | 触发 | 主推链路 |
|----|------|---------|
| Learning | 接触新代码/未知模块 | `learn-follow` → `learn-decompose` → `learn-second-opinion` |
| Knowledge | 提炼经验 / 沉淀知识 | `manage-harvest` → `manage-knowhow-capture` → `spec-add` |
| Wiki | 知识图谱整理 | `manage-wiki health` → `manage-wiki connect` → `manage-wiki digest` |
| Issue | 缺陷管理 | `manage-issue-discover` → `manage-issue` |
| 文档同步 | 代码大改后 | `quality-sync` → `manage-codebase-rebuild` (if major) |
| 重构 | 技术债积累 | `quality-refactor` → `quality-review` |
| 发布 | 里程碑结束 | `maestro-milestone-audit` → `maestro-milestone-release` |
| 并行开发 | 多 milestone 并行 | `maestro-fork` → ... → `maestro-merge` |

输出 ranked candidates，取 top N（默认 3）。

</actions>

</state_machine>

<presentation>

### `--list` 模式

按 workflow 簇（主线 / Learning / Knowledge / Wiki / Issue / 文档 / 重构 / 发布 / 并行）分组展示全部候选 + description，结束。

### 正常模式

```
🎯 推荐 (top pick): /<command-name>
   <description>
   推荐理由: <命中规则 + lifecycle 位置一句话>

备选:
  2. /<alt-1> — <description>
  3. /<alt-2> — <description>

执行参数: <args>
```

`--dry-run` 展示后结束；`-y` 直接 S_EXECUTE；否则：

AskUserQuestion (single-select, header: "执行确认"):
- **执行推荐** (Recommended) — run top pick with shown args
- **选择备选** — pick from alternative commands
- **修改参数** — adjust args before executing
- **取消** — do nothing

</presentation>

<appendix>

### Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | intent 空且 clarification 后仍空 | 提供意图描述或使用 `--list` 浏览 |
| E002 | error | 候选池为空（`.claude/commands/` 缺失或无 .md） | 检查 commands 目录 |
| E003 | error | 选定命令名无法解析为有效 skill | 列出有效命令重选 |
| W001 | warning | top1 与 top2 得分差距 < 阈值 | 强制展示前 3 让用户裁决 |
| W002 | warning | intent 与所有候选匹配度均低 | 提示考虑 `/maestro` 或 `/maestro-ralph` 走管线 |

### Success Criteria

- [ ] Intent 解析 + flags 提取完成
- [ ] 读取 `.workflow/state.json` + scratch artifacts 推断 lifecycle_position
- [ ] 候选池等于路由表（管线编排器不在）
- [ ] 评分综合：intent 字面匹配 + lifecycle 下一步 + workflow 簇 + recent activity
- [ ] 空 intent / "继续" / "下一步" → 直接采用 lifecycle 推断的下一步
- [ ] top pick 展示附"推荐理由"（命中规则 + lifecycle 位置）
- [ ] `--dry-run` 仅展示，不执行
- [ ] `-y` 自动执行 top pick；用户传入时透传到 skill args
- [ ] 非自动模式通过 AskUserQuestion 确认或选备选
- [ ] 选定命令通过单次 `Skill()` 调用执行
- [ ] 不创建 session / 不生成 status.json / 不触发后续 chain
- [ ] `--list` 模式按 workflow 簇分组展示

</appendix>
