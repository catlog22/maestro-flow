---
name: wiki-digest
description: Generate knowledge digest from wiki entries with theme clustering, gap analysis, and coverage heatmap
argument-hint: "[<topic>|--recent N] [--type <type>] [--format brief|full]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Knowledge synthesis command that generates actionable digests from the wiki knowledge graph. Clusters entries by semantic theme, identifies knowledge gaps, and produces a coverage heatmap. Unique to maestro — leverages the wiki graph (BM25 search, backlinks, health) to surface trends and missing knowledge.

Unlike `maestro wiki list` which shows raw entries, this command synthesizes and interprets the knowledge base, producing a curated summary with gap analysis and recommended next actions.
</purpose>

<deferred_reading>
- @~/.maestro/workflows/issue.md (issues.jsonl canonical schema for `--create-issues` routing)
</deferred_reading>

<context>
Arguments: $ARGUMENTS

**Scope resolution (auto-detected):**
- `<topic>` — Search wiki for entries matching the topic via `maestro wiki search`
- `--recent N` — Entries updated in the last N days
- `--type <type>` — Filter by wiki type (spec, memory, note, lesson, issue)
- No arguments — digest of the entire wiki

**Flags:**
- `--format brief` — Compact summary, one paragraph per theme (default)
- `--format full` — Detailed digest with per-entry summaries and full gap analysis
- `--create-issues` — Auto-create `type: "knowledge-gap"` entries in `.workflow/issues/issues.jsonl` for each identified gap (closes the discovery→action loop)

**Storage written:**
- `.workflow/learning/digest-{slug}-{YYYY-MM-DD}.md` — Digest document
- `.workflow/learning/lessons.jsonl` — Meta-insights about knowledge structure (source: "wiki-digest")
- `.workflow/issues/issues.jsonl` — Knowledge-gap issues (only when `--create-issues`)

**Storage read (via maestro wiki CLI, offline mode):**
- `maestro wiki list --json` — All entries (or filtered)
- `maestro wiki search <topic>` — Topic-scoped entries
- `maestro wiki get <id>` — Entry bodies for summarization
- `maestro wiki backlinks <id>` / `maestro wiki forward <id>` — Relationship context
- `maestro wiki health` — Overall graph health
- `.workflow/learning/lessons.jsonl` — Cross-reference for unlinked insights
</context>

<execution>

### Stage 1: Scope & Load
- Parse arguments to determine scope:
  - Topic: `maestro wiki search "<topic>" --json` → matching entries
  - Recent N: `maestro wiki list --json` → filter by `updated` within N days
  - Type: `maestro wiki list --type <type> --json`
  - All: `maestro wiki list --json`
- Load entry metadata (id, title, tags, status, type, related, summary)
- For `--format full`: also load entry bodies via `maestro wiki get <id>` for top entries
- Run `maestro wiki health` for baseline metrics

### Stage 2: Theme Clustering
Group entries into 3-5 semantic themes using:

1. **Tag co-occurrence**: entries sharing 2+ tags belong to the same theme
2. **Title similarity**: BM25-based grouping (entries whose titles match each other's keywords)
3. **Relationship proximity**: entries connected by `related` links cluster together
4. **Type grouping**: if entries are all same type, sub-cluster by content

For each theme:
- Name: most common tag or dominant keyword
- Entry count
- Type distribution within theme
- Status distribution (draft/active/completed/archived)

### Stage 3: Per-Theme Analysis
For each theme, produce:

**Summary paragraph**: synthesize the key knowledge in this theme area (what do these entries collectively say?)

**Key entries**: top 3-5 most important entries (by hub score / backlink count)

**Gap detection**:
- Broken links: `[[references]]` that don't resolve within the theme
- Orphans: entries in this theme with no connections
- Questions: entries with `?` in title or "TODO" / "TBD" markers in body
- Missing perspectives: if theme has specs but no lessons, or issues but no decisions

**Health**: per-theme health score (adapted from wiki health formula)

### Stage 4: Cross-Reference with Lessons
- Search `lessons.jsonl` for insights related to each theme
- Identify unlinked insights: lessons that match a theme but are not referenced by any wiki entry in that theme
- Flag these as "knowledge not yet connected to the graph"

### Stage 5: Coverage Heatmap
Build a matrix showing knowledge density by type × theme:

```
              Theme 1    Theme 2    Theme 3    Theme 4    Theme 5
spec          ███░░      ░░░░░      █████      ██░░░      ░░░░░
memory        ░░░░░      ████░      ██░░░      ░░░░░      ███░░
lesson        █░░░░      ██░░░      ████░      █░░░░      ░░░░░
issue         ██░░░      ░░░░░      █░░░░      ███░░      ░░░░░

Legend: █ = entries exist, ░ = sparse/missing
```

Identify: which theme × type cells are empty? These are knowledge gaps.

### Stage 6: Write Digest
Produce `.workflow/learning/digest-{slug}-{date}.md`:

```markdown
# Knowledge Digest: {scope description}
**Generated:** {date} | **Entries:** {count} | **Health:** {score}/100

## Themes

### 1. {Theme Name} ({N} entries)
{summary paragraph}

**Key entries:** {linked entry IDs}
**Gaps:** {list of missing knowledge}
**Health:** {score}/100

### 2. {Theme Name} ...

## Coverage Heatmap
{matrix}

## Knowledge Gaps
| Gap | Theme | Type Missing | Suggested Action |
|-----|-------|-------------|-----------------|
| No lessons for auth patterns | Security | lesson | Run /learn-decompose on src/auth/ |

## Unlinked Insights
{lessons.jsonl entries not connected to wiki graph}

## Recommended Actions
1. {action}: {reason}
2. ...
```

### Stage 7: Gap → Issue Routing (if --create-issues)
For each knowledge gap identified in Stage 5:
1. Check `.workflow/issues/issues.jsonl` for existing gap with same theme + type
2. If not duplicate, append to `issues.jsonl` using the canonical schema from `~/.maestro/workflows/issue.md` Step 4:
   - `id`: `ISS-XXXXXXXX-NNN` format (8 hex hash + sequence)
   - `title`: "Knowledge gap: {gap description}"
   - `type`: "knowledge-gap"
   - `status`: "open"
   - `severity`: "low"
   - `priority`: "low"
   - `source`: "wiki-digest"
   - `description`: "Theme: {theme}, Missing type: {type}. Suggested action: {action}"
   - `tags`: ["knowledge-gap", "{theme-slug}"]
   - `created`: ISO date
   - `issue_history`: initial entry with `action: "created"`, `by: "wiki-digest"`, `timestamp`
3. Report created issue count

### Stage 8: Persist
1. Write digest file
2. Append meta-insights to `lessons.jsonl`:
   - `source: "wiki-digest"`, `category: "technique"`
   - e.g., "Auth knowledge is concentrated in specs but lacks lessons", "Security category has no decision entries"
3. Update `learning-index.json`
4. Display summary with key findings

**Next-step routing:**
- Deep dive on a theme → `/learn-follow <wiki-id>`
- Fix graph gaps → `/wiki-connect --fix`
- Decompose code for missing patterns → `/learn-decompose <path>`
- Create missing entries → `maestro wiki create --type <type> --slug <slug>`
- Triage gap issues → `/manage-issue list --source wiki-digest`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found (empty index) | Initialize wiki content first |
| E002 | error | Topic search returned 0 results | Broaden topic or check wiki content |
| W001 | warning | Too few entries (<5) for meaningful theme clustering | Digest produced but themes may be trivial |
| W002 | warning | lessons.jsonl not found — skipping cross-reference | Proceed without lesson context |
| W003 | warning | Some entry bodies failed to load — partial summaries | Note incomplete entries in digest |
</error_codes>

<success_criteria>
- [ ] Scope parsed and entries loaded
- [ ] Baseline health score recorded
- [ ] Entries clustered into 3-5 semantic themes
- [ ] Per-theme analysis: summary, key entries, gaps, health
- [ ] Cross-reference with lessons.jsonl completed
- [ ] Coverage heatmap generated (type × theme matrix)
- [ ] Knowledge gaps identified with suggested actions
- [ ] If `--create-issues`: gap issues created in `issues.jsonl` (deduped)
- [ ] Digest written to `digest-{slug}-{date}.md`
- [ ] Meta-insights appended to `lessons.jsonl`
- [ ] `learning-index.json` updated
- [ ] No files modified outside `.workflow/learning/` and `.workflow/issues/` (issues only when `--create-issues`)
- [ ] Summary displayed with key findings and next-step routing
</success_criteria>
