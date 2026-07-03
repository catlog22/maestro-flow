# Workflow: Analyze

Multi-dimensional iterative analysis with CLI exploration, multi-perspective synthesis, discussion timeline, intent tracking, and decision extraction.

## Pipeline Position

```
maestro-brainstorm (optional upstream)
        ↓ ideas, scored options
maestro-analyze ← THIS
        ↓ analysis.md, discussion.md, conclusions.json, context.md, context-package.json
maestro-plan → maestro-execute (includes verification)
```

## Architecture

```
Full mode (-q omitted):
  Phase 1:    Setup & Scoping         → session init, dimension selection, discussion.md
              |
  Phase 2:    CLI Exploration          → exploration-codebase.json, explorations.json/perspectives.json
              |                           (cli-explore-agent 3-layer + multi-CLI parallel)
              |
  Phase 3:    Interactive Discussion   → discussion.md rounds (max 5)
              |                           (Decision Recording Protocol, Intent Coverage)
              |
  Phase 4:    Six-Dimension Scoring    → 6 dimensions × 1-5 score + risk matrix
              |
  Phase 5:    Synthesis & Conclusion   → conclusions.json, analysis.md, final discussion.md
              |
  Phase 6:    Decision Extraction      → context.md (Locked/Free/Deferred)
              └── Next Step: plan / issue / done

Quick mode (-q):
  Phase 1:    Setup (minimal)          → load context, skip scoping
              |
  Phase 6:    Decision Extraction      → context.md (Locked/Free/Deferred)
              └── Next Step: plan / done
```

## Arguments

```
$ARGUMENTS: "[milestone|topic] [-y] [-c] [-q] [--from <source>]"

(no args)   -- Milestone-wide analysis (requires init + roadmap)
<milestone>  -- Milestone number (milestone-scoped, requires init + roadmap)
<topic>     -- Topic text (adhoc if milestone exists, standalone if not)
-y / --yes  -- Auto mode, skip interactive scoping, auto-deepen
-c / --continue -- Resume from existing session
-q / --quick -- Quick mode, skip exploration + scoring, go straight to decision extraction
--from <source>  -- Load upstream context package (grill:ID, brainstorm:ID, analyze:ID, @file, or path). Replaces --from-brainstorm
```

## Scope Routing

```
Worktree guard: If .workflow/worktree-scope.json exists, reject milestone args not in owned scope.

Auto-bootstrap: Create minimal .workflow/state.json if missing.

Scope determination → OUTPUT_DIR:
  (no args) + milestone + roadmap → scope="milestone", mode="micro", OUTPUT_DIR=.workflow/scratch/{YYYYMMDD}-analyze-M{N}-{milestone_slug}/
  (no args) without milestone/roadmap → ERROR E001
  (number) + milestone + roadmap   → scope="milestone", mode="micro", OUTPUT_DIR=.workflow/scratch/{YYYYMMDD}-analyze-M{N}-{milestone_slug}/
  (number) without milestone/roadmap → ERROR
  (text) + milestone               → scope="adhoc", mode="macro", OUTPUT_DIR=.workflow/scratch/{YYYYMMDD}-analyze-{topic_slug}/
  (text) without milestone         → scope="standalone", mode="macro", OUTPUT_DIR=.workflow/scratch/{YYYYMMDD}-analyze-{topic_slug}/

Macro mode additions (scope="adhoc" or "standalone"):
  - In Step 6 Synthesis, evaluate scope_verdict: "small" | "medium" | "large"
    - large: 3+ independent subsystems or hard serial dependency barriers
    - medium: 1-2 subsystems, parallelizable
    - small: single-file or few-file change
  - Write scope_verdict to context.md conclusions section
  - Include scope_verdict in context-package.json for downstream consumption

Milestone resolution (when scope="milestone"):
  IF numeric arg specified: target_milestone = that milestone number
  ELSE: target_milestone = current_milestone (fallback)
  IF target_milestone not found in state.json.milestones[]: ERROR

  Use target_milestone for:
    - artifact registration (milestone field in Step 8.9)
    - loading prior artifacts (Step 1 context loading)

Create OUTPUT_DIR.
```

## Output Structure

```
{OUTPUT_DIR}/
├── discussion.md              # Full timeline: TOC, rounds, decisions, intent coverage
├── analysis.md                # 6-dimension scoring summary + risk matrix + Go/No-Go (skip in -q)
├── exploration-codebase.json  # Codebase exploration (skip in -q)
├── explorations.json          # Single perspective aggregated findings (skip in -q)
├── perspectives.json          # Multi-perspective findings + synthesis (skip in -q)
├── conclusions.json           # Final synthesis, recommendations, decision trail (skip in -q)
├── context.md                 # Decision extraction: Locked/Free/Deferred decisions for plan
└── context-package.json       # Standardized context package for cross-command consumption
```

---

## Phase Gates (Standard Mode, when `-q` and `--gaps` are BOTH absent)

MANDATORY and BLOCKING. Do NOT advance past a gate until ALL conditions are met.

**GATE 1: Step 4 → Step 5** (Exploration → Discussion)
- REQUIRED: cli-explore-agent completed (Step 4.1), `exploration-codebase.json` written with ≥1 code anchor
- REQUIRED: ≥1 maestro delegate CLI call completed (Step 4.2), output in `explorations.json` or `perspectives.json`
- REQUIRED: Baseline confidence scoring recorded in discussion.md (Step 4.6)

**GATE 2: Step 5 → Step 6** (Discussion → Scoring)
- REQUIRED: discussion.md contains ≥1 interactive round with user feedback (Step 5.3)
- REQUIRED: Confidence re-scored ≥1 time with delta shown (Step 5.8)
- REQUIRED: Pressure pass completed ≥1 time (Step 5.9)

**GATE 3: Step 6 → Step 7** (Scoring → Synthesis)
- REQUIRED: analysis.md written with all 6 dimensions scored
- REQUIRED: Each dimension score cites evidence from exploration-codebase.json or explorations.json — NOT from manual file reading

**GATE 4: Step 7 → Step 8** (Synthesis → Decision Extraction)
- REQUIRED: conclusions.json written with recommendations and decision trail
- REQUIRED: Intent Coverage Matrix shows no unresolved ❌ items (or user-confirmed deferrals)

---

## Process

### Step 1: Parse Input & Initialize Session

Parse $ARGUMENTS to determine mode and flags:
- `-c` present: locate existing session folder (discussion.md exists), resume from last round
- `-y` present: set AUTO_MODE=true
- `-q` present: set QUICK_MODE=true (skip Steps 2-7, jump to Step 8: Decision Extraction)
- Number (e.g., "3") = milestone scope: resolve milestone slug from roadmap, output to scratch/{YYYYMMDD}-analyze-M{N}-{milestone-slug}/
- Text (e.g., "microservices vs monolith") = adhoc/standalone scope: output to scratch/{YYYYMMDD}-analyze-{slug}/
- Missing/empty = milestone scope (if roadmap exists) or error E001

**Session initialization:**
- Session ID: `ANL-{slug}-{YYYY-MM-DD}`
- Output: `OUTPUT_DIR` (always under `.workflow/scratch/`)

**Load prior context** (milestone/phase scope):
1. Read `.workflow/project.md` — project vision, constraints, Validated requirements (already shipped), Active requirements (current scope)
2. Read `.workflow/roadmap.md` — phase structure and dependencies
3. Read `.workflow/state.json` → `current_milestone`, `artifacts[]`, `accumulated_context` (key_decisions, deferred items, blockers)
4. Find prior analyze artifacts from `state.json.artifacts[]` where type=analyze and same milestone → load their `context.md` to skip already-decided areas
5. **Load upstream context** (priority order):
   a. If `--from` specified: resolve source → load `context-package.json` (see §9 of workflow-structure-guide.md)
      - `--from grill:ID` → `state.json.artifacts[type=grill, id=ID].context_package` → load
      - `--from brainstorm:ID` → `state.json.artifacts[type=brainstorm, id=ID].context_package` → load
      - `--from @file` → create import session, delegate extraction → load context-package.json
      - `--from path/` → load `path/context-package.json`
   b. Else: auto-discover from `state.json.artifacts[]` where type=brainstorm and same milestone → if artifact has `context_package` field, load it; else fallback to reading `guidance-specification.md` directly
   
   From loaded context-package:
   - `constraints[status=locked]` → skip these areas (already decided)
   - `constraints[status=open]` → prioritize for analysis
   - `open_questions[]` → seed discussion topics
6. Load project specs: `specs_content = maestro spec load --category arch`
7. Load domain glossary: read `.workflow/domain/glossary.yaml`（如存在）— 分析过程中使用 canonical term names 保持术语一致性；新发现的术语候选记入 `context-package.json#domain.terminology[]`

**Load prior context** (adhoc/standalone scope):
1. Read `.workflow/project.md` (if exists) — project vision, Validated requirements, Active requirements, Key Decisions
2. Read `.workflow/state.json` (if exists) → `accumulated_context` (key_decisions, deferred, blockers)
3. Load project specs: `specs_content = maestro spec load --category arch`
4. Load domain glossary: read `.workflow/domain/glossary.yaml`（如存在）

**Quick mode routing**: If QUICK_MODE, skip to Step 8 (Decision Extraction) after loading context.

### Step 1.5: Archive Previous Artifacts

Skip if `-c` (resuming — working on existing session).

Before writing any new artifacts, archive existing ones to preserve history:

```
ARCHIVE_TARGETS = ["discussion.md", "analysis.md", "explorations.json", "perspectives.json", "conclusions.json", "exploration-codebase.json"]

If any ARCHIVE_TARGETS exist in OUTPUT_DIR:
  Move each existing target to OUTPUT_DIR/.history/{name}-{YYYY-MM-DDTHH-mm-ss}.{ext}
```

### Step 2: Scoping & Dimension Selection

Skip if `-c` (resuming) or `-y` (auto mode uses defaults).

**Interactive scoping** via single AskUserQuestion (up to 3 questions):

1. **Focus** (multiSelect, header: "分析方向"): Present 3-4 directions from Dimension-Direction Mapping:

   | Dimension | Directions |
   |-----------|-----------|
   | architecture | System Design, Component Interactions, Technology Choices, Design Patterns |
   | implementation | Code Structure, Patterns, Error Handling, Algorithm Analysis |
   | performance | Bottlenecks, Optimization, Resource Utilization, Concurrency |
   | security | Vulnerabilities, Auth, Data Protection, Input Validation |
   | concept | Foundation, Core Mechanisms, Patterns, Trade-offs |
   | comparison | Solution Comparison, Pros/Cons, Technology Evaluation |
   | decision | Criteria, Trade-off Analysis, Risk Assessment, Impact |
   | external_research | Standard Stack, Architecture Patterns, Don't Hand-Roll, Common Pitfalls (external web search) |

   **Auto-suggest `external_research`** when phase goal contains unfamiliar technology keywords or when no codebase patterns exist for the domain (codebase exploration in Step 4.1 returns empty relevant_files).

2. **Perspectives** (multiSelect, header: "分析视角"): Up to 4:

   | Perspective | CLI Tool | Focus |
   |-------------|----------|-------|
   | Technical | gemini | Implementation, code patterns, feasibility |
   | Architectural | claude | System design, scalability, interactions |
   | Business | codex | Value, ROI, stakeholder impact |
   | Domain Expert | gemini | Domain patterns, best practices, standards |

3. **Depth** (single-select, header: "分析深度"):
   - Quick Overview / Standard / Deep Dive

**Auto mode defaults**: all dimensions relevant to topic, single comprehensive perspective, Standard depth.

### Step 3: Initialize discussion.md

Write initial `discussion.md` to output directory:
- Dynamic TOC (updated after each round/phase)
- Session metadata (id, topic, dimensions, perspectives, depth)
- User Intent section (original topic/question for intent tracking)
- Current Understanding block (replaceable — overwritten each round, NOT appended): initialized as "To be populated after exploration"
- Empty discussion timeline
- Dimension selection rationale

### Step 4: CLI Exploration

Codebase exploration FIRST, then (optionally) external research, then CLI analysis.

**Step 4.0: External Research** (only if `external_research` dimension selected)

Orchestrator performs targeted web searches, then hands results to `workflow-phase-researcher` agent for synthesis.

```
1. WebSearch 2-3 queries: "{phase_goal} standard library stack", "architecture patterns best practices", "common pitfalls mistakes"
   Fetch top 1-2 results per query for official docs.

2. Hand raw search output to workflow-phase-researcher agent to synthesize into:
   - ## Standard Stack: concrete library recommendations with versions
   - ## Architecture Patterns: recommended patterns
   - ## Don't Hand-Roll: problems with existing solutions
   - ## Common Pitfalls: mistakes to avoid
   Style: prescriptive ("use X"), cite sources, confidence levels (HIGH/MEDIUM/LOW).
   Agent returns structured markdown only (no file writes).

3. Store agent output as researchContext (in-memory).
```

`researchContext` is passed into Step 4.2 CLI Analysis and Step 8 Decision Extraction.
If `external_research` not selected: `researchContext = null`.

**Step 4.1: Codebase Exploration** (cli-explore-agent) — MANDATORY, NOT SUBSTITUTABLE

MUST spawn cli-explore-agent; manual Read/Grep is not a substitute. Produces exploration-codebase.json required for Step 5.

Spawn cli-explore-agent with 3-layer exploration:

| Layer | Focus | Output |
|-------|-------|--------|
| Layer 1: Module Discovery (Breadth) | Search by topic keywords, identify ALL relevant files, map module boundaries | `relevant_files[]` |
| Layer 2: Structure Tracing (Depth) | Top 3-5 key files: trace call chains 2-3 levels deep, identify data flow | `call_chains[]`, `data_flows[]` |
| Layer 3: Code Anchor Extraction (Detail) | Each key finding: extract code snippet (20-50 lines) with file:line | `code_anchors[]` |

Output: `exploration-codebase.json` (single) or `explorations/{perspective}.json` (multi-perspective, parallel up to 4)

**Step 4.2: CLI Analysis** (AFTER exploration) — MANDATORY, NOT SUBSTITUTABLE

MUST invoke at least one maestro delegate CLI call. The orchestrator's own analysis is NOT independent verification — CLI tools provide cross-validation from a separate model/perspective.

Build exploration context from Step 4.1 findings, then spawn CLI analysis.
If `researchContext` is set (from Step 4.0), include it as additional context in each CLI call:

```
// Append to CLI prompt when researchContext exists:
"External research findings (treat as strong recommendations, not laws):
{researchContext}"
```

- **Single perspective**: one comprehensive CLI call with exploration context
- **Multi-perspective** (up to 4): parallel CLI calls per perspective, each with perspective-specific focus

CLI calls use `run_in_background: true`. Wait for results before continuing.

**Step 4.3: Aggregate Findings**

- Consolidate explorations + CLI results
- Multi-perspective: extract synthesis (convergent themes, conflicting views, unique contributions)
- Write to `explorations.json` (single) or `perspectives.json` (multi)

`explorations.json` includes `technical_solutions[]`: `{round, solution, problem, rationale, alternatives, status: proposed|validated|rejected, evidence_refs[], next_action}` — populated throughout Step 5 rounds.

**Step 4.4: Update discussion.md — Round 1**

Append Round 1 to discussion timeline:
- Sources used
- Key findings with code anchors
- Discussion points
- Open questions

**Step 4.5: Initial Intent Coverage Check**

Re-read original User Intent from discussion.md header. Check each intent item against Round 1 findings:
- ✅ addressed
- 🔄 in-progress
- ❌ not yet touched

Append initial Intent Coverage Check to discussion.md.

**Step 4.6: Baseline Confidence Scoring**

Dimensions = the 6 analysis dimensions. Factors (weights): findings_depth(.30), evidence_strength(.25), coverage_breadth(.20), user_validation(.15), consistency(.10). Score each factor per dimension from Round 1 results. Append baseline confidence table to discussion.md. Thresholds: <60% 继续深入 | 60-80% 需用户确认收敛 | >80% → proceed to synthesis (REQUIRED convergence threshold).

### Step 5: Interactive Discussion Loop

Max 5 rounds. Each round follows this sequence:

**5.1: Current Understanding Summary** (Round >= 2, BEFORE presenting new findings):
Generate 1-2 sentence recap linking previous round conclusions to current starting point.

**5.2: Present Findings** from latest exploration/analysis

**5.3: Gather Feedback**

AskUserQuestion (single-select, header: "分析反馈"):
- **继续深入** (Recommended) — deepen lowest-confidence dimension
- **调整方向** — different focus or specific questions
- **补充信息** — user has additional context, constraints, or corrections
- **分析完成** — sufficient, exit to scoring

Question text: `Round {N} | Confidence: {overall}% | 最弱: {weakest_dim} ({dim_score}%)`

**5.4: Process Response** (always record user choice + impact to discussion.md):

| Choice | Action |
|--------|--------|
| 继续深入 | AskUserQuestion sub-direction (below) → CLI/agent exploration → merge findings |
| 调整方向 | Capture new direction → new CLI exploration → Record Decision (old vs new, reason, impact) |
| 补充信息 | Capture user input → integrate → answer questions via CLI if needed → Record corrections |
| 分析完成 | Exit loop → Record why concluding |

**继续深入 sub-direction**: AskUserQuestion (single-select, header: "深入方向", max 4 options: 3 context-driven from unresolved questions/low-confidence findings/unexplored dimensions + 1 heuristic "换角度审视"). "Other" auto-provided for custom direction.

**5.5: Update discussion.md** after each round:
- **Append** Round N: user input, direction, Q&A, corrections, new insights
- **Append Technical Solutions** — for every solution proposed, validated, or rejected this round, record immediately using Technical Solution Record Format in `#### Technical Solutions`
- **Replace** `## Current Understanding` block with latest consolidated understanding
- **Update** `## Table of Contents` with links to new sections

**5.6: Round Narrative Synthesis** (append after each round):
```markdown
### Round N: Narrative Synthesis
**起点**: 基于上一轮的 [conclusions/questions]，本轮从 [starting point] 切入。
**关键进展**: [New findings] [confirmed/refuted/modified] 了之前关于 [hypothesis] 的理解。
**决策影响**: 用户选择 [feedback type]，导致分析方向 [adjusted/deepened/maintained]。
**当前理解**: 经过本轮，核心认知更新为 [updated understanding]。
**遗留问题**: [remaining questions driving next round]
```

**5.7: Intent Drift Check** (every round >= 2):
Re-read original User Intent. Check each item:
- ✅ addressed (in Round N)
- 🔄 in-progress
- ⚠️ implicitly absorbed (needs confirmation)
- ❌ not yet discussed

If ❌ or ⚠️ items exist → proactively surface to user at start of next round.

**5.8: Re-score Confidence** (every round):
Re-evaluate factors per dimension. Show delta: `Confidence: {prev}% → {current}% ({±N%}), {weakest_dim} 仍需深入`

**5.9: Quality Mechanisms**:
- **Pressure Pass** (mandatory ≥1 before Step 6): highest-confidence finding → pressure ladder (evidence demand → assumption probe → boundary/tradeoff → root cause check). Record under `#### 压力测试`.
- **Devil's Advocate**: dimension > 0.7 → challenge "如果 [finding] 不成立？" (once per dimension)
- **Scope Minimizer**: findings > 5 + scope expanding → "最小可行结论集？"
- **Stall Detection**: delta < 5% for 2 consecutive rounds → "分析可能停滞，建议切换方向或收敛"

**5.10: Pre-Synthesis Readiness Gate** (on "分析完成"):
Block if: ❌ items without deferral | any dimension < 40% | no pressure pass | unresolved contradictions | overall confidence < 80%. If blocked → AskUserQuestion: 补充后继续 or 忽略风险并继续 (record `residual_risks[]`, note accepted confidence level).

**Auto mode (-y)**: auto-deepen ≤3 rounds, readiness gate auto-overrides with residual risk recording.

### Step 6: Six-Dimension Scoring

Using all exploration findings, discussion insights, and user feedback, score across 6 dimensions:

| Dimension | Focus Areas | Score |
|-----------|------------|-------|
| Feasibility | Technical difficulty, team capability, time, tooling | 1-5 |
| Impact | User value, business value, tech debt reduction, DX | 1-5 |
| Risk | Failure modes, security, scalability, regression | 1-5 |
| Complexity | Integration points, dependencies, learning curve, testing | 1-5 |
| Dependencies | External services, internal modules, data, infrastructure | 1-5 |
| Alternatives | 2+ other approaches with tradeoffs | N/A |

Each dimension scored with specific evidence (code refs, data points from exploration).

Each 1-5 score justified by confidence factors from Step 4.6/5.8. Include per-dimension confidence % alongside the score.

Build probability-impact risk matrix from identified risks.

Formulate Go/No-Go/Conditional recommendation with overall confidence %. Write confidence summary (per-dimension scores + overall + pressure pass result + residual risks) to analysis.md.

### Step 7: Synthesis & Conclusion

**7.1: Intent Coverage Verification** (MANDATORY before synthesis):

```markdown
### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | [intent] | ✅ Addressed | Round N, Conclusion #M | |
| 2 | [intent] | 🔀 Transformed | Round N → M | Original: X → Final: Y |
| 3 | [intent] | ❌ Missed | — | Reason |
```

Gate: ❌ Missed items must be either (a) addressed in additional round or (b) confirmed deferred by user.

**7.2: Consolidate Insights**

Compile from all phases:
- Decision Trail from all rounds
- Key conclusions with evidence + confidence (high/medium/low)
- Recommendations with rationale + priority (high/medium/low) + actionable steps — **merge validated `technical_solutions[]` from explorations.json as high-priority recommendations**
- Open questions, follow-up suggestions
- Write to `conclusions.json`

**7.3: Write analysis.md** (legacy compatible — 6-dimension summary):
- Executive summary with overall assessment
- Per-dimension scores with key evidence
- Dimension summary table
- Risk matrix visualization
- Go/No-Go recommendation with confidence

**7.4: Final discussion.md Update**:
- Conclusions section: summary, ranked key conclusions, prioritized recommendations
- Current Understanding (Final): what established, what clarified/corrected, key insights
- Decision Trail: critical decisions, direction changes timeline, trade-offs
- Intent Coverage Matrix
- Session statistics: rounds, duration, sources, artifacts, decision count

**7.5: Interactive Recommendation Review** (skip in auto mode):

Present recommendations, batch-confirm via AskUserQuestion (max 4 per call, ordered by priority):
- **确认**: Accept as-is → review_status = "accepted"
- **修改**: Adjust scope/steps → review_status = "modified"
- **删除**: Not needed → review_status = "rejected"

Update conclusions.json with review_status for each recommendation.

### Step 8: Decision Extraction

**This step runs ALWAYS** — in full mode after synthesis, in quick mode (`-q`) as the main step.

**8.1: Identify Gray Areas**

Analyze phase goal + loaded context (project.md, roadmap, brainstorm, prior context.md files, exploration findings if available) to find undecided implementation areas.

**Domain-aware gray area generation:**
- Something users SEE: layout, density, interactions, states
- Something users CALL: responses, errors, auth, versioning
- Something users RUN: output format, flags, modes, error handling
- Something users READ: structure, tone, depth, flow
- Something being ORGANIZED: criteria, grouping, naming, exceptions

Generate 3-5 **phase-specific** gray areas.
Skip areas already decided in prior context.md files.
If `guidance-specification.md` loaded: skip MUST/MUST NOT areas (already locked), focus on SHOULD/MAY areas and gaps.
If full mode completed: use exploration findings + scoring to inform gray area quality.

**8.2: Area Selection** (skip if `-y`)

```
AskUserQuestion({
  question: "Which areas need discussion for this phase?",
  options: [
    { label: "Area 1: {title}", description: "{brief description}" },
    { label: "Area 2: {title}", description: "{brief description}" },
    { label: "Area 3: {title}", description: "{brief description}" },
    { label: "All areas", description: "Discuss everything" },
    { label: "Skip", description: "Context is clear enough — no decisions needed" }
  ]
})
```

If "Skip": write minimal context.md (empty Locked/Free/Deferred sections), proceed to Step 9.

**8.3: Deep-Dive Discussion**

For each selected area, conduct multi-round interactive dialog (3-4 questions per area):

```
AskUserQuestion({
  question: "[{area}] {specific question about implementation choice}",
  options: [
    { label: "Option A", description: "{description with tradeoffs}" },
    { label: "Option B", description: "{description with tradeoffs}" },
    { label: "Option C", description: "{description with tradeoffs}" }
  ]
})
```

Record each decision using Decision Recording Protocol.

After questions per area: "More questions about {area}, or move to next?"

**Scope guardrail**: Phase boundary from roadmap.md is FIXED. Discussion clarifies HOW to implement, not WHETHER to add more. If user suggests new capabilities → "That belongs in its own phase. I will note it for later." → capture in Deferred.

**8.4: Classify Decisions**

- **Locked**: firm decisions that cannot be changed during implementation
- **Free**: open for implementation discretion (implementer can choose)
- **Deferred**: postponed to a later phase (captured but not acted on)

**If `researchContext` is set**: for each Free decision area, append a research-backed recommendation:

```
### Free — {area}
Implementer's choice. Research suggests: {relevant finding from researchContext}.
(e.g., "Standard Stack recommends React Query for server state. Common pitfall: avoid mixing with Redux for async.")
```

**8.5: Write context.md**

Write to `OUTPUT_DIR/context.md`:

```markdown
# Context: Phase {NN} -- {PHASE_TITLE}

**Date**: {date}
**Areas discussed**: {list of areas}

## Decisions

### Decision 1: {TITLE}
- **Context**: {what and why}
- **Options**:
  1. {opt1}
  2. {opt2}
- **Chosen**: {selected}
- **Reason**: {rationale}

## Constraints

### Locked
{decisions that are final and must be followed}

### Free
{decisions left to implementer discretion}

### Deferred
{ideas captured but postponed to later phases}

## Code Context
{relevant code references from exploration or discussion}
```

**8.6: Write context-package.json**

Write to `OUTPUT_DIR/context-package.json`:

```jsonc
{
  "$schema": "context-package/1.0",
  "source": {
    "type": "analyze",
    "artifact_id": "{artifact_id}",
    "session_path": "{OUTPUT_DIR relative to .workflow/}",
    "generated_at": "{ISO-8601}"
  },
  "requirements": [],      // From conclusions.json implementation_scope items (if any)
  "constraints": [],        // Locked → { status: "locked" }, Free → { status: "open" }, Deferred → { status: "deferred" }
  "domain": {},             // Inherit from upstream context-package if loaded via --from
  "non_goals": [],          // Deferred items → { title, rationale, ref: "context.md#Deferred" }
  "insights": [],           // From conclusions.json recommendations → { role: "analyzer", area, summary }
  "open_questions": [],     // Free decisions without strong recommendation → { area, question, options[] }
  "references": [
    { "type": "analysis", "path": "context.md" },
    { "type": "conclusions", "path": "conclusions.json" }
  ]
}
```

Extraction mapping from context.md sections:
- Each "Locked" decision → `constraints[]` with `status: "locked"`, `ref: "context.md#Locked"`
- Each "Free" decision → `constraints[]` with `status: "open"`, `ref: "context.md#Free"`
- Each "Deferred" item → `non_goals[]` with `ref: "context.md#Deferred"`
- From `conclusions.json.implementation_scope[]` (if exists) → `requirements[]` with `{ id, title: scope.objective, acceptance: scope.acceptance_criteria, ref: "conclusions.json" }`
- From `conclusions.json.recommendations[]` → `insights[]`

**8.7: Update project.md Key Decisions** (phase mode only)

```
Phase mode only: Append each new Locked decision to .workflow/project.md "## Key Decisions" table.
Row format: | {decision title} | {rationale summary} | Phase {NN} — {date} |
Skip duplicates (match by title).
```

**8.8: Auto-create Issues from Deferred Items**

```
For each Deferred decision, create an issue in .workflow/issues/issues.jsonl:
  id: "ISS-{YYYYMMDD}-{NNN}"
  title: "Deferred: {item.title}"
  status: "deferred", priority: 5, severity: "low"
  source: "analyze", milestone_ref: target_milestone
  description: "{item.context} -- Chosen to defer: {item.reason}"
  tags: ["deferred", "analyze"]
```

### Step 8.9: Register Artifact

```
Register artifact in .workflow/state.json:
  id: "ANL-{next sequential 3-digit id}"
  type: "analyze", scope: scope, status: "completed"
  milestone: target_milestone (null if standalone/adhoc)
  phase: null (analyze operates at milestone level)
  path: OUTPUT_DIR relative to .workflow/
  context_package: "{OUTPUT_DIR}/context-package.json"   // relative to .workflow/
  harvested: false, created_at: session_start_time, completed_at: now()
Atomic write (tmp + rename).
```

### Step 9: Report & Next Step

Display summary:
- Overall assessment score and recommendation (full mode) or "Quick decision extraction" (quick mode)
- Decisions captured (Locked/Free/Deferred counts)
- Key conclusions (if full mode)
- Session stats

AskUserQuestion (single-select, header: "Next Step"):
- **快速执行** — build context from conclusions, invoke maestro-quick
- **进入规划** — phase planning (maestro-plan)
- **产出Issue** — convert recommendations to tracked issues
- **完成** — no further action

Handle selection:

| Choice | Action |
|--------|--------|
| 快速执行 | Build `taskDescription` from high/medium priority accepted recommendations. Assemble context from exploration. Invoke Skill immediately. |
| 进入规划 | **Implementation Scoping** (below), then invoke Skill. |
| 产出Issue | For each accepted/modified recommendation: create issue. |
| 完成 | No further action. |

**Implementation Scoping** (for "进入规划" only):

Before invoking maestro-plan, build and persist `implementation_scope` so the planner has concrete "what + done-when" specs:

```
// Step A: Build implementation_scope from accepted/modified recommendations (sorted by priority)
Each scope item:
  objective: rec.action          // WHAT
  rationale: rec.rationale       // WHY
  priority: rec.priority
  target_files: from rec.steps targets + matching code_anchors  // WHERE
  acceptance_criteria: from rec.steps verification/description  // DONE WHEN
  change_summary: "{target}: {description}" per step            // HOW

// Step B: User scope confirmation (skip in auto/quick mode)
AskUserQuestion (single-select, header: "Scope确认"):
  - "确认执行": Proceed to planning
  - "调整范围": Narrow or expand scope
  - "补充标准": Add/refine acceptance criteria

// Step C: Persist implementation_scope to conclusions.json

// Step D: Invoke plan
Phase mode: Skill({ skill: "maestro-plan", args: "{phase}" })
Scratch mode: Skill({ skill: "maestro-plan", args: "--dir {output_dir}" })
```

The planner reads `conclusions.json.implementation_scope` and maps:
- `scope.objective` → task title/description
- `scope.acceptance_criteria` → `convergence.criteria` (seed, planner makes grep-verifiable)
- `scope.target_files` → `files[]` + `read_first[]`
- `scope.priority` → task/wave ordering

Update index.json timestamps.

```
== maestro-analyze complete ==
Session:  {session_id}
Output:   {output_dir}/
Mode:     {full|quick}
Rounds:   {round_count} (full mode only)
Score:    {recommendation} ({confidence}) (full mode only)
Decisions: {decision_count} (Locked: {n}, Free: {n}, Deferred: {n})

Files:
  context.md           — Locked/Free/Deferred decisions for plan
  context-package.json — Standardized context package for cross-command consumption
  discussion.md        — Full discussion timeline (full mode)
  analysis.md          — 6-dimension scoring summary (full mode)
  conclusions.json     — Structured conclusions (full mode)

Next:
  Skill({ skill: "maestro-quick", args: "{task}" })          — Quick execute
  Skill({ skill: "maestro-plan", args: "{phase}" })          — Full phase planning (phase mode)
  Skill({ skill: "maestro-plan", args: "--dir {output_dir}" }) — Plan in scratch dir (scratch mode)
```

---

## Decision Recording Protocol

Record immediately when any occur:

| Trigger | What to Record |
|---------|---------------|
| Direction choice | What chosen, why, alternatives discarded |
| Key finding | Content, impact scope, confidence, hypothesis impact |
| Assumption change | Old → new understanding, reason, impact |
| User feedback | Input, rationale for adoption/adjustment |
| Disagreement/trade-off | Conflicting views, trade-off basis, final choice |
| Scope adjustment | Before/after scope, trigger reason |
| **Technical solution proposed/validated/rejected** | Solution description, rationale, alternatives considered, status |

**Decision Record Format**:
```
> **Decision**: [Description]
> - **Context**: [Trigger]
> - **Options considered**: [Alternatives]
> - **Chosen**: [Approach] — **Reason**: [Rationale]
> - **Rejected**: [Why other options were discarded]
> - **Evidence Source**: [cli-explore-agent | maestro delegate | user input | exploration-codebase.json anchor] — REQUIRED, manual Read/Grep alone is INVALID
> - **Impact**: [Effect on analysis]
```

**Technical Solution Record Format**:
```
> **Solution**: [Description — what approach, pattern, or implementation]
> - **Status**: [Proposed / Validated / Rejected]
> - **Problem**: [What problem this solves]
> - **Rationale**: [Why this approach]
> - **Alternatives**: [Other options considered and why not chosen]
> - **Evidence**: [file:line or code anchor references]
> - **Next Action**: [Follow-up required or none]
```

## Discussion Timeline (discussion.md)

Each round appends:
- User feedback and direction choice
- New findings with code anchors
- Narrative Synthesis (起点 → 关键进展 → 决策影响 → 当前理解 → 遗留问题)
- Intent Coverage Check (Round >= 2)

Replaceable blocks (overwritten each round):
- `## Current Understanding` — latest consolidated understanding
- `## Table of Contents` — updated with new section links

## Error Handling

| Error | Resolution |
|-------|------------|
| cli-explore-agent fails | Retry once. If still fails: log W001 warning in discussion.md, flag all subsequent decisions as LOW CONFIDENCE (evidence gap), continue with available context |
| CLI timeout | Retry with shorter prompt; if still fails, mark perspective [LOW CONFIDENCE] (evidence gap) in discussion.md and continue |
| Max rounds reached | Force synthesis, offer continuation |
| No relevant findings | Broaden search, ask user for clarification |
| Session folder conflict | Append timestamp suffix |
