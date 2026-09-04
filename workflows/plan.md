---
name: plan
prepare: plan
commands: [maestro-plan]
session-mode: inherited
---

# Workflow: Plan

5-step pipeline: Context Collection → Clarification → Planning → Plan Checking → Confirmation.

Produces a two-layer plan: `outputs/plan.json` (overview, with task_ids[] and wave references) + `outputs/tasks/TASK-{NNN}.json` (individual task definitions) + waves/dependency-graph/collision-report.

## Pipeline / FSM

```
Step 1 Context Collection → Step 2 Clarification → Step 3 Planning → Step 4 Plan Checking → Step 4.5 Collision → Step 5 Confirmation

Mode routing:
  --check <plan-dir>  → Check Mode (Step 4 only, read-only)
  --revise            → Revise Mode (load → modify → Step 4)
  --tdd               → TDD Mode: Step 1 → Step 2 → Step 3(TDD task chain) → Step 4 → Step 4.5 → Step 5
  default             → Create Mode: Step 1 → Step 2 → Step 3 → Step 4 → Step 4.5 → Step 5
```

## Scope Determination

```
--from <upstream alias>  → scope=standalone, seed task generation from the upstream findings' implementation_scope
--gaps                   → load issue/debug/review/verification/UAT gaps, skip Step 1 exploration, only plan gap fixes
numeric arg              → scope=milestone, resolve slug from roadmap
no arg + roadmap         → scope=milestone (current milestone)
no arg + no roadmap      → find the most recent analyze artifact; if present standalone, if not E001
```

Agent mode (auto-selected by scope):
- **single agent** (default): ≤3 modules, 1 workflow-planner, ≤8 tasks
- **2+1 agent** (auto-triggered when >3 modules): 2 parallel planners each scoped to 2-3 modules (each ≤8 tasks, total ≤16) + 1 synthesis agent (merge tasks, DAG analysis, cycle detection, cross-module conflicts, terminology consistency, wave ordering) → unified plan.json

## Step Gates (Create mode, mandatory blocking)

**GATE: context-collected (Step 1 → Step 2)**
- upstream context loaded (analyze findings / --from source / roadmap)
- codebase docs read (if ARCHITECTURE.md / FEATURES.md exist)
- Wiki searched by phase keywords
- Blocking: no context source at all → E001

**GATE: plan-generated (Step 3 → Step 4)**
- plan.json + tasks/TASK-*.json written out by the planner agent
- inline planning in the main flow is FORBIDDEN
- Blocking: planner produced no plan.json or tasks → cannot proceed to checking

**GATE: plan-checked (Step 4 → Step 5)**
- plan-checker passes (or minor issues confirmed)
- boundary grill complete
- confidence scored via the 5-dimension factor model
- highest-complexity task completed a pressure pass
- UI plan: every delivery wave has a `[UI-observable]` criterion
- Blocking: checker found a critical, or a UI plan lacks `[UI-observable]` coverage

**GATE: plan-confirmed (Step 5 → wrap-up)**
- user confirms (execute/modify/cancel)
- Blocking: no confirmation → don't register artifacts, don't report completion

---

## Process

### Step 1: Context Collection

Collect all available context:

1. **Upstream decisions**: read from injected aliases
   - `current-analysis` (findings): `decisions[class=locked]` immutable constraints, `[free]` implementer discretion, `[deferred]` exclusion; `findings[]`/recommendation → task scope. If implementation_scope exists: `scope.objective` → task titles, `scope.acceptance_criteria` → convergence.criteria (grep-ified), `scope.target_files` → files[] + read_first[], `scope.priority` → ordering. When present, skip parallel exploration.
   - `latest-review` (review-findings): BLOCK findings retain finding IDs, severity, evidence, impact, suggestion, and affected files. Normalize each record as `finding_id = finding.id`, `affected_files = [finding.file]`, and `location = finding.file + ":" + finding.line` before deduplication. Cluster related findings by shared root cause/module before planning; do not flatten a cross-module review into ad-hoc execute args.
   - `current-blueprint`: requirements + architecture seed tasks
   - `current-analysis.architecture_template_evidence`: reference-only architecture evidence
   - `blueprint`, `grill`, and `brainstorm` context-package `references[]` entries with `type=architecture-template`
   - research `SUMMARY.md` architecture template evidence, when present
2. **Project specs**: `maestro spec load --category arch` → pass to planner as constraints
3. **Codebase docs**: read `.workflow/codebase/doc-index.json` (if it exists), extract relevant feature/component/requirement
4. **Wiki search** (optional): extract 2-5 keywords from phase goal/title → `maestro search "<keywords>" --json` → top 10 as priors; if unavailable record W003 and continue
5. **Design reference** (if any): if `design-ref/MASTER.md` exists load design-tokens/animation-tokens/layout; each UI task's read_first[] must include these. Otherwise, when goal matches UI keywords (`landing|page|dashboard|frontend|UI|component|interface`), run `maestro-impeccable --chain build`
6. **Parallel exploration** (skipped when `--gaps` or upstream findings already exist): 1-4 exploration angles (architecture/implementation/integration/risk), spawn 1-4 cli-explore-agent (mandatory, manual Read/Grep is not a substitute), each with goal + success_criteria + one angle → write `{run_dir}/outputs/exploration-{angle}.json`
6b. **CLI supplementary context** (parallel with 6, skipped when `--gaps` or no CLI tool): `maestro delegate` collects implementation context (existing patterns, dependency graph, collision points), MODE analysis, after callback parsing merge into explorationContext's `cli_context`
7. **Gap mode** (`--gaps`): merge gap sources in this priority order — `.workflow/issues/issues.jsonl` (by phase_ref + status in [registered,diagnosed], mark planning) → `latest-review.findings[]` → `verification.json` gaps → `uat.md` "Gaps" → `latest-debug`/`.debug/*/understanding.md` enrichment. Normalize review records with `finding_id = finding.id`, `affected_files = [finding.file]`, and `location = finding.file + ":" + finding.line`; then retain `{finding_id, description, suggestion as fix_direction, severity, evidence, impact, affected_files, location, source:"review"}`. Deduplicate by issue/finding ID first, then normalized root cause + affected files. Cluster review findings that share a root cause/module so the final plan remains within the normal task-count guardrails. If all sources are empty, report error. Set `explorationContext = all_gaps` (skip exploration agents).

### Step 2: Clarification (interactive)

`--auto`/`-y` skips.

1. Aggregate each exploration's `clarification_needs[]`, deduplicate, sort by blocking > important > nice-to-have
2. Interactive clarification (up to 3 rounds, up to 4 questions each), AskUserQuestion, record answers and follow-ups
3. Construct `clarificationContext = { questions_asked, answers, decisions_made }`

### Step 3: Planning

**Rules**:
- The main flow MUST spawn a planner agent (Agent tool); inline planning is FORBIDDEN
- The agent produces plan.json and tasks/TASK-{NNN}.json; the main flow MUST NOT create/modify these files
- Upstream findings (including implementation_scope) MUST be passed into the planner's explorationContext in the same step

**Standard mode**: spawn workflow-planner, passing upstream context, spec-ref, doc-index, explorationContext, clarificationContext, `architecture_template_evidence`, goal + success_criteria. The planner consumes but does not search/load template references.

Task-count guardrails (assess complexity before spawning): single feature/simple change ≤4 tasks; medium (multi-file cross-module) ≤8; large milestone (>3 modules, 2+1) ≤16. If exceeded, re-prompt requesting consolidation.

Agent responsibilities:
1. Decompose goal into tasks (with implementation_scope, 1 scope item → 1 task)
2. Assign task IDs (TASK-001…), define dependencies
3. Group into waves (with scope, order by priority)
4. Estimate complexity/time
5. Set grep-verifiable convergence.criteria (when scope.acceptance_criteria exists, generate from it)
6. Define files per task (from scope.target_files when present), fill read_first[]
7. Pass the evaluated `architecture_template_evidence` envelope to the planner. Store its `{status, query}` in `plan.json.shared_context.architecture_template_search` and only its `templates[]` records in `plan.json.shared_context.architecture_templates`; relevant tasks may reference only resolved `template_id` values in `reference.architecture_template_refs`.

**Deep Work rules** (mandatory in all modes, every TASK JSON must include):

1. **read_first** — what the executor must read before acting: the files being modified + source-of-truth files in the context + any file whose pattern/signature/type/convention must be replicated or followed
2. **convergence.criteria** — grep/read/test/CLI verifiable; no subjective language ("looks correct", "properly configured", "consistent with"); must contain the exact string/pattern/value/command output. E.g.: `auth.ts contains export function verifyToken(` / `test exits 0` / `.env.example contains DATABASE_URL=`
3. **action** — contains concrete values not references; no "align X with Y"/"match X to Y" without specifying the exact target state; contains actual config key/function signature/class name/import path; if the context has a reference table, copy it in verbatim
4. **implementation** steps — each step contains concrete values. Bad: "Update config to match production"; Good: "Add DATABASE_URL=postgresql://..., set POOL_SIZE=20, add REDIS_URL=redis://..."

**Why it matters**: the executor works only from the task JSON; vague instructions produce a shallow one-line change, specific instructions produce complete work.

**Anti-splitting** (passed to the planner, re-prompt on violation): one feature one task (even across 3-5 files, never split by file); consolidate simple unrelated changes into a batch task; use depends_on only for real output dependencies; each task must be substantial (15-60 minutes), fold <5-minute trivial changes together; **UI vertical slice** — a user-visible feature is one end-to-end task/wave (backend endpoint + frontend wiring + integration), never split into pure-backend/pure-frontend; each UI delivery wave has ≥1 task with a `[UI-observable]` criterion.

**Gap mode (`--gaps`)**: spawn workflow-planner, mode=`gap-fix`. Use one task per independent gap or clustered root cause: `type: fix`, `description`, `action` (concrete fix_direction), `read_first` (affected files), `convergence.criteria` (grep-ified), `issue_id` (when source==issue), and `finding_refs[]` (when source includes review); assign ID and wave. After the planner, the main flow back-links bidirectionally: matched issue → `status: planned`; review finding IDs remain immutable requirement references in the generated tasks.

### Step 4: Plan Checking

1. **spawn workflow-plan-checker** (mandatory, not substitutable): input plan.json + all tasks + success_criteria + inherited `architecture_template_evidence`. Check dimensions: requirements coverage, feasibility, dependency correctness (no cycles), convergence quality (grep-verifiable, no subjective language), read_first completeness, action specificity (no vague references), wave structure (no colliding files), completeness (no orphan tasks), UI-observable coverage, and architecture-template evidence. The checker does not search/load templates.
2. **Architecture-template evidence checks**: `shared_context.architecture_template_search` contains only the envelope status/query and `shared_context.architecture_templates` is an array of records; every task template ID resolves to an array record; only `source=arch-kb`, `kind=template`, `reference_only=true` records are valid; adopted/adapted records require rationale and non-empty `applies_to`; a non-loaded status or candidate/rejected record cannot become a task requirement; template IDs remain absent from project-knowledge consumption fields.
3. **Revision loop** (up to 3 rounds): critical → re-spawn planner to revise and re-check; warning only → record and continue
4. **Confidence scoring**: 5 dims (requirements_coverage, task_quality, dependency_correctness, estimation_accuracy, collision_safety) × factors (completeness .30, specificity .25, structural_validity .20, user_validation .15, consistency .10). Re-score each round. Quality mechanisms: Pressure Pass (mandatory before Step 4.5, verifies the highest-complexity task's read_first/convergence/action), Devil's Advocate (coverage>0.7 → "implicit requirement?"), Scope Minimizer, Stall Detection
5. **Readiness Gate** (blocks Step 4.5): blocking conditions — coverage<40% | a task missing read_first/convergence | no pressure pass | circular dependency | invalid architecture-template reference. If blocked → AskUserQuestion: revise / ignore risk and continue (record residual_risks)

### Step 4.5: Collision Detection

`scope==standalone` skips (no milestone to compare against).

```
1. Collect task.files[] from all completed plans in the same milestone
2. Collect the new plan's task.files[]
3. Intersect → collisions (non-blocking warning)
   collision → WARN "{file} ← already planned in {plan_ids}"
   no overlap → "collision check passed"
```
Only check `task.files[]` (write targets); `read_first[]` (read-only references) is excluded.

### Step 5: Confirmation

Planner, checker, revise, and check mode do not perform a new template search or load; they consume inherited evidence only.

1. **Present plan summary**: objective, approach, task count, wave structure, complexity, key dependencies, plan confidence (overall %, weakest dimension, pressure pass result)
2. **AskUserQuestion** (skip and auto-pass if `config.gates.confirm_plan == false`): Execute now / Verify plan quality (re-run Step 4 more strictly) / Just view / Modify (change specified tasks, back to Step 4)

---

## Output Skeleton

**outputs/plan.json**:
```json
{
  "objective": "",
  "requirement_refs": [],
  "task_ids": [],
  "wave_ids": [],
  "confidence": 0,
  "constraints": [],
  "acceptance_criteria": [],
  "shared_context": {
    "architecture_template_search": null,
    "architecture_templates": []
  }
}
```

`plan/1.0` also admits the canonical external-approval variant produced by `maestro plan publish`: `{ source_format: "pi-markdown", handoff_key, source_checksum, source_pi_session, revision, approved_at, markdown }` plus the standard `_meta`. In that variant `markdown` is the complete authoritative Plan; downstream `execute` and `verify` must use their explicit `pi-markdown` interpretation branch and must not assume `task_ids` or `wave_ids` exist.

**outputs/tasks/TASK-NNN.json** (multiple files of the same kind, needs `_meta` override):
```json
{
  "_meta": { "kind": "plan-task", "schema": "plan-task/1.0", "role": "attachment" },
  "id": "TASK-001",
  "title": "",
  "description": "",
  "requirement_refs": [],
  "deps": [],
  "files": [],
  "read_first": [],
  "convergence_criteria": [],
  "verify": [],
  "status": "pending"
}
```

**outputs/waves.json**, **outputs/dependency-graph.json**, **outputs/collision-report.json**. If a plan check runs, write `outputs/plan-check.json`.

### report frontmatter

Write `report.md`, frontmatter containing at least `verdict`, `summary`, `constraints`, `decisions`, `concerns` plus:
```yaml
next:
  - { command: execute, reason: plan ready, needs: [current-plan] }
```
Body has fixed sections `Summary`, `Conclusion/Verdict`, `Discussion/Retrospective`, `Artifacts`, `Handoff/Next`, reference `current-plan` via aref, never copy the JSON source of truth.

→ Wrap-up (archiving, spec/knowhow candidate extraction) follows ref/finish-work.md — staging happens BEFORE seal; the corpus is written only via post-seal promote.

---

## Success Criteria

- [ ] Upstream context loaded (analysis/debug/blueprint/roadmap)
- [ ] Scope determined (single-agent ≤3 modules or 2+1 agent >3 modules)
- [ ] plan.json generated by planner agent (not inline)
- [ ] Every task has acceptance ref, dependencies, expected files, convergence criteria
- [ ] Convergence criteria are grep-verifiable (no subjective language)
- [ ] Wave DAG has no file write conflicts within same wave
- [ ] Plan-checker passed (or minor issues confirmed)
- [ ] Architecture-template evidence is resolved, recorded, and reference-only
- [ ] User confirmed (execute/modify/cancel)

---

## Domain Invariants

- Every task must map to an acceptance/requirement ref, declare dependencies, expected files, verification method, and convergence criteria.
- convergence.criteria must be grep-verifiable, no subjective language.
- action/implementation must contain concrete values, no vague references.
- Inline planning in the main flow is FORBIDDEN; plan.json and tasks are produced only by the planner agent.
- Architecture template IDs must resolve from `plan.json.shared_context.architecture_templates` and must not appear in project-knowledge consumption fields.
- A UI plan must have a `[UI-observable]` criterion in every delivery wave; vertical slices cannot be split into pure front/back-end.

## Revise Mode (`--revise`)

Incrementally modify an existing plan, do not rebuild.

1. **Discover plan**: if `--dir` is specified use it directly; otherwise take the most recent completed plan of the current milestone; if none E004
2. **Load**: read plan.json + all tasks, show current summary (task count, waves, per-task status). Inherit any `architecture_template_evidence`; do not search/load templates.
3. **Get revision instructions**: `--revise "instructions"` parsed into change directives; if no instructions AskUserQuestion (add/remove tasks / modify scope-action-implementation / reorder waves or dependencies / update convergence)
4. **spawn workflow-planner to revise**: input existing plan.json + tasks + parsed instructions + explorationContext + templates + inherited architecture evidence. Planner: modify affected tasks in place; on add/remove reorder IDs and waves; update plan.json summary; preserve unchanged tasks without a new template search/load
5. **Re-run Step 4** + collision, show results and confirm
6. **Update artifacts**: overwrite plan files in the existing directory (don't create new artifacts)

## Check Mode (`--check`)

Read-only validation, no file changes.

1. Load plan.json + tasks (if none E005) + roadmap from the `--check` path; consume any plan-level `shared_context.architecture_templates` only.
2. Run plan-checker (task quality, convergence), roadmap consistency, collision, dependency completeness; do not search/load templates
3. Produce report:
```
=== PLAN CHECK ===
Plan: {plan_dir}/plan.json
Tasks: {total} ({completed} done, {pending} pending)
Checker: {PASS|WARN|FAIL} ({issues} issues)
Roadmap: {aligned|drift detected}
Collision: {clear|{N} overlaps}
```

---

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No arg no roadmap | Provide a milestone number or topic, or create a roadmap first |
| E004 | No plan to revise | Specify `--dir`, or create a plan first |
| E005 | Plan directory not found (--check) | Check the path or use `--dir` |
| E006 | Planner produced invalid JSON | Retry once, then abort with details |
| W001 | Exploration agent failed | Record, continue with existing exploration; mark plan [LOW CONFIDENCE] |
| W002 | Plan-checker exceeded 3 rounds | Accept the plan with warnings, record in index; mark [LOW CONFIDENCE] |

## Knowledge Hooks

- Stage locked constraints and accepted decisions in `report.md` frontmatter (`constraints`/`decisions`); sealing converts them to spec candidates.
- Reusable planning recipes → `maestro knowledge stage knowhow "<title>" --content-file <path|-> --run <run-id>` before completion.
