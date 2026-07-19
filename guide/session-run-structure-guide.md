---
title: ".workflow/ 文件体系变更方案 — Session/Run 模型"
---

> 本方案从 `session-hook-orchestration-FINAL.md` 中**仅提炼文件体系变更**（目录、文件、关键 schema 字段），剥离 Hook 注入、强制力内核、Watcher、并发/CAS、成本控制等运行时协议——那些机制见 FINAL 原文。
> 基线（当前态）：`workflow-structure-guide.md`（`scratch/` + `milestone/phase` 模型）。
> 目标态：Session → Run → Artifact 三级数据模型。
> 目的：同一 Session 连续跑 analyze/plan/execute/review/test/debug，每次调用独立 Run 目录不互污，下游经 typed artifact 消费，恢复不依赖 `mtime latest`。
> **当前 runtime addendum（schema `session/1.3` + `command-run/1.3`）**：本文件保留早期 `*/1.1` 文件体系设计背景，但 §6.1、§7.1 与 §7.1c 以当前 writer、transition receipt、paused recovery 和 machine response 为准；兼容 reader 接受 1.0–1.3，未知版本 fail closed。

---

## 一、方案范围

| 覆盖（文件体系） | 不覆盖（运行时协议，见 FINAL） |
|------|------|
| 目录树 current → target 对照 | Hook 注入策略 / Context Envelope（§7 §32） |
| 项目级 `state.json` 瘦身 | 强制力三层 L1/L2/L3（§3.8） |
| Session 级新增文件 + 精简 schema | File Watcher（§9） |
| Run 固定外壳 + `run.json`/`handoff` | 跨文件事务 / 锁序 / revision CAS（§13） |
| 各命令产物迁移映射 | 门禁求值逻辑 / Transition 授权（§10 §27） |
| 权威性分层、生命周期、废除模式 | 成本 KPI / Resume Packet（§33） |
| 命名规则 | Session 注册 / Host 身份解析（独立系统） |

---

## 二、五条变更主线

| # | 当前态 | 目标态 | 影响 |
|---|--------|--------|------|
| 1 | `scratch/{date}-{type}-{slug}/` 扁平目录 | `sessions/{id}/runs/{date}-{NNN}-{command}/` 两级层次 | 每次调用独立 Run，不再共用目录 |
| 2 | `milestones/` + `phases/` 物理层 + `state.json.milestones[]` | `state.json.sessions[]` **session DAG** | milestone/phase 概念删除，session 是唯一工作单元 |
| 3 | `context.md` / `context-package.json` / 自然语言 Next Step 多套 handoff | `run.json.handoff`（机器）+ `report.md`（人类·aref）双投影 | 文本与产物结合、同源不重复（§七） |
| 4 | `state.json.artifacts[]`（项目根数组） | 每 session `artifacts.json`（ID + alias） | latest 不靠数组尾项，靠 alias |
| 5 | `state.json` / Ralph `status.json` / scratch 多真相源 | 分层权威：`session.json`+`run.json`（+`artifacts.json` Registry）权威，`events.ndjson` 非权威，index/render 可重建 | 恢复真相源唯一 |

---

## 三、顶层目录对照

| 当前 `.workflow/` | 目标 `.workflow/` | 说明 |
|---|---|---|
| `state.json`（含 artifacts/milestones） | `state.json`（active_session_id + sessions DAG） | 瘦身，见 §五 |
| `project.md` `config.json` | 同 | 不变 |
| `roadmap.md`（项目根） | 移入 roadmap Run 的 `outputs/roadmap.{json,md}` | roadmap 成为 session-run |
| `specs/ knowhow/ issues/ domain/ codebase/` | 同 | 项目级知识，不变 |
| `wiki-index.json` `search-cache.json` | 同（可重建投影） | 不变 |
| `scratch/` | **删除** → `sessions/{id}/runs/` | 见 §六 §八 |
| `milestones/` | **删除** → `state.json.sessions[]` | milestone 坍缩进 session |
| `phases/` | **删除** → session DAG | phase 概念移除 |
| `plans/` `research/` `active/` | **删除** → Run `outputs/` / `tmp/` | 归入 Run 或临时区 |
| `.maestro/*/status.json` | **删除** → `session.json.orchestration` | Ralph 不再有第二真相源 |
| `.analysis/ .brainstorm/ .debug/ .lite-plan/` 等隐藏会话目录 | **删除** → 统一 Run | 命令不再各建私有目录 |
| （无） | `sessions/`（新增，核心） | 见 §六 |
| （无） | `steps/ gates/ kinds/`（新增，项目级注册表覆盖） | step/命名门禁/artifact kind，覆盖 `~/.maestro/` 全局注册表（简化规划 §7.2） |
| （无） | `tmp/`（新增，可删临时区） | hook 去重缓存 + 事务 intent |

> 保留不动：`kg/`（MaestroGraph SQLite）、`domain/`、`collab/`（人类团队协作）、`impeccable/`、`.team/`（Agent 总线）——均非 session 产物。

---

## 四、目标目录树

```text
.workflow/
├── state.json                      # 项目级：active_session_id + session DAG（无 milestone）
├── project.md  config.json         # 项目定义与配置
├── specs/ codebase/ knowhow/        # 项目级知识（跨会话）
│   issues/ domain/
├── steps/ gates/ kinds/            # 项目级注册表覆盖（简化规划 §7.2）
├── wiki-index.json                 # 可重建统一索引；非真相源
├── sessions/
│   ├── index.json                  # 可重建 Session 摘要索引；惰性重建
│   └── {YYYYMMDD}-{intent-slug}/
│       ├── session.json            # 权威：Session State（含 session 级 gates + orchestration）
│       ├── artifacts.json          # 权威：产物 Registry（ID + alias）
│       ├── events.ndjson           # 非权威：高频审计流（吸收 run 诊断），可截断归档
│       ├── specs/ knowhow/         # 本 Session 形成的知识候选/已确认（惰性）
│       └── runs/
│           └── {YYYYMMDD}-{NNN}-{command}/
│               ├── run.json        # 权威：元信息 + goal + gates + input/output + handoff
│               ├── report.md       # LLM 书写源 → complete 后定格为不可变产物
│               ├── outputs/        # 权威：command-specific 正式产物
│               ├── evidence/       # 非正式 traces（惰性，不参与门禁）
│               └── work/           # 临时草稿（惰性），complete 时清理
└── tmp/                            # 可删临时区（.gitignore）
    ├── hook/{host_session_id}.json # Hook 去重缓存
    └── txn/{txn_id}.intent         # 事务意图声明
```

> 已删除（v1.1 收敛）：session 级 `gates.json`（门禁内联 `run.json.gates[]` / `session.json.gates[]`）、`evidence.json`（decisions 留在 handoff，gate 结果/waiver 在 gate 记录，确认类走 events）、`context.md`（`maestro session render` 按需输出，不落盘）；run 级 `diagnostics.ndjson`（并入 session `events.ndjson`，事件带 `run_id`）。

**目录规则**：

- `sessions/{id}/` 路径全生命周期稳定，不随 active/sealed/archived 移动；
- 正式产物只进所属 Run 的 `outputs/`；`work/` 与 `tmp/` 都不承载正式产物；
- `runs/*/evidence/`（非正式 traces，不参与门禁）、`runs/*/work/`、session `specs/ knowhow/` **惰性创建**——最小 Run = `run.json` + `report.md` + `outputs/`；正式 evidence-role 产物写入 `outputs/`（与 prepare 合约对齐）；
- `runs/*/work/` 是单 Run 草稿（complete 清理）；`tmp/` 是跨 Run/Session 可抛弃区（保留 7 天）；
- 命令**不得**直接 append/edit 权威 JSON——由单一写入所有者（SessionStore）批量事务写入；
- `sessions/index.json`、`wiki-index.json` 惰性重建，不参与写入仲裁；
- 不建 `.workflow/wiki/` 物理目录——WikiIndexer 直接索引 `specs/`/`knowhow/`/`issues/`/`domain/`/`codebase/` 与 sealed Session。

---

## 五、项目级 `state.json` 瘦身

**当前 V2.0** 承载 `milestones[]` + `current_milestone` + `current_phase` + `artifacts[]` + `accumulated_context`。
**目标 V2.0** 只承载项目默认指针 + session 依赖图；artifact/门禁/证据下沉到各 session。

```ts
interface ProjectState {
  version: '2.0';
  project_name: string;
  active_session_id: string | null;      // 唯一项目级 active 指针（仅 maestro session activate 可改）
  sessions: Array<{
    id: string;                           // {YYYYMMDD}-{slug}
    intent: string;
    status: 'planned' | 'running' | 'paused' | 'sealed' | 'archived' | 'failed';
    depends_on: string[];                 // 上游 session id（全 sealed 才 dep-ready）
    seed: string | null;                  // roadmap 产出的结构化种子 artifact ref（ref 已含 producer，来源可溯）
  }>;
  // 删除：milestones[] / current_milestone / current_phase / artifacts[] / accumulated_context
}
```

- **“现在到哪了”** = `sessions[]` 中哪些 sealed、哪些 dep-ready（`depends_on` 全 sealed 且 `status:'planned'`）；
- **并行** = DAG 中依赖就绪的多个独立 session（worktree 隔离），不再需要 milestone 层；
- `accumulated_context` 的职责由各 run 的 handoff（decisions/concerns）+ 项目级 `specs/` 承接。

**状态权威规则（消除双真相源）**：session 目录物化前（`planned`），`state.json` 是该 session 状态的唯一持有者；目录物化后，`sessions[].status` 降级为 **CLI 同步的缓存**，权威以 `session.json.status` 为准，读侧冲突时以 session.json 覆盖。

---

## 六、Session 级文件

每个 `sessions/{id}/` 含 **2 份权威 JSON + 1 份审计流**（v1.1 收敛：原 `gates.json`/`evidence.json`/`context.md` 已废，见 §6.4）。

| 文件 | 权威性 | 写入者 | 职责 |
|------|--------|--------|------|
| `session.json` | 权威 | SessionStore | identity + revision + session 级 gates + orchestration + requests + lifecycle |
| `artifacts.json` | 权威 | Artifact Runtime | Artifact ID → path/kind/status/hash + aliases |
| `events.ndjson` | 非权威 | 各执行者 append | 高频审计事件流（含 run 诊断，带 `run_id`）；seal 可归档 |
| （`maestro session render`） | 投影 | CLI 按需输出 | 人类展示，stdout/`tmp/`，**不落盘持久文件** |

### 6.1 `session.json`（当前 writer schema `session/1.3`）

```ts
interface SessionState {
  schema_version: 'session/1.3';
  session_id: string;                     // {YYYYMMDD}-{intent-slug}
  intent: string;
  status: 'running' | 'paused' | 'sealed' | 'archived' | 'failed';
  identity_revision: number;              // identity/boundary CAS fence
  activity_revision: number;              // lifecycle/orchestration CAS fence

  active_run_id: string | null;
  latest_completed_run_id: string | null;

  boundary_contract: {
    in_scope: string[]; out_of_scope: string[];
    constraints: string[]; definition_of_done: string;
  };

  orchestration: {
    engine: 'ralph' | 'coordinator' | 'manual';
    quality_mode: 'quick' | 'standard' | 'full';
    auto_mode: boolean;
    chain: Array<{ step_id: string; command: string; status: string; run_id: string | null }>;
    decision_points: Array<{ point_id: string; status: string; retry_count: number }>;
    position: object | null;
    decomposition: object | null;
    lease: { owner: string | null; epoch: number; id: string | null } | null;
    executor: object | null;
  };

  // Mutation authority：transition request + outcome receipt；legacy request 仅兼容读
  requests: Array<PersistedTransitionRecord | LegacySessionRequest>;

  intent_identity: object | null;
  topic_identity: object | null;
  provenance: object;
  ralph_authority: object | null;

  lifecycle: {
    sealed_at: string | null; seal_summary: string | null;
    promoted_spec_ids: string[];
    promoted_knowhow_ids: string[];
    forked_from: { session_id: string; run_id: string } | null;
  };
  refs: { gates: 'gates.json'; artifacts: 'artifacts.json'; evidence: 'evidence.json' };
}
```

`PersistedTransitionRecord` 使用 `transition-request/1.0` 与 `transition-outcome/1.0`：request 固化 `request_id`、operation、subject、normalized request hash、precondition fence 与 payload；outcome 固化 `transition_id`、applied/rejected、postcondition fence、exit/error、result hash 与 result。replay 前必须重算 request/result hash，并交叉核对 record/payload/outcome 的 request、status、operation、subject、request hash 与 claimed Run。`complete` request 另存 report、declared outputs、extra artifacts 的 `complete-input-snapshot/1.0`，排除 apply 会更新的 `run.json`/`state.json` authority；重放时当前字节漂移返回 `FENCE_CONFLICT`。

### 6.2 `GateRecord`（内联记录，取代 `gates.json`）

Gate 本就是 run 作用域（ID `GATE-{run-seq}-{NN}`）——运行时记录**内联**在宿主文件：run 级门在 `run.json.gates[]`，session 级门在 `session.json.gates[]`（ID `GATE-S-{NN}`），所在位置即作用域，无独立账本。

```ts
interface GateRecord {
  id: string;                          // GATE-{run-seq}-{NN}；session 级 GATE-S-{NN}
  title: string;
  blocking: boolean;                   // 合并原 required + blocking（语义重叠）
  status: 'pending' | 'passed' | 'failed' | 'waived' | 'skipped';   // 求值瞬时，无 running；blocked 是 run 的状态
  check:                               // 4 型 union（原 7 型收敛）
    | { type: 'artifact'; kind: string; alias?: string; schema?: string }   // 吸收原 schema 型
    | { type: 'file';     path: string; exists: boolean }                   // 吸收原 session 型
    | { type: 'command';  argv: string[]; expect_exit: number }
    | { type: 'manual';   prompt: string }                                  // 吸收原 decision 型
  waiver: string | null;               // "reason (approved_by @ date)"；结构化审计走 events
  source?: 'contract' | 'prepared' | 'handoff';   // 缺省 contract；prepared/handoff = LLM 动态提议（简化规划 §3.8/§3.9）
}
```

> **产物型门禁不单独声明**——由 contract 的 `consumes`（required → entry gate）与 `produces`（primary → exit gate）派生；contract 的 `gates:` 是 opt-in 扩展位，仅放 command/manual/file 型检查，支持按名引用注册表门（简化规划 §3.7/§7.2）。不适用的 Gate 以 `status:'skipped'` 留痕，区分“未要求”与“漏检”。命名门解析即快照进宿主文件，注册表事后修改不回溯。

### 6.3 `artifacts.json`（schema `artifacts/1.1`）

```ts
interface ArtifactRegistry {
  schema_version: 'artifacts/1.1';
  artifacts: Record<string /*artifact_id*/, {
    kind: string;                          // task-collection/session-spec/session-knowhow… 归入 kind
    role: 'primary' | 'evidence' | 'report' | 'attachment';
    run_id: string;                        // 原 producer_run_id
    path: string;                          // 原 relative_path
    hash: string;                          // 原 content_hash
    status: 'draft' | 'sealed' | 'invalid' | 'superseded';
    replaces: string | null;
    // 已删：revision（单写者原子写）/ media_type（扩展名可推）/ size（stat 可查）
    //       schema_version（产物 _meta 或缺省约定持有）/ derived_from（consumes 已表达 lineage）
  }>;
  aliases: Record<string, string>;         // current-analysis / current-plan / latest-verification…
}
```

> Artifact 用稳定 ID + alias 表达 latest，**不用数组位置**。
> **注册从 push 变 pull + 自描述**：LLM 直写 `outputs/`，kind 缺省取文件名 stem（`_meta`/frontmatter 仅覆盖用，§7.1b）；complete 时 CLI 扫描 `outputs/` → 自发现 kind/role → 算 hash → 建索引 → 更新 alias。
> **权威性定位**：`artifacts.json` 是**权威**——`aliases`、`status`、`replaces` 链由 transition rule 裁决，无法从 outputs 扫描重建；`rescan` 仅是校验/修复手段（对账 path/hash/kind）。contract 的 `produces` 是可选的交叉校验（warn on mismatch），新命令不加 contract 也能跑（§7.1b）。

### 6.4 `evidence.json` 已废除（v1.1）

它的每类记录都不以它为原点，按"事实诞生地"归位：

| 原 record kind | 归宿 |
|------|------|
| `decision` | `run.json.handoff.decisions[]`（frontmatter 派生，不再二次落盘） |
| `gate` 结果 / waiver | `run.json.gates[]` / `session.json.gates[]`——gate 记录本身就是证据 |
| `finding` / `observation` | 领域产物 `outputs/*.json`（本就是 typed artifact 的职责） |
| `confirmation` / 范围变更 | `events.ndjson` 留痕 + `boundary_contract` 变更 |

> 跨 run 的"当前决策视图"由 CLI 按 NNN 序折叠 `runs/*/run.json.handoff.decisions[]` 提供（可重建投影，如 `maestro session decisions`）；长篇 rationale 住 `report.md` 叙述（complete 后定格为不可变产物，作证据载体可靠）。

---

## 七、Run 级文件（取代 scratch 目录）

所有命令（Grill/Analyze/Plan/Execute/Review/Test/Debug/verify…）遵守同一 Run 外壳：

```text
runs/{YYYYMMDD}-{NNN}-{command}/
├── run.json              # 权威·骨架：goal + gates + 消费什么 → 产出什么 → 交给谁（不含领域正文）
├── report.md            # LLM 书写源（frontmatter + 叙述）；complete 后定格为不可变产物（§7.5）
├── outputs/             # 权威·领域真相：json 产物 + 交付物 md（见 §八）
├── evidence/            # 证据·附件（惰性）：日志/截图/trace/测试报告（非结构化）
└── work/                # 临时草稿（惰性），complete 时清理，不进 Registry
```

> 最小 Run = `run.json` + `report.md` + `outputs/`；`diagnostics.ndjson` 已废（诊断/成本事件并入 session `events.ndjson`，带 `run_id`）。

**三者职责互斥**——同一事实只存一处，`report.md` 只引用不拷贝：

| 文件 | 存什么 | 不存什么 |
|------|--------|---------|
| `run.json` | 调用骨架：input/gate/output/handoff 的**引用与状态** | 领域正文、人类叙述 |
| `outputs/*.json` | 领域真相（plan/findings/diagnosis…） | 调用元信息、跨命令合约 |
| `report.md` | 人类叙述 + 对上二者的**引用**（aref） | 任何 json 数值的**拷贝** |

### 7.1 `run.json` 表示什么

`run.json` 是一次调用的**合约骨架（spine）**，不是领域结果容器。它只回答三个问题：

1. **消费什么** — `input.consumes[]`（上游 artifact ref）；
2. **过了什么门 / 现在什么状态** — `status` + `gate_ids[]`；
3. **产出什么、怎么交接** — `output.produces[]` + `primary_artifact_id` + `handoff`。

领域正文在 `outputs/*.json`，人类叙述在 `report.md`；`run.json` 只持有指向它们的**引用**。因此 run.json 恒定短小、结构稳定，是恢复与下游消费的唯一机读入口。

```ts
interface CommandRun {
  schema_version: 'command-run/1.3';
  session_id: string;
  run_id: string;
  sequence: number;
  parent_run_id: string | null;
  command: { name: string; version: string; source_path: string; content_hash: string; resolved_prompt_hash: string; contract_hash?: string };
  status: 'created' | 'running' | 'blocked' | 'failed' | 'completed' | 'sealed';
  input: { args: string[]; consumes: string[]; context_identity_revision: number; reuse_assessments: object[] };
  gate_ids: string[];
  output: { produces: string[]; primary_artifact_id: string | null; verdict: string | null };
  handoff: Handoff | null;
  resolved_platform: string;
  contract_snapshot: object | null;
  guidance_snapshot: object | null;
  creation_decision: object | null;
  creation_provenance: object;
  transition: { transition_id: string; request_id: string; outcome_hash: string } | null;
  started_at: string; completed_at: string | null; sealed_at: string | null;
}
```

Reader compatibility is `command-run/1.0`–`command-run/1.3`; older generations are normalized to the 1.3 read shape. Unknown Run schema versions are rejected instead of being guessed.

### 7.1a 三类 JSON · 三种归属 · 零协议学习

Run 涉及的所有 JSON 按**归属**分三类——LLM 接触面收敛到"直写领域文件 + prep YAML + 一个 md frontmatter"：

| 类别 | 例子 | 谁写 | 怎么写 | LLM 学 schema? |
|------|------|------|--------|:-:|
| **领域产物** | `outputs/plan.json` · `findings.json` · `diagnosis.json` | **LLM** | `Write` 直写（它本来就产这些） | **否** |
| **协议状态** | `run.json` · `artifacts.json` · `session.json` | **CLI/Hook** | create/complete 时**扫描 outputs/ + 读 prep/frontmatter → 派生** | **从不接触** |
| **交接/门禁提议** | `handoff` · 动态 gate | **LLM → CLI** | LLM 写 prep YAML / report.md frontmatter → CLI 派生到协议文件 | **否**（就是 YAML） |

关键转变：**注册从"push 声明"变"pull 派生"**。LLM 不声明 produces、不拼协议 JSON、不学 GateRecord schema。CLI 在 complete 时读盘扫描 `outputs/`，自己算 hash、建 artifacts.json、更新 alias。门禁的**记录与求值**移出 LLM 视野（entry 在 create、exit 在 complete 由 CLI 内部求值，无独立 check 动词），但**判据主动告知**——create 返回包附 gates 清单（YAML 摘要），LLM 知情、对照工作、不管理（fail-early，避免干完活才撞门）。

LLM 眼里的全流程（**零协议 schema 学习**，prepare 可选——不带 `--prep` 的 create 退化为仅 contract 派生门、`goal: null`）：

```text
1. maestro run prepare <cmd> [args]        # 只读、幂等、不建目录：返回思考材料——
   → 结构层 YAML（purpose/invariants/contract 摘要）+ upstream aliases
     + boundary_contract + session 级门 + 参考文档清单

2. LLM 任务前思考 → 写 prep YAML：
   goal（必填→run.json.goal）· gates（→GateRecord source:prepared）
   · approach/scope/risks（→预生成 report.md 骨架，不进协议 JSON）
   · reads（选中的参考文档在出生包全文内嵌）

3. maestro run create <cmd> --prep <yaml>  # 事务性出生：建 run + 注册 contract/prepared 门 + 求值 entry
   ← 出生包：run_dir + upstream{alias→path} + goal 回显 + gates 摘要
            + 执行正文（全量）+ run-mode.md 协议正文（固定注入一次，协议单源）
            + 参考文档 deferred 清单（path+摘要，按需 Read）

4. LLM 直接干活：
   · Read upstream[].path                   ← 读上游 typed json
   · Write outputs/*.json                   ← 直写，无 schema 学习成本
   · Write report.md（含 frontmatter，§7.5）
   （中途可选）maestro run brief <run>       ← brief-result/1.0：Session authority + guidance drift + execution contract + 完整 run-mode.md，防压缩遗忘

5. maestro run complete <run>              ← 只传 run id
   → CLI 扫 outputs/ → 派生 artifacts.json
   → CLI 读 report.md frontmatter → 派生 run.json.handoff + 追加 gate（source:handoff）
   → CLI 求值全部 exit 门 → 更新 alias → seal
```

> prepare/create/brief 返回包由同一 Builder 组装；prepare 的宿主感知（`host_tools`：goal/gates 同步登记到 Codex plan 工具 / Claude Code TaskCreate 作**投影镜像**，CLI 从不读取宿主工具状态）与动态门禁完整规则见简化规划 §3.8/§3.9。

### 7.1b 产物自描述：文件名即 kind，`_meta` 仅覆盖

CLI 扫描 `outputs/` 时不依赖 contract 判定文件身份——**文件名 stem 即 kind**（`outputs/findings.json` → kind `findings`；交付物 md 的 `outputs/{kind}.md` 同约定，§7.2）。`_meta`（JSON）/ frontmatter（md）从必填降为**完全可选的覆盖机制**——仅在同一 Run 产出同 kind 多文件、或需非常规 schema 版本时才写。

**扫描器算法**

```text
for file in outputs/*（report.md 除外）:
  kind   = _meta.kind / frontmatter.kind ?? 文件名 stem
  schema = _meta.schema ?? "{kind}/1.0"          # 缺省约定
  role   = _meta.role ?? 推断（目录唯一 json → primary，其余 → attachment）
  alias  = contract.produces[].alias             # 定义端声明，LLM 运行时零负担
  → register in artifacts.json
```

**覆盖示例**（仅特殊情况需要）：

```json
{ "_meta": { "kind": "review-findings", "schema": "review-findings/2.0", "role": "primary" }, "findings": [...] }
```

**保留字**：领域 schema 不得占用顶层 `_meta` 键。

**contract 的 `produces` 是可选的交叉校验**：
- contract 声明的文件未产出 → warn（"预期 outputs/plan.json 未找到"）
- 产出了 contract 未声明的文件 → info（正常——自发现仍注册）
- 无 contract → 完全依赖文件名自发现，零配置可用

> 新命令不加 contract 也能跑——文件名自带 kind，扫描器自发现，门禁列表为空（全 `skipped`）。contract 是渐进式质量约束，不是启动前提。同名异义即冲突信号：文件名 stem 与 kind 不一致时应改文件名（如 review 的产物命名 `review-findings.json`），而非依赖 `_meta` 长期覆盖。

### 7.1c CLI transition、paused recovery 与 machine matrix

Canonical paused recovery 是两段式状态转换：`maestro session resolve` 处置一个 decision/failed-step blocker 后保持 `paused`，`maestro session resume` 只在所有 blocker 清空后转为 `running`。两者都要求 exact `--session`、`--request-id`、`--actor`、`--reason`、一个或多个 `--evidence`、expected identity/activity revision，并可带 lease triple；两者都不创建 Run。恢复后的 chain 只能由显式 `maestro run next` 分配和绑定下一个 Run。

所有 receipt-backed mutation 都先校验 revision/lease fence，再把 request/outcome 写入 `session.json.requests[]`；Run 只保存必要的 transition pointer。`resolve`、`resume`、`decide`、`chain-insert`、`chain-replace`、`chain-skip`、`meta-update` 的 machine success 从 receipt 投影 applied/replayed `transition_id` 和 `request_id`。

显式 `--json` 的完整 `run-response/1.0` operation matrix 为：`create`、`next`、`complete`、`brief`、`recall`、`fork`、`import`、`check`、`decide`、`seal-session`、`resolve`、`resume`、`chain-insert`、`chain-replace`、`chain-skip`、`meta-update`、`accept-reuse`。每次 machine invocation 只向 stdout 写一行 envelope，stderr 为空，process status 等于 envelope `exit_code`；Commander usage 同样返回 `COMMANDER_USAGE` envelope。`accept-reuse` 必须提供 actor、reason 和至少一个 evidence；`seal-session` 非 receipt-backed，成功时 `replay: null`。

### 7.2 md 产物统一命名

当前各命令散落 `discussion.md`/`analysis.md`/`reflection.md`/`understanding.md`/`guidance.md`… 命名随命令漂移。按 md 的**语义角色**收敛为两类：

| 类别 | 命名 | 权威性 | 说明 |
|------|------|--------|------|
| **过程叙述**（讨论/复盘/理解） | 每 Run 唯一 `report.md` 的固定小节 | 投影 | 取代 discussion.md/reflection.md/understanding.md——它们变成 `report.md` 的 `## 讨论` / `## 复盘` 小节 |
| **交付物**（md 本身即产品） | `outputs/{kind}.md` | 权威（Artifact） | prd.md / architecture.md / roadmap.md / product-brief.md / guidance.md，注册为 typed Artifact，经 handoff 交接 |

规则：

1. **每个 Run 恰好一份过程 md = `report.md`**；命令特定的散文是它的小节，不再新建文件。
2. **交付物 md = `outputs/{kind}.md`**，`{kind}` 取自 Artifact kind 注册表，与 json 产物一样进 Registry。
3. **命令间人类交接永远看 `report.md`，机器交接永远看 `run.json.handoff`**——两个名字全局固定，不随命令变。

> `report.md` 固定骨架（渲染模板）：`## 摘要` · `## 结论/Verdict` · `## 讨论/复盘`（过程叙述位）· `## 产物`（aref 表）· `## 交接/Next`。命令只填小节内容，不改文件名与骨架。

### 7.3 交接：文本与产物结合

交接有**机器**与**人类**两条路径，同源于 `outputs/*.json` + `report.md` frontmatter，由 complete 时同一 Builder 派生：

```text
complete → Builder ├─ 扫描 outputs/ → artifacts.json（hash/alias）
                   ├─ 读 report.md frontmatter → run.json.handoff（机器合约）+ 追加 gate（source:handoff）
                   └─ report.md 定格为不可变产物（role: report）
```

- **机器路径**：下游命令读 `run.json.handoff.artifact_refs[]` → 经 `artifacts.json` 定位 → 直接拿 typed json，**不解析散文**。
- **人类/Envelope 路径**：读 `report.md`（经 `maestro run render` 按需解析 aref）——叙述与数据**结合在一处但不重复**（数值仍只存在于 json）。

**LLM 不直接构造 `handoff` JSON**——它只写 `report.md` 的 YAML frontmatter（§7.5）；complete 时 CLI 从 frontmatter 字段派生 `run.json.handoff`，从 `outputs/` 扫描结果派生 `artifact_refs[]`。`handoff` 的完整 schema（CLI 派生目标，非 LLM 书写目标；schema_version/producer_run_id/command 已删——宿主 run.json 全部持有）：

```ts
interface Handoff {
  verdict: 'ready' | 'ready_with_concerns' | 'blocked' | 'failed';
  summary: string;                                         // 一句话；展开在 report.md
  constraints: Array<{ text: string; status: 'locked' | 'open' | 'deferred' }>;   // locked 条目派生 session 级门（简化规划 §3.8）
  decisions: Array<{ text: string; status: 'proposed' | 'accepted' | 'rejected' }>;  // id 由 CLI 按序派生（C1/D1…），LLM 不写
  concerns: string[];                                      // 合并原 caveats + open_questions（消费侧从未区分）
  artifact_refs: string[];                                 // CLI 从 outputs 扫描自动填充
  next: Array<{ command: string; reason: string; needs: string[] }>;   // needs 接线为下游动态 entry gate
  // details 已删：开放 Record 与 typed 原则矛盾，领域扩展进 outputs/*.json
}
```

**不变量**：`handoff` 与 `report.md` 都不拷贝领域数值，只引用 artifact——json 是唯一真相源，改 json（新 revision）→ 重渲染两者自动一致（reference, don't duplicate）。

### 7.4 `aref` 引用语法（md → json）

`report.md` 及任何 md 交付物用 **artifact reference（`aref`）** 引用 json 产物，基于 *alias/ID + JSON Pointer(RFC 6901)*。两种形态：

**内联标量**（嵌进句子）：

```md
本次规划置信度 {{aref:current-plan#/confidence}}，覆盖 {{aref:current-plan#/task_ids/-}} 个任务；
根因见 {{aref:latest-debug#/diagnosis/0/summary}}。
```

**块级片段**（渲染表格/列表）：

````md
```aref
source: current-plan            # alias 或 artifact_id
pointer: /waves                 # JSON Pointer，指向数组/对象
as: table                       # table | list | value | json
columns: [id, name, task_ids]   # as:table 可选列
```
````

**解析器规则**：

1. `source` 解析序：本 Session `artifacts.json` alias → 全局 artifact_id；
2. `pointer` 为 RFC 6901 JSON Pointer；越界/类型不符 → 渲染 `⟨aref 失效: source#pointer⟩` 占位并记 `events.ndjson`，**不静默**；
3. 只解析 **sealed** artifact；引用 draft 渲染警告；
4. 渲染时快照被引 artifact 的 `content_hash`；hash 变 → 标 stale → 重渲染（与 §33 Code Anchor 同机制）；
5. 渲染是**读取时投影**（`maestro run render <run>` 输出解析副本到 stdout/`tmp/`）：源文件永远保留 `{{aref:…}}` 占位符，不就地替换——`report.md` 源文件含叙述正文与占位模板，是不可替代的产物（§7.5），**不宣称可重建**。

> **语法选型**：`{{aref:…}}` 内联 + ` ```aref  ` 块级——markdown 友好、不破坏高亮、易 AST 解析；路径用标准 JSON Pointer，不自造 DSL。备选 `artifact://alias#pointer` 链接式语义等价，但内联标量场景笨重，未采用。

### 7.5 `report.md` frontmatter（LLM 的半结构化出口）

LLM 不接触任何协议 JSON——运行时"结构化"的活收敛到 `report.md` 的 YAML frontmatter（加上任务前的 prep YAML，§7.1a）。complete 时 CLI 从 frontmatter 派生 `run.json.handoff` 与追加门。

**report.md 的双相定位**：complete **前**它是权威输入（frontmatter + 叙述正文，LLM 书写源，create 时 CLI 可按 prep YAML 预生成骨架——摘要预填 approach、concerns 预填 risks）；complete **后**定格为不可变产物（注册 `role: report`），修订须生成新 report Artifact 保审计链。

**LLM 写作目标**（必学键 5 个：`verdict` `summary` `decisions` `concerns` `next`；可选键：`constraints`（grill/analyze 类）、`gates`（动态门追加提议）。**一律块式 YAML，text 值加引号**——流式映射 `{ text: 含逗号即碎 }`）：

```md
---
verdict: ready
summary: "M1 认证规划完成，12 任务 / 3 波"
constraints:
  - text: "采用 stateless JWT"
    status: locked
decisions:
  - text: "Redis 做 session 缓存"
    status: accepted
concerns:
  - "未覆盖 OAuth2 device flow"
next:
  - { command: execute, reason: "plan sealed", needs: [current-plan] }
---
## 摘要
本次规划围绕 M1 认证模块展开…
```

**complete 时 CLI 派生规则**：

| frontmatter 字段 | 派生 | 目标 |
|-----------------|---------|------|
| `verdict` `summary` `next` `constraints` `decisions` `concerns` | 直映射（id 由 CLI 按序生成） | `run.json.handoff` |
| `gates[]`（可选） | 每条 → GateRecord（`source: handoff`），complete 求值 | `run.json.gates[]` |
| `constraints[]` 中 `status: locked` | 派生 session 级门（manual 型） | `session.json.gates[]` |
| `outputs/` 扫描结果（自动） | `artifact_refs[]` | `run.json.handoff` |

> `produces` / `primary` / alias 一律不由 LLM 声明——kind 取文件名 stem，alias 取 contract，CLI 扫描自动注册（§7.1b）；**不给 LLM 留第二条声明路径**。

**与 contract 的关系**：step 的 `contract:` 块是 **CLI 内部消费**（门禁派生 + 扫描校验 + 路由判定），LLM 不经手。frontmatter 是 LLM **运行时填写的实例数据**（本次调用的裁决/决策/concerns），contract 是**定义时写死的模板**（该 step 总是产 findings.json、总是要 plan-confirmed 门）。两不重叠——contract 定义"应该有什么"，frontmatter 报告"实际产了什么、什么裁决"。

---

## 八、命令产物迁移映射（适配当前命令）

`outputs/*.json` 是机器真相源，`report.md` 是展示；下游一律读 `run.json.handoff`。

| 命令 | 当前 `scratch/` 产物 | 目标 `runs/.../outputs/` |
|------|---------------------|--------------------------|
| `maestro-grill` | context-package.json | `risk-register.json` · `terminology.json` · `challenged-assumptions.json` |
| `maestro-brainstorm` | guidance-specification.md · {role}/ · context-package.json | `options.json` · `role-findings.json` · `resolutions.json` · `guidance.md` |
| `maestro-analyze` | discussion.md · analysis.md · conclusions.json · context.md · context-package.json | `findings.json` · `risk-matrix.json`（讨论入 `report.md`；verdict 入 `run.json.handoff`） |
| `maestro-blueprint` | — | `product-brief.md` · `prd.md` · `architecture.md` · `requirements.json` · `epics.json` · `traceability.json` |
| `maestro-roadmap` | `roadmap.md`（项目根） | `roadmap.json`（session DAG + 种子）· `roadmap.md`；运行时写 `state.json.sessions[]` |
| `maestro-plan` | plan.json · .task/TASK-*.json · .summaries/ | `plan.json` · `tasks/TASK-*.json` · `waves.json` · `dependency-graph.json` · `collision-report.json`；`outputs/plan-check.json` |
| `maestro-execute` | .summaries/TASK-*-summary.md · verification.json | `execution.json` · `task-results.json` · `self-check.json`（原 verification.json 更名）· `change-manifest.json`（复盘入 `report.md`） |
| **verify**（独立 Run） | scratch/*-verify-*/verification.json | 独立 verify Run：`verification.json` · `requirement-coverage.json` · `antipattern-report.json`；alias `latest-verification` |
| `quality-review` | review.json | `review-findings.json`（避免与 analyze 的 findings.json 同名异义，文件名即 kind）· `spec-conflicts.json` · `issue-candidates.json` |
| `quality-test` | uat.md · test-results.json · coverage-report.json | `test-plan.json` · `test-results.json` · `acceptance.json`（取代 uat.md）· `coverage.json` · `e2e-results.json` |
| `quality-debug` | understanding.md · evidence.ndjson | `diagnosis.json` · `hypotheses.json` · `reproduction.json` · `fix-directions.json` |
| `quality-auto-test` | report.json | `business-test-results.json` · `traceability-check.json`；test-gen 产测试代码入源码仓，Run 内留 `generated-tests-manifest.json` |
| `quality-retrospective` | — | `lessons.json` · `patterns.json` · `anti-patterns.json` · `improvement-requests.json` |
| `maestro-ralph` / `maestro-coordinate` | `.maestro/*/status.json` | **无独立目录**：`session.json.orchestration` + 内联 gates（`session.json`/`run.json`）+ `runs/` |

### 8.1 milestone 命令坍缩

| 当前命令 | 目标去处 |
|---------|---------|
| `maestro-milestone-audit` | 逐目标校验并入 session 的 **verify/review 门禁** |
| `maestro-milestone-complete` | 实质（知识提取）并入 **session seal**（触发 `finish-work` 提升 spec/knowhow） |
| `maestro-milestone-release` | 丢弃——**DAG 全 sealed = 项目完成**，无发布分组 |

> 跨 session 并行改用 worktree + fork Session（lineage 记 `session.json.lifecycle.forked_from`）。

---

## 九、权威性分层

| 文件 | 权威性 | 恢复真相源 |
|------|--------|-----------|
| `session.json`（含 session 级 gates） | 权威（Protected Data Store + 批量事务） | ✅ |
| `runs/{…}/run.json`（含 run 级 gates + handoff） | 权威（Run 级） | ✅ |
| `artifacts.json` | 权威 Registry（alias/status/replaces 由 transition rule 裁决，**不可 rescan 重建**；rescan 仅校验/修复） | ✅ |
| `report.md` | complete 前：权威输入（LLM 书写源）；complete 后：不可变产物（`role: report`） | ❌（产物经 Registry 恢复） |
| `events.ndjson` | **非权威**（高频审计流，含 run 诊断，可截断） | ❌ 仅诊断/时间线 |
| `session render` / `run render` 输出 | 按需投影（不落盘持久文件） | ❌ |
| `sessions/index.json` `wiki-index.json` | 可重建投影（惰性重建） | ❌ |

**恢复真相源 = `session.json` + `run.json`（+ `artifacts.json` 作 Registry）**。

**删除的通用重复文件**：`input.json`→`run.json.input`；`result.json`→`run.json.primary`/`handoff`；`handoff.json`→`run.json.handoff`；`manifest.json`→`session.json`；`context-package.json`→`run.json.handoff`；`gates.json`→`run.json.gates[]`/`session.json.gates[]`；`evidence.json`→handoff.decisions/gate 记录/events（§6.4）；`decisions.ndjson`/`requests.ndjson`→`run.json.handoff`/`session.json`；Session 级 `tasks.json`→ plan Run `outputs/tasks/` + artifact ref。

---

## 十、文件生命周期

```text
created → running → completed → sealed  ─(session)→ sealed → archived
```

| 状态 | 含义 |
|------|------|
| Run **completed** | 逻辑完成，产物仍可由 completion gate 修正。`run complete` 调用时**先设 completed → 再求值 Exit 门（含 prepared/handoff 动态门）→ 全过后才推进到 sealed** |
| Run **sealed** | hash/schema/handoff/registry 全确认+Exit 门全过，禁止原地改 |
| Session **sealed** | 无 running Run、无 claimed Request、目标 Gates 已确认、seal metadata 已写 |
| Session **archived** | 仅生命周期归档，不移动目录 |

> Artifact 更新必生成新 Artifact 并用 `replaces` 关联，**禁改 sealed**；report 修订也生成新 report Artifact，保审计链。

---

## 十一、废除 / 合并的文件模式

| 废除的模式（当前） | 替代（目标） |
|-------------------|-------------|
| `scratch/{date}-{cmd}-{slug}/` 作正式产物目录 | `sessions/{id}/runs/{date}-{NNN}-{cmd}/outputs/` |
| Plan/Execute/Review/Test 共用一目录 | 每命令独立日期化 Run |
| `.task/` · `.summaries/` 隐藏业务目录 | `outputs/tasks/` · `outputs/task-results.json` |
| `context.md` / `context-package.json` / 自然语言 Next Step 多套 handoff | `run.json.handoff`（机器）+ `report.md`（人类·aref）双投影同源 |
| 各命令过程 md（discussion.md / reflection.md / understanding.md） | `report.md` 固定小节（§7.2） |
| md 散文拷贝 json 数值 | `aref` 引用语法（§7.4），json 为唯一真相源 |
| `uat.md` 作机器验收 | `acceptance.json` |
| Ralph `status.json` 第二权威状态 | `session.json.orchestration` |
| `state.json.artifacts[]` 项目根数组 | 每 session `artifacts.json`（ID + alias） |
| `state.json.milestones[]` + `milestones/` + `phases/` | `state.json.sessions[]` DAG |
| 按 `mtime latest` / 数组末项 / glob 首项选上下文 | 显式 `--session` > Hook anchor > active pointer > artifact lineage |
| `.workflow/wiki/` 物理知识目录 | 不建，WikiIndexer 直接索引现有知识目录 |
| Review/Test/Debug 可选 Artifact 注册 | Artifact 注册始终 mandatory |
| 从模型输出正则提 Artifact ID/路径 | Artifact Runtime 自动注册回写 |
| session 级 `gates.json` / `evidence.json` 独立账本 | 内联 `run.json.gates[]`/`session.json.gates[]`；decisions 留 handoff（§6.2/§6.4） |
| session 级持久 `context.md`、run 级 `diagnostics.ndjson` | `session render` 按需输出；诊断并入 `events.ndjson` |
| 产物必写 `_meta` 3–4 键 | 文件名即 kind，`_meta` 仅覆盖用（§7.1b） |
| 命令 contract 空样板 `gates: {entry: [], exit: []}` | 产物型门由 consumes/produces 派生；`gates:` opt-in 仅非产物型检查 |
| 独立 `run check` 动词 | entry/exit 求值内化到 create/complete；自检由 `run brief` 吸收 |
| `run-mode.md` 的 `required_reading @ 全量嵌入` 方式 | **协议单源保留**：run-mode.md 文档本身继续存在为唯一协议承载；但不再由命令 @ 嵌入——改由 create 返回包固定注入一次、brief 重附要点（§7.1a）；prepare/workflow 文件禁止复述协议内容 |

---

## 十二、命名规则速查

| 对象 | 格式 | 示例 |
|------|------|------|
| Session ID | `{YYYYMMDD}-{intent-slug}`（冲突加 `-{short-id}`） | `20260711-hook-orchestration` |
| Run 目录 | `{YYYYMMDD}-{NNN}-{command}`（NNN 三位，Session 内稳定序号） | `20260711-003-plan` |
| Gate ID | run 级 `GATE-{run-sequence}-{NN}`；session 级 `GATE-S-{NN}` | `GATE-003-02` / `GATE-S-01` |
| Artifact alias | `current-analysis` · `current-plan` · `latest-verification` · `latest-review` · `latest-test` · `latest-debug` | — |

> 序号 `NNN` 与 `run.json` 创建在同一事务分配（否则并行只读 Run 取到相同序号）；日期为调用开始日。

---

## 十三、落地要点（对当前命令体系的影响）

1. **`maestro-init` 例外**：项目引导发生在任何 Session 之前，直写 `state.json`/`project.md`/`config.json`，**不建 Run**。
2. **核心链先行**：analyze→plan→execute→verify 四 step + post-verify 决策点先跑通全闭环，冻结 schema v1.1，再铺开其余命令。
3. **verify 独立**：从当前 `maestro-execute` 的 E2.7 内嵌步骤拆为独立 verify Run；Execute 只保留 `self-check.json`（build/test 冒烟）。
4. **milestone-* 命令下线**：三个 milestone 命令按 §8.1 坍缩，`milestones/`/`phases/` 物理目录废除。
5. **roadmap 转 session 划分器**：产 `sessions[]` DAG + 结构化种子写入 `state.json`，由 Session 注册系统按 dep-ready 逐个物化。
6. **知识提升统一入口**：session seal 触发 `finish-work`，把 session `specs/`/`knowhow/` 确认项提升到项目级并登记 provenance；WikiIndexer 只索引 sealed/archived。
7. **入口层重组与注册表**：工作流命令按三档分类（step / run-aware skill / plain skill）迁移，用户入口收敛为 next + ralph，step/gate/kind 统一注册——方案见 `session-run-simplification-plan.md` §七；命令重构与 CLI 实现**不在本次修订范围**，按该规划 §八顺序另行执行。

---

> **来源**：本文件体系变更提炼自 `.workflow/.scratchpad/session-hook-orchestration-FINAL.md`（§5 目录模型 / §19–§22 Run 与 Artifact / §24–§26 生命周期与权威性 / §34 目标树）。运行时协议（Hook/强制力/Watcher/事务/成本）与 Session 注册系统见 FINAL 原文及 `session-registration-hook-plan.md`。
> **v1.1 修订**：收敛决策（删 gates/evidence/context.md/diagnostics、schema 减键、动态门禁、prepare→create→brief→complete 生命周期、统一注册表、入口层重组）的完整论证与实施顺序见 `session-run-simplification-plan.md`。
