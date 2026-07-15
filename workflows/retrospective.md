---
name: retrospective
prepare: retrospective
commands: [quality-retrospective]
session-mode: inherited
---

# Workflow: Retrospective

## Argument Shape

```
retrospective                          → auto-scan unreviewed phases, prompt selection
retrospective <N>                      → retrospect single phase
retrospective <N>..<M>                 → retrospect range (inclusive)
retrospective --all                    → re-run for every completed phase (force)
retrospective <N> --lens <name>        → restrict to one lens (technical|process|quality|decision|all)
retrospective <N> --no-route           → produce retrospective.{md,json} only, skip auto-create of spec/note/issue
retrospective <N> --compare <M>        → delta vs phase M (gstack-style trend)
```

| Flag | Effect |
|------|------|
| `--lens <name>` | Run only the named lens. Default: all four. Repeatable. |
| `--no-route` | Synthesize but skip Step 6 (no spec/note/issue creation). |
| `--all` | Force re-run for every completed phase (creates a new Run per candidate). |
| `--compare <M>` | Load phase M's retrospective.json and emit a delta section. |
| `-y` | Skip routing confirmation prompts; accept all recommendations. |

---

## Step 1: parse_input

```
Require .workflow/ exists (E001).
Parse $ARGUMENTS → first non-flag token as phase/range/"--all", remaining as flags.

Build config:
  mode       = "scan" | "single" | "range" | "all"
  phases     = [] (filled in Step 2)
  lenses     = ["technical","process","quality","decision"]
  route      = true (false if --no-route)
  compare_to = null | <phase number>
  auto_yes   = false (true if -y)

Validate: --lens names must be known (E002), --compare requires single mode (E003).
```

---

## Step 2: scan_unreviewed (mode = "scan" or "all")

```
The runtime supplies the set of completed execution Runs eligible for retrospection
(session resolution, Run enumeration, and artifact lookup are handled by the runtime).

candidates = all completed execution Runs, each mapped to:
  { number: run.sequence, slug: run.run_id, title: run.intent, completed_at: run.completed_at,
    has_retro, run_dir, gaps: 0, review_verdict: "—" }

  where has_retro = whether a completed retrospective artifact already exists for that Run
```

### Display backlog

```
=== RETROSPECTIVE BACKLOG ===

  Phase  Title                    Completed       Retro?  Gaps  Review
  ─────  ──────────────────────  ──────────────  ──────  ────  ──────
  01     Authentication           2026-03-15      MISSING    3   WARN
  02     Rate limiting            2026-03-22      ✓          0   PASS
  03     Refresh tokens           2026-04-02      MISSING    1   PASS

  Unreviewed: 2 phases
```

### Selection logic

| Mode | Action |
|------|--------|
| `scan`, 0 unreviewed | Print "All phases retrospected", exit 0 |
| `scan`, 1 unreviewed | Default to that phase, ask AskUserQuestion to confirm |
| `scan`, ≥2 unreviewed | AskUserQuestion with options: each phase as a choice + "All unreviewed" |
| `all` | `phases = candidates` (one retrospective Run per candidate) |
| `single` | `phases = [parsed_phase]` (validate it exists and is completed; if `has_retro` and not `--all`, prompt to overwrite) |
| `range` | `phases = candidates.filter(c => N <= c.number <= M)` |

Existing retrospective artifacts are immutable — a re-run produces a new artifact. Run creation and artifact registration are handled by the runtime.

---

## Step 3: load_artifacts (per phase)

```
source_run_dir = candidate.run_dir
output_dir = current retrospective `{run_dir}/outputs/`

Load artifacts bundle (typed inputs are resolved and injected by the runtime; do not read the artifact registry directly):
  execution       ← source Run primary execution artifact
  evidence        ← {source_run_dir}/evidence/
  report          ← {source_run_dir}/report.md
  upstream        ← upstream aliases and producer Runs of the source Run
  phase_issues    ← .workflow/issues/{issues,issue-history}.jsonl filtered by phase_ref == slug|NN
  prior_retro     ← if --compare M: the completed retrospective artifact for phase M
```

### Compute base metrics

```
metrics = {
  tasks_planned          ← execution summary planned count
  tasks_completed        ← execution summary completed count
  tasks_deferred         ← state deferred for this phase
  gaps_found / closed    ← verification.gaps (total vs status=="closed")
  antipatterns           ← verification.antipatterns count
  constraint_violations  ← verification.constraint_violations count
  issues_opened          ← phase_issues where source in [verification,review,antipattern,discovery]
  issues_closed          ← phase_issues where status in [completed,failed]
  rework_iterations      ← count .history/verification-*.json
  severity_distribution  ← review.severity_distribution or {critical:0,high:0,medium:0,low:0,total:0}
  review_verdict/level   ← review.verdict or "not_run", review.level
  uat_blockers           ← count blockers from uat.md
}
```

Verification fields (`gaps`, `antipatterns`, `constraint_violations`) follow the `steps/kinds/verification.yaml` schema. Review fields (`severity_distribution`, `verdict`, findings) follow the `steps/kinds/review-findings.yaml` schema.

If `--compare M` is set, compute delta (current minus prior_retro) for:
```
delta = { vs_phase, tasks_completed, gaps_found, issues_opened, rework_iterations, severity_critical, severity_high }
```

---

## Step 4: multi_lens_analysis

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn one Agent per active lens **in parallel** (`run_in_background: false`). Each returns JSON.

### Lens registry

| Lens | subagent_type | --rule template (for any inner CLI calls) | Primary inputs | Output candidates |
|------|--------------|-------------------------------------------|----------------|-------------------|
| technical | general-purpose | analysis-analyze-code-patterns | execution artifact, evidence, report, upstream aliases | spec stubs |
| process | general-purpose | analysis-trace-code-execution | execution artifact, report, issue history timestamps | notes |
| quality | general-purpose | analysis-review-code-quality | verification (gaps + antipatterns), review (severity_distribution + findings), phase_issues | issues |
| decision | general-purpose | analysis-review-architecture | report handoff, execution rationale, upstream artifacts | notes (or spec) |

### Lens prompt template

```
You are the {LENS} lens of a workflow retrospective for phase {NN}-{slug}.

## Goal
Analyze the phase artifacts from the {LENS} perspective and return structured JSON
that will be merged into a multi-lens retrospective and used to route insights into
the project's spec / note / issue stores.

## Lens focus
{lens_specific_focus_paragraph}

## Phase context
- Title: {index.title}
- Goal: {index.goal}
- Success criteria: {index.success_criteria}
- Status: {index.status}
- Completed at: {index.completed_at}

## Artifacts (read these from disk)
- Execution:      {source_run_dir}/outputs/<primary artifact>
- Evidence:       {source_run_dir}/evidence/
- Report:         {source_run_dir}/report.md
- Upstream:       Session `artifacts.json` aliases and producer Runs
- Phase issues:   .workflow/issues/issues.jsonl (filter phase_ref == "{phase_slug}")
- Project state:  .workflow/state.json (decisions, deferred)

## Pre-computed metrics
{json_dump of metrics block from Step 3}

## Instructions
1. Read the listed artifacts; do not guess at files that don't exist.
2. Identify exactly:
   - 3 wins        (what worked, with concrete evidence refs)
   - 3 challenges  (what was hard, with concrete evidence refs)
   - 3 watch_patterns (recurring concerns to monitor in future phases)
3. Distill 1–3 reusable insights from this lens. Each insight is portable —
   stated so a future planner who has never seen this phase can apply it.
4. For each insight, recommend a routing target:
   - "spec"  → reusable architectural pattern, contract, or convention
   - "note"  → process tip, decision rationale, or contextual reminder
   - "issue" → recurring gap, antipattern, or technical debt that needs fix work
   - "none"  → insight is interesting but not actionable
5. Ground every finding in evidence_refs that include the file path AND
   either a line number, JSON pointer (#field), or section heading.

## Output
Return ONLY a single JSON object, no prose, matching this schema:

{
  "lens": "{LENS}",
  "wins":         [{ "title": "...", "evidence_refs": ["..."] }, ...],
  "challenges":   [{ "title": "...", "evidence_refs": ["..."] }, ...],
  "watch_patterns": [{ "title": "...", "evidence_refs": ["..."] }, ...],
  "insights": [
    {
      "category": "pattern|antipattern|decision|tool|gotcha|technique",
      "title": "Short imperative title",
      "summary": "1–3 sentences a future planner can act on",
      "confidence": "high|medium|low",
      "evidence_refs": ["{source_run_dir}/evidence/<file>:<line>", "..."],
      "routed_to": "spec|note|issue|none",
      "tags": ["..."]
    }
  ]
}
```

### Lens-specific focus paragraphs

**technical**:
> Identify reusable architecture decisions, API contracts, integration patterns, and tech debt incurred. Focus on what should become a project-wide spec or convention. Watch for: ad-hoc patterns that should be standardized, abstractions that leaked, libraries chosen without rationale.

**process**:
> Compare planned vs actual: did the wave order survive contact? How many gap-fix loops were required? Which tasks slipped or were deferred? What blocked progress? Watch for: rework caused by missing context, deferrals that hide unresolved scope, planning estimates that systematically miss.

**quality**:
> Cluster the verification gaps, review findings, and antipatterns. Which files appear in multiple severity buckets? Which categories of bug recurred? Which UAT blockers slipped past static review? Watch for: recurring antipattern shapes, files with cross-dimension findings, test coverage gaps that mirror the gap list.

**decision**:
> Reconstruct the key decisions made during the phase, their stated rationale, and the alternatives rejected. Where did mid-phase pivots happen and why? What constraints surfaced late? Watch for: decisions made without recorded rationale, late pivots that suggest weak upfront framing.

### Spawn pattern

Spawn all lenses in parallel. Collect into `lens_results`. If any fails, log W001, proceed with successful lenses; flag retrospective as [LOW CONFIDENCE] (partial lenses).

**GATE Step 4→5**: REQUIRED lens analyses complete BEFORE synthesis; BLOCKED if lens_results missing. **GATE: lenses-complete**

---

## Step 5: synthesize

### Generate insight IDs

`INS-{8 lowercase hex}` via stable hash of `phase_num + lens + title` (idempotent).

### Build retrospective.json

Structure: `{ phase, phase_slug, phase_title, retrospected_at, lenses_run, metrics, delta, findings_by_lens, distilled_insights, routing_recommendations, tweetable }`. Each insight's `routed_id` is null (populated in Step 6).

### Build retrospective.md

Sections: Header (tweetable, metadata) → Metrics table → Delta table (if --compare) → Findings by Lens → Distilled Insights → Routing Recommendations.

Write both to the current retrospective `{run_dir}/outputs/`.

Both `{run_dir}/outputs/retrospective.json` and `{run_dir}/outputs/retrospective.md` MUST exist before completion; BLOCKED if missing.

---

## Step 6: route_outputs

**Skip if `--no-route`.** Prompt user per recommendation (skip if `-y`).

### Display routing table

```
=== ROUTING RECOMMENDATIONS ===

  ID              Target  Lens       Title
  ──────────────  ──────  ─────────  ───────────────────────────────────
  INS-a1b2c3d4    spec    technical  Standardize JWT refresh rotation
  INS-b2c3d4e5    issue   quality    Recurring null-deref in handlers
  INS-c3d4e5f6    note    process    Wave 3 always slips by 2 tasks

Accept all? [Y/n/i for individual]
```

### Per-target routing

#### Target: spec

Route spec-routed insights as `<spec-entry>` entries into the appropriate target file. Map insight type to roles:

```
Map insight type → roles → target file:
  pattern/convention → implement → coding-conventions.md
  adr-candidate/architecture → plan → arch-decisions.md
  quality-related → review → quality-conventions.md

Append <spec-entry> to .workflow/specs/{target_file} with:
  roles, keywords (3-5 extracted from title+summary), date, source="retrospective"
  Body: insight title, summary, evidence refs, phase/lens/INS_id/confidence metadata

Create target file with roles frontmatter if it does not exist.

insight.routed_id = "{target_file}#INS-{INS_id}"
```

#### Target: note

```
Invoke manage-knowhow-capture tip with:
  text = "[Retro phase {NN} / {lens}] {insight.title}: {insight.summary}"
  tags = insight.tags + ["retrospective", "phase-{NN}", insight.lens]

insight.routed_id = "TIP-{captured_id}"
```

Fallback: if skill ID cannot be captured, write tip file directly and flag tip as [LOW CONFIDENCE] (skill not captured).

#### Target: issue

Append a new entry to `.workflow/issues/issues.jsonl` matching the canonical issue schema.

```
Ensure .workflow/issues/issues.jsonl exists.

Generate issue_id = "ISS-{YYYYMMDD}-{NNN}" (next sequence from issues.jsonl + issue-history.jsonl).

Map insight.category → severity:
  antipattern→high, gotcha→medium, pattern/decision/tool/technique→low, default→medium
Map severity → priority: critical→1, high→2, medium→3, low→4

Create issue per canonical schema:
  title: "[Retro] {insight.title}" (max 100 chars)
  source: "retrospective", phase_ref: phase_slug, gap_ref: insight.id
  description: insight.summary
  fix_direction: "Surfaced by phase {NN} retrospective ({lens} lens). Review evidence refs."
  tags: insight.tags + ["retrospective", "phase-{NN}", insight.lens]
  Initial issue_history entry with actor="retrospective"

Append to .workflow/issues/issues.jsonl
insight.routed_id = issue_id
```

### Update retrospective.json with routed_ids

After all routings complete, re-write `retrospective.json` with the `routed_id` field on each insight populated. Re-render `retrospective.md` routing recommendations table to show the resolved IDs. **GATE: insights-routed**

---

## Step 7: persist_insights

Append every distilled insight (including `routed_to: "none"`) to the knowhow store. Require user confirmation (or `-y` flag) before writing to external stores.

### Bootstrap

```
Ensure .workflow/specs/ exists and learnings.md exists.
Create learnings.md with frontmatter (title, type: spec, roles: [implement]) if new.
```

### Append entries

For each insight in `distilled_insights`, append a `<spec-entry>` to `.workflow/specs/learnings.md`:

```html
<spec-entry category="{insight.category}" keywords="{insight.tags joined by comma}" date="{YYYY-MM-DD}" id="{insight.id}" source="retrospective">

### {insight.title}

{insight.summary}

- **Phase**: {phase} ({phase_slug})
- **Lens**: {insight.lens}
- **Confidence**: {insight.confidence}
- **Evidence**: {insight.evidence_refs}
- **Routed to**: {insight.routed_to} ({insight.routed_id or "—"})

</spec-entry>
```

Also append each insight to `.workflow/specs/learnings.md` as `<spec-entry>` with `category="learning"`.

---

## Step 8: next_step

Print: phase, lenses run, insight count, routing summary, output paths.

Next steps: `manage-status` | `manage-issue list --source retrospective` | `manage-knowhow list` | `milestone-audit`

If range/all mode: loop Steps 3-8 per phase, then print aggregate summary.

---

## Schemas

### retrospective.json

```json
{
  "phase": 1,
  "phase_slug": "01-auth",
  "phase_title": "Authentication",
  "retrospected_at": "2026-04-11T10:00:00Z",
  "lenses_run": ["technical", "process", "quality", "decision"],
  "metrics": {
    "tasks_planned": 12,
    "tasks_completed": 10,
    "tasks_deferred": 2,
    "gaps_found": 5,
    "gaps_closed": 4,
    "antipatterns": 3,
    "constraint_violations": 0,
    "issues_opened": 4,
    "issues_closed": 3,
    "rework_iterations": 1,
    "severity_distribution": { "critical": 0, "high": 2, "medium": 8, "low": 11, "total": 21 },
    "review_verdict": "WARN",
    "review_level": "standard",
    "uat_blockers": 0
  },
  "delta": null,
  "findings_by_lens": {
    "technical": {
      "wins":           [{"title": "...", "evidence_refs": ["..."]}],
      "challenges":     [{"title": "...", "evidence_refs": ["..."]}],
      "watch_patterns": [{"title": "...", "evidence_refs": ["..."]}]
    },
    "process":  { "wins": [], "challenges": [], "watch_patterns": [] },
    "quality":  { "wins": [], "challenges": [], "watch_patterns": [] },
    "decision": { "wins": [], "challenges": [], "watch_patterns": [] }
  },
  "distilled_insights": [
    {
      "id": "INS-a1b2c3d4",
      "lens": "technical",
      "category": "pattern",
      "title": "JWT refresh tokens must rotate on every use",
      "summary": "Refresh-on-use prevents replay attacks. Implemented in src/auth/refresh.ts; should become a project-wide convention.",
      "confidence": "high",
      "evidence_refs": [
        "{run_dir}/outputs/20260415-plan-P1-auth/verification.json#gaps[2]",
        "{run_dir}/outputs/20260415-plan-P1-auth/.summaries/TASK-005-summary.md:42"
      ],
      "tags": ["auth", "jwt", "security"],
      "routed_to": "spec",
      "routed_id": "coding-conventions.md#INS-a1b2c3d4"
    }
  ],
  "routing_recommendations": [
    { "insight_id": "INS-a1b2c3d4", "target": "spec", "rationale": "Reusable security pattern" }
  ],
  "tweetable": "Phase 1 (auth): 10 tasks shipped, 4/5 gaps closed, verdict WARN. Insight: JWT refresh tokens must rotate on every use."
}
```

### spec-entry (in specs/learnings.md)

```html
<spec-entry category="coding" keywords="pattern,auth,jwt,security" date="2026-04-11" id="INS-a1b2c3d4" source="retrospective">

### JWT refresh tokens must rotate on every use

Refresh-on-use prevents replay attacks. Implemented in src/auth/refresh.ts; should become a project-wide convention.

- **Phase**: 1 (01-auth)
- **Lens**: technical
- **Confidence**: high
- **Routed to**: spec (coding-conventions.md#INS-a1b2c3d4)

</spec-entry>
```

---

## Success Criteria

- [ ] Mode correctly resolved (scan / single / range / all)
- [ ] At least one phase selected and validated (status == "completed", artifacts exist)
- [ ] All requested lens agents returned valid JSON, or W001 logged for partial coverage
- [ ] `retrospective.json` written with metrics, findings_by_lens, distilled_insights, routing_recommendations
- [ ] `retrospective.md` written and human-readable (metrics table, per-lens findings, insights, routing table)
- [ ] Each insight has a stable `INS-{8hex}` id
- [ ] If routing enabled: every recommendation either created an artifact or was explicitly skipped by user
- [ ] Spec entries (if any) appended as `<spec-entry>` to matching `.workflow/specs/{category-file}.md`
- [ ] Issue rows (if any) match canonical issues.jsonl schema (status "open", full issue_history)
- [ ] `.workflow/specs/learnings.md` appended with one `<spec-entry>` per insight regardless of routing target
- [ ] No existing phase artifacts modified (verification.json, review.json, plan.json untouched)

---

## Error Codes

| Code | Condition | Step |
|------|-----------|-------|
| E001 | `.workflow/` not initialized — run init first | parse_input |
| E002 | Unknown `--lens` name (allowed: technical, process, quality, decision) | parse_input |
| E003 | `--compare` requires a single phase argument | parse_input |
| E004 | Phase has not executed yet — no `.task/` or `.summaries/` artifacts | load_artifacts |
| E005 | Phase argument out of range / phase directory not found | scan_unreviewed |
| W001 | One or more lens agents failed — proceeding with partial coverage | multi_lens_analysis |
| W002 | Existing retrospective found and not `--all` — prompted user | scan_unreviewed |
| W003 | knowhow-capture tip did not return parseable INS id; fell back to direct write | route_outputs |
| W004 | `--compare` target phase has no retrospective.json; delta omitted | load_artifacts |
