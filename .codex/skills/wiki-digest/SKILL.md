---
name: wiki-digest
description: Generate wiki digest with theme clustering and gap analysis
argument-hint: "[<topic>|--recent N] [--type <type>] [--format brief|full] [--create-issues]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
version: 0.5.50
---

<purpose>
Knowledge synthesis that generates actionable digests from the wiki knowledge graph.
Clusters entries by semantic theme, identifies knowledge gaps, and produces a coverage
heatmap. Unlike `maestro search` (raw entries), this synthesizes and interprets
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

**Output**: `.workflow/knowhow/digest-{slug}-{date}.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/` (digest document) and `.workflow/specs/learnings.md` (meta-insights). Issue creation targets `.workflow/issues/issues.jsonl` only when --create-issues is set. NEVER modify source code or wiki entries.
</context>

<invariants>
1. **Read-only analysis** — wiki entries and source code are read but NEVER modified; this is a synthesis command
2. **Issue dedup** — when --create-issues is set, MUST dedup against existing issues.jsonl before creating; NEVER create duplicate knowledge-gap issues
3. **Confirmation for issues** — MUST request_user_input before creating issues; NEVER auto-create issues without user consent (unless both --create-issues and -y)
4. **Theme minimum** — MUST cluster into 3-5 themes; fewer than 3 entries triggers W001 warning, not an error
5. **Append-only insights** — meta-insights appended to specs/learnings.md; NEVER overwrite existing entries
6. **Output boundary** — file writes limited to `.workflow/knowhow/` (digest), `.workflow/specs/learnings.md` (insights), and `.workflow/issues/issues.jsonl` (gap issues). NEVER modify source code or wiki entries
</invariants>

<execution>

### Stage 1: Scope & Load
Load entries via `maestro search`. Run `maestro wiki health` for baseline.

### Stage 2: Theme Clustering
Group entries into 3-5 themes via: tag co-occurrence, title BM25 similarity, relationship proximity, type grouping.

### Stage 3: Per-Theme Analysis
Per theme: summary paragraph, key entries (by hub score), gap detection (broken links, orphans, TODO markers, missing perspectives), health score.

### Stage 4: Cross-Reference with Lessons
Search `specs/learnings.md` for related insights. Flag unlinked insights (knowhow entries matching theme but not referenced by wiki entries).

### Stage 5: Coverage Heatmap
Type × theme matrix showing knowledge density:
```
              Theme 1    Theme 2    Theme 3
spec          ███░░      ░░░░░      █████
memory        ████░      ███░░      ░░░░░
knowhow       █░░░░      ██░░░      ████░
```
Empty cells = knowledge gaps.

### Stage 6: Write Digest
Produce `.workflow/knowhow/digest-{slug}-{date}.md` with themes, heatmap, gaps, unlinked insights, recommended actions.

### Stage 7: Gap → Issue (if --create-issues)
**Confirmation gate**: Before creating issues, present the list of proposed gap issues to user via `request_user_input` for confirmation. Only create user-approved issues. Skip confirmation only if `-y` flag is also set.

For each approved gap: dedup against issues.jsonl, append with `type: "knowledge-gap"`, `source: "wiki-digest"`.

### Stage 8: Persist
Append meta-insights to `specs/learnings.md` (source: "wiki-digest"). Display summary.

**Next steps:** `$learn-follow <wiki-id>`, `$wiki-connect --fix`, `$manage-wiki cleanup`, `$learn-decompose <path>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found | Initialize wiki content |
| E002 | error | Topic search returned 0 | Broaden topic |
| W001 | warning | Too few entries (<5) | Themes may be trivial |
| W002 | warning | learnings.md not found | Skip cross-reference |
| W003 | warning | Some entry bodies failed to load | Partial summaries |
</error_codes>

<success_criteria>
- [ ] Scope parsed and entries loaded
- [ ] Entries clustered into 3-5 semantic themes
- [ ] Per-theme analysis with gaps identified
- [ ] Cross-reference with specs/learnings.md completed
- [ ] Coverage heatmap generated
- [ ] If --create-issues: gap issues created (deduped)
- [ ] Digest written to `.workflow/knowhow/digest-{slug}-{date}.md`
- [ ] Meta-insights appended to specs/learnings.md
</success_criteria>
