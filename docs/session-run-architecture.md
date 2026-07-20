# Session Run 架构参考

## 概述

Session Run 是 Maestro 的链式执行编排核心，位于 `src/run/`。围绕 `session/1.x` + `command-run/1.x` 协议构建，支持 ralph / coordinator / manual 三种引擎，提供 prepare → create → brief → check → complete 生命周期。

## 模块结构

| 层 | 文件 | 职责 |
|---|---|---|
| 协议定义 | `schemas.ts`, `protocol-schemas.ts` | session/run/artifact/gate 全量 Zod schema |
| 运行时 | `runtime.ts` | 生命周期编排（create/check/complete/next） |
| 链管理 | `chain-admin.ts`, `next.ts`, `chain.ts` | engine-agnostic 链步进、birth packet 发射 |
| 持久化 | `store.ts` | SessionStore 单一写入路径（validation/backup/revision） |
| 注入 | `inject.ts` | birth packet framed sections（core + extension） |
| 契约 | `contract.ts` | command-contract v1/v2.0/v2.1 解析与强制 |
| 身份 | `intent-identity.ts`, `topic-identity.ts` | NFKC Unicode-safe 意图/主题匹配 |
| 复用 | `reuse-assessment.ts`, `recall.ts`, `recall-actions.ts` | similarity advisory + recall 基础设施 |
| 转换 | `session-transition.ts` | resolve/resume 生命周期闭合 |
| 响应 | `response.ts` | run-response/1.0 all-exit CLI envelope |
| 租约 | `lease.ts` | 惰性并发保护（opt-in） |
| 裁决 | `decide.ts` | decision point 评估落盘 |
| 迁移 | `migrate.ts` | 跨版本 schema 迁移 |
| 产物 | `artifacts.ts` | artifact 注册与 gate 校验 |
| 上下文 | `context.ts` | 命令源解析、平台解析 |
| 变更账本 | `mutation-ledger.ts` | 变更审计追踪 |
| 转换回执 | `transition-receipts.ts` | 转换操作回执 |
| 检查点 | `checkpoint.ts` | 断点续接状态 |
| 报告 | `report.ts` | 人读综合报告生成 |
| ID 生成 | `ids.ts` | run/session ID 分配 |
| 默认值 | `defaults.ts` | 协议默认值常量 |

## 生命周期动词

```
prepare → create → brief → check → complete
```

- **prepare**：只读幂等，预览 step 的消费/产出契约，不分配 Session。
- **create**：分配 Session + Run，返回 `session_id / run_id / run_dir / upstream`。
- **brief**：Resume Packet，断点续接的单注入点。
- **check**：校验 gate 状态，识别 blocking 条件。
- **complete**：提交当前 Run/chain 转换，返回 `suggest_only` 的 next 摘要；绝不执行建议。

显式 `run next` 负责创建下一条 chain-bound Run。

## 链编排动词

| 动词 | 语义 | 约束 |
|------|------|------|
| `session create --chain-file` | 预定义链建 Session | steps[] >= 1 |
| `session chain insert` | 在指定步骤后插 pending 步骤 | 不能插到 active position 之前 |
| `session chain skip / replace` | 跳过/原位改字段 | 仅 pending 步骤 |
| `run next [--pick]` | 步进：取队头 pending 步骤建 Run + 发 birth packet | single-running guard |
| `run complete --verdict` | 原子推进链步状态 | verdict 驱动 |
| `run decide <point-id>` | decision point 裁决落盘 + 推进 | 评估留在 prompt 层 |

## 入口治理

- **统一步进器 = CLI 动词**：`maestro run next` / `run complete --verdict` 是所有引擎共享的链步进器。
- **maestro**：ralph/coordinator 引擎的 FSM 驱动者（自动循环、verdict 推进）。
- **maestro-next**：默认交互入口（单步推荐 + 执行，No auto-orchestration）。
- **隔离保证**：ralph 按 `engine !== 'ralph'` 过滤不认领 manual session；lease 惰性（null 零验证）。
- **依赖方向**：ralph → run 单向，`src/run` 永不 import `src/ralph`。

---

## 协议版本演变

### Session 协议线

```
session/1.0 ──→ session/1.1 ──→ session/1.2 ──→ session/1.3
 (磁盘遗留)      (磁盘权威)       (内存迁移)       (内存上限/new-write)
```

#### session/1.0

最小可运行链 Session 骨架：

- `session_id`, `intent`, `status`（running/paused/sealed/archived/failed）
- `identity_revision`, `activity_revision`（乐观并发控制）
- `active_run_id`, `latest_completed_run_id`
- `boundary_contract`（Session 级约束）
- `orchestration`：`engine`, `quality_mode`, `auto_mode`, `chain[]`, `decision_points[]`
- `requests[]`（legacy 格式）
- `lifecycle`：`sealed_at`, `seal_summary`, `promoted_spec_ids`, `promoted_knowhow_ids`, `forked_from`
- `refs`：`gates.json`, `artifacts.json`, `evidence.json`

#### session/1.1

将 ralph-meta.json sidecar 收编进 Session 权威。orchestration 内新增（均 nullable default null）：

- `position`：当前链位置
- `decomposition`：任务分解结构
- `lease`：并发保护租约（owner/epoch/id 三元组）
- `executor`：执行器元数据

非 ralph session 零负担——字段为 null 时不参与任何逻辑。

#### session/1.2

意图复用精确匹配 + 创建溯源 + 权限标记：

- `intent_identity`（`intent-identity/1.0`）：NFKC + unicode-lower + whitespace-collapse 指纹
- `provenance`（`session-provenance`）：`source`, `forked_from`, `imported_from[]`, `created_by`
- `ralph_authority`（`ralph-authority/1.0`）：Ralph engine 权限标记
- `requests[]` 升级为 `persistedTransitionRecord ∪ legacySessionRequest` union

#### session/1.3

跨 Session 主题聚合：

- `topic_identity`（`topic-identity/1.0`）：session 级主题标识，支持 reuse-assessment 的 topic 维度

**迁移**：`normalizeSessionState()` 单向升级——1.0/1.1 补 null 默认值直升 1.3。

---

### Command Run 协议线

```
command-run/1.0 ──→ 1.1 ──→ 1.2 ──→ 1.3
  (legacy)        (磁盘权威)  (内存)   (内存上限/new-write)
```

#### command-run/1.0

最小 Run 记录：

- `run_id`, `command`（name/args）, `status`
- `input`（arguments/env/cwd）
- `output`（exit_code/stdout/stderr）
- `timestamps`（created_at/completed_at/sealed_at）

#### command-run/1.1

链步进绑定 + 多平台 + 断点续接：

- `chain_step_id`：绑定到链步骤
- `resolved_platform`：目标平台（claude/codex/gemini 等）
- `goal_binding`：目标关联
- `checkpoint_expectation`：断点预期
- `checkpoint`：断点状态
- `retry_fence`：重试围栏（防止无限重试）

#### command-run/1.2

执行契约快照 + 创建审计：

- `contract_snapshot`（`contract-snapshot/1.0`）：命令契约运行时快照（consumes/produces/gates）
- `guidance_snapshot`（`guidance-snapshot/1.0`）：命令源内容指纹
- `creation_decision`（`creation-decision/1.0`）：创建决策审计（reuse/fork/new）
- `creation_provenance`（`creation-provenance/1.0`）：创建来源溯源
- `transition`：转换指针

#### command-run/1.3

复用评估内嵌：

- `input.reuse_assessments[]`（`reuse-assessment/1.0`）：similarity advisory 评估记录

**迁移**：`normalizeCommandRun()` 链式升级 1.0→1.1（补 null）→1.2（补 provenance/snapshot）→1.3（补空 reuse_assessments）。

---

### Command Contract 协议线

```
command-contract/1.0 ──→ 2.0 ──→ 2.1
   (advisory)          (strict)  (incremental)
```

#### command-contract/1.0

- `consumes[]` / `produces[]` 的 `role`, `required`, `schema` 仅为 metadata
- 不参与 runtime 强制校验
- 缺少字段时发 warning 但不阻断

#### command-contract/2.0

- `contract_version: 2` 显式启用 strict 模式
- `role/required/schema` 成为 runtime 强制约束
- `gates.entry[]` / `gates.exit[]` 生效
- 缺少 required 输入时阻断执行

#### command-contract/2.1

- 在 2.0 基础上增量扩展（`commandContractV21Schema`）
- 向后兼容 2.0 命令定义

---

### Execution Contract 协议线

```
execution-contract/1.0 ──→ 1.1
```

- **1.0**：完整 `schema_version` + consumes/produces/gates 结构，用于独立文件。
- **1.1**：omit `schema_version` 后重新包装为 `execution-contract/1.1` literal，用于 brief 内嵌时的紧凑表示。

---

### 辅助协议（均为 1.0，随 session/1.2+ 引入）

| 协议 | 用途 |
|---|---|
| `intent-identity/1.0` | NFKC + unicode-lower + whitespace-collapse 意图指纹 |
| `topic-identity/1.0` | session 级主题标识 |
| `reuse-assessment/1.0` | similarity advisory 评估记录 |
| `reuse-source-fence/1.0` | 复用来源围栏 |
| `creation-decision/1.0` | Run 创建决策审计（reuse/fork/new） |
| `creation-provenance/1.0` | 创建来源溯源 |
| `contract-snapshot/1.0` | 命令契约运行时快照 |
| `guidance-snapshot/1.0` | 命令源内容指纹 |
| `transition-request/1.0` | resolve/resume 转换请求 |
| `transition-outcome/1.0` | 转换结果记录 |
| `ralph-authority/1.0` | Ralph engine 权限标记 |
| `run-response/1.0` | CLI all-exit JSON envelope |
| `command-rebind/1.1` | 命令源变更重绑定 |
| `session-transition/1.0` | session 级转换协议 |

---

## 版本管理策略

### 磁盘 vs 内存

| 维度 | 磁盘写入 | 内存读取上限 |
|---|---|---|
| Session | `session/1.1` | `session/1.3` |
| Command Run | `command-run/1.1` | `command-run/1.3` |

旧版本文件通过 `normalize*()` 无损升至最新内存态，磁盘保留原始版本直到下次写入触发升级。

### 设计原则

1. **单向升级、向后兼容读**：所有旧版本通过 `normalize*()` 无损升至最新内存态。
2. **nullable default null 零负担**：新增字段对非目标引擎无运行时开销。
3. **磁盘版本滞后于内存版本**：避免一次性强制迁移所有存量文件。
4. **Contract 从 advisory 到 strict 是 opt-in**：`contract_version: 2` 显式启用，v1 命令不受影响。
5. **单一写入路径**：所有 Session/Run 变更走 `SessionStore.update`（validation/backup/revision 一致）。

### 下次 Schema Bump 前置条件

将 1.2/1.3 提升为 new-write 默认需要统一 owner 分配以下字段：

- contract snapshot 内嵌策略
- intent identity 创建时写入时机
- creation decision 必填 vs 可选
- replay ID 分配
- Ralph authority 字段最终形态

---

## 产物边界

| 类别 | 路径 | 规则 |
|---|---|---|
| 正式产物 | `{run_dir}/outputs/` | 进 gate、进 artifact 注册 |
| 人读综合 | `{run_dir}/report.md` | 不进 gate |
| 非正式痕迹 | `{run_dir}/evidence/` | 懒建、不进 gate |
| 临时计算 | `{run_dir}/work/` | 永不索引 |

Session 权威目录：`.workflow/sessions/{session_id}/`，协议文件（session.json / run.json / artifacts.json）runtime-owned，禁止直接编辑。

## 注入架构

Birth packet 的 framed prompt block 分两族：

- **Core sections**（SessionState + per-step details 支撑）：Intent / Boundary Contract / Execution Progress / Accumulated Signals
- **Extension sections**（engine 专属）：ralph 引擎为 Scope / Goals Overview / Current Goal / Execution Criteria

Envelope 由 caller 排序（`buildEnvelope` 收预排序 section 列表），ralph anchor 保持 byte-for-byte 稳定。

## Lease 惰性验证

`lease 为 null 或 owner 为 null → 零验证`——未上锁的链 Session 任何调用方都能步进。上锁后 owner/epoch/id 三元组逐字段匹配，不匹配 exit 1。

## Similarity 与复用

- Similarity 永远是 advisory：embedding authoritative weight 为 0。
- Exact live resume 走 SessionStore + Unicode identity（独立路径）。
- Sealed history 只建议 fork/import，不自动选择或 mutation。
- `reuse-assessment/1.0` 记录评估过程，内嵌于 `command-run/1.3` 的 `input.reuse_assessments[]`。
