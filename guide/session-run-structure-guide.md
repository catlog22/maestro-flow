---
title: ".workflow/ 文件体系变更方案 — Session/Run 模型"
---

> 本方案从 `session-hook-orchestration-FINAL.md` 中**仅提炼文件体系变更**（目录、文件、关键 schema 字段），剥离 Hook 注入、强制力内核、Watcher、并发/CAS、成本控制等运行时协议——那些机制见 FINAL 原文。
> 基线（当前态）：`workflow-structure-guide.md`（`scratch/` + `milestone/phase` 模型）。
> 目标态：Session → Run → Artifact 三级数据模型。
> 目的：同一 Session 连续跑 analyze/plan/execute/review/test/debug，每次调用独立 Run 目录不互污，下游经 typed artifact 消费，恢复不依赖 `mtime latest`。

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
| 5 | `state.json` / Ralph `status.json` / scratch 多真相源 | 分层权威：`session.json`+`gates.json`+`run.json` 权威，`events.ndjson` 非权威，`index` 可重建 | 恢复真相源唯一 |

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
├── wiki-index.json                 # 可重建统一索引；非真相源
├── sessions/
│   ├── index.json                  # 可重建 Session 摘要索引；惰性重建
│   └── {YYYYMMDD}-{intent-slug}/
│       ├── session.json            # 权威：Session State（双 revision + orchestration）
│       ├── gates.json              # 权威：目标/命令/转移门禁账本
│       ├── artifacts.json          # 权威：产物路径 Registry + alias
│       ├── evidence.json           # 权威：判断/决策/Gate 证据账本
│       ├── events.ndjson           # 非权威：高频审计流，可截断归档
│       ├── context.md              # 投影：纯人类展示（非 Hook 读取源）
│       ├── specs/ knowhow/         # 本 Session 形成的知识候选/已确认
│       └── runs/
│           └── {YYYYMMDD}-{NNN}-{command}/
│               ├── run.json        # 权威：元信息 + input + output + handoff
│               ├── report.md       # 投影：面向用户完整报告
│               ├── outputs/        # 权威：command-specific 正式产物
│               ├── evidence/       # 证据：日志/trace/测试报告
│               ├── work/           # 临时：草稿，Seal 时清理
│               └── diagnostics.ndjson  # warning/error/retry + 成本计数
└── tmp/                            # 可删临时区（.gitignore）
    ├── hook/{host_session_id}.json # Hook 去重缓存
    └── txn/{txn_id}.intent         # 事务意图声明
```

**目录规则**：

- `sessions/{id}/` 路径全生命周期稳定，不随 active/sealed/archived 移动；
- 正式产物只进所属 Run 的 `outputs/`；`work/` 与 `tmp/` 都不承载正式产物；
- `runs/*/work/` 是单 Run 草稿（Seal 清理）；`tmp/` 是跨 Run/Session 可抛弃区（保留 7 天）；
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
    session_id: string;                   // {YYYYMMDD}-{slug}
    intent: string;
    status: 'planned' | 'running' | 'paused' | 'sealed' | 'archived' | 'failed';
    depends_on: string[];                 // 上游 session_id（全 sealed 才 dep-ready）
    roadmap_artifact_id: string | null;   // 由哪个 roadmap 划分而来
    seed_ref: string | null;              // roadmap 产出的结构化种子引用
  }>;
  // 删除：milestones[] / current_milestone / current_phase / artifacts[] / accumulated_context
}
```

- **“现在到哪了”** = `sessions[]` 中哪些 sealed、哪些 dep-ready（`depends_on` 全 sealed 且 `status:'planned'`）；
- **并行** = DAG 中依赖就绪的多个独立 session（worktree 隔离），不再需要 milestone 层；
- `accumulated_context` 的职责由各 session 的 `evidence.json`（active 投影）+ 项目级 `specs/` 承接。

---

## 六、Session 级文件

每个 `sessions/{id}/` 含 4 份权威 JSON + 1 份审计流 + 1 份人类投影。

| 文件 | 权威性 | 写入者 | 职责 |
|------|--------|--------|------|
| `session.json` | 权威 | SessionStore | identity + 双 revision + orchestration + requests + lifecycle |
| `gates.json` | 权威 | SessionStore | 目标/命令/转移 Gate 完整状态 |
| `artifacts.json` | 权威 | Artifact Runtime | Artifact ID → path/kind/status/hash + aliases |
| `evidence.json` | 权威 | SessionStore | 命令判断点/决策/Gate 证据/用户确认与理由 |
| `events.ndjson` | 非权威 | 各执行者 append | 高频审计事件流；诊断/时间线；seal 可归档 |
| `context.md` | 投影 | `maestro session render` | 纯人类展示；**不在 Hook 读取集** |

### 6.1 `session.json`（精简 schema）

```ts
interface SessionState {
  schema_version: 'session/1.0';
  session_id: string;                     // {YYYYMMDD}-{intent-slug}
  intent: string;
  status: 'running' | 'paused' | 'sealed' | 'archived' | 'failed';

  identity_revision: number;              // intent/boundary/status/lifecycle 变更 +1（Hook/Envelope 只认它）
  activity_revision: number;              // 运行态变更 +1（CAS 基准）

  active_run_id: string | null;
  latest_completed_run_id: string | null;

  boundary_contract: {
    in_scope: string[]; out_of_scope: string[];
    constraints: string[]; definition_of_done: string;
  };

  // Ralph/Coordinator 编排直属 Session，取代 status.json
  orchestration: {
    engine: 'ralph' | 'coordinator' | 'manual';
    quality_mode: 'quick' | 'standard' | 'full';
    auto_mode: boolean;
    chain: Array<{ step_id; command; status; run_id; inserted_by; decision_ref }>;
    decision_points: Array<{ point_id; after_step_id; status; retry_count; max_retries; evidence_ref }>;
  };

  // 深入规划/review/test/resume 等“请求下次调用”（append-only）
  requests: Array<{ request_id; type; status; payload; claimed_by_run_id }>;

  lifecycle: {
    sealed_at: string | null; seal_summary: string | null;
    promoted_spec_ids: string[]; promoted_knowhow_ids: string[];
    forked_from: { session_id; run_id } | null;
  };

  refs: { gates: 'gates.json'; artifacts: 'artifacts.json'; evidence: 'evidence.json' };
}
```

> 命令的判断/决策不进此文件，统一写 `evidence.json`；高频事件走 `events.ndjson`，不 bump 任何 revision。

### 6.2 `gates.json`（精简 schema）

```ts
interface GateRegistry {
  schema_version: 'gates/1.0'; revision: number;
  gates: Record<string /*gate_id = GATE-{run-seq}-{NN}*/, {
    key: string; title: string;
    scope: 'session' | 'entry' | 'phase' | 'exit' | 'transition' | 'knowledge';
    run_id: string | null; required: boolean; blocking: boolean;
    applicable_modes: Array<'quick' | 'standard' | 'full'>;   // 缺省=所有模式
    status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'waived' | 'skipped';
    check:                                                    // typed union，求值器退化为 switch
      | { type: 'session';  field: string; equals: unknown }
      | { type: 'artifact'; kind: string; require_status?: 'sealed'; alias?: string }
      | { type: 'file';     path: string; exists: boolean }
      | { type: 'schema';   artifact_ref: string; schema_id: string }
      | { type: 'command';  argv: string[]; expect_exit: number }
      | { type: 'decision'; point: string; outcome: string }
      | { type: 'manual';   prompt: string };
    evidence_refs: string[]; waiver: { reason; approved_by; approved_at } | null;
  }>;
  summary: { total; passed; blocked; failed; active_gate_ids: string[]; blocking_run_id: string | null };
}
```

> 门禁定义**内联在命令 `.md` 的 contract 里**（保持 Self-Containment），运行时按 `quality_mode` 注册；不适用的 Gate 以 `status:'skipped'` 留痕，区分“未要求”与“漏检”。

### 6.3 `artifacts.json`（精简 schema）

```ts
interface ArtifactRegistry {
  schema_version: 'artifacts/1.0'; revision: number;
  artifacts: Record<string /*artifact_id*/, {
    kind: string;                          // task-collection/session-spec/session-knowhow… 归入 kind
    role: 'primary' | 'evidence' | 'report' | 'attachment';
    producer_run_id: string; relative_path: string;
    media_type: string; schema_version: string; content_hash: string; size: number;
    status: 'draft' | 'sealed' | 'invalid' | 'superseded';
    derived_from: string[]; replaces: string | null;
  }>;
  aliases: Record<string, string>;         // current-analysis / current-plan / latest-verification…
}
```

> Artifact 用稳定 ID + alias 表达 latest，**不用数组位置**。
> **注册从 push 变 pull + 自描述**：LLM 直写 `outputs/`，每个文件自带 `_meta`（JSON）或 frontmatter `kind`（MD）声明身份；seal 时 CLI 扫描 `outputs/` → 读元数据自发现 kind/role → 算 hash → 建索引 → 更新 alias。
> `artifacts.json` 是可 **rescan 重建**的派生索引。contract 的 `produces` 降级为可选的交叉校验（warn on mismatch），不再是扫描器的必需映射表——新命令不加 contract 也能跑（§7.1b）。

### 6.4 `evidence.json`（精简 schema）

替代原 `decisions.json`/`decisions.ndjson`——跨命令共享的“判断与证据账本”。

```ts
interface EvidenceStore {
  schema_version: 'evidence/1.0'; revision: number;
  records: Record<string /*evidence_id*/, {
    run_id: string; command: string;
    kind: string;                          // decision|gate|finding|observation|confirmation|compaction…
    point: string;                         // scope-verdict / plan-confirmed / root-cause / post-verify…
    claim: string; outcome: string;
    rationale: string;                     // ≤ 2000 字符；超长写 Run evidence/ 并以 source_refs 引用
    status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
    artifact_refs: string[]; gate_refs: string[]; source_refs: string[];
  }>;
}
```

> Gate 通过/失败、Analyze scope verdict、Debug root-cause、用户 waiver/范围变更**必须**写入；`gates.json`/`decision_points` 只存 evidence 引用。

---

## 七、Run 级文件（取代 scratch 目录）

所有命令（Grill/Analyze/Plan/Execute/Review/Test/Debug/verify…）遵守同一 Run 外壳：

```text
runs/{YYYYMMDD}-{NNN}-{command}/
├── run.json              # 权威·骨架：消费什么 → 产出什么 → 交给谁（不含领域正文）
├── report.md            # 投影·人类交接：散文 + aref 引用（§7.4），可重建
├── outputs/             # 权威·领域真相：json 产物 + 交付物 md（见 §八）
├── evidence/            # 证据·附件：日志/截图/trace/测试报告（非结构化；与 Session 级 evidence.json 不同——后者是结构化判断记录）
├── work/                # 临时：草稿，Seal 时清理，不进 Registry
└── diagnostics.ndjson   # warning/error/retry/degradation + 成本计数
```

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
  schema_version: 'command-run/1.0';
  session_id: string; run_id: string; sequence: number;   // NNN 三位，与 run.json 创建同一事务分配
  parent_run_id: string | null;                           // 重试指向被重试 Run
  command: { name; version; source_path; content_hash; resolved_prompt_hash };
  status: 'created' | 'running' | 'blocked' | 'failed' | 'completed' | 'sealed';
  input: { args: string[]; consumes: string[]; context_identity_revision: number };
  gate_ids: string[];
  output: { produces: string[]; primary_artifact_id: string | null;
    verdict: 'ready' | 'ready_with_concerns' | 'blocked' | 'failed' | null };
  handoff: Handoff | null;                                 // 见 §7.3
  started_at: string; completed_at: string | null; sealed_at: string | null;
}
```

### 7.1a 三类 JSON · 三种归属 · 零协议学习

Run 涉及的所有 JSON 按**归属**分三类——LLM 接触面从"两种 schema 都要学"缩到"直写领域文件 + 一个 md frontmatter"：

| 类别 | 例子 | 谁写 | 怎么写 | LLM 学 schema? |
|------|------|------|--------|:-:|
| **领域产物** | `outputs/plan.json` · `findings.json` · `diagnosis.json` | **LLM** | `Write` 直写（它本来就产这些） | **否** |
| **协议状态** | `run.json` · `gates.json` · `artifacts.json` · `session.json` | **CLI/Hook** | seal 时**扫描 outputs/ + 读 report.md frontmatter → 派生** | **从不接触** |
| **交接/证据** | `handoff` · `evidence` | **LLM → CLI** | LLM 写 report.md frontmatter → seal 派生到协议文件 | **否**（就是 md frontmatter） |

关键转变：**注册从"push 声明"变"pull 派生"**。LLM 不声明 produces、不拼协议 JSON、不学 gate schema。CLI 在 seal 时读盘扫描 `outputs/`，自己算 hash、建 artifacts.json、更新 alias；门禁只在 start/seal 由 CLI 内部求值，**完全移出 LLM 视野**——只有 blocking 失败才吐一行"缺 X，先跑 Y"。

LLM 眼里的全流程（**3 步，零协议 schema 学习**）：

```text
1. maestro run start <cmd>
   → { run_dir, upstream: { alias → path } }       ← 就返回这两样

2. LLM 直接干活：
   · Read upstream[].path                           ← 读上游 typed json
   · Write outputs/*.json                           ← 直写，无 schema 学习成本
   · Write report.md（含 frontmatter，§7.5）        ← 唯一的半结构化出口

3. maestro run seal <run>                           ← 只传 run id
   → CLI 扫 outputs/ → 派生 artifacts.json
   → CLI 读 report.md frontmatter → 派生 run.json + handoff + evidence
   → CLI 跑 exit 门 → 更新 alias
```

### 7.1b 产物自描述：`_meta` 与 frontmatter `kind`

CLI 扫描 `outputs/` 时不依赖 contract 来判定文件身份——**每个产物文件自带元数据**，扫描器读文件头即知 kind/role/schema。contract 降级为可选的交叉校验（lint），新命令不加 contract 也能跑。

**JSON 产物：顶层 `_meta` 字段**

```json
{
  "_meta": {
    "kind": "plan",
    "schema": "plan/1.0",
    "role": "primary"
  },
  "tasks": [...],
  "waves": [...]
}
```

| `_meta` 字段 | 必填 | 说明 |
|-------------|:--:|------|
| `kind` | ✅ | artifact kind（plan / findings / diagnosis / verification…），与 Registry 对齐 |
| `schema` | ✅ | schema 标识符，用于 validation |
| `role` | 否 | `primary` / `evidence` / `report` / `attachment`。缺省：CLI 推断（目录下唯一 json → primary，其余 → attachment） |
| `alias` | 否 | 建议 alias。CLI 按 transition rule 决定最终 alias，可不采纳 |

**Markdown 交付物：frontmatter `kind`**

`outputs/` 下的交付物 md（prd.md / architecture.md / guidance.md…）在 frontmatter 声明身份：

```md
---
kind: blueprint-architecture
role: primary
---
# 架构设计
…
```

**扫描器算法**

```text
for file in outputs/*:
  .json → parse _meta → {kind, schema, role} → register in artifacts.json
  .md（非 report.md）→ parse frontmatter → {kind, role} → register
  无 _meta / frontmatter → warn + 尝试文件名推断 → register as kind:unknown
```

**contract 降级**

contract 的 `produces` 从"扫描器必需的映射表"降级为**可选的交叉校验**：
- contract 声明的文件未产出 → warn（"预期 outputs/plan.json 未找到"）
- 产出了 contract 未声明的文件 → info（正常——自发现仍注册）
- 无 contract → **完全依赖 `_meta` 自发现，零配置可用**

> 新命令不加 contract 也能跑——产物自带 kind，扫描器自发现，门禁列表为空（全 `skipped`）。contract 是渐进式质量约束，不是启动前提。

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

交接有**机器**与**人类**两条路径，同源于 `outputs/*.json` + `report.md` frontmatter，由 seal 时同一 Builder 派生：

```text
seal → Builder ├─ 扫描 outputs/ → artifacts.json（hash/alias）
               ├─ 读 report.md frontmatter → run.json.handoff（机器合约）
               ├─ 读 report.md frontmatter → evidence.json（decisions → evidence）
               └─ 解析 aref → 渲染 report.md（人类叙述）
```

- **机器路径**：下游命令读 `run.json.handoff.artifact_refs[]` → 经 `artifacts.json` 定位 → 直接拿 typed json，**不解析散文**。
- **人类/Envelope 路径**：读 `report.md`——散文里的 aref 已解析为具体值，叙述与数据**结合在一处但不重复**（数值仍只存在于 json）。

**LLM 不直接构造 `handoff` JSON**——它只写 `report.md` 的 YAML frontmatter（§7.5）；seal 时 CLI 从 frontmatter 字段派生 `run.json.handoff`，从 `outputs/` 扫描结果派生 `artifact_refs[]`。`handoff` 的完整 schema（CLI 派生目标，非 LLM 书写目标）：

```ts
interface Handoff {
  schema_version: 'command-handoff/1.0';
  producer_run_id: string; command: string;
  verdict: 'ready' | 'ready_with_concerns' | 'blocked' | 'failed';
  summary: string;                                         // 一句话；展开在 report.md
  constraints: Array<{ id; status: 'locked' | 'open' | 'deferred'; text }>;
  decisions: Array<{ id; status: 'proposed' | 'accepted' | 'rejected'; text }>;
  caveats: string[]; open_questions: string[];
  artifact_refs: string[]; evidence_refs: string[];       // 指向 outputs/ 的 typed 产物
  next: Array<{ command; reason; required_artifact_refs }>;
  details: Record<string, unknown>;                        // 领域扩展位
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
2. `pointer` 为 RFC 6901 JSON Pointer；越界/类型不符 → 渲染 `⟨aref 失效: source#pointer⟩` 占位并记 `diagnostics.ndjson`，**不静默**；
3. 只解析 **sealed** artifact；引用 draft 渲染警告；
4. 渲染时快照被引 artifact 的 `content_hash`；hash 变 → 标 stale → `maestro run render` 重渲染（与 §33 Code Anchor 同机制）；
5. 渲染是**投影操作**（`maestro run render <run>`）：`report.md` 永远可从 (handoff + artifacts) 重建，丢失无害、不进恢复真相源。

> **语法选型**：`{{aref:…}}` 内联 + ` ```aref  ` 块级——markdown 友好、不破坏高亮、易 AST 解析；路径用标准 JSON Pointer，不自造 DSL。备选 `artifact://alias#pointer` 链接式语义等价，但内联标量场景笨重，未采用。

### 7.5 `report.md` frontmatter（LLM 唯一的半结构化出口）

LLM 不接触任何协议 JSON——它唯一"结构化"的活收敛到 `report.md` 的 YAML frontmatter。这对 LLM 天然熟练（markdown + YAML，非嵌套协议 JSON），seal 时 CLI 从此派生 `run.json.handoff` + `evidence.json`。

**LLM 写作目标**（它实际写的）：

```md
---
verdict: ready
summary: M1 认证规划完成，12 任务 / 3 波
constraints:
  - { id: C1, text: 采用 stateless JWT, status: locked }
  - { id: C2, text: OAuth2 device flow 暂缓, status: deferred }
decisions:
  - { id: D1, text: Redis 做 session 缓存, status: accepted }
caveats:
  - 未覆盖 OAuth2 device flow
open_questions: []
next:
  - { command: execute, reason: plan sealed, required: [current-plan] }
---
## 摘要
本次规划围绕 M1 认证模块展开…
```

**seal 时 CLI 派生规则**：

| frontmatter 字段 | 派生命名 | 目标 |
|-----------------|---------|------|
| `verdict` `summary` `next` `constraints` `caveats` `open_questions` | 直映射 | `run.json.handoff` |
| `decisions[]` | 每条 → 一条 evidence（`kind:decision`） | `evidence.json` |
| `outputs/` 扫描结果（自动） | `artifact_refs[]` + `evidence_refs[]` | `run.json.handoff` |

> `produces` / `primary` 不强制 LLM 声明——CLI 扫描 `outputs/` 自动发现并注册；LLM 若要显式指定 primary/alias/kind 覆盖默认推断，在 frontmatter 里加 `produces:` 字段即可。

**与现有 contract 的关系**：命令 `.md` 的 `contract:` 块是 **CLI 内部消费**（门禁注册 + 扫描校验），LLM 不经手。frontmatter 是 LLM **运行时填写的实例数据**（本次调用的裁决/决策/caveats），contract 是命令**定义时写死的模板**（该命令总是产 findigns.json、总是要 plan-confirmed 门）。两不重叠——contract 定义"应该有什么"，frontmatter 报告"实际产了什么、什么裁决"。

---

## 八、命令产物迁移映射（适配当前命令）

`outputs/*.json` 是机器真相源，`report.md` 是展示；下游一律读 `run.json.handoff`。

| 命令 | 当前 `scratch/` 产物 | 目标 `runs/.../outputs/` |
|------|---------------------|--------------------------|
| `maestro-grill` | context-package.json | `risk-register.json` · `terminology.json` · `challenged-assumptions.json` |
| `maestro-brainstorm` | guidance-specification.md · {role}/ · context-package.json | `options.json` · `role-findings.json` · `resolutions.json` · `guidance.md` |
| `maestro-analyze` | discussion.md · analysis.md · conclusions.json · context.md · context-package.json | `findings.json` · `risk-matrix.json`（讨论入 `report.md`；verdict 入 `run.json.output`） |
| `maestro-blueprint` | — | `product-brief.md` · `prd.md` · `architecture.md` · `requirements.json` · `epics.json` · `traceability.json` |
| `maestro-roadmap` | `roadmap.md`（项目根） | `roadmap.json`（session DAG + 种子）· `roadmap.md`；运行时写 `state.json.sessions[]` |
| `maestro-plan` | plan.json · .task/TASK-*.json · .summaries/ | `plan.json` · `tasks/TASK-*.json` · `waves.json` · `dependency-graph.json` · `collision-report.json`；`evidence/plan-check.json` |
| `maestro-execute` | .summaries/TASK-*-summary.md · verification.json | `execution.json` · `task-results.json` · `self-check.json`（原 verification.json 更名）· `change-manifest.json`（复盘入 `report.md`） |
| **verify**（独立 Run） | scratch/*-verify-*/verification.json | 独立 verify Run：`verification.json` · `requirement-coverage.json` · `antipattern-report.json`；alias `latest-verification` |
| `quality-review` | review.json | `findings.json` · `spec-conflicts.json` · `issue-candidates.json` |
| `quality-test` | uat.md · test-results.json · coverage-report.json | `test-plan.json` · `test-results.json` · `acceptance.json`（取代 uat.md）· `coverage.json` · `e2e-results.json` |
| `quality-debug` | understanding.md · evidence.ndjson | `diagnosis.json` · `hypotheses.json` · `reproduction.json` · `fix-directions.json` |
| `quality-auto-test` | report.json | `business-test-results.json` · `traceability-check.json`；test-gen 产测试代码入源码仓，Run 内留 `generated-tests-manifest.json` |
| `quality-retrospective` | — | `lessons.json` · `patterns.json` · `anti-patterns.json` · `improvement-requests.json` |
| `maestro-ralph` / `maestro-coordinate` | `.maestro/*/status.json` | **无独立目录**：`session.json.orchestration` + `gates.json` + `evidence.json` + `runs/` |

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
| `session.json` `gates.json` `evidence.json` | 权威（Protected Data Store + 批量事务） | ✅ |
| `artifacts.json` | 权威·派生索引（seal 扫描 `outputs/` 生成，可 rescan 重建） | ✅ |
| `runs/{…}/run.json` | 权威（Run 级） | ✅ |
| `events.ndjson` | **非权威**（高频审计流，可截断） | ❌ 仅诊断/时间线 |
| `context.md` `report.md` | 投影（人类展示；report.md 含已解析 aref） | ❌ |
| `sessions/index.json` `wiki-index.json` | 可重建投影（惰性重建） | ❌ |

**恢复真相源 = `session.json` + `gates.json` + `run.json`**。

**删除的通用重复文件**：`input.json`→`run.json.input`；`result.json`→`run.json.output`；`handoff.json`→`run.json.handoff`；`manifest.json`→`session.json`；`context-package.json`→`run.json.handoff`；`decisions.ndjson`/`requests.ndjson`→`evidence.json`/`session.json`；Session 级 `tasks.json`→ plan Run `outputs/tasks/` + artifact ref。

---

## 十、文件生命周期

```text
created → running → completed → sealed  ─(session)→ sealed → archived
```

| 状态 | 含义 |
|------|------|
| Run **completed** | 逻辑完成，产物仍可由 completion gate 修正。`run seal` 调用时**先设 completed → 再求值 Exit 门 → 全过后才推进到 sealed** |
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

---

## 十二、命名规则速查

| 对象 | 格式 | 示例 |
|------|------|------|
| Session ID | `{YYYYMMDD}-{intent-slug}`（冲突加 `-{short-id}`） | `20260711-hook-orchestration` |
| Run 目录 | `{YYYYMMDD}-{NNN}-{command}`（NNN 三位，Session 内稳定序号） | `20260711-003-plan` |
| Gate ID | `GATE-{run-sequence}-{NN}` | `GATE-003-02` |
| Artifact alias | `current-analysis` · `current-plan` · `latest-verification` · `latest-review` · `latest-test` · `latest-debug` | — |

> 序号 `NNN` 与 `run.json` 创建在同一事务分配（否则并行只读 Run 取到相同序号）；日期为调用开始日。

---

## 十三、落地要点（对当前命令体系的影响）

1. **`maestro-init` 例外**：项目引导发生在任何 Session 之前，直写 `state.json`/`project.md`/`config.json`，**不建 Run**。
2. **核心链先行**：analyze→plan→execute→verify 四命令 + post-verify 决策点先跑通全闭环，冻结 schema v1.0，再铺开其余命令。
3. **verify 独立**：从当前 `maestro-execute` 的 E2.7 内嵌步骤拆为独立 verify Run；Execute 只保留 `self-check.json`（build/test 冒烟）。
4. **milestone-* 命令下线**：三个 milestone 命令按 §8.1 坍缩，`milestones/`/`phases/` 物理目录废除。
5. **roadmap 转 session 划分器**：产 `sessions[]` DAG + 结构化种子写入 `state.json`，由 Session 注册系统按 dep-ready 逐个物化。
6. **知识提升统一入口**：session seal 触发 `finish-work`，把 session `specs/`/`knowhow/` 确认项提升到项目级并登记 provenance；WikiIndexer 只索引 sealed/archived。

---

> **来源**：本文件体系变更提炼自 `.workflow/.scratchpad/session-hook-orchestration-FINAL.md`（§5 目录模型 / §19–§22 Run 与 Artifact / §24–§26 生命周期与权威性 / §34 目标树）。运行时协议（Hook/强制力/Watcher/事务/成本）与 Session 注册系统见 FINAL 原文及 `session-registration-hook-plan.md`。
