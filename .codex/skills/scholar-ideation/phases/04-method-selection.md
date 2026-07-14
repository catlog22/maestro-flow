# Phase 4: Method Selection

> **COMPACT SENTINEL [Phase 4: Method Selection]**
> This phase contains 5 execution steps (Step 4.1 -- 4.5).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/04-method-selection.md")`

Select and justify appropriate research methods based on the formulated research questions and identified gaps.

## Objective

- Analyze existing methods and their applicability to the research questions
- Select the most suitable research approach (theoretical, empirical, system-building, data analysis)
- Justify method choice with evidence from literature
- Assess required resources and technical feasibility
- Identify potential technical risks and mitigation strategies

## Input

- **researchQuestions**: Primary question, sub-questions, hypotheses, objectives from Phase 3
- **gapAnalysis**: Gaps, opportunities from Phase 2
- **literatureResults**: Papers and methods from Phase 1
- **workflowPreferences.timeline**: Target timeline

## Execution

### Step 4.1: Existing Method Analysis

Review methods used in the literature (from Phase 1 comparison matrix) and classify them.

**Method classification**:

| Category | Description | When to Use |
|----------|-------------|-------------|
| Theoretical analysis | Mathematical proofs, complexity analysis, convergence guarantees | Questions requiring formal guarantees |
| Empirical research | Experiment design, benchmarking, ablation studies | Performance evaluation, hypothesis testing |
| System building | End-to-end systems, tool development, integration | Practical applications, deployment |
| Data analysis | Visualization, pattern discovery, error analysis | Exploratory studies, model understanding |

**For each relevant method from literature**:

| Method | Used By | Strengths | Weaknesses | Applicable to Our RQ? |
|--------|---------|-----------|------------|----------------------|
| Method A | Paper X, Y | Strength 1, 2 | Weakness 1, 2 | Yes/No — reason |
| Method B | Paper Z | Strength 1 | Weakness 1, 2 | Yes/No — reason |

### Step 4.2: Method-Question Alignment

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 4.1 -- 4.5) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/04-method-selection.md")` now.

Map each research question/hypothesis to suitable methods.

**Question type to method mapping**:

| Question Type | Primary Method | Supporting Methods |
|--------------|----------------|-------------------|
| Exploratory | Data analysis | Empirical research |
| Confirmatory | Empirical research | Theoretical analysis |
| Applied | System building | Empirical research |

**For the primary research question**:
- Which methods from the literature can be adapted?
- What modifications are needed?
- What new methods must be developed?
- What combination of approaches works best?

### Step 4.3: Resource and Feasibility Assessment

For each candidate method, assess required resources.

**Computational resources**:

| Method | GPU Requirement | Training Time | Storage | Memory |
|--------|----------------|---------------|---------|--------|
| Method A | X GPUs | Y hours/days | Z GB | W GB |
| Method B | ... | ... | ... | ... |

**Data resources**:
- Required datasets and their availability (public vs. private)
- Data preprocessing requirements
- Annotation needs
- Data volume requirements

**Human resources**:
- Required expertise and skills
- Team size considerations
- Single-person vs. team project suitability

**Time assessment** (aligned with workflowPreferences.timeline):

| Timeline | Suitable Methods | Scope |
|----------|-----------------|-------|
| Short (3-6 months) | Small-scale experiments, data analysis, simple theoretical proofs | Proof of concept |
| Medium (6-12 months) | Full experiments, system prototypes, moderate theory | Complete study |
| Long (1-2 years) | Large-scale experiments, full systems, deep theory | Comprehensive research |

### Step 4.4: Method Selection and Justification

Based on the analysis, select the primary research method and supporting methods.

**Selection criteria**:
1. **Alignment**: Does the method directly address the research question?
2. **Feasibility**: Can it be executed with available resources?
3. **Innovation potential**: Does it enable novel contributions?
4. **Risk level**: What is the probability of failure?
5. **Literature precedent**: Have similar approaches succeeded in related work?

**Method justification template**:

```markdown
### Selected Method: {Method Name}

**Type**: Theoretical / Empirical / System-building / Data Analysis

**Description**: {What the method involves}

**Justification**:
- Addresses RQ because: {reason linked to research question}
- Builds on prior work: {specific papers and their methods}
- Feasible because: {resource and capability assessment}
- Novel because: {what is different from existing approaches}

**Technical approach**:
1. {Step 1 of the method}
2. {Step 2 of the method}
3. {Step 3 of the method}

**Datasets**:
| Dataset | Purpose | Size | Availability |
|---------|---------|------|--------------|
| Dataset A | Training | X samples | Public |
| Dataset B | Evaluation | Y samples | Public |

**Baselines for comparison**:
- Baseline 1: {method} from {paper} — represents {approach}
- Baseline 2: {method} from {paper} — represents {approach}

**Evaluation metrics**:
- Primary: {metric 1, metric 2}
- Secondary: {metric 3, metric 4}
- Efficiency: {training time, inference speed, memory}

**Risk assessment**:
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Method doesn't improve over baselines | Medium | High | Prepare alternative approach B |
| Insufficient data | Low | High | Data augmentation, synthetic data |
| Computational budget exceeded | Medium | Medium | Start with smaller experiments |
```

### Step 4.5: Alternative Methods (Backup Plan)

Identify 1-2 backup methods in case the primary approach fails.

**Backup method criteria**:
- Addresses the same or similar research question
- Uses different technical approach (de-risks single point of failure)
- Feasible within remaining timeline if pivot is needed
- Simpler or more conservative than primary method

Present method selection to user for confirmation (unless autoYes):
```
request_user_input:
  question: "Here is the proposed method selection with justification. Do you agree with this approach, or would you like to adjust?"
  → Incorporate user feedback
```

## Output

- **Variable**: `selectedMethods` containing:
  - `primaryMethod` — Selected method with full justification
  - `backupMethods[]` — Alternative approaches
  - `datasets[]` — Required datasets with availability
  - `baselines[]` — Comparison baselines
  - `evaluationMetrics` — Primary and secondary metrics
  - `resourceRequirements` — Compute, data, time, personnel needs
  - `risks[]` — Identified risks with mitigation strategies
- **update_plan**: Mark Phase 4 completed, Phase 5 in_progress

## Next Phase

Return to orchestrator, then proceed to [Phase 5: Research Planning](05-research-planning.md).
