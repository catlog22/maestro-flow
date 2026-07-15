---
title: "基线指南 v1.1 修订核对清单 — session-run-structure-guide.md"
---

> 执行依据：`session-run-simplification-plan.md` §八步骤 1（修订基线指南）。
> 范围：仅 `session-run-structure-guide.md` 一个文件；命令重构与 CLI 修改未执行（规划 §八步骤 2–4 暂缓）。
> 用法：逐行核对"指南位置 → 修改内容 → 规划出处 → 核对要点"；全部 ✅ 后本清单归档，作为步骤 2–4 的对照基准。

---

## 一、修改清单

### 头部与总览章节

| # | 指南位置 | 修改内容 | 规划出处 | 核对要点 | 状态 |
|---|------|------|------|------|:---:|
| 1 | 文件头引言块 | 新增修订版声明：schema `*/1.1`、四文件删除、生命周期扩展、"入口重组与 CLI/命令修改不在本文件展开" | 规划前言 | 声明与规划 §八步骤 1 范围一致 | ✅ |
| 2 | §二主线 5 | 权威集合 `session.json+gates.json+run.json` → `session.json+run.json`（+`artifacts.json` Registry） | §2.3 | 与 §九权威表、§四目录树三处一致 | ✅ |
| 3 | §三顶层对照表 | 新增行：`steps/ gates/ kinds/`（项目级注册表覆盖） | §7.2 | 与 §四目录树同名目录一致 | ✅ |

### §四 目标目录树

| # | 指南位置 | 修改内容 | 规划出处 | 核对要点 | 状态 |
|---|------|------|------|------|:---:|
| 4 | §四目录树 | 删 session 级 `gates.json`/`evidence.json`/`context.md`，删 run 级 `diagnostics.ndjson` | §2.1 | 树中不再出现四文件；新增删除说明引用块 | ✅ |
| 5 | §四目录树 | 新增 `steps/ gates/ kinds/` 行；`evidence/`/`work/`/session `specs/ knowhow/` 标注惰性 | §2.2 §7.2 | 惰性规则写入目录规则 bullet | ✅ |
| 6 | §四目录规则 | 新增"最小 Run = run.json + report.md + outputs/"；`work/` 清理动词 Seal → complete | §2.2 | 与 §七 Run 外壳一致 | ✅ |

### §五 项目级 state.json

| # | 指南位置 | 修改内容 | 规划出处 | 核对要点 | 状态 |
|---|------|------|------|------|:---:|
| 7 | §五 schema | `session_id`→`id`；`roadmap_artifact_id`+`seed_ref` 合并为 `seed` | §3.1 | 键名与规划 ProjectState 逐字段一致 | ✅ |
| 8 | §五末尾 | 新增**状态权威规则**：planned 前 state.json 唯一持有；物化后降级为 CLI 缓存，冲突以 session.json 为准 | §3.1 | 消除 session status 双真相源（原审核发现 1） | ✅ |
| 9 | §五 bullet | `accumulated_context` 承接者从 `evidence.json` 改为 run handoff + 项目级 specs | §2.1 | 不再引用已废文件 | ✅ |

### §六 Session 级文件（整节重写）

| # | 指南位置 | 修改内容 | 规划出处 | 核对要点 | 状态 |
|---|------|------|------|------|:---:|
| 10 | §六文件表 | 6 文件 → 2 权威 JSON + 1 审计流；`context.md` 行改为 `session render` 按需输出 | §2.1 | 表行数与目录树一致 | ✅ |
| 11 | §6.1 | `session/1.1`：双 revision → 单 `revision`（identity 缓存键 = CLI 计算 hash）；删 `latest_completed_run_id`/`refs`；新增 `gates: GateRecord[]`；orchestration 子键精简（删 inserted_by/decision_ref/evidence_ref/max_retries）；requests 键名缩短；lifecycle `promoted[]` 合并 + `forked_from` 字符串化 | §3.2 | 顶层键数 14→11（schema_version 含在内）；每处删除有注释说明去向 | ✅ |
| 12 | §6.2 | `gates.json` schema 整节替换为 **GateRecord 内联记录**：6 键（删 key/scope/run_id/required/applicable_modes/evidence_refs）、check 7 型→4 型、`source` 枚举（contract/prepared/handoff）、waiver 字符串化 | §3.4 | GateRecord 与规划 §3.4 逐键一致；产物型门派生规则 + 命名门快照规则入注 | ✅ |
| 13 | §6.3 | `artifacts/1.1`：条目 11 键→7 键（删 revision/media_type/size/schema_version/derived_from）；**权威性定位修正**——删"可 rescan 重建"表述，rescan 降级为校验/修复 | §3.5 | 与 §九权威表的 artifacts 行一致（原审核发现 3） | ✅ |
| 14 | §6.4 | `evidence.json` schema 整节替换为**废除说明**：四类 record kind 按"事实诞生地"归位表 + 跨 run 决策视图由 CLI 折叠提供 | §2.1 | decision/gate/finding/confirmation 四类均有明确归宿 | ✅ |

### §七 Run 级文件（核心重写）

| # | 指南位置 | 修改内容 | 规划出处 | 核对要点 | 状态 |
|---|------|------|------|------|:---:|
| 15 | §七 Run 外壳树 | 删 `diagnostics.ndjson`；`evidence/`/`work/` 标惰性；`report.md` 注释改双相定位；补"最小 Run"说明 | §2.1 §2.2 | 与 §四目录树一致 | ✅ |
| 16 | §7.1 | `run/1.1`：13 键→10 键——删 sequence/session_id/command 对象 4 子键/context_identity_revision/output 对象/gate_ids；新增 `goal`；`gates[]` 内联；`primary` 拍平；时间戳合并 `ended_at` | §3.3 | 每处删除有注释说明去向；`goal` 标注净增键 | ✅ |
| 17 | §7.1a | 三类 JSON 表更新（协议状态行去 gates.json，交接行改"handoff·动态 gate"）；流程 3 步 → **prepare→create→brief→complete 5 步**；prep 字段及落点内嵌（goal/gates 进协议，approach/scope/risks 预生成 report 骨架，reads 全文内嵌）；门禁可见性改"记录求值移出视野、判据主动告知"；host_tools 投影镜像注 | §3.8 §3.9 §3.9a | 5 步流程与规划 §3.9 图一致；无 `run start`/`run seal`/`run check` 残留 | ✅ |
| 18 | §7.1b | 标题与正文改**文件名即 kind、`_meta` 仅覆盖**；扫描器算法换规划版（含 alias 取 contract.produces）；`_meta` 保留字声明；同名异义处理原则（改文件名而非长期覆盖） | §4.1 | `_meta` 无"必填 ✅"残留；alias 声明权归 contract | ✅ |
| 19 | §7.3 | Builder 图 seal→complete、去 evidence.json 分支、补 report 定格分支；Handoff schema 10 键→7 键（删 schema_version/producer_run_id/command/details/evidence_refs；caveats+open_questions→concerns；子项去 id；needs 改名） | §3.6 | 与规划 Handoff 接口逐键一致；locked constraints/needs 接线注释在场 | ✅ |
| 20 | §7.4 | 规则 2 诊断落点 diagnostics→events；规则 5 改**读取时渲染**——源文件保留 `{{aref:…}}` 占位符，删"可从 handoff+artifacts 重建、丢失无害"声明 | §4.3 | 修复 report.md 循环定位（原审核发现 2） | ✅ |
| 21 | §7.5 | 必学键 7→5 + 可选 constraints/gates；示例改**块式 YAML + text 加引号**；新增 **report.md 双相定位**段（complete 前权威输入/后定格 + prep 骨架预生成）；派生表更新（decisions 直映射 handoff、gates→GateRecord、locked→session 门）；删 `produces:` 逃生口；修正 findigns 笔误 | §4.2 §4.3 §3.9a | frontmatter 键集与规划 §4.2 一致；无流式映射示例残留 | ✅ |

### §八–§十三 与尾注

| # | 指南位置 | 修改内容 | 规划出处 | 核对要点 | 状态 |
|---|------|------|------|------|:---:|
| 22 | §八 analyze 行 | "verdict 入 `run.json.output`" → `run.json.handoff`（残留修复） | §3.3 | output 对象全文无残留 | ✅ |
| 23 | §八 quality-review 行 | 产物改名 `review-findings.json` + 同名异义说明 | §3.7 | 与 §7.1b 同名异义原则呼应 | ✅ |
| 24 | §八 ralph 行 | "gates.json + evidence.json" → "内联 gates"（残留修复） | §2.1 | — | ✅ |
| 25 | §九权威表 | 重排：2+1 权威（session/run + Registry）；report.md 双相行；render 输出行；context.md/gates/evidence 行删除；"删除的通用重复文件"补 gates/evidence 映射、result.json 去向改 primary/handoff | §2.3 §3.5 §4.3 | 与 §二主线 5、§六文件表三处一致 | ✅ |
| 26 | §十生命周期 | `run seal` → `run complete`（含动态门求值说明） | §3.9 | 动词全文统一：prepare/create/brief/complete | ✅ |
| 27 | §十一废除表 | 新增 6 行：gates/evidence 独立账本、context.md+diagnostics、`_meta` 必填、空 gates 样板、`run check` 动词、run-mode.md 协议文档 | §2.1 §3.7 §4.1 §3.9a | 每行给出替代方案 | ✅ |
| 28 | §十二命名 | Gate ID 补 session 级 `GATE-S-{NN}` | §3.4 | 与 §6.2 GateRecord 注释一致 | ✅ |
| 29 | §十三落地要点 | 第 2 条 v1.0→v1.1；新增第 7 条：入口重组/三档分类/注册表指向规划 §七，命令与 CLI 不在本次范围 | §七 §八 | 范围边界声明清晰 | ✅ |
| 30 | 尾注 | 新增 v1.1 修订来源行（指向简化规划） | — | 溯源链完整：FINAL → 指南 → 规划 | ✅ |
| 31 | WikiIndexer Session/Run 读侧适配器 | 同步 `session/1.1`、`artifacts/1.1`、`run/1.1` 字段并直接拒绝 v1.0；跟踪 handoff、kind/provenance、aref/waiver 搜索增强 | `session-run-search-enhancement-plan.md` P0–P3 | v1.1 fixture 覆盖 NNN latest、sealed-only、互链、BM25 命中与 cache invalidation；focused test 通过 | ✅ |

---

## 二、残留扫描记录

| 轮次 | 扫描模式 | 结果 |
|---|------|------|
| 1 | `gates.json / evidence.json / diagnostics.ndjson / context.md / run (start\|seal) / command-run/1.0 / gates/1.0 / evidence/1.0 / caveats / open_questions / identity_revision / latest_completed / producer_run_id / required_artifact_refs / evidence_refs` | 命中均为有意保留（删除说明、"原键名"注释、废除表）；发现 2 处真实残留 → 清单 #22 #24 修复 |
| 2 | `seal 时 / run seal / maestro run start / session/1.0 / artifacts/1.0 / command-handoff / uat.md 作 / required: boolean / require_status` | 仅 1 命中（"seal 时刻 events 有记录"，合法表述），无残留 |

---

## 三、本次未执行（规划 §八 步骤 2–4，待指令）

| 步骤 | 内容 | 关键项 |
|---|------|------|
| 2 CLI 收敛 | `run create/complete` 新 schema；删 gates/evidence 代码路径；新增 `prepare`/`brief` 只读动词 + `create --prep`；正文分页器；`run check` 废除 | 求值器 7 型→4 型；统一 Builder 三视图 |
| 3 命令批量微调 | 按规划 §六映射表；第一档 step **跳过薄壳**直接并入步骤 4 | `_meta` 删除、frontmatter 5 键模板、quality-review 产物改名 |
| 4 入口层重组 | §7.8 A–D：steps 注册表 → next 重写 → ralph 合并 5 变体 → 入口文件下线 | `.codex/` 镜像手动同步单独跟进 |
