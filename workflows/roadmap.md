# Workflow: roadmap

Interactive roadmap creation with iterative refinement. Lightweight path from requirements to roadmap without full specification documents.

---

## Step 1: Session Initialization

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const autoYes = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const continueMode = $ARGUMENTS.includes('--continue') || $ARGUMENTS.includes('-c')
const modeMatch = $ARGUMENTS.match(/(?:--mode|-m)\s+(progressive|direct|auto)/)
const requestedMode = modeMatch ? modeMatch[1] : 'auto'
const brainstormMatch = $ARGUMENTS.match(/--from-brainstorm\s+(\S+)/)

// Clean requirement text
const requirement = $ARGUMENTS
  .replace(/--yes|-y|--continue|-c|--mode\s+\w+|-m\s+\w+|--from-brainstorm\s+\S+/g, '')
  .trim()

const slug = requirement.toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .substring(0, 40)
const dateStr = getUtc8ISOString().substring(0, 10)
```

**Session directory**: `.workflow/.roadmap/RMAP-{slug}-{date}/`

**Continue mode**: If `-c` and session exists, resume from last state.

**Brainstorm import**: If `--from-brainstorm`, read `guidance-specification.md` for enriched context (problem statement, features, non-goals, terminology).

---

## Step 1.5: Load Project Context

### 1.5.1: Load Specs
```
specs_content = maestro spec load --category planning
```
Ensure phases in Step 2 respect architectural constraints.

### 1.5.2: Load Project History (if `.workflow/` exists)

Read project artifacts to understand what has already been built and what carries forward:

```
IF .workflow/project.md exists:
  Read project.md:
    - "### Validated" section → already_shipped (completed features, DO NOT re-plan)
    - "### Active" section → current_scope (features to plan for)
    - "## Context" section → project_history (milestone summaries, prior work)
    - "## Key Decisions" section → locked_decisions (constraints on new phases)

IF .workflow/state.json exists:
  Read state.json.accumulated_context:
    - deferred[] → candidate_requirements (explicitly pushed to this milestone)
    - key_decisions[] → architectural_constraints
    - blockers[] → known_risks

IF .workflow/codebase/ exists (from codebase-rebuild or codebase-refresh):
  Read available codebase docs for feature inventory
```

**Context assembly** — pass to Step 2 as `project_context`:
```json
{
  "already_shipped": ["REQ-001: User auth", "REQ-002: API layer"],
  "current_scope": ["REQ-003: Payments", "REQ-004: i18n"],
  "deferred_from_previous": ["Internationalization deferred from v1.0"],
  "locked_decisions": ["JWT stateless auth", "PostgreSQL"],
  "learnings": ["JWT has perf issues at scale — consider caching"],
  "project_history": "Milestone v1.0 completed 2026-03-15: auth + API layer shipped"
}
```

**Rules**:
- NEVER re-plan features listed in `already_shipped` — they are done
- `deferred_from_previous` items are HIGH PRIORITY candidates for new phases
- `locked_decisions` constrain technology choices in decomposition
- `learnings` inform risk assessment and phase sizing

---

## Step 2: Requirement Understanding & Strategy

**Objective**: Parse requirement, assess uncertainty, select decomposition strategy.

1. **Parse Requirement**
   - Extract: goal, constraints, stakeholders, keywords
   - If `--from-brainstorm`: enrich from guidance-specification.md
   - If `project_context` loaded (Step 1.5.2): merge into requirement analysis
     - Cross-reference requirement against `already_shipped` — flag overlaps as "already done"
     - Promote `deferred_from_previous` items into active requirement scope
     - Apply `locked_decisions` as constraints

2. **Codebase Exploration (conditional)**
   - Detect if project has source files
   - If yes: spawn `cli-explore-agent` for context discovery
     - If `project_context.already_shipped` exists: include as "feature audit" directive —
       agent should verify which shipped features are present in code and identify integration points for new work
   - Output: relevant files, patterns, tech stack, feature_audit (existing capabilities mapped to shipped requirements)

3. **External Research — API & Technology Details (Optional)**

   Spawn `workflow-external-researcher` agent when requirement mentions specific technologies, APIs, or external services.

   **Trigger**: Technology keywords detected in requirement or codebase exploration found external dependencies. Auto-trigger in auto mode (`-y`). Skip if requirement is purely organizational.

   ```
   // Extract technology keywords from requirement + codebase exploration
   researchTopics = extract named technologies, APIs, frameworks, protocols

   IF researchTopics is not empty:
     Agent(
       subagent_type="workflow-external-researcher",
       prompt="""
   <objective>
   Research API details and technology specifics for: {requirement}
   Mode: API Research
   </objective>

   <context>
   Technologies identified: {researchTopics}
   Codebase tech stack: {codebase_exploration.tech_stack or "none"}
   </context>

   <task>
   For each identified technology/API:
   1. Current stable version and key capabilities
   2. Core API surface: key endpoints/methods, auth model
   3. Integration patterns and recommended setup
   4. Known limitations, breaking changes, or deprecations
   5. Effort estimation signals (simple wrapper vs complex integration)

   Focus on details that affect phase decomposition and dependency ordering.
   Be prescriptive. Return structured markdown only — do NOT write files.
   </task>
       """,
       run_in_background=false
     )
     apiResearchContext = agent_output
   ELSE:
     apiResearchContext = null
   ```

   `apiResearchContext` is passed into:
   - Step 3 (Decomposition): technology complexity informs phase sizing and ordering
   - Step 4 (Refinement): API constraints surface realistic dependency chains

   If research fails: `apiResearchContext = null`, continue without external context.

4. **Assess Uncertainty**
   ```
   Factors: scope_clarity, technical_risk, dependency_unknown,
            domain_familiarity, requirement_stability
   Each: low | medium | high
   ≥3 high → progressive, ≥3 low → direct, else → ask
   ```

5. **Strategy Selection** (skip if `-m` specified or `-y`)
   - Present uncertainty assessment
   - User selects: Progressive or Direct
   - `-y`: use recommended strategy

---

## Step 3: Decomposition

**Objective**: Break requirement into phases via CLI-assisted analysis.

Spawn `cli-roadmap-plan-agent`.
If `apiResearchContext` is set: include as "External API Research" context in the agent prompt — technology complexity, API constraints, and integration effort inform phase sizing and dependency ordering.

### Minimum-Phase Principle (MANDATORY)

**Core rule: Phase = synchronization barrier.** Each Phase triggers a full plan→execute→verify→transition serial cycle. More phases = slower delivery. The wave DAG inside each Phase already handles task ordering and parallelism, so only create a new Phase when tasks **cannot** start until a previous Phase's entire output exists.

**Default: 1 Phase.** Put everything into a single Phase unless a hard dependency forces a split.

| Rule | Constraint |
|------|-----------|
| **Default** | **1 Phase**. All work in one plan→execute cycle; wave DAG handles internal ordering. |
| **Maximum** | **2 Phases**. Only when a hard dependency boundary exists that cannot be resolved. |
| **Exceptional** | **3 Phases**. Must explicitly justify why 2 is insufficient. |
| **Minimum tasks per phase** | 5 tasks. If a phase would have fewer, merge it into an adjacent phase. |
| **Merge principle** | Same-module, same-concern, or tightly-coupled work belongs in ONE phase. Infra + core logic + API in one phase is fine. |
| **Split principle** | Only split when ALL three hard-dependency conditions are met (see below). |

**Hard dependency — all three conditions required to justify a Phase split:**
1. **Runtime dependency**: Phase B code at runtime MUST call Phase A's real output (cannot mock/stub).
2. **Not parallelizable**: A and B cannot develop concurrently via contract/interface/type agreement.
3. **Full barrier**: ALL of Phase A's tasks must complete before ANY of Phase B's tasks can start.

If only 1-2 conditions are met → keep in the same Phase, use wave dependencies instead.

**Phase sizing checklist (applied after decomposition, before presenting to user):**
1. Count total phases. If > 2 → justify each split against the 3 hard-dependency conditions, merge if unjustified.
2. Count estimated tasks per phase. Any phase < 5 tasks → merge into neighbor.
3. Verify each phase has a meaningful deliverable boundary (not just "setup" or "cleanup").

**Scope escalation:**
- **Single project** (any size): 1-2 Phases. Use wave DAG for internal parallelism.
- **Large scope** (monorepo with 2+ independently deployable services): Use **Milestones** to divide scope. Each Milestone follows the 1-2 Phase limit independently.

**Progressive mode**:
- Progressive layers (MVP → Usable → Refined) map to **Milestones**, not Phases.
- Each Milestone contains 1-2 Phases following the minimum-phase principle.
- MVP must be self-contained (no external dependencies)
- Each feature in exactly ONE milestone (no overlap)

**Direct mode**:
- Topologically-sorted task sequence
- Each task: title, type, scope, inputs, outputs, convergence, depends_on
- parallel_group for truly independent tasks

**Phase format** (both modes):
```markdown
### Phase {N}: {Title}
- **Goal**: <what this phase achieves>
- **Depends on**: <prerequisite phases or "Nothing">
- **Requirements**: <REQ-IDs mapped from project.md Active requirements>
- **Success Criteria** (what must be TRUE):
  1. <observable behavior from user perspective>
  2. <observable behavior from user perspective>
```

Phase numbering: integers (1, 2, 3) for planned work, decimals (2.1, 2.2) for inserted phases.
Decimal phases count toward the total phase limit.
Phase directories use `{NN}-{slug}` format (e.g., `01-auth`, `02-api`).

**Requirements traceability**: Every Active requirement from project.md MUST appear in exactly one phase's Requirements field. If a requirement maps to no phase, surface it as a gap.

---

## Step 4: Iterative Refinement

**Objective**: Multi-round user feedback to refine roadmap.

1. **Present Roadmap**
   - Phase count, milestone structure, dependency graph
   - Key success criteria per phase

2. **Gather Feedback** (skip if `-y` or `config.gates.confirm_roadmap == false`)
   - Options: Approve / Adjust Scope / Reorder / Split-Merge / Re-decompose
   - Max 5 rounds

3. **Process Feedback**
   - **Approve**: Run minimum-phase checklist (Step 3 rules) before accepting. If violations found, auto-merge and inform user.
   - **Adjust Scope**: Move features between milestones, modify criteria
   - **Reorder**: Change phase sequencing
   - **Split/Merge**: Break large phases or combine small ones (enforce min 5 tasks, max 2 phases)
   - **Re-decompose**: Return to Step 3 with new strategy

4. **Loop** until approved or max rounds reached

---

## Step 5: Write Outputs

1. **Write roadmap.md** to `.workflow/roadmap.md` using @templates/roadmap.md:
   ```markdown
   # Roadmap: {project_name}

   ## Overview
   <one paragraph describing the journey>

   ## Phases
   - [ ] **Phase 1: {Title}** - {one-line description}
   - [ ] **Phase 2: {Title}** - {one-line description}

   ## Phase Details

   ### Phase 1: {Title}
   **Goal**: {what this phase delivers}
   **Depends on**: Nothing (first phase)
   **Requirements**: {REQ-IDs from project.md Active requirements}
   **Success Criteria** (what must be TRUE):
     1. {observable behavior from user perspective}
     2. {observable behavior from user perspective}

   ### Phase 2: {Title}
   **Goal**: {what this phase delivers}
   **Depends on**: Phase 1
   **Requirements**: {REQ-IDs}
   **Success Criteria** (what must be TRUE):
     1. {observable behavior}

   ## Scope Decisions
   - In scope: <included>
   - Deferred: <later milestones>
   - Out of scope: <excluded>

   ## Progress
   | Phase | Status | Completed |
   |-------|--------|-----------|
   | 1. {Title} | Not started | - |
   ```

   **Requirements traceability**: Cross-check that every Active requirement from project.md maps to exactly one phase. Surface unmapped requirements as gaps.

2. **Create phase directories**: `.workflow/phases/{NN}-{slug}/` for each phase
   - Create empty `index.json` in each

3. **Update state.json** (if exists): set `current_phase: 1`

---

## Step 6: Handoff

Display summary and offer next steps:

```
=== ROADMAP CREATED ===
Strategy: {progressive|direct}
Phases:   {phase_count} across {milestone_count} milestones
Roadmap:  .workflow/roadmap.md

Next steps:
  Skill({ skill: "maestro-init" })                    -- Set up project (if not yet initialized)
  Skill({ skill: "maestro-plan", args: "1" })         -- Plan first phase
  Skill({ skill: "maestro-brainstorm", args: "1" })   -- Explore first phase ideas
  Skill({ skill: "manage-status" })                    -- View project dashboard
```
