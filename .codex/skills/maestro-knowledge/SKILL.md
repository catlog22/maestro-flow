---
name: maestro-knowledge
disable-model-invocation: true
description: Intent-driven knowledge-store and Run knowledge lifecycle
  management — audit/prune, stage candidates (with signal recording),
  review/resolve/promote candidates, harvest artifacts, or manage wiki/domain
  knowledge.
argument-hint: "[intent — e.g. '审计知识库' | 'harvest 这个 session' | 'wiki health' |
  '注册术语 MVP' | 'extractors']"
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - WebFetch
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: none
version: 0.5.83
---

<purpose>
Intent-driven knowledge-store management. No fixed grammar — state your intent; the command classifies it and runs the matching workflow or direct lifecycle command. Explicit keywords still work as deterministic shortcuts.

| Operation | Keywords | Execution document or CLI |
|-----------|----------|--------------------------|
| audit | `audit` / 审计 / 清理 / prune / 检查知识库 | `~/.maestro/workflows/knowledge-audit.md` |
| review | `review` / 审查 / 证据 / 下一步 / 匹配 / 去重 / 冲突检测 / 裁决 / 候选 / backlog | `maestro knowledge review <session-id> [--refresh] [--resolve <id> --as <choice> --reason "..."]` |
| stage | `stage` / 暂存 / candidate / 沉淀候选 / cited / validated / contradicted / 记录命中关系 | `maestro knowledge stage ... [--signal <signal> --signal-ids <ids>]` |
| promote | `promote` / 晋升 / 发布候选 | `maestro knowledge promote ... [--all]` |
| harvest | `harvest` / 提取 / 收割 / 从工件 | `~/.maestro/workflows/harvest.md` |
| wiki | `wiki` / 知识图谱 / 连接 / 摘要 / 健康 | `~/.maestro/workflows/wiki-manage.md` / `~/.maestro/workflows/wiki-connect.md` / `~/.maestro/workflows/wiki-digest.md` |
| extractors | `extractors` / 抽取器 / 生成抽取规则 | `~/.maestro/workflows/extractors.md` |
| domain | `domain` / 领域术语 / 注册术语 / term | `~/.maestro/workflows/domain-add.md` |
</purpose>

<dispatch>
Classify the intent in `$ARGUMENTS` into one operation. For an operation mapped to an execution document, read the path shown in the table directly and follow it; do not create a Session or Run merely to load instructions. For direct lifecycle operations, invoke the listed `maestro knowledge` CLI command.

1. Explicit keyword present → use its execution document or direct CLI lifecycle command (deterministic shortcut).
2. Otherwise infer from the intent (see the table above), e.g. "审计/清理知识库" → audit, "从工件/session 提取" → harvest, "知识图谱/wiki 健康" → wiki, "注册术语 X" → domain.
3. `review` / `stage` / `promote` map directly to the corresponding `maestro knowledge` CLI. `review --refresh` includes reconciliation; `review --resolve` includes disposition resolution; `stage --signal --signal-ids` includes signal recording. Preserve stable knowledge IDs, graph aliases, Run ID, Session ID, signal, candidate ID, disposition, target, and reason exactly; do not translate these operations into direct spec/knowhow writes.
4. For wiki, classify the sub-action: `connect`/连接 → `~/.maestro/workflows/wiki-connect.md`; `digest`/摘要 → `~/.maestro/workflows/wiki-digest.md`; `health`/`search`/`cleanup`/`stats`/健康/检查/_(none)_ → `~/.maestro/workflows/wiki-manage.md`.
5. Ambiguous → display the operation table and ask the user to pick.

### Routing rules

- Remaining tokens after classification become the chosen step's own arguments.
- During an active Run, reusable knowhow is staged here with `maestro knowledge stage knowhow ...`; project knowhow is written only by explicit promotion. Outside a Run, direct `/maestro-knowhow` capture remains available.
- Outside any Run entirely (no Run to bind), `maestro knowhow add --type <type> --title "<title>" --body-file <path>` is the fast path — it writes `.workflow/knowhow/` directly with no Session, no `--evidence`, and no review/promote cycle. Use it for standalone insights (tips, recipes, decisions) that do not belong to any Run's outcome; reserve `stage → review → promote` for candidates needing adjudication against the corpus.
- Stage candidate content from a temp file or stdin, never inline: write the content to a file and pass `maestro knowledge stage <target> "<title>" --content-file <path|->`. Inline positional content containing spaces, quotes, unicode (e.g. `…`), newlines, or leading dashes is misparsed and shifts later arguments.
- `--signal-ids` takes comma-separated IDs (`--signal-ids spec:project:a,knowhow:b`); space-separated values leak into positional arguments and corrupt the stage call.
- Use `maestro knowledge review <session-id>` as the human review surface. It shows fresh/missing/stale receipts, diversified evidence-backed matches, and copyable promote commands. `--refresh` reconciles all candidate source Runs. `--resolve <candidate-id> --as <choice> --reason "..."` resolves a candidate inline before displaying the refreshed view.
- Reconciliation is mandatory before completion but is not a popularity vote: exact identity, diversified semantic matches, and recorded/KG associations are evaluated separately. Unresolved semantic duplicate/conflict/supersession candidates may be sealed, but promotion must fail closed until resolved via `review --resolve`.
- `promote --all` promotes all eligible pending candidates (observed-only emits a warning); `--include-observed` has been removed.
- `audit --prune --apply` may only perform backed-up soft lifecycle transitions. Never physically delete knowledge or prune solely because it has low usage.
</dispatch>
