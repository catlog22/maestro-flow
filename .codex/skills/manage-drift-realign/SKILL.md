---
name: manage-drift-realign
description: Detect and realign .workflow/ artifact drift against code reality after refactoring
argument-hint: "[-y|--yes] [-c|--concurrency 4] [--continue] \"--scope <all|roadmap|spec|codebase|state|issue|knowhow|project> [--since YYYY-MM-DD|commit|HEAD~N] [--depth shallow|deep] [--dry-run] [--report] [--auto-archive]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Detect divergence between code reality and `.workflow/` artifacts (roadmap, specs, codebase docs, state, issues, knowhow, project.md) after major refactoring + incremental changes. Reconstructs git + session timeline, runs 4 parallel drift scanners via CSV-wave, then proposes realignment actions.

Complementary to `manage-knowledge-audit` (internal contradictions within knowledge stores) — this skill detects **code ↔ document** drift.

**Core workflow**: Timeline Reconstruction → Drift Score → Parallel Scan (4 agents) → Triage → Apply

**Topology**: Single-wave parallel (4 independent scanners)

```
+--------------------------------------------------------------------------+
|                    DRIFT REALIGN CSV WAVE WORKFLOW                        |
+--------------------------------------------------------------------------+
|                                                                          |
|  Phase 1: Setup + Timeline                                               |
|     +-- Validate .workflow/ exists, parse arguments                      |
|     +-- Run maestro timeline --since <date> --json → timeline.json       |
|     +-- Compute drift_score (LOW / MODERATE / SEVERE)                    |
|     +-- Platform inquiry: ask user which platform to focus (if multi)    |
|     +-- Generate tasks.csv with 4 scanner tasks (all wave 1)             |
|                                                                          |
|  Phase 2: Wave Execution (Single Wave)                                   |
|     +-- Wave 1: 4 scanners run concurrently                             |
|     |   +-- roadmap-scanner                                              |
|     |   +-- spec-scanner                                                 |
|     |   +-- codebase-scanner                                             |
|     |   +-- artifact-scanner                                             |
|     +-- discoveries.ndjson shared (append-only)                          |
|                                                                          |
|  Phase 3: Synthesize + Triage                                            |
|     +-- Merge findings, dedup, sort by P0 > P1 > P2                     |
|     +-- Merge existing conflict-markers from maestro spec conflict list  |
|     +-- Interactive triage (or --auto-archive / --report / --dry-run)    |
|                                                                          |
|  Phase 4: Apply + Report                                                 |
|     +-- Backup to .trash/, apply actions, auto-rebuild if needed         |
|     +-- Update state.json (last_drift_realign)                           |
|     +-- Generate drift-report + drift-log.jsonl                          |
|                                                                          |
+--------------------------------------------------------------------------+
```

</purpose>

<context>
$ARGUMENTS -- optional flags for drift realign control.

**Usage**:

```bash
$manage-drift-realign ""
$manage-drift-realign -y "--scope all --since 2026-04-01"
$manage-drift-realign -c 4 "--scope spec --depth deep"
$manage-drift-realign -y "--scope codebase --auto-archive"
$manage-drift-realign "" "--scope all --report"
$manage-drift-realign "" "--scope all --dry-run"
$manage-drift-realign --continue "20260624-drift-realign"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent scanner agents (default: 4)
- `--continue`: Resume existing session

**Inner flags** (passed inside quotes):
- `--scope <type>`: roadmap / spec / codebase / state / issue / knowhow / project / all (default: all)
- `--since <date|commit|HEAD~N>`: Analysis starting point (default: auto-detect from state.json)
- `--depth <shallow|deep>`: shallow = mtime + reference check; deep = LLM semantic analysis (default: shallow)
- `--dry-run`: Full preview, no writes
- `--report`: Generate report only, skip triage
- `--auto-archive`: Auto-apply suggested actions for P1/P2, only P0 gets interactive review

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` + `results.csv` + `discoveries.ndjson` + `context.md`
**Report Output**: `.workflow/.drift-realign/drift-report-{date}.md` + `drift-log.jsonl`

**State files read**:
- `.workflow/state.json` — project state + artifact registry
- `.workflow/roadmap.md` — milestone/phase roadmap
- `.workflow/specs/*.md` — spec entries
- `.workflow/codebase/*.md` — codebase docs (architecture, features, tech-stack, concerns)
- `.workflow/codebase/doc-index.json` — documentation index
- `.workflow/issues/issues.jsonl` — issue tracking
- `.workflow/knowhow/*.md` — knowledge documents
- `.workflow/project.md` — project definition
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,scan_scope,output_format,deps,context_from,wave
"1","Roadmap Scanner","Scan .workflow/roadmap.md and .workflow/state.json for drift against code reality. Read timeline.json for git change context. Detect: phantom_phase (P0), stale_progress (P1), milestone_mismatch (P0), outdated_criteria (P1), dependency_ghost (P1), timeline_impossible (P2). For each finding: verify against code/state.json before reporting. Return JSON array of DriftFinding objects via output_schema.","roadmap","json","","","1"
"2","Spec Scanner","Scan .workflow/specs/*.md spec-entry blocks for drift against actual code patterns. Read timeline.json hot_paths to focus on high-change areas. Detect: convention_violation (P0), dead_import_pattern (P1), architecture_breach (P0), stale_dependency (P1), naming_drift (P2), test_convention_gap (P2). {DEPTH_INSTRUCTION}. Return JSON array of DriftFinding objects via output_schema.","spec","json","","","1"
"3","Codebase Scanner","Scan .workflow/codebase/*.md and doc-index.json for drift against current code structure. Read timeline.json for git changes. Detect: architecture_outdated (P0), feature_missing (P1), tech_stack_changed (P0), concern_drift (P1), doc_index_stale (P0). {DEPTH_INSTRUCTION}. Return JSON array of DriftFinding objects via output_schema.","codebase","json","","","1"
"4","Artifact Scanner","Scan .workflow/issues/issues.jsonl, .workflow/knowhow/*.md, .workflow/project.md, and state.json accumulated_context for drift. Read timeline.json for git context. Detect: issue_code_ref_dead (P1), issue_stale_open (P1), knowhow_code_ref_dead (P1), orphan_session (P2), project_tech_drift (P0), project_req_drift (P1), accumulated_stale (P1), deferred_resolved (P2). Return JSON array of DriftFinding objects via output_schema.","artifact","json","","","1"
```

**Substitutions (orchestrator MUST do BEFORE writing tasks.csv)**:
- `{DEPTH_INSTRUCTION}`: If `--depth shallow` → "Use file existence checks and grep pattern matching only. Do NOT make LLM-based semantic judgments." If `--depth deep` → "Use LLM semantic analysis: read spec/doc content alongside code samples from hot_paths and judge alignment."

**Columns**:

| Column | Description |
|--------|-------------|
| `id` | Scanner identifier (1-4) |
| `title` | Scanner name |
| `description` | Detailed scan instructions with drift type definitions |
| `scan_scope` | roadmap / spec / codebase / artifact |
| `output_format` | Always "json" |
| `deps` | Empty (all independent) |
| `context_from` | Empty (all read timeline.json directly) |
| `wave` | Always 1 (single wave) |

**Output columns** (returned exclusively via `output_schema`):

| Column | Description |
|--------|-------------|
| `result_status` | `completed` / `failed` |
| `result_findings` | JSON array of DriftFinding objects (stringified) |
| `error` | Error message if failed |

### DriftFinding Schema (per finding in result_findings array)

```json
{
  "id": "DFT-{8hex}",
  "scope": "roadmap|spec|codebase|state|issue|knowhow|project",
  "severity": "P0|P1|P2",
  "target": { "file": "string", "section": "string (optional)" },
  "drift_type": "string (one of the defined types per scanner)",
  "evidence": {
    "code_reality": "string (what code actually shows)",
    "doc_claim": "string (what the document claims)",
    "git_ref": "string (commit reference, optional)"
  },
  "suggested_action": "keep|update|archive|rebuild",
  "update_hint": "string (specific update suggestion, optional)"
}
```

</csv_schema>

<invariants>
1. **Code-as-Truth**: Code is the single source of truth. When doc says X but code does Y, the doc is drifted.
2. **Start Immediately**: First action is session init, then Phase 1.
3. **CSV is Source of Truth**: tasks.csv holds all scanner state.
4. **Discovery Board is Append-Only**: Scanners share findings via NDJSON.
5. **Partial Results OK**: If 3/4 scanners succeed, proceed with available findings.
6. **Backup Before Mutate**: Phase 4 backup MUST succeed before any file mutations.
7. **No Auto-Delete**: Archive moves to .trash/, never physically deletes.
8. **Rebuild is Scoped**: Auto-rebuild only triggers for codebase scope (/quality-sync --full).
9. **Timeline as Shared Context**: All scanners read timeline.json — orchestrator writes it BEFORE generating tasks.csv.
10. **DO NOT STOP**: Execute until all scanners complete or fail, then proceed through triage and apply.
</invariants>

<execution>

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state — 4 scanner tasks | Updated after wave |
| `wave-1.csv` | Wave input (temporary) | Created before wave, deleted after |
| `wave-1-results.csv` | Wave output | Created by spawn_agents_on_csv |
| `results.csv` | Final export | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only during wave |
| `context.md` | Human-readable report | Created in Phase 4 |
| `timeline.json` | Git + session timeline | Created in Phase 1 |

### Session Initialization

Parse `$ARGUMENTS` to extract:
- `AUTO_YES` from `--yes` / `-y`
- `continueMode` from `--continue`
- `maxConcurrency` from `--concurrency N` / `-c N` (default: 4)
- Inner flags: `scope`, `since`, `depth`, `dryRun`, `reportOnly`, `autoArchive`

Session ID: `{YYYYMMDD}-drift-realign`
Session folder: `.workflow/.csv-wave/{sessionId}/` — create via `mkdir -p`

### Phase 1: Setup + Timeline

**Step 1.1: Validate**
- `.workflow/state.json` exists — abort with E001 if missing
- git available — abort with E003 if not a git repo

**Step 1.2: Resolve --since**
1. Explicit `--since` value → parse as date/commit/HEAD~N
2. `state.json.last_drift_realign` → use that timestamp
3. `state.json.last_pruned` → use that timestamp
4. Fallback → 90 days ago

**Step 1.3: Build timeline**
```bash
maestro timeline --since <resolved_date> --json --output <sessionFolder>/timeline.json
```
If command fails, fallback to inline git log + session load.
Parse timeline.json to extract: `window`, `git_summary`, `session_summary`, `hot_paths`, `cold_workflow_files`.

**Step 1.4: Compute drift score**
```
drift_score = drift_window_days × sqrt(changed_files_count) × scope_weight
changed_files_count = |Set(git_files) ∪ Set(session_edited_files)|

scope_weight: roadmap=1.5, project=1.4, spec=1.3, state=1.2, codebase=1.0, issue=0.8, knowhow=0.7
(scope=all: weighted average)

Thresholds:
  LOW:      score < 30
  MODERATE: 30 ≤ score < 100
  SEVERE:   score ≥ 100 → auto-upgrade to --depth deep
  drift_window > 180 days → force --depth deep + W002
```

Display drift summary to user.

**Step 1.5: Platform inquiry (interactive)**
If `session_summary.by_platform` has multiple platforms AND total sessions > 20 AND NOT AUTO_YES:
- Use `request_user_input` to ask: "Multiple session platforms detected. Focus on a specific platform?"
- Options: All / Claude / Codex
- If specific platform chosen: re-run `maestro timeline --platform <choice> --since <date> --json --output ...`

**Step 1.6: Generate tasks.csv**
- 4 rows (scanners), all wave 1, no dependencies
- Substitute `{DEPTH_INSTRUCTION}` based on resolved depth
- If `--scope` is not "all", generate only the matching scanner task(s)
- User validation: display scanner breakdown (skip if AUTO_YES)

### Phase 2: Wave Execution (Single Wave)

Filter master `tasks.csv` for `wave == 1 AND status == pending` → write `wave-1.csv`.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: SCANNER_INSTRUCTION,
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:              { type: "string" },
      result_status:   { type: "string", enum: ["completed", "failed"] },
      result_findings: { type: "string", description: "JSON array of DriftFinding objects" },
      error:           { type: "string" }
    },
    required: ["id", "result_status", "result_findings"]
  }
})
```

Merge `wave-1-results.csv` into master `tasks.csv`. Delete temporary wave files.

#### Scanner Worker Contract (SCANNER_INSTRUCTION)

```
You are a drift scanner for ONE scope (roadmap / spec / codebase / artifact). Your task is to detect divergence between .workflow/ documentation and actual code reality.

CORE PRINCIPLE: Code is ALWAYS right. When code and documentation disagree, the DOCUMENT is drifted.

REQUIRED STEPS:
  1. Read {sessionFolder}/timeline.json for git change context (hot_paths, cold_workflow_files, events)
  2. Read the .workflow/ files specified in your description
  3. For each drift type in your description, run the detection algorithm:
     - shallow: file existence checks, grep pattern matching, path verification
     - deep: read code samples + doc content, make semantic alignment judgments
  4. For each detected drift, construct a DriftFinding JSON object with evidence
  5. Append significant discoveries to {sessionFolder}/discoveries.ndjson
  6. Call report_agent_job_result EXACTLY ONCE

OUTPUT (must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "result_findings": "<JSON array of DriftFinding objects, stringified>",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Do NOT modify any .workflow/ files (read-only scan)
  - Do NOT write to tasks.csv, wave-*.csv, results.csv
  - Do NOT call spawn_agents_on_csv (no recursion)
  - NEVER report a finding without evidence (code_reality + doc_claim fields required)
```

### Phase 3: Synthesize + Triage

**Step 3.1: Merge findings**
- Parse `result_findings` from each scanner (JSON arrays of DriftFinding)
- Dedup: same file + section → keep highest severity
- Sort: P0 first, then P1, then P2
- Filter by `--scope` if not "all"

**Step 3.2: Conflict-marker integration**
```bash
maestro spec conflict list
```
For spec entries with existing conflict-markers that also appear in scanner findings: merge and elevate to P0.

**Step 3.3: Triage**
- If `--report` → skip to Phase 4 report
- If `--dry-run` → display all findings with suggested actions, skip Phase 4 apply
- If `--auto-archive` → auto-apply each finding's `suggested_action` for P1/P2; only P0 gets interactive review
- Otherwise → interactive triage per finding using `request_user_input`:

```
[!] Drift Detected (P0 - architecture_outdated)
Scope:    codebase
Target:   .workflow/codebase/architecture.md §Module Boundaries
Evidence:
  Doc claims: "Three-layer architecture: api/, service/, db/"
  Code reality: New src/payments/ module added, not described
  Git ref: commit abc123 (2026-06-10)
Hint: Add Payments module section
Suggestion: update
```

Actions: keep / update / archive / rebuild / skip

| Action | Behavior |
|--------|----------|
| keep | Confirmed no drift, log as reviewed |
| update | Inject `<!-- DRIFT-TODO: {hint} (DFT-{id}) -->` at file top |
| archive | Move to .trash/ |
| rebuild | Mark for auto-rebuild (codebase → $quality-sync --full) |
| skip | Skip without decision, will reappear on next run |

Export master `tasks.csv` as `results.csv`.

### Phase 4: Apply + Report

**Step 4.1: Backup**
```bash
mkdir -p .workflow/.trash/drift-realign-{timestamp}/
```
Copy all affected files + state.json to backup. If backup fails → abort (E005).

**Step 4.2: Apply actions**

| Action | Implementation |
|--------|---------------|
| keep | Write drift-log.jsonl entry (action=keep) |
| skip | Write drift-log.jsonl entry (action=skipped) |
| update | Prepend `<!-- DRIFT-TODO: {hint} (DFT-{id}, {date}) -->` to target file |
| archive | Move file to `.trash/{timestamp}/`, update state.json refs |
| rebuild | Collect targets; after all other actions: invoke $quality-sync --full |

After rebuild: if sync reports major structural changes → suggest $manage-codebase-rebuild.

Conflict-marker cleanup: for update/archive targets with existing conflict-markers:
```bash
maestro spec conflict clear <file> <line>
```

Update state.json: `last_drift_realign = now` (atomic: backup → write → verify).

**Step 4.3: Generate report**

Write `.workflow/.drift-realign/drift-report-{date}.md`:

```markdown
# Drift Realign Report — {date}

## Timeline Window
- From: {from} → To: {to} ({days} days)
- Git: {commits} commits, {files_changed} files (+{ins}/-{del})
- Sessions: {total} total, {with_edits} with edits ({platform breakdown})
- Drift Score: {score} ({LOW|MODERATE|SEVERE})

## Scan Summary
- Total findings: {N} ({P0} P0 / {P1} P1 / {P2} P2)
- By scope: roadmap {N} / spec {N} / codebase {N} / artifact {N}

## Actions Applied
| # | Scope | Drift Type | Target | Severity | Action | Status |
|---|-------|-----------|--------|----------|--------|--------|

## Backup
- Location: .workflow/.trash/drift-realign-{timestamp}/
```

Append to `.workflow/.drift-realign/drift-log.jsonl` (one JSON per line).

**Step 4.4: Generate context.md** (in session folder):

```markdown
# Drift Realign Session Report

## Summary
- Scope: {scope}
- Depth: {depth}
- Drift Score: {score} ({level})
- Scanners: {completed}/{total} succeeded
- Findings: {total} ({P0} P0 / {P1} P1 / {P2} P2)
- Actions: {updated} updated, {archived} archived, {rebuilt} rebuilt, {kept} kept, {skipped} skipped

## Next Steps
- Edit DRIFT-TODO markers: grep -r "DRIFT-TODO" .workflow/
- Deep knowledge audit: $manage-knowledge-audit --scope all
- Full codebase rebuild: $manage-codebase-rebuild
- View status: $manage-status
```

Display completion report:

```
=== DRIFT REALIGN COMPLETE ===
Timeline: {from} → {to} ({days} days, {commits} commits)
Score: {score} ({level})

  Findings:  {N} total ({P0} P0 / {P1} P1 / {P2} P2)
  Updated:   {N} (DRIFT-TODO markers)
  Archived:  {N} (moved to .trash/)
  Rebuilt:   {rebuild_status}
  Kept:      {N}
  Skipped:   {N}

  Report:  .workflow/.drift-realign/drift-report-{date}.md
  Backup:  .workflow/.trash/drift-realign-{timestamp}/

Next:
  → grep -r "DRIFT-TODO" .workflow/   (edit marked files)
  → $manage-knowledge-audit --scope all
  → $manage-status
```

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/` not initialized | Run `$maestro-init` first |
| E002 | error | `--scope` value invalid | Provide valid scope |
| E003 | error | git not available (not a git repo) | Initialize git |
| E004 | error | `--since` cannot be resolved | Check date format or commit ref |
| E005 | error | Backup failed | Check disk space |
| W001 | warning | Session history unavailable (wiki not indexed) | Run `maestro wiki rebuild` |
| W002 | warning | `drift_window` > 180 days | Auto-upgraded to `--depth deep` |
| W003 | warning | Some scanner agents failed | Proceeding with partial findings |
| W004 | warning | git log > 1000 commits | Auto-truncated to most recent 1000 |
| W005 | warning | $quality-sync --full failed or reported major changes | Suggest $manage-codebase-rebuild |
</error_codes>

<success_criteria>
- [ ] Session initialized with timeline.json and tasks.csv
- [ ] drift_score computed and displayed (LOW/MODERATE/SEVERE)
- [ ] Platform inquiry offered (if multi-platform sessions > 20)
- [ ] 4 scanner agents executed via spawn_agents_on_csv (or subset per --scope)
- [ ] DriftFinding[] merged, deduplicated, sorted by P0 > P1 > P2
- [ ] Conflict-markers merged into findings
- [ ] Triage completed (interactive / auto-archive / report / dry-run)
- [ ] Backup tarball generated in .trash/ before any mutations
- [ ] update actions injected DRIFT-TODO markers
- [ ] archive actions moved files to .trash/
- [ ] rebuild actions triggered $quality-sync --full
- [ ] state.json updated with last_drift_realign timestamp
- [ ] drift-report-{date}.md and drift-log.jsonl written
- [ ] context.md generated in session folder
- [ ] Completion report displayed with next-step routing
</success_criteria>
