# Maestro

- **Coding Philosophy**: @~/.maestro/workflows/coding-philosophy.md

## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

## Explore Priority

Commands with codebase exploration/search steps should prefer `maestro explore` over inline Grep/Read:
- **odyssey-\*** (archaeology, explore, discover phases)
- **analyze, blueprint, grill** (discovery/scan phases)
- **learn-investigate** (evidence gathering)
- **issue-discover** (multi-perspective scan)
- **impeccable teach/explore** (codebase scan)

Use structured prompt format (`FIND/SCOPE/EXCLUDE/ATTENTION/EXPECTED`) for targeted searches. Multi-prompt parallel for multi-angle scans.

## Knowledge System

**Gate rule: On any coding/modification/debugging task, run `maestro search` BEFORE reading code or editing files. Use targeted queries — multiple short searches beat one long one.**

### Required search (every task, no exceptions)

```bash
maestro search "<1-3 word topic phrase>"
```

**Query rules:**
- Use **1-3 core keywords** per query — never dump all context into one search
- Separate concepts from symbols: `maestro search "topology layout"` then `maestro search "DetailedTopologySVG" --code`
- Run multiple targeted searches rather than one broad query

```bash
# ❌ Bad: keyword dump (5+ unrelated terms → diluted BM25 scores)
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ Good: targeted multi-search
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro search "elk layout" --type knowhow
```

Then add follow-up searches based on results:
- Specific symbol/function → `maestro kg search <symbol>` or `maestro kg context <node>`
- Architecture/testing → `maestro search --type spec --category arch|test`
- Call chains → `maestro kg callers <fn>` / `maestro kg callees <fn>`
- Domain rules → `maestro spec load --category <cat> [--keyword <kw>]`

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
