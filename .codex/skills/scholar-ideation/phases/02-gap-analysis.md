# Phase 2: Gap Analysis

Systematically identify and evaluate research gaps from the literature review to find valuable research opportunities.

## Objective

- Analyze literature across 5 gap types (literature, methodological, application, interdisciplinary, temporal)
- Evaluate gaps along 5 analysis dimensions
- Prioritize gaps by importance, novelty, and feasibility
- Produce a structured gap analysis with actionable research opportunities

## Input

- **literatureResults**: Papers, trends, and key findings from Phase 1
- **workflowPreferences.topic**: Research topic
- **workflowPreferences.scope**: Research scope

## Execution

### Step 2.1: Systematic Literature Analysis

Build a comparison matrix from the papers discovered in Phase 1.

**Comparison matrix**:

| Paper | Method | Dataset | Performance | Key Innovation | Limitations |
|-------|--------|---------|-------------|----------------|-------------|
| Paper A | Method X | Dataset 1 | Metric: value | Innovation A | Limitation A |
| Paper B | Method Y | Dataset 2 | Metric: value | Innovation B | Limitation B |
| ... | ... | ... | ... | ... | ... |

Focus on:
- What methods are used and how they compare
- What datasets and benchmarks are standard
- What performance levels are achieved
- What each paper identifies as limitations or future work

### Step 2.2: Five-Type Gap Identification

Analyze the literature systematically across five gap types.

**Type 1: Literature Gaps**

Topics or questions not yet sufficiently studied.

Identification methods:
- Find sub-areas with few papers (< 20 relevant publications)
- Analyze "Future Work" sections of survey/review papers
- Identify low-citation but potentially important research directions
- Discover emerging topics with limited coverage

Questions to answer:
- Which sub-topics within the field have received minimal attention?
- Are there important questions that no paper directly addresses?
- What have review papers flagged as under-explored?

**Type 2: Methodological Gaps**

Limitations and improvement opportunities in existing methods.

Identification methods:
- Analyze common weaknesses across papers (from comparison matrix Limitations column)
- Identify scenarios where methods fail or degrade
- Find computational efficiency or scalability problems
- Spot gaps between theoretical guarantees and practical performance

Questions to answer:
- What limitations do ALL current methods share?
- In what specific scenarios do existing approaches fail?
- Are there well-known theoretical results with no practical implementation?

**Type 3: Application Gaps**

Theory-to-practice transfer opportunities and new application domains.

Identification methods:
- Identify theoretical work lacking real-world validation
- Find successful methods that haven't been applied to relevant new domains
- Spot disconnects between industry needs and academic research
- Discover technology transfer possibilities

Questions to answer:
- Which promising methods have not been tested in practical settings?
- What industry problems could benefit from existing academic methods?
- Are there successful cross-domain transfers that haven't been attempted?

**Type 4: Interdisciplinary Gaps**

Research opportunities at the intersection of different fields.

Identification methods:
- Identify similar problems solved differently across fields
- Find methods that could transfer across disciplines
- Discover complex problems requiring multi-disciplinary collaboration
- Spot emerging cross-disciplinary areas

Questions to answer:
- Are there related fields with transferable methods?
- Do similar problems appear in different domains with different solutions?
- What new fields are emerging at discipline boundaries?

**Type 5: Temporal Gaps**

New research needs arising from changes over time.

Identification methods:
- Identify new problems created by recent technology advances
- Find data distribution shifts that affect existing methods
- Discover new challenges from changing social/regulatory requirements
- Spot opportunities from recent technological breakthroughs

Questions to answer:
- What new technologies have created previously impossible research directions?
- Have recent developments invalidated assumptions in older work?
- What regulatory or societal changes demand new research?

### Step 2.3: Five-Dimension Analysis

For each identified gap, evaluate along five dimensions.

**Dimension 1: Research Topic Coverage**
- How many high-quality papers exist on this topic?
- Thresholds: Sufficient (>100), Moderate (20-100), Under-researched (<20), Unexplored (~0)
- How many active research groups are working on it?

**Dimension 2: Method Strengths/Weaknesses Comparison**
- What are the theoretical foundations of existing methods?
- How do they perform experimentally?
- What is the computational complexity?
- How well do they generalize and scale?

**Dimension 3: Experimental Setup Completeness**
- Are experimental scenarios diverse enough?
- Do benchmarks cover the full problem space?
- Are evaluation metrics comprehensive?
- Are ablation studies thorough?

**Dimension 4: Dataset and Benchmark Availability**
- Are there public datasets of sufficient quality?
- Are there standardized benchmarks?
- Are datasets diverse and representative?
- Is data annotation quality adequate?

**Dimension 5: Theory-Practice Gap**
- Do theoretical assumptions match real conditions?
- Are methods practically deployable?
- Do theoretical guarantees hold in experiments?
- Is there industry adoption?

### Step 2.4: Gap Prioritization

Score each identified gap on three criteria (1-5 scale):

**Importance**: Academic and practical value of filling this gap
- 5: Breakthrough potential, affects the entire field
- 4: Important, multiple groups would benefit
- 3: Valuable, relevant to a significant subset
- 2: Marginal, limited audience
- 1: Trivial, minimal impact

**Novelty**: Whether others are already addressing this gap
- 5: Completely unexplored
- 4: Very few attempts, mostly unsuccessful
- 3: Some work exists but significant room remains
- 2: Active area, incremental contribution possible
- 1: Well-covered, minimal novelty

**Feasibility**: Whether the gap can be addressed with available resources
- 5: Fully feasible with current resources
- 4: Feasible with some effort
- 3: Challenging but possible
- 2: Difficult, requires significant resources
- 1: Nearly infeasible with available resources

**Priority decision matrix**:

| Importance | Novelty | Feasibility | Recommendation |
|-----------|---------|-------------|----------------|
| High | High | High | Top priority — pursue |
| High | High | Medium | Worth attempting |
| High | Medium | High | Safe choice |
| Medium | High | High | Consider |
| Low | * | * | Reconsider |

### Step 2.5: Gap Validation

Before finalizing, validate top gaps:
- Search for very recent work (last 3 months) that might address the gap
- Check arXiv preprints for ongoing related work
- Verify no technical or data blockers exist
- Consider whether the gap is a genuine research opportunity or a dead end

```
WebSearch: "{gap description keywords} {current year} arxiv"
```

If validation reveals the gap is being actively closed, downgrade priority or refine the gap definition.

### Step 2.6: Gap Analysis Document

Compile results into a structured analysis:

```markdown
## Gap Analysis: {Topic}

### Identified Gaps

#### Gap 1: {Title}
- **Type**: Literature / Methodological / Application / Interdisciplinary / Temporal
- **Description**: {Detailed description}
- **Evidence**: {Papers/trends that reveal this gap}
- **Importance**: {score}/5 — {justification}
- **Novelty**: {score}/5 — {justification}
- **Feasibility**: {score}/5 — {justification}
- **Priority**: {Top / High / Medium / Low}

#### Gap 2: {Title}
...

### Prioritized Opportunities
1. {Top priority gap} — {one-line rationale}
2. {Second priority} — {one-line rationale}
3. {Third priority} — {one-line rationale}

### Research Direction Recommendations
- **Recommended focus**: {primary gap to pursue}
- **Alternative directions**: {backup options}
- **Combination opportunities**: {gaps that could be addressed together}
```

Present gap analysis to user for feedback (unless autoYes):
```
request_user_input:
  question: "Here is the gap analysis. Which gaps interest you most? Would you like to adjust priorities?"
  → Incorporate user feedback into final priorities
```

## Output

- **Variable**: `gapAnalysis` containing:
  - `gaps[]` — List of identified gaps with type, description, evidence, and scores
  - `opportunities[]` — Ranked research opportunities
  - `prioritizedGaps[]` — Top 3-5 gaps sorted by priority
  - `recommendedFocus` — Primary recommended research direction
- **update_plan**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then proceed to [Phase 3: Research Question Formulation](03-research-question.md).
