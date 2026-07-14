---
title: "内容与文档放置规划 — 迁移后各类内容放在哪、谁加载、何时交付"
---

> 配套：`three-entry-migration-plan.md`（三入口迁移）与 `session-run-simplification-plan.md` §3.9a（三层拆分）/§7.2（统一注册表）。
> 回答一个问题：**入口收敛 + step 化之后，原来散落在命令文件和 workflow 文档里的内容，每一类放到哪里、由谁加载、在什么时刻交付给 LLM。**

---

## 一、三级存储模型

所有 maestro 分发内容遵守同一条链，**只在源码仓编辑**：

```text
源码仓 D:\maestro2\          ──install──▶  全局 ~/.maestro/        ──同名覆盖──  项目 .workflow/
（唯一编辑处）                            （运行时读取）                        （项目定制，优先）
```

- 禁止直接改 `~/.maestro/`（安装副本，install 会覆盖）；
- 项目级覆盖只放**该项目特有**的 step/gate/kind 定制，不复制全局内容；
- `.claude/commands/` 是宿主（Claude Code）的 Skill 入口面，与上述链并行：`.agy/`/`.agents/` 由脚本从 `.claude/` 自动生成，`.codex/` 手动同步。

---

## 二、内容类型归属总表

| # | 内容类型 | 现状位置 | 目标位置（源码仓 → 安装） | 项目覆盖 | 加载者 | 交付时刻 |
|---|------|------|------|:---:|------|------|
| 1 | **入口命令**（3 个：next / maestro / ralph） | `.claude/commands/` 8 个编排文件 | `.claude/commands/maestro-next.md` `maestro.md` `maestro-ralph.md` | — | 宿主 Skill 机制 | 用户调用时 |
| 2 | **step 定义**（第一档 14 个，双文件配对） | `.claude/commands/` 独立命令 + `workflows/` 领域文档 | `prepare/{name}.md`（YAML 头 + 思考材料）+ `workflows/{name}.md`（核心流程，无 YAML 头）→ `~/.maestro/steps/{prepare,workflow}/` | `.workflow/steps/{prepare,workflow}/` | **CLI**（唯一加载者） | prepare 文件→`maestro prepare`；workflow 文件→create 全量（合并规划 v2 §二） |
| 3 | **step 参考文档**（多消费方共享文档 + 产物模板） | `~/.maestro/workflows/{interview-mechanics,boundary-grill,finish-work}.md`、`templates/roadmap.md` | `ref/{name}.md` → `~/.maestro/steps/ref/` | `.workflow/steps/ref/` | CLI | create 返回 deferred 清单（path+摘要）；prep `reads` 选中项全文内嵌。单一 step 专属的领域文档（grill.md 等）**即 workflow 文件正文**，不入 ref/ |
| 4 | **协议文档** | `~/.maestro/workflows/run-mode.md` | **原位保留，协议单源**（按 v1.1 词汇修订） | — | CLI | create 返回包固定注入一次，brief 重附要点；prepare/workflow 文件禁止复述协议 |
| 5 | **入口专属编排文档** | `workflows/maestro.md`（chain catalog）、`maestro-super.md` | 并入对应入口命令正文或其 `ref/`；catalog 数据化进共享 scorer 素材 | — | 入口命令 | 入口执行时 |
| 6 | **命名门禁** | 无（新增） | `gates/{name}.yaml` → `~/.maestro/gates/` | `.workflow/gates/` | CLI | create/complete 解析即快照 |
| 7 | **kind 注册** | 无（新增） | `kinds/{kind}.yaml` → `~/.maestro/kinds/` | `.workflow/kinds/` | CLI | 扫描器校验时 |
| 8 | **通用准则文档** | `~/.maestro/workflows/coding-philosophy.md` `delegate-usage.md` | **原位保留**（非 run 体系，CLAUDE.md `@` 引用） | — | CLAUDE.md | 会话启动 |
| 9 | **第二/三档 skill** | `.claude/commands/` `.claude/skills/` | **原位保留**（team-* / odyssey-* / manage-* / spec-* 等） | — | 宿主 Skill 机制 | 用户调用时 |
| 10 | **session 动词** | `.claude/commands/` | 原位保留（init / session-seal / fork / merge）；`maestro-companion` **并入 next**（迁移规划 §1.3：`--suggest`/`--note`/`--promote` + 复杂度轻量通道） | — | 宿主 Skill 机制 | 用户调用时 |
| 11 | **设计文档**（本系列） | `guide/` | 原位保留，仅人读，不参与运行时 | — | 人 | — |
| 12 | **项目知识** | `.workflow/{specs,knowhow,issues,domain,codebase}/` | 不变 | 本身即项目级 | `maestro search/load` | 命令 Gate rule |
| 13 | **session 运行产物** | `.workflow/sessions/`（目标态） | 不变（指南 v1.1 §四） | 本身即项目级 | CLI | run 生命周期 |

---

## 三、workflows/ 现存文档分流表

原 `~/.maestro/workflows/` 按"内容类型归属总表"逐个分流：

| 现文件 | 去向 | 依据 |
|------|------|------|
| `run-mode.md` | **原位保留（协议单源）**，v1.1 词汇修订后由 create/brief 注入 | 类型 4：协议有且只有一份文档，零复述 |
| `analyze.md` `plan.md` `execute.md` `verify.md` `review.md` `test.md` `debug.md` | 现版 43 行 twin **下线**；`workflow/{name}.md` 正文从 **b73c6e00 回退版**（385–768 行）词汇清洗后恢复 | 合并规划 v2 规则 A（回退恢复为主） |
| `grill.md` `brainstorm.md` `blueprint.md` `roadmap-common.md` `quick.md` `auto-test.md` `retrospective.md` | 即 `workflow/{name}.md` 正文素材（未被压缩，剥离协议段落后迁入） | 合并规划 v2 规则 B |
| `interview-mechanics.md` `boundary-grill.md`、`templates/roadmap.md` | `ref/` | 类型 3：多消费方共享 / 产物模板，deferred 交付 |
| `finish-work.md` | **先回退恢复 145 行版**（现为 4 行占位空壳）再迁 `ref/`；各 workflow 收尾阶段一行引用点 | 类型 3 + 内容流失修复 |
| `issue.md` `learn.md` `knowhow.md` `sync.md` `refactor.md` `init.md` | 原位保留 | 消费方为保留档 skill（manage-* / quality-refactor / quality-sync / maestro-init） |
| `fork.md` `merge.md` `overlays.md` | 原位保留 | 服务于保留入口的 session 动词 / meta 工具（类型 9/10） |
| `maestro.md`（chain catalog）`maestro-super.md` | 并入 `maestro` 入口（catalog 数据化） | 类型 5 |
| `coding-philosophy.md` `delegate-usage.md` | 原位保留 | 类型 8：CLAUDE.md 全局引用 |
| 其余未列文件 | 按判定规则归类：被 step 引用 → `ref/`；被保留 skill 引用 → 原位；无人引用 → 删除候选（迁移时逐个盘点） | — |

**判定规则**（新内容写作时同样适用）：

```text
是协议说明？        → 只写 run-mode.md（单源），由 create/brief 注入，不在别处复述
是任务前思考材料？   → prepare/{name}.md（YAML 头 + 思考指引，prepare 交付）
只被一个 step 用？   → 该 step 的 workflow/{name}.md 正文（create 全量交付）
被多 step 共用/较长？ → ref/（参考层，deferred）
是可执行检查？       → gates/{name}.yaml
是跨项目准则？       → workflows/（CLAUDE.md 引用）
是设计决策记录？     → guide/（人读）或 maestro spec/knowhow（可检索）
```

---

## 四、guide/ 设计文档关系（本系列五份）

```text
session-hook-orchestration-FINAL.md（运行时协议全集，.scratchpad）
  └─▶ session-run-structure-guide.md          目标态定义（v1.1，唯一权威）
        ├─▶ session-run-simplification-plan.md 收敛论证 + §八实施顺序
        │     └─▶ three-entry-migration-plan.md 步骤 3/4 执行细案（三入口 + step 迁移 waves）
        │           └─▶ entry-workflow-merge-plan.md 命令 × workflow 内容合并细案（三形态配对 + 逐文件映射）
        ├─▶ session-run-guide-v1.1-revision-checklist.md 步骤 1 验收凭据
        └─▶ content-layout-plan.md（本文件）     内容放置说明
```

规则：**指南是唯一目标态权威**——规划/细案与指南冲突时改哪个都必须两边同步；清单类文档随所核对对象归档，不再更新。

---

## 五、迁移动作与验收（并入迁移规划 waves）

| Wave（对应迁移规划 §五） | 本文件相关动作 |
|------|------|
| 0 | CLI 实现注册表加载序（项目 `.workflow/` > 全局 `~/.maestro/`）；`ref/` 目录建立 |
| 1–4 | 每迁一个 step：正文入 `steps/`、领域文档入 `ref/`、frontmatter `refs:` 改相对路径、原命令删 required_reading |
| 5 | `run-mode.md` v1.1 词汇修订定稿（保留为协议单源）；workflows/ 分流收尾（§三表逐行核销）；`.codex/` 镜像重做（3 入口 + 保留档） |

验收：全仓 grep 无 `required_reading` 块残留（run-mode 由 create 注入而非 @ 引用）；每个 `ref/` 文件至少被一个 prepare 头 `refs:` 指向（孤儿即删除候选）；prepare 与 workflow 文件抽查无内容交叠；`~/.maestro/` 无手工编辑痕迹（与源码仓 install 结果一致）。
