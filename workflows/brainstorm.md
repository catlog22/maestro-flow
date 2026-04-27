# Workflow: Brainstorm

Unified brainstorming workflow with dual-mode operation: auto pipeline (full multi-role analysis) and single role analysis mode.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  /maestro-brainstorm                    │
│           Unified Entry Point + Interactive Routing      │
└───────────────────────┬─────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              ↓                   ↓
    ┌─────────────────┐  ┌──────────────────┐
    │   Auto Mode     │  │ Single Role Mode │
    └────────┬────────┘  └────────┬─────────┘
             │                    │
    ┌────────┼────────┐          │
    ↓        ↓        ↓          ↓
 Phase 2  Phase 3  Phase 4    Phase 3
Artifacts  N×Role  Synthesis  1×Role
           并行               Analysis
```

## Dual-Mode Routing

### Auto Mode (full pipeline)
Triggered by `--yes`/`-y` flag or user selection.

```
Phase 1: Mode Detection → Parse args, detect mode
Phase 1.5: Terminology & Boundary → Extract terms, collect Non-Goals
Phase 2: Interactive Framework → 7 sub-phases (context → topic → roles → questions → conflicts → check → spec)
Phase 3: Parallel Role Analysis → N concurrent role analyses via conceptual-planning-agent
Phase 4: Synthesis Integration → Cross-role analysis → user clarification → spec generation
```

### Single Role Mode
Triggered when first arg is a valid role name.

```
Phase 1: Mode Detection → Parse args, detect mode
Phase 3: Single Role Analysis → Detection → Context → Agent → Validation
```

## Input

- `$ARGUMENTS`: topic text (auto mode) or role name (single role mode)
- All output goes to `.workflow/scratch/brainstorm-{slug}-{date}/`
- Registers artifact (type=brainstorm) in state.json on completion

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--yes`, `-y` | Auto mode, skip all questions | - |
| `--count N` | Number of roles to select | 3 |
| `--session ID` | Use existing session | - |
| `--update` | Update existing analysis | - |
| `--include-questions` | Interactive context gathering | - |
| `--skip-questions` | Use default answers | - |
| `--style-skill PKG` | Style package for ui-designer | - |

### Available Roles

| Role ID | Title | Focus Area |
|---------|-------|------------|
| `data-architect` | 数据架构师 | Data models, storage strategies, data flow |
| `product-manager` | 产品经理 | Product strategy, roadmap, prioritization |
| `product-owner` | 产品负责人 | Backlog management, user stories, acceptance criteria |
| `scrum-master` | 敏捷教练 | Process facilitation, impediment removal |
| `subject-matter-expert` | 领域专家 | Domain knowledge, business rules, compliance |
| `system-architect` | 系统架构师 | Technical architecture, scalability, integration |
| `test-strategist` | 测试策略师 | Test strategy, quality assurance |
| `ui-designer` | UI设计师 | Visual design, mockups, design systems |
| `ux-expert` | UX专家 | User research, information architecture, journey |

## Output

### Directory Structure

All brainstorm output goes to scratch:
```
.workflow/scratch/brainstorm-{slug}-{date}/
├── guidance-specification.md         # Phase 2 output
├── feature-index.json               # Phase 4 output
├── synthesis-changelog.md            # Phase 4 audit trail
├── feature-specs/                   # Phase 4 feature specs
│   ├── F-001-{slug}.md
│   └── F-00N-{slug}.md
├── {role}/                          # Phase 3 role analyses (immutable)
│   ├── {role}-context.md
│   ├── analysis.md
│   ├── analysis-cross-cutting.md
│   └── analysis-F-{id}-{slug}.md
└── synthesis-specification.md       # Non-feature mode fallback
```

---

## Process

### Step 1: Parse & Route (Mode Detection)

Parse $ARGUMENTS to determine execution mode:

**Mode Detection (ordered by priority)**:
1. `--yes` or `-y` flag → **Auto Mode** (no question asked)
2. First non-flag arg matches valid role name → **Single Role Mode**
3. First non-flag arg is a number → **Phase Mode** (resolve phase dir, then auto)
4. Text provided without flags → Ask user via AskUserQuestion:
   - "自动模式 (推荐)" — 完整流程：框架生成 → 多角色并行分析 → 跨角色综合
   - "单角色分析" — 为单个角色生成分析文档

**Parameter Parsing**:
- `--count N`: cap at 9, default 3
- `--session ID`: target specific session
- `--style-skill PKG`: validate `.claude/skills/style-{PKG}/SKILL.md` exists
- Missing/empty args without flags = error E001

**Session Detection**:
- Check `.workflow/scratch/brainstorm-*/` for existing sessions
- Multiple → AskUserQuestion to select | Single → use it
- None + auto mode → will create new session
- None + single role mode → error E002

**Output Directory Resolution**:
- Phase mode (number): resolve `state.json.artifacts[phase == phaseNum].path` → `.workflow/{path}/.brainstorming/` (ERROR if phase not found)
- All output: `.workflow/scratch/brainstorm-{slug}-{date}/`
- Existing session: use existing session directory

---

### Step 1.5: Load Project Specs

```
specs_content = maestro spec load --category arch
```

Pass to conceptual-planning-agent in Step 4 for architecture-aware role analysis.

---

### Auto Mode Steps (Phase 1.5 → Phase 1.7 → Phase 2 → Phase 3 → Phase 4)

### Step 1.7: External Research — Design Routes (Auto Mode, Optional)

Spawn `workflow-external-researcher` agent to discover design alternatives, architecture patterns, and competitive approaches for the brainstorm topic. This enriches the framework generation and role analyses with external knowledge.

**Trigger**: Always in auto mode. Skip if `--skip-questions` and no tech keywords detected.

**Auto-suggest when**: Topic contains technology keywords, architecture terms, or "design" / "pattern" / "alternative" in the description.

```
// Step 1.7.1: Spawn external researcher for design routes
Agent(
  subagent_type="workflow-external-researcher",
  prompt="""
<objective>
Research design alternatives and architecture patterns for: {topic}
Mode: Design Research
</objective>

<context>
Project specs: {specs_content or "none"}
Topic keywords: {extracted_keywords}
</context>

<task>
Search for:
1. Reference projects — how 2-3 similar projects/products solve this problem (architecture, key decisions, what worked)
2. Extractable patterns — reusable design patterns distilled from those projects, with applicability notes
3. Architecture approaches (at least 2-3 alternatives with trade-offs)
4. UX/UI patterns if applicable (interaction models, layout strategies)
5. Common design pitfalls and anti-patterns to avoid

IMPORTANT: Output MUST include "Reference Projects / Implementations" and "Extractable Patterns" sections.
Focus on design ROUTES — alternative approaches the brainstorm roles can evaluate.
Be prescriptive where evidence is strong, present alternatives where trade-offs exist.
Return structured markdown only — do NOT write files.
</task>
  """,
  run_in_background=false
)

// Step 1.7.2: Store as designResearchContext (in-memory)
designResearchContext = agent_output
```

`designResearchContext` is passed into:
- Step 2 (Terminology): enriches domain term extraction
- Step 3 Phase 1 (Topic Analysis): provides external design alternatives
- Step 4 (Parallel Role Analysis): each role agent receives design research as additional context

If research fails (W005): `designResearchContext = null`, continue without external context.

---

### Step 1.8: Load Project Context (if `.workflow/` exists)

Load existing project history to ground brainstorming in what's already been built:

- From `.workflow/project.md`: `### Validated` → already_shipped, `### Active` → current_scope, `## Context` → project_history
- From `.workflow/state.json.accumulated_context`: `deferred[]` → deferred_items, `key_decisions[]` → existing_constraints

Pass `project_context` into Step 2 (terminology) and Step 3 (framework generation):
- `already_shipped` informs what exists — brainstorm should explore extensions, not re-invent
- `deferred_items` are high-value brainstorming seeds
- `lessons_learned` surface pitfalls to avoid

---

### Step 2: Terminology & Boundary Definition (Auto Mode)

Extract core terminology and define scope boundaries before framework generation.

1. Analyze topic description and any project context (project.md, roadmap.md, project_context from Step 1.8)
2. Extract 5-10 core domain terms:
   - term (canonical), definition, aliases, category (core|technical|business)
3. AskUserQuestion for Non-Goals (multiSelect=true):
   - Generate 4-5 context-aware exclusion candidates based on topic
   - Include "其他（请补充）" option for custom exclusions
   - If user selects "其他", follow up with free-text question
4. Store terminology table and non_goals to session state

**Skip if**: `--yes` flag (use auto-generated terms, empty non-goals)

### Step 3: Interactive Framework Generation (Auto Mode)

Seven sub-phases producing guidance-specification.md:

**Phase 0: Context Collection**
- Read init outputs directly: `.workflow/project.md` (tech stack, requirements, decisions), `.workflow/state.json` (project state), `.workflow/specs/` (conventions)
- If `.workflow/` does not exist: continue without project context

**Phase 1: Topic Analysis**
- Load Phase 0 context (tech_stack, modules, conflict_risk)
- Deep topic analysis (entities, challenges, constraints, metrics)
- Generate 2-4 context-aware probing questions via AskUserQuestion
- Questions MUST reference topic keywords (no generic questions)
- Store to `session.intent_context`

**Phase 2: Role Selection**
- Analyze Phase 1 keywords → recommend count+2 roles with rationale
- AskUserQuestion (multiSelect=true) for user to select `count` roles
- If `--yes`: auto-select recommended roles
- Store to `session.selected_roles`

**Phase 3: Role-Specific Questions**
- FOR each selected role, generate 3-4 deep questions mapping role expertise to Phase 1 challenges
- AskUserQuestion per role (sequential, one role at a time)
- Questions must include: implementation depth, trade-offs, edge cases
- Store to `session.role_decisions[role]`
- If `--yes`: skip all role questions

**Phase 4: Conflict Resolution**
- Analyze Phase 3 answers for contradictions, missing integrations, implicit dependencies
- Generate clarification questions referencing SPECIFIC Phase 3 choices
- AskUserQuestion (max 4 per round)
- If NO conflicts detected: skip with notification
- Store to `session.cross_role_decisions`

**Phase 4.5: Final Clarification + Feature Decomposition**
- Ask: "是否有前面未澄清的重点需要补充？" (无需补充 / 需要补充)
- If "需要补充": progressive questions until resolved
- Extract candidate features from all Phase 1-4 decisions (max 8)
- Each feature: F-{3-digit} ID, kebab-case slug, description, related roles, priority
- Validate: independence, completeness, granularity balance, boundary clarity
- AskUserQuestion for user to confirm or adjust feature list
- Store to `session.feature_list`

**Phase 5: Generate Specification**
- Load all decisions + terminology + non_goals + feature_list
- Transform Q&A to declarative statements (CONFIRMED/SELECTED)
- Apply RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT)
- Write `guidance-specification.md` with sections:
  1. Project Positioning & Goals
  2. Concepts & Terminology (table)
  3. Non-Goals (Out of Scope)
  4-N. [Role] Decisions (with RFC 2119)
  Cross-Role Integration
  Risks & Constraints
  Feature Decomposition (table)
  Appendix: Decision Tracking
- Validate: no interrogative sentences, all decisions traceable, RFC keywords applied

**Output**: `{output_dir}/guidance-specification.md`, session metadata (workflow-session.json)

### Step 4: Parallel Role Analysis (Auto Mode)

For EACH selected role, spawn a conceptual-planning-agent in parallel:

```
Agent({
  subagent_type: "conceptual-planning-agent",
  prompt: "[role analysis prompt with framework + role template]",
  run_in_background: false
})
```

Each agent receives:
- `guidance-specification.md` for framework context
- Role-specific template from `~/.maestro/templates/planning-roles/{role}.md`
- Feature list for feature-point organization
- `--skip-questions` flag (context already gathered in Phase 2)
- For ui-designer: `--style-skill {package}` if provided
- If `designResearchContext` is set: include as "External Design Research" section in agent prompt (design alternatives, patterns, competitive analysis for the role to evaluate and reference)

**Feature-Point Organization** (when feature list available):
- `analysis.md` — Role overview INDEX only (< 1500 words)
- `analysis-cross-cutting.md` — Cross-feature decisions (< 2000 words)
- `analysis-F-{id}-{slug}.md` — Per-feature analysis (< 2000 words each)

**Fallback Organization** (no feature list):
- `analysis.md` — Main analysis (< 3000 words)
- Optional `analysis-{slug}.md` sub-documents (max 5)

**system-architect specific requirements**:
- MUST include: Data Model (3-5 entities), State Machine (ASCII + transition table), Error Handling, Observability (5+ metrics), Configuration Model, Boundary Scenarios
- All constraints MUST use RFC 2119 keywords

**Quality Validation** (after each role completes, orchestrator self-check):
- Verify `analysis.md` exists and is non-empty
- Feature mode: verify `analysis-cross-cutting.md` + `analysis-F-*.md` files match feature list
- Grep for RFC 2119 keywords (MUST/SHOULD/MAY) — warn if < 5 occurrences
- Check word count (wc -w) against limits — warn if exceeded
- system-architect: verify Data Model and State Machine sections exist

**Parallel Safety**: Each role operates on its own directory. No cross-agent dependencies.

### Step 5: Synthesis Integration (Auto Mode)

Six sub-phases producing feature specs from cross-role analysis:

**Sub-phase 1: Discovery**
- Detect session, validate analysis files exist
- Load user intent from session metadata
- Detect feature mode (feature decomposition table + analysis-F-*.md files)

**Sub-phase 2: File Discovery**
- Glob `{output_dir}/{role}/analysis*.md`
- Extract role_analysis_paths and participating_roles
- Feature mode optimization: read only analysis.md index files (~4.5K total) not sub-documents

**Sub-phase 3A: Cross-Role Analysis Agent**
- Spawn conceptual-planning-agent for cross-role analysis
- Input: analysis index files (feature mode) or all analysis files (fallback)
- Output: `enhancement_recommendations` (EP-001, EP-002, ...) + `feature_conflict_map` (per-feature consensus/conflicts/cross_refs)
- Conflict resolution quality: actionable, justified ("because...tradeoff:..."), scoped, confidence-tagged ([RESOLVED]|[SUGGESTED]|[UNRESOLVED])

**Sub-phase 4: User Interaction**
- Enhancement selection: AskUserQuestion (multiSelect=true, batched by 4)
- Clarification questions: 9-category taxonomy scan, AskUserQuestion (single-select, multi-round)
- Build spec_context: selected_enhancements + clarification_answers + original_user_intent
- If `--yes`: auto-select all enhancements, skip clarifications

**Sub-phase 5: Spec Generation + Conditional Review**
- Single conceptual-planning-agent generates all specs sequentially:
  - Feature mode: one `feature-specs/F-{id}-{slug}.md` per feature (7 sections, 1500-2500 words)
  - Fallback mode: single `synthesis-specification.md`
  - `feature-index.json` (feature mode only)
  - `synthesis-changelog.md` (enhancements applied, clarifications resolved, conflicts resolved)
- Self-evaluate complexity_score (0-8 scale: feature count, unresolved conflicts, roles, cross-deps)
- If complexity_score >= 4: trigger review agent for cross-feature consistency check
  - Minor fixes applied directly, major issues flagged with [REVIEW-FLAG]

**Feature Spec Template (7 Sections)**:
1. Requirements Summary (RFC 2119 keywords)
2. Design Decisions [CORE — 40%+ word count]
3. Interface Contract
4. Constraints & Risks
5. Acceptance Criteria
6. Detailed Analysis References (@-links)
7. Cross-Feature Dependencies

**Four-Layer Aggregation Rules**:
- Layer 1: Direct Reference (consensus → quote roles)
- Layer 2: Structured Extraction (complementary → merge, de-duplicate)
- Layer 3: Conflict Distillation ([RESOLVED] → decision, [SUGGESTED] → recommended, [UNRESOLVED] → [DECISION NEEDED])
- Layer 4: Cross-Feature Annotation (dependency notes, integration points)

**Sub-phase 6: Finalization**
- Update context-package.json with spec paths
- Update session metadata (enhancements_applied, questions_asked, complexity_score, review results)
- Completion report with next step suggestion

---

### Single Role Mode Steps

### Step 6: Single Role Analysis

Execute analysis for ONE specified role with optional interactive context gathering.

**Step 6.1: Detection & Validation**
- Validate role_name against VALID_ROLES list
- Detect session (--session or find existing)
- Check for guidance-specification.md → framework_mode
- Extract feature list → feature_mode
- Check existing analysis → update_mode (ask: update/regenerate/cancel)

**Step 6.2: Interactive Context Gathering**
- Skip if `--skip-questions`
- Force if `--include-questions`
- Generate 3-5 role-specific questions (Chinese, with business context)
- AskUserQuestion per batch (max 4 per round)
- Save context to `{role}/{role}-context.md`

**Step 6.3: Agent Execution**
- Spawn conceptual-planning-agent with:
  - Role name, framework (if exists), feature list (if exists)
  - User context (if gathered), session metadata
  - Role-specific template
  - For ui-designer: style-skill package
- Agent generates analysis files in `{output_dir}/{role}/`

**Step 6.4: Validation**
- Verify `analysis.md` exists
- Check framework reference if framework_mode
- Update session metadata with completion status
- Report results with next step suggestions

---

### Step 7: Final Report

**Auto mode report:**
- Session ID and output directory
- Roles analyzed (N)
- Features specified (N)
- Enhancements applied (EP-IDs)
- Complexity score and review status
- Next:
  Skill({ skill: "maestro-spec-generate", args: "--from-brainstorm {sessionId}" })  — Generate full spec package
  Skill({ skill: "maestro-analyze", args: "{topic}" })   — Evaluate feasibility + lock decisions
  Skill({ skill: "maestro-analyze", args: "{phase} -q" })   — Quick decision extraction only
  Skill({ skill: "maestro-plan", args: "{phase}" })       — Plan directly (if scope is clear)

**Single role mode report:**
- Role analyzed
- Framework alignment status
- Context questions answered
- Output file location
- Next: run more roles or Skill({ skill: "maestro-brainstorm", args: "--session {sessionId}" }) for synthesis

---

## Quality Criteria

- If `designResearchContext` is set: guidance-specification.md references external design findings
- guidance-specification.md uses RFC 2119 keywords (MUST/SHOULD/MAY)
- Concepts & Terminology section with 5-10 core terms
- Non-Goals section with rationale
- Feature Decomposition table (max 8 features, independently implementable)
- Role analyses follow role-specific templates
- system-architect includes: Data Model, State Machine, Error Handling, Observability
- Feature specs have 7 sections, Section 2 (Design Decisions) is 40%+ of content
- All conflicts resolved or marked [DECISION NEEDED]
- synthesis-changelog.md records all synthesis decisions as audit trail
