---
title: "Session/Run 文件体系精简规划 — 减文件、减键、减接触面"
---

> 基线：`session-run-structure-guide.md`（Session → Run → Artifact 模型）+ 已按该指南改造完成的命令体系。
> 本规划 = **对基线的收敛修订**（目录层次、权威/投影分层、pull 式产物发现、frontmatter 派生机制全部保留）+ **两项结构性增量**：run 生命周期扩展（prepare/brief，§3.9）与入口层重组（next + ralph，§七）。
> 三个目标：**① 减少文件数量 ② 精简 schema 字段/键 ③ 收窄键的影响面**（LLM 必学键、跨文件引用网）。
> Schema 尚未冻结（v1.0 前），直接收敛，不设兼容层。

---

## 一、收敛度量

| 度量 | 当前（指南态） | 目标 | 手段 |
|------|:---:|:---:|------|
| Session 级固定文件 | 6（session/gates/artifacts/evidence + events + context.md） | **3**（session/artifacts + events） | §二 |
| Run 级固定文件/目录 | 3 文件 + 3 目录 | **2 文件 + 1 目录**（其余惰性） | §二 |
| LLM 必学协议键 | `_meta` 3–4 键/产物 + frontmatter 7 键 | **frontmatter 5 键，产物 0 键** | §四 |
| 每 session revision 计数器 | 5（session×2 + gates + artifacts + evidence） | **1** | §三 |
| 权威 JSON 间交叉引用 | 双向网（gates↔evidence↔artifacts） | **单向**（child→run_id） | §五 |
| 命令 contract 空门禁样板 | ~20 处 `gates: {entry: [], exit: []}` | **0**（产物型门由 consumes/produces 派生，`gates:` opt-in） | §3.7 §3.8 |
| 工作流入口命令（第一档 step，§7.6） | ~15 个独立 Skill 入口（核心链 + quality + 上游） | **3**（next + maestro + ralph，见 `three-entry-migration-plan.md`）；第二/三档入口保留 | §七 |
| ralph 变体 | 5（ralph / v2 / cli / execute / cli-execute） | **1**（`--engine` 模式化） | §7.4 |

---

## 二、文件数量收敛

### 2.1 删除的文件

| 文件 | 处置 | 内容去处 |
|------|------|---------|
| `gates.json` | **删除** | Gate 本就是 run 作用域（`GATE-{run-seq}-{NN}`）→ 内联 `run.json.gates[]`；少数 session 级 gate → `session.json.gates[]` |
| `evidence.json` | **删除** | decisions 本就从 frontmatter 派生 → 留在 `run.json.handoff.decisions[]`（不再二次落盘）；gate 结果/waiver → `run.json.gates[]`；用户确认、范围变更 → `events.ndjson` 留痕 |
| `context.md`（session 级） | **删除持久化** | `maestro session render` 按需输出（stdout / `tmp/`），不落盘 |
| `diagnostics.ndjson`（run 级） | **删除** | 并入 session 级 `events.ndjson`，事件加 `run_id` 字段；本就非权威，合流不损失 |

### 2.2 惰性创建

`runs/{…}/evidence/`、`runs/{…}/work/` 不再是固定外壳——**有内容才创建**。最小 Run = `run.json` + `report.md` + `outputs/`。

### 2.3 收敛后的目录树

```text
.workflow/
├── state.json
├── project.md  config.json
├── specs/ codebase/ knowhow/ issues/ domain/
├── steps/ gates/ kinds/            # 项目级注册表覆盖（§7.2）
├── wiki-index.json
├── sessions/
│   ├── index.json                  # 惰性投影
│   └── {YYYYMMDD}-{intent-slug}/
│       ├── session.json            # 权威（含 session 级 gates）
│       ├── artifacts.json          # 权威 Registry
│       ├── events.ndjson           # 非权威审计流（吸收 run 诊断）
│       ├── specs/ knowhow/         # 知识候选（惰性）
│       └── runs/{YYYYMMDD}-{NNN}-{command}/
│           ├── run.json            # 权威（含 run 级 gates + handoff）
│           ├── report.md           # LLM 书写源 → seal 后定格
│           ├── outputs/            # 领域真相
│           ├── evidence/           # 惰性
│           └── work/               # 惰性，seal 清理
└── tmp/
```

**恢复真相源 = `session.json` + `run.json`（+ `artifacts.json` 作 Registry）**——从 4 文件收敛到 2+1。

---

## 三、Schema 键精简（逐文件 before → after）

**总原则：能从路径、文件名、文件系统 stat、outputs 扫描推导出的键，一律不落盘。**

### 3.1 项目级 `state.json`

```ts
interface ProjectState {
  version: '2.0';
  project_name: string;
  active_session_id: string | null;
  sessions: Array<{
    id: string;                      // 原 session_id
    intent: string;
    status: SessionStatus;           // 见下方权威规则
    depends_on: string[];
    seed: string | null;             // 合并原 roadmap_artifact_id + seed_ref 为单一 artifact ref
  }>;
}
```

- 删 1 键：`roadmap_artifact_id` 与 `seed_ref` 合并为 `seed`（seed artifact 的 ref 已含 producer 信息，roadmap 来源可溯）。
- **修复双真相源**：session 目录物化前（`planned`），`state.json` 是唯一状态持有者；物化后 `sessions[].status` 降级为 **CLI 同步的缓存**，权威以 `session.json.status` 为准，读侧冲突时以 session.json 覆盖。此规则写入指南 §五。

### 3.2 `session.json`：14 顶层键 → 11

```ts
interface SessionState {
  schema_version: 'session/1.1';
  session_id: string;
  intent: string;
  status: 'running' | 'paused' | 'sealed' | 'archived' | 'failed';
  revision: number;                    // 单一计数器（见下）
  active_run_id: string | null;
  boundary_contract: { in_scope: string[]; out_of_scope: string[];
    constraints: string[]; definition_of_done: string };
  gates: GateRecord[];                 // 仅 session/transition 级少数门（新增，承接 gates.json）
  orchestration: {
    engine: 'ralph' | 'maestro' | 'manual';   // maestro = 静态链（原 coordinator 语义并入，见 three-entry-migration-plan.md §1.1）
    quality_mode: 'quick' | 'standard' | 'full';
    auto_mode: boolean;
    chain: Array<{ step: string; command: string; status: string; run_id: string | null }>;
    decision_points: Array<{ point: string; after_step: string; status: string; retries: number }>;
  };
  requests: Array<{ id: string; type: string; status: string; payload: unknown; claimed_by: string | null }>;
  lifecycle: { sealed_at: string | null; seal_summary: string | null;
    promoted: string[];                // 合并 spec/knowhow，条目带前缀 "spec:…" / "knowhow:…"
    forked_from: string | null };      // "{session_id}/{run_id}" 单字符串
}
```

| 删除/合并的键 | 理由 |
|------|------|
| `identity_revision` + `activity_revision` → 单 `revision` | Hook 的 identity 缓存键改为 `hash(intent + boundary_contract + status)`，由 CLI 计算返回、不落盘；CAS 用单 revision 足够 |
| `latest_completed_run_id` | 可从 `runs/` 目录序号 + run.json.status 扫描推导（NNN 有序） |
| `refs` 对象 | 文件名全局固定，零信息量 |
| `orchestration.chain[].inserted_by` `decision_ref`、`decision_points[].evidence_ref` `max_retries` | 审计信息 → `events.ndjson`；max_retries 是配置，归 `config.json` |
| `lifecycle.promoted_spec_ids` + `promoted_knowhow_ids` → `promoted[]` | 前缀区分，少一层嵌套 |
| `forked_from` 对象 → 字符串 | 单值 lineage 不需要结构体 |

### 3.3 `run.json`：13 顶层键 → 10，`command` 5 子键 → 1

```ts
interface CommandRun {
  schema_version: 'run/1.1';
  run_id: string;                      // {YYYYMMDD}-{NNN}-{command}，自含 sequence + command + 日期
  parent_run_id: string | null;
  command: string;                     // 仅名称；version/source_path/content_hash/resolved_prompt_hash 删除
  status: 'created' | 'running' | 'blocked' | 'failed' | 'completed' | 'sealed';
  goal: string | null;                 // run 级 definition of done，prepare 阶段由 LLM 定义（§3.9）；seal verdict 对照它裁决；无 --prep 时为 null
  input: { args: string[]; consumes: string[] };
  gates: GateRecord[];                 // 内联（承接 gates.json 的 run 作用域门）
  primary: string | null;              // primary artifact_id；原 output 对象拍平
  handoff: Handoff | null;
  started_at: string; ended_at: string | null;
}
```

| 删除的键 | 理由 |
|------|------|
| `sequence` | `run_id` 内嵌 NNN，解析即得 |
| `session_id` | 目录位置唯一确定归属 |
| `command.*` 4 个 hash/path 子键 | 审计需求 → `events.ndjson` 记一条 `run_created` 事件（含 content_hash）；run.json 不承载 |
| `input.context_identity_revision` | 双 revision 已废；如需锚定，events 记 `revision` 快照 |
| `output.verdict` | 与 `handoff.verdict` 完全重复，删 |
| `output.produces[]` | `artifacts.json` 按 `run_id` 反查即得（producer 索引） |
| `gate_ids[]` → `gates[]` | 内联替代跨文件引用 |
| `completed_at` + `sealed_at` → `ended_at` | completed→sealed 间隔无查询价值；seal 时刻 events 有记录 |

> 新增键 `goal`：它是 run 级 definition of done，诞生于 prepare 阶段（§3.9）、无处可派生，通过"事实诞生地"测试——与 `GateRecord.source`（§3.4）、`session.json.gates[]`（§3.2）同为本规划仅有的三处净增，其余全为删减。

### 3.4 GateRecord：11 键 → 6，check 7 型 → 4 型

```ts
interface GateRecord {
  id: string;                          // GATE-{run-seq}-{NN}；session 级为 GATE-S-{NN}
  title: string;
  blocking: boolean;                   // 合并原 required + blocking（语义重叠）
  status: 'pending' | 'passed' | 'failed' | 'waived' | 'skipped';   // 删 running/blocked（求值是瞬时的；blocked 是 run 的状态）
  check:
    | { type: 'artifact'; kind: string; alias?: string; schema?: string }   // 吸收原 schema 型
    | { type: 'file';     path: string; exists: boolean }                   // 吸收原 session 型（状态即文件内容）
    | { type: 'command';  argv: string[]; expect_exit: number }
    | { type: 'manual';   prompt: string };                                 // 吸收原 decision 型（decision 即人工/frontmatter 裁决）
  waiver: string | null;               // "reason (approved_by @ date)" 单字符串；结构化审计走 events
  source?: 'contract' | 'prepared' | 'handoff';   // 缺省 contract；prepared = prepare 阶段前瞻提议（§3.9），handoff = 运行中追加（§3.8）；审计信任权重不同
}
```

| 删除的键 | 理由 |
|------|------|
| `key` | 与 `id` 冗余 |
| `scope` `run_id` | 由所在文件位置表达（在 run.json 内 = run 级；在 session.json 内 = session 级） |
| `required` | 与 `blocking` 合并——非 blocking 的 required 门实践中等于 warn，即 `blocking:false` |
| `applicable_modes` | 属于**定义端**（命令 contract），不属于运行时记录——不适用的门按指南规则记 `skipped`，模式信息 events 可查 |
| `evidence_refs[]` | evidence.json 已废；gate 的证据就是 check 求值结果本身，异常细节进 events |

### 3.5 `artifacts.json`：条目 11 键 → 7，定位修正

```ts
interface ArtifactRegistry {
  schema_version: 'artifacts/1.1';
  artifacts: Record<string, {
    kind: string;
    role: 'primary' | 'evidence' | 'report' | 'attachment';
    run_id: string;                    // 原 producer_run_id
    path: string;                      // 原 relative_path
    hash: string;                      // 原 content_hash
    status: 'draft' | 'sealed' | 'invalid' | 'superseded';
    replaces: string | null;
  }>;
  aliases: Record<string, string>;
}
```

| 删除的键 | 理由 |
|------|------|
| `revision` | 单写者（Artifact Runtime）+ 原子写，无 CAS 需求 |
| `media_type` | 扩展名可推 |
| `size` | 文件系统 stat 可查 |
| `schema_version`（条目级） | 产物文件 `_meta.schema` / 缺省约定持有（§四），Registry 不复制 |
| `derived_from[]` | lineage 由 `run.json.input.consumes` 已完整表达，Registry 不二次记录 |

**定位修正**（原指南 §六/§九 矛盾）：`artifacts.json` 是**权威**——`aliases`、`status`、`replaces` 链由 transition rule 裁决，**无法**从 outputs 扫描重建。`rescan` 降级为校验/修复手段（对账 path/hash/kind），从指南 §九删去"可 rescan 重建"表述。

### 3.6 `Handoff`：10 键 → 7

```ts
interface Handoff {
  verdict: 'ready' | 'ready_with_concerns' | 'blocked' | 'failed';
  summary: string;
  constraints: Array<{ text: string; status: 'locked' | 'open' | 'deferred' }>;
  decisions: Array<{ text: string; status: 'proposed' | 'accepted' | 'rejected' }>;
  concerns: string[];                  // 合并原 caveats + open_questions（消费侧从未区分处理）
  artifact_refs: string[];             // CLI 从 outputs 扫描自动填充
  next: Array<{ command: string; reason: string; needs: string[] }>;
}
```

| 删除的键 | 理由 |
|------|------|
| `schema_version` `producer_run_id` `command` | 宿主 `run.json` 全部持有，内嵌对象不重复 |
| `caveats` + `open_questions` → `concerns` | 两者消费方式相同（人读 + 下游提示），区分无收益 |
| `constraints[].id` `decisions[].id` | ID 由 CLI 按序派生（C1/C2、D1/D2），LLM 不写 |
| `evidence_refs[]` | evidence.json 已废 |
| `details` | 开放 `Record<string, unknown>` 与 typed 原则矛盾；领域扩展应进 `outputs/*.json` |
| `next[].required_artifact_refs` → `needs` | 缩短高频键名 |

### 3.7 命令 contract 的门禁声明精简

**现状问题**（盘点已改造命令）：约 20 个命令带一模一样的空样板 `gates: { entry: [], exit: [] }`，而最需要门禁的核心链命令（analyze/plan/execute/verify/quality-review）反而没有此键。根源：产物型门禁与 `consumes`/`produces` 是同一件事的两套声明——`consumes` 的 `required: true, require_status: sealed` 就是 entry gate，`produces` 的 primary 存在性 + schema 校验就是 exit gate，独立 `gates` 块无物可填。

**收敛规则——consumes/produces 是产物型门禁的唯一声明源，CLI 派生：**

| contract 声明 | CLI 派生的门 |
|------|------|
| `consumes[]` 中 `required: true` | entry gate：artifact 存在且 sealed（blocking） |
| `produces[]` 中 `role: primary` | exit gate：文件存在 + schema 校验（blocking） |
| `produces[]` 其余条目 | exit gate：存在性检查（warn，非 blocking） |

**contract 修改：**

1. **删除全部空 `gates: { entry: [], exit: [] }` 样板**（约 20 处）——缺省即"无额外门"。
2. **`gates:` 降级为 opt-in 扩展位**：仅声明非产物型检查（`command` / `manual` / `file` 三型，复用 §3.4 check 词汇），无则整块省略；支持命名引用注册表门（§7.2，字符串 = 查表，对象 = 内联）。
3. **删 `consumes[].require_status`**：required 即隐含 sealed（上游解析本就只返回 sealed artifact）。
4. **`produces[].kind` 与文件名 stem 相同时省略**（与 §4.1 文件名即 kind 一致）。已知冲突：`quality-review` 产 `outputs/findings.json` 而 kind 为 `review-findings`，与 analyze 的 `findings.json` 同名异义——**产物重命名为 `outputs/review-findings.json`**，冲突消解，无需显式 kind。

### 3.8 动态门禁生成（LLM 提议 · CLI 裁决）

门禁分两层：contract 是**定义时静态地板**（这类命令永远要什么），LLM 按上下文**运行时动态加码**（这次调用还发现需要什么）。动态门复用既有的 frontmatter 派生通道，不打破"LLM 不写协议 JSON"原则——**提议权下放，裁决权（注册、求值、waiver）全留 CLI**。

动态提议有**两个时刻、一套 YAML 词汇**（command/manual/file 三型，同 §3.4 check；均可按名引用注册表门，§7.2）：

| # | 接线规则 | 通道 | 生效时刻 |
|---|------|------|------|
| 1 | **主通道（前瞻）**：prepare 阶段 LLM 以 YAML 定义 goal + gates，经 `create --prep` 传入；CLI 注册进 `run.json.gates[]`（`source: prepared`）并在返回包回显——先定考纲再干活 | prep YAML → run create | run create |
| 2 | **追加通道（中途）**：frontmatter 可选 `gates:` 字段——运行中发现的新检查（如"碰了 auth，加安全门"），complete 时注册（`source: handoff`）并求值，失败不得 seal | frontmatter → run complete | run complete |
| 3 | `next[].needs` 接线为**下游 run** 的动态 entry gate | `run create` 时 CLI 合并 contract `consumes`（静态底线）+ 上游 handoff `needs`（动态收紧） | 下游 run create |
| 4 | `constraints[]` 中 `status: locked` 条目派生为 **session 级门**（manual 型），后续每个 run exit 阶段复核 | frontmatter → `session.json.gates[]` | 后续所有 run（可选阶段实施） |
| 5 | **单调性原则**：动态门只能收紧、不能放松——LLM 可增加检查，不得豁免/削弱 contract 派生门；waiver 仍是人类经 CLI 的专属操作 | —（求值器约束） | 恒定 |
| 6 | **门禁前置告知**：create 返回包附带 gates 清单（YAML 摘要：title + check 要点），含 contract 派生门 + prepared 门 + session 级 locked 约束门——LLM 知情、对照工作，但不管理；返回包结构见 §3.9 | CLI → create/brief 输出 | run create |

gate 提议格式（规则 1 prep YAML 与规则 2 frontmatter 共用）：

```yaml
gates:
  - { type: command, argv: [npm, test, --, --grep, auth], expect_exit: 0 }
  - { type: manual, prompt: "迁移脚本已在副本库演练" }
```

**可见性原则（修订基线指南 §7.1a）**：原表述"门禁完全移出 LLM 视野"收窄为"**记录与求值**移出视野，**判据**主动告知"。规则 6 让 LLM 从 create 起就知道 seal 时要过什么门（fail-early，避免干完活才在 seal 撞门），但 GateRecord 的注册、状态流转、求值、waiver 全程 CLI 内部。

**格式分工——LLM 侧一律 YAML，CLI 是唯一翻译层**：LLM 与门禁的全部交互收敛为三个 YAML 面——写 prep YAML（前瞻定纲）、读 create/brief 返回的 YAML 门禁摘要（知情）、写 frontmatter 的 YAML `gates:` 提议（中途收紧）；CLI 负责双向翻译（contract / prep / frontmatter YAML → GateRecord JSON；GateRecord JSON → 摘要）。协议 JSON 与 LLM 零接触，与 §四"frontmatter 是 LLM 唯一半结构化出口"完全同构。

**边界**：当前 run 自己的 entry gate 不可动态生成——entry 在 create 时求值，prep 定义的门缺省为 exit 作用域；动态 entry 只能由上游为下游预设（规则 3），这是因果律而非缺陷。代价：GateRecord +1 可选键 `source`（§3.4），`run.json` +1 键 `goal`（§3.3），LLM 必学 frontmatter 键 +1 可选键 `gates`（§4.2）。

### 3.9 Run 生命周期：prepare → create → brief → complete

执行正文由 CLI 按需返回；过渡期 Skill 入口收敛为**薄壳**（frontmatter contract + invariants），终态下第一档 step 无独立入口、由 next/ralph 驱动（§七）：

```text
用户携上下文调用 Skill（薄壳入口）
  1. maestro run prepare <cmd> [args]        # 只读：返回思考材料——结构层 YAML（purpose/
                                             #   invariants/contract 摘要）+ upstream aliases +
                                             #   boundary_contract + session 级门 + 参考文档清单
  2. LLM 任务前思考 → 写 prep YAML（字段见 §3.9a）
  3. maestro run create <cmd> --prep <yaml>  # 事务性出生：建 run + 注册 contract/prepared 门
     ← 出生包：run_dir + upstream + goal 回显 + gates 摘要
              + 执行正文（全量，对应原入口命令 @ 嵌入的效果）
              + 参考文档 deferred 清单（path + 一句摘要 + 何时读，LLM 按需 Read）
  4. LLM 执行：Read upstream →（按需 Read 参考文档）→ Write outputs/ → 写 report.md
     （中途可选）maestro run brief <run_id>   # 只读 Resume Packet：正文 + goal/gates 状态
                                             #   + 已产出 outputs 清单——防上下文压缩遗忘
     （中途可选）frontmatter gates: 追加收紧（§3.8 规则 2）
  5. maestro run complete <run_id>           # 扫描 outputs → 派生 → 求值全部门 → seal
```

### 3.9a 内容双文件拆分与 prep 字段

**现有入口命令与 workflow 文档的综合拆分**——原入口命令由若干标签组成（frontmatter + `<purpose>` + `<invariants>` + `<required_reading>` + `<process>`），按"谁在什么时刻需要"拆为**同名配对的两个文件**：`prepare/{name}.md`（YAML 头 + 思考材料，prepare 预读）+ `workflows/{name}.md`（核心流程正文，无 YAML 头，create 全量返回）：

| 现有组成 | 去处 | 交付时机 |
|------|------|------|
| frontmatter contract / `<purpose>` / `<invariants>` | `prepare/{name}.md` YAML 头 | prepare 预读（invariants 兼作 create 回显） |
| `<process>` 执行正文 | `workflows/{name}.md` 正文 | create 全量返回 |
| `<required_reading>` 中协议文档（run-mode.md） | **协议单源保留**——`run-mode.md` 一份文档承载，由 create 固定注入一次、brief 重附要点；prepare/workflow 禁止复述协议 | create/brief 注入 |
| `<required_reading>` 中领域 workflow 文档（brainstorm.md / blueprint.md…） | 专属领域内容即 `workflow/{name}.md` 正文（形态 A 恢复正文、形态 B 直接成正文，都随 create 全量返回）；跨 step 共享文档迁 `ref/`，走 deferred 清单 | 专属随 create；共享 deferred Read |

分层依据体现双文件分工：prepare 文件回答"做之前想什么"（结构 + 思考材料），workflow 文件回答"怎么做"（核心流程、需全量在场），run-mode 回答"在什么规则下做"（协议单源），finish-work 回答"做完怎么收"。

**prep YAML 字段**（prepare 的目的是让 LLM 任务前思考，字段即思考清单）：

```yaml
goal: "本 run 的完成定义（一句话）"        # 必填 → run.json.goal
approach: "打算怎么做（2–3 句）"           # 建议 → 预填 report.md《摘要》小节
scope: { in: [...], out: [...] }           # 可选 → 与 boundary_contract 对照，越界前置暴露
risks: ["预见的风险或不确定点"]            # 可选 → 预填 report.md concerns 起点
gates: [tests-pass, { type: manual, prompt: "…" }]   # 可选 → GateRecord(source: prepared)
reads: ["ref/brainstorm.md"]         # 可选 → 从 prepare 返回的参考清单中挑选本次深读项
```

**落点规则**：仅 `goal`/`gates` 进协议 JSON（§3.3/§3.4 已定义）；`approach`/`scope`/`risks` 不进权威文件——create 时 CLI 用它们**预生成 `report.md` 骨架**（frontmatter 占位 + 摘要/concerns 预填），思考产物直接成为报告起点，不二次劳动；`reads` 选中的参考文档在出生包中**全文内嵌**（LLM 已声明要读，deferred 徒增往返），其余仍走 deferred 清单；prep 全文在 `events.ndjson` 留痕备审计。

**三条钉死的决策**（防止新组件反噬简化目标）：

| # | 决策 | 理由 |
|---|------|------|
| 1 | **prepare 无状态**：只读、幂等，不建目录、不写文件、不产生 "prepared" 生命周期状态——prepare 是"看一眼"，create 才是事务性出生 | 否则多出半成品 run 状态，需要超时回收、孤儿清理，协议复杂度回流 |
| 2 | **双文件单源 + 按时交付**：同名配对的 `prepare/{name}.md` + `workflow/{name}.md` 是唯一内容源（双文件零重复：prepare 持有结构/思考、workflow 持有核心流程），CLI 按文件分时交付——prepare 文件给 prepare，workflow 文件 create 全量返回，共享参考迁 `ref/` 只给 deferred 清单（LLM 按需 Read）；协议文档 run-mode.md 保留为单源，由 create/brief 固定注入 | 内容拆分有物理边界（两个文件），零重复规则可验证；协议单源消除跨文件复述漂移，全量嵌入共享参考仍是上下文浪费 |
| 3 | **prepare 可选**：不带 `--prep` 的 create 退化为现行为（仅 contract 派生门，`goal: null`） | 轻量场景（next 的 companion 通道、`ralph --preset quick`）免三步开销；与"无 contract 也能跑"同构的渐进增强 |

prepare / create / brief 的返回包由**同一个 Builder** 组装（三种视图：思索材料 / 出生包 / 恢复包），不写三套逻辑。附带收益：entry 被 blocking 门挡住时正文根本不返回，零浪费；CLI 成为正文分发点后，overlay 与版本控制可在返回时统一套用。

**平台适配——prepare 的宿主感知**：prepare 检测宿主平台（或经 `--host` 显式指定），返回包附加 `host_tools` 段，指示 LLM 把 goal/gates **同步登记到宿主内置工具**以增强执行期自我约束与用户可见性：

| 宿主 | 内置工具映射 | 登记内容 |
|------|------|------|
| Codex | 内置 goal/plan 工具 | goal → plan 顶层目标；gates → plan 检查步骤 |
| Claude Code | TaskCreate / TodoWrite | goal → 任务描述；gates → 待办检查项 |
| 其他（gemini/opencode…） | 无映射时省略该段 | 仅 prep YAML 通道 |

**权威性规则**：prep YAML 是 goal/gates 的唯一权威通道，宿主内置工具登记只是**投影/镜像**——CLI 求值从不读取宿主工具状态，宿主侧丢失/漂移无害。这条与"aref 是投影、json 是真相"同构，防止内置工具成为第二真相源。

---

## 四、LLM 接触面收敛（键影响面最小化）

### 4.1 产物零协议键：文件名即 kind

指南 §7.2 已规定交付物 md 命名 `outputs/{kind}.md`——**把同一约定扩展到 json**：

```text
outputs/findings.json      → kind = findings（文件名推断）
outputs/risk-matrix.json   → kind = risk-matrix
outputs/plan.json          → kind = plan
```

扫描器规则修订：

```text
for file in outputs/*:
  kind   = _meta.kind ?? 文件名 stem          # _meta 从必填降为覆盖用
  schema = _meta.schema ?? "{kind}/1.0"       # 缺省约定
  role   = _meta.role ?? 推断（目录唯一 json → primary，其余 attachment）
  alias  = contract.produces[].alias          # 从命令 contract 取，不再由 LLM 在 _meta 声明
```

- **`_meta` 从"每产物必写 3–4 键"降为"完全可选的覆盖机制"**——仅在一个 Run 产出同 kind 多文件、或需非常规 schema 版本时才写。
- alias 声明权移回命令 contract（定义端本就有 `produces: [{path, kind, alias, role}]`），运行时 LLM 零负担。
- `_meta` 保留字声明补入指南：领域 schema 不得占用顶层 `_meta` 键。

### 4.2 frontmatter：7 键 → 5 键

LLM 唯一的结构化书写目标收敛为：

```md
---
verdict: ready
summary: "M1 认证规划完成，12 任务 / 3 波"
decisions:
  - text: "Redis 做 session 缓存"
    status: accepted
concerns:
  - "未覆盖 OAuth2 device flow"
next:
  - { command: execute, reason: "plan sealed", needs: [current-plan] }
---
```

- 必学键：`verdict` `summary` `decisions` `concerns` `next`；可选键：`constraints`（仅 grill/analyze 类命令用）、`gates`（动态门提议，§3.8）。
- **示例一律块式 YAML**，`text` 值加引号——修复原指南流式映射（`{ text: 含逗号即碎 }`）的脆弱性；此规则写入指南 §7.5。
- 删除 `produces:` 覆盖入口（原 §7.5 末段）——alias/kind 已由 contract + 文件名承接，不给 LLM 留第二条声明路径。

### 4.3 修复 report.md 的循环定位

原指南 §7.4 规则 5 声称 report.md "可从 (handoff + artifacts) 重建、丢失无害"——不成立（叙述正文只存在于 report.md，且 handoff 本身派生自 frontmatter）。修订为：

1. `report.md` 在 seal 前是**权威输入**（frontmatter + 叙述正文）；
2. seal 时 CLI 派生 handoff 后，report.md **定格为不可变产物**（注册 `role: report`），不再宣称可重建；
3. aref 解析采用**读取时渲染**（`maestro run render` 输出解析副本到 stdout/tmp），源文件永远保留 `{{aref:…}}` 占位符——解决就地替换毁模板的问题。stale 检测规则不变。

---

## 五、引用关系单向化

废除权威 JSON 间的双向引用网，只保留两类引用：

| 允许的引用 | 方向 |
|------|------|
| `artifacts.json` 条目 → `run_id`；`run.json.input.consumes` → artifact ref | child → 锚点，单向 |
| md（report/交付物）→ json（aref） | 投影 → 真相，单向 |

**废除**：`gates.evidence_refs` ↔ `evidence.gate_refs` ↔ `evidence.artifact_refs` 三角网、`session.json.refs`、`run.json.gate_ids`。任何"谁引用了我"的反向查询由 CLI 扫描/索引回答，不落盘。

---

## 六、对已改造命令的影响映射

命令已按基线指南改造完成，本次收敛对命令的改动**以删行为主**：

| 命令组 | 现状引用 | 修改内容 | 量级 |
|------|------|------|:---:|
| 核心链 `maestro-analyze` / `plan` / `execute` / `verify` | 内联 JSON 模板含 `_meta` 3–4 键；frontmatter 7 键模板；禁令列表提及 gates.json | ① 模板中 `_meta` 删除（文件名已是 `{kind}.json`）② frontmatter 模板换 5 键块式 YAML ③ 禁令列表删 `gates.json`/`evidence.json` 字样 | 每文件 5–15 行删改 |
| `quality-review` / `test` / `debug` / `auto-test` | 同上 | 同上 | 同上 |
| `odyssey-*`（5 个，引用最密：8–13 处） | outputs 路径 + frontmatter + _meta | 同上；核对 outputs 文件名与 kind 一致（文件名即 kind 后不一致会推断错） | 每文件 10–20 行 |
| `maestro-session-seal` | **读 `evidence.json` 提取 spec 候选**（L59）；引用 `promoted_spec_ids/knowhow_ids`（L73） | ① 改为扫描 `runs/*/run.json.handoff.decisions[]`（status: accepted）② `lifecycle.promoted` 新键名 | 结构性小改 |
| `maestro-ralph*` / `roadmap`（companion 已并入 next） | orchestration 子键（`inserted_by`/`decision_ref` 等） | 按 §3.2 新 chain/decision_points 键名对齐 | 每文件 3–8 行 |
| `maestro-grill` / `brainstorm` / `blueprint` / `collab` / `learn-investigate` | frontmatter（constraints 用户）+ outputs | frontmatter 5+1 键模板；`caveats`/`open_questions` → `concerns` | 每文件 5–10 行 |
| 命令 contract 块（全体） | 约 20 个命令带空样板 `gates: {entry: [], exit: []}`；`consumes[].require_status`、与文件名重复的 `produces[].kind` | 按 §3.7：删空样板、删冗余键；`gates:` 仅非产物型检查才出现；`quality-review` 产物改名 `outputs/review-findings.json` | 每文件 1–4 行删改 |
| 核心链 + 交互类 frontmatter 模板（叠加） | — | 按 §3.8：可选 `gates:` 提议字段写入模板说明；create 返回值文档补 `gates` 摘要字段 | 每文件 2–5 行 |
| **全部 run-mode 命令（结构性）** | 完整正文内联于 `.md`，Skill 调用即全量加载 | 第一档 step **跳过薄壳重构、直接迁 `steps/`**（§7.8，避免同一文件改两遍）；第二档 Run-aware Skill 保留入口、按 §3.9 薄壳化；核心链四 step 先行验证再铺开；`.codex/` 镜像为手动同步，需单独跟进 | **结构性迁移，最重的一项** |

CLI 侧（真正的实现主体）：SessionStore 去掉 gates/evidence 两个文件的读写与事务组、扫描器加文件名推断、门禁求值器 7 型 switch 减为 4 型（entry 在 create、exit 在 complete 内部求值，**独立 `run check` 动词废除**——其自检用途由 `run brief` 返回的 gates 状态吸收）、`session render` / `run render` 改为按需输出。

---

## 七、入口层重组：next + ralph 双命令

§3.9 薄壳化的逻辑终点：步骤正文既已由 CLI 分页返回，每个命令的独立 Skill 入口壳就成了纯冗余层。工作流类命令的用户入口收敛为两个，其余命令降级为**步骤（step）**。

### 7.1 三层结构

| 层 | 组成 | 职责 |
|---|------|------|
| **入口层** | `next`（单步·人在环）+ `maestro`（静态链·先定后跑）+ `ralph`（自适应链·自治） | 意图解析、路由/建链、run 生命周期驱动——**不含任何领域内容**（三入口细化见 `three-entry-migration-plan.md`） |
| **步骤层** | analyze / plan / execute / verify / review / test / debug / grill / brainstorm / blueprint / roadmap… | step = contract（YAML，CLI 消费）+ body（md，分页返回）；**无独立 Skill 入口** |
| **CLI 层** | `run prepare/create/brief/complete` + 路由支持 | 生命周期事务、门禁求值、正文分发、候选评分材料 |

**现状问题**：第一档的 ~15 个工作流命令（§7.6）各带入口壳；next 的路由表与 ralph 的 chain builder 是**两套路由脑**，评分逻辑重复且会漂移；ralph 有 5 个变体（ralph / v2 / cli / execute / cli-execute）。

### 7.2 统一注册表：step + gate + kind

CLI 是唯一注册者与加载者；两级作用域，**项目级覆盖全局级**：

```text
~/.maestro/                      # 全局注册表
├── steps/
│   ├── prepare/{name}.md        # 结构 + 思考材料（YAML 头，prepare 预读）
│   ├── workflow/{name}.md       # 核心流程正文（无 YAML 头，create 全量返回）
│   └── ref/{name}.md            # 跨 step 共享参考（deferred 清单，LLM 按需 Read）
├── gates/{name}.yaml            # 命名门禁（可复用检查定义）
└── kinds/{kind}.yaml            # artifact kind（schema id + 描述；指南 §7.2 的 kind 注册表落点）
.workflow/                       # 项目级覆盖（同名优先）
├── prepare/  workflows/  ref/  gates/  kinds/
```

**step 双文件形态**：同名配对的 `prepare/{name}.md`（YAML 头承载结构层，供 prepare 预读）+ `workflow/{name}.md`（md 正文承载核心流程，create 返回）——拆分规则见 §3.9a。正文不塞进 YAML 块标量，散文是给 LLM 读的，md 是正确介质。

> **撤回"声明式 step（CLI 独立执行）"**：无 LLM 在环的纯 CLI 步骤执行不可靠——检查失败后的解释、诊断与自适应本来就需要 LLM。纯检查需求用**命名 gate 组合**表达（挂在相邻 run 的 exit 上），不设无人执行的 step。CLI 的求值职责限定为客观事实（exit code、文件存在、hash），判断性检查一律 manual 型留给人/LLM。

**gate 统一注册**——常用检查定义一次、按名引用：

```yaml
# ~/.maestro/gates/tests-pass.yaml
title: 全部测试通过
check: { type: command, argv: [npm, test], expect_exit: 0 }
blocking: true
```

引用规则（所有 gate 出现面通用——contract `gates:`、prep YAML、frontmatter 追加）：**字符串 → 注册表查找；对象 → 内联 ad-hoc**，可混用：

```yaml
gates: [tests-pass, { type: manual, prompt: "迁移已演练" }]
```

两条硬规则：
1. **解析即快照**：run create/complete 解析命名引用时把 check 定义快照进 `run.json.gates[]`——注册表事后修改不回溯影响已 seal 的 run（与 aref 的 content_hash 快照同构）。
2. **注册可选**：内联永远合法——注册表为复用与治理服务，不是强制间接层（渐进增强，与"无 contract 也能跑"同构）。

**迁移与镜像**：`.claude/commands/` 中步骤入口文件删除（过渡期留一行 deprecation stub 指向 `next --step <name>`）；`.codex/` / `.agy/` 只需同步 2 个入口命令，步骤正文平台中立、由 CLI 按 `host_tools`（§3.9）适配返回。

### 7.3 路由派生——contract 一份声明三个用途

`consumes` 获得第三个用途：**路由前置条件**。step 成为路由候选 ⟺ 其 `required: true` 的 consumes alias 已存在且 sealed（即 dep-ready，与 session DAG 的就绪判定同构）：

| contract 声明 | 用途 1（§3.7） | 用途 2 | 用途 3（本节） |
|------|------|------|------|
| `consumes[]` | entry gate 派生 | `upstream` 装载 | 路由候选判定（dep-ready） |
| `produces[]` | exit gate 派生 | artifact 注册校验 | 路由后继推导（谁消费我产的 kind） |

路由评分的三个信号源统一进一个 scorer：**意图匹配**（用户输入 vs step 描述）+ **产物就绪**（consumes 可满足度）+ **上游建议**（最近 handoff 的 `next[]`——它本来就是显式路由信号，此前无人消费）。评分器只有一份，next 与 ralph 共享。

### 7.4 next 与 ralph 的关系：同一驱动器的两种投影

**next = ralph 循环体的单次迭代 + 人工确认**。二者共享同一 step driver：

```text
driver(step, args):
  route 评分（或显式 --step）→ prepare（可选思索）→ create --prep（领正文 + gates 摘要）
  → 执行正文 → complete → 返回 handoff
```

| | next | ralph |
|---|------|------|
| 循环 | 执行一步即停，输出 handoff + 下一步推荐 | `loop(driver)` 直到 DAG 收敛或 blocked |
| 确认 | 路由结果需用户确认 | 无确认；decision points 按 evidence 自动裁决，仅升级时问人 |
| orchestration | `engine: manual`，不建 chain（现有语义保留） | `engine: ralph`，chain/decision_points 写 `session.json.orchestration` |

**5 个 ralph 变体收敛为 1**：执行方式降为参数 `--engine inline | agent | cli`（分别对应现 ralph / ralph-v2 的 Agent(ralph-executor) / ralph-cli 的 delegate 路径）；execute / cli-execute 两个包装命令成为 driver 的内部实现，不再是用户可见命令。以 ralph-v2 语义为合并基线。

### 7.5 调用语义

| 场景 | 调用 |
|------|------|
| 单步·人在环 | `/maestro-next "重构认证模块"` → 路由推荐 → 确认 → 执行一步停 |
| 显式指定步骤（保留强用户能力） | `/maestro-next --step analyze "topic"` |
| 自治连跑 | `/maestro-ralph "重构认证模块" [--quality quick\|standard\|full] [--engine …]` |
| 轻量管线 | `maestro-quick` 并入 ralph 预设：`/maestro-ralph --preset quick` |
| 步骤可发现性 | `maestro steps list`（CLI 动词，替代逐个翻命令文件） |

### 7.6 命令三档分类（取代模糊的"重要/非重要"）

| 档 | 形态 | 判定标准 | 归属 |
|---|------|------|------|
| **Step** | `prepare/{name}.md` + `workflows/{name}.md`（同名配对），无独立入口，next/ralph 驱动 | 参与核心产物链：contract 的 consumes/produces 与其他 step 交接 | analyze / plan / execute / verify / review / test / debug / auto-test / retrospective / collab / grill / brainstorm / blueprint / roadmap |
| **Run-aware Skill** | 保留 Skill 入口，自己调 `run create/complete`，产物进 Run | 独立触发、有自己的交互/编排模型，但产物值得进 artifact 链 | team-* 全家、odyssey-*、learn-* |
| **Plain Skill** | 保留现状，不进 run 体系 | meta 工具或纯交互，无产物交接需求 | overlay / amend / composer / player / maestro-help、scholar-* |

- **team skill 零迁移成本**：其 coordinator/worker 编排模型自成体系，硬拆为 step 反而破坏内聚——归第二档，保留"想要产物进链就调 run create"的选项。
- **降档兼容**：某 step 若实践中不适合被 next/ralph 驱动，降回第二档即可，机制完全兼容——第一档迁移无回头压力。
- 例外照旧：`maestro-init`（Session 前例外，指南 §十三）、`session-seal` / `fork` / `merge`（session 动词，ralph 可在 seal 决策点自动触发）；`maestro-companion` 并入 next（`three-entry-migration-plan.md` §1.3）。

### 7.7 风险与对策

| 风险 | 对策 |
|------|------|
| 双入口膨胀为 God prompt | 入口层只许含路由 + 生命周期驱动；领域内容一律在 step body——以 delegation-check 的内容分离标准约束 |
| 失去直接入口的可发现性/调试便利 | `--step` 显式覆盖 + `maestro steps list`；stub 过渡期保留 |
| ralph 变体行为合并回归 | 以 ralph-v2 为基线，`--engine` 逐模式迁移验证，不齐步切换 |
| 路由评分单点失误连锁放大（ralph 自治时） | 单调性门禁不受路由影响；decision points 的 blocked 升级路径保留人在环兜底 |

### 7.8 分阶段实施

```text
A. CLI：steps 注册表 + 分页器 + 路由评分材料接口（此时原命令仍可用）
B. next 重写为通用 step driver（验证 route→prepare→create→complete 闭环）
C. ralph 以同一 driver 为核心合并 5 变体（--engine 逐个迁移）
D. 删除步骤入口文件 → deprecation stub → 一个过渡版本后移除
```

---

## 八、实施顺序

1. **修订基线指南**：按本规划更新 `session-run-structure-guide.md` 的 §五/§六/§七/§九/§十一/§十二（含 §四目录树、双真相源规则、artifacts 定位、report.md 定位三处一致性修复），schema 版本号 `*/1.1`。
2. **CLI 收敛**：`run create/complete`、`seal-session` 按新 schema 读写（`run check` 废除，entry/exit 求值内化到 create/complete，自检并入 `brief`）；删除 gates.json/evidence.json 代码路径；新增只读动词 `run prepare` / `run brief`（宿主感知 + 统一 Builder）与 `create --prep` 入参、正文分页器（§3.9）。
3. **命令批量微调**：按 §六映射表逐组修改（以删行为主），核心链先行验证闭环，再铺开 quality-* / odyssey-* / 其余；薄壳重构（§3.9）仅适用于保留入口的第二档 Run-aware Skill——**第一档 step 跳过薄壳，直接并入步骤 4 的注册表迁移**，避免同一批文件改两遍。
4. **入口层重组**：按 §7.8 的 A–D 分阶段——steps 注册表与分页器（A）可与步骤 2/3 并行；next 重写（B）、ralph 合并（C）、入口文件下线（D）依次推进。
5. **冻结 v1.1**：核心链 analyze→plan→execute→verify 经 next/ralph 驱动全闭环跑通后冻结，与指南 §十三"核心链先行"原则一致。

---

> 本规划不触碰：Hook 注入、强制力内核、Watcher、并发/CAS、成本控制等运行时协议（见 FINAL）；`kg/` `domain/` `collab/` `impeccable/` `.team/` 等非 session 产物目录。
