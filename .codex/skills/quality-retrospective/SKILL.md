---
name: quality-retrospective
description: Use after completing a phase to extract lessons, patterns, and
  improvement opportunities
argument-hint: "[phase|N..M] [--lens technical|process|quality|decision] [--all]
  [--no-route] [--compare N] [-y]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, spawn_agent, wait_agent,
  close_agent, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Multi-lens retrospective for completed phases. Context-Agent Fork loads phase artifacts once;
four parallel lens agents (technical, process, quality, decision) analyze independently;
synthesizer distills insights; outputs are routed to spec stubs, knowhow tips, issues, and .workflow/specs/learnings.md.

```
+------------------------------------------------------------------+
|  quality-retrospective -- Context-Agent Fork + Parallel Fan-out   |
+------------------------------------------------------------------+

  Stage 1-3: Read-only resolution (no writes)
  +---------------------------------------------+
  | Parse mode -> Validate artifacts              |
  | -> [scan] Find unreviewed phases              |
  +----------------------+-----------------------+
                         |
  Stage 4: Context-Agent Fork (Pattern 2.10)
  +----------------------------------------------------------------+
  |  spawn ctx (fork_turns: "none")                                 |
  |  wait ctx                                                       |
  |  +----------+ +----------+ +----------+ +----------+           |
  |  |lens-tech | |lens-proc | |lens-qual | |lens-dec  |           |
  |  |fork=true | |fork=true | |fork=true | |fork=true |           |
  |  +----------+ +----------+ +----------+ +----------+           |
  |  wait_agent([lens-tech, lens-proc, lens-qual, lens-dec])        |
  |  close lenses -> close ctx LAST                                 |
  +----------------------+-----------------------------------------+
                         | lens results
  Stage 5: Synthesizer
  +------------------------------------------+
  |  spawn synthesizer (fork_turns: "none") |
  |  -> wait -> close                        |
  +----------------------+-------------------+
                         | distilled_insights
  Stage 6-8: Route -> Write -> Report
```
</purpose>

<context>
```bash
$quality-retrospective
$quality-retrospective "3"
$quality-retrospective "2..4"
$quality-retrospective "--all"
$quality-retrospective "3 --lens technical --no-route"
$quality-retrospective "3 --compare 2 -y"
```

**Flags**:
- No phase argument -> `scan` mode: report unreviewed completed phases, prompt selection
- `<N>` -> `single` mode: retrospect phase N
- `<N>..<M>` -> `range` mode: retrospect phases N through M (inclusive)
- `--all` -> batch mode: re-run for every completed phase
- `--lens <name>` -- restrict to one lens (repeatable): `technical|process|quality|decision`
- `--no-route` -- produce retrospective.{md,json} only; skip auto-creation of spec/note/issue
- `--compare <M>` -- emit a delta section vs phase M's prior retrospective
- `-y` -- accept all routing recommendations without prompting

When `-y`: Accept all routing recommendations without prompting. Route all insights automatically.

**Storage written**:
- `{run_dir}/outputs/retrospective.md` -- human-readable record
- `{run_dir}/outputs/retrospective.json` -- structured record
- `.workflow/specs/{category-file}.md` -- `<spec-entry>` entries appended to matching category files (one per spec-routed insight)
- `.workflow/issues/issues.jsonl` -- appended issue rows (`source: "retrospective"`)
- `.workflow/knowhow/TIP-*.md` -- knowhow tips (via `manage-knowhow-capture` skill)
- `.workflow/specs/learnings.md` -- append-only insight log
- Index auto-maintained by WikiIndexer

**Storage read (never modified)** — all resolved via `Session ArtifactRegistry (runtime-owned)`:
```
Resolve the target execution from `.workflow/sessions/*/runs/*/run.json`, then
resolve typed upstream artifacts through the owning Session `artifacts.json`.
```
Each artifact points to a producer Run under `runs/{run_id}/outputs/`; supporting
evidence is under that Run's `evidence/`, and narrative/handoff is in `report.md`.
- Also reads: `.workflow/issues/issues.jsonl`, `.workflow/state.json`

**Output boundary**: ALL file writes MUST target the phase's retrospective directory (`{run_dir}/outputs/`), `.workflow/state.json`, `.workflow/issues.jsonl`, or `.workflow/specs/` (append-only). NEVER modify source code, verification.json, review.json, plan.json, or other existing artifacts.

### Agent Registry

| Agent | task_name | fork_turns | Responsibility |
|-------|-----------|------------|----------------|
| Context Agent | `ctx` | "none" | Load all phase artifacts: index.json, plan.json, verification.json, review.json, uat.md, issues.jsonl, task summaries |
| Technical Lens | `lens-tech` | "all" | Technical debt, architecture decisions, code quality gaps, performance issues |
| Process Lens | `lens-proc` | "all" | Workflow efficiency, collaboration patterns, planning accuracy, bottlenecks |
| Quality Lens | `lens-qual` | "all" | Test coverage gaps, verification failures, UAT issues, quality gate outcomes |
| Decision Lens | `lens-dec` | "all" | Key decisions made, tradeoffs accepted, ADR candidates, reversibility |
| Synthesizer | `synthesizer` | "none" | Merge lens results, deduplicate insights, classify routing targets |

### Fork Turns Strategy

| Agent | task_name | fork_turns | fork_from | Rationale |
|-------|-----------|------------|-----------|-----------|
| Context Agent | `ctx` | "none" | -- | Independent artifact loader; clean start |
| Technical Lens | `lens-tech` | "all" | `ctx` | Inherits loaded artifacts -- no redundant file reads |
| Process Lens | `lens-proc` | "all" | `ctx` | Inherits loaded artifacts -- no redundant file reads |
| Quality Lens | `lens-qual` | "all" | `ctx` | Inherits loaded artifacts -- no redundant file reads |
| Decision Lens | `lens-dec` | "all" | `ctx` | Inherits loaded artifacts -- no redundant file reads |
| Synthesizer | `synthesizer` | "none" | -- | Clean context; receives lens results via message |

**Context-Agent Lifecycle**: Spawn `ctx` first -> `wait_agent` -> spawn all lens agents (`fork_turns: "all"`) -> `wait_agent` batch for lenses -> `close_agent` lenses -> `close_agent ctx` LAST.

> **fork_turns semantics**: `fork_turns: "all"` means the spawned agent inherits the *orchestrator's* current conversation context -- not the ctx agent's own context. When `wait_agent` for ctx returns, the ctx agent's completed artifact summaries are visible in the orchestrator's context. Lens agents forked after that point therefore inherit those summaries. Lens agents do **not** fork directly from `ctx`; the `fork_from: ctx` column above is conceptual shorthand for this sequencing.
</context>

<invariants>
1. **Read-only until Stage 6**: Stages 1-5 must not write any files -- only read and analyze
2. **Context-agent spawns first**: `ctx` must complete before any lens agent is spawned
3. **Parallel lens dispatch**: All active lens agents spawned in a single batch, then `wait_agent` for all together -- never sequentially
4. **Context-agent closes last**: Close all lens agents before closing `ctx`
5. **Synthesizer is isolated**: `fork_turns: "none"` -- receives lens results only via message, not full conversation history
6. **Stable INS-ids**: `INS-{8hex}` from `hash(phase_num + lens + title)` -- re-runs do not create duplicates
7. **Immutable history**: Never overwrite or move sealed retrospective artifacts; create a new Run
8. **Spec learnings.md**: Create `.workflow/specs/learnings.md` if it does not exist, then append insights
9. **Route confirmation**: Unless `-y`, present routing table and ask per-group before writing spec/issue/knowhow
10. **Lessons always written**: Append to `.workflow/specs/learnings.md` regardless of `--no-route` -- routing only controls spec/issue/knowhow creation
</invariants>

<execution>

### Session Initialization

Update plan: Stages 1-3 → in_progress; Stages 4-8 → pending.

### Stages 1-3: Parse Mode and Validate Artifacts

**Stage 1: Parse mode** from `$ARGUMENTS`:

| First non-flag token | Mode |
|---------------------|------|
| (empty) | scan |
| `<N>` (single digit/number) | single |
| `<N>..<M>` | range |
| `--all` flag present | all |

Validate `--lens` values. If `--compare <M>` present, require single mode.

**Stage 2: Validate phase artifacts**. For each target phase:
- Target execution Run must exist and have `status: "sealed"`
- Its primary artifact must resolve through the owning Session `artifacts.json`
- Existing retrospective artifacts remain immutable; a rerun always writes to the current Run

**Stage 3: Scan mode** -- list all completed phases without retrospective.json. Prompt user to select.

Update plan: Stages 1-3 → completed; Stage 4 → in_progress.

### Stage 4: Context-Agent Fork + Parallel Lens Analysis

**Step 4a: Spawn context agent**
```javascript
spawn_agent({
  task_name: "ctx",
  fork_turns: "none",
  message: `Load and summarize all phase ${targetPhase} artifacts for retrospective.
    1. Resolve the sealed execution Run from `.workflow/sessions/*/runs/*/run.json`
    2. Load its typed artifacts through the owning Session `artifacts.json`, plus Run evidence and report
    3. Filter issues.jsonl for this Run/phase reference; read Session metadata for context
    EXPECTED: Goals vs outcomes, completion rates, verification/review/UAT results, issue counts, key metrics`
})
wait_agent({ timeout_ms: 1800000 })
```

**Step 4b: Fork 4 lens agents** (only active lenses based on `--lens` flag; default: all 4)

All lenses use `fork_turns: "all"` and return the same JSON array schema:
```json
[{ "title": "<80 chars>", "summary": "...", "category": "pattern|antipattern|decision|tool|gotcha|technique",
   "routing": "spec|issue|knowhow|none", "severity": "critical|high|medium|low", "evidence": "<file:line>" }]
```

| Agent | task_name | Focus |
|-------|-----------|-------|
| Technical | `lens-tech` | Tech debt, architecture decisions, code quality, performance, security, dependencies |
| Process | `lens-proc` | Planning accuracy, collaboration, workflow efficiency, communication, process improvements |
| Quality | `lens-qual` | Test coverage gaps, quality gates, UAT failures, review blockers, missing scenarios |
| Decision | `lens-dec` | Key decisions, tradeoffs, ADR candidates, reversibility, retrospective judgment |

```javascript
// Spawn all 4 lenses in parallel
["lens-tech", "lens-proc", "lens-qual", "lens-dec"].forEach(name =>
  spawn_agent({ task_name: name, fork_turns: "all", message: `<lens-specific prompt>` })
)
const lensResults = wait_agent({ timeout_ms: 1800000 })

// Close lenses first, then context agent LAST
["lens-tech", "lens-proc", "lens-qual", "lens-dec"].forEach(n => close_agent({ target: n }))
close_agent({ target: "ctx" })
```

If `lensResults.timed_out` for any agent: emit W001, continue with partial coverage.

### Stage 5: Synthesize Insights

```javascript
spawn_agent({
  task_name: "synthesizer",
  fork_turns: "none",
  message: `Merge and distill insights from 4 lens analyses.
    Input: ${JSON.stringify(lensResults.status)}
    1. Merge all insights, deduplicate (same issue across lenses → keep higher severity, combine evidence)
    2. Generate stable INS-{8hex} id: hash(phase_num + lens + title)
    3. Classify routing: spec | issue | knowhow | none
    4. Produce phase-level metrics summary
    EXPECTED JSON: { insights: [{id,title,summary,category,lens,routing,severity,evidence}],
      metrics: {tasks_completed,tasks_failed,test_pass_rate,review_issues_count,uat_scenarios_passed},
      routing_summary: {spec:N, issue:N, knowhow:N, none:N} }`
})
const synthResult = wait_agent({ timeout_ms: 1800000 })
close_agent({ target: "synthesizer" })
```

Update plan: Stages 1-5 → completed; Stage 6 → in_progress.

### Stage 6: Route Outputs

If `--no-route`: skip this stage.

For each insight in `synthResult.insights`, route based on `routing` field:

**Spec routing** (`routing: "spec"`):
Map category (pattern/convention → `coding`, architecture → `arch`, quality → `quality`). Append `<spec-entry>` with category, auto-extracted keywords, date, title, description, source="retrospective", evidence, phase/lens/INS-id.

**Issue routing** (`routing: "issue"`, severity critical/high):
Append to `.workflow/issues/issues.jsonl` with `ISS-<date>-<seq>` id, source="retrospective", phase/INS-id context, and history entry.

**Memory routing** (`routing: "knowhow"`):
Invoke `manage-knowhow-capture` skill with tip content and `--tag retrospective,phase-{N}`.

If `!AUTO_YES`: present routing table and ask confirmation before routing each group.

### Stage 7: Write Artifacts

Write two files to the current `{run_dir}/outputs/` without modifying prior sealed artifacts:
- **retrospective.json**: phase, slug, timestamp, lenses_run, metrics, findings_by_lens, distilled_insights, routing_summary
- **retrospective.md**: Header with phase/slug/timestamp, metrics table (tasks completed, test pass rate, review issues, UAT scenarios), findings by lens, distilled insights, routing summary

Append each insight to `.workflow/specs/learnings.md`.

If `.workflow/specs/learnings.md` does not exist, create it with a `# Learnings` header. Append each insight as `<spec-entry>` (category=`learning`, auto-extract keywords, date=today, source=`retrospective`).

Update plan: Stages 1-7 → completed; Stage 8 → in_progress.

### Stage 8: Report

Display summary: phase, lenses run, insight counts (new vs merged duplicates), routing breakdown (spec/issue/knowhow/lesson counts with target paths), key metrics (task completion, test pass rate, review issues).

Next steps: `$manage-status`, `$manage-issue "list --source retrospective"`, `$manage-learn "list --phase <N>"`, `$manage-wiki health`, `$wiki-digest "<phase-topic>"`.
</execution>

<error_codes>

| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized | parse_input |
| E002 | error | Unknown `--lens` name | parse_input |
| E003 | error | `--compare` requires single phase mode | parse_input |
| E004 | error | Phase has no execution artifacts (no .task/) | load_artifacts |
| E005 | error | Phase directory not found or phase not completed | scan_unreviewed |
| W001 | warning | One or more lens agents timed out -- partial coverage | multi_lens_analysis |
| W002 | warning | Existing retrospective.json found -- prompted to overwrite | scan_unreviewed |
| W003 | warning | `manage-knowhow-capture` did not return parseable TIP id; fell back to direct write | route_outputs |
| W004 | warning | `--compare` target phase has no retrospective.json; delta omitted | load_artifacts |
</error_codes>

<success_criteria>
- [ ] Mode correctly parsed from arguments (scan/single/range/all)
- [ ] Phase artifacts validated before analysis begins
- [ ] Context agent loads all artifacts before lens agents spawn
- [ ] All active lens agents spawned in parallel, waited as batch
- [ ] Context agent closed last (after all lens agents)
- [ ] Synthesizer produces deduplicated insights with stable INS-ids
- [ ] Routing applied per insight (spec/issue/knowhow/none) with confirmation
- [ ] retrospective.{md,json} written to phase directory
- [ ] Lessons appended to .workflow/specs/learnings.md regardless of --no-route flag
- [ ] Existing retrospective archived before overwrite
</success_criteria>
