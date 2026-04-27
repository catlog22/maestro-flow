# Retrospective Workflow

Multi-lens 复盘 of completed phase artifacts. Consumes existing execution outputs (verification.json, review.json, issues.jsonl, .summaries/, state.json, uat.md, plan.json) and routes distilled insights into the spec / note / issue / lessons stores.

This is a **post-execution analysis** workflow. It reads only — until the routing stage, where it writes new spec stubs, issue rows, memory entries, and lesson rows. It never modifies existing phase artifacts.

---

## Prerequisites

- `.workflow/` initialized (`.workflow/state.json` exists)
- At least one completed phase (via artifact registry in state.json)
- Target phase has been executed (has `.task/` and `.summaries/`)
- `maestro delegate` available (used for the four lens analyses via Agent calls)

---

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

For each selected phase (using `candidate.phase_dir` resolved in Stage 2), build the in-memory artifacts bundle:

```
artifact_dir = candidate.phase_dir  (resolved from artifact registry)

Load artifacts bundle from artifact_dir:
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

Spawn one Agent per active lens **in parallel** (single message, multiple Agent calls). Each agent receives the artifacts bundle as a structured context block in its prompt and returns JSON.

**All agent calls use `run_in_background: false`** (subagents cannot receive hook callbacks).

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

Spawn all active lenses in parallel as `general-purpose` Agents (run_in_background: false), each receiving the rendered lens prompt template.

Collect results into `lens_results = { technical, process, quality, decision }`. If any lens fails, log W001 and proceed with successful lenses.

---

## Stage 5: synthesize

Merge lens results into the canonical retrospective record.

### Generate insight IDs

Assign `INS-{8 lowercase hex}` per insight using stable hash of `phase_num + lens + title` (idempotent across re-runs).

### Build retrospective.json

Assemble the canonical record with structure: `{ phase, phase_slug, phase_title, retrospected_at, lenses_run, metrics, delta, findings_by_lens, distilled_insights, routing_recommendations, tweetable }`. See full schema in [Schemas](#retrospectivejson) section. Each insight's `routed_id` is null here (populated in Stage 6).

### Build retrospective.md (human-readable)

Render a markdown report with these sections:
1. **Header**: tweetable quote, phase metadata, lenses run
2. **Metrics table**: all metrics fields from Stage 3
3. **Delta table** (if --compare): ± values for key metrics
4. **Findings by Lens**: for each lens → numbered wins, challenges, watch_patterns with evidence_refs
5. **Distilled Insights**: per insight → category, lens, confidence, tags, routed_to, summary, evidence refs
6. **Routing Recommendations table**: insight_id | target | rationale

Write both `{artifact_dir}/retrospective.json` and `{artifact_dir}/retrospective.md`.

---

## Stage 6: route_outputs

**Skip entirely if `--no-route` flag is set.**

For each routing recommendation, prompt the user (unless `--auto-yes`) and execute the routing action.

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

Route spec-routed insights as `<spec-entry>` entries into the appropriate category file. Map insight type to category:
- `pattern` / `convention` → `coding`
- `adr-candidate` / architecture → `arch`
- quality-related → `quality`

```
Map insight type → category → target file:
  pattern/convention → coding → coding-conventions.md
  adr-candidate/architecture → arch → arch-decisions.md
  quality-related → quality → quality-conventions.md

Append <spec-entry> to .workflow/specs/{target_file} with:
  category, keywords (3-5 extracted from title+summary), date, source="retrospective"
  Body: insight title, summary, evidence refs, phase/lens/INS_id/confidence metadata

Create target file with category frontmatter if it does not exist.

insight.routed_id = "{category_file}#INS-{INS_id}"
```

#### Target: note

Reuse the existing `manage-learn` skill in tip mode — do not duplicate the learning pipeline.

```
Invoke manage-learn tip with:
  text = "[Retro phase {NN} / {lens}] {insight.title}: {insight.summary}"
  tags = insight.tags + ["retrospective", "phase-{NN}", insight.lens]

insight.routed_id = "TIP-{captured_id}"
```

Fallback: if skill ID cannot be captured, write tip file directly per `workflows/memory.md` Part B Step 3 and update `wiki-index.json` per Step 4.

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

## Stage 7: persist_lessons

Append every distilled insight (regardless of routing target, including `routed_to: "none"`) to the lessons store.

### Bootstrap

```
Ensure .workflow/learning/lessons.jsonl and learning-index.json exist.
Initialize learning-index.json with {"entries":[],"_metadata":{"created":"...","version":"1.0"}} if new.
```

### Append rows

For each insight in `distilled_insights`, append a JSON line to `.workflow/learning/lessons.jsonl` with fields:
`{ id, phase, phase_slug, lens, category, title, summary, confidence, tags, evidence_refs, routed_to, routed_id, source: "retrospective", captured_at }`

### Update index

Append an entry to `.workflow/learning/learning-index.json` entries[] for each new insight:
`{ id, type: "insight", timestamp, file: "lessons.jsonl", summary (80 chars), tags, lens, category, phase, phase_slug, confidence, routed_to, routed_id }`

### Backward-compat append to specs/learnings.md

Append learnings to `.workflow/specs/learnings.md` (shared with milestone-complete's learning extraction) using `<spec-entry>` closed-tag format:

```
Append each insight to .workflow/specs/learnings.md as <spec-entry> with:
  category="learning", keywords (3-5 extracted), date, source="retrospective"
  Body: title, summary, phase/lens/INS_id metadata

Create file with category frontmatter + "## Entries" header if it does not exist.
```

---

## Stage 8: next_step

Print confirmation banner and route the user.

```
Print banner: phase, lenses run, insight count, routing summary (spec/note/issue/lesson counts with target paths), output file paths.

Suggested next steps:
  manage-status                              — Review project state
  manage-issue list --source retrospective   — Triage created issues
  manage-learn list                          — Browse the lessons library
  maestro-milestone-audit                    — Audit milestone if all phases done
```

If `mode == "range"` or `--all`, loop Stages 3-8 per phase, then print aggregate batch summary (phases retrospected, total insights/specs/notes/issues).

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
        ".workflow/scratch/plan-auth-2026-04-15/verification.json#gaps[2]",
        ".workflow/scratch/plan-auth-2026-04-15/.summaries/TASK-005-summary.md:42"
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

### lessons.jsonl row

One JSON object per line:

```json
{"id":"INS-a1b2c3d4","phase":1,"phase_slug":"01-auth","lens":"technical","category":"pattern","title":"JWT refresh tokens must rotate on every use","summary":"...","confidence":"high","tags":["auth","jwt","security"],"evidence_refs":["..."],"routed_to":"spec","routed_id":"coding-conventions.md#INS-a1b2c3d4","source":"retrospective","captured_at":"2026-04-11T10:00:00Z"}
```

### learning-index.json

```json
{
  "entries": [
    {
      "id": "INS-a1b2c3d4",
      "type": "insight",
      "timestamp": "2026-04-11T10:00:00Z",
      "file": "lessons.jsonl",
      "summary": "JWT refresh tokens must rotate on every use",
      "tags": ["auth", "jwt", "security"],
      "lens": "technical",
      "category": "pattern",
      "phase": 1,
      "phase_slug": "01-auth",
      "confidence": "high",
      "routed_to": "spec",
      "routed_id": "coding-conventions.md#INS-a1b2c3d4"
    }
  ],
  "_metadata": {
    "created": "2026-04-11T10:00:00Z",
    "version": "1.0"
  }
}
```

