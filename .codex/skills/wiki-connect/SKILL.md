---
name: wiki-connect
description: Wiki knowledge graph link discovery and health improvement. Finds orphaned entries, missing connections, transitive gaps. Scores candidates and optionally auto-applies new related links via --fix.
argument-hint: "[--scope <type>] [--min-similarity N] [--fix] [--max N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Knowledge graph link discovery. Analyzes wiki index to find orphaned entries, missing
bidirectional links, and transitive closure gaps. Scores connection candidates and
optionally auto-applies new `related` links to improve graph connectivity.
</purpose>

<context>
$ARGUMENTS — optional flags.

**Flags:**
- `--scope <type>` — Limit to wiki type (spec, memory, note, lesson, issue). Default: all.
- `--min-similarity N` — Threshold 0.0-1.0 (default: 0.3)
- `--fix` — Auto-apply top suggestions
- `--max N` — Max suggestions (default: 20)

**Output**: `.workflow/learning/wiki-connections-{date}.md`
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
```
score = 0.4 × tag_overlap + 0.3 × title_bm25 + 0.2 × same_category + 0.1 × type_bridge
```
Filter by `--min-similarity`, rank desc, limit by `--max`.

### Stage 4: Present Suggestions
Display ranked suggestions with scores, reasons, projected health delta.
If not `--fix`: display and exit.

### Stage 5: Apply (--fix only)
For each suggestion: get entry → append target to `related` → update via `maestro wiki update`.
Re-run `maestro wiki health` for delta.

### Stage 6: Persist
Write `wiki-connections-{date}.md`. Append graph insights to `lessons.jsonl` (source: "wiki-connect").

**Next steps:** `/wiki-digest <topic>`, `/learn-follow <wiki-id>`, `maestro wiki graph`
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
- [ ] Report written to `wiki-connections-{date}.md`
- [ ] Graph insights appended to `lessons.jsonl`
</success_criteria>
