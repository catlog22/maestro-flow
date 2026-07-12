<!-- session-mode: inherited -->
# Retrospective Workflow

## Run Mode Contract

This workflow executes inside the Run created by its command. The command-provided `run_id`, `run_dir`, and resolved `upstream` are authoritative. Formal outputs belong in `{run_dir}/outputs/`, evidence in `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`. Protocol JSON is CLI-owned.

### Legacy Compatibility Mapping

Legacy references to `scratch/`, hidden command directories, milestone/phase artifact folders, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with `maestro run check` plus `maestro run complete`.

## Argument Shape

```
/quality-retrospective                          → auto-scan unreviewed phases, prompt selection
/quality-retrospective <N>                      → retrospect single phase
/quality-retrospective <N>..<M>                 → retrospect range (inclusive)
/quality-retrospective --all                    → re-run for every completed phase (force)
/quality-retrospective <N> --lens <name>        → restrict to one lens (technical|process|quality|decision|all)
/quality-retrospective <N> --no-route           → produce retrospective.{md,json} only, skip auto-create of spec/note/issue
/quality-retrospective <N> --compare <M>        → delta vs phase M (gstack-style trend)
```

| Flag | Effect |
|------|--------|
| `--lens <name>` | Run only the named lens. Default: all four. Repeatable. |
| `--no-route` | Synthesize but skip Stage 6 (no spec/note/issue creation). |
| `--all` | Force re-run for every completed phase (overwrites existing retrospective.json after archiving). |
| `--compare <M>` | Load phase M's retrospective.json and emit a delta section. |
| `--auto-yes` | Skip routing confirmation prompts; accept all recommendations. |

---

## Stage 1: parse_input

```
Require .workflow/ exists (E001).
Parse $ARGUMENTS → first non-flag token as phase/range/"--all", remaining as flags.

Build config:
  mode       = "scan" | "single" | "range" | "all"
  phases     = [] (filled in Stage 2)
  lenses     = ["technical","process","quality","decision"]
  route      = true (false if --no-route)
  compare_to = null | <phase number>
  auto_yes   = false

Validate: --lens names must be known (E002), --compare requires single mode (E003).
```

---

## Stage 2: scan_unreviewed (mode = "scan" or "all")

```
Read .workflow/state.json → state

candidates = all completed execute artifacts from state.artifacts, each mapped to:
  { number, slug, title, completed_at, has_retro, phase_dir, gaps: 0, review_verdict: "—" }

  where phase_dir = ".workflow/" + artifact.path
        has_retro = exists "{phase_dir}/retrospective.json"
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
| `all` | `phases = candidates` (overwrite existing — archive old retrospective.json to `.history/` first) |
| `single` | `phases = [parsed_phase]` (validate it exists and is completed; if `has_retro` and not `--all`, prompt to overwrite) |
| `range` | `phases = candidates.filter(c => N <= c.number <= M)` |

If overwriting existing retrospective.json:
```
Archive existing retrospective.{json,md} to "{candidate.phase_dir}/.history/retrospective-{YYYY-MM-DDTHH-mm-ss}.{ext}"
```

---

## Stage 3: load_artifacts (per phase)

```
artifact_dir = candidate.phase_dir

Load artifacts bundle:
  index           ← {artifact_dir}/index.json
  state           ← .workflow/state.json
  plan            ← {artifact_dir}/plan.json
  verification    ← {artifact_dir}/verification.json
  review          ← {artifact_dir}/review.json
  uat             ← {artifact_dir}/uat.md
  task_summaries  ← {artifact_dir}/.summaries/TASK-*-summary.md
  task_jsons      ← {artifact_dir}/.task/TASK-*.json
  phase_issues    ← .workflow/issues/{issues,issue-history}.jsonl filtered by phase_ref == slug|NN
  prior_retro     ← if --compare M: load phase M's retrospective.json via artifact registry
```

### Compute base metrics

```
metrics = {
  tasks_planned          ← plan.tasks.length or task_jsons.length
  tasks_completed        ← task_jsons where status=="completed"
  tasks_deferred         ← state.accumulated_context.deferred for this phase
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

If `--compare M` is set, compute delta (current minus prior_retro) for:
```
delta = { vs_phase, tasks_completed, gaps_found, issues_opened, rework_iterations, severity_critical, severity_high }
```

---

## Stage 4: multi_lens_analysis

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn one Agent per active lens **in parallel** (`run_in_background: false`). Each returns JSON.

### Lens registry

| Lens | subagent_type | --rule template (for any inner CLI calls) | Primary inputs | Output candidates |
|------|--------------|-------------------------------------------|----------------|-------------------|
| technical | general-purpose | analysis-analyze-code-patterns | task_summaries, task_jsons, state.accumulated_context.key_decisions | spec stubs |
| process | general-purpose | analysis-trace-code-execution | plan.json (planned), task_jsons (actual), issue_history timestamps, state.deferred | notes |
| quality | general-purpose | analysis-review-code-quality | verification (gaps + antipatterns), review (severity_distribution + findings), phase_issues | issues |
| decision | general-purpose | analysis-review-architecture | state.accumulated_context.key_decisions, task_summaries, plan.json rationale fields | notes (or spec) |

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
- Plan:           {artifact_dir}/plan.json
- Verification:   {artifact_dir}/verification.json
- Review:         {artifact_dir}/review.json
- UAT notes:      {artifact_dir}/uat.md
- Task summaries: {artifact_dir}/.summaries/
- Task JSONs:     {artifact_dir}/.task/
- Phase issues:   .workflow/issues/issues.jsonl (filter phase_ref == "{phase_slug}")
- Project state:  .workflow/state.json (decisions, deferred)

## Pre-computed metrics
{json_dump of metrics block from Stage 3}

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
      "evidence_refs": ["{artifact_dir}/verification.json#gaps[2]", "..."],
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

---

**GATE Stage 4→5**: REQUIRED lens analyses complete BEFORE synthesis; BLOCKED if lens_results missing

## Stage 5: synthesize

### Generate insight IDs

`INS-{8 lowercase hex}` via stable hash of `phase_num + lens + title` (idempotent).

### Build retrospective.json

Structure: `{ phase, phase_slug, phase_title, retrospected_at, lenses_run, metrics, delta, findings_by_lens, distilled_insights, routing_recommendations, tweetable }`. Each insight's `routed_id` is null (populated in Stage 6).

### Build retrospective.md

Sections: Header (tweetable, metadata) → Metrics table → Delta table (if --compare) → Findings by Lens → Distilled Insights → Routing Recommendations.

Write both to `{artifact_dir}/`.

Glob `{artifact_dir}/retrospective.json` AND `retrospective.md` MUST exist before Stage 8 complete; BLOCKED if missing.

---

## Stage 6: route_outputs

**Skip if `--no-route`.** Prompt user per recommendation (skip if `--auto-yes`).

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
- `pattern` / `convention` → `implement`
- `adr-candidate` / architecture → `plan`
- quality-related → `review`

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
Invoke manage-learn tip with:
  text = "[Retro phase {NN} / {lens}] {insight.title}: {insight.summary}"
  tags = insight.tags + ["retrospective", "phase-{NN}", insight.lens]

insight.routed_id = "TIP-{captured_id}"
```

Fallback: if skill ID cannot be captured, write tip file directly per `workflows/knowhow.md` Part B Step 3 and update `wiki-index.json` per Step 4; flag tip as [LOW CONFIDENCE] (skill not captured).

#### Target: issue

Append a new entry to `.workflow/issues/issues.jsonl` matching the canonical schema from `workflows/issue.md` Step 4.

```
Ensure .workflow/issues/issues.jsonl exists.

Generate issue_id = "ISS-{YYYYMMDD}-{NNN}" (next sequence from issues.jsonl + issue-history.jsonl).

Map insight.category → severity:
  antipattern→high, gotcha→medium, pattern/decision/tool/technique→low, default→medium
Map severity → priority: critical→1, high→2, medium→3, low→4

Create issue per canonical schema (workflows/issue.md Step 4):
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

After all routings complete, re-write `retrospective.json` with the `routed_id` field on each insight populated. Re-render `retrospective.md` routing recommendations table to show the resolved IDs.

---

## Stage 7: persist_insights

Append every distilled insight (including `routed_to: "none"`) to the knowhow store.

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

Also append each insight to `.workflow/specs/learnings.md` as `<spec-entry>` with `category="learning"` (backward compat with milestone-complete).

---

## Stage 8: next_step

Print: phase, lenses run, insight count, routing summary, output paths.

Next steps: `manage-status` | `manage-issue list --source retrospective` | `manage-learn list` | `maestro-milestone-audit`

If range/all mode: loop Stages 3-8 per phase, then print aggregate summary.

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
        ".workflow/scratch/20260415-plan-P1-auth/verification.json#gaps[2]",
        ".workflow/scratch/20260415-plan-P1-auth/.summaries/TASK-005-summary.md:42"
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
- **Evidence**: .workflow/scratch/20260415-plan-P1-auth/verification.json#gaps[2]
- **Routed to**: spec (coding-conventions.md#INS-a1b2c3d4)

</spec-entry>
```

