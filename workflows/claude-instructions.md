# Maestro

- **Coding Philosophy**: @~/.maestro/workflows/coding-philosophy.md

## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

## Explore

`maestro explore` takes priority over Glob, Grep, and Read. When locating files or searching code patterns, call `maestro explore` first and stop to wait for results.

```bash
maestro explore "FIND: <target + condition>\nSCOPE: <paths>" [more prompts...] [options]
```

Lightweight read-only codebase search. 1 prompt = 1 agent. Not for write-mode/long sessions — use `delegate`.

| Option | Description |
|--------|-------------|
| `-e, --endpoint <names>` | Endpoint name(s), comma-separated |
| `--all` | Fan out each prompt to all endpoints |
| `--max-turns <n>` | Max agent turns per job |
| `-f, --file <path>` | Load prompts from JSON or text file |
| `--cd <dir>` | Working directory |
| `--json` | Output results as JSON |

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

```bash
maestro explore \
  "FIND: All functions exported from auth module\nSCOPE: src/auth/\nEXPECTED: function name + file:line" \
  "FIND: All imports from auth module\nSCOPE: src/**/*.ts\nEXCLUDE: src/auth/\nEXPECTED: import path + file:line" \
  --json
```

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

**Gate rule**: run `maestro search` + `maestro load` BEFORE reading code or editing files.

```bash
maestro search "<query>" [--type <type>] [--category <cat>] [--code] [--kg]
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--id <id>]
```

**--type**: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`
**--category** (spec only): `coding`, `arch`, `debug`, `test`, `review`, `learning`, `ui`

### Query Rules

1-3 core keywords per query — multiple short queries beat one long one.
Separate concepts from symbols. Add `--code` for symbols, `--kg` for full-source.

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
| Spec | `/spec-add <category> "title" "content" --keywords kw1,kw2 --description "summary"` |
| Knowhow | `/manage-knowhow-capture` (`--spec-category <cat>` for agent injection) |

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, tests→`test`.

### Supersession & Conflict (dual-track)

新知识与旧条目的关系分两种,语义不同、操作不同:

| 关系 | 场景 | 命令 | 效果 |
|------|------|------|------|
| **supersede** | 新规则替代旧规则（演化） | `maestro spec supersede <old-sid> --by <new-sid>` | 旧条目 `deprecated`（search/load 排除），演化链保留 |
| **conflict** | 两条规则均有道理（争议） | `maestro spec conflict mark <file> <line> --note "<reason>"` | 旧条目 `contested`（search ×0.5，`[CONTESTED]` 标注，仍注入），人裁决 |

```bash
# supersede 流程: add → capture sid → supersede
maestro spec add coding "新规则" "内容" --keywords kw1,kw2 --json   # → 获取 new-sid
maestro spec supersede <old-sid> --by <new-sid>                     # → 旧条目 deprecated
maestro spec history <sid>                                          # → 查看演化链

# conflict 流程: 不确定谁对 → 标记争议 → 审计解决
maestro spec conflict mark <file> <line> --note "<reason>"
# Resolution: /manage-knowledge-audit
```

**三正交轴**: `confidence`（人/审计裁定）⊥ `status`（active/deprecated 生命周期）⊥ time-decay（自动新鲜度）。不要混用。

### Health & Maintenance

```bash
maestro spec health                  # 生命周期统计 + 悬空/循环 supersedes 校验 + 新鲜度
maestro spec backfill-sid            # 存量无 sid 条目回填（幂等），启用演化链
maestro spec history <sid>           # 某条目的演化链（oldest → newest）
maestro search "<q>" --include-deprecated   # 搜索含 deprecated 条目
```
