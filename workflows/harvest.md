# Harvest Workflow

Extract knowledge from workflow artifacts and route into wiki / spec / issue stores.

Unlike `retrospective.md` which is phase-scoped and post-execution, harvest operates on **any workflow session artifact** — analysis results, brainstorm outputs, debug sessions, lite-plan/fix results, scratchpad notes, and completed workflow sessions.

---

## Prerequisites

- `.workflow/` initialized (`.workflow/state.json` exists)
- At least one artifact source present (analysis, brainstorm, debug, lite-plan, lite-fix, scratchpad, or active session)
- For wiki routing: `maestro wiki` CLI available

---

## Argument Shape

```
/manage-harvest                                      → scan all sources, interactive selection
/manage-harvest <session-id>                         → harvest specific session (ANL-*, WFS-*, etc.)
/manage-harvest <path>                               → harvest from explicit directory or file
/manage-harvest --recent 7                           → harvest from artifacts updated in last 7 days
/manage-harvest --source analysis                    → harvest only from analysis sessions
/manage-harvest <target> --to wiki                   → force all findings to wiki
/manage-harvest <target> --to spec                   → force all findings to spec
/manage-harvest <target> --to issue                  → force all findings to issue
/manage-harvest <target> --to auto                   → auto-classify routing (default)
/manage-harvest <target> --dry-run                   → preview without writing
```

| Flag | Effect |
|------|--------|
| `--to <target>` | Force routing target: `wiki`, `spec`, `issue`, `auto` (default: auto) |
| `--source <type>` | Filter by source type: `analysis`, `brainstorm`, `debug`, `lite-plan`, `lite-fix`, `scratchpad`, `session`, `all` |
| `--recent N` | Only scan artifacts updated within last N days (default: 30) |
| `--dry-run` | Preview extracted items without writing to any store |
| `-y` / `--yes` | Skip confirmation prompts, accept all routing |
| `--min-confidence N` | Minimum extraction confidence 0.0-1.0 (default: 0.5) |

---

## Stage 1: parse_input

```
1. Verify .workflow/ exists; else error E001.
2. Tokenize $ARGUMENTS:
   - First non-flag token: session ID, path, or empty (scan mode)
   - Flags: --to, --source, --recent, --dry-run, -y, --min-confidence
3. Build:
     mode = "scan" | "session" | "path"
     target_filter = "auto" | "wiki" | "spec" | "issue"
     source_filter = "all" | specific source type
     recent_days = 30 (or --recent value)
     dry_run = false
     auto_yes = false
     min_confidence = 0.5
4. Validate --to value. Unknown target → error E002.
5. Validate --source value. Unknown source → error E003.
```

---

## Stage 2: discover_artifacts

Scan `.workflow/` for harvestable artifacts. Each source type has a known structure:

### Source Registry

| Source Type | Scan Path | Key Files | ID Pattern |
|-------------|-----------|-----------|------------|
| `analysis` | `.workflow/.analysis/ANL-*/` | `conclusions.json`, `*.md` | `ANL-*` |
| `brainstorm` | `.workflow/scratch/brainstorm-*/` | `guidance-specification.md`, `brainstorm-*.md` | directory name |
| `lite-plan` | `.workflow/.lite-plan/*/` | `plan.json`, `plan-overview.md` | directory name |
| `lite-fix` | `.workflow/.lite-fix/*/` | `fix-plan.json` | directory name |
| `debug` | `.workflow/.debug/*/` | `debug-log.md`, `hypothesis-*.md` | directory name |
| `scratchpad` | `.workflow/.scratchpad/` | `*.md`, `*.json` | filename |
| `session` | `.workflow/active/WFS-*/` | `workflow-session.json` | `WFS-*` |
| `learning` | `.workflow/learning/` | `lessons.jsonl`, `digest-*.md`, `*.md` | filename |

```
candidates = []
FOR each source_type in source_registry:
  IF source_filter != "all" AND source_filter != source_type: SKIP
  Glob for directories/files matching scan_path
  FOR each match:
    stat = file modification time
    IF stat.mtime < (now - recent_days): SKIP
    Read key files, extract:
      - session_id or directory name
      - title (from JSON title field or markdown H1)
      - created_at / updated_at
      - summary (first paragraph or JSON summary field)
      - file_count (number of artifact files)
    candidates.push({ source_type, id, path, title, updated_at, summary, file_count })
```

### Display candidates

```
=== HARVESTABLE ARTIFACTS ===

  #  Source       ID                    Title                    Updated       Files
  ─  ──────────  ────────────────────  ─────────────────────── ────────────  ─────
  1  analysis    ANL-auth-20260410     Auth vulnerability scan  2026-04-10      4
  2  brainstorm  brainstorm-cache      Cache strategy options   2026-04-08      3
  3  lite-fix    rate-limit-20260405   Rate limiter edge case   2026-04-05      2
  4  debug       debug-memory-leak     Memory leak in worker    2026-04-03      5

  Found: 4 artifacts (filtered by: last 30 days)
```

### Selection logic

| Mode | Action |
|------|--------|
| `scan`, 0 candidates | Print "No harvestable artifacts found", exit 0 |
| `scan`, ≥1 candidates | AskUserQuestion: select one, multiple (comma-separated), or "all" |
| `session` | Find matching session ID in candidates; error E004 if not found |
| `path` | Validate path exists; auto-detect source type from structure |

---

## Stage 3: load_and_extract (per selected artifact)

For each selected artifact, load all files and extract knowledge fragments.

### 3a. Load artifact content

Read all relevant files in the artifact directory. Build a content bundle:

```
bundle = {
  source_type: "analysis" | "brainstorm" | ...,
  id: session_id,
  path: artifact_directory,
  files: [{ name, content, type: "json"|"md" }],
  metadata: extracted from key files (conclusions.json, plan.json, etc.)
}
```

### 3b. Extract knowledge fragments

Parse content to identify discrete knowledge items. Each source type has specific extraction patterns:

**Analysis (`conclusions.json` + markdown):**
- `findings[]` → each finding is a fragment
- `recommendations[]` → each recommendation is a fragment
- `risks[]` → each risk is a fragment
- Markdown sections with `## ` headings → section-level fragments

**Brainstorm (`guidance-specification.md` + notes):**
- `## Options` or `## Approaches` → each option is a fragment
- `## Decision` or `## Recommendation` → decision fragment
- `## Trade-offs` → trade-off fragments
- Action items (lines starting with `- [ ]` or `TODO`) → task fragments

**Lite-plan (`plan.json`):**
- `tasks[]` → each with rationale → decision fragments
- `dependencies[]` → architectural constraint fragments
- `risks[]` → risk fragments

**Lite-fix (`fix-plan.json`):**
- `root_cause` → bug fragment
- `fix_strategy` → pattern fragment
- `verification` → test/validation fragment

**Debug (`debug-log.md`, `hypothesis-*.md`):**
- Final diagnosis → bug fragment
- Verified hypothesis → pattern/lesson fragment
- Rejected hypotheses with reasoning → lesson fragment

**Scratchpad (*.md):**
- Markdown sections → generic fragments
- Code blocks with explanations → pattern fragments

**Session (`workflow-session.json`):**
- `completed_tasks[].summary` → pattern/decision fragments
- `key_decisions[]` → decision fragments
- `deferred_items[]` → issue fragments

**Learning (`lessons.jsonl`):**
- Each lesson line → lesson fragment (check if already routed to wiki/spec/issue)

Each fragment gets:
```
fragment = {
  id: "HRV-{8 hex}" from hash(source_id + content_hash),
  source_type: ...,
  source_id: ...,
  title: extracted or inferred,
  content: raw text,
  tags: extracted from context,
  category: "finding" | "decision" | "pattern" | "bug" | "risk" | "task" | "lesson" | "recommendation",
  confidence: 0.0-1.0 (based on specificity and actionability)
}
```

Filter by `--min-confidence`.

---

## Stage 4: classify_routing

For each fragment, determine the best routing target (unless `--to` forces a specific target).

### Classification Rules

| Category | Default Target | Rationale |
|----------|---------------|-----------|
| `finding` | wiki (note) | Observations go to knowledge graph |
| `decision` | wiki (spec) or spec (decision) | Architectural decisions → spec ADR or wiki spec entry |
| `pattern` | spec (pattern) | Reusable code patterns → coding conventions |
| `bug` | issue or spec (bug) | Active bugs → issue; fixed bugs → spec learnings |
| `risk` | issue | Unmitigated risks → trackable issues |
| `task` | issue | Unfinished work → trackable issues |
| `lesson` | wiki (lesson) | Generalizable insights → wiki knowledge |
| `recommendation` | wiki (note) or issue | Actionable recommendations → issue; informational → wiki |

### Override with `--to`

If `--to wiki`: all fragments → wiki entries
If `--to spec`: all fragments → spec entries
If `--to issue`: all fragments → issue entries
If `--to auto`: use classification rules above

### Build routing plan

```
routing_plan = {
  wiki: [{ fragment, wiki_type, slug, title, tags, body }],
  spec: [{ fragment, spec_type, content }],
  issue: [{ fragment, title, severity, description }]
}
```

---

## Stage 5: preview_and_confirm

Display the routing plan:

```
=== HARVEST PLAN ===
Source: ANL-auth-20260410 (analysis)
Fragments extracted: 8 (filtered from 12 by confidence ≥ 0.5)

  → Wiki (3 entries):
    [note]   "SQL injection vector in user input"     tags: security, sql
    [lesson] "Parameterized queries prevent injection" tags: security, pattern
    [spec]   "Auth token rotation policy"              tags: auth, security

  → Spec (2 entries):
    [pattern] "Always use parameterized queries for user input"
    [decision] "JWT refresh tokens over session cookies"

  → Issue (3 entries):
    [high]   "Unvalidated redirect in OAuth callback"
    [medium] "Missing rate limit on token refresh endpoint"
    [low]    "Inconsistent error messages leak internal state"

  Total: 3 wiki + 2 spec + 3 issue = 8 routed items
```

If `--dry-run`: display and exit.
If NOT `--dry-run` AND NOT `-y`:
  AskUserQuestion: "Apply this routing plan? (yes/edit/skip)" with options.
  - `edit`: re-display with per-item accept/reject
  - `skip`: exit without writing

---

## Stage 6: route_outputs

Execute the routing plan. Each target uses existing infrastructure:

### 6a. Wiki routing

For each wiki item:
```bash
maestro wiki create --type <wiki_type> --slug harvest-<source_type>-<short_id> \
  --title "<title>" --tags "<tags>" --body "<body>"
```

Wiki types mapping:
- `note` → `--type note`
- `lesson` → `--type lesson`
- `spec` → `--type spec`

If `maestro wiki create` fails, fall back to writing `.workflow/harvest/wiki-pending-{id}.md` with frontmatter.

### 6b. Spec routing

For each spec item, use the same mechanism as `quality-retrospective` Stage 6:

```
Skill({ skill: "spec-add", args: "<spec_type> <content>" })
```

Where `spec_type` maps from fragment category:
- `pattern` → `pattern`
- `decision` → `decision`
- `bug` → `bug`
- `lesson` → `rule` (if it prescribes a rule)

### 6c. Issue routing

For each issue item, append to `.workflow/issues/issues.jsonl` using the canonical schema from `workflows/issue.md`:

```json
{
  "id": "ISS-{YYYYMMDD}-{NNN}",
  "title": "<title>",
  "description": "<description>",
  "severity": "<high|medium|low>",
  "status": "open",
  "source": "harvest",
  "source_ref": "<source_id>",
  "tags": [],
  "created_at": "<ISO timestamp>",
  "issue_history": [{ "action": "created", "timestamp": "<ISO>", "by": "harvest", "detail": "Extracted from <source_type> <source_id>" }]
}
```

### 6d. Track harvest provenance

For each routed item, record in `.workflow/harvest/harvest-log.jsonl`:

```json
{
  "fragment_id": "HRV-...",
  "source_type": "analysis",
  "source_id": "ANL-auth-20260410",
  "routed_to": "wiki|spec|issue",
  "target_id": "note-harvest-analysis-abc123|ISS-20260413-001|...",
  "timestamp": "<ISO>",
  "title": "<title>",
  "confidence": 0.85
}
```

This log prevents duplicate harvesting in future runs.

---

## Stage 7: dedup_check

Before writing any item in Stage 6, check for duplicates:

1. **harvest-log.jsonl**: Has this fragment_id already been routed?
2. **Wiki**: `maestro wiki search "<title>"` — does a similar entry exist?
3. **Issues**: Search `issues.jsonl` for matching title/description
4. **Specs**: Search `learnings.md` for similar content

If duplicate found:
- Skip with `[SKIP-DUP]` marker
- Log to harvest report

---

## Stage 8: report

Write `.workflow/harvest/harvest-report-{date}.md`:

```markdown
# Harvest Report — {date}

## Source
- Type: {source_type}
- ID: {source_id}
- Path: {path}

## Extraction Summary
- Fragments found: {total}
- Filtered by confidence: {filtered_count}
- Duplicates skipped: {dup_count}

## Routing Results

### Wiki ({N} entries)
| # | Type | Slug | Title | Status |
|---|------|------|-------|--------|
| 1 | note | harvest-analysis-abc | SQL injection vector | CREATED |
| 2 | lesson | harvest-analysis-def | Parameterized queries | CREATED |

### Spec ({N} entries)
| # | Type | Content (truncated) | Status |
|---|------|---------------------|--------|
| 1 | pattern | Always use parameterized queries... | ADDED |

### Issue ({N} entries)
| # | Severity | Title | ID | Status |
|---|----------|-------|-----|--------|
| 1 | high | Unvalidated redirect in OAuth... | ISS-20260413-001 | CREATED |

## Skipped
| Fragment | Reason |
|----------|--------|
| HRV-abc123 | Duplicate: existing wiki entry note-sql-injection |
```

Display summary:

```
=== HARVEST COMPLETE ===
Source: ANL-auth-20260410 (analysis)

  Wiki:  3 created, 0 skipped
  Spec:  2 added, 0 skipped
  Issue: 3 created, 1 skipped (dup)

  Report: .workflow/harvest/harvest-report-2026-04-13.md
  Log:    .workflow/harvest/harvest-log.jsonl

Next:
  → Review wiki entries: maestro wiki list --type note
  → Triage issues: Skill({ skill: "manage-issue", args: "list --source harvest" })
  → Connect wiki graph: Skill({ skill: "wiki-connect", args: "--fix" })
  → View specs: Skill({ skill: "spec-load", args: "--category general" })
```
