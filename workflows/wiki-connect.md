# Wiki Connect Workflow

Knowledge graph link discovery and health improvement. Analyzes the unified wiki index to find orphaned entries, missing connections, and transitive link gaps, then suggests or auto-applies new `related` links.

**Closed-loop**: wiki-connect improves graph → wiki-digest produces better clusters → learn-follow surfaces richer trails.

---

## Prerequisites

- `.workflow/` initialized (`.workflow/state.json` exists)
- Wiki entries exist (at least 5 for meaningful analysis)
- `maestro wiki` CLI available

---

## Argument Shape

```
/wiki-connect                                 → full graph analysis, all types
/wiki-connect --scope spec                    → limit to spec entries only
/wiki-connect --scope memory                  → limit to memory entries only
/wiki-connect --min-similarity 0.5            → raise threshold (default: 0.3)
/wiki-connect --fix                           → auto-apply top suggestions
/wiki-connect --max 10                        → limit suggestion count (default: 20)
/wiki-connect --scope spec --fix --max 5      → combined: fix top 5 spec connections
```

| Flag | Effect |
|------|--------|
| `--scope <type>` | Limit to wiki type: spec, memory, note, lesson, issue. Default: all |
| `--min-similarity N` | Minimum similarity score 0.0-1.0 (default: 0.3) |
| `--fix` | Auto-apply top suggestions via `maestro wiki update` |
| `--max N` | Maximum suggestions to generate (default: 20) |

---

## Stage 1: Load Wiki State

Run these `maestro wiki` commands in parallel to gather baseline:

```bash
maestro wiki list --json           # all entries with metadata
maestro wiki health                # composite health score
maestro wiki orphans               # entries with 0 in/out links
maestro wiki hubs --top 10         # most-referenced entries
```

Parse into working state:
- Entry count and type distribution (spec, memory, note, lesson, issue)
- Baseline health score (numeric, from health command)
- Orphan list with entry IDs and titles
- Hub list with in-degree counts

Apply `--scope` filter if provided — restrict all subsequent analysis to matching type.

---

## Stage 2: Identify Connection Candidates

For each entry, compute potential connections across four dimensions:

### 2a. Orphan Rescue
For each orphan entry:
1. `maestro wiki search "<orphan title>"` — BM25 title match
2. Tag overlap: entries sharing 2+ tags with the orphan
3. Same category: entries with matching `category` field
4. Same parent: entries sharing the same `parent` field

### 2b. Missing Bidirectional Links
Scan forward links (from `maestro wiki graph`):
- If A → B exists but B → A is missing, suggest adding reverse link
- Priority: entries where B has low in-degree (would benefit most)

### 2c. Transitive Closure
For connected pairs A → B and B → C:
- If A has no link to C, AND A and C share tags or category, suggest A → C
- Skip if distance >2 hops (avoid over-connecting)

### 2d. Type Bridge
Detect entries of different types referencing the same concept:
- e.g., `spec-auth` and `lesson-auth-gotcha` — same domain, different perspectives
- Use tag overlap + title keyword match to detect shared concepts
- Only suggest if entries are currently unlinked

---

## Stage 3: Score Candidates

For each candidate connection (source → target):

```
score = 0.4 × tag_overlap_ratio
      + 0.3 × title_bm25_similarity
      + 0.2 × same_category_bonus
      + 0.1 × type_bridge_bonus
```

- `tag_overlap_ratio`: shared_tags / max(source_tags, target_tags)
- `title_bm25_similarity`: normalized BM25 score from `maestro wiki search`
- `same_category_bonus`: 1.0 if same category, else 0.0
- `type_bridge_bonus`: 1.0 if different types, else 0.0

Filter: score >= `--min-similarity`
Sort: descending by score
Limit: top `--max` entries

---

## Stage 4: Present Suggestions

Display ranked suggestions:

```
== Wiki Connection Suggestions ==
Baseline health: 72/100 | Orphans: 8 | Broken links: 3

#  Score  Source              → Target              Reason
1  0.85   memory-auth-flow    → spec-auth           tag overlap (auth, security) + type bridge
2  0.71   note-cache-pattern  → spec-performance    title BM25 match + type bridge
3  0.65   lesson-retry-fix    → spec-error-handling  tag overlap (error, retry)
...

Projected health after fix: 81/100 (+9)
```

If NOT `--fix`: display and exit with next-step hints.
If `--fix`: proceed to Stage 5.

---

## Stage 5: Apply Connections (--fix only)

For each accepted suggestion:
1. `maestro wiki get <source-id> --json` — get current entry
2. Extract existing `related` list from frontmatter
3. Append target-id to `related` if not already present
4. `maestro wiki update <source-id> --frontmatter '{"related": ["existing...", "new-target"]}'`
5. Log success/failure per entry

After all updates:
- Re-run `maestro wiki health` → compute delta
- Report applied count, skipped count, and health improvement

---

## Stage 6: Persist & Report

1. Write `.workflow/learning/wiki-connections-{YYYY-MM-DD}.md`:
   - Baseline vs final health scores
   - All suggestions (applied and unapplied) with scores
   - Orphan rescue results
   - Graph structure observations (hub concentration, type distribution)
   
2. Append graph insights to `.workflow/learning/lessons.jsonl`:
   - `source: "wiki-connect"`, `category: "technique"`
   - e.g., "Auth entries poorly cross-referenced", "Memory entries have highest orphan rate"

3. Display summary:
```
== Wiki Connect Complete ==
Suggestions:  {total} ({applied} applied, {skipped} skipped)
Health:       {baseline} → {new} ({delta})
Report:       .workflow/learning/wiki-connections-{date}.md
```

---

## Next Steps

| Action | Command |
|--------|---------|
| Generate knowledge digest | `/wiki-digest <topic>` |
| Follow-along on orphan | `/learn-follow <wiki-id>` |
| View full graph | `maestro wiki graph` |
| Run harvest for new content | `/manage-harvest --recent 7` |

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found (empty index) | Run `/maestro-init` or create wiki content |
| E002 | error | `maestro wiki` CLI not available | Check maestro installation |
| W001 | warning | No candidates above threshold | Lower `--min-similarity` or verify graph connectivity |
| W002 | warning | Some wiki updates failed during `--fix` | Retry failed entries manually |
| W003 | warning | Health score unchanged after fix | Connections may not affect specific health metrics |
