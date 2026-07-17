<!-- session-mode: none -->
# Maestro

- **Coding Philosophy**: @~/.maestro/workflows/coding-philosophy.md

## Delegate & CLI

- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

`maestro delegate "<PROMPT>" --to <tool> --mode analysis|write` — dispatch tasks to external CLI tools (gemini, codex, claude, opencode).
Always `run_in_background: true`. Full guide: `cat ~/.maestro/workflows/delegate-usage.md`

**Strictly follow the cli-tools.json configuration**

## Explore

Route code search by the Query Rules table (Knowledge System below) — it is the single source for tool selection. `maestro explore` is the default for usage sweeps and pattern scans: prefer it over Glob and broad Grep/Read, call it and stop to wait for results.

```bash
maestro explore "FIND: <target + condition>\nSCOPE: <paths>" [more prompts...] [options]
```

Lightweight read-only codebase search. 1 prompt = 1 agent. Not for write-mode/long sessions — use `delegate`.

| Option | Description |
|--------|-------------|
| `-e, --endpoint <names>` | Endpoint name(s), comma-separated |
| `--all` | Fan out each prompt to all endpoints |
| `--json` | Output results as JSON |

长尾选项（`--max-turns`、`-f`、`--cd`）见 `maestro explore --help`。

### Context Injection

Explore agent 无项目认知，调用前注入上下文：

| 注入项 | 写入字段 | 内容 |
|--------|----------|------|
| 结构 | SCOPE | 相关目录的具体路径（非通配泛扫） |
| 领域 | SCOPE | `maestro search` 已返回的关键文件路径 |
| 约束 | ATTENTION | 框架、语言、命名惯例 |

```
FIND: authentication middleware that validates JWT tokens
SCOPE: src/middleware/, src/auth/, src/api/routes/
ATTENTION: Express.js, middleware files named *.middleware.ts
```

### Prompt Structure

**FIND + SCOPE 为最低标准。** 每个字段一句陈述句，禁止嵌套条件。

| Field | Required | Rule |
|-------|----------|------|
| `FIND` | **Yes** | 可判定的具体目标（什么 + 判定条件） |
| `SCOPE` | **Yes** | 明确路径或 glob，禁止 `**/*` 泛扫 |
| `EXCLUDE` | No | 要跳过的文件类型或目录 |
| `ATTENTION` | No | 框架、命名惯例、已知陷阱 |
| `EXPECTED` | Recommended | 输出格式：`file:line` 列表 / 摘要 / JSON |

```
FIND: Functions that call db.query() with string concatenation instead of $1/$2
SCOPE: src/db/**/*.ts, src/api/**/*.ts
EXCLUDE: **/*.test.ts
EXPECTED: file:line list with the SQL string
```

### Cross-Search

对重要搜索，用 2-3 个不同角度的 prompt 并发，结果由主 agent 交叉验证。

**按角度拆分，不按关键词拆分：**

| 角度 | Prompt A | Prompt B |
|------|----------|----------|
| 定义 vs 调用 | 找函数定义 | 找调用点 |
| 正例 vs 反例 | 找正确用法 | 找遗漏用法 |
| 入口 vs 实现 | 找 export/路由 | 找内部逻辑 |
| 按文件类型 | .ts 中的用法 | .vue 中的用法 |

**结果置信度：**
- 双命中 → 高置信，直接使用
- 单命中 → 用 Grep/Read 二次确认
- 零命中 → 换角度重搜或目标不存在

### Execution

Multi-prompt — background；single lookup — foreground：

```
Bash({ command: "maestro explore \"p1\" \"p2\" --json", run_in_background: true })
Bash({ command: "maestro explore \"FIND: ...\nSCOPE: ...\"" })
```

Session: `maestro explore show` / `maestro explore output <id>`

## Agent 调用与超时

V2 agent 默认**异步执行**：`spawn_agent` / `followup_task` 触发后必须 `wait_agent` 阻塞取回结果，否则子 Agent 成为孤儿、final answer 丢失。标准调用序列：

```ts
spawn_agent({ task_name: "<slug>", message: "<完整任务 prompt>", fork_turns: "none" })
wait_agent({ timeout_ms: 3600000 })   // timed_out 且未完成 → 再次 wait_agent 续等
```

- **默认：除明确短任务外一律阻塞等待，用最长超时**。凡耗时不可预判（分析、审查、实现、探索、多轮子 Agent —— 即绝大多数场景），`spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）。不猜测短时长、绝不依赖 30000 默认值，避免 `timed_out` 提前返回后遗留运行中的 Agent。
- **续等而非丢弃**：`timed_out: true` 且 Agent 状态非 `completed`/`errored` → 再次 `wait_agent({ timeout_ms: 3600000 })` 续等；必要时 `list_agents` 确认状态。
- **例外：仅明确短任务**（耗时确定且短，如单点状态查询/回显）才可设较短 `timeout_ms`（最小 `10000`）。默认不走此路径。
- `wait_agent` 返回的 `message` 仅为 mailbox 更新摘要——final answer 以 `FINAL_ANSWER` 消息投递，不要把摘要当结果正文。
- `spawn_agents_on_csv`：`max_runtime_seconds`（单个 worker 最大运行时间，秒）**必须显式设为上限 `3600`**。

## Plan Tracking

- 任务/步骤进度用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护：整体提交步骤数组，status: `pending` | `in_progress` | `completed`。权威状态在 session 工件中。

## Goal 工具（与任务跟踪无关）

- 签名：`create_goal({ objective, token_budget? })`、`update_goal({ status: "complete" | "blocked" })`、`get_goal({})`。
- **仅在用户明确要求创建 Goal 时使用**：单一活跃 goal，不得从普通任务自行推断创建；完成后向用户报告最终 token 用量。

## Knowledge System

**Gate rule**: run `maestro search` + `maestro load` BEFORE reading code or editing files. 空结果 ≠ 免检：返回 hint 时先执行 hint 再重试；确认无既有知识后照常推进，任务结束按 Record 补录。

**Re-search triggers**（任务中重新检索，换关键词不重复旧 query）：进入新模块/子系统边界；同一问题修复失败 2 次；架构/方案决策前。

```bash
maestro search "<query>" [--type <type>] [--category <cat>] [--kind <kind>] [--code] [--kg]
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--id <id>]
```

**--type**: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`
**--category** (spec only): `coding`, `arch`, `debug`, `test`, `review`, `learning`, `ui`
**--kind**: sealed run 产物 kind 过滤（如 `diagnosis`, `review-findings`, `lessons`），仅 wiki 结果

### Query Rules

1-3 core keywords per query — multiple short queries beat one long one.
Separate concepts from symbols. Add `--kg` for full-source.

| Target | Tool |
|--------|------|
| Known symbol → definition/signature | `maestro search "<Symbol>" --code` (file:line, no agent cost) |
| Concept / knowledge / conventions | `maestro search "<keywords>"` |
| Debug 症状 / review 教训（沉淀产物） | `maestro search "<关键词>" --kind diagnosis` / `--kind lessons` |
| Usage sweep / pattern scan | `maestro explore` |
| Exact regex / line content | Grep |

**Association follow-through** — 命中后沿关联走一跳，优于重发大 query：

- 命中分块条目（id 带 `-NNN` 尾缀）→ `maestro load --type knowhow --id <父条目id>` 取全文
- 顺藤摸瓜（谁引用它 / 它引用谁）→ `maestro wiki backlinks <id>` / `maestro wiki forward <id>`
- 规则演化脉络 → `maestro spec history <sid>`

Zero code hits with a hint (e.g. `code index not initialized`) → run the hinted command, then retry — don't abandon code search.

```bash
# ❌ keyword dump
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ targeted
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro load --type spec --category coding
```

### Record

| What | Command |
|------|---------|
| Spec | `/spec add <category> "title" "content" --keywords kw1,kw2 --description "summary"` |
| Knowhow | `/manage knowledge capture` (`--spec-category <cat>` for agent injection) |

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, tests→`test`.
入口分工：skill 命令走引导式工作流；`maestro spec add` CLI 直写（supersede 流程用 `--json` 拿 sid）。
`session-mode: run` 命令在 `maestro run check` 全绿时会收到 finish 收口清单（handoff、补录、冲突标注、verdict）——逐项执行，不跳过。

### Supersession & Conflict (dual-track)

| 关系 | 场景 | 命令 | 效果 |
|------|------|------|------|
| **supersede** | 新规则替代旧规则 | `maestro spec supersede <old-sid> --by <new-sid>` | 旧条目 `deprecated`，演化链保留 |
| **conflict** | 两条规则均有道理 | `maestro spec conflict mark <file> <line> --note "<reason>"` | 旧条目 `contested`（search ×0.5），人裁决 |

Confidence levels: `high` → `medium` (default) → `low` (`[LOW CONFIDENCE]`) → `contested` (`[CONTESTED]`).
Resolution: `/manage knowledge audit`

### Health & Maintenance

`maestro spec health` — 生命周期统计 + 演化链完整性。低频维护（`backfill-sid` 回填 sid、`history <sid>` 演化链）见 `maestro spec --help`。
