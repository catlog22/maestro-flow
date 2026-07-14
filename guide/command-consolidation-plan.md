---
title: "命令入口收敛规划 — 52 个命令 → 多入口分类 + 合并优化"
---

> 配套：`entry-workflow-merge-plan.md`（step 双文件迁移已完成）、`three-entry-migration-plan.md`（三入口定位）。
> 前提：14 个第一档 step 已迁入 `prepare/` + `workflows/`，对应命令已删除，`maestro-next` 已重写。

---

## 一、现状盘点（52 个命令，12977 行）

| 类别 | 数量 | 行数 | 问题 |
|------|---:|---:|------|
| Entry orchestrators | 11 | 5658 | Ralph 5 个变体中 2 个标 LEGACY；composer/player/swarm/universal 4 个功能高度重叠 |
| Session verbs | 4 | 514 | 精炼，无冗余 |
| Tools/utilities | 9 | 1703 | amend+overlay 重叠；tools-execute+tools-register 可合并 |
| Odyssey | 5 | 2179 | 5 个独立闭环，可收为一个分模式入口 |
| Manage | 11 | 1390 | 11 个子命令分散，可收为一个分子命令入口 |
| Learn/Spec/Other | 12 | 1533 | learn 4 个可合并；spec 4 个可合并 |

---

## 二、目标入口架构（52 → ~20）

```text
开发主线入口
  maestro-next        ← 14 step 的路由+执行（已完成）

编排入口
  maestro              ← 静态链编排（chain catalog）
  maestro-ralph        ← 自适应编排（合并 5 变体为 1）

长周期入口
  odyssey              ← 5 个闭环模式合为 1 个分模式入口

项目管理入口
  manage               ← 11 个子命令合为 1 个分子命令入口

学习入口
  learn                ← 4 个子命令合为 1 个

Session 动词（保留原位）
  maestro-init / maestro-fork / maestro-merge / maestro-session-seal

独立工具（保留或合并）
  maestro-impeccable   ← UI 设计（独立闭环，保留）
  maestro-collab       ← 多工具交叉验证（独立职能，保留）
  maestro-guard        ← 编辑边界管理（独立职能，保留）
  maestro-update       ← 版本升级（独立职能，保留）
  spec                 ← 4 个 spec-* 合为 1 个分子命令入口

淘汰
  amend + overlay      ← 合并为 1 个 overlay 工具
  tools-execute + tools-register ← 合并为 1 个 tools 工具
  composer / player / swarm / universal ← 吸收进 maestro 或 ralph
  ui-codify            ← 吸收进 impeccable
  domain-add           ← 吸收进 manage
```

---

## 三、逐批合并方案

### 3.1 Ralph 合并（5 → 1）

| 现文件 | 行数 | 处置 |
|------|---:|------|
| `maestro-ralph-v2.md` | 1174 | **基底**——标记为 RECOMMENDED，自适应编排引擎 |
| `maestro-ralph.md` | 920 | **删除**——标 LEGACY，v2 完全替代 |
| `maestro-ralph-cli.md` | 989 | **删除**——标 LEGACY，CLI 委托模式已内化到 v2 delegate 机制 |
| `maestro-ralph-cli-execute.md` | 247 | **降级为内部执行器**——v2 的 ralph-executor agent 已覆盖此功能；如需保留改为 `maestro-ralph-execute.md` 内部引用 |
| `maestro-ralph-execute.md` | 426 | **保留为 ralph 子执行器**（ralph agent 调用，非用户入口） |

合并后：用户入口 = `maestro-ralph.md`（原 v2 重命名），子执行器 = `maestro-ralph-execute.md`（内部）。

**实施步骤：**
1. `maestro-ralph-v2.md` → 重命名为 `maestro-ralph.md`（覆盖旧 LEGACY 版）
2. 删除 `maestro-ralph-cli.md`、`maestro-ralph-cli-execute.md`
3. `maestro-ralph-execute.md` frontmatter 标注 `internal: true`
4. 更新 `maestro.md` 和 `maestro-next.md` 中的引用

### 3.2 编排器合并（4 → 0，吸收进 maestro/ralph）

| 现文件 | 行数 | 处置 |
|------|---:|------|
| `maestro-composer.md` | 202 | **吸收进 maestro**——compose 能力是 maestro chain catalog 的子集 |
| `maestro-player.md` | 203 | **吸收进 maestro**——play = 从 catalog 选择并执行 |
| `maestro-swarm-workflow.md` | 290 | **吸收进 ralph**——并行加速是 ralph 的 `--engine agent` 模式 |
| `maestro-universal-workflow.md` | 640 | **吸收进 ralph**——动态 workflow 生成是 ralph 自适应的超集 |

合并后：编排入口 = `maestro.md`（静态链）+ `maestro-ralph.md`（自适应），无中间层。

### 3.3 Odyssey 合并（5 → 1）

5 个 odyssey 命令结构高度同构（archaeology → audit → fix → verify → generalize → knowledge），差异仅在领域维度：

| 现文件 | 模式名 | 领域差异 |
|------|------|------|
| `odyssey-debug.md` | `--mode debug` | 症状→根因→修复→确认 |
| `odyssey-improve.md` | `--mode improve` | 6 维审计→深度诊断→修复→泛化 |
| `odyssey-planex.md` | `--mode planex` | 需求→计划→执行→验证→修复循环 |
| `odyssey-review-test-fix.md` | `--mode review` | 多维审查→修复→零残留 |
| `odyssey-ui.md` | `--mode ui` | 视觉调查→发散探索→修复→验证 |

**合并为 `odyssey.md`**（单入口 + `--mode` 分发）：
1. 共享骨架（archaeology/fix/verify/generalize/knowledge 五阶段）提取为公共部分
2. 领域差异用 mode-specific section 分隔
3. 估算合并后 ~600 行（共享骨架 ~200 + 5 个 mode section 各 ~80）

### 3.4 Manage 合并（11 → 1）

11 个 manage 命令按功能分 4 个子命令组：

| 子命令 | 收编 | 调用形式 |
|------|------|------|
| `manage status` | manage-status | `/manage status` |
| `manage issue <sub>` | manage-issue + manage-issue-discover | `/manage issue create/list/discover` |
| `manage knowledge <sub>` | manage-knowhow + manage-knowhow-capture + manage-knowledge-audit + manage-harvest + manage-wiki + manage-kg-extractors | `/manage knowledge capture/audit/harvest/wiki/extractors` |
| `manage sync <sub>` | manage-drift-realign + manage-codebase-rebuild | `/manage sync drift/rebuild` |

**合并为 `manage.md`**（单入口 + 子命令路由）：
- frontmatter 声明子命令列表
- 每个子命令对应一个 section
- domain-add 归入 manage 的 knowledge 子组

### 3.5 Learn 合并（4 → 1）

| 子命令 | 收编 |
|------|------|
| `learn follow` | learn-follow |
| `learn investigate` | learn-investigate |
| `learn decompose` | learn-decompose |
| `learn consult` | learn-second-opinion |

**合并为 `learn.md`**（单入口 + 子命令）。

### 3.6 Spec 合并（4 → 1）

| 子命令 | 收编 |
|------|------|
| `spec add` | spec-add |
| `spec load` | spec-load |
| `spec remove` | spec-remove |
| `spec setup` | spec-setup |

**合并为 `spec.md`**（单入口 + 子命令）。

### 3.7 工具合并

| 现文件 | 处置 |
|------|------|
| `maestro-amend.md` + `maestro-overlay.md` | 合并为 `maestro-overlay.md`——amend 是 overlay 的特化（只改命令文件） |
| `maestro-tools-execute.md` + `maestro-tools-register.md` | 合并为 `maestro-tools.md`——register + execute 两子命令 |
| `maestro-ui-codify.md` | 吸收进 `maestro-impeccable.md` 作为 `--codify` 模式 |

---

## 四、合并后目标清单（~20 个命令）

| # | 命令 | 职能 | 来源 |
|---|------|------|------|
| 1 | `maestro-next` | 开发主线：14 step 路由+执行 + companion | 已完成 |
| 2 | `maestro` | 静态链编排 | 保留 + 吸收 composer/player |
| 3 | `maestro-ralph` | 自适应编排 | ralph-v2 重命名 + 吸收 swarm/universal |
| 4 | `maestro-ralph-execute` | ralph 内部子执行器 | 保留（internal） |
| 5 | `odyssey` | 长周期闭环（5 模式） | 合并 5 个 odyssey-* |
| 6 | `manage` | 项目管理（4 子命令组） | 合并 11 个 manage-* + domain-add |
| 7 | `learn` | 学习/探索（4 子命令） | 合并 4 个 learn-* |
| 8 | `spec` | 规则管理（4 子命令） | 合并 4 个 spec-* |
| 9 | `maestro-init` | 项目初始化 | 保留 |
| 10 | `maestro-fork` | 并行开发分支 | 保留 |
| 11 | `maestro-merge` | 分支合并 | 保留 |
| 12 | `maestro-session-seal` | session 封印 | 保留 |
| 13 | `maestro-impeccable` | UI 设计+codify | 保留 + 吸收 ui-codify |
| 14 | `maestro-collab` | 多工具交叉验证 | 保留 |
| 15 | `maestro-guard` | 编辑边界管理 | 保留 |
| 16 | `maestro-overlay` | 命令覆盖层 | 保留 + 吸收 amend |
| 17 | `maestro-tools` | 工具规格管理 | 合并 tools-execute + tools-register |
| 18 | `maestro-update` | 版本升级 | 保留 |
| 19 | `quality-refactor` | 重构（保留档） | 保留 |
| 20 | `quality-sync` | 文档同步（保留档） | 保留 |
| 21 | `security-audit` | 安全审计（保留档） | 保留 |

**削减统计**：52 → 21（-31 个，-60%）。预估行数从 12977 降至 ~7000（合并去重后进一步缩减）。

---

## 五、实施顺序与 Waves

| Wave | 动作 | 风险 | 验收 |
|------|------|------|------|
| 0 | Ralph 合并（5→1+1）——最高 ROI，消除 LEGACY 标记 | 低（v2 已标 RECOMMENDED） | ralph 全功能可用；旧入口无残留引用 |
| 1 | 编排器吸收（4→0）——composer/player/swarm/universal 逻辑并入 maestro/ralph | 中（需理解各自独特逻辑） | `maestro --compose/--play` 工作；swarm/universal 功能在 ralph 可达 |
| 2 | Odyssey 合并（5→1）——结构同构，合并最机械 | 低 | `odyssey --mode debug/improve/planex/review/ui` 全路径可用 |
| 3 | Manage 合并（11+1→1）——子命令路由 | 低 | `manage status/issue/knowledge/sync` 全子命令可用 |
| 4 | Learn + Spec 合并（4+4→2）——子命令路由 | 低 | `learn follow/investigate/decompose/consult` + `spec add/load/remove/setup` |
| 5 | 工具合并（amend+overlay / tools / ui-codify）——轻量 | 低 | 合并后功能无丢失 |

**每 wave 完成后 commit**，保证可回退。

---

## 六、合并规则（机械步骤）

每个合并执行同一套操作：

```
1. Read 所有源命令全文
2. 提取共享骨架（frontmatter schema、invariants、error codes、state machine 框架）
3. 差异部分按 --mode / subcommand 分 section
4. 写合并后的目标文件（frontmatter argument-hint 标注子命令/模式）
5. 更新其他命令中的引用（/old-name → /new-name subcommand）
6. 删除被吸收的源命令文件
7. 全仓 grep 确认零残留
```

**不做内容删减**：合并 = 重组织，不是重写。每个模式/子命令的领域逻辑原样保留，只提取公共部分消除重复。

---

> 本文件完成后与 `entry-workflow-merge-plan.md` 构成完整的命令层收敛方案。step 层已由双文件体系承载（14 对），命令层由本文件规划从 52 收敛到 21。
