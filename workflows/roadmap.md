<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Roadmap (Light Mode)

## Step 1: Session Initialization

Parse flags from `$ARGUMENTS`:
- `--yes` / `-y` → auto mode
- `--continue` / `-c` → resume from last state
- `--mode` / `-m` → `progressive|direct|auto` (default: auto)
- `--from <source>` → load upstream context package (brainstorm:ID, @file, or path). Alias: `--from-brainstorm` (backward compat)
- Remaining text → requirement (slugified for directory name)

**Session directory**: `.workflow/.roadmap/RMAP-{slug}-{date}/`

**Continue mode**: If `-c` and session exists, resume from last state.

**Context import**: `--from` resolves to `context-package.json` (`brainstorm:ID` / `@file` / `path/` / `--from-brainstorm` alias).

---

## Step 2: Requirement Understanding & Strategy

1. **Parse Requirement** — Extract goal, constraints, stakeholders, keywords
   - `--from`: enrich from context-package (`requirements`, `constraints[locked]`, `domain`, `non_goals`, `insights`, `open_questions`)
   - `project_context`: cross-reference `already_shipped`, promote `deferred` items, apply `locked_decisions`

2. **Codebase Exploration** — MANDATORY: execute ~/.maestro/workflows/roadmap-common.md Codebase Exploration logic; REQUIRED produce: codebase context summary; BLOCKED if missing

3. **External Research** — MANDATORY: execute ~/.maestro/workflows/roadmap-common.md External Research logic; REQUIRED produce: apiResearchContext (or [LOW CONFIDENCE] if none)

   `apiResearchContext` is passed into:
   - Step 3 (Decomposition): technology complexity informs phase sizing and ordering
   - Step 4 (Refinement): API constraints surface realistic dependency chains

4. **Assess Uncertainty** — 5 factors (scope_clarity, technical_risk, dependency_unknown, domain_familiarity, requirement_stability). >=3 high → progressive, >=3 low → direct, else → ask

5. **Strategy Selection** (skip if `-m` or `-y`) — Present assessment, user selects Progressive or Direct

---

## Step 3: Decomposition

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `cli-roadmap-plan-agent` (include `apiResearchContext` if set). Apply **Minimum-Phase Principle** from ~/.maestro/workflows/roadmap-common.md.

---

## Step 4: Iterative Refinement

1. **Present Roadmap**
2. **Gather Feedback** (skip if `-y`): Approve / Adjust Scope / Reorder / Split-Merge / Re-decompose. Max 5 rounds.
3. **Process**: Approve (run minimum-phase checklist first) | Adjust | Reorder | Split/Merge (min 5 tasks, max 2 phases) | Re-decompose (→ Step 3)
4. **Loop** until approved or max rounds

---

## Step 5: Write Outputs

MANDATORY: apply ~/.maestro/workflows/roadmap-common.md **Roadmap Write Logic** (overwrite vs edit rules, state.json update, Run output directory); REQUIRED produce: .workflow/roadmap.md; BLOCKED if missing

---

**GATE Step 5→6**: REQUIRED roadmap.md written BEFORE handoff.
Glob .workflow/roadmap.md MUST exist before Step 6 handoff; BLOCKED if missing.

## Step 6: Handoff

Display summary and next steps: `maestro-blueprint` | `maestro-plan 1` | `maestro-brainstorm 1` | `manage-status`

---

## Mode: Revise (`--revise [instructions]`)

1. **Load state** — roadmap.md + state.json, identify completed/in-progress/pending
2. **Get instructions** — from flag text or AskUserQuestion
3. **Impact analysis** — dependency chain, requirement coverage, completed phases, existing plans. Confirm.
4. **Apply** — preserve completed phase markers/numbering, update state.json if milestone changed
5. **Validate** — no circular deps, requirement coverage intact, completed phases unaffected

Next: `/maestro-analyze {phase}` | `/maestro-plan {phase}` | `/maestro-plan`

---

## Mode: Review (`--review`)

Read-only health assessment. No state modifications.

1. **Load** — roadmap.md + state.json, cross-reference artifact statuses
2. **Assess** — progress tracking, drift detection, relevance, dependency health, risk
3. **Report** → `{run_dir}/outputs/`

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
