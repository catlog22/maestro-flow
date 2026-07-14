# Phase 3: Research Question Formulation

Formulate specific, actionable research questions based on the identified gaps and literature analysis.

## Objective

- Transform prioritized gaps into concrete research questions using the SMART framework
- Generate testable hypotheses for each research question
- Define research objectives and expected contributions
- Evaluate questions on importance, novelty, and feasibility

## Input

- **gapAnalysis**: Gaps, opportunities, and priorities from Phase 2
- **literatureResults**: Papers, trends, and findings from Phase 1
- **workflowPreferences.scope**: Research scope
- **workflowPreferences.timeline**: Target timeline

## Execution

### Step 3.1: 5W1H Brainstorming

For the top prioritized gap(s), apply the 5W1H framework to brainstorm research directions.

**What** — What problem or phenomenon to study?
- Identify the specific research object
- Define the core problem to solve
- Set the research scope and boundaries
- Clarify expected outcomes

**Why** — Why is this problem important?
- Academic value: Does it advance the field?
- Practical value: Does it solve real problems?
- Timeliness: Why research this now?
- Current limitations: What is missing?

**Who** — Target audience and stakeholders?
- Academic community: Which researchers care?
- Industry: Which teams/companies benefit?
- Users: Who uses the results?
- Collaborators: Who should be involved?

**When** — Time scope and context?
- Research duration aligned with `workflowPreferences.timeline`
- Is the timing right given current technology maturity?
- When should results be available for maximum impact?

**Where** — Application scenarios and domains?
- What specific application contexts?
- Which domains or industries?
- What experimental settings?

**How** — Preliminary methodology ideas?
- What research methods fit?
- What data and resources are needed?
- How to validate hypotheses?
- What are the technical challenges?

Document the 5W1H analysis for the top 1-3 gaps.

### Step 3.2: SMART Research Question Formulation

Transform 5W1H insights into formal research questions using SMART criteria.

**Specific**: The question must clearly define:
- Research object (what exactly is being studied)
- Improvement direction (what aspect is being improved)
- Task/scenario (where this applies)
- Goal (what outcome is expected)

Bad: "How to improve model performance?"
Good: "How can attention mechanism modifications improve Transformer performance on long-document understanding tasks?"

**Measurable**: Define concrete evaluation criteria:
- Quantitative metrics: accuracy, F1, BLEU, perplexity, latency
- Qualitative metrics: human evaluation, case studies
- Efficiency metrics: training time, inference speed, memory usage

**Achievable**: Verify against available resources:
- Computational resources (GPU count and type)
- Data availability (public datasets)
- Time constraints (aligned with timeline preference)
- Team capabilities and expertise
- Is there foundational work to build upon?

**Relevant**: Confirm value alignment:
- Addresses an identified gap (link back to gap analysis)
- Has academic impact (advances methodology or understanding)
- Has practical value (solves real problems)
- Aligns with research interests and capabilities

**Time-bound**: Set realistic timeline:
- Short-term (3-6 months): Literature review, problem definition, proof of concept
- Medium-term (6-12 months): Full experiments, analysis, paper writing
- Long-term (1-2 years): Systematic research, multiple publications

### Step 3.3: Research Question Types

Classify each formulated question:

**Exploratory questions**: Investigate unknown phenomena
- Pattern: "What patterns/behaviors does X exhibit in context Y?"
- Best for: New research areas, complex systems requiring understanding
- Example: "What attention patterns does a Transformer exhibit when processing documents longer than 10K tokens?"

**Confirmatory questions**: Test hypotheses or theories
- Pattern: "Does X lead to Y in context Z?"
- Best for: Verifying assumptions, challenging existing claims
- Example: "Does increasing model depth improve long-document comprehension performance?"

**Applied questions**: Solve practical problems
- Pattern: "How can X be used/modified to achieve Y while satisfying constraint Z?"
- Best for: Practical applications, optimization under constraints
- Example: "How can sparse attention reduce Transformer memory usage by 50% while maintaining performance on NarrativeQA?"

### Step 3.4: Hypothesis Generation

For each research question, formulate testable hypotheses.

**Hypothesis structure**:
```
IF [proposed intervention/method]
THEN [expected outcome]
BECAUSE [theoretical reasoning/evidence from literature]
```

**Example**:
- **RQ**: How can adaptive sparse attention improve long-text Transformer efficiency?
- **H1**: IF we use learned sparsity patterns based on content relevance, THEN computational cost decreases by >50% with <2% performance loss, BECAUSE most attention weights are near-zero in practice (evidence: [Paper X, Paper Y])
- **H2**: IF we combine local and global attention with adaptive selection, THEN the model captures both local syntax and global semantics, BECAUSE existing fixed-pattern approaches (Longformer, BigBird) show this decomposition is effective

### Step 3.5: Research Objectives and Contributions

Define clear objectives and expected contributions for the top research question.

**Primary objective**: One sentence describing the main goal
**Sub-objectives**: 2-4 specific, measurable sub-goals

**Expected contributions**:
- **Academic**: New method, theoretical insight, comprehensive analysis
- **Practical**: Improved efficiency, new tool, better performance
- **Community**: Open-source code, new benchmark, reproducible experiments

### Step 3.6: Research Question Evaluation

Score each candidate question using the evaluation matrix.

**Importance** (1-5):
- 5: Breakthrough, affects the entire field
- 4: Important, multiple groups interested
- 3: Valuable, significant subset cares
- 2: Marginal, limited audience
- 1: Trivial, minimal impact

**Novelty** (1-5):
- 5: Entirely new question or breakthrough method
- 4: New question or significantly improved method
- 3: New perspective or method combination
- 2: Incremental improvement
- 1: Duplicates existing work

**Feasibility** (1-5):
- 5: Fully feasible, resources abundant
- 4: Mostly feasible, resources adequate
- 3: Challenging but achievable
- 2: Difficult, requires breakthroughs
- 1: Nearly infeasible

**Decision matrix**:

| Importance | Novelty | Feasibility | Recommendation |
|-----------|---------|-------------|----------------|
| High | High | High | Prioritize |
| High | High | Medium | Worth pursuing |
| High | Medium | High | Safe choice |
| Medium | High | High | Consider |
| Low | * | * | Reconsider |

Present candidate research questions to user for selection (unless autoYes):
```
request_user_input:
  question: "Here are the candidate research questions with evaluations. Which would you like to pursue? You may also refine them."
  → Store user selection/refinement
```

## Output

- **Variable**: `researchQuestions` containing:
  - `primaryQuestion` — The selected main research question
  - `subQuestions[]` — Supporting sub-questions
  - `hypotheses[]` — Testable hypotheses for each question
  - `objectives` — Primary and sub-objectives
  - `contributions` — Expected academic, practical, community contributions
  - `questionType` — Exploratory / Confirmatory / Applied
  - `evaluation` — Importance, novelty, feasibility scores
- **update_plan**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then proceed to [Phase 4: Method Selection](04-method-selection.md).
