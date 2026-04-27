---
name: manage-wiki
description: Wiki knowledge graph management — health dashboard, orphan cleanup, entry search, and graph statistics
argument-hint: "[health|search|cleanup|stats] [options]"
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
Unified wiki graph management command. Provides interactive access to wiki health monitoring, entry search, orphan cleanup, and graph statistics — the day-to-day operations that keep the knowledge graph healthy.

Complements `/wiki-connect` (link discovery) and `/wiki-digest` (synthesis) with operational tooling.
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
| No args | Same as `health` |

**Flags:**
- `--type <type>` — Filter by wiki type: spec, knowhow, note, lesson, issue
- `--fix` — Auto-fix issues found during cleanup (remove broken links, suggest connections)
- `--json` — Output in JSON format
</context>

<execution>
Follow '~/.maestro/workflows/wiki-manage.md' completely.
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
- [ ] Subcommand parsed (health/search/cleanup/stats)
- [ ] Wiki data loaded via `maestro wiki` CLI
- [ ] Results displayed in formatted output
- [ ] If cleanup --fix: issues resolved and delta reported
- [ ] Next-step suggestions provided
</success_criteria>
