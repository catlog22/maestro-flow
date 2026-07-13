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

**Run directory**: standard `{run_dir}` from `maestro run create`

**Continue mode**: If `-c` and run exists, resume from last state.

**Context import**: `--from` resolves to context-package (brainstorm:ID / @file / path / alias).

---

## Step 2: Requirement Understanding & Strategy

1. **Parse Requirement** — Extract goal, constraints, stakeholders, keywords
   - `--from`: enrich from upstream context (`requirements`, `constraints[locked]`, `domain`, `non_goals`, `insights`, `open_questions`)
   - `project_context`: cross-reference `already_sealed` sessions, promote `planned_sessions` items, apply `locked_decisions`

2. **Codebase Exploration** — MANDATORY: execute ~/.maestro/workflows/roadmap-common.md Codebase Exploration logic; REQUIRED produce: codebase context summary; BLOCKED if missing

3. **External Research** — MANDATORY: execute ~/.maestro/workflows/roadmap-common.md External Research logic; REQUIRED produce: apiResearchContext (or [LOW CONFIDENCE] if none)

   `apiResearchContext` is passed into:
   - Step 3 (Decomposition): technology complexity informs session sizing and dependency ordering
   - Step 4 (Refinement): API constraints surface realistic dependency chains

4. **Assess Uncertainty** — 5 factors (scope_clarity, technical_risk, dependency_unknown, domain_familiarity, requirement_stability). >=3 high → progressive, >=3 low → direct, else → ask

5. **Strategy Selection** (skip if `-m` or `-y`) — Present assessment, user selects Progressive or Direct

---

## Step 3: Decomposition

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `cli-roadmap-plan-agent` (include `apiResearchContext` if set). Apply **Session Decomposition Principle** from ~/.maestro/workflows/roadmap-common.md.

Output: session DAG with dependency edges, scoped requirements, and seed data per session.

---

## Step 4: Iterative Refinement

1. **Present Session DAG**
2. **Gather Feedback** (skip if `-y`): Approve / Adjust Scope / Reorder DAG / Split-Merge Sessions / Re-decompose. Max 5 rounds.
3. **Process**: Approve (run session sizing checklist first) | Adjust scope | Reorder dependencies | Split/Merge (min 5 tasks, max 3 sessions unless justified) | Re-decompose (→ Step 3)
4. **Loop** until approved or max rounds

---

## Step 5: Write Outputs

Write to `{run_dir}/outputs/` following ~/.maestro/workflows/roadmap-common.md **Roadmap Write Logic**:

1. **`roadmap.json`** — Session DAG with `_meta.kind: "roadmap"`, `_meta.schema: "roadmap/1.0"`, `_meta.role: "primary"`, `_meta.alias: "current-roadmap"`
2. **`roadmap.md`** — Human-readable session summary using `@templates/roadmap.md` with frontmatter `kind: roadmap`
3. **Register sessions** in `state.json.sessions[]` with `status: "planned"`, `roadmap_artifact_id`, and `seed_ref`

---

**GATE Step 5→6**: REQUIRED `outputs/roadmap.json` AND `outputs/roadmap.md` written BEFORE handoff.
Glob `{run_dir}/outputs/roadmap.json` MUST exist before Step 6 handoff; BLOCKED if missing.

## Step 6: Handoff

Display DAG summary and recommend activation of root session(s):

Use `AskUserQuestion` to confirm which root session to activate:
```
question: "Roadmap 完成。推荐激活 root session: {first-root-slug}，是否确认？"
options:
  - "激活推荐 session"
  - "选择其他 session"
  - "暂不激活"
```

If confirmed → set `state.json.active_session_id` to selected session.

Next steps: `/maestro-analyze {active-session-slug}` | `/maestro-blueprint` | `/manage-status`

---

## Mode: Revise (`--revise [instructions]`)

1. **Load state** — read `current-roadmap` artifact via alias resolution (NOT `.workflow/roadmap.md`). Parse `roadmap.json` for current session DAG.
2. **Get instructions** — from flag text or AskUserQuestion
3. **Impact analysis** — dependency chain, requirement coverage, sealed sessions (immutable). Confirm.
4. **Apply** — preserve sealed sessions (NEVER modify), update planned/running sessions, adjust DAG edges
5. **Validate** — no circular deps, requirement coverage intact, sealed sessions unaffected
6. **Write** — new Run `outputs/roadmap.json` + `outputs/roadmap.md`. Update `state.json.sessions[]` for changed entries.

Next: `/maestro-analyze {session-slug}` | `/maestro-plan --session {slug}`

---

## Mode: Review (`--review`)

Read-only health assessment. No state modifications.

1. **Load** — read `current-roadmap` artifact + `state.json.sessions[]`, cross-reference session statuses
2. **Assess** — progress tracking, drift detection, relevance, dependency health, risk
3. **Report** → `{run_dir}/outputs/`

```
=== ROADMAP REVIEW ===
Sessions: {total} ({sealed}/{total} sealed)
Progress: {percentage}%
Drift: {none|minor|significant} | Risk: {low|medium|high}

Session Assessment:
  [done] auth-setup — sealed, on-scope
  [~]    payment — running, {notes}
  [ ]    notification — planned, dep-ready

Suggested: /maestro-roadmap --revise | /maestro-analyze --session {next} | /manage-status
```
