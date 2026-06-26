---
name: maestro-next
description: "Single-command recommendation — pick the best next skill from the pool and execute it in-context"
argument-hint: "\"<intent>\" [-y] [--dry-run] [--top N] [--list]"
allowed-tools: Read, Bash, Glob, Grep, request_user_input
---

<purpose>
单链推荐：解析 intent + project state → 路由表评分 → 推荐**单个原子 skill** → 确认后**在协调器上下文直接调用** `$skill {args}`。

Entry points:
- **`$maestro-next "intent"`** — 推荐并确认后执行
- **`$maestro-next -y "intent"`** — 跳过确认直接执行 top pick
- **`$maestro-next --dry-run "intent"`** — 仅显示推荐
- **`$maestro-next --list`** — 仅列出可推荐 skill 池（按 workflow 簇分组）

Codex specifics:
- **No agent spawning** — top pick 直接在协调器上下文以 `$skill {args}` 形式调用，单次执行后结束
- **Skill pool discovery via CLI** — `maestro ralph skills --platform codex --json --quiet`（project `.codex/skills/` 覆盖 global `~/.codex/skills/`）
- **No session, no status.json, no goal** — 不调 `create_goal` / `update_plan`，由目标 skill 自行管理产出

</purpose>

<context>
$ARGUMENTS — 意图文本 + 可选 flags。

**Flags:**
- `-y, --yes` — 跳过确认，直接执行 top pick；若目标 skill 支持 `-y`，透传
- `--dry-run` — 仅显示推荐结果，不执行
- `--top N` — 显示前 N 个候选（默认 3）
- `--list` — 仅列出可推荐 skill 池（按 workflow 簇分组），不做推荐

**候选池：** 仅 A_SCORE_CANDIDATES 路由表中列出的 skill。管线编排器（`maestro` / `maestro-ralph*` / `maestro-player` / `maestro-composer`）**永远不在候选池**。

**State files:**
- `.workflow/state.json` — phase / milestone / artifact registry
- `.workflow/scratch/` — 最近 artifact（按 mtime 倒序定位 lifecycle）
- `.workflow/.maestro/` — 进行中的 session（仅作引用，不修改）
</context>

<invariants>
1. **不创建 session / 不写 status.json / 不调用 create_goal/update_plan** — 单次原子调用，产出由目标 skill 自行管理
2. **管线编排器不在候选池** — `maestro` / `maestro-ralph*` / `maestro-player` / `maestro-composer` 永远不会被推荐
3. **Skill 发现限定 codex 平台** — 通过 `maestro ralph skills --platform codex --json --quiet` 解析 `command_scope` + `command_path`（project 覆盖 global，限定 `.codex/skills/`）；未命中即 E003
4. **空 intent 或 "continue/next/go/继续/下一步/接下来"** → 直接采用 lifecycle_position 推断的自然下一步
5. **字面命中路由表优先** — lifecycle 仅作加分；命中失败时 lifecycle 上升为决定性信号
6. **In-context invocation** — top pick 以 `$skill-name {args}` 形式在协调器上下文直接调用，**禁止** spawn_agent / spawn_agents_on_csv / shell_exec 包装
7. **参数传递** — 默认 intent 原文作为第一个 arg；用户可在 S_CONFIRM 修改；`-y` 仅当用户传入时透传到 skill args
8. **`--list` 模式跳过 lifecycle 推断与评分**，仅按 workflow 簇分组列出全部候选
</invariants>

<state_machine>

<states>
S_PARSE     — 解析 ARGUMENTS、提取 flags                       PERSIST: —
S_STATE     — 读 project state、推断 lifecycle_position         PERSIST: —
S_RANK      — 路由表评分、生成 top-N candidates                 PERSIST: —
S_VALIDATE  — `ralph skills --platform codex` 校验 top picks    PERSIST: —
S_LIST      — `--list` 模式：分组展示候选池                     PERSIST: —
S_PRESENT   — 显示 top pick + 备选 + 推荐理由 + 执行参数        PERSIST: —
S_CONFIRM   — request_user_input 选择/修改参数（auto_mode 跳过） PERSIST: —
S_EXECUTE   — 在协调器上下文以 `$skill {args}` 直调              PERSIST: —
S_FALLBACK  — intent 空且 clarification 失败                    PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_LIST       WHEN: --list flag
  → S_STATE      WHEN: intent text present
  → S_STATE      WHEN: keyword "continue"/"next"/"go"/"继续"/"下一步"/"接下来"
  → S_PARSE      WHEN: no intent (max 1 clarify round)    DO: request_user_input
  → S_FALLBACK   WHEN: clarification empty

S_STATE:
  → S_RANK       DO: A_INFER_LIFECYCLE

S_RANK:
  → S_VALIDATE   DO: A_SCORE_CANDIDATES

S_VALIDATE:
  → S_PRESENT    WHEN: top pick 命中 codex skill 池          DO: A_RESOLVE_COMMAND_PATH
  → S_PRESENT    WHEN: top pick missing → 降级到下一个候选    DO: A_RESOLVE_COMMAND_PATH
  → S_FALLBACK   WHEN: top-N 全部 missing                    DO: raise E003

S_LIST:
  → END          DO: A_LIST_BY_CLUSTER

S_PRESENT:
  → END          WHEN: --dry-run
  → S_EXECUTE    WHEN: -y / --yes
  → S_CONFIRM    WHEN: not auto_mode

S_CONFIRM:
  → S_EXECUTE    WHEN: 用户确认 top pick / 选备选 / 改参数
  → END          WHEN: 用户取消

S_EXECUTE:
  → END          DO: A_INVOKE_SKILL → 输出 "✓ executed $<skill>"

S_FALLBACK:
  → END          DO: raise E001

</transitions>

<actions>

### A_INFER_LIFECYCLE

读 project state 推断 `lifecycle_position`（核心信号）：

```bash
cat .workflow/state.json 2>/dev/null              # phase / milestone / artifacts
ls -la .workflow/scratch/ 2>/dev/null | head -10  # 最近 artifact (mtime DESC)
ls -la .workflow/.maestro/ 2>/dev/null | head -5  # 进行中的 session
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
| 测试全绿 + current_milestone 存在 | milestone-audit | `maestro-milestone-audit` |
| 测试全绿 + current_milestone=null (standalone) | review-done | 回退到 `quality-review` 或 `manage-status`（无 milestone 上下文时不推荐 milestone 命令） |
| 当前 milestone 全 phase 完成 | milestone-complete | `maestro-milestone-complete` |
| 任一 stage 产物含 gaps/failed | debug | `quality-debug {gap}` |

**Maestro Lifecycle 主线：**
```
brainstorm → blueprint → init → analyze-macro → roadmap
   → [per phase] analyze → plan → execute
   → [quality gate] review → auto-test → test
   → milestone-audit → milestone-complete → milestone-release
```

### A_SCORE_CANDIDATES

**评分信号**（高→低）：

| 信号 | 权重 | 说明 |
|------|------|------|
| intent 命中路由表关键词 | 高 | 字面匹配主依据 |
| **lifecycle 自然下一步** | **高** | 空 intent / "continue" / "next" 时为决定性 |
| `name` 关键词命中 intent | 中 | intent 含 "test" → quality-test/quality-auto-test 加分 |
| Workflow 簇匹配 | 中 | intent 涉及学习/知识/issue 等场景触发对应簇 |
| Recent activity 反向避免 | 低 | 刚完成的 stage 短期内降权 |
| **前置条件不满足** | **禁止** | 候选 skill 的前置条件未满足时，直接从候选池移除（如 `maestro-milestone-*` 在 `current_milestone=null` 时移除） |

**前置条件检查（评分前执行，不满足则移除候选）：**

| Skill | 前置条件 |
|-------|---------|
| `maestro-milestone-audit` | `current_milestone` 存在且非 null |
| `maestro-milestone-complete` | `current_milestone` 存在且非 null |
| `maestro-milestone-release` | `current_milestone` 存在且非 null |
| `maestro-merge` | 存在活跃的 fork 分支 |

**特殊意图处理：**

| Intent 模式 | top pick |
|------------|---------|
| 空 / "continue" / "next" / "go" / "继续" / "下一步" / "接下来" | lifecycle 自然下一步 |
| "status" / "状态" / "现在到哪了" | `manage-status` |
| 字面命中路由表 | 路由表优先（lifecycle 仅加分） |
| 无任何匹配 | lifecycle 下一步 + raise W002 |

**意图 → skill 路由表**（候选池）：

| 意图关键词 | 推荐 skill |
|-----------|-----------|
| 头脑风暴 / 探索 / brainstorm / ideate | `maestro-brainstorm` |
| 规格 / 正式文档 / spec-generate / blueprint | `maestro-blueprint` |
| 分析 / analyze / 多维度调研 | `maestro-analyze` |
| 规划 / plan / 任务分解 | `maestro-plan` |
| 实现 / 执行 / execute | `maestro-execute` |
| 验证 / verify / 验收 | `quality-review` |
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

**辅助 workflow 簇**（场景触发，非主线）：

| 簇 | 触发 | 主推链路 |
|----|------|---------|
| Learning | 接触新代码/未知模块 | `learn-follow` → `learn-decompose` → `learn-second-opinion` |
| Knowledge | 提炼经验 / 沉淀知识 | `manage-harvest` → `manage-knowhow-capture` → `spec-add` |
| Wiki | 知识图谱整理 | `manage-wiki` → `wiki-connect` → `wiki-digest` |
| Issue | 缺陷管理 | `manage-issue-discover` → `manage-issue` |
| 文档同步 | 代码大改后 | `quality-sync` → `manage-codebase-refresh` |
| 重构 | 技术债积累 | `quality-refactor` → `quality-review` |
| 发布 | 里程碑结束 | `maestro-milestone-audit` → `maestro-milestone-release` |
| 并行开发 | 多 milestone 并行 | `maestro-fork` → ... → `maestro-merge` |

输出 ranked candidates，取 top N（默认 3）。

### A_RESOLVE_COMMAND_PATH

校验候选 skill 在 codex 平台可用：

1. `Bash("maestro ralph skills --platform codex --json --quiet")` — 一次性拉取 codex 可用 skills（project `.codex/skills/` 覆盖 global `~/.codex/skills/`）
2. 对每个 candidate 匹配 skill 名：
   - 命中 → `command_scope ∈ {global, project}`, `command_path = <abs SKILL.md path>`
   - 未命中 → `command_scope = "missing"`，从候选列表剔除
3. top pick missing → 降级到下一候选；top-N 全部 missing → S_FALLBACK 报 E003

### A_LIST_BY_CLUSTER

按 workflow 簇（**主线** / Learning / Knowledge / Wiki / Issue / 文档 / 重构 / 发布 / 并行）分组展示全部候选 + description。每项标 `[project|global]` scope，便于用户判断来源。

### A_INVOKE_SKILL

在协调器上下文以 `$skill-name {args}` 直接调用（**NO spawn_agent, NO shell_exec 包装**）：

1. 解析最终 args：
   - 默认：`{intent}`（原文，去除已识别的关键词如 "continue"）
   - 用户改过：使用用户输入
   - `-y` 透传：附加 `-y`（仅当用户传入且目标 skill 支持）
2. 在响应中直接写出调用指令，例如：`$maestro-analyze "优化登录流程"`
3. 读取目标 skill 产出后输出 `✓ executed $<skill-name>`
4. 不修改任何 `.workflow/` 文件；不创建 session；不触发后续 chain

</actions>

</state_machine>

<presentation>

### `--list` 模式

按 workflow 簇分组展示全部候选 + description + `[project|global]` scope，结束。

### 正常模式

```
🎯 推荐 (top pick): $<skill-name>  [project|global]
   <description>
   推荐理由: <命中规则 + lifecycle 位置一句话>

备选:
  2. $<alt-1>  [scope] — <description>
  3. $<alt-2>  [scope] — <description>

执行参数: <args>
```

`--dry-run` 展示后结束；`-y` 直接 S_EXECUTE；否则 `request_user_input` 提供：执行 top pick / 选备选 / 修改参数 / 取消。

</presentation>

<appendix>

### Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | intent 空且 clarification 后仍空 | 提供意图描述或使用 `--list` 浏览 |
| E002 | error | codex skill 池为空（`maestro ralph skills --platform codex` 无结果） | 检查 `.codex/skills/` 与 `~/.codex/skills/` |
| E003 | error | 选定命令在 codex 平台未命中（`command_scope == "missing"`） | 列出 codex 可用 skill 让用户重选 |
| W001 | warning | top1 与 top2 得分差距 < 阈值 | 强制展示前 3 让用户裁决 |
| W002 | warning | intent 与所有候选匹配度均低 | 提示考虑 `$maestro` 或 `$maestro-ralph` 走管线 |

### Success Criteria

- [ ] Intent 解析 + flags 提取完成
- [ ] 读取 `.workflow/state.json` + scratch artifacts 推断 lifecycle_position
- [ ] 候选池等于路由表（管线编排器不在）
- [ ] 评分综合：intent 字面匹配 + lifecycle 下一步 + workflow 簇 + recent activity
- [ ] 空 intent / "continue" / "next" → 直接采用 lifecycle 推断的下一步
- [ ] top pick 展示附"推荐理由"（命中规则 + lifecycle 位置）
- [ ] `maestro ralph skills --platform codex --json --quiet` 校验 top picks；missing 降级到下一候选
- [ ] `--dry-run` 仅展示，不执行
- [ ] `-y` 自动执行 top pick；用户传入时透传到 skill args
- [ ] 非自动模式通过 `request_user_input` 确认或选备选
- [ ] 选定 skill 在协调器上下文以 `$skill {args}` 直调（NO spawn_agent / NO shell_exec 包装）
- [ ] 不创建 session / 不生成 status.json / 不调用 create_goal/update_plan / 不触发后续 chain
- [ ] `--list` 模式按 workflow 簇分组展示，每项标 `[project|global]` scope

</appendix>
