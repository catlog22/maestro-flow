---
title: "Knowledge Harvest Guide"
---

The Maestro knowledge harvest system transforms knowledge fragments generated during execution from "session temporary files" into "persistent, searchable project assets."

---

## 1. Overview

### Knowledge Loop

Knowledge harvesting extracts fragments from execution artifacts, classifies and routes them, writes to persistent storage, and feeds back into new execution -- forming a complete knowledge loop. Three phases: **Extract** (`/manage-harvest`) -> **Route** (auto-classification engine) -> **Persist** (write to wiki/spec/issue).

### Three Knowledge Stores

| Store | Path | What It Holds | Who Consumes |
|-------|------|---------------|--------------|
| **Wiki** | `.workflow/wiki/` | Observations, general insights, knowledge graph | `/wiki-connect`, `/wiki-digest` |
| **Spec** | `.workflow/specs/` | Coding conventions, architecture decisions, pattern rules | `/spec-load`, Hook auto-injection |
| **Issue** | `.workflow/issues/issues.jsonl` | Unresolved bugs, risks, TODOs | `/manage-issue`, `/maestro-analyze --gaps` |

### Relationship with Knowhow

Harvest extracts fragments and routes them to wiki/spec/issue. Knowhow (`.workflow/knowhow/`) is an independent, complete knowledge document system created proactively via `/manage-knowhow-capture`. The two are complementary: **Harvest** = passive recovery, **Knowhow** = active capture.

---

## 2. manage-harvest Details

### Command Syntax

```bash
/manage-harvest                                      # Scan all artifacts, interactive selection
/manage-harvest <session-id>                         # Harvest specified session
/manage-harvest <path>                               # Harvest specified directory
/manage-harvest --recent 7                           # Only last 7 days
/manage-harvest --source analysis                    # Only harvest analysis artifacts
/manage-harvest <target> --to wiki                   # Force all routes to wiki
/manage-harvest <target> --dry-run                   # Preview without writing
```

### Three Modes

| Mode | Trigger Condition | Behavior |
|------|-------------------|----------|
| **scan** | No arguments | Scan all Source Registries, list harvestable artifacts, interactive selection |
| **session** | Pass session ID (e.g., `ANL-auth-20260410`, `WFS-xxx`) | Precisely locate artifacts of the specified session |
| **path** | Pass file path (e.g., `.workflow/.analysis/ANL-auth-20260410/`) | Load and extract from specified directory |

### Source Registry

| Source Type | Scan Path | Key Files |
|-------------|-----------|-----------|
| `analysis` | `.workflow/.analysis/ANL-*/` | `conclusions.json`, `*.md` |
| `brainstorm` | `.workflow/scratch/brainstorm-*/` | `guidance-specification.md` |
| `lite-plan` | `.workflow/.lite-plan/*/` | `plan.json`, `plan-overview.md` |
| `lite-fix` | `.workflow/.lite-fix/*/` | `fix-plan.json` |
| `debug` | `.workflow/.debug/*/` | `debug-log.md`, `hypothesis-*.md` |
| `scratchpad` | `.workflow/.scratchpad/` | `*.md`, `*.json` |
| `session` | `.workflow/active/WFS-*/` | `workflow-session.json` |
| `knowhow` | `.workflow/knowhow/` | `*.md`, `digest-*.md` |

Use `--source <type>` to limit scanning to a single type, `--source all` to scan all (default).

### Extraction and Classification

Each artifact source has a dedicated extraction pattern:

| Artifact Source | What Is Extracted |
|----------------|-------------------|
| analysis | findings, recommendations, risks |
| brainstorm | options, decision, trade-offs, action items |
| lite-plan | task rationale, dependencies, risks |
| lite-fix | root_cause, fix_strategy, verification |
| debug | Final diagnosis, verified hypotheses, rejected hypotheses with reasons |
| scratchpad | Markdown sections, code blocks with descriptions |
| session | completed_tasks, key_decisions, deferred_items |

Each fragment is tagged with a category label and assigned a confidence score (0.0-1.0). `--min-confidence N` (default 0.5) filters out low-quality fragments.

### Routing Classification Rules

| Category | Default Route | Rationale |
|----------|--------------|-----------|
| `finding` | wiki (note) | Observations belong in the knowledge graph |
| `decision` | wiki (spec) or spec (decision) | Architecture decisions -> spec ADR or wiki spec entry |
| `pattern` | spec (pattern) | Reusable code patterns -> coding conventions |
| `bug` | issue or spec (bug) | Active bugs -> issue; fixed bugs -> spec experience |
| `risk` | issue | Unmitigated risks -> trackable issue |
| `task` | issue | Incomplete work -> trackable issue |
| `knowhow` | wiki (knowhow) | Generalizable insights -> wiki knowledge |
| `recommendation` | wiki (note) or issue | Actionable recommendations -> issue; informational -> wiki |

Use `--to wiki|spec|issue` to force override auto-classification. `--to auto` (default) uses the rules above.

### Deduplication Logic

Before writing, a four-level deduplication check ensures idempotency:

1. **harvest-log.jsonl**: Check by `fragment_id` (`HRV-{8 hex}`)
2. **wiki**: Search by title
3. **issues.jsonl**: Match by title/description
4. **specs/learnings.md**: Match by content

Duplicate fragments are marked `[SKIP-DUP]` and recorded in the harvest report.

### Output Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| harvest log | `.workflow/harvest/harvest-log.jsonl` | Traceability record for each routed item |
| harvest report | `.workflow/harvest/harvest-report-{date}.md` | Complete report for this harvest run |
| wiki entries | `.workflow/wiki/` | Entries routed to wiki |
| spec entries | `.workflow/specs/` | Entries routed to spec |
| issue entries | `.workflow/issues/issues.jsonl` | Entries routed to issue |

---

## 3. manage-knowhow Details

### Command Syntax

```bash
/manage-knowhow                                  # List all (default)
/manage-knowhow search "auth flow"               # Full-text search
/manage-knowhow view KNW-20260510-1430           # View specified entry
/manage-knowhow edit MEMORY.md                   # Edit system memory
/manage-knowhow delete TIP-20260510-0900         # Delete (confirmation required)
/manage-knowhow prune --tag deprecated --before 2026-04-01  # Batch cleanup
```

### Dual Storage Architecture

| Storage | Path | Format | Index |
|---------|------|--------|-------|
| **workflow** | `.workflow/knowhow/` | `{PREFIX}-*.md` | `.workflow/wiki-index.json` (WikiIndexer) |
| **system** | `~/.claude/projects/{project}/memory/` | `MEMORY.md` + topic `.md` files | None (flat files) |

Workflow storage is for within-project knowledge; system storage is for cross-session persistent memory. The command automatically determines which storage to operate on based on ID prefix.

### Subcommands and Filter Flags

| Subcommand | Purpose |
|------------|---------|
| `list` | List entries (supports `--tag`, `--type`, `--store` filters) |
| `search <query>` | Full-text search, sorted by relevance |
| `view <id\|file>` | View full entry text, auto-detects storage |
| `edit <file>` | Edit system memory file |
| `delete <id\|file>` | Delete entry (confirmation required, `MEMORY.md` is protected) |
| `prune` | Batch cleanup (requires at least one filter condition, supports `--dry-run`) |

### 9 Knowhow Types

| Type | Prefix | Purpose | Typical Scenario |
|------|--------|---------|------------------|
| `session` | `KNW-` | Session state recovery | End of complex task, save progress before context switch |
| `template` | `TPL-` | Code/config templates | Extract common code patterns, save boilerplate |
| `recipe` | `RCP-` | Step-by-step guides | Document operational procedures, onboarding |
| `reference` | `REF-` | External document summaries | Import API docs, save URL summaries |
| `decision` | `DCS-` | Architecture decision records | Non-trivial design choices |
| `tip` | `TIP-` | Quick tips | Flash of insight, debugging tricks |
| `asset` | `AST-` | Code assets | API contracts, data models, prompts |
| `blueprint` | `BLP-` | Architecture blueprints | Module architecture design |
| `document` | `DOC-` | General documents | General fallback type |

---

## 4. manage-knowhow-capture Details

### Command Syntax

```bash
/manage-knowhow-capture compact "Auth module dev progress"       # Session compression
/manage-knowhow-capture template                       # Interactive template entry
/manage-knowhow-capture recipe "Deployment process"                # Operation recipe
/manage-knowhow-capture reference --source https://...  # External document summary
/manage-knowhow-capture decision                       # Architecture decision record
/manage-knowhow-capture tip "TypeScript generic inference pitfall"    # Quick tip
/manage-knowhow-capture                                # Interactive selection (9 types)
```

### Capture Timing

| Timing | Recommended Type |
|--------|-----------------|
| End of complex task | `compact` / `session` |
| Discovering reusable code pattern | `template` |
| Completing an operational procedure | `recipe` |
| Reviewing important external docs | `reference` |
| Making architecture decision | `decision` |
| Flash of insight or trick | `tip` |
| Defining interface contracts | `asset` |
| Designing module architecture | `blueprint` |

### Output Path and Naming Convention

Files are written to `.workflow/knowhow/` with the naming format `{PREFIX}-{YYYYMMDD}-{HHMM}.md`, with YAML frontmatter (title, type, category, created, tags).

### Type Routing

The command supports automatic type recognition via tokens:

| Token | Type |
|-------|------|
| `compact`, `session` | session |
| `template`, `tpl` | template |
| `recipe`, `rcp` | recipe |
| `reference`, `ref` | reference |
| `decision`, `dcs`, `adr` | decision |
| `tip`, `note` | tip |
| `asset`, `ast` | asset |
| `blueprint`, `blp` | blueprint |
| `document`, `doc` | document |

---

## 5. Knowledge Flow Overview

<details>
<summary>Complete process diagram</summary>

```
+----------------------------------------------------------+
|                     Execution Phase                       |
|  maestro-analyze -> maestro-plan -> maestro-execute      |
|       |              |                |                  |
|   ANL-xxx/       plan-xxx/       code changes            |
|   brainstorm/    lite-plan/      debug-log/              |
+------------+---------------------------------------------+
             |
             v
+----------------------------------------------------------+
|                  Knowledge Harvest                        |
|  /manage-harvest                                         |
|  |-- Stage 1-2: Discover artifacts                       |
|  |-- Stage 3:   Extract fragments (category+confidence)  |
|  |-- Stage 4:   Classify and route (auto / forced)       |
|  |-- Stage 5:   Preview and confirm                      |
|  |-- Stage 6:   Write to target storage + deduplicate    |
|  +-- Stage 7-8: Deduplication check + generate report    |
+----+----------+----------+-------------------------------+
     |          |          |
     v          v          v
  +------+  +------+  +--------+
  | Wiki |  | Spec |  | Issue  |
  +--+---+  +--+---+  +---+----+
     |         |          |
     v         v          v
+----------------------------------------------------------+
|                   Downstream Consumption                  |
|  wiki-connect / wiki-digest / spec-load / manage-issue   |
|  Hook auto-injection / maestro-plan --gaps               |
+----------------------------------------------------------+
```
</details>

### Active Knowledge Capture Parallel Path

```
Execution process -> /manage-knowhow-capture -> .workflow/knowhow/ -> wiki-index.json -> retrieval and reuse
```

### Collaboration with learn-* Commands

| Command | Output | Routed To |
|---------|--------|-----------|
| `/learn-retro` | Git activity review, decision review | `specs/learnings.md` (`<spec-entry>`) |
| `/learn-decompose` | Task decomposition experience | knowhow (recipe) |
| `/learn-investigate` | Investigation process records | knowhow (reference / tip) |
| `/learn-follow` | Follow-up learning records | knowhow (reference) |
| `/learn-second-opinion` | Multi-perspective analysis results | wiki / spec |

### Recommended Workflow

| Scenario | Steps |
|----------|-------|
| **Daily Development** | `/maestro-execute` -> quick note on completion -> `/manage-knowhow-capture tip "discovered trick"` |
| **Milestone Completion** | `/manage-harvest --recent 30` -> `/manage-knowhow-capture compact` -> `/wiki-connect --fix` |
| **Project Handoff** | `/manage-knowhow list` -> `/manage-knowhow search "core concept"` -> `/spec-load --role implement` |
