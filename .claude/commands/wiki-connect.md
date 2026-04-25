---
name: wiki-connect
description: Surface hidden connections in the wiki knowledge graph and suggest or apply new links
argument-hint: "[--scope <type>] [--min-similarity N] [--fix] [--max N]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<required_reading>
@~/.maestro/workflows/wiki-connect.md
</required_reading>

<purpose>
Knowledge graph link discovery and health improvement. Analyzes the wiki index to find orphaned entries, missing connections, and transitive link gaps, then suggests or auto-applies new `related` links to improve graph connectivity.

Leverages maestro's unique wiki graph infrastructure (BM25 search, backlinks, health scoring) — no equivalent in gstack. Directly improves the quality of all downstream wiki consumers (search, digest, follow-along).
</purpose>

<context>
Arguments: $ARGUMENTS

**Flags:**
- `--scope <type>` — Limit analysis to a wiki type (spec, memory, note, lesson, issue). Default: all types.
- `--min-similarity N` — Minimum similarity score threshold 0.0-1.0 (default: 0.3)
- `--fix` — Auto-apply the top suggestions by updating wiki entries with new `related` links
- `--max N` — Maximum number of suggestions to generate (default: 20)

**Storage written:**
- `.workflow/learning/wiki-connections-{YYYY-MM-DD}.md` — Connection analysis report
- If `--fix`: wiki entries updated via `maestro wiki update` with new `related` links
- `.workflow/learning/lessons.jsonl` — Graph structure insights (source: "wiki-connect")

**Storage read (via maestro wiki CLI, offline mode):**
- `maestro wiki list --json` — All wiki entries
- `maestro wiki graph` — Full graph structure (forward + backlinks)
- `maestro wiki health` — Current health score
- `maestro wiki orphans` — Orphaned entries
- `maestro wiki hubs` — Hub entries (most referenced)
</context>

<execution>

### Stage 1: Load Wiki State
Run these `maestro wiki` commands in parallel:

```bash
maestro wiki list --json
maestro wiki health
maestro wiki orphans
maestro wiki hubs --top 10
```

Parse results:
- Entry count, type distribution
- Baseline health score (from `wiki health`)
- Orphan list (entries with 0 in-degree and 0 out-degree)
- Hub list (most-referenced entries)

Apply `--scope` filter if provided.

### Stage 2: Identify Connection Candidates
For each entry, compute potential connections:

**2a. Orphan Rescue:**
For each orphan entry, search for related entries using:
- `maestro wiki search "<orphan title>"` — BM25 match by title
- Tag overlap: entries sharing 2+ tags with the orphan
- Same category: entries with matching `category`

**2b. Missing Bidirectional Links:**
For entries that have forward links but no corresponding backlink (A links to B, but B doesn't link to A), suggest adding the reverse link.

**2c. Transitive Closure:**
If A → B and B → C, but A has no link to C, and A and C share tags or category, suggest A → C.

**2d. Type Bridge:**
Entries of different types that reference the same concept (e.g., a `spec-auth` and a `lesson-auth-gotcha`) but aren't linked.

### Stage 3: Score Candidates
For each candidate connection (source → target), compute similarity:

```
score = 0.4 × tag_overlap_ratio
      + 0.3 × title_bm25_similarity
      + 0.2 × same_category_bonus
      + 0.1 × type_bridge_bonus
```

- `tag_overlap_ratio`: shared_tags / max(source_tags, target_tags)
- `title_bm25_similarity`: normalized BM25 score from wiki search
- `same_category_bonus`: 1.0 if same category, else 0.0
- `type_bridge_bonus`: 1.0 if different types, else 0.0

Filter by `--min-similarity`, rank descending, limit to `--max`.

### Stage 4: Present Suggestions
Display ranked connection suggestions:

```
== Wiki Connection Suggestions ==
Baseline health: 72/100 | Orphans: 8 | Broken links: 3

#  Score  Source              → Target              Reason
1  0.85   memory-auth-flow    → spec-auth           tag overlap (auth, security) + same phase
2  0.71   note-cache-pattern  → spec-performance    title BM25 match + type bridge
3  0.65   lesson-retry-fix    → spec-error-handling  tag overlap (error, retry)
...

Projected health after fix: 81/100 (+9)
```

If NOT `--fix`: display and exit.
If `--fix`: proceed to Stage 5.

### Stage 5: Apply Connections (--fix only)
For each accepted suggestion:
1. Get current entry: `maestro wiki get <source-id> --json`
2. Extract existing `related` list from frontmatter
3. Append target-id to `related` if not already present
4. Update: `maestro wiki update <source-id> --frontmatter "related: [existing..., new-target]"`
5. Log success/failure

After all updates:
- Re-run `maestro wiki health` to get new health score
- Report delta

### Stage 6: Persist & Report
1. Write `.workflow/learning/wiki-connections-{date}.md` with:
   - Baseline and final health scores
   - All suggestions (applied and unapplied)
   - Orphan rescue results
   - Graph structure observations (hub concentration, type distribution)
2. Append graph insights to `lessons.jsonl`:
   - `source: "wiki-connect"`, `category: "technique"`
   - e.g., "Auth-related entries are poorly connected", "Phase 3 has 5 orphaned notes"
3. Display summary

**Next-step routing:**
- Generate knowledge digest → `/wiki-digest <topic>`
- Follow-along on orphan → `/learn-follow <wiki-id>`
- View full graph → `maestro wiki graph`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found (empty index) | Initialize wiki content first, or run `/maestro-init` |
| E002 | error | `maestro wiki` CLI not available | Check maestro installation |
| W001 | warning | No connection candidates found above threshold | Lower --min-similarity or check if graph is already well-connected |
| W002 | warning | Some wiki update calls failed during --fix | Partial application; retry failed entries manually |
| W003 | warning | Health score unchanged after fix | Connections may not have improved the specific health metrics |
</error_codes>

<success_criteria>
- [ ] Wiki index loaded with entry count and type distribution
- [ ] Baseline health score recorded
- [ ] Orphans identified and rescue candidates generated
- [ ] Connection candidates scored and ranked
- [ ] Results filtered by --min-similarity and limited by --max
- [ ] Suggestions displayed with scores and reasons
- [ ] If --fix: entries updated with new `related` links
- [ ] If --fix: new health score computed and delta reported
- [ ] Report written to `wiki-connections-{date}.md`
- [ ] Graph insights appended to `lessons.jsonl`
- [ ] No unintended entry modifications (only `related` field changed)
- [ ] Summary displayed with next-step routing
</success_criteria>
