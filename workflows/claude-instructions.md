# Maestro

Workflow orchestration CLI with MCP endpoint support and extensible architecture.

- **Coding Philosophy**: @~/.maestro/workflows/coding-philosophy.md

## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

Available CLI endpoints are dynamically defined by the config file

## Code Diagnostics

- **Prefer `mcp__ide__getDiagnostics`** for code error checking over shell-based TypeScript compilation

## Knowledge System

### Search — Query Before Acting

When tackling unfamiliar domains or cross-cutting concerns, search existing knowledge first:
- `maestro spec load --category <cat>` — load rules by category (coding/arch/debug/test/review/learning)
- `maestro spec load --keyword <kw>` — cross-category keyword match
- `maestro wiki search "<query>"` — full-text search across all knowhow
- `maestro wiki list --category <cat>` → `maestro wiki load <id>` — browse then load full detail

### Record — Capture Knowledge

When execution surfaces non-obvious knowledge (decisions, root causes, pitfalls, patterns), persist it:

- **Spec entry** (short rule/constraint) → `/spec-add <category> "title" "content" --keywords kw1,kw2`
- **Knowhow document** (detailed recipe/template/decision/reference) → `/manage-knowhow-capture`

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, test strategy→`test`.