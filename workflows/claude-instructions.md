# Maestro

- **Coding Philosophy**: @~/.maestro/workflows/coding-philosophy.md

## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **Explore Usage**: @~/.maestro/workflows/explore-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

## Explore Priority

`maestro explore` takes priority over Glob, Grep, and Read. When locating files or searching code patterns, call `maestro explore` first and stop to wait for results.

## Knowledge System

**Gate rule: On any coding/modification/debugging task, run `maestro search` + `maestro load` BEFORE reading code or editing files.**

### Required (every task, no exceptions)

```bash
# Search relevant knowledge (1-3 keywords, multiple short queries beat one long one)
maestro search "<topic phrase>"

# Load specs for the task type
maestro load --type spec --category coding    # coding tasks
maestro load --type spec --category arch      # architecture decisions
maestro load --type spec --category test      # test writing
maestro load --type spec --category ui        # UI work
```

**Query rules:**
- Use **1-3 core keywords** per query — never dump all context into one search
- Separate concepts from symbols: `maestro search "topology layout"` + `maestro search "DetailedTopologySVG" --code`
- Add as needed: `maestro search "query" --kg` (KG full-source), `maestro kg callers <fn>` (call chain), `maestro kg context <node>` (node context)

```bash
# ❌ Bad: keyword dump
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ Good: targeted multi-search + spec load
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro load --type spec --category coding
```

### Load & Search reference

```bash
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--id <id>]
maestro search "<query>" [--type <type>] [--category <cat>] [--code] [--kg] [--json]
```

**`--category` values** (for `--type spec`): `coding`, `arch`, `debug`, `test`, `review`, `learning`, `ui`
**`--keyword`**: free-text filter on title/body/tags — use to narrow within a category

**`--type` values**: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`

| Action | Command |
|--------|---------|
| Load coding specs | `maestro load --type spec --category coding` |
| Load arch specs with keyword | `maestro load --type spec --category arch --keyword auth` |
| List sessions | `maestro load --type session --list` |
| Load specific knowhow | `maestro load --type knowhow --id <id>` |
| Search sessions | `maestro search "query" --type session` |
| Code graph search | `maestro search "symbol" --code` |
| KG full-source search | `maestro search "query" --kg` |

### Record

- **Spec** → `/spec-add <category> "title" "content" --keywords kw1,kw2 --description "summary"`
- **Knowhow** → `/manage-knowhow-capture` (use `--spec-category <cat>` to bridge into agent injection)

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
