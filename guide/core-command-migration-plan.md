---
title: "核心命令迁移行动规划 — Session/Run 模型"
---

> **状态（2026-07-15）**：迁移已落地，本文转为历史规划参考。contract 以实现为准——各命令的 consumes/produces/gates 权威定义在 `prepare/*.md`（gates 为 `contract.gates.exit` 字符串列表；entry 门不显式声明，隐式派生自 required consumes）。本文 §五 的 `gates:` 字段已同步为实现名；aliases/kinds 若与 prepare 文件不一致，以 prepare 为准。现行架构见 `guide/session-run-architecture.md`。
>
> 配套 `session-run-structure-guide.md`（目标文件体系定义）。本文只规划**核心命令 `.md` 的改造动作**，不重复结构定义；schema/命名/aref 语法一律引用结构指南。
> **核心命令** = `maestro-analyze` · `maestro-plan` · `maestro-execute` · **verify**（垂直切片）+ `quality-review` · `quality-test` · `quality-debug`（质量核心）。上游命令（grill/brainstorm/blueprint/roadmap）沿用同骨架，列为 Phase 3。

---

## 一、改造不变量（每个命令都遵守）

1. **只动 I/O 边界，不改内部控制流**——命令原有的 FSM / Pipeline 撰写风格保留，改造只替换"起手 / 验证 / 收尾"三处外壳。
2. **三段式 CLI**：`maestro run create` → 领域工作（读 upstream / 直写 `outputs/` / 写 `report.md` frontmatter）→ `maestro run check`（可多次，幂等）→ `maestro run complete`。LLM 不接触任何协议 JSON。
3. **contract CLI 内部消费**：命令 `.md` 保留 `contract:` 块（人读 + CLI 解析用），但运行时 **LLM 不经手**——consumes/gates 由 CLI 在 `run create` 时解析和注册，`run check` 时按 `_meta` 自发现求值门禁，LLM 只拿 `create` 返回的 `{session_id, run_id, run_dir, upstream}`。
4. **run_id ≠ session_id**：`run create` 返回二者——`session_id` 标识本次会话（`{date}-{slug}`），`run_id` 标识本次调用（`{date}-{NNN}-{cmd}`）。`check`/`complete` 传 `run_id`；跨命令关联用 `session_id`。
5. **上游经 alias 消费**：`create` 返回 `upstream: { alias → path }`，LLM 读 path 拿 typed json。**不扫 `scratch/`、不读 `mtime latest`、不查 `state.json.artifacts[]`**。
6. **产物直写 + 自描述**：LLM 直写 typed json（含 `_meta` 字段）→ `outputs/*.json`；交付物 md（含 frontmatter `kind`）→ `outputs/{kind}.md`。`run check`/`complete` 时 CLI 读 `_meta` 自发现——LLM 不声明 produces、不学注册 schema（结构指南 §7.1b）。
7. **交接经 frontmatter**：取代 `context.md` / `context-package.json` / 自然语言 Next Step。LLM 只写 `report.md` frontmatter；`run complete` 从中派生 `handoff` + `evidence`。
8. **门禁不可见**：Entry 门在 `create` 内部求值，Exit 门在 `check` 时求值（幂等，LLM 可反复调用看差距），最终在 `complete` 时硬拦截。**LLM 不读 gate 清单、不判断是否继续**——只有 blocking 失败才吐一行"缺 X，先跑 Y"。
9. **收尾回读**：结束后从磁盘重读，输出统一摘要。
10. **L0 Shim 双向垫片过渡**：对于尚未完全迁移的命令，CLI 必须提供一层**双向垫片**：除了将旧版 `state.json.artifacts[]` 包装为伪 `upstream` 供新命令消费外，还必须在 `run complete` 封单时，将新命令的 outputs 同步回写一份至 `state.json.artifacts[]`，确保落后于迁移进度的下游命令不会发生崩溃断链。
11. **标准 report.md Frontmatter 模板与 Lint**：在 `guide/` 中定义标准的 `report.md` Frontmatter JSON-Schema，每个命令的交付物 Markdown header 格式应由 Lint 门硬性拦截。
12. **PreToolUse 路径守卫**：在 Run 处于 active 时，通过路径守卫确保大模型只能写入当前 `run_dir` 的 `outputs/` 目录以及本 Run 对应的 `report.md`，严禁越界写入源码文件。**特例：** `quality-debug` 时常常需要跨文件插入临时探测点（如 `console.log`），守卫需提供 `escalate_privileges` 越权修补机制挂钩供 Debug 阶段使用。

---

## 二、Phase 0 · 前置依赖（命令改造前必须就位）

命令 `.md` 是 LLM prompt，无法内联调用代码——三段式外壳全靠下列 CLI/Runtime。**这些不就位，改了命令也跑不起来**：

| 能力 | CLI | 职责 | LLM 可见? |
|------|-----|------|:--:|
| 创建 | `maestro run create <cmd> [--session]` | 读 skill(.md) → 解析 Session（或自动创建）→ 分配 run 目录 → 读 contract → 注册 gate → 求值 Entry 门 → 返回 `{session_id, run_id, run_dir, upstream}` | 只拿返回值 |
| 检查 | `maestro run check <run>` | 扫描 `outputs/` → 读 `_meta`/frontmatter 自发现产物 → 求值 Exit 门 → 返回 gate 状态 + 缺失清单。**幂等**，LLM 可反复调用看差距 | 只拿 gate 摘要 |
| 完成 | `maestro run complete <run>` | 扫描 outputs/ → 派生 artifacts.json → 读 report.md frontmatter → 派生 handoff+evidence → 跑最终 Exit 门（hard fail）→ seal → 更新 alias | 只传 run_id |
| 写入 | SessionStore | session/gates/artifacts/evidence 唯一写入口，`create/check/complete` 内调 | 否 |
| 渲染 | aref 渲染（`complete` 内调） | 解析 aref → 渲染 report.md | 否 |
| 拦截 | PreToolUse 路径守卫 | 阻止写其他 Run / 越界写源码 | 越界时抛错 |

> Phase 0 不改任何命令；产出是可被 prompt 调用的 CLI 契约。**出口标准**：`run create → (空领域工作) → run check → run complete` 能对一个"空命令"跑通并生成合法的 Session/Run 骨架，LLM 全程零协议 JSON 接触。

---

## 三、命令 `.md` 改造骨架（before → after）

所有 session-run 命令套用同一 diff，差异只在"领域工作"段：

**改造前（当前，逐命令）**
```text
1. 解析上游：--from / mtime / state.json.artifacts[]
2. mkdir scratch/{date}-{type}-P{N}-{slug}/
3. 领域工作 → Write discussion.md / xxx.json 到 scratch 目录
4. 写 context.md + context-package.json（handoff）
5. 更新 state.json.artifacts[]（手工注册）
6. 输出自然语言 Next Step
```

**改造后（目标）**
```text
1. maestro run create <command> [--session <id>]      # 返回 {session_id, run_id, run_dir, upstream}
                                                      # CLI 内部：读 skill、解析 Session、分配 Run、
                                                      # 注册 Gate、求值 Entry 门
2. 领域工作（保留原 FSM/Pipeline 风格）：             # ← 唯一 LLM 特定段
     · 读上游：upstream[alias].path → Read
     · 写 typed json → outputs/*.json（含 _meta）
     · 写交付物 md → outputs/{kind}.md（含 frontmatter kind）
     · 写 report.md（含 frontmatter）
     · [可选] maestro run check <run>                 # 幂等，看 Exit 门还差什么

3. maestro run complete <run>                         # 只传 run_id
                                                      # CLI 内部：扫描 outputs/ → 读 _meta 派生 artifacts、
                                                      # 读 frontmatter → handoff+evidence、
                                                      # 最终 Exit 门 → seal → 更新 alias
```

> LLM 全程不接触 `run.json` / `gates.json` / `artifacts.json` / `contract`——这些是 CLI 内部机制，从命令 `.md` 的 `contract:` 块解析。`contract:` 块仍保留在 `.md`（人读 + CLI 消费，保持 Self-Containment），但运行时 LLM 不经手。

`maestro run create` 返回结构（LLM 唯一需要理解的类型）：

```ts
interface RunStartResult {
  run_dir: string;                         // "sessions/{id}/runs/{date}-{NNN}-{cmd}/"
  upstream: Record<string, {               // alias → resolved artifact
    artifact_id: string;
    path: string;                          // 相对 .workflow/，直接 Read
    kind: string;                          // findings / plan / execution…
    status: 'sealed' | 'draft';            // 正常只给 sealed；draft + warn 是降级
  }>;
}
```

---

## 四、分阶段顺序

| Phase | 范围 | 出口标准 |
|-------|------|---------|
| **0 前置** | CLI/Runtime（§二） | 空命令跑通 create→check→complete |
| **1 垂直切片** | analyze → plan → execute → **verify** + post-verify 决策点 | 同一 intent 经 `/maestro-ralph` 与手工逐命令执行，产出 Session 数据**逐字段一致**（engine 除外）→ **冻结 schema v1.0** |
| **2 质量核心** | review · test · debug | 三命令产出 typed artifact，Ralph review→debug→fix 循环走 decision-authorized 授权 |
| **3 上游** | grill · brainstorm · blueprint · roadmap | 沿用骨架；roadmap 转 session 划分器写 `state.json.sessions[]` |
| **4 收口** | milestone-* 下线 · Ralph orchestration 并入 `session.json` | 无第二权威 `status.json`；`milestones/`/`phases/` 物理目录删除 |

> **schema 在第一个真实消费者出现前都是假设**——Phase 1 用 pilot 真实使用修订 schema 后再冻结，才铺开 Phase 2+。

---

## 五、逐命令改造清单（Phase 1–2）

每节：现状（grounded）→ contract（**CLI 内部解析**，LLM 不经手）→ 产物迁移 → 关键改造点。

### 5.1 `maestro-analyze`

- **现状**：写 `scratch/*-analyze-*/`；产 `discussion.md` + `analysis.md` + `conclusions.json` + `context.md`(×7 引用)；手工注册 ANL artifact。

```yaml
contract:
  consumes: [{ kind: context-package, alias: initial-context, required: false }]
  produces:
    - { kind: findings,   primary: true, path: outputs/findings.json, alias: current-analysis }
    - { kind: risk-matrix,               path: outputs/risk-matrix.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [exploration-done, discussion-round, scoring-complete, intent-covered]
```

- **产物迁移**：`explorations + perspectives + conclusions.json` → 合并为 `findings.json`；`discussion.md`/`analysis.md` → `report.md §讨论`；删 `context.md`/`context-package.json`。
- **改造点**：scope verdict / Go-NoGo / confidence → `run.json.output`；Locked/Free/Deferred 判断 → `evidence.json`（`kind:decision, point:scope-verdict`）。
- **Swarm 优化建议**：
  * **决策映射规范化**：原 context.md 中的决策必须通过 `report.md` 中的规范 Frontmatter 或标注自动提取并记录于 `evidence.json`。
  * **自动建单闭环**：Deferred（延期）决策由 `maestro run complete` 扫描 `findings.json`，并在此阶段自动写入全局 `issues.jsonl`，不再让大模型在运行期手动改写 issue 列表。

### 5.2 `maestro-plan`

- **现状**：写 `scratch/*-plan-*/plan.json` + `.task/TASK-*.json`；产 `context-package.json`；手工注册 PLN artifact；含 3× verify 引用。

```yaml
contract:
  consumes: [{ kind: findings, alias: current-analysis, required: true }]
  produces:
    - { kind: plan,            primary: true, path: outputs/plan.json, alias: current-plan }
    - { kind: task-collection,                path: outputs/tasks/ }
    - { kind: waves,                          path: outputs/waves.json }
    - { kind: dependency-graph,               path: outputs/dependency-graph.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [context-collected, plan-generated, plan-checked, plan-confirmed]
```

- **产物迁移**：`.task/TASK-*.json` → `outputs/tasks/TASK-*.json`（不再隐藏目录）；`plan-check` → `outputs/plan-check.json`；删 Session 级 `tasks.json` 设想。
- **改造点**：Registry 登记一个 `kind:task-collection` artifact 指向 `outputs/tasks/`，`plan.json#task_ids` 为 primary index；Execute 经 `current-plan` 解析 task collection ref。
- **Swarm 优化建议**：
  * **任务打包与别名消费**：`plan.json#task_ids` 需作为 Primary Index，以便 execute 命令只通过 `current-plan` 别名解析对应任务文件，避免对 `outputs/tasks/` 目录进行多余的文件遍历。
  * **2+1 合并清理**：多 Agent planner 模式合成后，必须在 `run complete` 阶段将临时、未最终采纳的碎 TASK JSON 进行自动清理，保证 outputs 清洁度。

### 5.3 `maestro-execute`

- **现状**：读 `.task/`；写 `.summaries/TASK-*-summary.md`；含 2× Verify 步骤（E2.7）；手工注册 EXC artifact。

```yaml
contract:
  consumes: [{ kind: execution-plan, alias: current-plan, require_status: sealed, required: true }]
  produces:
    - { kind: execution,       primary: true, path: outputs/execution.json, alias: latest-execution }
    - { kind: task-results,                   path: outputs/task-results.json }
    - { kind: self-check,                     path: outputs/self-check.json }
    - { kind: change-manifest,                path: outputs/change-manifest.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [execution-complete, self-check-passed]
```

- **产物迁移**：`.summaries/` → `outputs/task-results.json`；**`verification.json` → `self-check.json`（更名，仅 build/test/static 冒烟）**；`reflection.md` → `report.md §复盘`。
- **改造点**：**拆出 verify**——原 E2.7 goal-backward 校验移到独立 verify Run（§5.4）；Execute 只保留 self-check；源码只登记 Git ref / diff ref，不进 outputs/。
- **Swarm 优化建议**：
  * **源码物理防复制**：在 `change-manifest.json` 中仅保留 Git Ref 或 Git Diff 引用（例如 hash 或 diff patch），强制 PreToolUse 守卫拦截任何向 outputs 目录下拷贝物理源码的行为，防范空间膨胀。

### 5.4 `verify`（Phase 1 新建独立命令）

- **现状**：不存在独立命令，逻辑内嵌在 execute E2.7 / plan 引用。**动作：新建 `maestro-verify.md`**。

```yaml
contract:
  consumes:
    - { kind: plan,      alias: current-plan,     required: true }
    - { kind: execution, alias: latest-execution, required: true }
  produces:
    - { kind: verification,         primary: true, path: outputs/verification.json, alias: latest-verification }
    - { kind: requirement-coverage,                path: outputs/requirement-coverage.json }
    - { kind: antipattern-report,                  path: outputs/antipattern-report.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [goal-backward-verified, nyquist-covered]
```

- **改造点**：`verification.json` verdict = `passed|passed_with_concerns|failed`；`latest-verification` alias 指本 Run primary；**post-verify 决策点**消费它（结构指南 §5.2 orchestration）——Ralph 据此决定放行 / 插 debug→fix 环。
- **Swarm 优化建议**：
  * **失败报告强制化**：当 `verification.json` 的 verdict 判定为 `failed` 时，必须强制输出规范的 `antipattern-report.json`，详述反模式特征，以便 Ralph 直接根据它触发修复循环。

### 5.5 `quality-review`

- **现状**：写 `scratch/*-review-*/`；引 `verification.json` / `uat.md`；手工写 `artifacts[]`。

```yaml
contract:
  consumes: [{ kind: change-manifest, alias: latest-execution, required: true }]
  produces:
    - { kind: review-findings, primary: true, path: outputs/findings.json, alias: latest-review }
    - { kind: spec-conflicts,                 path: outputs/spec-conflicts.json }
    - { kind: issue-candidates,               path: outputs/issue-candidates.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [dimension-coverage, severity-triaged]
```

- **产物迁移**：`review.json` → `findings.json`；质量判断 → `evidence.json`；Gate → `gates.json`（不生成 Run 级 `quality-gates.json`）。
- **改造点**：Artifact 注册从"可选"改为 **mandatory**；`spec-conflicts` 只标 `supersede|conflict|code-defect`，不改 Spec。
- **Swarm 优化建议**：
  * **知识库联动逻辑**：`spec-conflicts.json` 应包含标准的修正动作指令包（如自动生成 spec-supersede 指令参数）。在 `complete` 阶段，由 CLI 读取该指令并提示用户或自动更新对应的知识库 spec。

### 5.6 `quality-test`

- **现状**：写 `scratch/*-test-*/`；产 `uat.md`(×4) + `test-results.json`；引 `verification.json`。

```yaml
contract:
  consumes: [{ kind: change-manifest, alias: latest-execution, required: true }]
  produces:
    - { kind: test-results, primary: true, path: outputs/test-results.json, alias: latest-test }
    - { kind: acceptance,                  path: outputs/acceptance.json }
    - { kind: coverage,                    path: outputs/coverage.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [coverage-met, pass-rate-met]
```

- **产物迁移**：**`uat.md` → `acceptance.json`（机器真相源）**；`test-results.json` 按 scenario ID 组织；补 `e2e-results.json`（如适用）。
- **Swarm 优化建议**：
  * **E2E 证据闭环**：在 `--frontend-verify` 模式下，Chrome DevTools 捕获的 Snapshot、网络请求和 DOM 校验结果等，必须规范挂载于 `e2e-results.json` 中的具体 check 条目上，提供明确的证据链。

### 5.7 `quality-debug`

- **现状**：写 `scratch/*-debug-*/`；产 `understanding.md` + `evidence.ndjson`；手工写 `artifacts[]`。

```yaml
contract:
  consumes: [{ kind: verification, alias: latest-verification, required: true }]   # 失败信号来源
  produces:
    - { kind: diagnosis,      primary: true, path: outputs/diagnosis.json, alias: latest-debug }
    - { kind: hypotheses,                    path: outputs/hypotheses.json }
    - { kind: reproduction,                  path: outputs/reproduction.json }
    - { kind: fix-directions,                path: outputs/fix-directions.json }
  gates:
    # entry 门隐式派生自 consumes(required)；retry 前传约束见 prepare/debug.md
    exit: [hypothesis-tested, evidence-grounded]
```

- **产物迁移**：`understanding.md` → `report.md §理解`；`evidence.ndjson` → `evidence/` + 结论入 `evidence.json`；`diagnosis.json` 分 `confirmed/suspected/rejected`。
- **改造点**：**retry 强制前传**——插环时上轮 `diagnosis.json`(rejected 假设) + 失败 gate evidence_refs 写入本 Run `consumes`；Entry 门 `prior-attempt-loaded`(blocking)：无前次上下文的重试不许启动（结构指南 §33.4）。
- **Swarm 优化建议**：
  * **前传门禁硬化与死锁阻断**：若任务为 retry，Entry Gate 必须检测上一次调试上下文。为防止前次 Run 崩溃（如大模型 Token 耗尽未能生成 `diagnosis.json`）导致死锁，`prior-attempt-loaded` 需支持优雅降级——若 `diagnosis.json` 不存在，允许回退拉取原始错误栈启动本轮 Run。

---

## 5B. 逐命令改造清单 (Phase 3 上游命令)

上游链条命令承接早期创意到规格制定、路线图规划，主要产出文档。改造核心在于使用三段式骨架约束其文档产出路径，实现术语及规格包的链条式消费。

### 5.8 `maestro-grill` (压力测试)

- **现状**：生成 `grill-report.md`、`terminology.md`、`context-package.json` 至 scratch 目录。

```yaml
contract:
  consumes: []
  produces:
    - { kind: grill-report,    primary: true, path: outputs/grill-report.md }
    - { kind: terminology,                    path: outputs/terminology.json, alias: current-terminology }
    - { kind: context-package,                path: outputs/context-package.json, alias: initial-context }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [terminology-aligned, branches-walked]
```

- **产物迁移**：直写 outputs/；将 `terminology.md` 改写为类型定义的 `outputs/terminology.json`；`grill-report.md` 带 YAML frontmatter kind = "grill-report"。
- **Swarm 建议**：
  * **术语链条消费**：Socratic 压力测试产生的术语表 `terminology.json` 必须作为 `current-terminology` 别名向下游传递，蓝图命令的 `glossary.json` 需强制引入此别名并做术语一致性校验。

### 5.9 `maestro-brainstorm` (头脑风暴)

- **现状**：生成多角色讨论及合并报告至 scratch。

```yaml
contract:
  consumes: [{ kind: terminology, alias: current-terminology, required: false }]
  produces:
    - { kind: brainstorm-report, primary: true, path: outputs/brainstorm-report.md }
    - { kind: decisions,                         path: outputs/decisions.json, alias: brainstorm-decisions }
    - { kind: brainstorm-roles,                  path: outputs/roles/ }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [guidance-generated, roles-converged]
```

- **产物迁移**：直写 outputs/；多角色的细分讨论移入 `outputs/roles/` 目录；`decisions.json` 存放脑暴敲定的方向。
- **Swarm 建议**：
  * **角色子文件自描述**：角色目录 `outputs/roles/` 注册为 `kind: brainstorm-roles`，通过完整封单 CLI 将其哈希归档。

### 5.10 `maestro-blueprint` (蓝图设计)

- **现状**：在子目录生成产品 briefs、epics、ADRs 及 readiness-report.md。

```yaml
contract:
  consumes: 
    - { kind: decisions, alias: brainstorm-decisions, required: false }
    - { kind: terminology, alias: current-terminology, required: true }
  produces:
    - { kind: product-brief,     primary: true, path: outputs/product-brief.md, alias: current-blueprint }
    - { kind: requirements-pack,                path: outputs/requirements/ }
    - { kind: architecture-pack,                path: outputs/architecture/ }
    - { kind: epics-pack,                       path: outputs/epics/ }
    - { kind: readiness-report,                 path: outputs/readiness-report.json }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [phases-complete, readiness-passed]
```

- **产物迁移**：所有子目录包全部输出到 `outputs/` 下，readiness-report 转为 `outputs/readiness-report.json`。
- **Swarm 建议**：
  * **目录级哈希校验**：针对大量的 REQ/ADR/EPIC 碎文件，由 CLI 在 Check 阶段对其进行目录级别的打包哈希和元数据汇总，防止 state.json 的 artifact 列表发生记录爆炸。

### 5.11 `maestro-roadmap` (路线图规划)

- **现状**：生成 `roadmap.md`，并在执行中直接改写 `state.json` 的 milestones 字段。

```yaml
contract:
  consumes: [{ kind: product-brief, alias: current-blueprint, required: true }]
  produces:
    - { kind: roadmap,        primary: true, path: outputs/roadmap.md }
    - { kind: milestones-pack,               path: outputs/milestones.json, alias: current-roadmap }
  gates:
    # entry 门隐式派生自 consumes(required)
    exit: [dag-valid, sessions-registered]
```

- **产物迁移**：不直接修改全局 `state.json`；直写 `outputs/roadmap.md` 及包含全部阶段定义的 `outputs/milestones.json`。
- **Swarm 建议**：
  * **原子封锁防写冲突**：Roadmap 绝不能在领域工作期直接改写 `state.json` 或 `session.json`。它的 complete 门禁会读取 `outputs/milestones.json`，通过 CLI 以事务性原子写操作同步进 session 整体里程碑中，消除双权威冲突。（*必须在 SessionStore 中加入事务回滚机制，若里程碑合入发生多点并发冲突，终止合入并回滚 session 状态以保护 DAG。*）

---

## 六、验收与 cutover

- **Phase 1 验收（硬指标）**：同一 intent 分别经 `/maestro-ralph` 与手工逐命令执行 → `session.json` / `gates.json` / `artifacts.json` / `evidence.json` 逐字段一致（`orchestration.engine` 除外）。不一致即 schema 未收敛，不得进 Phase 2。
- **产物验收（每命令）**：primary artifact sealed；`run.json.handoff` 生成；`report.md` 无裸拷贝 json 数值（aref 校验）；下游经 alias 拿到 typed json 零目录扫描。
- **cutover 原则**：新旧**不并存**——一个命令切到 run-model 后即停止写 `scratch/` 与 `state.json.artifacts[]`；未切的命令保持原样。*注意：L0 垫片必须是双向的 (Dual-write)，确保新迁移的命令产生的 outputs 能够经 CLI 同步回写一份至旧有 `state.json.artifacts[]` 供未迁移的落后命令消费。*
- **回滚**：Run 目录与 Session JSON 是新增路径，回滚 = 命令 `.md` 恢复旧 I/O 段；`sessions/` 数据保留不影响旧 `scratch/` 流程。

---

## 七、任务分解（可勾选）

| # | 任务 | Phase | 依赖 |
|---|------|-------|------|
| T0 | `run create` + `run check` + `run complete` CLI（含双向垫片、SessionStore 批量事务与回滚、`_meta` 自发现、frontmatter→handoff、aref 渲染） | 0 | — |
| T1 | PreToolUse 路径守卫 (含提权降级 `escalate_privileges` 越权修补机制) | 0 | — |
| T2 | 改 `maestro-analyze`（§5.1） | 1 | T0–T1 |
| T3 | 改 `maestro-plan`（§5.2） | 1 | T2 |
| T4 | 改 `maestro-execute`（§5.3，拆 verify） | 1 | T3 |
| T5 | 新建 `maestro-verify`（§5.4）+ post-verify 决策点 | 1 | T4 |
| T6 | pilot 验收 + **冻结 schema v1.0** | 1 | T2–T5 |
| T7 | 改 `quality-review / test / debug`（§5.5–5.7） | 2 | T6 |
| T8 | 改 grill / brainstorm / blueprint / roadmap | 3 | T6 |
| T9 | milestone-* 下线 + Ralph orchestration 并入 session.json | 4 | T7 |

---

> **来源**：改造动作依据 `session-run-structure-guide.md`（§七 Run 外壳 / §八 产物映射 / §31 SessionResolver / §33 成本机制）与 `session-hook-orchestration-FINAL.md`（§12 实施顺序 / §20 命令产物 / §29 门禁注册表）。命令内部 FSM/Pipeline 风格判断见 knowhow《命令撰写风格：状态机 vs Pipeline》。
