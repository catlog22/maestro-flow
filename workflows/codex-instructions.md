# Codex Code Guidelines


- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **Explore Usage**: @~/.maestro/workflows/explore-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

## Explore Priority

`maestro explore` takes priority over Glob, Grep, and Read. When locating files or searching code patterns, call `maestro explore` first and stop to wait for results.

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
- **No unsolicited documentation** - NEVER generate reports, documentation files, or summaries without explicit user request. If required, save to .workflow/.scratchpad/

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

## Knowledge System

**Gate rule: On any coding/modification/debugging task, run `maestro search` + `maestro load` BEFORE reading code or editing files.**

### Required (every task, no exceptions)

```bash
# 搜索相关知识（1-3 关键词，多次短查询优于一次长查询）
maestro search "<topic phrase>"

# 加载对应 spec（按任务类型选 category）
maestro load --type spec --category coding    # 编码任务
maestro load --type spec --category arch      # 架构决策
maestro load --type spec --category test      # 测试编写
maestro load --type spec --category ui        # UI 工作
```

**查询规则：**
- 每次 **1-3 个核心关键词** — 不要把所有上下文堆到一次搜索
- 概念与符号分开查：`maestro search "topology layout"` + `maestro search "DetailedTopologySVG" --code`
- 按需追加：`maestro search "query" --kg`（KG 全源）、`maestro kg callers <fn>`（调用链）、`maestro kg context <node>`（节点上下文）

```bash
# ❌ Bad: keyword dump
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ Good: targeted multi-search + spec load
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro load --type spec --category coding
```

### Load (unified knowledge loading)

```bash
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--id <id>]
```

| 用法 | 命令 |
|------|------|
| 加载 spec | `maestro load --type spec --category coding` |
| 列出 session | `maestro load --type session --list` |
| 加载 knowhow | `maestro load --type knowhow --id <id>` |
| 搜索 session | `maestro search "query" --type session` |
| 代码图谱搜索 | `maestro search "symbol" --code` |
| KG 全源搜索 | `maestro search "query" --kg` |

Types: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`

### Record

- **Spec** → `/spec-add <category> "title" "content" --keywords kw1,kw2 --description "summary"`
- **Knowhow** → persist non-obvious knowledge (deviations, root causes, constraints)

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, tests→`test`.

### Confidence & Conflict Marking

When search results conflict with current context, **mark the entry**:

```bash
maestro spec conflict mark <file> <line> --note "<conflict reason>"
maestro spec conflict list                    # view all marked entries
```

Confidence levels: `high` (verified) → `medium` (default) → `low` (stale) → `contested` (conflict detected).

- `contested` → 注入时排末尾，`[CONTESTED]` 标记 + 冲突说明
- `low` → `[LOW CONFIDENCE]` 标记
- 消除由 `/manage-knowledge-audit` 审查命令专门处理
