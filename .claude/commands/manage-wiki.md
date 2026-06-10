---
name: manage-wiki
description: Manage wiki graph — health, cleanup, search, stats
argument-hint: "<subcommand: health|search|cleanup|stats|connect|digest> [query] [--fix] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Unified wiki graph management command. Provides interactive access to wiki health monitoring, entry search, orphan cleanup, graph statistics, link discovery, and knowledge synthesis — the single entry point for all wiki graph operations.
</purpose>

<required_reading>
@~/.maestro/workflows/wiki-manage.md
</required_reading>

<context>
$ARGUMENTS — subcommand and optional flags.

**Subcommands:**
| Subcommand | Description |
|-----------|-------------|
| `health` | Health dashboard — score, broken links, orphans, hubs (default) |
| `search <query>` | Interactive BM25 search with follow-up actions |
| `cleanup` | Find and resolve orphans, broken links, stale entries |
| `stats` | Graph statistics — type distribution, tag frequency, growth trends |
| `connect` | Find and link hidden connections — orphan rescue, missing links, transitive gaps |
| `digest [topic]` | Generate knowledge digest with theme clustering and gap analysis |
| No args | Same as `health` |

**Flags:**
- `--type <type>` — Filter by wiki type: spec, knowhow, note, issue
- `--fix` — Auto-fix issues found during cleanup/connect (remove broken links, apply connections)
- `--json` — Output in JSON format
- `--min-similarity N` — (connect) Minimum similarity threshold for link candidates
- `--max N` — (connect) Maximum number of suggestions
- `--format brief|full` — (digest) Output format
- `--recent N` — (digest) Scope to N most recent entries
- `--create-issues` — (digest) Create issues for identified knowledge gaps
</context>

<execution>
**Subcommand routing:**
- `health|search|cleanup|stats` → Follow `~/.maestro/workflows/wiki-manage.md` completely.
- `connect` → Follow `~/.maestro/workflows/wiki-connect.md` completely (Stages 1-6).
- `digest` → Follow `~/.maestro/workflows/wiki-digest.md` completely (Stages 1-8).
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` not initialized — run `/maestro-init` first | validate |
| E002 | fatal | No wiki entries found — create content first | load |
| E003 | error | Invalid subcommand | parse_input |
| W001 | warning | Health score below 50 — graph needs attention | health |
| W002 | warning | Orphan cleanup had partial failures | cleanup |
</error_codes>

<success_criteria>
- [ ] Subcommand parsed (health/search/cleanup/stats/connect/digest)
- [ ] Wiki data loaded via `maestro wiki` CLI
- [ ] Results displayed in formatted output
- [ ] If cleanup/connect --fix: issues resolved and delta reported
- [ ] If digest: themes clustered, gaps identified, coverage heatmap generated
- [ ] Next-step suggestions provided
</success_criteria>
