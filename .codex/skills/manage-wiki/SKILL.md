---
name: manage-wiki
description: Manage wiki graph -- health, cleanup, search, stats
argument-hint: "[health|search|cleanup|stats] [options]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
---

<purpose>
Unified wiki graph management. Health monitoring, interactive search, orphan cleanup, and graph statistics. Day-to-day operations to keep the knowledge graph healthy.
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
| `stats` | Graph statistics — type distribution, tag frequency, growth |

**Flags:**
- `--type <type>` — Filter: spec, knowhow, note, issue
- `--fix` — Auto-fix issues during cleanup
- `--json` — JSON output

**Output boundary**: File writes MUST target `.workflow/wiki/`, `.workflow/knowhow/`, or `.workflow/issues/issues.jsonl` (when `--create-issues`) only. NEVER modify source code or files outside these paths. `--dry-run` overrides `--fix` — no writes when both are set.
</context>

<invariants>
1. **Dry-run precedence** — `--dry-run` MUST override `--fix` when both are passed; preview only, no writes
2. **Read-only by default** — without `--fix` or `--create-issues`, all subcommands MUST be read-only
3. **Confirmation on fixes** — `--fix` MUST show preview of changes before applying; auto-apply only when explicitly set
4. **Graph integrity** — `connect` MUST NOT create circular link chains; validate graph acyclicity for parent-child relationships
5. **Threshold enforcement** — `--min-similarity` MUST be respected; NEVER suggest connections below the threshold
6. **Subcommand isolation** — each subcommand routes to its own workflow file; NEVER cross-execute subcommand logic
</invariants>

<execution>
Follow '~/.maestro/workflows/wiki-manage.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Load** (Subcommand routing → Wiki data loading)
- REQUIRED: Subcommand parsed and validated (health/search/cleanup/stats).
- REQUIRED: `.workflow/` initialized (E001 if missing).
- BLOCKED if E003 (invalid subcommand) or E001.

**GATE 2: Load → Execute** (Wiki data → Subcommand execution)
- REQUIRED: Wiki data loaded via `maestro wiki` CLI.
- REQUIRED: At least one wiki entry exists (E002 if none).
- BLOCKED if wiki data loading fails entirely.

**GATE 3: Execute → Report** (For cleanup --fix only)
- REQUIRED: Preview of changes displayed to user.
- REQUIRED: User confirmation before applying fixes.
- BLOCKED if user declines fixes.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized |
| E002 | fatal | No wiki entries found |
| E003 | error | Invalid subcommand |
| W001 | warning | Health score below 50 |
| W002 | warning | Cleanup had partial failures |
</error_codes>

<success_criteria>
- [ ] Subcommand parsed (health/search/cleanup/stats)
- [ ] Wiki data loaded via `maestro wiki` CLI
- [ ] Results displayed in formatted output
- [ ] If cleanup --fix: issues resolved and delta reported
- [ ] Next-step suggestions provided
</success_criteria>
