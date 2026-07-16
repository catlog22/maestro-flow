---
name: blueprint
prepare: blueprint
commands: [maestro-blueprint]
session-mode: inherited
---

# Workflow: Blueprint

## Pipeline Position

```
brainstorm (parallel) → blueprint → analyze → plan
```

## Architecture

```
P0: Spec Study → P1: Discovery → P1.5: Req Expansion → P2: Product Brief → P3: PRD → P4: Architecture → P5: Epics → P6: Readiness Check

P6 gate: Pass (>=80%) → Handoff | Review (60-79%) → Handoff w/caveats | Fail (<60%) → P6.5 Auto-Fix (max 2 iter) → re-check

GATE P2→P3: REQUIRED `product-brief.md` written with ≥5 glossary terms in `glossary.json`; BLOCKED if `product-brief.md` missing or glossary < 5 terms.
GATE P3→P4: REQUIRED `requirements/_index.md` written with MoSCoW priority table; BLOCKED if `_index.md` missing or MoSCoW table absent.
```

## Output Structure

```
{run_dir}/
├── outputs/
│   ├── blueprint-config.json             # Session configuration + phase state
│   ├── discovery-context.json        # Codebase exploration (optional)
│   ├── refined-requirements.json     # Phase 1.5: Confirmed requirements
│   ├── glossary.json                 # Phase 2: Terminology glossary
│   ├── product-brief.md              # Phase 2: Product brief
│   ├── requirements/                 # Phase 3: Detailed PRD
│   │   ├── _index.md                 #   Summary, MoSCoW table, traceability
│   │   ├── REQ-NNN-{slug}.md         #   Functional requirement
│   │   └── NFR-{type}-NNN-{slug}.md  #   Non-functional requirement
│   ├── architecture/                 # Phase 4: Architecture decisions
│   │   ├── _index.md                 #   Overview, components, tech stack
│   │   └── ADR-NNN-{slug}.md         #   Architecture Decision Record
│   ├── epics/                        # Phase 5: Epic/Story breakdown
│   │   ├── _index.md                 #   Epic table, dependency map, MVP
│   │   └── EPIC-NNN-{slug}.md        #   Individual Epic with Stories
│   ├── readiness-report.md           # Phase 6: Quality report
│   ├── blueprint-summary.md          # Phase 6: Executive summary
│   └── context-package.json          # Handoff context
└── report.md
```

---

## Process

### Step 1: Prerequisite Loading (Phase 0)

Load specification and template documents:

| Document | Purpose | Priority |
|----------|---------|----------|
| Document standards | Format, frontmatter, naming conventions | P0 - must read |
| Quality gates | Per-phase quality criteria and scoring | P0 - must read |
| Templates | product-brief, requirements-prd, architecture-doc, epics-template | Read on-demand per phase |

**Load project specs and history**:

Additional full-mode rules:
- Features in `already_shipped` are EXCLUDED from spec generation scope
- `lessons_learned` inform risk assessment in Phase 1 and architecture decisions in Phase 4
- Pass assembled `project_context` to Phase 1 seed analysis

### Step 2: Discovery & Seed Analysis (Phase 1)

Parse input, analyze the seed idea, optionally explore codebase, establish session.

**Step 2.1: Input Parsing**
- Parse $ARGUMENTS: extract idea/topic, flags (-y, -c, --from)
- If `-c`: read blueprint-config.json, resume from first incomplete phase
- If `--from <source>` (or `--from-brainstorm SESSION-ID` alias):
  - Resolve source to `context-package.json`:
    - `brainstorm:ID` → `state.json.artifacts[type=brainstorm, id=ID].context_package`
    - `@file` → create import session → delegate extraction → context-package.json
    - `path/` → load `path/context-package.json`
    - `--from-brainstorm SESSION-ID` → alias for `--from brainstorm:{resolve(SESSION-ID)}`
  - Load context-package.json as enriched seed:
    - `requirements[]` → Phase 3 PRD seed requirements (skip Phase 1.5)
    - `constraints[]` → Phase 4 Architecture ADR seed
    - `domain.terminology[]` → Phase 2 Glossary seed
    - `domain.problem_statement` → Phase 2 Product Brief context
    - `non_goals[]` → Phase 2 Product Brief exclusions
    - `insights[]` → Phase 4 Architecture decisions context
    - `references[]` → available for deep-read when needed
  - Set `input_type: "context-package"` — skip Phase 1.5
- If `@file`: read file content as seed
- If text: use directly as seed
- Missing input → error

**Step 2.2: Session Initialization**
```
Session: via maestro run create blueprint --session YYYYMMDD-blueprint-{slug}
Output dir: {run_dir}/outputs/
```

**Step 2.3: Seed Analysis via CLI** — MANDATORY, NOT SUBSTITUTABLE
- Spawn CLI analysis to extract: problem_statement, target_users, domain, constraints, dimensions (3-5)
- Assess complexity: simple (1-2 components) / moderate (3-5) / complex (6+)
- For context-package input: enrich with feature decomposition data

**Step 2.4: Codebase Exploration**
- Output: `discovery-context.json` with relevant_files, patterns, tech_stack

**Step 2.5: External Research**

`apiResearchContext` is passed into:
- Step 4 (Product Brief): technology feasibility assessment
- Step 5 (Requirements): API-aware requirement writing with concrete constraints
- Step 6 (Architecture): informed ADR decisions with version-specific details
- Step 7 (Epics): realistic story sizing based on API complexity

**Step 2.6: Spec Type Selection**
- Interactive (AskUserQuestion): Service / API / Library / Platform
- `--yes`: default to "service"
- Each type loads a profile template for domain-specific sections

**Step 2.7: User Confirmation (interactive)**
- Confirm problem statement, select depth (Light/Standard/Comprehensive), select focus areas
- `--yes`: accept all defaults

**Output**: `blueprint-config.json`, `discovery-context.json` (optional), `apiResearchContext` (in-memory, optional)

### Step 3: Requirement Expansion & Clarification (Phase 1.5)

Skip if `--from` (requirements already in context-package.json).

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
- For context-package input: read context-package.json domain and requirements sections

**Step 4.2: Multi-CLI Parallel Analysis (3 perspectives)** — MANDATORY, NOT SUBSTITUTABLE

| Perspective | Role | Focus |
|-------------|------|-------|
| Product | analyze | Vision, market fit, success criteria, scope boundaries |
| Technical | review | Feasibility, constraints, integration complexity, tech recommendations |
| User | explore | Personas, journey maps, pain points, UX criteria |

**Step 4.3: Synthesis**
- Extract convergent themes (all agree), conflicts (need resolution), unique insights
- For context-package input: cross-reference with context-package insights and constraints
- If `apiResearchContext` is set: inject API details into technical feasibility assessment

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

**Step 5.1: Requirement Expansion via CLI** — MANDATORY, NOT SUBSTITUTABLE
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

**Step 6.1: Architecture Analysis via CLI (role: review)** — MANDATORY, NOT SUBSTITUTABLE
- System architecture style with justification
- Core components and responsibilities
- Component interaction diagram (Mermaid graph TD)
- Technology stack: languages, frameworks, databases, infrastructure
- 2-4 Architecture Decision Records (ADRs): context, decision, alternatives, consequences, evidence_source
- Data model: entities and relationships (Mermaid erDiagram)
- Security architecture: auth, authorization, data protection
- **State machine**: ASCII diagram + transition table for lifecycle entities (service/platform type)
- **Configuration model**: all configurable fields with type, default, constraint
- **Error handling strategy**: per-component classification (transient/permanent/degraded), recovery mechanisms
- **Observability**: key metrics (5+), structured log events, health checks
- Spec type profile injection for domain-specific depth
- Glossary injection for terminology consistency
- If `apiResearchContext` is set: inject as "External API Research" context

**Step 6.2: Architecture Review via CLI (role: review)** — MANDATORY, NOT SUBSTITUTABLE
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

**Step 7.1: Epic Decomposition via CLI** — MANDATORY, NOT SUBSTITUTABLE
- Group requirements into logical Epics (EPIC-NNN IDs). Epic count is unconstrained — downstream workflows will merge Epics into minimal phases via the minimum-phase principle.
- Tag MVP subset
- For each Epic: 2-5 Stories in "As a...I want...So that..." format
- Each Story: 2-4 testable acceptance criteria, relative size (S/M/L/XL), trace to REQ-NNN
- Cross-Epic dependency map (Mermaid graph LR)
- Recommended execution order with rationale
- MVP definition of done (3-5 criteria)

**Epic sizing awareness** (informs downstream roadmap generation):
- Epics that are too small (1-2 Stories, all size S) should be flagged for merge downstream
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

**Step 8.1: Cross-Document Validation via CLI** — MANDATORY, NOT SUBSTITUTABLE
Score on 4 dimensions (25% each):
1. **Completeness**: all required sections present with substantive content
2. **Consistency**: terminology uniform (glossary compliance), scope containment, non-goals respected
3. **Traceability**: goals → requirements → architecture → epics (matrix generated)
4. **Depth**: acceptance criteria testable, ADRs justified, stories estimable

Gate decision: Pass (>=80) / Review (60-79) / Fail (<60) — **GATE: readiness-passed** (Pass/Review)

**Step 8.2: Generate Reports**
- `readiness-report.md` — quality scores, issue list (Error/Warning/Info), traceability matrix
- `blueprint-summary.md` — one-page executive summary

**Step 8.3: Update Document Status**
- All document frontmatter updated to `status: complete`

**Step 8.4: Gate Routing**

| Gate Result | Action |
|-------------|--------|
| Pass (>=80%) | Proceed to Step 10 (Final Handoff) |
| Review (60-79%) | Proceed to Step 10 with caveats logged |
| Fail (<60%) | Trigger Step 9 (Auto-Fix), then re-run Step 8 |

### Step 9: Auto-Fix (Phase 6.5, conditional)

Triggered when Phase 6 score < 60%.

**Step 9.1: Parse Readiness Report**
- Extract Error and Warning items, group by originating phase (2-5), map to affected files

**Step 9.2: Fix Affected Phases (sequential, Phase 2→3→4→5)**
- Read current phase output
- CLI re-generation with error context injected
- Inject glossary for terminology consistency
- Preserve unflagged content, only fix flagged issues
- Increment document version

**Step 9.3: Re-run Phase 6**
- Generate new readiness-report.md
- If still Fail and iteration_count < 2: loop back
- If Pass or max iterations (2) reached: proceed to handoff

**Output**: Updated Phase 2-5 documents, updated blueprint-config.json with iteration tracking

### Step 10: Final Handoff

Blueprint specification package is complete (all 6 phases done). Suggest next workflow steps. **GATE: phases-complete**

**Step 10.1: Handoff Options (AskUserQuestion)**

| Option | Action |
|--------|--------|
| Analyze specification | `analyze --from blueprint:{artifact_id}` |
| Generate roadmap | `roadmap --from blueprint:{artifact_id}` |
| Plan first phase | `plan 1 --from blueprint:{artifact_id}` |
| Create issues | Generate issues per Epic via Skill({ skill: "manage-issue" }) |
| Export only | Blueprint complete, no further action |

### Step 11: Final Report

```
== blueprint complete ==
Session: {session_id} | Quality: {score}% ({gate}) | Phases: {completed_count}/6
Output: {run_dir}/outputs/
  blueprint-config.json, product-brief.md, requirements/, architecture/, epics/,
  readiness-report.md, blueprint-summary.md, context-package.json

Next: analyze (deep analysis) | roadmap (generate roadmap) | plan 1 (plan first phase)
```

→ Wrap-up follows ref/finish-work.md (when gate is Pass/Review; SESSION_TYPE=blueprint, SESSION_ID={session_id}). Skipped on Fail — session stays active, excluded from wiki search.

---

## State Management

**blueprint-config.json**:
```json
{
  "session_id": "BLP-xxx-2026-03-15",
  "seed_input": "User input text",
  "input_type": "text|file|context-package",
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
    { "phase": 1, "name": "discovery", "output_file": "blueprint-config.json", "completed_at": "ISO8601" }
  ]
}
```

Resume: `-c` reads blueprint-config.json, resumes from first incomplete phase.

## Error Codes

| Phase | Error | Blocking? | Action |
|-------|-------|-----------|--------|
| Phase 1 | Empty input | Yes | Error and exit |
| Phase 1 | CLI analysis fails | No | Basic parsing fallback; flag seed_analysis as [LOW CONFIDENCE] (CLI analysis unavailable) |
| Phase 1.5 | Gap analysis fails | No | Skip to basic prompts; flag refined-requirements.json as [LOW CONFIDENCE] (no gap analysis) |
| Phase 2 | Single CLI fails | No | Continue with available; flag product-brief.md as [LOW CONFIDENCE] (missing perspective) |
| Phase 3 | Gemini fails | No | Codex fallback; flag affected REQ-NNN.md as [LOW CONFIDENCE] (model fallback) |
| Phase 4 | Review fails | No | Skip review; flag ADR-NNN.md as [LOW CONFIDENCE] (no peer review) |
| Phase 5 | Story generation fails | No | Generate epics only; flag EPIC-NNN.md stories as [LOW CONFIDENCE] (stories incomplete) |
| Phase 6 | Validation fails | No | Partial report; flag readiness-report.md as [LOW CONFIDENCE] (validation incomplete) |
| Phase 6.5 | Max iterations (2) | No | Force handoff; flag readiness-report.md as [LOW CONFIDENCE] (auto-fix exhausted) |
| Step 2.5 | External research fails | No | apiResearchContext = null, continue; flag apiResearchContext as [LOW CONFIDENCE] (no external research) |
| Init | E006: `.workflow/` not initialized | Yes | Run maestro-init first |
| Phase 6 | E007: Readiness Fail after 2 auto-fix iterations | No | Present manual fix options |
| Step 2.5 | W005: External research agent failed | No | Continue without apiResearchContext |

CLI Fallback Chain: Role-based resolution → degraded mode (local only); flag affected phase artifacts as [LOW CONFIDENCE] (CLI unavailable, local-only analysis)

## Success Criteria

- [ ] `blueprint-config.json` created with session metadata and phase tracking
- [ ] `product-brief.md` with vision, goals, scope, multi-perspective synthesis
- [ ] `glossary.json` with 5+ core terms for cross-document consistency
- [ ] `requirements/` directory with `_index.md` + individual `REQ-*.md` + `NFR-*.md` files
- [ ] All requirements have RFC 2119 keywords and acceptance criteria
- [ ] `architecture/` directory with `_index.md` + individual `ADR-*.md` files
- [ ] Architecture includes state machine, config model, error handling, observability (service type)
- [ ] `epics/` directory with `_index.md` + individual `EPIC-*.md` files
- [ ] Cross-Epic dependency map (Mermaid) and MVP subset tagged
- [ ] `readiness-report.md` with 4-dimension quality scores and traceability matrix
- [ ] `blueprint-summary.md` with one-page executive summary
- [ ] All documents have valid YAML frontmatter with session_id
- [ ] Glossary terms used consistently across all documents
- [ ] Readiness gate: Pass (>=80%) or Review (>=60%) with documented concerns
- [ ] context-package.json generated for downstream consumption

## Next-Step Routing

| Condition | Next Step |
|-----------|-----------|
| Gate Pass/Review | `roadmap --from blueprint:{artifact_id}` |
| Gate Fail | fix issues, re-run readiness check |
| Need implementation plan | `plan --from blueprint:{artifact_id}` |
| Need stress-testing | `grill` |
