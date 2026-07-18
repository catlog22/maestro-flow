---
title: "知识回收指南"
icon: "🌾"
---

Maestro 知识回收系统将执行过程中产生的知识碎片从"会话临时文件"转化为"持久可检索的项目资产"。

---

## 一、概述

### 知识闭环

知识回收将执行产物中的碎片提取、分类路由、写入持久存储，再由下游命令消费后反哺新一轮执行，形成完整的知识闭环。三个阶段：**Extract**（`/maestro-manage knowledge harvest` 提取）→ **Route**（分类引擎自动路由）→ **Persist**（写入 wiki/spec/issue）。

### 三大知识存储

| 存储 | 路径 | 存什么 | 谁消费 |
|------|------|--------|--------|
| **Wiki** | `.workflow/wiki/` | 观察发现、通用洞察、知识图谱 | `/maestro-manage knowledge wiki connect`、`/maestro-manage knowledge wiki digest` |
| **Spec** | `.workflow/specs/` | 编码规范、架构决策、模式规则 | `/maestro-spec load`、Hook 自动注入 |
| **Issue** | `.workflow/issues/issues.jsonl` | 未解决的 bug、风险、待办 | `/maestro-manage issue`、`/maestro-ralph --engine swarm --script wf-analyze` |

### 与 knowhow 的关系

Harvest 提取的碎片路由到 wiki/spec/issue。Knowhow（`.workflow/knowhow/`）是独立的完整知识文档系统，由 `/maestro-manage knowledge capture` 主动创建，二者互补：**Harvest** = 被动回收，**Knowhow** = 主动捕获。

---

## 二、maestro-manage knowledge harvest 详解

### 命令语法

```bash
/maestro-manage knowledge harvest                                      # 扫描所有产物，交互选择
/maestro-manage knowledge harvest <session-id>                         # 回收指定会话
/maestro-manage knowledge harvest <path>                               # 回收指定目录
/maestro-manage knowledge harvest --recent 7                           # 只看最近 7 天
/maestro-manage knowledge harvest --source analysis                    # 只回收分析产物
/maestro-manage knowledge harvest <target> --to wiki                   # 强制全部路由到 wiki
/maestro-manage knowledge harvest <target> --dry-run                   # 预览，不写入
```

### 三种模式

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| **scan** | 无参数 | 扫描全部 Source Registry，列出可回收产物，交互选择 |
| **session** | 传入 session ID（如 `ANL-auth-20260410`、`WFS-xxx`） | 精确定位指定会话的产物 |
| **path** | 传入文件路径（如 `.workflow/.analysis/ANL-auth-20260410/`） | 从指定目录加载并提取 |

### Source Registry

| Source Type | 扫描路径 | 关键文件 |
|-------------|----------|----------|
| `analysis` | `.workflow/.analysis/ANL-*/` | `conclusions.json`、`*.md` |
| `brainstorm` | `.workflow/scratch/brainstorm-*/` | `guidance-specification.md` |
| `lite-plan` | `.workflow/.lite-plan/*/` | `plan.json`、`plan-overview.md` |
| `lite-fix` | `.workflow/.lite-fix/*/` | `fix-plan.json` |
| `debug` | `.workflow/.debug/*/` | `debug-log.md`、`hypothesis-*.md` |
| `scratchpad` | `.workflow/.scratchpad/` | `*.md`、`*.json` |
| `session` | `.workflow/active/WFS-*/` | `workflow-session.json` |
| `knowhow` | `.workflow/knowhow/` | `*.md`、`digest-*.md` |

用 `--source <type>` 限制只扫描某一类，`--source all` 扫描全部（默认）。

### 提取与分类

每种产物源有专门的提取模式：

| 产物源 | 提取什么 |
|--------|----------|
| analysis | findings（发现）、recommendations（建议）、risks（风险） |
| brainstorm | options（方案）、decision（决策）、trade-offs（权衡）、action items（待办） |
| lite-plan | tasks 的 rationale（决策）、dependencies（约束）、risks（风险） |
| lite-fix | root_cause（根因）、fix_strategy（修复策略）、verification（验证方式） |
| debug | 最终诊断、已验证假设、被否决假设及理由 |
| scratchpad | markdown 章节、带说明的代码块 |
| session | completed_tasks、key_decisions、deferred_items |

每个碎片被打上 category 标签，并赋予 confidence 分数（0.0-1.0）。`--min-confidence N`（默认 0.5）过滤低质量碎片。

### 路由分类规则

| Category | 默认路由 | 理由 |
|----------|----------|------|
| `finding` | wiki (note) | 观察发现归入知识图谱 |
| `decision` | wiki (spec) 或 spec (decision) | 架构决策 → spec ADR 或 wiki spec 条目 |
| `pattern` | spec (pattern) | 可复用代码模式 → 编码规范 |
| `bug` | issue 或 spec (bug) | 活跃 bug → issue；已修复 bug → spec 经验 |
| `risk` | issue | 未缓解风险 → 可追踪 issue |
| `task` | issue | 未完成工作 → 可追踪 issue |
| `knowhow` | wiki (knowhow) | 可泛化洞察 → wiki 知识 |
| `recommendation` | wiki (note) 或 issue | 可执行建议 → issue；信息性建议 → wiki |

用 `--to wiki|spec|issue` 强制覆盖自动分类。`--to auto`（默认）使用上述规则。

### 去重逻辑

写入前检查四级去重，保证幂等性：

1. **harvest-log.jsonl**：按 `fragment_id`（`HRV-{8 hex}`）查重
2. **wiki**：按标题搜索
3. **issues.jsonl**：按标题/描述匹配
4. **specs/learnings.md**：按内容匹配

重复碎片标记 `[SKIP-DUP]` 并记入 harvest report。

### 产物

| 产物 | 路径 | 说明 |
|------|------|------|
| harvest log | `.workflow/harvest/harvest-log.jsonl` | 每个路由项的溯源记录 |
| harvest report | `.workflow/harvest/harvest-report-{date}.md` | 本次回收的完整报告 |
| wiki entries | `.workflow/wiki/` | 路由到 wiki 的条目 |
| spec entries | `.workflow/specs/` | 路由到 spec 的条目 |
| issue entries | `.workflow/issues/issues.jsonl` | 路由到 issue 的条目 |

---

## 三、maestro-manage knowledge knowhow 详解

### 命令语法

```bash
/maestro-manage knowledge knowhow                                  # 列出全部（默认）
/maestro-manage knowledge knowhow search "认证流程"                  # 全文搜索
/maestro-manage knowledge knowhow view KNW-20260510-1430           # 查看指定条目
/maestro-manage knowledge knowhow edit MEMORY.md                   # 编辑系统记忆
/maestro-manage knowledge knowhow delete TIP-20260510-0900         # 删除（需确认）
/maestro-manage knowledge knowhow prune --tag deprecated --before 2026-04-01  # 批量清理
```

### 双存储架构

| 存储 | 路径 | 格式 | 索引 |
|------|------|------|------|
| **workflow** | `.workflow/knowhow/` | `{PREFIX}-*.md` | `.workflow/wiki-index.json`（WikiIndexer） |
| **system** | `~/.claude/projects/{project}/memory/` | `MEMORY.md` + topic `.md` 文件 | 无（平铺文件） |

Workflow 存储面向项目内知识，system 存储面向跨会话持久记忆。命令自动根据 ID 前缀判断操作哪个存储。

### 子命令与过滤标志

| 子命令 | 用途 |
|--------|------|
| `list` | 列出条目（支持 `--tag`、`--type`、`--store` 过滤） |
| `search <query>` | 全文搜索，按相关度排序 |
| `view <id\|file>` | 查看条目全文，自动识别存储 |
| `edit <file>` | 编辑系统记忆文件 |
| `delete <id\|file>` | 删除条目（需确认，`MEMORY.md` 受保护） |
| `prune` | 批量清理（需要至少一个过滤条件，支持 `--dry-run`） |

### 9 种 Knowhow 类型

| Type | Prefix | 用途 | 典型场景 |
|------|--------|------|----------|
| `session` | `KNW-` | 会话状态恢复 | 复杂任务结束、上下文切换前保存进度 |
| `template` | `TPL-` | 代码/配置模板 | 提取通用代码模式、保存样板代码 |
| `recipe` | `RCP-` | 分步操作指南 | 文档化操作流程、onboarding |
| `reference` | `REF-` | 外部文档摘要 | 导入 API 文档、保存 URL 总结 |
| `decision` | `DCS-` | 架构决策记录 | 非平凡的设计选择 |
| `tip` | `TIP-` | 快速提示 | 灵光一现、调试技巧 |
| `asset` | `AST-` | 代码资产 | API 契约、数据模型、prompt |
| `blueprint` | `BLP-` | 架构蓝图 | 模块架构设计 |
| `document` | `DOC-` | 通用文档 | 通用兜底类型 |

---

## 四、maestro-manage knowledge capture 详解

### 命令语法

```bash
/maestro-manage knowledge capture compact "认证模块开发进度"       # 会话压缩
/maestro-manage knowledge capture template                       # 交互式录入模板
/maestro-manage knowledge capture recipe "部署流程"                # 操作配方
/maestro-manage knowledge capture reference --source https://...  # 外部文档摘要
/maestro-manage knowledge capture decision                       # 架构决策记录
/maestro-manage knowledge capture tip "TypeScript 泛型推断陷阱"    # 快速提示
/maestro-manage knowledge capture                                # 交互选择（9 种类型）
```

### 捕获时机

| 时机 | 推荐类型 |
|------|----------|
| 复杂任务结束 | `compact` / `session` |
| 发现可复用代码模式 | `template` |
| 完成一个操作流程 | `recipe` |
| 查阅重要外部文档 | `reference` |
| 做出架构决策 | `decision` |
| 闪现灵感或技巧 | `tip` |
| 定义接口契约 | `asset` |
| 设计模块架构 | `blueprint` |

### 产物路径和命名规则

文件写入 `.workflow/knowhow/`，命名格式 `{PREFIX}-{YYYYMMDD}-{HHMM}.md`，带 YAML frontmatter（title、type、category、created、tags）。

### 类型路由

命令支持中英文 token 自动识别类型：

| Token | 类型 |
|-------|------|
| `compact`、`session`、`压缩`、`保存` | session |
| `template`、`tpl`、`模板` | template |
| `recipe`、`rcp`、`配方`、`步骤` | recipe |
| `reference`、`ref`、`参考`、`引用` | reference |
| `decision`、`dcs`、`决策`、`adr` | decision |
| `tip`、`note`、`记录`、`快速` | tip |
| `asset`、`ast`、`资产`、`契约` | asset |
| `blueprint`、`blp`、`蓝图` | blueprint |
| `document`、`doc`、`文档` | document |

---

## 五、知识流转全景

<details>
<summary>完整流程图</summary>

```
┌─────────────────────────────────────────────────────────┐
│                     执行阶段                             │
│  maestro-ralph → maestro-next → maestro-ralph continue  │
│       ↓              ↓                ↓                 │
│   ANL-xxx/       plan-xxx/       code changes           │
│   brainstorm/    lite-plan/      debug-log/             │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│                  知识回收                                │
│  /maestro-manage knowledge harvest                                        │
│  ├── Stage 1-2: 发现产物                                │
│  ├── Stage 3:   提取碎片（category + confidence）        │
│  ├── Stage 4:   分类路由（auto / forced）                │
│  ├── Stage 5:   预览确认                                │
│  ├── Stage 6:   写入目标存储 + 去重                      │
│  └── Stage 7-8: 去重检查 + 生成报告                      │
└────┬──────────┬──────────┬──────────────────────────────┘
     │          │          │
     ▼          ▼          ▼
  ┌──────┐  ┌──────┐  ┌────────┐
  │ Wiki │  │ Spec │  │ Issue  │
  └──┬───┘  └──┬───┘  └───┬────┘
     │         │          │
     ▼         ▼          ▼
┌─────────────────────────────────────────────────────────┐
│                   下游消费                                │
│  maestro-manage knowledge wiki connect / maestro-manage knowledge wiki digest / maestro-spec load / maestro-manage issue   │
│  Hook 自动注入 / maestro-next --gaps                     │
└─────────────────────────────────────────────────────────┘
```
</details>

### 主动知识捕获并行路径

```
执行过程 → /maestro-manage knowledge capture → .workflow/knowhow/ → wiki-index.json → 检索复用
```

### 与 learn-* 命令的协作

| 命令 | 产出 | 路由到 |
|------|------|--------|
| `/maestro-learn consult` | git 活动回顾、决策回顾 | `specs/learnings.md`（`<spec-entry>`） |
| `/maestro-learn decompose` | 任务分解经验 | knowhow（recipe） |
| `/maestro-learn investigate` | 调查过程记录 | knowhow（reference / tip） |
| `/maestro-learn follow` | 跟进学习记录 | knowhow（reference） |
| `/maestro-learn consult` | 多视角分析结果 | wiki / spec |

### 推荐工作流

| 场景 | 步骤 |
|------|------|
| **日常开发** | `/maestro-ralph continue` → 完成后随手记 → `/maestro-manage knowledge capture tip "发现的技巧"` |
| **里程碑结束** | `/maestro-manage knowledge harvest --recent 30` → `/maestro-manage knowledge capture compact` → `/maestro-manage knowledge wiki connect --fix` |
| **项目交接** | `/maestro-manage knowledge knowhow list` → `/maestro-manage knowledge knowhow search "核心概念"` → `/maestro-spec load --role implement` |
