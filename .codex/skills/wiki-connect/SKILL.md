---
name: wiki-connect
description: Find and link hidden connections in wiki graph
argument-hint: "[--scope <type>] [--min-similarity N] [--fix] [--max N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Knowledge graph link discovery. Analyzes wiki index to find orphaned entries, missing
bidirectional links, and transitive closure gaps. Scores connection candidates and
optionally auto-applies new `related` links to improve graph connectivity.
</purpose>

<context>
$ARGUMENTS — optional flags.

**Flags:**
- `--scope <type>` — Limit to wiki type (spec, knowhow, note, issue). Default: all.
- `--min-similarity N` — Threshold 0.0-1.0 (default: 0.3)
- `--fix` — Auto-apply top suggestions
- `--max N` — Max suggestions (default: 20)

**Output**: `.workflow/knowhow/KNW-wiki-connections-{date}.md`
</context>

<execution>

### Stage 1: Load Wiki State
Parallel `maestro wiki` commands: `list --json`, `health`, `orphans`, `hubs --top 10`.

### Stage 2: Identify Connection Candidates
- **Orphan rescue**: BM25 search by title, tag overlap, same category/parent
- **Missing bidirectional**: A→B exists but B→A missing
- **Transitive closure**: A→B and B→C but no A→C (with shared tags/category)
- **Type bridge**: Different types referencing same concept but unlinked
- **Parent cluster**: Entries sharing the same parent but not linked to each other

### Stage 3: Score Candidates
Score = 0.4 x tag_overlap + 0.3 x title_bm25 + 0.2 x same_category + 0.1 x type_bridge. Filter by `--min-similarity`, rank desc, limit by `--max`.

### Stage 4: Present Suggestions
Display ranked suggestions with scores, reasons, projected health delta.
If not `--fix`: display and exit.

### Stage 5: Apply (--fix only)
For each suggestion: get entry → append target to `related` → update via `maestro wiki update`.
Re-run `maestro wiki health` for delta.

### Stage 6: Persist
Write `KNW-wiki-connections-{date}.md`. Append graph insights to `specs/learnings.md` (source: "wiki-connect").

**Next steps:** `$wiki-digest <topic>`, `$manage-wiki health`, `$learn-follow <wiki-id>`, `maestro wiki graph`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found | Initialize wiki content |
| W001 | warning | No candidates above threshold | Lower --min-similarity |
| W002 | warning | Some wiki updates failed during --fix | Retry manually |
| W003 | warning | Health score unchanged after fix | Connections may not affect specific metrics |
</error_codes>

<success_criteria>
- [ ] Wiki index loaded with type distribution
- [ ] Baseline health score recorded
- [ ] Orphans identified and rescue candidates generated
- [ ] Candidates scored and ranked
- [ ] Suggestions displayed with scores and reasons
- [ ] If --fix: entries updated, new health score reported
- [ ] Report written to `KNW-wiki-connections-{date}.md`
- [ ] Graph insights appended to `specs/learnings.md`
</success_criteria>
