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

## Step 1.5: Load Project Specs

```
specs_content = maestro spec load --category planning
```

Ensure phases in Step 2 respect architectural constraints.

---

## Step 2: Requirement Understanding & Strategy

**Objective**: Parse requirement, assess uncertainty, select decomposition strategy.

1. **Parse Requirement**
   - Extract: goal, constraints, stakeholders, keywords
   - If `--from-brainstorm`: enrich from guidance-specification.md

2. **Codebase Exploration (conditional)**
   - Detect if project has source files
   - If yes: spawn `cli-explore-agent` for context discovery
   - Output: relevant files, patterns, tech stack

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

### Phase Sizing Rules (MANDATORY)

| Rule | Constraint |
|------|-----------|
| **Minimum tasks per phase** | 5 tasks. If a phase would have fewer, merge it into an adjacent phase. |
| **Maximum phases (full-stack)** | 3 phases for a complete front-end + back-end project. Larger scope uses milestones, not more phases. |
| **Maximum phases (backend-only / frontend-only)** | 2 phases. Single-side projects should not exceed 2 phases. |
| **Merge principle** | Same-module, same-concern, or tightly-coupled work belongs in ONE phase. Infra + core logic + API in one phase is fine. |
| **Split principle** | Only split when there is a hard dependency boundary (e.g., backend API must exist before frontend can integrate). |

**Phase sizing checklist (applied after decomposition, before presenting to user):**
1. Count estimated tasks per phase. Any phase < 5 tasks → merge into neighbor.
2. Count total phases. Full-stack > 3 or single-side > 2 → merge related phases.
3. Verify each phase has a meaningful deliverable boundary (not just "setup" or "cleanup").

**Scope classification:**
- **Single-side**: Pure frontend or pure backend project → max 2 phases.
- **Full-stack**: One frontend + one backend → max 3 phases.
- **Large scope** (monorepo with 2+ services, workers, multiple backends): Use milestones. Each milestone follows the 2-3 phase limit independently. Phase counts reset per milestone.

**Progressive mode**:
- 2-3 layers: MVP / Usable / Refined (Optimized merged into Refined unless justified)
- Each layer: goal, scope, excludes, convergence, risks, effort
- MVP must be self-contained (no external dependencies)
- Each feature in exactly ONE layer (no overlap)

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
   - **Approve**: Run phase sizing checklist (Step 3 rules) before accepting. If violations found, auto-merge and inform user.
   - **Adjust Scope**: Move phases between milestones, modify criteria
   - **Reorder**: Change phase sequencing
   - **Split/Merge**: Break large phases or combine small ones (enforce min 5 tasks, max 3 phases)
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
