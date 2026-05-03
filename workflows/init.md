# Workflow: init

Project initialization with automatic state detection. Creates project infrastructure only — roadmap creation is handled by maestro-roadmap (light or full mode).

---

## Worktree Guard

```
If .workflow/worktree-scope.json exists: error "Cannot run maestro-init inside a worktree." and exit.
```

## Step 1: State Detection

Detect current project state to determine initialization path.

```
state.json exists → Path C (existing) | source files exist → Path B (brownfield) | else → Path A (greenfield)
```

### Path A: Empty/Greenfield Project

1. **Deep Questioning** -- Gather project context through conversational exploration:

   Open with: "What do you want to build?"
   Wait for response, then follow the thread:
   - Ask about what excited them, what problem sparked this
   - Challenge vague terms — make abstract concrete
   - Surface assumptions and find edges
   - Probe for: core value (the ONE thing), target users, constraints, tech preferences
   - Weave in coverage checks (don't switch to checklist mode):
     - Project name and vision
     - Core value (if everything else fails, what must work?)
     - Primary goals (2-5)
     - Tech stack preferences
     - Constraints and non-goals
     - Target users / stakeholders
     - Success criteria

   Decision gate: When enough context for project.md, ask "Ready to create project.md?"
   - "Create project.md" → proceed
   - "Keep exploring" → continue questioning

   If `--auto` flag: skip interactive questioning, extract from @ referenced document.
   If `--from-brainstorm SESSION-ID`:
   - Locate brainstorm session directory (`.workflow/scratch/brainstorm-*/`)
   - Read `guidance-specification.md`:
     - Problem statement → project vision + core value
     - Features → project goals (Active requirements)
     - Non-goals → constraints + Out of Scope requirements
     - Terminology → project glossary context
   - Skip interactive questioning (context already gathered)

2. **Workflow Preferences** -- Configure project workflow settings:

   Round 1 — Core settings (AskUserQuestion):
   - Granularity: Coarse (3-5 phases) / Standard (5-8) / Fine (8-12)
   - Execution: Parallel / Sequential
   - Git Tracking: Commit planning docs to git?

   Round 2 — Workflow agents:
   - Research: Research before planning each phase?
   - Plan Check: Verify plans achieve goals?
   - Verifier: Verify work after each phase?

   Write `.workflow/config.json` from template + user selections.
   If `--auto`: use defaults (standard, parallel, commit, all agents on).

3. **Research** (optional, based on config.workflow.research) -- Spawn 4 parallel `workflow-project-researcher` agents writing to `.workflow/research/`: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md.

4. **Synthesize** -- Spawn `workflow-research-synthesizer` agent:
   - Input: all `.workflow/research/` documents
   - Output: `.workflow/research/SUMMARY.md` with consolidated findings

5. **Create project files:**
   - `.workflow/project.md` from @templates/project.md + user answers (include Core Value, Requirements, Key Decisions)
   - `.workflow/state.json` from template (status: "idle")
   - `.workflow/config.json` already created in step 2

### Path B: Brownfield (has code, no .workflow/)

1. Create `.workflow/` directory structure
2. Create `.workflow/state.json` (status: "idle")
3. Offer codebase mapping:
   - "Map codebase first" → execute `/manage-codebase-rebuild` to understand existing architecture, then return
   - "Skip mapping" → proceed
4. Run Workflow Preferences (same as Path A step 2) → `.workflow/config.json`
5. Ask user for project vision, goals, constraints (same deep questioning as Path A step 1)
   - If `--from-brainstorm SESSION-ID`: extract from guidance-specification.md (skip questioning)
   - For brownfield: infer Validated requirements from existing code (what does codebase already do?)
6. Create `.workflow/project.md` (include inferred Validated requirements + new Active requirements)

### Path C: Existing Project (has .workflow/)

1. Read `.workflow/state.json`
2. Display: "Project already initialized. Current status: {status}"
3. Route to `/workflow:status`

---

## Step 2: Specs Init (first-run only)

If `.workflow/specs/` does not exist:

1. Run `Bash("maestro spec init")` — creates empty seed files (skeleton only, no codebase scan)

2. If project has existing source files (package.json, tsconfig.json, pyproject.toml, go.mod, etc.):
   - Auto-trigger `Skill({ skill: "spec-setup" })` — scan codebase and populate specs with detected conventions
   - Note: Specs are further enriched by analyze, plan, and execute stages via `maestro spec add`

3. If greenfield project (no source files):
   - Skip spec-setup (nothing to scan)
   - Note: Specs will be progressively populated as pipeline stages produce knowledge


---

## Step 3: Directory Structure Verification

Verify all required directories and files exist:

```
.workflow/
  project.md        ✓
  state.json         ✓
  config.json        ✓
  specs/             ✓
  research/          ✓ (if research enabled)
  scratch/           ✓ (create empty)
  milestones/        ✓ (create empty)
  codebase/          ✓ (create empty)
```

---

## Step 4: Commit and Route

1. If git repo and config.git.commit_docs: commit all `.workflow/` files with message `"chore: initialize project workflow"`
2. Display initialization summary:
   - Project name and core value
   - Config highlights (mode, granularity, execution method, enabled agents)
   - Research summary (if research was run)
3. Route next steps:
   - "Run `/maestro-roadmap --mode full` to create full spec package with roadmap (heavy path)"
   - "Run `/maestro-roadmap` to create interactive roadmap directly (light path)"
   - "Run `/manage-status` to view project dashboard"
   - "Run `/maestro-brainstorm` to explore ideas first"
