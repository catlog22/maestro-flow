<!-- session-mode: none -->
# Maestro

<!-- session-mode: none -->
# Coding Philosophy

## Core Beliefs

- **Pursue good taste** - Eliminate edge cases to make code logic natural and elegant
- **Embrace extreme simplicity** - Complexity is the root of all evil
- **Be pragmatic** - Code must solve real-world problems, not hypothetical ones
- **Data structures first** - Bad programmers worry about code; good programmers worry about data structures
- **Never break backward compatibility** - Existing functionality is sacred and inviolable
- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Clear intent over clever code** - Be boring and obvious
- **Follow existing code style** - Match import patterns, naming conventions, and formatting of existing codebase
- **Minimize changes** - Only modify what's directly required; avoid refactoring, adding features, or "improving" code beyond the request
- **No unsolicited documentation** - NEVER generate reports, documentation files, or summaries without explicit user request. When the active command requires a report, write it only to the current Run's `report.md` or declared typed output.

## Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks - choose the boring solution
- If you need to explain it, it's too complex

## Fix, Don't Hide

**Solve problems, don't silence symptoms** - Skipped tests, `@ts-ignore`, empty catch, `as any`, excessive timeouts = hiding bugs, not fixing them

**NEVER**:
- Make assumptions - verify with existing code
- Generate reports, summaries, or documentation files without explicit user request
- Use suppression mechanisms (`skip`, `ignore`, `disable`) without fixing root cause

**ALWAYS**:
- Plan complex tasks thoroughly before implementation
- Generate task decomposition for multi-module work (>3 modules or >5 subtasks)
- Track progress using TODO checklists for complex tasks
- Validate planning documents before starting development
- Commit working code incrementally
- Update plan documentation and progress tracking as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess
- **Edit fallback**: When Edit tool fails 2+ times on same file, try Bash sed/awk first, then Write to recreate if still failing

## Learning the Codebase

- Find 3 similar features/components
- Identify common patterns and conventions
- Use same libraries/utilities when possible
- Follow existing test patterns

## Tooling

- Use project's existing build system
- Use project's test framework
- Use project's formatter/linter settings
- Don't introduce new tools without strong justification

## Content Uniqueness Rules

- **Each layer owns its abstraction level** - no content sharing between layers
- **Reference, don't duplicate** - point to other layers, never copy content
- **Maintain perspective** - each layer sees the system at its appropriate scale
- **Avoid implementation creep** - higher layers stay architectural

# Context Requirements

Before implementation, always:
- Identify 3+ existing similar patterns
- Map dependencies and integration points
- Understand testing framework and coding conventions


## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

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

对重要搜索，用 2-3 个不同角度的 prompt 并发，结果由 Claude 交叉验证。

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

## Knowledge System

**Gate rule**: run `maestro search` + `maestro load` BEFORE reading code or editing files. 空结果 ≠ 免检：返回 hint 时先执行 hint 再重试；确认无既有知识后照常推进，任务结束按 Record 补录。

**Re-search triggers**（任务中重新检索，换关键词不重复旧 query）：进入新模块/子系统边界；同一问题修复失败 2 次；架构/方案决策前。

```bash
maestro search "<query>" [--type <type>] [--category <cat>] [--tag <tag>] [--keyword <word>] [--code] [--kg]
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--tag <tag>] [--id <id>]
```

**--type**: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`
**--category** (spec only): `coding`, `arch`, `debug`, `test`, `review`, `learning`, `ui`
**--tag**: 按标签精确过滤（如 `diagnosis`, `review-findings`, `lessons`），仅 wiki 结果
**--keyword**: 按 title/body 关键词模糊过滤，仅 wiki 结果

### Query Rules

1-3 core keywords per query — multiple short queries beat one long one.
Separate concepts from symbols. Add `--kg` for full-source.

| Target | Tool |
|--------|------|
| Known symbol → definition/signature | `maestro search "<Symbol>" --code` (file:line, no agent cost) |
| Concept / knowledge / conventions | `maestro search "<keywords>"` |
| Debug 症状 / review 教训（沉淀产物） | `maestro search "<关键词>" --tag diagnosis` / `--tag lessons` |
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
| Spec | `/maestro-spec add <category> "title" "content" --keywords kw1,kw2 --description "summary"` |
| Knowhow | `/maestro-manage knowledge capture` (`--spec-category <cat>` for agent injection) |

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, tests→`test`.
入口分工：slash 命令走引导式工作流；`maestro spec add` CLI 直写（supersede 流程用 `--json` 拿 sid）。
`session-mode: run` 命令在 `maestro run check` 全绿时会收到 finish 收口清单（handoff、补录、冲突标注、verdict）——逐项执行，不跳过。

### Supersession & Conflict (dual-track)

新知识与旧条目的关系分两种,语义不同、操作不同:

| 关系 | 场景 | 命令 | 效果 |
|------|------|------|------|
| **supersede** | 新规则替代旧规则（演化） | `maestro spec supersede <old-sid> --by <new-sid>` | 旧条目 `deprecated`（search/load 排除），演化链保留 |
| **conflict** | 两条规则均有道理（争议） | `maestro spec conflict mark <file> <line> --note "<reason>"` | 旧条目 `contested`（search ×0.5，`[CONTESTED]` 标注，仍注入），人裁决 — resolution 走 `/maestro-manage knowledge audit` |

supersede 流程：`maestro spec add ... --json`（→ new-sid）→ `spec supersede <old-sid> --by <new-sid>`，`spec history <sid>` 查看演化链。

**三正交轴**: `confidence`（人/审计裁定）⊥ `status`（active/deprecated 生命周期）⊥ time-decay（自动新鲜度）。不要混用。

### Health & Maintenance

`maestro spec health` — 生命周期统计 + 悬空/循环 supersedes 校验 + 新鲜度。低频维护（`backfill-sid` 回填 sid、`history <sid>` 演化链、`search --include-deprecated`）见 `maestro spec --help`。
