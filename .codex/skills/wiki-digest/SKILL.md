---
name: wiki-digest
description: Knowledge synthesis from wiki entries. Theme clustering, gap analysis, coverage heatmap (type × theme matrix). Optionally creates knowledge-gap issues. Persists meta-insights to lessons.jsonl.
argument-hint: "[<topic>|--recent N] [--type <type>] [--format brief|full] [--create-issues]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Knowledge synthesis that generates actionable digests from the wiki knowledge graph.
Clusters entries by semantic theme, identifies knowledge gaps, and produces a coverage
heatmap. Unlike `maestro wiki list` (raw entries), this synthesizes and interprets
the knowledge base with gap analysis and recommended actions.
</purpose>

<context>
$ARGUMENTS — scope and optional flags.

**Scope resolution:**
- `<topic>` — Search wiki for matching entries
- `--recent N` — Entries updated in last N days
- `--type <type>` — Filter by wiki type
- No args — entire wiki

**Flags:**
- `--format brief` — Compact summary (default)
- `--format full` — Detailed with per-entry summaries
- `--create-issues` — Auto-create knowledge-gap issues in issues.jsonl

**Output**: `.workflow/learning/digest-{slug}-{date}.md`
</context>

<execution>

### Stage 1: Scope & Load
Load entries via `maestro wiki list/search`. Run `maestro wiki health` for baseline.

### Stage 2: Theme Clustering
Group entries into 3-5 themes via: tag co-occurrence, title BM25 similarity, relationship proximity, type grouping.

### Stage 3: Per-Theme Analysis
Per theme: summary paragraph, key entries (by hub score), gap detection (broken links, orphans, TODO markers, missing perspectives), health score.

### Stage 4: Cross-Reference with Lessons
Search `lessons.jsonl` for related insights. Flag unlinked insights (lessons matching theme but not referenced by wiki entries).

### Stage 5: Coverage Heatmap
Type × theme matrix showing knowledge density:
```
              Theme 1    Theme 2    Theme 3
spec          ███░░      ░░░░░      █████
memory        ████░      ███░░      ░░░░░
lesson        █░░░░      ██░░░      ████░
```
Empty cells = knowledge gaps.

### Stage 6: Write Digest
Produce `digest-{slug}-{date}.md` with themes, heatmap, gaps, unlinked insights, recommended actions.

### Stage 7: Gap → Issue (if --create-issues)
For each gap: dedup against issues.jsonl, append with `type: "knowledge-gap"`, `source: "wiki-digest"`.

### Stage 8: Persist
Append meta-insights to `lessons.jsonl` (source: "wiki-digest"). Display summary.

**Next steps:** `/learn-follow <wiki-id>`, `/wiki-connect --fix`, `/learn-decompose <path>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found | Initialize wiki content |
| E002 | error | Topic search returned 0 | Broaden topic |
| W001 | warning | Too few entries (<5) | Themes may be trivial |
| W002 | warning | lessons.jsonl not found | Skip cross-reference |
| W003 | warning | Some entry bodies failed to load | Partial summaries |
</error_codes>

<success_criteria>
- [ ] Scope parsed and entries loaded
- [ ] Entries clustered into 3-5 semantic themes
- [ ] Per-theme analysis with gaps identified
- [ ] Cross-reference with lessons.jsonl completed
- [ ] Coverage heatmap generated
- [ ] If --create-issues: gap issues created (deduped)
- [ ] Digest written to `digest-{slug}-{date}.md`
- [ ] Meta-insights appended to lessons.jsonl
</success_criteria>
