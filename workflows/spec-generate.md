# Workflow: Spec Generate

Specification document chain producing a complete specification package (Product Brief, PRD, Architecture, Epics, Roadmap) through 7 sequential phases with multi-CLI analysis and interactive refinement. Pure documentation — no code generation.

## Worktree Guard

```
# Block in worktree
IF file_exists(".workflow/worktree-scope.json"):
  ERROR "Cannot run maestro-spec-generate inside a worktree. Run from the main worktree."
  EXIT
```

## Pipeline Position

```
maestro-brainstorm (optional upstream)
        ↓ guidance-specification.md
maestro-init (REQUIRED first step — project setup)
        ↓ project.md, state.json, config.json
maestro-spec-generate ← THIS (heavy path)
        ↓ spec package + roadmap.md → .workflow/roadmap.md
maestro-plan → maestro-execute → maestro-verify

Alternative light path (skip spec-generate):
maestro-init → maestro-roadmap → roadmap.md directly

Note: maestro-init MUST run before spec-generate.
```

## Architecture

```
Phase 0:   Specification Study (read specs + templates)
           |
Phase 1:   Discovery               → spec-config.json + discovery-context.json
           |                           (includes spec_type selection)
Phase 1.5: Req Expansion           → refined-requirements.json
           |                           (-y: auto-expansion, skip interaction)
Phase 2:   Product Brief            → product-brief.md + glossary.json
           |                           (multi-CLI parallel analysis)
Phase 3:   Requirements (PRD)      → requirements/ (_index.md + REQ-*.md + NFR-*.md)
           |                           (RFC 2119, data model definitions)
Phase 4:   Architecture            → architecture/ (_index.md + ADR-*.md)
           |                           (state machine, config model, error handling, observability)
Phase 5:   Epics & Stories         → epics/ (_index.md + EPIC-*.md)
           |
Phase 6:   Readiness Check         → readiness-report.md + spec-summary.md
           |                           (terminology + scope consistency validation)
           ├── Pass (>=80%): Proceed to Phase 7
           ├── Review (60-79%): Proceed with caveats
           └── Fail (<60%): Phase 6.5 Auto-Fix (max 2 iterations)
                 |
Phase 6.5: Auto-Fix               → Updated Phase 2-5 documents
                 └── Re-run Phase 6 validation
           |
Phase 7:   Roadmap Generation      → roadmap.md + .workflow/roadmap.md
                                       (Epic→Phase mapping, interactive refinement)
```

## Arguments

```
$ARGUMENTS: "<idea or @file> [-y] [-c] [--from-brainstorm SESSION-ID]"

<idea>              -- Idea text or @file reference
-y / --yes          -- Auto mode, skip interactive questions
-c / --continue     -- Resume from last checkpoint
--from-brainstorm   -- Import brainstorm session as enriched seed
```

## Output Structure

```
.workflow/.spec/SPEC-{slug}-{YYYY-MM-DD}/
├── spec-config.json              # Session configuration + phase state
├── discovery-context.json        # Codebase exploration (optional)
├── refined-requirements.json     # Phase 1.5: Confirmed requirements
├── glossary.json                 # Phase 2: Terminology glossary
├── product-brief.md              # Phase 2: Product brief
├── requirements/                 # Phase 3: Detailed PRD
│   ├── _index.md                 #   Summary, MoSCoW table, traceability
│   ├── REQ-NNN-{slug}.md         #   Functional requirement
│   └── NFR-{type}-NNN-{slug}.md  #   Non-functional requirement
├── architecture/                 # Phase 4: Architecture decisions
│   ├── _index.md                 #   Overview, components, tech stack
│   └── ADR-NNN-{slug}.md         #   Architecture Decision Record
├── epics/                        # Phase 5: Epic/Story breakdown
│   ├── _index.md                 #   Epic table, dependency map, MVP
│   └── EPIC-NNN-{slug}.md        #   Individual Epic with Stories
├── readiness-report.md           # Phase 6: Quality report
├── spec-summary.md               # Phase 6: Executive summary
└── roadmap.md                    # Phase 7: Project roadmap (also written to .workflow/roadmap.md)
```

---

## Process

### Step 1: Prerequisite Loading (Phase 0)

Before any operations, load specification and template documents:

| Document | Purpose | Priority |
|----------|---------|----------|
| Document standards | Format, frontmatter, naming conventions | P0 - must read |
| Quality gates | Per-phase quality criteria and scoring | P0 - must read |
| Templates | product-brief, requirements-prd, architecture-doc, epics-template | Read on-demand per phase |

**Load project specs:**
```
specs_content = maestro spec load --category arch
```
Used in Phase 3 (architecture doc) and Phase 6 (epic decomposition) for constraint awareness.

These inform validation and output formatting for all subsequent phases.

**Load project history (if `.workflow/` exists):**
```
IF .workflow/project.md exists:
  Read project.md:
    - "### Validated" → already_shipped (DO NOT re-specify)
    - "### Active" → current_scope
    - "## Context" → project_history (milestone summaries)
    - "## Key Decisions" → locked_decisions

IF .workflow/state.json exists:
  Read state.json.accumulated_context:
    - deferred[] → candidate_requirements (high priority for this iteration)
    - key_decisions[] → architectural_constraints

```

**Rules**:
- Features in `already_shipped` are EXCLUDED from spec generation scope — they are done
- `deferred` items from previous milestone are HIGH PRIORITY candidates
- `locked_decisions` constrain architecture choices in Phase 4
- `lessons_learned` inform risk assessment in Phase 1 and architecture decisions in Phase 4
- Pass assembled `project_context` to Phase 1 seed analysis and Phase 7 roadmap generation

### Step 2: Discovery & Seed Analysis (Phase 1)

Parse input, analyze the seed idea, optionally explore codebase, establish session.

**Step 2.1: Input Parsing**
- Parse $ARGUMENTS: extract idea/topic, flags (-y, -c, --from-brainstorm)
- If `-c`: read spec-config.json, resume from first incomplete phase
- If `--from-brainstorm SESSION-ID`:
  - Locate brainstorm session directory
  - Read `guidance-specification.md` as enriched seed (already has terminology, non-goals, feature decomposition)
  - Extract problem statement, features, roles from specification
  - Set `input_type: "brainstorm"` — skip Phase 1.5 (requirements already clarified)
- If `@file`: read file content as seed
- If text: use directly as seed
- Missing input → error E001

**Step 2.2: Session Initialization**
```
Session ID: SPEC-{slug}-{YYYY-MM-DD}
Output dir: .workflow/.spec/{session_id}/
```

**Step 2.3: Seed Analysis via CLI**
- Spawn CLI analysis to extract: problem_statement, target_users, domain, constraints, dimensions (3-5)
- Assess complexity: simple (1-2 components) / moderate (3-5) / complex (6+)
- For brainstorm input: enrich with feature decomposition data

**Step 2.4: Codebase Exploration (conditional)**
- Detect if project has source files (*.ts, *.js, *.py, etc.)
- If yes: spawn cli-explore-agent for context discovery
- Output: `discovery-context.json` with relevant_files, patterns, tech_stack

**Step 2.5: External Research — API & Technology Details (Optional)**

Spawn `workflow-external-researcher` agent to gather concrete API details, library versions, and integration patterns for the technologies identified in seed analysis and codebase exploration.

**Trigger**: When seed analysis identifies specific technologies, APIs, or external services. Auto-trigger in auto mode (`-y`). Skip if topic is purely conceptual with no technology keywords.

```
// Step 2.5.1: Build research queries from seed analysis
researchTopics = extract from seed_analysis:
  - Named technologies/frameworks (e.g., "OAuth 2.0", "WebSocket", "PostgreSQL")
  - External APIs/services mentioned (e.g., "Stripe API", "SendGrid")
  - Domain-specific protocols or standards

IF researchTopics is empty: skip to Step 2.6, set apiResearchContext = null

// Step 2.5.2: Spawn external researcher
Agent(
  subagent_type="workflow-external-researcher",
  prompt="""
<objective>
Research API details and technology specifics for: {seed_analysis.problem_statement}
Mode: API Research
</objective>

<context>
Technologies identified: {researchTopics}
Domain: {seed_analysis.domain}
Spec type: {spec_type or "TBD"}
Codebase tech stack: {discovery_context.tech_stack or "none"}
</context>

<task>
For each identified technology/API:
1. Current stable version and key capabilities
2. API surface: core endpoints/methods, authentication model, rate limits
3. Integration patterns: recommended setup, configuration, common middleware
4. Data models: key entities, request/response shapes
5. Known limitations, deprecations, or migration paths

Focus on CONCRETE details — versions, method signatures, config options.
Be prescriptive. Return structured markdown only — do NOT write files.
</task>
  """,
  run_in_background=false
)

// Step 2.5.3: Store as apiResearchContext (in-memory)
apiResearchContext = agent_output
```

`apiResearchContext` is passed into:
- Step 4 (Product Brief): technology feasibility assessment
- Step 5 (Requirements): API-aware requirement writing with concrete constraints
- Step 6 (Architecture): informed ADR decisions with version-specific details
- Step 7 (Epics): realistic story sizing based on API complexity

If research fails (W005): `apiResearchContext = null`, continue without external context.

**Step 2.6: Spec Type Selection**
- Interactive (AskUserQuestion): Service / API / Library / Platform
- `--yes`: default to "service"
- Each type loads a profile template for domain-specific sections

**Step 2.7: User Confirmation (interactive)**
- Confirm problem statement, select depth (Light/Standard/Comprehensive), select focus areas
- `--yes`: accept all defaults

**Output**: `spec-config.json` (session state), `discovery-context.json` (optional), `apiResearchContext` (in-memory, optional)

### Step 3: Requirement Expansion & Clarification (Phase 1.5)

Skip if `--from-brainstorm` (requirements already in guidance-specification.md).

**Step 3.1: CLI Gap Analysis**
- Analyze seed for completeness (score 1-10), identify missing dimensions
- Generate 3-5 clarification areas with questions and expansion suggestions
- Dimensions checked: functional scope, user scenarios, NFRs, integrations, data model, error handling

**Step 3.2: Interactive Discussion Loop (max 5 rounds)**
- Round 1: present gap analysis + expansion suggestions via AskUserQuestion
- Round N: CLI follow-up analysis based on user responses, refine requirements
- User can: answer questions, accept suggestions, or skip to generation
- `--yes`: CLI auto-expansion without interaction

**Step 3.3: User Confirmation**
- Present requirement summary, user confirms or requests adjustments
- `--yes`: auto-confirm

**Output**: `refined-requirements.json` (confirmed features, NFRs, boundaries, assumptions)

### Step 4: Product Brief (Phase 2)

Generate product brief through multi-perspective CLI analysis.

**Step 4.1: Load Context**
- Read refined-requirements.json (preferred) or seed_analysis fallback
- Read discovery-context.json (if codebase detected)
- For brainstorm input: read guidance-specification.md sections

**Step 4.2: Multi-CLI Parallel Analysis (3 perspectives)**

| Perspective | CLI Tool | Focus |
|-------------|----------|-------|
| Product | gemini | Vision, market fit, success criteria, scope boundaries |
| Technical | codex | Feasibility, constraints, integration complexity, tech recommendations |
| User | claude | Personas, journey maps, pain points, UX criteria |

**Step 4.3: Synthesis**
- Extract convergent themes (all agree), conflicts (need resolution), unique insights
- For brainstorm input: cross-reference with guidance-specification decisions
- If `apiResearchContext` is set: inject API details into technical feasibility assessment, enrich technology recommendations with concrete versions and constraints

**Step 4.4: Interactive Refinement**
- Present synthesis, user adjusts scope/vision
- `--yes`: accept synthesis as-is

**Step 4.5: Generate Outputs**
- `product-brief.md` from template (YAML frontmatter + filled content)
- `glossary.json` — 5+ core terms extracted from product brief and CLI analysis
  - Each term: canonical name, definition, aliases, category (core/technical/business)
  - Injected into all subsequent phase CLI prompts for terminology consistency

**Output**: `product-brief.md`, `glossary.json`

### Step 5: Requirements / PRD (Phase 3)

Generate detailed PRD with functional/non-functional requirements.

**Step 5.1: Requirement Expansion via CLI**
- For each product brief goal, generate 3-7 functional requirements
- Each requirement: REQ-NNN ID, title, description, user story, 2-4 acceptance criteria
- Generate non-functional requirements: performance, security, scalability, usability
- Apply RFC 2119 keywords (MUST/SHOULD/MAY) to all behavioral constraints
- Define core entity data models: fields, types, constraints, relationships
- Inject glossary.json for terminology consistency

**Step 5.2: MoSCoW Priority Sorting (interactive)**
- Present requirements grouped by initial priority
- User adjusts Must/Should/Could/Won't labels
- Select MVP scope: Must-only / Must+key Should / Comprehensive
- `--yes`: accept CLI-suggested priorities

**Step 5.3: Generate Directory**
- `requirements/_index.md` — summary table, MoSCoW breakdown, traceability matrix
- `requirements/REQ-NNN-{slug}.md` — one per functional requirement
- `requirements/NFR-{type}-NNN-{slug}.md` — one per non-functional requirement

**Output**: `requirements/` directory (index + individual files)

### Step 6: Architecture (Phase 4)

Generate architecture decisions, component design, and technology selections.

**Step 6.1: Architecture Analysis via CLI (gemini)**
- System architecture style with justification
- Core components and responsibilities
- Component interaction diagram (Mermaid graph TD)
- Technology stack: languages, frameworks, databases, infrastructure
- 2-4 Architecture Decision Records (ADRs): context, decision, alternatives, consequences
- Data model: entities and relationships (Mermaid erDiagram)
- Security architecture: auth, authorization, data protection
- **State machine**: ASCII diagram + transition table for lifecycle entities (service/platform type)
- **Configuration model**: all configurable fields with type, default, constraint
- **Error handling strategy**: per-component classification (transient/permanent/degraded), recovery mechanisms
- **Observability**: key metrics (5+), structured log events, health checks
- Spec type profile injection for domain-specific depth
- Glossary injection for terminology consistency
- If `apiResearchContext` is set: inject as "External API Research" context — concrete versions, API surfaces, integration patterns inform ADR decisions and technology stack selection

**Step 6.2: Architecture Review via CLI (codex)**
- Challenge each ADR, identify scalability bottlenecks
- Assess security gaps, evaluate technology choices
- Rate overall quality 1-5

**Step 6.3: Interactive ADR Decisions**
- Present ADRs with review feedback, user decides: accept / incorporate feedback / simplify
- `--yes`: auto-accept

**Step 6.4: Codebase Integration Mapping (conditional)**
- Map new components to existing code modules

**Step 6.5: Generate Directory**
- `architecture/_index.md` — overview, component diagram, tech stack, data model, security
- `architecture/ADR-NNN-{slug}.md` — one per Architecture Decision Record

**Output**: `architecture/` directory (index + individual ADR files)

### Step 7: Epics & Stories (Phase 5)

Decompose specification into executable Epics and Stories.

**Step 7.1: Epic Decomposition via CLI**
- Group requirements into logical Epics (EPIC-NNN IDs). Epic count is unconstrained — Phase 7 will merge Epics into minimal phases via the minimum-phase principle.
- Tag MVP subset
- For each Epic: 2-5 Stories in "As a...I want...So that..." format
- Each Story: 2-4 testable acceptance criteria, relative size (S/M/L/XL), trace to REQ-NNN
- Cross-Epic dependency map (Mermaid graph LR)
- Recommended execution order with rationale
- MVP definition of done (3-5 criteria)

**Epic sizing awareness** (informs Phase 7 roadmap generation):
- Epics that are too small (1-2 Stories, all size S) should be flagged for merge in Phase 7
- Each Epic should carry enough substance to become part of a phase with 5+ tasks
- Prefer fewer, larger Epics over many tiny ones

**Step 7.2: Interactive Validation**
- Present Epic overview, user adjusts: merge/split epics, adjust MVP scope
- `--yes`: accept as-is

**Step 7.3: Generate Directory**
- `epics/_index.md` — overview table, dependency map, MVP scope, execution order, traceability
- `epics/EPIC-NNN-{slug}.md` — one per Epic with embedded Stories

**Output**: `epics/` directory (index + individual Epic files)

### Step 8: Readiness Check & Handoff (Phase 6)

Validate specification package and provide execution handoff.

**Step 8.1: Cross-Document Validation via CLI**
Score on 4 dimensions (25% each):
1. **Completeness**: all required sections present with substantive content
2. **Consistency**: terminology uniform (glossary compliance), scope containment, non-goals respected
3. **Traceability**: goals → requirements → architecture → epics (matrix generated)
4. **Depth**: acceptance criteria testable, ADRs justified, stories estimable

Gate decision: Pass (>=80) / Review (60-79) / Fail (<60)

**Step 8.2: Generate Reports**
- `readiness-report.md` — quality scores, issue list (Error/Warning/Info), traceability matrix
- `spec-summary.md` — one-page executive summary

**Step 8.3: Update Document Status**
- All document frontmatter updated to `status: complete`

**Step 8.4: Gate Routing**

| Gate Result | Action |
|-------------|--------|
| Pass (>=80%) | Proceed to Step 11 (Phase 7: Roadmap Generation) |
| Review (60-79%) | Proceed to Step 11 with caveats logged |
| Fail (<60%) | Trigger Step 9 (Phase 6.5 Auto-Fix), then re-run Step 8 |

### Step 9: Auto-Fix (Phase 6.5, conditional)

Triggered when Phase 6 score < 60%. Automatically repair specification issues.

**Step 9.1: Parse Readiness Report**
- Extract Error and Warning items
- Group by originating phase (2-5)
- Map to affected output files

**Step 9.2: Fix Affected Phases (sequential, Phase 2→3→4→5)**
- For each phase with issues:
  - Read current phase output
  - CLI re-generation with error context injected
  - Inject glossary for terminology consistency
  - Preserve unflagged content, only fix flagged issues
  - Increment document version

**Step 9.3: Re-run Phase 6**
- Generate new readiness-report.md
- If still Fail and iteration_count < 2: loop back
- If Pass or max iterations (2) reached: proceed to handoff

**Output**: Updated Phase 2-5 documents, updated spec-config.json with iteration tracking

### Step 11: Roadmap Generation (Phase 7)

Convert Epics into an interactive roadmap with user confirmation.

**Step 11.1: Epic→Phase Mapping**
- Read `epics/_index.md` for Epic table, dependency map, MVP tags
- Read individual `EPIC-NNN-{slug}.md` for Stories and acceptance criteria
- Read `architecture/_index.md` for technical constraints (ADR decisions)

**Minimum-Phase Principle (MANDATORY — applied during mapping):**

Phase = synchronization barrier (full plan→execute→verify cycle). Minimize phases for maximum execution efficiency. The wave DAG inside each Phase handles task ordering and parallelism.

| Rule | Constraint |
|------|-----------|
| **Default** | **1 Phase**. Merge all Epics into a single phase; wave DAG handles internal ordering. |
| **Maximum** | **2 Phases**. Only when a hard dependency boundary exists that cannot be resolved. |
| **Exceptional** | **3 Phases**. Must explicitly justify why 2 is insufficient. |
| **Minimum Stories per phase** | 5 Stories. If an Epic maps to fewer than 5 Stories, merge with related Epic. |
| **Merge principle** | Small Epics (1-2 Stories, all size S) MUST be merged. Same-module or same-concern Epics belong together. Multiple Epics → one phase is normal. |
| **Split principle** | Only split when ALL three hard-dependency conditions are met: (1) runtime dependency — cannot mock/stub, (2) not parallelizable via contract/interface, (3) full barrier — all of Phase A must complete before any of Phase B starts. |

- Map (with minimum-phase principle applied):
  - Default: ALL Epics → 1 Phase (wave DAG orders tasks by Epic dependencies)
  - Only split if hard dependency conditions are all met
  - MVP-tagged Epics → Milestone 1, Post-MVP → Milestone 2+
  - Epic dependencies → wave ordering within phase (not phase splits)
  - Stories within Epics → phase success criteria
  - ADR decisions → phase technical constraints

**Post-mapping sizing check:**
1. Count total phases. If > 2 → justify each split against the 3 hard-dependency conditions, merge if unjustified.
2. Count Stories per phase. Any phase < 5 Stories → merge into neighbor.
3. Verify each phase has a meaningful deliverable boundary.

**Scope escalation:**
- **Single project** (any size): 1-2 Phases. Use wave DAG for internal parallelism.
- **Large scope** (monorepo with 2+ independently deployable services): Use **Milestones**. Each Milestone follows the 1-2 Phase limit independently.

**Step 11.2: Generate Draft Roadmap**
- Produce `roadmap.md` following `@templates/roadmap.md` structure:
  ```markdown
  # Roadmap: {project_name}

  ## Overview
  <from product-brief.md vision>

  ## Phases
  - [ ] **Phase 1: {Epic Title}** - {one-line goal}
  - [ ] **Phase 2: {Epic Title}** - {one-line goal}

  ## Phase Details

  ### Phase 1: {Epic Title}
  **Goal**: {Epic goal}
  **Depends on**: {from Epic dependency map}
  **Requirements**: {REQ-IDs traced from Epic→Stories→Requirements}
  **Success Criteria** (what must be TRUE):
    1. {from Stories' acceptance criteria — observable behavior}
    2. {from Stories' acceptance criteria — observable behavior}

  ## Scope Decisions
  - **In scope**: {MVP Epics}
  - **Deferred**: {Post-MVP Epics}
  - **Out of scope**: {from product-brief non-goals}

  ## Progress
  | Phase | Status | Completed |
  |-------|--------|-----------|
  | 1. {Title} | Not started | - |
  ```

**Step 11.3: Interactive Refinement (max 3 rounds)**
- Present roadmap overview: phase count, milestone structure, dependency graph
- **Before presenting**: validate minimum-phase principle (default 1, max 2, exceptional 3). Auto-merge violations and inform user.
- User feedback via AskUserQuestion:
  - **Approve**: Run final sizing check before accepting
  - **Adjust Scope**: Move Epics between milestones, merge phases (enforce minimum-phase principle)
  - **Reorder**: Change phase sequencing
  - **Split/Merge**: Combine small phases (min 5 tasks enforced); splits require hard-dependency justification
- `--yes`: auto-approve draft roadmap (minimum-phase principle still enforced automatically)
- Each round: update roadmap.md, log change in iteration history

**Step 11.4: Write Outputs**
- Write `roadmap.md` to spec directory: `{spec_dir}/roadmap.md`
- If `.workflow/` exists: also write to `.workflow/roadmap.md`
- Update `spec-config.json`: add Phase 7 completion

**Step 11.5: Handoff Options (AskUserQuestion)**

| Option | Action |
|--------|--------|
| Initialize project | Skill({ skill: "maestro-init" }) — set up project infrastructure |
| Plan first phase | Skill({ skill: "maestro-plan", args: "1" }) — plan first roadmap phase |
| Create issues | Generate issues per phase via Skill({ skill: "manage-issue" }) |
| Export only | Spec + roadmap complete, no further action |

### Step 12: Final Report

```
== spec-generate complete ==
Session:  SPEC-{slug}-{date}
Output:   .workflow/.spec/{session_id}/
Quality:  {score}% ({gate})
Phases:   {completed_count}/7

Files:
  spec-config.json          — Session state
  product-brief.md          — Product brief
  requirements/             — PRD ({req_count} REQs + {nfr_count} NFRs)
  architecture/             — Architecture ({adr_count} ADRs)
  epics/                    — Epics & Stories ({epic_count} Epics)
  readiness-report.md       — Quality validation
  spec-summary.md           — Executive summary
  roadmap.md                — Project roadmap ({phase_count} phases, {milestone_count} milestones)

Next:
  Skill({ skill: "maestro-init" })                                    — Set up project
  Skill({ skill: "maestro-plan", args: "1" })                         — Plan first phase
```

---

## Key Design Principles

1. **Document Chain**: Each phase builds on previous outputs with traceability
2. **Multi-Perspective Analysis**: CLI tools provide product, technical, and user perspectives
3. **Interactive by Default**: Each phase offers user confirmation; `-y` enables auto mode
4. **Resumable Sessions**: spec-config.json tracks phases; `-c` resumes from checkpoint
5. **Template-Driven**: All documents from standardized templates with YAML frontmatter
6. **Spec Type Specialization**: Templates adapt to service/api/library/platform via profiles
7. **Terminology Consistency**: glossary.json from Phase 2 injected into all subsequent phases
8. **Iterative Quality**: Phase 6.5 auto-fix loop (max 2 iterations)
9. **Brainstorm Integration**: `--from-brainstorm` imports guidance-specification.md as seed

## State Management

**spec-config.json**:
```json
{
  "session_id": "SPEC-xxx-2026-03-15",
  "seed_input": "User input text",
  "input_type": "text|file|brainstorm",
  "timestamp": "ISO8601",
  "mode": "interactive|auto",
  "complexity": "simple|moderate|complex",
  "depth": "light|standard|comprehensive",
  "focus_areas": [],
  "spec_type": "service|api|library|platform",
  "iteration_count": 0,
  "iteration_history": [],
  "seed_analysis": {
    "problem_statement": "...",
    "target_users": [],
    "domain": "...",
    "constraints": [],
    "dimensions": []
  },
  "has_codebase": false,
  "phasesCompleted": [
    { "phase": 1, "name": "discovery", "output_file": "spec-config.json", "completed_at": "ISO8601" }
  ]
}
```

Resume: `-c` reads spec-config.json, resumes from first incomplete phase.

## Quality Dimensions (Phase 6)

| Dimension | Weight | Focus |
|-----------|--------|-------|
| Completeness | 25% | All sections present with substance |
| Consistency | 25% | Terminology, scope, non-goals alignment |
| Traceability | 25% | Goals → Reqs → Arch → Epics chain |
| Depth | 25% | Testable criteria, justified decisions, estimable stories |

**Gate**: Pass (>=80%) / Review (60-79%) / Fail (<60%)

## Handoff to maestro-init

When spec-generate completes, `roadmap.md` is already generated (Phase 7).
Run `maestro-init` to set up project infrastructure (project.md, state.json, config.json, specs/).
Init detects existing `.workflow/roadmap.md` and skips roadmap creation.

## Error Handling

| Phase | Error | Blocking? | Action |
|-------|-------|-----------|--------|
| Phase 1 | Empty input | Yes | Error and exit |
| Phase 1 | CLI analysis fails | No | Basic parsing fallback |
| Phase 1.5 | Gap analysis fails | No | Skip to basic prompts |
| Phase 2 | Single CLI fails | No | Continue with available |
| Phase 3 | Gemini fails | No | Codex fallback |
| Phase 4 | Review fails | No | Skip review |
| Phase 5 | Story generation fails | No | Generate epics only |
| Phase 6 | Validation fails | No | Partial report |
| Phase 6.5 | Max iterations (2) | No | Force handoff |

| Step 2.5 | External research fails | No | apiResearchContext = null, continue |

CLI Fallback Chain: Gemini → Codex → Claude → degraded mode (local only)
