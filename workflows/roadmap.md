# Workflow: Roadmap (Light Mode)

Lightweight path from requirements to roadmap without full specification documents.

**Shared logic**: `@roadmap-common.md` (worktree guard, context loading, codebase exploration, external research, minimum-phase principle, roadmap write logic)

---

## Step 1: Session Initialization

Parse flags from `$ARGUMENTS`:
- `--yes` / `-y` → auto mode
- `--continue` / `-c` → resume from last state
- `--mode` / `-m` → `progressive|direct|auto` (default: auto)
- `--from-brainstorm <SESSION-ID>` → import brainstorm session
- Remaining text → requirement (slugified for directory name)

**Session directory**: `.workflow/.roadmap/RMAP-{slug}-{date}/`

**Continue mode**: If `-c` and session exists, resume from last state.

**Brainstorm import**: If `--from-brainstorm`, read `guidance-specification.md` for enriched context (problem statement, features, non-goals, terminology).

---

## Step 2: Requirement Understanding & Strategy

**Objective**: Parse requirement, assess uncertainty, select decomposition strategy.

1. **Parse Requirement**
   - Extract: goal, constraints, stakeholders, keywords
   - If `--from-brainstorm`: enrich from guidance-specification.md
   - If `project_context` loaded: merge into requirement analysis
     - Cross-reference requirement against `already_shipped` — flag overlaps as "already done"
     - Promote `deferred_from_previous` items into active requirement scope
     - Apply `locked_decisions` as constraints

2. **Codebase Exploration** — follow roadmap-common.md

3. **External Research** — follow roadmap-common.md

   `apiResearchContext` is passed into:
   - Step 3 (Decomposition): technology complexity informs phase sizing and ordering
   - Step 4 (Refinement): API constraints surface realistic dependency chains

4. **Assess Uncertainty**
   - Factors: scope_clarity, technical_risk, dependency_unknown, domain_familiarity, requirement_stability (each: low/medium/high)
   - >=3 high → progressive, >=3 low → direct, else → ask

5. **Strategy Selection** (skip if `-m` specified or `-y`)
   - Present uncertainty assessment
   - User selects: Progressive or Direct
   - `-y`: use recommended strategy

---

## Step 3: Decomposition

**Objective**: Break requirement into phases via CLI-assisted analysis.

Spawn `cli-roadmap-plan-agent`.
If `apiResearchContext` is set: include as "External API Research" context in the agent prompt.

Apply **Minimum-Phase Principle** from roadmap-common.md.

---

## Step 4: Iterative Refinement

**Objective**: Multi-round user feedback to refine roadmap.

1. **Present Roadmap** — phase count, milestone structure, dependency graph, key success criteria
2. **Gather Feedback** (skip if `-y` or `config.gates.confirm_roadmap == false`)
   - Options: Approve / Adjust Scope / Reorder / Split-Merge / Re-decompose
   - Max 5 rounds
3. **Process Feedback**
   - **Approve**: Run minimum-phase checklist before accepting. If violations found, auto-merge and inform user.
   - **Adjust Scope**: Move features between milestones, modify criteria
   - **Reorder**: Change phase sequencing
   - **Split/Merge**: Break large phases or combine small ones (enforce min 5 tasks, max 2 phases)
   - **Re-decompose**: Return to Step 3 with new strategy
4. **Loop** until approved or max rounds reached

---

## Step 5: Write Outputs

Follow roadmap-common.md **Roadmap Write Logic** (overwrite vs edit rules, state.json update, scratch directory).

---

## Step 6: Handoff

Display summary (strategy, phase count, milestones, roadmap path) and offer next steps:
- `maestro-init` — set up project (if not yet initialized)
- `maestro-plan 1` — plan first phase
- `maestro-brainstorm 1` — explore first phase ideas
- `manage-status` — view project dashboard

---

## Mode: Revise (`--revise [instructions]`)

Revise an existing roadmap while preserving completed phase progress.

**Pre-conditions:**
- `.workflow/roadmap.md` exists
- `.workflow/state.json` exists (for progress tracking)

**Execution flow:**

1. **Load current state**
   - Read `.workflow/roadmap.md` — parse milestones, phases, dependencies, progress markers
   - Read `.workflow/state.json` — get artifact registry, current milestone
   - Identify completed vs in-progress vs pending phases

2. **Obtain revision instructions**
   - If `--revise "instructions text"` provided → use directly as change directive
   - If `--revise` without instructions → use AskUserQuestion to ask user what to change
     - Show current roadmap summary with phase statuses
     - Present options: add/remove/reorder phases, modify scope/criteria/deps, move between milestones
     - Capture change instructions from response

3. **Impact analysis**
   - For each proposed change, assess impact on:
     - Phase dependency chain (re-validate no circular deps)
     - Requirement coverage (every Active requirement still mapped)
     - Completed phases (warn if change invalidates completed work)
     - Existing plan artifacts (warn if plan exists for affected phase)
   - Present impact summary for confirmation

4. **Apply revisions**
   - Update `.workflow/roadmap.md` preserving:
     - Completed phase progress markers (checkmarks, completion dates)
     - Phase numbering for completed phases (renumber only pending phases)
     - Cross-references from state.json artifacts
   - Update `state.json` if milestone structure changed
   - Add revision log entry to roadmap.md metadata section

5. **Post-revision validation**
   - Re-check dependency integrity (no circular deps)
   - Re-check requirement coverage (every Active req mapped)
   - Verify completed phases unaffected

**Next-step routing on completion:**
- Phases changed, need re-analysis → `/maestro-analyze {phase}`
- Phases changed, ready to plan → `/maestro-plan {phase}`
- Only pending phases adjusted → `/maestro-plan` (continue from where left off)

---

## Mode: Review (`--review`)

Read-only health assessment of the current roadmap.

**Pre-conditions:**
- `.workflow/roadmap.md` exists

**Execution flow:**

1. **Load roadmap + execution history**
   - Read `.workflow/roadmap.md` — full structure
   - Read `.workflow/state.json` — artifact registry, milestone progress
   - Cross-reference: for each phase, check ANL/PLN/EXC/VRF artifact status

2. **Assessment dimensions**
   - **Progress tracking**: Actual vs planned per phase, milestone velocity
   - **Drift detection**: Completed phases deviating from original scope (via verify/audit findings)
   - **Relevance check**: Pending phases still aligned with current project goals (from project.md)
   - **Dependency health**: Pending phase dependencies still valid given completed work
   - **Risk assessment**: Identify phases at risk (blocked, scope creep, dependency failures)

3. **Produce review report**
   - Write to `.workflow/scratch/{YYYYMMDD}-roadmap-review.md`
   - Format:
     ```
     === ROADMAP REVIEW ===
     Milestone: {current}
     Progress: {completed}/{total} phases ({percentage}%)
     Drift: {none|minor|significant} | Risk: {low|medium|high}

     Phase Assessment:
       [done] Phase 1: {name} — completed, on-scope
       [~]    Phase 2: {name} — in-progress, {notes}
       [ ]    Phase 3: {name} — pending, {risk/notes}

     Suggested: /maestro-roadmap --revise | /maestro-plan {phase} | /manage-status
     ```

**No state modifications.** Pure assessment + recommendations.
