---
name: maestro-retrospective
description: Multi-lens 复盘 (retrospective) for completed phases. Context-Agent Fork loads phase artifacts once; four parallel lens agents (technical, process, quality, decision) analyze independently; synthesizer distills insights; outputs are routed to spec stubs, memory tips, issues, and lessons.jsonl.
argument-hint: "[phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [--auto-yes]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

## Auto Mode

When `--auto-yes`: Accept all routing recommendations without prompting. Route all insights automatically.

# Quality Retrospective

## Usage

```bash
$maestro-retrospective
$maestro-retrospective "3"
$maestro-retrospective "2..4"
$maestro-retrospective "--all"
$maestro-retrospective "3 --lens technical --no-route"
$maestro-retrospective "3 --compare 2 --auto-yes"
```

**Flags**:
- No phase argument → `scan` mode: report unreviewed completed phases, prompt selection
- `<N>` → `single` mode: retrospect phase N
- `<N>..<M>` → `range` mode: retrospect phases N through M (inclusive)
- `--all` → batch mode: re-run for every completed phase
- `--lens <name>` — restrict to one lens (repeatable): `technical|process|quality|decision`
- `--no-route` — produce retrospective.{md,json} only; skip auto-creation of spec/note/issue
- `--compare <M>` — emit a delta section vs phase M's prior retrospective
- `--auto-yes` — accept all routing recommendations without prompting

**Storage written**:
- `.workflow/phases/{NN}-{slug}/retrospective.md` — human-readable record
- `.workflow/phases/{NN}-{slug}/retrospective.json` — structured record
- `.workflow/specs/SPEC-retro-*.md` — spec stubs (one per spec-routed insight)
- `.workflow/issues/issues.jsonl` — appended issue rows (`source: "retrospective"`)
- `.workflow/memory/TIP-*.md` — memory tips (via `manage-memory-capture` skill)
- `.workflow/learning/lessons.jsonl` — append-only insight log
- `.workflow/learning/learning-index.json` — updated searchable index

**Storage read (never modified)**:
- `.workflow/phases/{NN}-{slug}/index.json`, `plan.json`, `verification.json`, `review.json`, `uat.md`
- `.workflow/phases/{NN}-{slug}/.task/TASK-*.json`, `.summaries/TASK-*-summary.md`
- `.workflow/issues/issues.jsonl`, `.workflow/state.json`

---

## Architecture

```
+------------------------------------------------------------------+
|  quality-retrospective — Context-Agent Fork + Parallel Fan-out   |
+------------------------------------------------------------------+

  Stage 1-3: Read-only resolution (no writes)
  ┌─────────────────────────────────────────┐
  │ Parse mode → Validate artifacts          │
  │ → [scan] Find unreviewed phases          │
  └──────────────────┬──────────────────────┘
                     │
  Stage 4: Context-Agent Fork (Pattern 2.10)
  ┌────────────────────────────────────────────────────────────────┐
  │  spawn ctx (fork_context: false)                               │
  │  wait ctx                                                      │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
  │  │lens-tech │ │lens-proc │ │lens-qual │ │lens-dec  │         │
  │  │fork=true │ │fork=true │ │fork=true │ │fork=true │         │
  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
  │  wait_agent([lens-tech, lens-proc, lens-qual, lens-dec])       │
  │  close lenses → close ctx LAST                                 │
  └──────────────────┬─────────────────────────────────────────────┘
                     │ lens results
  Stage 5: Synthesizer
  ┌──────────────────────────────────────────┐
  │  spawn synthesizer (fork_context: false) │
  │  → wait → close                          │
  └──────────────────┬───────────────────────┘
                     │ distilled_insights
  Stage 6-8: Route → Write → Report
```

## Agent Registry

| Agent | task_name | fork_context | Responsibility |
|-------|-----------|-------------|----------------|
| Context Agent | `ctx` | false | Load all phase artifacts: index.json, plan.json, verification.json, review.json, uat.md, issues.jsonl, task summaries |
| Technical Lens | `lens-tech` | true | Technical debt, architecture decisions, code quality gaps, performance issues |
| Process Lens | `lens-proc` | true | Workflow efficiency, collaboration patterns, planning accuracy, bottlenecks |
| Quality Lens | `lens-qual` | true | Test coverage gaps, verification failures, UAT issues, quality gate outcomes |
| Decision Lens | `lens-dec` | true | Key decisions made, tradeoffs accepted, ADR candidates, reversibility |
| Synthesizer | `synthesizer` | false | Merge lens results, deduplicate insights, classify routing targets |

## Fork Context Strategy

| Agent | task_name | fork_context | fork_from | Rationale |
|-------|-----------|-------------|-----------|-----------|
| Context Agent | `ctx` | false | — | Independent artifact loader; clean start |
| Technical Lens | `lens-tech` | true | `ctx` | Inherits loaded artifacts — no redundant file reads |
| Process Lens | `lens-proc` | true | `ctx` | Inherits loaded artifacts — no redundant file reads |
| Quality Lens | `lens-qual` | true | `ctx` | Inherits loaded artifacts — no redundant file reads |
| Decision Lens | `lens-dec` | true | `ctx` | Inherits loaded artifacts — no redundant file reads |
| Synthesizer | `synthesizer` | false | — | Clean context; receives lens results via message |

**Context-Agent Lifecycle**: Spawn `ctx` first → `wait_agent` → spawn all lens agents (`fork_context: true`) → `wait_agent` batch for lenses → `close_agent` lenses → `close_agent ctx` LAST.

> **fork_context semantics**: `fork_context: true` means the spawned agent inherits the *orchestrator's* current conversation context — not the ctx agent's own context. When `wait_agent(["ctx"])` returns, the ctx agent's completed artifact summaries are visible in the orchestrator's context. Lens agents forked after that point therefore inherit those summaries. Lens agents do **not** fork directly from `ctx`; the `fork_from: ctx` column above is conceptual shorthand for this sequencing.

---

## Implementation

### Session Initialization

```javascript
functions.update_plan({
  explanation: "Starting retrospective",
  plan: [
    { step: "Stage 1-3: Parse mode and validate artifacts", status: "in_progress" },
    { step: "Stage 4: Context-Agent Fork + parallel lens analysis", status: "pending" },
    { step: "Stage 5: Synthesize insights", status: "pending" },
    { step: "Stage 6: Route outputs", status: "pending" },
    { step: "Stage 7: Write artifacts", status: "pending" },
    { step: "Stage 8: Report", status: "pending" }
  ]
})
```

### Stages 1–3: Parse Mode and Validate Artifacts

**Stage 1: Parse mode** from `$ARGUMENTS`:

| First non-flag token | Mode |
|---------------------|------|
| (empty) | scan |
| `<N>` (single digit/number) | single |
| `<N>..<M>` | range |
| `--all` flag present | all |

Validate `--lens` values. If `--compare <M>` present, require single mode.

**Stage 2: Validate phase artifacts**. For each target phase:
- Phase directory `.workflow/phases/{NN}-{slug}/` must exist
- `index.json` must show `status: "completed"`
- `.task/` directory must exist with at least one `TASK-*.json`
- If existing `retrospective.json` found and not `--all`: emit W002, prompt overwrite

**Stage 3: Scan mode** — list all completed phases without retrospective.json. Prompt user to select.

```javascript
functions.update_plan({
  explanation: "Artifacts validated, spawning analysis agents",
  plan: [
    { step: "Stage 1-3: Parse mode and validate artifacts", status: "completed" },
    { step: "Stage 4: Context-Agent Fork + parallel lens analysis", status: "in_progress" },
    { step: "Stage 5: Synthesize insights", status: "pending" },
    { step: "Stage 6: Route outputs", status: "pending" },
    { step: "Stage 7: Write artifacts", status: "pending" },
    { step: "Stage 8: Report", status: "pending" }
  ]
})
```

### Stage 4: Context-Agent Fork + Parallel Lens Analysis

**Archive if overwriting**:
If existing `retrospective.{md,json}` present, move to `{phase_dir}/.history/` with timestamp suffix before spawning.

**Step 4a: Spawn context agent**
```javascript
spawn_agent({
  task_name: "ctx",
  fork_context: false,
  message: `## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read: ~/.codex/agents/cli-explore-agent.md

---

Goal: Load and summarize all phase artifacts for retrospective analysis.
Phase: ${phaseDir}

TASK:
1. Read ${phaseDir}/index.json, plan.json, verification.json, review.json, uat.md
2. Read all .task/TASK-*.json and .summaries/TASK-*-summary.md
3. Read .workflow/issues/issues.jsonl — filter rows with phase link to this phase
4. Read .workflow/state.json for project context

EXPECTED: Comprehensive artifact summary covering:
- Phase goals and outcomes (from plan.json vs verification.json)
- Task completion rates and failed tasks
- Verification results: passed/failed criteria
- Review findings: issues found, severity distribution
- UAT results: scenarios passed/failed
- Related issues: open/resolved counts
- Key metrics: lines changed, test coverage, time taken
`
})
wait_agent({ targets: ["ctx"], timeout_ms: 300000 })
```

**Step 4b: Fork 4 lens agents** (only active lenses based on `--lens` flag; default: all 4)
```javascript
spawn_agent({
  task_name: "lens-tech",
  fork_context: true,
  message: `## TECHNICAL LENS ANALYSIS

Analyze the loaded phase artifacts from a TECHNICAL perspective.

Focus areas:
- Technical debt introduced or resolved
- Architecture decisions and their rationale
- Code quality issues (from review.json findings)
- Performance gaps or regressions
- Security concerns
- Dependencies added or changed

EXPECTED: JSON array of insights, each: {
  "title": "<80 chars>",
  "summary": "<full finding>",
  "category": "pattern|antipattern|decision|tool|gotcha|technique",
  "routing": "spec|issue|memory|none",
  "severity": "critical|high|medium|low",
  "evidence": "<file:line or artifact reference>"
}
`
})

spawn_agent({
  task_name: "lens-proc",
  fork_context: true,
  message: `## PROCESS LENS ANALYSIS

Analyze the loaded phase artifacts from a PROCESS perspective.

Focus areas:
- Planning accuracy (estimated vs actual from plan.json)
- Collaboration patterns and bottlenecks
- Workflow efficiency (task sequencing, dependencies)
- Communication gaps or coordination issues
- Process improvements that worked or failed

EXPECTED: Same JSON array schema as technical lens.
`
})

spawn_agent({
  task_name: "lens-qual",
  fork_context: true,
  message: `## QUALITY LENS ANALYSIS

Analyze the loaded phase artifacts from a QUALITY perspective.

Focus areas:
- Test coverage gaps (from verification.json, uat.md)
- Quality gate outcomes (passed/failed criteria)
- UAT failure patterns and root causes
- Review blocking issues and their resolution
- Missing test scenarios identified post-execution

EXPECTED: Same JSON array schema as technical lens.
`
})

spawn_agent({
  task_name: "lens-dec",
  fork_context: true,
  message: `## DECISION LENS ANALYSIS

Analyze the loaded phase artifacts from a DECISION perspective.

Focus areas:
- Key architectural or design decisions made (from plan.json, task summaries)
- Tradeoffs accepted and their downstream effects
- ADR candidates (decisions significant enough to document)
- Reversibility of decisions made
- Decisions that should have been made differently

EXPECTED: Same JSON array schema as technical lens.
`
})

const lensResults = wait_agent({
  targets: ["lens-tech", "lens-proc", "lens-qual", "lens-dec"],
  timeout_ms: 600000
})

// Close lenses first
;["lens-tech", "lens-proc", "lens-qual", "lens-dec"].forEach(n => close_agent({ target: n }))
// Close context agent LAST
close_agent({ target: "ctx" })
```

If `lensResults.timed_out` for any agent: emit W001, continue with partial coverage.

### Stage 5: Synthesize Insights

```javascript
spawn_agent({
  task_name: "synthesizer",
  fork_context: false,
  message: `## SYNTHESIS TASK

Merge and distill insights from 4 lens analyses.

Lens results:
${JSON.stringify(lensResults.status, null, 2)}

TASK:
1. Merge all insights across lenses into a single list
2. Deduplicate: if two lenses identified the same issue, merge into one (keep higher severity, combine evidence)
3. Generate stable INS-{8hex} id for each: hash(phase_num + lens + title)
4. Classify routing for each: spec (reusable pattern) | issue (recurring gap → create issue) | memory (process note) | none
5. Produce phase-level metrics summary

EXPECTED: JSON with:
- insights: array of {id, title, summary, category, lens, routing, severity, evidence}
- metrics: {tasks_completed, tasks_failed, test_pass_rate, review_issues_count, uat_scenarios_passed}
- routing_summary: {spec: N, issue: N, memory: N, none: N}
`
})

const synthResult = wait_agent({ targets: ["synthesizer"], timeout_ms: 300000 })
close_agent({ target: "synthesizer" })
```

```javascript
functions.update_plan({
  explanation: "Synthesis complete, routing outputs",
  plan: [
    { step: "Stage 1-3: Parse mode and validate artifacts", status: "completed" },
    { step: "Stage 4: Context-Agent Fork + parallel lens analysis", status: "completed" },
    { step: "Stage 5: Synthesize insights", status: "completed" },
    { step: "Stage 6: Route outputs", status: "in_progress" },
    { step: "Stage 7: Write artifacts", status: "pending" },
    { step: "Stage 8: Report", status: "pending" }
  ]
})
```

### Stage 6: Route Outputs

If `--no-route`: skip this stage.

For each insight in `synthResult.insights`, route based on `routing` field:

**Spec routing** (`routing: "spec"`):
```javascript
functions.apply_patch:
*** Begin Patch
*** Add File: .workflow/specs/SPEC-retro-<INS-id>.md
+---
+id: <INS-id>
+source: retrospective
+phase: <N>
+category: <category>
+---
+
+# <title>
+
+<summary>
+
+**Evidence**: <evidence>
*** End Patch
```

**Issue routing** (`routing: "issue"`, severity critical/high):
Append to `.workflow/issues/issues.jsonl`:
```json
{
  "id": "ISS-<date>-<seq>",
  "title": "<insight title>",
  "status": "open",
  "priority": 2,
  "severity": "<severity>",
  "source": "retrospective",
  "description": "<insight summary>",
  "context": {"phase": <N>, "ins_id": "<INS-id>"},
  "issue_history": [{"action": "created", "at": "<ISO>", "by": "quality-retrospective"}]
}
```

**Memory routing** (`routing: "memory"`):
```javascript
Skill({ skill: "manage-memory-capture", args: `tip "${insight.title} — ${insight.summary}" --tag retrospective,phase-${N}` })
```

If `!AUTO_YES`: present routing table and ask confirmation before routing each group.

### Stage 7: Write Artifacts

```javascript
functions.apply_patch:
*** Begin Patch
*** Add File: .workflow/phases/<NN>-<slug>/retrospective.json
+{
+  "phase": <N>,
+  "phase_slug": "<slug>",
+  "retrospective_at": "<ISO>",
+  "lenses_run": ["technical", "process", "quality", "decision"],
+  "metrics": <metrics_from_synthesizer>,
+  "findings_by_lens": { "technical": [...], "process": [...], "quality": [...], "decision": [...] },
+  "distilled_insights": <insights_array>,
+  "routing_summary": <routing_summary>
+}
*** Add File: .workflow/phases/<NN>-<slug>/retrospective.md
+# Retrospective: Phase <N> — <slug>
+
+> Generated: <ISO> | Lenses: technical, process, quality, decision
+
+## Metrics
+| Metric | Value |
+|--------|-------|
+| Tasks completed | <N>/<total> |
+| Test pass rate | <N>% |
+| Review issues | <N> |
+| UAT scenarios | <N>/<total> |
+
+## Findings by Lens
+...
+
+## Distilled Insights
+...
+
+## Routing Summary
+...
*** End Patch
```

Append each insight to `.workflow/learning/lessons.jsonl` and update `learning-index.json`.

If `.workflow/specs/learnings.md` already exists, append a one-line summary per insight (never create it).

```javascript
functions.update_plan({
  explanation: "Retrospective complete",
  plan: [
    { step: "Stage 1-3: Parse mode and validate artifacts", status: "completed" },
    { step: "Stage 4: Context-Agent Fork + parallel lens analysis", status: "completed" },
    { step: "Stage 5: Synthesize insights", status: "completed" },
    { step: "Stage 6: Route outputs", status: "completed" },
    { step: "Stage 7: Write artifacts", status: "completed" },
    { step: "Stage 8: Report", status: "in_progress" }
  ]
})
```

### Stage 8: Report

```
=== RETROSPECTIVE COMPLETE ===
Phase:    <N> (<slug>)
Lenses:   technical, process, quality, decision
Insights: <total> (<N> new, <N> duplicates merged)

ROUTING:
  Spec stubs:   <N>  → .workflow/specs/SPEC-retro-*.md
  Issues:       <N>  → .workflow/issues/issues.jsonl
  Memory tips:  <N>  → .workflow/memory/TIP-*.md
  Lessons:      <N>  → .workflow/learning/lessons.jsonl

METRICS:
  Tasks:        <N>/<total> completed
  Test pass:    <N>%
  Review:       <N> issues

Next:
  $maestro-status
  $maestro-issue "list --source retrospective"
  $maestro-learn "list --phase <N>"
```

---

## Error Handling

| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized | parse_input |
| E002 | error | Unknown `--lens` name | parse_input |
| E003 | error | `--compare` requires single phase mode | parse_input |
| E004 | error | Phase has no execution artifacts (no .task/) | load_artifacts |
| E005 | error | Phase directory not found or phase not completed | scan_unreviewed |
| W001 | warning | One or more lens agents timed out — partial coverage | multi_lens_analysis |
| W002 | warning | Existing retrospective.json found — prompted to overwrite | scan_unreviewed |
| W003 | warning | `manage-memory-capture` did not return parseable TIP id; fell back to direct write | route_outputs |
| W004 | warning | `--compare` target phase has no retrospective.json; delta omitted | load_artifacts |

---

## Core Rules

1. **Read-only until Stage 6**: Stages 1–5 must not write any files — only read and analyze
2. **Context-agent spawns first**: `ctx` must complete before any lens agent is spawned
3. **Parallel lens dispatch**: All active lens agents spawned in a single batch, then `wait_agent` for all together — never sequentially
4. **Context-agent closes last**: Close all lens agents before closing `ctx`
5. **Synthesizer is isolated**: `fork_context: false` — receives lens results only via message, not full conversation history
6. **Stable INS-ids**: `INS-{8hex}` from `hash(phase_num + lens + title)` — re-runs do not create duplicates
7. **Archive before overwrite**: Move existing retrospective.{md,json} to `.history/` with timestamp before writing new ones
8. **Spec learnings.md backward-compat**: Append to it only if it already exists — never create it
9. **Route confirmation**: Unless `--auto-yes`, present routing table and ask per-group before writing spec/issue/memory
10. **Lessons always written**: Append to `lessons.jsonl` regardless of `--no-route` — routing only controls spec/issue/memory creation
