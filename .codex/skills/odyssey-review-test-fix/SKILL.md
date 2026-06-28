---
name: odyssey-review-test-fix
description: "Deep review + fix cycle — archaeology, exploration, multi-dimensional review, targeted fix, generalization, discovery, and knowledge persistence"
argument-hint: "<target> [--dimensions <list>] [--fix-threshold critical|high|medium|low|all] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<base>@~/.maestro/workflows/odyssey-base-codex.md</base>

<purpose>
archaeology → explore → multi-dimensional review → fix ALL findings → confirm → generalize → discover → persist. Zero-residual: every finding must have an action (fix/issue/decision).
</purpose>

<boundary>
**In scope:** Target code multi-dimensional review → exhaustive fix ALL findings (by severity desc) → generalize patterns project-wide.
**Out of scope:** Deep root cause → `$odyssey-debug` | Requirements → `$odyssey-planex` | UI visual → `$odyssey-ui`

**Review dimensions:** correctness, security, performance, architecture (filterable via `--dimensions`).
**Zero-residual:** Every finding MUST have a concrete action. "Report and shelve" and "pre-existing skip" are forbidden.
</boundary>

<context>
$ARGUMENTS

**Target resolution:**

| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | state.json → changed files |
| PR number | `git diff main...HEAD` |

**Flags:** `--dimensions <list>` subset of 4 dims | `--fix-threshold <sev>` default `all` | `--skip-fix` skip S_FIX+S_CONFIRM | `--skip-generalize` skip S_GENERALIZE+S_DISCOVER | `--auto` `-y` `-c` `--heartbeat`

**Session**: `.workflow/scratch/{YYYYMMDD}-review-odyssey-{slug}/`
**Output**: `session.json` | `evidence.ndjson` | `explore.json` | `understanding.md` (sections 1-8)

**session.json — review-specific fields:**
```json
{ "target": "", "dimensions": [], "review_result": { "remaining_actionable": 0 },
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

**evidence.ndjson phases:** `archaeology|explore|review|fix|discovery|decision|self-iteration`

**phase_goals[]:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Review completed | all dimensions reviewed | S_REVIEW | — |
| G2 | Explore context | explore.json populated | S_EXPLORE | — |
| G3 | Zero remaining | `remaining_actionable == 0` | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] >= 1 | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries or no actionable | S_RECORD | — |

Specs: `maestro load --type spec --category review`. Rest per base Pre-load.

**Knowledge Persistence (S_RECORD → understanding.md section 8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Cross-dimension recurring pattern | Pattern + affected dimensions + coding standard | `$spec-add review` |
| Security finding | Vulnerability type + trigger + fix approach | `$spec-add debug` |
| Architecture violation pattern | Violation + correct boundary + verification | `$spec-add arch` |
| Reusable generalization pattern | Signature + risk + fix template | `$spec-add coding` |
</context>

<invariants>
Base invariants + auto-commit per phase + zero silent drops (every finding → action).
</invariants>

<self_iteration>
Applies to: **S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE**. Logic in base.
</self_iteration>

<csv_schema>

### Shared Output Schema
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings": { "type": "string", "maxLength": 500 },
    "evidence": { "type": "string" },
    "error": { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination contract:** Call `report_agent_job_result` EXACTLY ONCE. Read-only. Do NOT modify source files, tasks.csv, wave-*.csv, results.csv, or call spawn_agents_on_csv.

### tasks.csv
```csv
id,title,description,task_type,dimension,deps,wave,status,findings,evidence,error
```

**Waves:**

| Wave | Tasks | Parallelism |
|------|-------|-------------|
| 1 | Archaeology (git-timeline, git-blame) | 2 agents |
| 2 | Review (correctness, security, performance, architecture) | 4 agents |
| 3 | Generalization (syntax-grep, semantic-scan, structural-match, historical-grep) | 4 agents |
</csv_schema>

<state_machine>

<states>
S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → S_GENERALIZE → S_DISCOVER → S_RECORD → END
Skip: --skip-fix skips S_FIX+S_CONFIRM | --skip-generalize skips S_GENERALIZE+S_DISCOVER
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → resume
S_INTAKE → S_ARCHAEOLOGY  : target resolved
S_INTAKE → S_INTAKE       : no target → request_user_input

S_ARCHAEOLOGY → S_EXPLORE     : complete
S_EXPLORE     → S_REVIEW      : complete

S_REVIEW  → S_FIX          : !skip_fix AND findings
S_REVIEW  → S_GENERALIZE   : skip_fix OR no findings, !skip_gen
S_REVIEW  → S_RECORD       : both skip

S_FIX     → S_CONFIRM      : fix implemented
S_CONFIRM → S_GENERALIZE   : confirmed, !skip_gen
S_CONFIRM → S_RECORD       : confirmed, skip_gen
S_CONFIRM → S_FIX          : needs_rework

S_GENERALIZE → S_DISCOVER  : hits
S_GENERALIZE → S_RECORD    : no hits

S_DISCOVER → S_FIX         : fixable sibling
S_DISCOVER → S_REVIEW      : new target, loops < max
S_DISCOVER → S_RECORD      : done or max_loops
</transitions>

<actions>

### A_INTAKE
Parse target + flags → file list. Create SESSION_DIR, derive phase_goals[]. Search prior knowledge. Write session.json + section 1. Call `create_goal` with phase_goals as success_criteria.

### A_ARCHAEOLOGY
**spawn_agents_on_csv (Wave 1):**
```csv
"arch-timeline","Git Timeline","git log --oneline -20 -- {target_files}","archaeology","","","1","pending","","",""
"arch-blame","Git Blame","git blame on key regions of target files","archaeology","","","1","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: ARCHAEOLOGY_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 2, max_runtime_seconds: 300,
  output_csv_path: "wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```
Merge → evidence (phase: archaeology). CLI delegate `--role analyze`. Update section 2.

### A_EXPLORE
CLI delegate `--role explore` — call chains, error gaps, similar patterns. Write explore.json. Update section 3. Mark G2.

### A_REVIEW
**spawn_agents_on_csv (Wave 2):**
```csv
"rev-correct","Correctness","Logic errors, boundary conditions, null/undefined, race conditions","review","correctness","","2","pending","","",""
"rev-security","Security","Injection, XSS, CSRF, data exposure, auth bypass","review","security","","2","pending","","",""
"rev-perf","Performance","Hot paths, N+1, memory leaks, unnecessary recomputation","review","performance","","2","pending","","",""
"rev-arch","Architecture","Layer violations, circular deps, interface contracts, SoC","review","architecture","","2","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: REVIEW_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 600,
  output_csv_path: "wave-2-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```
Each returns `[{title, severity, file, line, description, suggestion, cwe}]`. Merge → evidence (review). Write review_result + section 4 (severity matrix). Mark G1.

### A_FIX
Exhaustive tier loop — descend severity until `remaining_actionable == 0`:

```
for tier in [critical, high, medium, low].filter(>= threshold):
  for each unfixed candidate: read +/-20 → fix → evidence (fix)
  re-review modified area: new findings → append, continue (max 2/tier)
  tier done → auto-commit
```

Normal: request_user_input per tier. `-y`: auto-fix all.
Remaining > 0 → retry (no max_loops limit). Unchanged 2 rounds → classify each individually.
Blanket "pre-existing" forbidden.

### A_CONFIRM
Run tests + CLI delegate zero-residual review (`--role review`).
- `remaining == 0 AND new == 0` → confirmed, mark G3
- Otherwise → needs_rework → S_FIX

Update confirmation + remaining_actionable + section 5.

### A_GENERALIZE
Base shared_actions. Pattern source: findings (severity >= medium).

**spawn_agents_on_csv (Wave 3):**
```csv
"gen-syntax","Syntax Grep","Grep syntax-layer patterns across project","generalization","syntax","","3","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for same anti-patterns","generalization","semantic","","3","pending","","",""
"gen-structural","Structural Match","Find structurally similar files, check for same issues","generalization","structural","","3","pending","","",""
"gen-historical","Historical Grep","git log -S pattern for introduction/fix history","generalization","historical","","3","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: GENERALIZATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 600,
  output_csv_path: "wave-3-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Cross-layer dedup: multi-layer hits → boost confidence | single-layer → `needs_review` | historically fixed → `regression_risk`.
Iterative deepening: module with >= 3 hits → targeted deep scan (max 1 round).
Mark G4.

### A_DISCOVER
Base shared_actions. Review overrides: cross-phase loop tracking per base.

### A_RECORD
Base shared_actions. Learnings per Knowledge Persistence table.

**Completion summary:**
```
--- REVIEW-TEST-FIX ODYSSEY COMPLETE ---
Target:     {target}          Dimensions: {dims}
Findings:   {C}C {H}H {M}M {L}L    Fix: {fixed}, confirmed={yes|skip}
Patterns:   {N} ({by_layer})        Scan hits: {total} ({cross} cross-layer)
Issues: {N}  Decisions: {N}r/{M}p/{K}d  Learnings: {N}  Self-iter: {N}x{M}
Goals:  {done}/{total} ({skipped} skipped)
---
```

</actions>

<appendix>

### `-y` review-specific points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| S_FIX tier candidates | request_user_input | auto-fix, `deferred` |
| S_FIX re-review new findings | request_user_input | auto-append |
| S_CONFIRM needs_rework | Display → S_FIX | auto proceed |

### Goal convergence rules

```
Stop when review_result.remaining_actionable == 0, confirmation == confirmed,
phase_goals_all_done=true. Fix by severity desc, re-review modified areas,
new findings appended. Every finding must have action (fix/issue/decision).
Decision pending must request_user_input.
```

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target |
| E002 | error | Target path not found | Check path |
| W001 | warning | No git history | Proceed |
| W002 | warning | Some dimension agents failed | Partial coverage |
</error_codes>

<success_criteria>
- [ ] All dimensions reviewed, ALL findings fixed (remaining_actionable == 0), zero-residual confirmed
- [ ] Per-tier re-review gate; every unfixed finding individually classified
- [ ] Generalized with multi-layer scan (unless --skip-generalize); self-iteration on insufficient
- [ ] understanding.md sections 1-8, phase_goals G1-G6 audited, `create_goal` called once, `-y` no blocking, -c resumable
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Deeper debug needed | `$odyssey-debug "<finding>"` |
| Issues created | `$manage-issue list --source review-odyssey` |
| Pattern to document | `$learn-decompose <module>` |
| Plan fixes | `$maestro-plan --gaps` |
</next_step_routing>
