# Maestro 知识系统架构

> 状态：已实现（核心闭环与已审计检索/生命周期缺口已收敛）
> 更新日期：2026-07-28  
> 范围：Spec、Knowhow、Maestro Search、MaestroGraph，以及 Session/Run 知识沉淀闭环。

本文描述知识系统的权威数据、状态转换和命令协作。操作示例见
[知识管理指南](../guide/knowledge-management-guide.md)，检索算法细节见
[搜索系统指南](../guide/search-system-guide.md)，Session/Run 通用协议见
[Session-Run 架构参考](../guide/session-run-architecture.md)。

> **Wave 2 supersession（2026-08）**：本文中把 `session seal` 列为流程收口的段落保留为历史 `session/1.x` compatibility/audit context，不再表示 promotion gate。当前 session-source candidate 绑定 immutable candidate/evidence snapshot；session-level reconciliation fresh 后即可显式 promotion without a permanent Session seal。Run-source candidate 仍要求各 source Run sealed。`session/2.0` 没有永久 Session seal；Execution completion 由 `execution-seal-receipt/1.0` 封存单个 generation，且任何 seal 都不会隐式 promotion。

---

## 1. 设计目标

知识系统解决四个相互制约的问题：

1. **沉淀**：Run 中使用过的知识、被接受的决策和锁定约束必须有可追溯记录。
2. **复用**：搜索结果应保持相关性，同时避免单一文件、来源或历史热门知识垄断结果。
3. **演化**：新增知识在写入前必须识别重复、关联、冲突与替代关系。
4. **治理**：剪枝必须可恢复、保留演进链，并且不能把搜索曝光误当成知识正确性。

系统遵循以下不变量：

- Search 和自动注入只代表 **exposure**，不会自动提升可信度或写入 Spec/Knowhow。
- 显式 `load`，或带 `--signal/--signal-ids` 的 `knowledge stage`，才能形成 Run 级消费/验证证据。
- Run 完成只暂存 candidate，不直接修改项目知识。
- 任何 semantic duplicate、conflict 或 supersession 都必须先有 reconciliation receipt。
- 需要判断的关系由人确认；promotion 必须显式执行。
- Deprecated 知识保留在演进链中，但默认不参与搜索和注入。
- `knowledge audit` 始终只读；`--prune` 只在输出中附加 deterministic soft-action report，不提供 apply、mutation 或物理删除路径。
- `knowledge audit` 检查 Spec/Knowhow，以及 pipeline、usage、compatibility/identity/link/capability/promotion 状态；它不顺手改写语料。规范化是独立 report-first 操作，必须先保存并审阅 `knowledge normalize --report <path>`，再以同一路径显式 `--apply`。源哈希或 repo_id 改变会使报告失效。

### 1.2 Canonical creation and repository authority

普通 Knowhow 的最小参数只有 `type/title/content`；普通 Spec 的最小参数只有 `category/title/content`。九种 Knowhow 类型保持兼容：`session|tip|template|recipe|reference|decision|asset|blueprint|document`。`keywords/sourceRef/relatedPaths/appliesToRepoIds/language/decisionState/explicitId/tool` 是高级可选字段，不应出现在所有示例的必填面。

仓库身份只由 host 提供。当前仓库写入省略 `targetRepoId`。Agent 仅在用户/工作流显式选择 linked physical target、且 host 同时提供该目标的 exact stable UUID 与匹配 corpus 的 live write capability 时传 `targetRepoId`；值必须等于 host 提供的 UUID。禁止从 cwd、repo name、alias 或 path 推导 ID，也禁止把 alias/path 持久化为 identity。缺少权限或 identity mismatch 时 fail closed。多仓库仍是单物理目标写入；不做 physical multi-target copy，也不跨仓库 supersede。

### 1.1 历史偏差收敛状态

以下条目来自 [知识系统缺口交叉分析报告](knowledge-system-gap-analysis.md)（2026-07-17 审计快照）。
截至本文更新日，原列入核心架构的偏差均已关闭；保留此表用于追踪修复机制，不能再作为当前缺口清单。

| 缺口 ID | 当前状态 | 收敛机制 |
|---------|---------|---------|
| X1 | 已关闭 | `spec-keyword-index.ts` 在建立注入索引时排除 deprecated 条目，并由回归测试锁定 |
| X3 | 已关闭 | 搜索从 credibility 存储读取 exposure signals，仅用于 relevance-floored exploration slot；缺失或损坏时关闭 exploration |
| X4 | 已关闭 | `rankNormalize` 仅决定跨源交错顺序；展示 `score` 保留源内真实归一化相关度 |
| G-C3 | 已关闭 | facet 通过 daemon 协议下推到 WikiIndexer，在 BM25/向量候选截断前应用；旧 daemon 未确认 `filtersApplied` 时回退本地预过滤 |
| G-B3 | 已关闭 | Knowhow 支持 replay-safe deprecate/supersede 生命周期；audit 仅报告可审查的 lifecycle suggestions，不调用 mutation API |
| G-A4 | 已关闭 | Spec writer 使用跨进程 O_EXCL lock 和 tmp+rename 原子 read-modify-write |

更早关闭的 X2/G-A6/G-A8/G-C11（canonical identity、共享 Spec parser、Knowhow ID、family diversity）
记录在 gap analysis 的历史说明中。完整历史缺口与原始证据仍以该报告为准。

---

## 2. 分层数据模型

```text
┌──────────────────────────────────────────────────────────────┐
│ 项目知识源                                                   │
│ .workflow/specs/*.md          .workflow/knowhow/*.md         │
│ 约束、规则、演进链             决策、配方、参考、模板          │
└───────────────────────────────┬──────────────────────────────┘
                                │ index / extract
┌───────────────────────────────▼──────────────────────────────┐
│ 可重建投影                                                   │
│ WikiIndexer / BM25F / embedding / MaestroGraph / credibility │
│ 搜索、关系遍历、canonical ID 映射、曝光统计                  │
└───────────────────────────────┬──────────────────────────────┘
                                │ search / load / injection
┌───────────────────────────────▼──────────────────────────────┐
│ Run 知识账本                                                  │
│ knowledge-delta.json                                         │
│ inputs[]：consumed/cited/validated/contradicted              │
│ candidates[]：propose/reaffirm/supersede/contest             │
└───────────────────────────────┬──────────────────────────────┘
                                │ reconcile
┌───────────────────────────────▼──────────────────────────────┐
│ 协调凭证                                                     │
│ knowledge-reconciliation.json                               │
│ matches + evidence + disposition + eligibility + freshness  │
└───────────────────────────────┬──────────────────────────────┘
                                │ resolve / promote
┌───────────────────────────────▼──────────────────────────────┐
│ 项目知识演进                                                 │
│ created / reaffirmed / deprecated / supersedes / contested  │
└──────────────────────────────────────────────────────────────┘
```

各层只拥有本层事实：

| 层 | 权威内容 | 非权威内容 |
|---|---|---|
| Spec/Knowhow 源文件 | 正式知识正文、状态、演进关系 | 搜索排名、Run 使用情况 |
| 搜索/KG 投影 | 可查询索引、图关系、曝光计数 | 知识是否正确、是否应 promotion |
| Run ledger | 本 Run 使用和候选事实 | 项目知识最终状态 |
| Reconciliation receipt | 某个 candidate snapshot 对某个 corpus 的匹配结论 | 永久有效的人工裁决 |
| Session summary | 跨 Run 聚合、corroboration | 单个 Run 的原始证据 |

---

## 3. 身份模型

### 3.1 三种身份

搜索结果同时保留三类身份：

| 字段 | 用途 |
|---|---|
| `id` | Canonical 用户身份，可直接传给 `maestro load --id` |
| `graphId` | MaestroGraph 内部稳定节点身份 |
| `aliases[]` | 兼容旧索引或历史调用方 |

Spec KG extractor 与 WikiIndexer 使用同一 canonical 解析器（收敛后唯一入口：
`src/tools/spec-entry-parser.ts`；dashboard 侧副本与 KG extractor 私有解析器已废弃）。
项目 Spec 子条目采用 `spec:project:{file-stem}-{NNN}`；Knowhow ID 统一小写，并保留
KG alias。调用方不得根据绝对路径或行号自行构造知识 ID。

### 3.2 Candidate 身份

Candidate ID 为 `KDC-{16 hex}`，由 `target + NFKC/小写/空白归一化后的 content`
计算。相同内容在不同 Run 中得到相同 ID，从而可以在 Session 级聚合：

- 仅一个有效源 Run：`observed`；
- 多个有效源 Run：`corroborated`。

同一 candidate 不能在 Session 内以互相冲突的 action 重复暂存。

---

## 4. 检索与多样性

### 4.1 检索边界

`maestro search` 是统一入口：

- 默认：Wiki/知识搜索；
- `--code`：仅 codegraph；
- `--kg`：MaestroGraph full-source；
- `--type`、`--category`、`--tag`、`--workspace`：通过 daemon 协议下推，
  在 BM25 和向量候选截断前执行约束；CLI 仍保留后过滤作为防御。若正在运行的旧 daemon
  未返回 `filtersApplied`，客户端自动回退到本地预过滤搜索；
- `--include-deprecated`：显式请求历史条目；

`--type knowhow --kg` 不得泄漏 codegraph 或 Spec 节点。KG 返回的 canonical `id`
必须可被 `maestro load` 回读。

### 4.2 防集中策略

Balanced 模式不是把低相关结果随机插入，而是在相关候选池中执行有界选择：

1. canonical identity 去重；
2. 同一父文档/知识家族设置 family cap；
3. KG 混合结果设置 source cap；
4. Wiki 结果使用高相关权重的 MMR，降低内容重复；
5. 当结果数足够且有曝光统计时，最多保留一个 relevance-floored exploration slot。

曝光计数只影响这个有界 exploration slot：

- 不进入基础 relevance score；
- 不影响 conflict/duplicate 判断；
- 没有计数或计数损坏时自动关闭 exploration，不影响搜索本身。

Exposure 读路径只在候选池足够且 balanced 模式启用时按需打开。缺少计数、数据库损坏或
read-only probe 会关闭 exploration slot，但不会影响基础搜索、MMR 或 family/source caps。

这避免了“越常命中越靠前、越靠前越常命中”的正反馈，同时不牺牲首要结果的相关性。

---

## 5. Run 知识账本

每个 Run 可拥有 `{run_dir}/knowledge-delta.json`，schema 为
`run-knowledge-delta/1.0`。

### 5.1 输入信号

| Signal | 含义 |
|---|---|
| `consumed` | 已显式加载并用于当前工作 |
| `cited` | 在报告或产物中引用 |
| `validated` | 当前执行提供了支持证据 |
| `contradicted` | 当前执行发现反例或不一致 |

`search` 和 injection 不自动写 `consumed`。显式 `maestro load` 自动记录 `consumed`
（`load.ts` 内部调用 `recordActiveRunKnowledgeInputs`）。更强的关系（`cited`、
`validated`、`contradicted`）通过 `stage` 命令附带记录：

```bash
printf '%s\n' "规则正文" > /tmp/rule.md
maestro knowledge stage spec "规则标题" --content-file /tmp/rule.md \
  --run <run-id> --session <session-id> \
  --signal validated --signal-ids spec:S-1,knowhow:K-1
```

纯归因（不建候选）用 `record` 命令——检索命中、引用、验证或矛盾均可记账，
高价值信号建议附证据锚点：

```bash
maestro knowledge record spec:S-1 knowhow:K-9 \
  --signal validated --source search \
  --evidence run:<run-id>,artifact:<artifact-id> \
  --run <run-id>
```

`knowledge review --json` 输出按来源统计（`input_totals_by_source`）与逐条明细
（`inputs`，含 `evidence`），可核对各来源的检索/加载/手动归因。

### 5.2 Candidate

Candidate 的目标只有 `spec|knowhow`，action 为：

| Action | 意图 |
|---|---|
| `propose` | 新知识 |
| `reaffirm` | 重新确认既有知识 |
| `supersede` | 用新知识替代旧知识 |
| `contest` | 提出冲突或反例 |

来源为 `manual|decision|constraint`。Run 完成时，`report.md` 中 accepted decision
和 locked constraint 会被转换成 candidate；它们仍处于 pending，不直接写项目知识。

Candidate 状态机：

```text
pending ── promote transaction ──→ promoting ── commit ──→ promoted
   │                                  │
   └── duplicate/conflict ───────────→ rejected
                                      │
                                      └── interrupted → replay-safe recovery
```

**中断恢复检测**：`promoting` 中间态与 promotion receipt 持久化到 Run 目录。
恢复时，promote 命令检查 receipt 中是否已存在该 candidate 的 `outcome` 记录：
若存在则跳过写入、直接返回已有结果（幂等重放）；若不存在则从 `promoting` 重新
执行写事务。检测逻辑不依赖进程内存，仅依赖磁盘 receipt。

---

## 6. Reconciliation：写入前知识协调

### 6.1 Receipt

`maestro knowledge reconcile` 生成
`{run_dir}/knowledge-reconciliation.json`，schema 为
`knowledge-reconciliation/1.0`。每个 match 保存：

- canonical knowledge ID、来源文件与行号；
- lexical、semantic、title、relation、stance、composite 分数；
- novelty 与可读 evidence；
- 目标内容 hash。

可能的 disposition：

| Disposition | 默认 eligibility | 行为 |
|---|---|---|
| `unique` | `eligible` | 可 promotion |
| `exact_duplicate` | `suppressed` | 自动拒绝重复 candidate |
| `semantic_duplicate` | `review_required` | 人工确认 duplicate/related/unique |
| `extends` / `related` | `review_required` | 人工确认关系或替代 |
| `potential_conflict` | `review_required` | 人工确认 conflict/related/unique |
| `supersede_candidate` | `review_required` | 人工确认 supersede |

Exact duplicate 可以自动 suppress；语义关系和规范立场不能只凭阈值自动裁决。

### 6.2 Freshness fence

Receipt 同时绑定：

- `candidate_snapshot_hash`：Run ledger 与 report candidates 的快照；
- `corpus_fingerprint`：当前 Spec/Knowhow corpus；
- `matcher_revision`：匹配算法版本。

任一 fence 改变，receipt 即为 stale。`resolve` 和 `promote` 对 stale/missing receipt
fail closed，必须先重新 reconcile。

### 6.3 Review surface

```bash
maestro knowledge review <session-id> [--refresh] [--json]
maestro knowledge review <session-id> --resolve <candidate-id> \
  --as duplicate|related|conflict|supersede|unique \
  [--target <knowledge-id>] --reason "<reason>"
```

`review` 是人工审查的唯一聚合界面，展示：

- 每个 candidate 的 `missing|stale|fresh`；
- 最多 3 条多样化 match 及 evidence；
- disposition、eligibility 和 canonical target；
- 可复制的 promote 命令。

`--refresh` 内含 reconcile：刷新所有 candidate source Runs 的 reconciliation receipt。
`--resolve` 内含裁决：在构建视图前执行 `resolveKnowledgeCandidate()`，然后展示
刷新后的结果。默认 review 只读。

### 6.4 积压治理

6 种 disposition 中 4 种为 `review_required`。在活跃项目中，未裁决 candidate 会随
Run 数量线性增长。当前系统提供以下治理手段：

- `review` 按 disposition 严重度排序展示（conflict > supersede > extends > related）；
- `session seal` 报告未处理 backlog 计数，不隐式丢弃；
- `audit --scope all` 统计 pending observed/corroborated backlog 总量。

**尚未提供但建议的能力**：

- 批量裁决语法（如 `resolve --all-as unique --session <id>`）；
- observed-only candidate 超过 N 个 Session 未 corroborate 时自动 suppress；
- 按 corroboration 计数和 candidate 龄期排序的优先级分诊视图。

---

## 7. Resolve、Promotion 与演进

人工裁决命令：

```bash
maestro knowledge review <session-id> --resolve <candidate-id> \
  --as duplicate|related|conflict|supersede|unique \
  [--target <knowledge-id>] \
  --reason "<evidence-backed reason>"
```

Promotion 必须显式选择：

```bash
maestro knowledge promote <session-id> --candidate <candidate-id>
maestro knowledge promote <session-id> \
  --candidate <candidate-a> \
  --candidate <candidate-b>
maestro knowledge promote <session-id> --all
```

规则：

- `--candidate` 可重复，也兼容逗号分隔；
- 显式 selection 只刷新所选 candidate 的 source Runs；
- `--all` 处理所有 eligible pending candidates（observed-only 输出警告但不跳过）；
- review-required、suppressed candidates 会被跳过；
- promotion receipt 的 `outcome` 描述写入结果：`created|reaffirmed`；
- supersession 语义由新旧条目的 `supersedes` / `superseded-by` 和旧条目
  `deprecated` 状态表达，而不是单独的 promotion outcome。

Promotion 使用持久化 receipt 和 `promoting` 中间态，可在中断后安全重放，不重复创建条目。

**并发写隔离**：Spec promotion 和常规 Spec append 使用共享的 lock-guarded atomic update：
跨进程 O_EXCL lock 覆盖完整 read-modify-write，内容先写入临时文件，再 rename 替换目标。
并发 writer 因此串行化，不能再以旧内容覆盖其他 Session 已提交的条目；崩溃遗留 lock
超过 stale 窗口后可回收。

---

## 8. Session/Run 协同

### 系统管线（自动步骤标注 [auto]）

```text
prepare/create
  → brief 注入 knowledge-reconciliation-card
  → [auto] search/load → 自动记录 consumed（load.ts）
  → [manual] stage candidates（可附带 --signal 记录更强关系）
  → [auto] run check → 自动 reconcile（runtime.ts）
  → [auto] run complete → 自动暂存 decisions/constraints + seal Run
  → [manual] review --refresh → 审查 + 裁决（--resolve）
  → [manual] promote selected candidates
  → [manual] session seal
```

### 用户最短路径

```bash
maestro knowledge review <session-id> --refresh
maestro knowledge promote <session-id> --all
maestro session seal <session-id>
```

关键边界（**硬门禁** = fail closed，阻止继续；**软建议** = 警告但允许继续）：

- `brief` 只注入摘要、策略和下一步命令，不自动加载所有知识正文；
- `check` 全绿后，finish checklist 要求完成知识记录、reconciliation 和 verdict（**软建议**：
  checklist 未完成时 `check` 输出警告，但不阻止 `complete`）；
- `complete` 返回 candidate IDs 与 reconciliation summary，但不执行 promotion；
- `resolve` 和 `promote` 对 stale/missing reconciliation receipt **fail closed**（**硬门禁**）；
- `promote` 要求所有 source Runs 已 sealed（**硬门禁**）；
- `session seal` 可以报告未处理 backlog，不会偷偷丢弃 candidate；
- `session seal --json` 使用统一的 `run-response/1.0` envelope；
- promotion 可以发生在 Session seal 前。

---

## 9. Read-only Audit 与 prune report

```bash
maestro knowledge audit --scope spec|knowhow|all
maestro knowledge audit --scope all --prune
maestro knowledge audit --scope all --json
```

只有 `spec`、`knowhow`、`all` 三种 scope。Pipeline/repository 诊断始终执行；MaestroGraph 已初始化时附加 usage 统计。Audit 实现的检查包括：

- Spec：missing SID、unsynchronized supersession、exact duplicate、dangling links、supersession cycle、stale-active observation；
- Knowhow：required metadata、frontmatter、ghost related path、exact duplicate；
- Pipeline：invalid Session authority/knowledge ledger、corroborated promotion backlog；
- Usage：exposure concentration（只观察）；
- Compatibility/repository：legacy aliases/unscoped/free category、manifest、linked ID/capabilities、pending cross-repo promotion。

`--prune` 只把确定性的建议加入 `prune_plan`：Spec 的 `deprecate` 建议仅来自 unsynchronized supersession/exact duplicate，Knowhow 的 `supersede` 建议仅来自 exact duplicate。它不调用 lifecycle API，也不写 report、backup 或 knowledge file。Audit 不提供 `--apply`、delete、purge 或交互处置阶段。

系统不依据低命中、低曝光或年龄生成 prune action。若人工认可建议，后续 lifecycle change 必须通过另行授权的显式 Spec/Knowhow 命令执行。Compatibility migration 也不属于 audit；唯一显式迁移 apply 是 reviewed `knowledge normalize --report <path>` 快照的同路径 `--apply`。

---

## 10. 命令协作矩阵

| 阶段 | 命令 | 写入 |
|---|---|---|
| 检索 | `maestro search` | 最多写 exposure counter |
| 读取 | `maestro load` | 可记录显式 consumption |
| 暂存 + 归因 | `maestro knowledge stage` | Run candidate + 可选 signal（`--signal --signal-ids`） |
| 审查 + 裁决 | `maestro knowledge review` | 默认只读；`--refresh` 内含 reconcile；`--resolve` 内含裁决 |
| 提升 | `maestro knowledge promote` | Spec/Knowhow + promotion receipt |
| 治理 | `maestro knowledge audit` | 始终只读；`--prune` 仅附加 deterministic suggestion report |
| 收口 | `maestro session seal` | Session sealed 状态 |

所有 knowledge 子命令支持 `--workflow-root`，便于在隔离项目、脚本和测试中使用。

**隔离保证**：`--workflow-root` 将全部读写限定在指定目录的 `.workflow/` 子树内。
不同 workflow-root 之间的 candidate、reconciliation receipt 和 promotion receipt
互不可见、互不引用。跨 workflow-root 的知识共享只能通过 `workspace link` 机制
（见知识管理指南），不通过 knowledge 子命令。

---

## 11. 验证与可观测性

推荐验证：

```bash
# 人工审查
maestro knowledge review <session-id> --json

# 项目知识健康
maestro knowledge audit --scope all --prune --json  # report-only; no files changed
maestro spec health --json

# 搜索类型隔离与 canonical ID 回读
maestro search "<query>" --type knowhow --kg --read-only-probe --json
maestro load --type knowhow --id <canonical-id> --list --json

# Release gates
npm run check:search-ranking-release-machine:source
npm run build
npm run check:search-ranking-release-machine:built
npm run check:session-run-contract-parity
npm run check:session-run-release-machine
```

端到端回归用例位于 `src/commands/knowledge.test.ts`，覆盖：

`stage + signal → review/resolve → complete → promote → seal → search readback`。
显式 `load → consumed` 的归因由 `src/commands/load.test.ts` 和 Run ledger 测试独立覆盖。

### 11.1 失败模式与降级行为

| 失败场景 | 系统行为 | 恢复方式 |
|---------|---------|----------|
| reconcile 中途崩溃（部分 match 已写入） | receipt 文件不完整，缺少 `corpus_fingerprint` 或 `matcher_revision` | 重新执行 `reconcile`；旧的不完整 receipt 被整体覆盖 |
| promote 事务中断（spec 文件已写、receipt 未持久化） | candidate 停留在 `promoting` 态；spec 文件已包含新条目 | 重新执行 `promote`：检测到 spec 条目已存在则跳过写入，补写 receipt（幂等重放） |
| knowledge-delta.json 损坏（JSON parse 失败） | `review`/`reconcile` 对该 Run 报告 `missing`，跳过其 candidates | 手动修复或删除损坏文件；不影响其他 Run |
| corpus fingerprint 计算超时（极大 corpus） | 当前实现为同步全量 hash；无超时保护 | 短期：减少 corpus 规模或排除无关目录。中期：改为增量 hash |
| 两个 Session 并发 promote 到同一 spec 文件 | 跨进程 lock 串行化完整 read-modify-write；后进入者读取前一提交后的内容 | lock 超时会 fail closed；确认持有进程或等待 stale lock 回收后重试 |
| freshness fence 误判（corpus 变更与 promote 竞态） | promote 在 fence 检查通过后、写入前 corpus 被第三方修改 | 写入成功但 evidence 可能过时；下次 `review --refresh` 会重建 receipt |

---

## 12. 设计总结：Evidence-Fenced Knowledge Compiler

该系统可以视为一个 **证据围栏知识编译器**：

```text
Run observations
  → candidate IR
  → semantic reconciliation
  → freshness/type checks
  → human resolution
  → transactional promotion
  → searchable projection
```

创新点不在于增加一个相似度阈值，而在于把“搜索到”“使用过”“认为正确”“允许写入”
拆成四种不同事实，并用 receipt 和 freshness fence 连接。这样既能自动发现知识关系，又不会让搜索热度、模型判断或单次 Run 越权修改项目规范。

---

## 变更记录

| 日期 | 变更 | 关联 |
|------|------|------|
| 2026-07-28 | 初版：完整描述分层数据模型、身份模型、检索多样性、Run ledger、reconciliation、promotion、audit 和命令协作矩阵 | — |
| 2026-07-28 | 架构审查修复：状态标注改为"已实现（核心闭环）"；增加 §1.1 已知偏差；§3.1 补充解析器收敛路径；§4.1/4.2 标注检索层缺口；§5.2 补充恢复逻辑；新增 §6.4 积压治理；§7 补充并发风险；§8 标注门禁强制性；§9 补充 audit 交互；§10 补充隔离保证；新增 §11.1 失败模式 | 审查 |
| 2026-07-28 | 流程精简：删除 record/session 子命令；resolve 合并到 review --resolve；reconcile 降级为内部（review --refresh 内含）；stats 标记 deprecated；stage 吸收 record 信号（--signal/--signal-ids）；promote --all 移除 corroboration 硬门槛；§5.1/6.3/7/8/10 同步更新；同步更新 guide/skills/workflows 共 12 个文件 | 精简 |
| 2026-07-28 | 收敛复核：关闭 X1/X3/X4/G-C3/G-B3/G-A4；facet 下推到 daemon/WikiIndexer 预过滤；Spec writer 使用跨进程原子更新；同步精简后的命令面与回归描述 | 修复 |
