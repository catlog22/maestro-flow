# Workflow: Analyze

Multi-dimensional iterative analysis: CLI exploration → multi-perspective synthesis → discussion timeline → intent tracking → six-dimension scoring → decision extraction. Preserves macro/micro, quick, gaps, and up-to-5-round convergence semantics.

## Pipeline / FSM

```
Full mode (-q absent):
  Step 1: Setup & Scoping        → session init, dimension selection, report discussion area init
     │
  Step 2: CLI Exploration        → outputs/exploration-codebase.json, outputs/perspectives.json
     │                              (cli-explore-agent three layers + multi-CLI parallel)
     │
  Step 3: Interactive Discussion → report.md discussion section (up to 5 rounds)
     │                              (Decision Recording, Intent Coverage)
     │
  Step 4: Six-Dimension Scoring  → 6 dims × 1-5 points + risk matrix
     │
  Step 5: Synthesis & Conclusion → outputs/findings.json, report.md conclusion area
     │
  Step 6: Decision Extraction    → findings.json#decisions (Locked/Free/Deferred)

Quick mode (-q):
  Step 1: Setup (minimal)        → load upstream, skip scoping
     │
  Step 6: Decision Extraction    → findings.json#decisions
```

## Mode Determination

```
First positional arg is pure digits (^\d+$)   → micro, milestone-level deep-dive
First positional arg is non-numeric text      → macro, topic impact scope
No positional arg + has roadmap               → current milestone micro
No positional arg + no roadmap                → macro fallback
Mixed input (e.g. "1 milestone")              → handled as text, goes macro
--gaps [ISS-ID]                               → gaps, goes issue root-cause analysis (ref/issue-gaps-analyze.md)
-q                                            → quick, skip Step 2-5, jump directly to Step 6
```

macro mode additionally evaluates `scope_verdict` during Step 5 synthesis:
- `large`: 3+ independent subsystems, or a hard serial dependency barrier exists → downstream goes roadmap
- `medium`: 1-2 subsystems, parallelizable → downstream goes plan
- `small`: single file or few-file change → downstream goes plan

## Step Gates (Full mode, active when both `-q` and `--gaps` are absent)

Mandatory and blocking. Cannot advance if any gate is unmet.

**GATE exploration-done (Step 2 → 3)**
- cli-explore-agent complete, `outputs/exploration-codebase.json` written and contains ≥1 code anchor
- ≥1 CLI delegate complete, output landed in `outputs/perspectives.json`
- discussion area records baseline confidence score

**GATE discussion-round (Step 3 → 4)**
- discussion area contains ≥1 round of interaction with user feedback
- confidence re-scored ≥1 time and delta shown
- pressure pass completed ≥1 time

**GATE scoring-complete (Step 4 → 5)**
- all six dimensions scored
- each dimension's score cites exploration/perspectives evidence, **not manual Read**

**GATE intent-covered (Step 5 → 6)**
- findings.json decisions and recommendations written
- Intent Coverage Matrix has no unhandled ❌ (or user confirms defer)

---

## Process

### Step 1: Setup & Scoping

Parse mode/flags (see above). Load upstream and project context:

1. Upstream typed artifacts: read only from injected alias→path (`current-guidance`/`current-blueprint`/`latest-debug`), do not guess latest by mtime.
   - locked constraints → skip (already decided)
   - open constraints → analyze first
   - open questions → discussion seeds
2. Project specs: `maestro spec load --category arch`
3. domain glossary: read `.workflow/domain/glossary.yaml` (if it exists), use canonical terms throughout the analysis; record new term candidates in the report.
4. Existing same-milestone analyze artifacts: read their decisions, skip already-decided areas.

**quick routing**: after loading context, jump directly to Step 6.

**Scoping & dimension selection** (skipped when `-c`/`-y`, interactive AskUserQuestion, up to 3 questions):

1. **Analysis direction** (multiSelect), take 3-4 items from the dimension-direction mapping:

   | Dimension | Direction |
   |------|------|
   | architecture | System Design, Component Interactions, Technology Choices, Design Patterns |
   | implementation | Code Structure, Patterns, Error Handling, Algorithm Analysis |
   | performance | Bottlenecks, Optimization, Resource Utilization, Concurrency |
   | security | Vulnerabilities, Auth, Data Protection, Input Validation |
   | concept | Foundation, Core Mechanisms, Patterns, Trade-offs |
   | comparison | Solution Comparison, Pros/Cons, Technology Evaluation |
   | decision | Criteria, Trade-off Analysis, Risk Assessment, Impact |
   | external_research | Standard Stack, Architecture Patterns, Don't Hand-Roll, Common Pitfalls (external web search) |

   When the goal contains unfamiliar technology keywords, or the codebase has no pattern for that domain (Step 2 exploration relevant_files is empty), automatically suggest `external_research`.

2. **Analysis perspective** (multiSelect, up to 4):

   | Perspective | CLI | Focus |
   |------|-----|------|
   | Technical | gemini | implementation, code patterns, feasibility |
   | Architectural | claude | system design, scalability, interactions |
   | Business | codex | value, ROI, stakeholder impact |
   | Domain Expert | gemini | domain patterns, best practices, standards |

3. **Analysis depth** (single): Quick Overview / Standard / Deep Dive

**Auto (-y) defaults**: all relevant dimensions, single synthesis perspective, Standard depth.

Initialize report.md discussion area: dynamic TOC, session metadata, User Intent (original question, for intent tracking), Current Understanding replaceable block (overwritten each round, not appended), empty discussion timeline, dimension selection rationale.

### Step 2: CLI Exploration

Codebase exploration first, then (optional) external research, then CLI analysis.

**Step 2.0 External research** (only when `external_research` selected):
1. WebSearch 2-3 queries: `"{goal} standard library stack"`, `"architecture patterns best practices"`, `"common pitfalls mistakes"`; take top 1-2 per query and fetch official docs.
2. Hand to workflow-phase-researcher agent to synthesize into: `## Standard Stack` (with versions), `## Architecture Patterns`, `## Don't Hand-Roll`, `## Common Pitfalls`. Style: prescriptive ("use X"), cite sources, mark HIGH/MEDIUM/LOW. Agent returns markdown only, writes no files.
3. Store result as `researchContext` (in-memory). If not selected, `researchContext = null`.

**Step 2.1 Codebase exploration** (cli-explore-agent, mandatory, not substitutable):

MUST spawn cli-explore-agent; manual Read/Grep is not a substitute. Three layers:

| Layer | Focus | Output |
|----|------|------|
| L1 Module discovery (breadth) | search by keywords, identify all relevant files, draw module boundaries | `relevant_files[]` |
| L2 Structure tracing (depth) | top 3-5 key files: trace call chains 2-3 layers, identify data flows | `call_chains[]`, `data_flows[]` |
| L3 Code anchors (detail) | extract 20-50 line snippet + file:line for each key finding | `code_anchors[]` |

Output `outputs/exploration-codebase.json` (single perspective) or `outputs/explorations/{perspective}.json` (multi-perspective, up to 4 parallel).

**Step 2.2 CLI analysis** (after exploration, mandatory, not substitutable):

MUST have at least one CLI delegate. The orchestrator's own analysis does not count as independent verification — the CLI provides cross-validation from another model/perspective.

Construct exploration context from Step 2.1 findings then spawn. When `researchContext` exists, append:
```
"External research findings (treat as strong recommendations, not laws):
{researchContext}"
```
- Single perspective: one synthesis CLI call
- Multi-perspective (up to 4): parallel call per perspective, each with its perspective focus

CLI calls use `run_in_background: true`, wait for results before continuing.

**Step 2.3 Aggregation**: merge explorations + CLI results; for multi-perspective, extract synthesis (converging themes, conflicting views, unique contributions); write `outputs/perspectives.json`. It contains `technical_solutions[]`: `{round, solution, problem, rationale, alternatives, status: proposed|validated|rejected, evidence_refs[], next_action}`, filled across the Step 3 rounds.

**Step 2.4 Round 1**: append to discussion timeline — sources, key findings with code anchors, discussion points, open questions.

**Step 2.5 Initial Intent check**: re-read User Intent, cross-check each item against Round 1: ✅ addressed / 🔄 in-progress / ❌ not touched.

**Step 2.6 baseline confidence**: 6 dims × factors (weights): findings_depth(.30), evidence_strength(.25), coverage_breadth(.20), user_validation(.15), consistency(.10). Score each dimension. Thresholds: <60% keep going deeper | 60-80% needs user confirmation to converge | >80% proceed to synthesis (necessary convergence threshold).

### Step 3: Interactive Discussion Loop

Up to 5 rounds, each round:

**3.1 Current Understanding** (Round ≥ 2, before new findings): 1-2 sentences bridging the previous round's conclusions to this round's starting point.

**3.2 Present findings** from the latest exploration/analysis.

**3.3 Collect feedback** AskUserQuestion (single, header "Analysis Feedback"):
- **Go deeper** (recommended) — deep-dive the lowest-confidence dimension
- **Adjust direction** — change focus or raise a specific question
- **Supplement information** — user has additional context/constraints/corrections
- **Analysis complete** — sufficient, exit to scoring

Question text: `Round {N} | Confidence: {overall}% | Weakest: {weakest_dim} ({dim_score}%)`

**3.4 Handle response** (always record choice + impact to the report discussion area):

| Choice | Action |
|------|------|
| Go deeper | AskUserQuestion sub-direction → CLI/agent exploration → merge findings |
| Adjust direction | capture new direction → new exploration → record Decision (old vs new, reason, impact) |
| Supplement information | capture input → integrate → CLI-verify when needed → record correction |
| Analysis complete | exit → record convergence reason |

Go-deeper sub-direction: AskUserQuestion (single, "Deep-dive direction", up to 4: 3 from unresolved questions/low-confidence findings/unexplored dimensions + 1 heuristic "examine from a different angle").

**3.5 Update discussion area**: append Round N (input, direction, Q&A, corrections, new insights); append Technical Solutions (this round's proposed/validated/rejected); replace Current Understanding block; update TOC.

**3.6 Round Narrative Synthesis** (appended each round):
```markdown
### Round N: Narrative Synthesis
**Starting point**: Building on the previous round's [conclusions/questions], this round enters from [starting point].
**Key progress**: [New findings] [confirmed/refuted/modified] the prior understanding about [hypothesis].
**Decision impact**: User chose [feedback type], causing the analysis direction to be [adjusted/deepened/maintained].
**Current understanding**: After this round, the core understanding updates to [updated understanding].
**Remaining questions**: [remaining questions driving next round]
```

**3.7 Intent Drift** (Round ≥ 2): per item ✅/🔄/⚠️ implicitly absorbed pending confirmation/❌ not discussed. ❌ or ⚠️ → proactively raise with the user at the start of the next round.

**3.8 Re-score confidence** (each round): show delta `Confidence: {prev}% → {current}% ({±N%}), {weakest_dim} still needs deepening`.

**3.9 Quality mechanisms**:
- **Pressure Pass** (mandatory ≥1 before Step 4): highest-confidence finding → pressure gradient (evidence demand → assumption probe → boundary/tradeoff → root cause check). Record under `#### Pressure Test`.
- **Devil's Advocate**: a dimension > 0.7 → challenge "what if [finding] doesn't hold?" (once per dimension)
- **Scope Minimizer**: findings > 5 and scope expanding → "minimal viable conclusion set?"
- **Stall Detection**: 2 consecutive rounds delta < 5% → "analysis may be stalling, suggest switching direction or converging"

**3.10 Pre-convergence Readiness Gate** (on "Analysis complete"): blocking conditions — an ❌ with no deferral exists | any dimension < 40% | no pressure pass | unresolved contradiction | overall < 80%. If blocked, AskUserQuestion: supplement then continue / ignore risk and continue (record `residual_risks[]` and the accepted confidence).

**Auto (-y)**: auto deep-dive ≤3 rounds, readiness gate auto-overridden and residual risk recorded.

### Step 4: Six-Dimension Scoring

Synthesizing all exploration, discussion, and feedback, score six dimensions:

| Dimension | Focus | Score |
|------|------|----|
| Feasibility | technical difficulty, team capability, time, tooling | 1-5 |
| Impact | user value, business value, tech-debt reduction, DX | 1-5 |
| Risk | failure modes, security, scalability, regression | 1-5 |
| Complexity | integration points, dependencies, learning curve, testing | 1-5 |
| Dependencies | external services, internal modules, data, infrastructure | 1-5 |
| Alternatives | 2+ other approaches and their trade-offs | N/A |

Each dimension cites specific evidence (code ref, exploration data point) and marks a per-dimension confidence %. Construct a probability-impact risk matrix. Form a Go/No-Go/Conditional recommendation and overall confidence %. Write the confidence summary (each dimension's score + overall + pressure pass result + residual risks) into the report conclusion area.

### Step 5: Synthesis & Conclusion

**5.1 Intent Coverage check** (mandatory before synthesis):
```markdown
### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | [intent] | ✅ Addressed | Round N, Conclusion #M | |
| 2 | [intent] | 🔀 Transformed | Round N → M | Original: X → Final: Y |
| 3 | [intent] | ❌ Missed | — | Reason |
```
Gate: each ❌ Missed item must either (a) get an added round or (b) be user-confirmed defer.

**5.2 Synthesize insights**: compile the Decision Trail, key conclusions with evidence + confidence, recommendations with rationale + priority + actionable steps (**merge validated `technical_solutions[]` into high-priority recommendations**), open questions and follow-up suggestions → write into `outputs/findings.json`.

**5.3 Write findings.json** (artifact paths and metadata are declared in `prepare/analyze.md` contract):
```json
{
  "mode": "macro|micro|quick|gaps",
  "topic": "",
  "dimensions": [],
  "findings": [],
  "decisions": [],
  "scope_verdict": "small|medium|large",
  "recommendation": "go|go_with_conditions|no_go"
}
```

**5.4 Write risk-matrix.json**:
```json
{ "risks": [], "assumptions": [], "open_questions": [] }
```

**5.5 report conclusion area**: conclusion summary, ranked conclusions, prioritized recommendations; Current Understanding (Final); Decision Trail (key decisions, direction-change timeline, trade-offs); Intent Coverage Matrix; session stats.

**5.6 Interactive recommendation review** (auto skips): AskUserQuestion (up to 4 at a time, by priority): confirm → accepted / modify → modified / delete → rejected. Write back each recommendation's `review_status` to findings.json.

### Step 6: Decision Extraction

**Always executed** — in full mode after synthesis, in quick mode as the main step.

**6.1 Identify gray areas**: analyze goal + loaded context, find undecided implementation areas. Domain-aware generation:
- what the user will SEE: layout, density, interaction, states
- what the user will CALL: responses, errors, auth, versioning
- what the user will RUN: output format, flags, modes, error handling
- what the user will READ: structure, tone, depth, flow
- how it is ORGANIZED: standards, grouping, naming, exceptions

Generate 3-5 **phase-specific** gray areas. Skip upstream already-decided areas; if upstream is locked: focus on SHOULD/MAY and gaps.

**6.2 Gray area selection** (`-y` skips): AskUserQuestion to let the user pick which areas to discuss (including "All areas"/"Skip"). Choosing Skip → write empty Locked/Free/Deferred, proceed to 6.5.

**6.3 Deep-dive discussion**: multiple rounds of dialogue per selected area (3-4 questions/area), give Option A/B/C with trade-offs, record each decision per the Decision Recording Protocol. **Scope guardrail**: roadmap phase boundaries are fixed, discuss HOW not WHETHER; user raises a new capability → "assign it to its own phase, record first" → into Deferred.

**6.4 Classify decisions**:
- **Locked**: hard decisions unchangeable during implementation
- **Free**: implementer's discretion
- **Deferred**: pushed to a later phase

If `researchContext` exists: append a research-backed suggestion for each Free area.

Write the classification into `findings.json#decisions[]`, each item marked `{title, class: locked|free|deferred, context, options[], chosen, reason}`.

**6.5 Deferred → issue**: for each Deferred decision, create an issue in `.workflow/issues/issues.jsonl`: `status: deferred, priority: 5, severity: low, source: analyze, tags: [deferred, analyze]`. Require user confirmation (or `-y` flag) before writing to external stores.

### Wrap-up

Write the single `report.md`, with the following frontmatter and fixed sections:

```md
---
verdict: ready
summary: one-line summary of the analysis conclusion
constraints: []
decisions: []
concerns: []
next:
  - { command: maestro-plan, reason: analysis ready, needs: [current-analysis] }
---
## Summary
## Conclusion/Verdict
## Discussion/Retrospective
## Artifacts
## Handoff/Next
```

In macro mode, if `scope_verdict == large`, next points to maestro-roadmap instead of maestro-plan. In the report, reference domain values with `{{aref:current-analysis#/...}}` or an aref block, **never copy the JSON source of truth**.

→ Wrap-up (archiving, spec/knowhow extraction) follows ref/finish-work.md.

---

## Decision Recording Protocol

Record as it occurs:

| Trigger | Record |
|------|------|
| Direction choice | what was chosen, why, what was discarded |
| Key finding | content, impact scope, confidence, effect on assumptions |
| Assumption change | old → new understanding, reason, impact |
| User feedback | input, rationale for adopting/adjusting |
| Disagreement/trade-off | conflicting views, trade-off basis, final choice |
| Scope adjustment | before/after scope, triggering reason |
| Technical solution proposed/validated/rejected | solution, rationale, alternatives, status |

**Decision Record format**:
```
> **Decision**: [Description]
> - **Context**: [Trigger]
> - **Options considered**: [Alternatives]
> - **Chosen**: [Approach] — **Reason**: [Rationale]
> - **Rejected**: [Why discarded]
> - **Evidence Source**: [cli-explore-agent | CLI delegate | user input | code anchor] — REQUIRED, manual Read/Grep alone is INVALID
> - **Impact**: [effect on the analysis]
```

**Technical Solution format**:
```
> **Solution**: [approach/pattern/implementation]
> - **Status**: [Proposed / Validated / Rejected]
> - **Problem**: [what it solves]
> - **Rationale**: [why this path]
> - **Alternatives**: [other options and why discarded]
> - **Evidence**: [file:line or code anchor]
> - **Next Action**: [follow-up or none]
```

## Domain Invariants

- Every one of the six dimension scores must cite exploration/CLI evidence; manual Read/Grep is invalid.
- Pressure pass is mandatory ≥1 time before synthesis.
- Intent Coverage must have no unhandled ❌ before wrap-up.
- `-q` only skips exploration and scoring; decision extraction cannot be omitted.
- `--gaps` goes issue root-cause analysis; a root cause cannot be confirmed without evidence.

## Error Handling

| Error | Handling |
|------|------|
| cli-explore-agent failed | retry once; if still failing record W001, mark subsequent decisions LOW CONFIDENCE, continue with existing context |
| CLI timeout | shorten prompt and retry; if still failing mark that perspective [LOW CONFIDENCE] and continue |
| Max rounds reached (5) | force synthesis, offer a continue option |
| No relevant findings | broaden the search or ask the user to clarify |
