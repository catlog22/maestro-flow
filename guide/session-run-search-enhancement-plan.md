---
title: "Session/Run 产物 × 知识系统增强规划 — WikiIndexer/Search 接入深化"
---

> 基线：`session-run-structure-guide.md`（v1.1 目标态）+ WikiIndexer 现有 Session/Run 适配层（`dashboard/src/server/wiki/virtual-wiki-adapters.ts`）。
> 结论：**管道已打通并端到端验证**（sealed Run → `maestro search` 可发现，见 `session-run-migration-verification.md` §49–50）——增强空间不在"接入"，而在于：① 产物中信噪比最高的 handoff 结构化字段完全没有进索引；② v1.1 schema 落地时适配器不同步会**静默退化**（前提项）。
> 原则：所有增强都在**读侧适配器**完成，不为搜索改动任何权威 schema；只索引 sealed/archived，与 aref 只解析 sealed 的规则一致。

---

## 一、现状盘点

| 环节 | 现状 | 位置 |
|------|------|------|
| CLI 搜索入口 | `maestro search` 直接实例化 dashboard 的 WikiIndexer——**增强单点，改索引器即改搜索** | `src/commands/search.ts:20,71-75` |
| Session/Run 适配层 | `loadRunModeSessionEntries`：只索引 sealed/archived；每个 run 一条 knowhow 型条目 | `virtual-wiki-adapters.ts:769` |
| run 条目 body | 拼接该 run 的 sealed artifact 正文（每文件截 50KB，排除 `role: report`） | `virtual-wiki-adapters.ts:731-766` |
| run 条目 summary | 三级回退：artifact JSON 的 `summary/verdict/conclusion/title/description` 键 → report.md frontmatter `summary` / `## 摘要` → `handoff.summary` | `virtual-wiki-adapters.ts:713-729` |
| 增量侦测 | mtime 覆盖 `session.json / artifacts.json / run.json / report.md / outputs/` | `wiki-indexer.ts:233` |
| BM25F 字段 | `title / summary / tags / body` 四字段加权 | `dashboard/src/server/wiki/search.ts:188` |
| 结构化 handoff 数据源 | runtime 已写入 `verdict/constraints/decisions/concerns`（frontmatter 派生） | `src/run/schemas.ts:161-173`、`src/run/report.ts:33-35` |
| schema 版本 | runtime 写 `command-run/1.0`，与适配器一致；指南为 v1.1 目标态 | `src/run/runtime.ts:546` |

---

## 二、差距清单

| # | 差距 | 影响 | 优先级 |
|---|------|------|:---:|
| 1 | v1.1 字段改名/删除未同步适配器（§三） | run 条目 body 采集被 try/catch 吞掉，**静默退化成空壳** | **P0** |
| 2 | `handoff.decisions/constraints/concerns/verdict` 不入索引（适配器只读 `summary` + `artifact_refs`，`virtual-wiki-adapters.ts:699`） | LLM 蒸馏过的最高信噪比知识不可搜 | **P1** |
| 3 | `RUN_COMMAND_CATEGORY` 仅映射 6 命令（`virtual-wiki-adapters.ts:664`），review/test/debug/retrospective/grill 缺失 | 这些 run 条目 category 为 null，`--category` 过滤失效 | **P1** |
| 4 | artifact kind 无搜索 facet | 无法按产物类型过滤（diagnosis / review-findings / lessons…） | P2 |
| 5 | `lifecycle.promoted[]` 无双向互链 | 提升后的 spec/knowhow 无法溯源到产出 session/run | P2 |
| 6 | aref 引用边未被利用 | report → artifact 的显式引用没有进 `related`/图谱 | P3 |
| 7 | gate waiver 无人消费 | "为什么豁免这条门"的 pitfall 知识流失 | P3 |

---

## 三、P0 — v1.1 适配器同步（前提项，防退化）

适配器现读 v1.0 schema；v1.1 落地时以下字段全部删除或改名。schema 未冻结 → **直接切换，不设兼容层**（与 `session-run-simplification-plan.md` 原则一致）。

| 适配器现读（v1.0，`virtual-wiki-adapters.ts:673-703`） | v1.1 | 处置 |
|------|------|------|
| `session.latest_completed_run_id` | **已删** | 改用 runs/ NNN 序末位（现有 `runEntries.at(-1)` 回退即够，删主路径） |
| `run.command.name` | `command: string` | 直读字符串 |
| `run.output.{produces, primary_artifact_id, verdict}` | 拍平为 `primary`；produces 由 `artifacts.json` 按 `run_id` 反查 | 反查 registry 收集 artifact 列表 |
| `artifact.producer_run_id` | `run_id` | 改名 |
| `artifact.relative_path` | `path` | 改名 |
| `run.completed_at / sealed_at` | `ended_at` | 改名 |
| `schema_version: 'command-run/1.0'` | `'run/1.1'` | 版本判别后按新键读取 |

> **追踪项**：此项须补入 `session-run-guide-v1.1-revision-checklist.md`——当前清单未覆盖 wiki 适配器同步。

---

## 四、P1 — handoff 结构化字段入索引

`decisions[status:accepted]` 正是 Knowhow 域定义的"决策记录"；`constraints[status:locked]` 天然是 spec 候选；`concerns` 是 open-question 线索。它们比 50KB artifact 正文信噪比高得多，但目前一个都不进索引。

**做法**：`readRunKnowledge` 在 body 拼接前 **prepend 一个结构化文本块**，不改索引 schema——BM25F 四字段自然加权：

| handoff 字段 | 进入 WikiEntry | 说明 |
|------|------|------|
| `verdict` | `tags`（如 `verdict:ready` / `verdict:blocked`） | 可按裁决过滤 |
| `decisions[].text` | body 前置 `## 决策` 段；accepted 条目首条补进 summary | 决策记录 = knowhow |
| `constraints[].text`（locked） | body 前置 `## 约束` 段 + tag `constraint` | spec 候选信号 |
| `concerns[]` | body 前置 `## 关注点` 段 | 检索未决问题 |

同步补全 `RUN_COMMAND_CATEGORY`：按指南 §八命令集补 `review→review`、`test→test`、`debug→debug`、`retrospective→learning`、`grill→arch`、`brainstorm/blueprint/roadmap` 校核。

---

## 五、P2 — kind facet 与 provenance 互链

### 5.1 kind facet

v1.1 "文件名 stem 即 kind"（指南 §7.1b）使产物自带类型标签，零成本获取：

- 适配器把该 run 产物的 kind 列表写入 `ext.kinds` 并追加进 `tags`；
- `src/commands/search.ts` 增加 `--kind <k>` 过滤（实现为 tags 匹配即可）；
- 直接受益：`maestro search "超时" --kind diagnosis`、`--kind review-findings`、`--kind lessons`。

retrospective 的 `lessons.json / patterns.json / anti-patterns.json` 本身就是知识条目，经 kind facet 即可作为知识候选被定向检索，无需格式转换。

### 5.2 provenance 双向互链

seal 时 `lifecycle.promoted[]`（`spec:…` / `knowhow:…` 前缀）记录了知识提升链：

- **正向**：session 条目的 `related` 追加被提升条目的 wiki ID；
- **反向**：finish-work 提升时在 spec/knowhow 条目写入 provenance（`sourceRef: {session_id}/{run_id}`），扫描时回填 `related` 指向 session 条目；
- 效果：搜到一条 spec 规则，能溯源"从哪次 debug/review 里来"。

---

## 六、P3 — aref 引用边与 gate waiver

- **aref 边**：正则提取 report.md 的 `{{aref:alias#pointer}}` 与 ` ```aref ` 块的 `source`，经 `artifacts.json` alias 解析到 artifact_id → 补进 run 条目 `related`，增强 `--kg` 图谱关联。只提边，不做完整渲染。
- **gate waiver**：`gates[]` 中 `status: waived` 且带 `waiver` 的条目，body 附加 `## 豁免` 段（waiver 原文 + gate title）。是否在 seal 时进一步生成 issue/knowhow 候选，留待独立决策，不在本规划范围。

---

## 七、非目标

| 不做 | 原因 |
|------|------|
| 索引 `events.ndjson` | 非权威、高频、可截断——与"只索引 sealed"设计冲突 |
| 索引 draft run/session | 与 aref 只解析 sealed 的规则一致；draft 内容不稳定 |
| 新建 `.workflow/wiki/` 物理目录 | 既有规则：WikiIndexer 直接索引现有目录（指南 §四） |
| 为搜索改动权威 schema | 所有增强在读侧适配器；`run.json`/`session.json`/`artifacts.json` 键集不因搜索需求增减 |

---

## 八、实施顺序与验证

| 阶段 | 内容 | 验证 |
|:---:|------|------|
| 1 | P0 适配器 v1.1 同步 + `RUN_COMMAND_CATEGORY` 补全 | `cd dashboard && npx vitest run src/server/wiki/wiki-indexer.test.ts`；复跑 `maestro search "Session Run pilot" --json --no-emb`（迁移验证 §49） |
| 2 | P1 handoff 字段入索引 | 新增 fixture：含 accepted decision / locked constraint 的 sealed run → 以 decision 文本为查询词命中该 run 条目 |
| 3 | P2 kind facet + provenance 互链 | `maestro search --kind diagnosis` 只返回含该 kind 的 run；spec 条目 `related` 含产出 session ID |
| 4 | P3 aref 边 + waiver 段 | 图谱边数断言；waived gate 的 run 条目 body 含 `## 豁免` |

> 阶段 1 是阶段 2–4 的前提：v1.1 字段错位不先修，后续所有 body/handoff 采集都建立在会退化的读取路径上。
