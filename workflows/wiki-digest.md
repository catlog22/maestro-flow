# Wiki Digest Workflow

Knowledge synthesis from the wiki knowledge graph. Clusters entries by semantic theme, identifies knowledge gaps, produces coverage heatmaps, and optionally creates knowledge-gap issues.

Unlike `maestro wiki list` which shows raw entries, this workflow synthesizes and interprets the knowledge base — producing curated summaries with gap analysis and recommended actions.

**Closed-loop**: harvest extracts → wiki stores → wiki-digest synthesizes → gap issues → issue pipeline.

---

## Prerequisites

- `.workflow/` initialized
- Wiki entries exist (at least 5 for meaningful clustering)
- `maestro wiki` CLI available
- `.workflow/learning/lessons.jsonl` exists (optional, for cross-reference)

---

## Argument Shape

```
/wiki-digest                                  → digest entire wiki
/wiki-digest auth                             → topic-scoped digest
/wiki-digest --recent 14                      → entries updated in last 14 days
/wiki-digest --type spec                      → spec entries only
/wiki-digest --format full                    → detailed per-entry summaries
/wiki-digest auth --create-issues             → digest + auto-create gap issues
```

| Flag | Effect |
|------|--------|
| `<topic>` | Search wiki for matching entries via BM25 |
| `--recent N` | Entries updated within last N days |
| `--type <type>` | Filter by wiki type: spec, memory, note, lesson, issue |
| `--format brief\|full` | `brief` = compact (default), `full` = detailed per-entry |
| `--create-issues` | Auto-create knowledge-gap issues in `issues.jsonl` |

---

## Stage 1: Scope & Load

Determine scope from arguments:

| Input | Resolution |
|-------|-----------|
| `<topic>` | `maestro wiki search "<topic>" --json` |
| `--recent N` | `maestro wiki list --json` → filter by updated date |
| `--type <type>` | `maestro wiki list --type <type> --json` |
| No args | `maestro wiki list --json` (all entries) |

Load entry metadata: id, title, tags, status, type, related, summary, category.

For `--format full`: also fetch entry bodies via `maestro wiki get <id>` for top entries (by hub score).

Run `maestro wiki health` for baseline health metrics.

---

## Stage 2: Theme Clustering

Group entries into 3-5 semantic themes using:

1. **Tag co-occurrence**: entries sharing 2+ tags → same cluster
2. **Title BM25 similarity**: entries whose titles match each other's keywords
3. **Relationship proximity**: entries connected by `related` links → same cluster
4. **Type sub-clustering**: if all same type, sub-cluster by content/category

Per theme, record:
- Theme name: dominant tag or keyword
- Entry count and IDs
- Type distribution within theme
- Status distribution (draft/active/completed/archived)

---

## Stage 3: Per-Theme Analysis

For each theme, produce:

### Summary Paragraph
Synthesize what these entries collectively teach. Focus on the knowledge pattern, not individual details.

### Key Entries
Top 3-5 most important entries by:
- Hub score (in-degree from `maestro wiki hubs`)
- Backlink count (from `maestro wiki backlinks <id>`)
- Recency (recently updated entries weigh more)

### Gap Detection
- **Broken links**: `[[references]]` that don't resolve within the theme
- **Orphans**: entries in this theme with no connections
- **TODO markers**: entries with `?`, "TODO", "TBD" in title or body
- **Missing perspectives**: theme has specs but no lessons? Issues but no decisions?

### Health Score
Per-theme health adapted from wiki health formula (entries, connectivity, completeness).

---

## Stage 4: Cross-Reference with Lessons

1. Read `.workflow/learning/lessons.jsonl`
2. For each theme, search lessons by keyword match
3. Identify **unlinked insights**: lessons that match a theme's keywords but are not referenced by any wiki entry in that theme
4. Flag as "knowledge not yet connected to the graph"

If `lessons.jsonl` not found, skip with W002 warning.

---

## Stage 5: Coverage Heatmap

Build a type × theme matrix showing knowledge density:

```
              Theme 1    Theme 2    Theme 3    Theme 4    Theme 5
spec          ███░░      ░░░░░      █████      ██░░░      ░░░░░
memory        ░░░░░      ████░      ██░░░      ░░░░░      ███░░
lesson        █░░░░      ██░░░      ████░      █░░░░      ░░░░░
issue         ██░░░      ░░░░░      █░░░░      ███░░      ░░░░░

Legend: █ = entries exist, ░ = sparse/missing
```

Empty cells = knowledge gaps. Each gap becomes a candidate for Stage 7.

---

## Stage 6: Write Digest

Produce `.workflow/learning/digest-{slug}-{YYYY-MM-DD}.md`:

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
{type × theme matrix}

## Knowledge Gaps
| Gap | Theme | Type Missing | Suggested Action |
|-----|-------|-------------|-----------------|
| No lessons for auth patterns | Security | lesson | /learn-decompose src/auth/ |

## Unlinked Insights
{lessons.jsonl entries not connected to wiki graph}

## Recommended Actions
1. {action}: {reason}
2. ...
```

---

## Stage 7: Gap → Issue Routing (if --create-issues)

For each knowledge gap from Stage 5:
1. Dedup: check `.workflow/issues/issues.jsonl` for existing gap with same theme + type
2. If new, append to `issues.jsonl` using canonical schema (see `~/.maestro/workflows/issue.md` Step 4):
   - `type`: "knowledge-gap"
   - `status`: "open"
   - `severity`: "low"
   - `source`: "wiki-digest"
   - `tags`: ["knowledge-gap", "{theme-slug}"]
3. Report created issue count

---

## Stage 8: Persist

1. Write digest file to `.workflow/learning/`
2. Append meta-insights to `.workflow/learning/lessons.jsonl`:
   - `source: "wiki-digest"`, `category: "technique"`
   - e.g., "Auth knowledge concentrated in specs, lacks lessons"
3. Display summary:

```
== Wiki Digest Complete ==
Scope:     {topic or "all"}
Entries:   {count}
Themes:    {theme_count}
Gaps:      {gap_count} identified
Issues:    {created_count} created (if --create-issues)
Report:    .workflow/learning/digest-{slug}-{date}.md
```

---

## Next Steps

| Action | Command |
|--------|---------|
| Deep dive on a theme | `/learn-follow <wiki-id>` |
| Fix graph connectivity | `/wiki-connect --fix` |
| Decompose for patterns | `/learn-decompose <path>` |
| Create missing entries | `maestro wiki create --type <type> --slug <slug>` |
| Triage gap issues | `/manage-issue list --source wiki-digest` |

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found (empty index) | Initialize wiki content |
| E002 | error | Topic search returned 0 results | Broaden topic or check wiki |
| W001 | warning | Too few entries (<5) for meaningful clustering | Themes may be trivial |
| W002 | warning | `lessons.jsonl` not found | Skip cross-reference |
| W003 | warning | Some entry bodies failed to load | Partial summaries |
