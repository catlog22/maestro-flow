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

Run in parallel: `maestro wiki health`, `list --json`, `orphans`, `hubs --top 5`.

### Step 2: Render Dashboard

Display: health score, entry counts by type, broken links, orphan count, top hubs. Include health status message and quick-action commands (`/wiki-connect --fix`, `/wiki-digest`, `/manage-wiki cleanup --fix`, `maestro wiki graph`).

---

## Subcommand: search <query>

### Step 1: Execute Search

```bash
maestro wiki search "<query>" --json
```

### Step 2: Display Results

Show table of results (ID, type, title, tags) with action hints: `maestro wiki get <id>`, `backlinks <id>`, `/learn-follow <id>`, `/wiki-connect --scope <type>`.

### Step 3: Interactive Follow-up

If not `--json`: offer to view an entry by number selection.

---

## Subcommand: cleanup

### Step 1: Scan Issues

Gather baseline via `maestro wiki health`, `orphans --json`, `graph`.

### Step 2: Categorize Issues

| Issue Type | Detection | Auto-fix Action |
|-----------|-----------|----------------|
| Broken links | Forward link target doesn't exist | Remove broken link from frontmatter |
| Orphans | No in/out links | Suggest connections via BM25 title match |
| Stale entries | No updates in 90+ days, status=draft | Flag for review |
| Empty body | Entry exists but body is empty/placeholder | Flag for review |

### Step 3: Display Issues

Show baseline health, issue counts by type, and entry-level details.

### Step 4: Apply Fixes (--fix only)

Broken links: remove from frontmatter via `maestro wiki update`. Orphans: mini wiki-connect (BM25 + tag match). Stale/empty: flag only (no auto-delete).

Report: fixed count, remaining count, health delta.

---

## Subcommand: stats

### Step 1: Gather Data

```bash
maestro wiki list --json
```

### Step 2: Compute & Display Statistics

Compute: type distribution (count/%), top 20 tags, category distribution (specs), connectivity (avg in/out-degree, max hub), growth (entries/week).

Display as bar charts and summary tables.

