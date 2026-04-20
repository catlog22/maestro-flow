# Retrospective Workflow

Multi-lens 复盘 of completed phase artifacts. Consumes existing execution outputs (verification.json, review.json, issues.jsonl, .summaries/, state.json, uat.md, plan.json) and routes distilled insights into the spec / note / issue / lessons stores.

This is a **post-execution analysis** workflow. It reads only — until the routing stage, where it writes new spec stubs, issue rows, memory entries, and lesson rows. It never modifies existing phase artifacts.

---

## Prerequisites

- `.workflow/` initialized (`.workflow/state.json` exists)
- At least one phase directory under `.workflow/phases/{NN}-{slug}/`
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
1. Verify .workflow/ exists; else error E001.
2. Tokenize $ARGUMENTS:
   - First non-flag token: phase number, range "N..M", or "--all"
   - Flags: --lens, --no-route, --all, --compare, --auto-yes
3. Build:
     mode = "scan" | "single" | "range" | "all"
     phases = [] (filled in Stage 2)
     lenses = ["technical","process","quality","decision"]
     route = true (false if --no-route)
     compare_to = null | <phase number>
     auto_yes = false
4. Validate --lens names. Unknown name → error E002.
5. Validate --compare requires single mode. Else error E003.
```

---

## Stage 2: scan_unreviewed (mode = "scan" or "all")

```
candidates = []
FOR each .workflow/phases/{NN}-{slug}/index.json:
  Read index.json
  IF index.json.status == "completed":
    has_retro = file exists at "{phase_dir}/retrospective.json"
    candidates.push({
      number: NN,
      slug: slug,
      title: index.json.title or slug,
      completed_at: index.json.completed_at,
      has_retro: has_retro,
      gaps: index.json.verification?.gaps?.length or 0,
      review_verdict: index.json.review?.verdict or "—"
    })
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
mkdir -p "{phase_dir}/.history"
TIMESTAMP = format(now(), "YYYY-MM-DDTHH-mm-ss")
mv "{phase_dir}/retrospective.json" "{phase_dir}/.history/retrospective-{TIMESTAMP}.json"
mv "{phase_dir}/retrospective.md"   "{phase_dir}/.history/retrospective-{TIMESTAMP}.md"
```

---

## Stage 3: load_artifacts (per phase)

For each selected phase, build the in-memory artifacts bundle:

```
artifacts = {
  phase_num: NN,
  phase_slug: slug,
  phase_dir: ".workflow/phases/{NN}-{slug}",
  index: read JSON,
  state: read .workflow/state.json,
  plan: read "{phase_dir}/plan.json" or null,
  verification: read "{phase_dir}/verification.json" or null,
  review: read "{phase_dir}/review.json" or null,
  uat: read "{phase_dir}/uat.md" or null,
  task_summaries: read all "{phase_dir}/.summaries/TASK-*-summary.md",
  task_jsons: read all "{phase_dir}/.task/TASK-*.json",
  phase_issues: filter ".workflow/issues/issues.jsonl" + ".workflow/issues/issue-history.jsonl"
                where issue.phase_ref == phase_slug or issue.phase_ref == NN,
  prior_retro: (if --compare M) read .workflow/phases/{MM}-*/retrospective.json
}
```

### Compute base metrics

```
metrics = {
  tasks_planned: plan?.tasks?.length or task_jsons.length,
  tasks_completed: count task_jsons where status == "completed",
  tasks_deferred: state.accumulated_context.deferred?.filter(d => d.phase == NN)?.length or 0,
  gaps_found: verification?.gaps?.length or 0,
  gaps_closed: verification?.gaps?.filter(g => g.status == "closed")?.length or 0,
  antipatterns: verification?.antipatterns?.length or 0,
  constraint_violations: verification?.constraint_violations?.length or 0,
  issues_opened: phase_issues.filter(i => i.source in ["verification","review","antipattern","discovery"]).length,
  issues_closed: phase_issues.filter(i => i.status in ["completed","failed"]).length,
  rework_iterations: count entries in .history/ matching verification-*.json,
  severity_distribution: review?.severity_distribution or {critical:0,high:0,medium:0,low:0,total:0},
  review_verdict: review?.verdict or "not_run",
  review_level: review?.level or null,
  uat_blockers: count blockers parsed from uat.md or 0
}
```

If `--compare M` is set, also compute delta:
```
delta = {
  vs_phase: M,
  tasks_completed: metrics.tasks_completed - prior_retro.metrics.tasks_completed,
  gaps_found:      metrics.gaps_found      - prior_retro.metrics.gaps_found,
  issues_opened:   metrics.issues_opened   - prior_retro.metrics.issues_opened,
  rework_iterations: metrics.rework_iterations - prior_retro.metrics.rework_iterations,
  severity_critical: metrics.severity_distribution.critical - prior_retro.metrics.severity_distribution.critical,
  severity_high:     metrics.severity_distribution.high     - prior_retro.metrics.severity_distribution.high
}
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
- Plan:           {phase_dir}/plan.json
- Verification:   {phase_dir}/verification.json
- Review:         {phase_dir}/review.json
- UAT notes:      {phase_dir}/uat.md
- Task summaries: {phase_dir}/.summaries/
- Task JSONs:     {phase_dir}/.task/
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
      "evidence_refs": ["{phase_dir}/verification.json#gaps[2]", "..."],
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

### Spawn pattern (single message, all lenses parallel)

```
For each lens in lenses:
  Agent({
    subagent_type: "general-purpose",
    description: "Retrospective: {lens} lens for phase {NN}",
    prompt: <rendered lens prompt template>,
    run_in_background: false
  })
```

Collect lens results into `lens_results = { technical: {...}, process: {...}, quality: {...}, decision: {...} }`. If any lens agent fails, log warning W001 and proceed with the lenses that returned.

---

## Stage 5: synthesize

Merge lens results into the canonical retrospective record.

### Generate insight IDs

For each insight across all lenses, generate `INS-{8 lowercase hex chars}` using a stable hash of `phase_num + lens + title` so re-runs do not duplicate.

### Build retrospective.json

```
retrospective = {
  phase: NN,
  phase_slug: slug,
  phase_title: index.title,
  retrospected_at: now() ISO 8601 UTC,
  lenses_run: [...lens names that returned],
  metrics: <from Stage 3>,
  delta: <from Stage 3 if --compare set, else null>,
  findings_by_lens: {
    technical: { wins, challenges, watch_patterns },
    process:   { wins, challenges, watch_patterns },
    quality:   { wins, challenges, watch_patterns },
    decision:  { wins, challenges, watch_patterns }
  },
  distilled_insights: [
    {
      id: "INS-a1b2c3d4",
      lens: "technical",
      category: "pattern",
      title: "...",
      summary: "...",
      confidence: "high",
      evidence_refs: [...],
      tags: [...],
      routed_to: "spec",
      routed_id: null   // filled in Stage 6
    },
    ...
  ],
  routing_recommendations: [
    { insight_id: "INS-a1b2c3d4", target: "spec", rationale: "..." },
    { insight_id: "INS-...", target: "issue", rationale: "..." },
    { insight_id: "INS-...", target: "note",  rationale: "..." }
  ],
  tweetable: "Phase {NN} ({title}): {N} tasks shipped, {gaps} gaps closed, verdict {verdict}. {top_insight_title}"
}
```

### Build retrospective.md (human-readable)

```markdown
# Phase {NN} Retrospective: {title}

> {tweetable}

**Phase**: {phase_slug}
**Retrospected**: {retrospected_at}
**Lenses**: {lenses_run joined by ", "}

## Metrics

| Metric | Value |
|--------|-------|
| Tasks planned / completed / deferred | {planned} / {completed} / {deferred} |
| Gaps found / closed | {gaps_found} / {gaps_closed} |
| Issues opened / closed | {issues_opened} / {issues_closed} |
| Antipatterns | {antipatterns} |
| Constraint violations | {constraint_violations} |
| Rework iterations | {rework_iterations} |
| Review verdict | {review_verdict} ({review_level}) |
| Severity (C/H/M/L) | {critical}/{high}/{medium}/{low} |
| UAT blockers | {uat_blockers} |

{IF delta:
## Delta vs Phase {compare_to}

| Metric | Delta |
|--------|-------|
| Tasks completed | {±N} |
| Gaps found | {±N} |
| Issues opened | {±N} |
| Rework iterations | {±N} |
| Critical findings | {±N} |
| High findings | {±N} |
}

## Findings by Lens

{FOR each lens in [technical, process, quality, decision]:}
### {Lens title}

**Wins**
1. {win.title} — {evidence_refs joined by ", "}
2. ...
3. ...

**Challenges**
1. {challenge.title} — {evidence_refs}
2. ...
3. ...

**Watch patterns**
1. {watch.title} — {evidence_refs}
2. ...
3. ...

{END FOR}

## Distilled Insights

{FOR each insight in distilled_insights:}
### {INS-id}: {title}

- **Category**: {category}
- **Lens**: {lens}
- **Confidence**: {confidence}
- **Tags**: {tags}
- **Routed to**: {routed_to} ({routed_id or "pending"})

{summary}

**Evidence**:
{FOR ref in evidence_refs:} - `{ref}`{END FOR}

{END FOR}

## Routing Recommendations

| Insight | Target | Rationale |
|---------|--------|-----------|
| {INS-id} | spec | ... |
| {INS-id} | issue | ... |
| {INS-id} | note | ... |
```

Write both files:
```
Write "{phase_dir}/retrospective.json"
Write "{phase_dir}/retrospective.md"
```

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

Write a stub spec file directly. Do NOT invoke `spec-generate` (heavyweight 7-phase pipeline).

```
mkdir -p ".workflow/specs"
slug = slugify(insight.title)
spec_file = ".workflow/specs/SPEC-retro-{phase_num}-{INS_id}-{slug}.md"

Write spec_file:
---
status: draft
type: pattern | convention | adr-candidate
source: retrospective
source_phase: {NN}
source_insight: {INS_id}
created_at: {now ISO}
tags: {insight.tags}
confidence: {insight.confidence}
---

# {insight.title}

## Context

Extracted from phase {NN} ({phase_slug}) retrospective by the {lens} lens.
This stub captures a reusable {category} surfaced during execution; expand it
into a full spec via `/maestro-spec-generate` if it warrants project-wide adoption.

## Pattern / Convention

{insight.summary}

## Evidence

{FOR ref in evidence_refs:} - `{ref}`{END FOR}

## Open Questions

- Is this pattern already documented elsewhere?
- Should existing code be migrated to this pattern, or is it forward-only?
- What is the failure mode if this pattern is violated?

## Routing trail

- Phase: {NN}-{phase_slug}
- Lens: {lens}
- Insight: {INS_id}
- Confidence: {confidence}

insight.routed_id = "SPEC-retro-{phase_num}-{INS_id}-{slug}.md"
```

#### Target: note

Reuse the existing `manage-learn` skill in tip mode — do not duplicate the learning pipeline.

```
note_text = "[Retro phase {NN} / {lens}] {insight.title}: {insight.summary}"
tags = insight.tags + ["retrospective", "phase-{NN}", insight.lens]

Skill({
  skill: "manage-learn",
  args: "tip \"{note_text}\" --tag " + tags.join(",")
})

Capture the returned TIP-{id} from the skill output.
insight.routed_id = "TIP-{captured_id}"
```

If the skill call cannot be intercepted to capture the ID, fall back to writing the tip file directly using the schema in `workflows/memory.md` Part B Step 3 (Tip mode), and update `memory-index.json` per Step 4.

#### Target: issue

Append a new entry to `.workflow/issues/issues.jsonl` matching the canonical schema from `workflows/issue.md` Step 4.

```
mkdir -p ".workflow/issues"
touch ".workflow/issues/issues.jsonl"

# Generate next ID for today (scan both active and history)
today = format(now(), "YYYYMMDD")
existing_ids = []
read .workflow/issues/issues.jsonl       → collect ids matching ISS-{today}-*
read .workflow/issues/issue-history.jsonl → collect ids matching ISS-{today}-*
counter = max sequence number from existing_ids + 1, or 1 if none
issue_id = "ISS-{today}-{counter padded to 3 digits}"

# Map insight category → severity (operator on the insight, not finding severity)
severity = match insight.category:
  "antipattern" → "high"
  "gotcha"      → "medium"
  "pattern"     → "low"
  "decision"    → "low"
  "tool"        → "low"
  "technique"   → "low"
  default       → "medium"

priority = match severity:
  critical → 1
  high     → 2
  medium   → 3
  low      → 4

issue = {
  id: issue_id,
  title: "[Retro] {insight.title}" (truncated to 100 chars),
  status: "open",
  priority: priority,
  severity: severity,
  source: "retrospective",
  phase_ref: phase_slug,
  gap_ref: insight.id,
  description: insight.summary,
  fix_direction: "Surfaced by phase {NN} retrospective ({lens} lens). " +
                 "Review evidence refs and determine fix scope.",
  context: {
    location: insight.evidence_refs[0] or "",
    suggested_fix: "",
    notes: "Confidence: " + insight.confidence
  },
  tags: insight.tags + ["retrospective", "phase-" + NN, insight.lens],
  affected_components: [],
  feedback: [],
  issue_history: [
    {
      timestamp: now ISO,
      from_status: null,
      to_status: "open",
      actor: "retrospective",
      note: "Auto-created from phase " + NN + " retrospective insight " + insight.id
    }
  ],
  created_at: now ISO,
  updated_at: now ISO,
  resolved_at: null,
  resolution: null
}

Append serialized JSON line to .workflow/issues/issues.jsonl
insight.routed_id = issue_id
```

### Update retrospective.json with routed_ids

After all routings complete, re-write `retrospective.json` with the `routed_id` field on each insight populated. Re-render `retrospective.md` routing recommendations table to show the resolved IDs.

---

## Stage 7: persist_lessons

Append every distilled insight (regardless of routing target, including `routed_to: "none"`) to the lessons store.

### Bootstrap

```
mkdir -p ".workflow/learning"
touch ".workflow/learning/lessons.jsonl"

INDEX_FILE = ".workflow/learning/learning-index.json"
IF NOT exists INDEX_FILE:
  Write '{"entries":[],"_metadata":{"created":"' + now ISO + '","version":"1.0"}}'
```

### Append rows

For each insight in `distilled_insights`:

```
row = {
  id: insight.id,
  phase: NN,
  phase_slug: phase_slug,
  lens: insight.lens,
  category: insight.category,
  title: insight.title,
  summary: insight.summary,
  confidence: insight.confidence,
  tags: insight.tags,
  evidence_refs: insight.evidence_refs,
  routed_to: insight.routed_to,
  routed_id: insight.routed_id,
  source: "retrospective",
  captured_at: now ISO
}

Append serialized JSON line to .workflow/learning/lessons.jsonl
```

### Update index

```
Read .workflow/learning/learning-index.json
For each new insight:
  Append to entries[]:
    {
      id: insight.id,
      type: "insight",
      timestamp: now ISO,
      file: "lessons.jsonl",
      summary: insight.title (truncated to 80 chars),
      tags: insight.tags,
      lens: insight.lens,
      category: insight.category,
      phase: NN,
      phase_slug: phase_slug,
      confidence: insight.confidence,
      routed_to: insight.routed_to,
      routed_id: insight.routed_id
    }
Write .workflow/learning/learning-index.json
```

### Backward-compat append to specs/learnings.md

Append learnings to `.workflow/specs/learnings.md` (shared with milestone-complete's learning extraction). Append a one-line summary per insight:

```
IF .workflow/specs/learnings.md exists:
  FOR each insight:
    Append under "## Entries":
      ### [{YYYY-MM-DD HH:mm}] {category}: {title}

      {summary}
      Phase: {NN} | Source: retrospective | Insight: {INS_id} | Lens: {lens}
```

If the file does not exist, create it with a `## Entries` header.

---

## Stage 8: next_step

Print confirmation banner and route the user.

```
=== RETROSPECTIVE COMPLETE ===
Phase:           {NN} ({phase_slug})
Lenses run:      {lenses joined by ", "}
Insights:        {count}

Routing summary:
  Specs drafted:   {N}  → .workflow/specs/SPEC-retro-*
  Notes saved:     {N}  → .workflow/memory/TIP-*
  Issues opened:   {N}  → .workflow/issues/issues.jsonl
  Lessons logged:  {N}  → .workflow/learning/lessons.jsonl

Files:
  {phase_dir}/retrospective.md
  {phase_dir}/retrospective.json

Next steps (suggested):
  Skill({ skill: "manage-status" })                                    — Review project state
  Skill({ skill: "manage-issue", args: "list --source retrospective" }) — Triage created issues
  Skill({ skill: "manage-learn", args: "list" })                       — Browse the lessons library
  Skill({ skill: "maestro-milestone-audit" })                          — Audit milestone if all phases done
```

If `mode == "range"` or `--all`, loop Stages 3–8 per phase, then print an aggregate summary at the end:

```
=== RETROSPECTIVE BATCH COMPLETE ===
Phases retrospected: {count}
Total insights:      {sum}
Total specs:         {sum}
Total notes:         {sum}
Total issues:        {sum}
```

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
        ".workflow/phases/01-auth/verification.json#gaps[2]",
        ".workflow/phases/01-auth/.summaries/TASK-005-summary.md:42"
      ],
      "tags": ["auth", "jwt", "security"],
      "routed_to": "spec",
      "routed_id": "SPEC-retro-1-INS-a1b2c3d4-jwt-refresh-rotation.md"
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
{"id":"INS-a1b2c3d4","phase":1,"phase_slug":"01-auth","lens":"technical","category":"pattern","title":"JWT refresh tokens must rotate on every use","summary":"...","confidence":"high","tags":["auth","jwt","security"],"evidence_refs":["..."],"routed_to":"spec","routed_id":"SPEC-retro-1-INS-a1b2c3d4-jwt-refresh-rotation.md","source":"retrospective","captured_at":"2026-04-11T10:00:00Z"}
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
      "routed_id": "SPEC-retro-1-INS-a1b2c3d4-jwt-refresh-rotation.md"
    }
  ],
  "_metadata": {
    "created": "2026-04-11T10:00:00Z",
    "version": "1.0"
  }
}
```

---

## Error Codes

| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | `.workflow/` not initialized — run `Skill({ skill: "maestro-init" })` first |
| E002 | error | Unknown `--lens` name (must be one of: technical, process, quality, decision) |
| E003 | error | `--compare` requires a single phase argument |
| E004 | error | Phase argument resolves to a phase that has not executed yet (no `.task/` or `.summaries/`) |
| E005 | error | Phase argument out of range / phase directory not found |
| W001 | warning | One or more lens agents failed — proceeding with partial lens coverage |
| W002 | warning | Existing retrospective.json found and not `--all`/`--force` — prompted user to overwrite |
| W003 | warning | `manage-memory-capture` skill returned without parseable TIP id; fell back to direct write |
| W004 | warning | `--compare` target phase has no retrospective.json; delta omitted |

---

## Success Criteria

- [ ] `.workflow/` exists and target phase resolved
- [ ] All requested lenses returned valid JSON (or partial-coverage warning W001 logged)
- [ ] `retrospective.json` written with metrics, findings_by_lens, distilled_insights
- [ ] `retrospective.md` written and human-readable
- [ ] Each insight has stable `INS-{8hex}` id
- [ ] Routing executed (unless `--no-route`): every recommendation either created an artifact or was explicitly skipped by user
- [ ] `lessons.jsonl` appended with one row per insight
- [ ] `learning-index.json` updated
- [ ] Issue rows match the canonical issues.jsonl schema (verifiable with `jq`)
- [ ] No existing phase artifacts modified (verification.json, review.json, plan.json, etc. untouched)
- [ ] Confirmation banner printed with routing counts and next-step suggestions
