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
Wiki graph management: health, search, cleanup, stats, connect, digest.
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
- `--dry-run` — Preview mode, no writes. **Overrides `--fix`**: when both are passed, `--dry-run` takes precedence (preview only, no fixes applied).
- `--json` — Output in JSON format
- `--min-similarity N` — (connect) Minimum similarity threshold for link candidates
- `--max N` — (connect) Maximum number of suggestions
- `--format brief|full` — (digest) Output format
- `--recent N` — (digest) Scope to N most recent entries
- `--create-issues` — (digest) Create issues for identified knowledge gaps

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
**Subcommand routing:**
- `health|search|cleanup|stats` → Follow `~/.maestro/workflows/wiki-manage.md` completely.
- `connect` → Follow `~/.maestro/workflows/wiki-connect.md` completely (Stages 1-6).
- `digest` → Follow `~/.maestro/workflows/wiki-digest.md` completely (Stages 1-8).

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Load** (Subcommand routing → Wiki data loading)
- REQUIRED: Subcommand parsed and validated (health/search/cleanup/stats/connect/digest).
- REQUIRED: `.workflow/` initialized (E001 if missing).
- BLOCKED if E003 (invalid subcommand) or E001.

**GATE 2: Load → Execute** (Wiki data → Subcommand execution)
- REQUIRED: Wiki data loaded via `maestro wiki` CLI.
- REQUIRED: At least one wiki entry exists (E002 if none).
- BLOCKED if wiki data loading fails entirely.

**GATE 3: Execute → Write** (For mutating operations: cleanup --fix, connect --fix, digest --create-issues)
- REQUIRED: Preview of changes shown to user.
- REQUIRED: `--dry-run` NOT set (overrides `--fix`).
- BLOCKED if preview generation fails or user declines.
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

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Health score < 50 | `/manage-wiki cleanup --fix` |
| Orphan entries found | `/manage-wiki connect --fix` |
| Knowledge gaps identified | `/manage-knowhow-capture` |
| Want knowledge synthesis | `/manage-wiki digest` |
</completion>
