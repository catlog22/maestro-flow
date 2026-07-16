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

## Agent Timeout Constraints

- `spawn_agents_on_csv`：`max_runtime_seconds`（单个 worker 最大运行时间，秒）**必须显式设为上限 `3600`**。
- `wait_agent`：`timeout_ms` 默认仅 30000 — **每次调用显式设置，最少 `180000`（3 分钟）**；长任务用上限 `3600000`。

## Plan Tracking

- 任务/步骤进度用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护：整体提交步骤数组，status: `pending` | `in_progress` | `completed`。权威状态在 session 工件中。

## Goal 工具（与任务跟踪无关）

- 签名：`create_goal({ objective, token_budget? })`、`update_goal({ status: "complete" | "blocked" })`、`get_goal({})`。
- **仅在用户明确要求创建 Goal 时使用**：单一活跃 goal，不得从普通任务自行推断创建；完成后向用户报告最终 token 用量。

## Knowledge System

**Gate rule**: run `maestro search` + `maestro load` BEFORE reading code or editing files. 空结果 ≠ 免检：返回 hint 时先执行 hint 再重试；确认无既有知识后照常推进，任务结束按 Record 补录。

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
| Usage sweep / pattern scan | `maestro explore` |
| Exact regex / line content | Grep |

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

### Supersession & Conflict (dual-track)

| 关系 | 场景 | 命令 | 效果 |
|------|------|------|------|
| **supersede** | 新规则替代旧规则 | `maestro spec supersede <old-sid> --by <new-sid>` | 旧条目 `deprecated`，演化链保留 |
| **conflict** | 两条规则均有道理 | `maestro spec conflict mark <file> <line> --note "<reason>"` | 旧条目 `contested`（search ×0.5），人裁决 |

Confidence levels: `high` → `medium` (default) → `low` (`[LOW CONFIDENCE]`) → `contested` (`[CONTESTED]`).
Resolution: `/manage knowledge audit`

### Health & Maintenance

`maestro spec health` — 生命周期统计 + 演化链完整性。低频维护（`backfill-sid` 回填 sid、`history <sid>` 演化链）见 `maestro spec --help`。
