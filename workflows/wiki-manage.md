# Wiki Manage Workflow

Unified wiki knowledge graph management — health monitoring, interactive search, orphan cleanup, and graph statistics.

Complements `wiki-connect.md` (link discovery) and `wiki-digest.md` (synthesis) with day-to-day operational tooling.

---

## Prerequisites

- `.workflow/` initialized
- Wiki entries exist
- `maestro wiki` CLI available

---

## Argument Shape

```
/manage-wiki                                   → health dashboard (default)
/manage-wiki health                            → health dashboard
/manage-wiki search auth                       → search for "auth" with follow-up actions
/manage-wiki cleanup                           → find orphans, broken links, stale entries
/manage-wiki cleanup --fix                     → auto-fix issues
/manage-wiki stats                             → graph statistics
/manage-wiki stats --type spec                 → spec-only statistics
```

| Flag | Effect |
|------|--------|
| `--type <type>` | Filter: spec, memory, note, lesson, issue |
| `--fix` | Auto-fix issues during cleanup |
| `--json` | JSON output |

---

## Subcommand: health (default)

### Step 1: Gather Data

Run in parallel:
```bash
maestro wiki health
maestro wiki list --json
maestro wiki orphans
maestro wiki hubs --top 5
```

### Step 2: Render Dashboard

```
== Wiki Health Dashboard ==
Score:       {score}/100
Entries:     {total} ({spec} spec, {memory} memory, {note} note, {lesson} lesson, {issue} issue)
Broken:      {broken_count} broken links
Orphans:     {orphan_count} entries with no connections
Top Hubs:    {hub1} ({degree}), {hub2} ({degree}), ...

{score < 50 ? "⚠ Graph needs attention" : score < 75 ? "Graph is fair" : "Graph is healthy"}

Quick actions:
  Fix connections:  /wiki-connect --fix
  Generate digest:  /wiki-digest
  Cleanup orphans:  /manage-wiki cleanup --fix
  View full graph:  maestro wiki graph
```

---

## Subcommand: search <query>

### Step 1: Execute Search

```bash
maestro wiki search "<query>" --json
```

### Step 2: Display Results

```
== Wiki Search: "{query}" ({count} results) ==

#  ID                    Type    Title                        Tags
1  spec-auth-001         spec    JWT token rotation           auth, security, jwt
2  memory-auth-flow      memory  Auth module implementation   auth, session
3  note-auth-review      note    Auth code review findings    auth, review

Actions:
  View:    maestro wiki get <id>
  Links:   maestro wiki backlinks <id>
  Follow:  /learn-follow <id>
  Connect: /wiki-connect --scope <type>
```

### Step 3: Interactive Follow-up

If not `--json`: offer to view an entry by number selection.

---

## Subcommand: cleanup

### Step 1: Scan Issues

Gather:
```bash
maestro wiki health          # baseline
maestro wiki orphans --json  # orphaned entries
maestro wiki graph           # broken links from graph structure
```

### Step 2: Categorize Issues

| Issue Type | Detection | Auto-fix Action |
|-----------|-----------|----------------|
| Broken links | Forward link target doesn't exist | Remove broken link from frontmatter |
| Orphans | No in/out links | Suggest connections via BM25 title match |
| Stale entries | No updates in 90+ days, status=draft | Flag for review |
| Empty body | Entry exists but body is empty/placeholder | Flag for review |

### Step 3: Display Issues

```
== Wiki Cleanup Scan ==
Baseline health: {score}/100

Issues found:
  Broken links:   {count}
  Orphans:        {count}
  Stale drafts:   {count}
  Empty bodies:   {count}

{list of issues with entry IDs and descriptions}
```

### Step 4: Apply Fixes (--fix only)

For each fixable issue:
1. Broken links: `maestro wiki update <id> --frontmatter '{"related": [filtered_list]}'`
2. Orphans: run mini wiki-connect for each orphan (BM25 search + tag match)
3. Stale/empty: flag but don't auto-delete (too destructive)

Report delta:
```
== Cleanup Complete ==
Fixed:     {fixed_count} issues
Remaining: {remaining_count} (manual review needed)
Health:    {old_score} → {new_score} ({delta})
```

---

## Subcommand: stats

### Step 1: Gather Data

```bash
maestro wiki list --json
```

### Step 2: Compute Statistics

- **Type distribution**: count per type (spec, memory, note, lesson, issue)
- **Tag frequency**: top 20 most-used tags
- **Category distribution**: entries per category (for specs)
- **Connectivity**: average in-degree, average out-degree, max hub size
- **Growth**: entries created per week (from timestamps)

### Step 3: Display

```
== Wiki Statistics ==

Type Distribution:
  spec      ████████████████  32 (40%)
  memory    ████████          16 (20%)
  note      ██████████        20 (25%)
  lesson    ████              8 (10%)
  issue     ██                4 (5%)
  Total:    80

Top Tags:
  auth (12), performance (8), error-handling (7), testing (6), ...

Connectivity:
  Avg in-degree:  2.3
  Avg out-degree: 1.8
  Hub:            spec-auth (in=12)

Growth (last 4 weeks):
  Week 1: +5  |  Week 2: +8  |  Week 3: +3  |  Week 4: +12
```

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | fatal | `.workflow/` not initialized | Run `/maestro-init` |
| E002 | fatal | No wiki entries found | Create wiki content first |
| E003 | error | Invalid subcommand | Valid: health, search, cleanup, stats |
| W001 | warning | Health score below 50 | Run `/wiki-connect --fix` |
| W002 | warning | Cleanup had partial failures | Retry manually |
