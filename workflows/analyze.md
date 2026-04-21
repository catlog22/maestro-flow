# Workflow: Analyze

Multi-dimensional iterative analysis with CLI exploration, multi-perspective synthesis, discussion timeline, intent tracking, and decision extraction.

## Pipeline Position

```
maestro-brainstorm (optional upstream)
        ↓ ideas, scored options
maestro-analyze ← THIS
        ↓ analysis.md, discussion.md, conclusions.json, context.md
maestro-plan → maestro-execute → maestro-verify
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
$ARGUMENTS: "[phase|topic] [-y] [-c] [-q]"

(no args)   -- Milestone-wide analysis (requires init + roadmap)
<phase>     -- Phase number (phase-scoped, requires init + roadmap)
<topic>     -- Topic text (adhoc if milestone exists, standalone if not)
-y / --yes  -- Auto mode, skip interactive scoping, auto-deepen
-c / --continue -- Resume from existing session
-q / --quick -- Quick mode, skip exploration + scoring, go straight to decision extraction
```

## Scope Routing

```
// Worktree scope check
IF file_exists(".workflow/worktree-scope.json"):
  scope = read(".workflow/worktree-scope.json")
  IF $ARGUMENTS matches /^\d+$/ AND parseInt($ARGUMENTS) NOT IN scope.owned_phases:
    ERROR "Phase {$ARGUMENTS} not owned by this worktree. Owned: {scope.owned_phases}"
    EXIT

// Auto-bootstrap state.json if missing
IF NOT file_exists(".workflow/state.json"):
  mkdir -p .workflow/scratch/
  Write minimal state.json: { project: null, status: "active", current_milestone: null,
    current_task_id: null, milestones: [], artifacts: [], last_updated: now() }

// Scope determination
IF $ARGUMENTS is empty:
  IF state.json.current_milestone is non-null AND roadmap.md exists:
    → scope = "milestone"
    → milestone_slug = slugify(current_milestone name)
    → Set OUTPUT_DIR = .workflow/scratch/analyze-{milestone_slug}-{date}/
  ELSE:
    → ERROR E001 "No args and no roadmap — provide topic text or create roadmap first"

ELSE IF $ARGUMENTS matches /^\d+$/:
  IF state.json.current_milestone is non-null AND roadmap.md exists:
    → scope = "phase"
    → phase_num = parsed number
    → phase_slug = resolve from roadmap.md
    → Set OUTPUT_DIR = .workflow/scratch/analyze-{phase_slug}-{date}/
  ELSE:
    → ERROR "Phase number requires init + roadmap"

ELSE (text argument):
  → topic_slug = slugify(text, max 40 chars)
  IF state.json.current_milestone is non-null:
    → scope = "adhoc"
  ELSE:
    → scope = "standalone"
  → Set OUTPUT_DIR = .workflow/scratch/analyze-{topic_slug}-{date}/

// Create output directory
mkdir -p {OUTPUT_DIR}
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
└── context.md                 # Decision extraction: Locked/Free/Deferred decisions for plan
```

---

## Process

### Step 1: Parse Input & Initialize Session

Parse $ARGUMENTS to determine mode and flags:
- `-c` present: locate existing session folder (discussion.md exists), resume from last round
- `-y` present: set AUTO_MODE=true
- `-q` present: set QUICK_MODE=true (skip Steps 2-7, jump to Step 8: Decision Extraction)
- Number (e.g., "3") = phase scope: resolve phase slug from roadmap, output to scratch/analyze-{phase-slug}-{date}/
- Text (e.g., "microservices vs monolith") = adhoc/standalone scope: output to scratch/analyze-{slug}-{date}/
- Missing/empty = milestone scope (if roadmap exists) or error E001

**Session initialization:**
- Session ID: `ANL-{slug}-{YYYY-MM-DD}`
- Output: `OUTPUT_DIR` (always under `.workflow/scratch/`)

**Load prior context** (milestone/phase scope):
1. Read `.workflow/project.md` — project vision, constraints, Validated requirements (already shipped), Active requirements (current scope)
2. Read `.workflow/roadmap.md` — phase structure and dependencies
3. Read `.workflow/state.json` → `current_milestone`, `artifacts[]`, `accumulated_context` (key_decisions, deferred items, blockers)
4. Find prior analyze artifacts from `state.json.artifacts[]` where type=analyze and same milestone → load their `context.md` to skip already-decided areas
5. Find brainstorm artifacts from `state.json.artifacts[]` where type=brainstorm and same milestone → load `guidance-specification.md` if exists
6. Load project specs: `specs_content = maestro spec load --category arch`

**Load prior context** (adhoc/standalone scope):
1. Read `.workflow/project.md` (if exists) — project vision, Validated requirements, Active requirements, Key Decisions
2. Read `.workflow/state.json` (if exists) → `accumulated_context` (key_decisions, deferred, blockers)
3. Load project specs: `specs_content = maestro spec load --category arch`

**Quick mode routing**: If QUICK_MODE, skip to Step 8 (Decision Extraction) after loading context.

### Step 1.5: Archive Previous Artifacts

Skip if `-c` (resuming — working on existing session).

Before writing any new artifacts, archive existing ones to preserve history:

```
ARCHIVE_TARGETS = ["discussion.md", "analysis.md", "explorations.json", "perspectives.json", "conclusions.json", "exploration-codebase.json"]

has_existing = false
FOR artifact IN ARCHIVE_TARGETS:
  IF file exists "$OUTPUT_DIR/${artifact}":
    has_existing = true
    break

IF has_existing:
  mkdir -p "$OUTPUT_DIR/.history"
  TIMESTAMP = current timestamp formatted as "YYYY-MM-DDTHH-mm-ss"
  FOR artifact IN ARCHIVE_TARGETS:
    IF file exists "$OUTPUT_DIR/${artifact}":
      // Extract name and extension: "analysis.md" → "analysis" + "md"
      mv "$OUTPUT_DIR/${artifact}" "$OUTPUT_DIR/.history/${name}-${TIMESTAMP}.${ext}"
  display "Archived previous analysis artifacts to .history/"
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
// Step 4.0.1: Orchestrator web searches (2-3 focused queries)
queries = [
  "{phase_goal} standard library stack {current_year}",
  "{phase_goal} architecture patterns best practices",
  "{phase_goal} common pitfalls mistakes"
]

For each query:
  results = WebSearch(query)
  // For top 1-2 results: WebFetch(url) to get official docs / README

// Step 4.0.2: Hand raw search output to researcher agent
Agent(
  subagent_type="workflow-phase-researcher",
  prompt="""
<objective>
Synthesize the following web search results for Phase {PHASE_NUM}: {phase_name}.
Goal: {phase_goal}
</objective>

<search_results>
{raw_search_output}
</search_results>

<task>
From the search results above, extract and structure:
- ## Standard Stack: concrete library recommendations with versions
- ## Architecture Patterns: recommended patterns for this type of work
- ## Don't Hand-Roll: problems with existing solutions (don't build custom)
- ## Common Pitfalls: mistakes to avoid

Be prescriptive ("use X") not exploratory ("consider X or Y").
Cite sources. Assign confidence levels (HIGH/MEDIUM/LOW).
Do NOT write any files — return structured markdown only.
</task>
  """,
  run_in_background=false
)

// Step 4.0.3: Store as researchContext (in-memory, no file written)
researchContext = agent_output
```

`researchContext` is passed into Step 4.2 CLI Analysis and Step 8 Decision Extraction.
If `external_research` not selected: `researchContext = null`.

**Step 4.1: Codebase Exploration** (cli-explore-agent)

Spawn cli-explore-agent with 3-layer exploration:

| Layer | Focus | Output |
|-------|-------|--------|
| Layer 1: Module Discovery (Breadth) | Search by topic keywords, identify ALL relevant files, map module boundaries | `relevant_files[]` |
| Layer 2: Structure Tracing (Depth) | Top 3-5 key files: trace call chains 2-3 levels deep, identify data flow | `call_chains[]`, `data_flows[]` |
| Layer 3: Code Anchor Extraction (Detail) | Each key finding: extract code snippet (20-50 lines) with file:line | `code_anchors[]` |

Output: `exploration-codebase.json` (single) or `explorations/{perspective}.json` (multi-perspective, parallel up to 4)

**Step 4.2: CLI Analysis** (AFTER exploration)

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

### Step 5: Interactive Discussion Loop

Max 5 rounds. Each round follows this sequence:

**5.1: Current Understanding Summary** (Round >= 2, BEFORE presenting new findings):
Generate 1-2 sentence recap linking previous round conclusions to current starting point.

**5.2: Present Findings** from latest exploration/analysis

**5.3: Gather Feedback** (AskUserQuestion, single-select, header: "分析反馈"):
- **继续深入**: Deepen analysis — auto or user-specified direction
- **调整方向**: Different focus or specific questions
- **补充信息**: User has additional context, constraints, or corrections
- **分析完成**: Sufficient — exit to Phase 4

**5.4: Process Response** (always record user choice + impact to discussion.md):

| Choice | Action |
|--------|--------|
| 继续深入 | Sub-question (max 4 options: 3 context-driven + 1 heuristic frame-breaker) → CLI/agent exploration → merge findings |
| 调整方向 | Capture new direction → new CLI exploration → Record Decision (old vs new, reason, impact) |
| 补充信息 | Capture user input → integrate → answer questions via CLI if needed → Record corrections |
| 分析完成 | Exit loop → Record why concluding |

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

**Auto mode (-y)**: auto-deepen for up to 3 rounds, then synthesize.

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

Build probability-impact risk matrix from identified risks.

Formulate Go/No-Go/Conditional recommendation with confidence level.

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

This makes research findings visible to the planner through context.md without imposing hard constraints.

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

**8.6: Update project.md Key Decisions** (phase mode only)

```
IF phase mode AND Locked decisions exist:
  Read .workflow/project.md
  Find "## Key Decisions" table

  For each Locked decision from Step 8.4:
    Check if decision already exists in Key Decisions table (by title match)
    If not duplicate:
      Append row to Key Decisions table:
        | {decision title} | {rationale summary} | Phase {NN} — {date} |

  Write updated project.md
  Display: "project.md: {count} key decisions recorded"
```

**8.7: Auto-create Issues from Deferred Items**

```
deferred_items = decisions.filter(d => d.classification == "Deferred")

IF deferred_items.length > 0:
  mkdir -p ".workflow/issues"
  today = format(now(), "YYYYMMDD")
  counter = next sequence number for today

  FOR each item IN deferred_items:
    issue_id = "ISS-{today}-{counter padded to 3 digits}"
    issue = {
      id: issue_id,
      title: "Deferred: " + item.title,
      status: "deferred",
      priority: 5,
      severity: "low",
      source: "analyze",
      phase_ref: PHASE_NUM,
      description: item.context + " -- Chosen to defer: " + item.reason,
      tags: ["deferred", "analyze"],
      created_at: now()
    }
    Append JSON line to .workflow/issues/issues.jsonl
    counter++

  Print: "Created {deferred_items.length} deferred issues for tracking"
```

### Step 8.8: Register Artifact

```
// Register in state.json artifact registry
Read .workflow/state.json
next_id = max(artifacts.filter(a => a.type == "analyze").map(a => parseInt(a.id.replace("ANL-","")))) + 1
  // If no analyze artifacts exist: next_id = 1

artifact = {
  id: "ANL-{next_id padded to 3}",
  type: "analyze",
  milestone: state.json.current_milestone,  // null if standalone
  phase: phase_num,                          // null if milestone/adhoc/standalone
  scope: scope,                              // "milestone"|"phase"|"adhoc"|"standalone"
  path: OUTPUT_DIR relative to .workflow/,   // e.g. "scratch/analyze-auth-2026-04-20"
  status: "completed",
  depends_on: null,
  harvested: false,
  created_at: session_start_time,
  completed_at: now()
}

state.json.artifacts.push(artifact)
state.json.last_updated = now()
Write state.json (atomic: write tmp + rename)
```

### Step 9: Report & Next Step

Display summary:
- Overall assessment score and recommendation (full mode) or "Quick decision extraction" (quick mode)
- Decisions captured (Locked/Free/Deferred counts)
- Key conclusions (if full mode)
- Session stats

**Next Step Selection** (AskUserQuestion, single-select, header: "Next Step"):
- **快速执行**: Skill({ skill: "maestro-quick", args: "{task_description} --full" }) — build context from conclusions
- **进入规划**: Phase mode → Skill({ skill: "maestro-plan", args: "{phase}" }); Scratch mode → Skill({ skill: "maestro-plan", args: "--dir {output_dir}" }) — plan directly against scratch directory
- **产出Issue**: Convert recommendations to tracked issues
- **完成**: No further action

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
// Step A: Build implementation scope from accepted/modified recommendations
actionableRecs = conclusions.recommendations
  .filter(r => r.review_status in ["accepted", "modified"])
  .sort by priority (high first)

implementation_scope = actionableRecs.map(rec => ({
  objective: rec.action,                         // WHAT to do
  rationale: rec.rationale,                       // WHY
  priority: rec.priority,
  target_files: rec.steps.flatMap(s => s.target)  // WHERE (from steps + code_anchors)
    .concat(code_anchors matching rec),
  acceptance_criteria: rec.steps.map(s =>         // DONE WHEN
    s.verification || s.description),
  change_summary: rec.steps.map(s =>              // HOW (brief)
    "${s.target}: ${s.description}").join('; ')
}))

// Step B: User scope confirmation (skip in auto mode / quick mode)
IF NOT AUTO_MODE:
  Display implementation scope summary:
    For each item: objective [priority], target files, "Done when: ..."
  AskUserQuestion (single-select, header: "Scope确认"):
    - "确认执行": Scope is clear, proceed to planning
    - "调整范围": Narrow or expand scope
    - "补充标准": Add/refine acceptance criteria
  Handle adjustments, re-confirm if needed

// Step C: Persist to conclusions.json
conclusions.implementation_scope = implementation_scope
Write updated conclusions.json to OUTPUT_DIR

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

## Six Dimensions

| Dimension | Focus Areas |
|-----------|------------|
| Feasibility | Technical difficulty, team capability, time, tooling |
| Impact | User value, business value, tech debt reduction, DX |
| Risk | Failure modes, security, scalability, regression |
| Complexity | Integration points, dependencies, learning curve, testing |
| Dependencies | External services, internal modules, data, infrastructure |
| Alternatives | 2+ other approaches with tradeoffs |

## Key Design Principles

1. **Iterative Deepening**: Multi-round discussion (max 5) with user feedback steering direction
2. **CLI-Assisted Exploration**: cli-explore-agent for codebase + multi-CLI parallel analysis
3. **Discussion Timeline**: discussion.md as living document — rounds appended, Current Understanding replaced
4. **Decision Recording Protocol**: Immediate capture of decisions, findings, assumption changes
5. **Intent Coverage Tracking**: Original user intent checked every round (✅🔄⚠️❌)
6. **Six-Dimension Scoring**: Feasibility, Impact, Risk, Complexity, Dependencies, Alternatives
7. **Multi-Perspective Synthesis**: Up to 4 perspectives with convergent/conflicting/unique extraction
8. **Decision Extraction**: Gray area identification → interactive discussion → Locked/Free/Deferred classification → context.md
9. **Dual Depth**: Full mode (explore→score→decide) or Quick mode (-q, decide only)

## Quality Criteria

**Full mode:**
- All 6 dimensions analyzed with evidence-backed scores
- Discussion timeline has narrative synthesis per round
- Decision Recording Protocol applied consistently
- Intent Coverage verified with no unresolved ❌ items
- Risk matrix populated with identified risks
- At least 2 alternatives compared with tradeoffs
- Go/No-Go/Conditional recommendation with confidence level
- Code references included where relevant (file paths, line numbers)

**Both modes (full + quick):**
- context.md written with all decisions classified as Locked/Free/Deferred
- Gray areas identified through phase-specific analysis
- Scope creep redirected to Deferred section
- Every decision follows Context/Options/Chosen/Reason protocol
- Prior context loaded and applied (no re-asking decided questions)

## Error Handling

| Error | Resolution |
|-------|------------|
| cli-explore-agent fails | Continue with available context, note limitation |
| CLI timeout | Retry with shorter prompt, or skip perspective |
| Max rounds reached | Force synthesis, offer continuation |
| No relevant findings | Broaden search, ask user for clarification |
| Session folder conflict | Append timestamp suffix |
