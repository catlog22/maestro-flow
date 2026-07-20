
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 5: Research Planning

> **COMPACT SENTINEL [Phase 5: Research Planning]**
> This phase contains 5 execution steps (Step 5.1 -- 5.5).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/05-research-planning.md")`

Create a comprehensive research plan combining all previous phase outputs into a structured, actionable research proposal.

## Objective

- Design a research timeline with milestones and deliverables
- Define checkpoints and review cadence
- Identify risks and mitigation strategies
- Allocate resources across research phases
- Produce the final `research-plan.md` document

## Input

- **literatureResults**: Papers, trends, findings from Phase 1
- **gapAnalysis**: Gaps, opportunities, priorities from Phase 2
- **researchQuestions**: Questions, hypotheses, objectives from Phase 3
- **selectedMethods**: Methods, resources, risks from Phase 4
- **workflowPreferences**: Topic, scope, timeline, useZotero

## Execution

### Step 5.1: Timeline Design

Design a phased timeline based on `workflowPreferences.timeline`.

**Short-term template (3-6 months)**:

| Phase | Duration | Tasks | Deliverables |
|-------|----------|-------|-------------|
| Preparation | Month 1 | Literature review, problem definition, environment setup | Research proposal, code scaffold |
| Exploration | Month 2-3 | Initial experiments, proof of concept | Preliminary results, feasibility validation |
| Development | Month 3-4 | Full experiments, optimization | Complete experimental results |
| Completion | Month 5-6 | Analysis, paper writing, code cleanup | Paper draft, open-source code |

**Medium-term template (6-12 months)**:

| Phase | Duration | Tasks | Deliverables |
|-------|----------|-------|-------------|
| Preparation | Month 1-2 | Deep literature review, problem formalization | Comprehensive literature review, refined proposal |
| Exploration | Month 3-4 | Method prototyping, concept validation | Proof of concept, initial results |
| Development | Month 5-8 | Full implementation, extensive experiments | Complete results, ablation studies |
| Completion | Month 9-12 | Deep analysis, paper writing, revision | Submitted paper, open-source release |

**Long-term template (1-2 years)**:

| Phase | Duration | Tasks | Deliverables |
|-------|----------|-------|-------------|
| Preparation | Month 1-3 | Comprehensive survey, problem formulation | Survey paper or literature review |
| Exploration | Month 4-7 | Multiple approaches, broad experimentation | Validated approach selection |
| Development | Month 8-14 | Systematic experiments, theoretical analysis | Multiple result sets |
| Completion | Month 15-24 | Multiple papers, system building, open-source | Publication portfolio |

**Time allocation principle (80/20)**:
- 80% on core work: experiments, analysis, writing
- 20% on supporting work: literature, tools, communication

**Buffer**: Reserve 20% buffer time per phase for unexpected delays.

**Parallel tasks**:
- Literature review continues throughout (not just Phase 1)
- Paper writing can start early (Introduction, Related Work sections)
- Code cleanup runs alongside experiments

### Step 5.2: Milestone Definition

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 5.1 -- 5.5) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/05-research-planning.md")` now.

Define key milestones with clear completion criteria.

**Milestone 1: Research Proposal Complete**
- Timing: End of Preparation phase
- Criteria:
  - Literature review done (20-30 core papers analyzed)
  - Research question clearly defined
  - Method approach selected and justified
  - Experimental plan drafted
- Deliverables: Research proposal document

**Milestone 2: Proof of Concept**
- Timing: End of Exploration phase
- Criteria:
  - Initial implementation working
  - Method feasibility validated
  - At least one positive result achieved
  - Major challenges identified and assessed
- Deliverables: PoC code, preliminary results

**Milestone 3: Complete Experiments**
- Timing: End of Development phase
- Criteria:
  - All planned experiments completed
  - Results meet or approach targets
  - Ablation studies done
  - Visualizations and analysis complete
- Deliverables: Full experimental results, analysis

**Milestone 4: Paper Submission**
- Timing: End of Completion phase
- Criteria:
  - Paper draft complete and internally reviewed
  - Code cleaned and documented
  - Reproducibility verified
  - Target venue selected
- Deliverables: Submitted paper, open-source code

**Review cadence**:
- Weekly: Progress review, problem identification, plan adjustment
- Monthly: Milestone assessment, risk evaluation, resource adjustment

### Step 5.3: Risk Management Plan

Consolidate risks from Phase 4 and add project-level risks.

**Technical risks**:

| Risk | Probability | Impact | Mitigation | Trigger for Action |
|------|------------|--------|------------|-------------------|
| Primary method fails | Medium | High | Pivot to backup method (from Phase 4) | PoC milestone missed |
| Results below expectations | Medium | Medium | Adjust scope, try variations | Development phase mid-check |
| Compute budget exceeded | Medium | Medium | Start small, scale up gradually | Budget at 50% before Development |
| Key dataset unavailable | Low | High | Identify alternative datasets now | Preparation phase |

**Timeline risks**:

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Schedule delay | High | Medium | Buffer time, parallel tasks, scope reduction |
| Dependency delay | Medium | Medium | Identify dependencies early, plan alternatives |
| Scope creep | Medium | High | Strict scope definition, regular review |

**Resource risks**:

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| GPU unavailability | Medium | High | Multiple compute sources, cloud backup |
| Team member changes | Low | High | Documentation, knowledge sharing |

**Risk monitoring protocol**:
- **Red alert** (act immediately): Core method failure, critical resource loss, severe delay
- **Yellow warning** (watch closely): Partial experiment issues, resource tension, minor delay
- **Green status** (proceed normally): On schedule, resources sufficient, results as expected

### Step 5.4: Resource Allocation Plan

Detail resource allocation across research phases.

**Compute resources** (aligned with selectedMethods.resourceRequirements):

| Phase | GPU Allocation | Expected Usage | Storage |
|-------|---------------|----------------|---------|
| Preparation | Minimal | Environment setup, small tests | 50 GB |
| Exploration | 1-2 GPUs | PoC training, prototyping | 100 GB |
| Development | 2-8 GPUs | Full training, benchmarking | 200-500 GB |
| Completion | Variable | Final runs, verification | Same |

**Time allocation** (weekly):

| Activity | Hours/Week | Phase Emphasis |
|----------|-----------|----------------|
| Core research (experiments, implementation) | 25-30 | Development |
| Literature reading | 5-8 | Preparation |
| Writing | 5-10 | Completion |
| Meetings and communication | 3-5 | Throughout |
| Other (tools, admin) | 2-5 | Throughout |

**Personnel allocation** (if team project):
- Research lead: Planning, guidance, writing (50% time)
- Research assistant(s): Implementation, experiments, analysis (100% time)
- Collaborators: Specific modules, review (as needed)

### Step 5.5: Final Research Plan Document

Compile everything into `research-plan.md`.

**Document structure**:

```markdown
# Research Plan: {Title}

## 1. Research Topic and Background
- Topic: {from workflowPreferences.topic}
- Background: {key context from literature review}
- Motivation: {why this research matters}

## 2. Literature Summary
- Key findings: {from literatureResults.keyFindings}
- Major trends: {from literatureResults.trends}
- Papers analyzed: {count}
- Full review: See literature-review.md

## 3. Research Gaps
- Primary gap: {from gapAnalysis.recommendedFocus}
- Supporting gaps: {from gapAnalysis.prioritizedGaps}
- Gap type: {literature/methodological/application/interdisciplinary/temporal}

## 4. Research Questions
### 4.1 Primary Question
{researchQuestions.primaryQuestion}

### 4.2 Sub-Questions
{researchQuestions.subQuestions}

### 4.3 Hypotheses
{researchQuestions.hypotheses}

### 4.4 Expected Contributions
- Academic: {researchQuestions.contributions.academic}
- Practical: {researchQuestions.contributions.practical}
- Community: {researchQuestions.contributions.community}

## 5. Methodology
### 5.1 Primary Method
{selectedMethods.primaryMethod — description, justification}

### 5.2 Technical Approach
{Step-by-step technical plan}

### 5.3 Datasets
{selectedMethods.datasets — table}

### 5.4 Baselines
{selectedMethods.baselines — list}

### 5.5 Evaluation Metrics
{selectedMethods.evaluationMetrics}

### 5.6 Backup Methods
{selectedMethods.backupMethods}

## 6. Timeline
{Phase timeline table from Step 5.1}

## 7. Milestones
{Milestone definitions from Step 5.2}

## 8. Risk Management
{Risk tables from Step 5.3}

## 9. Resource Requirements
### 9.1 Compute
{From Step 5.4}

### 9.2 Data
{Dataset requirements and availability}

### 9.3 Personnel
{Team allocation}

### 9.4 Tools and Software
{Required tools, frameworks, services}

## 10. Summary
{One-paragraph executive summary: what, why, how, expected outcome}
```

**Generate the research plan document**:
```javascript
Write("research-plan.md", content: `
# Research Plan: ${researchQuestions.primaryQuestion}

## 1. Research Topic and Background
- **Topic**: ${workflowPreferences.topic}
- **Background**: ${literatureResults.keyFindings.slice(0, 3).join('; ')}
- **Motivation**: ${gapAnalysis.recommendedFocus.motivation}

## 2. Literature Summary
- **Key findings**: ${literatureResults.keyFindings.join('\n  - ')}
- **Major trends**: ${literatureResults.trends.join('\n  - ')}
- **Papers analyzed**: ${literatureResults.papers.length}
- **Full review**: See literature-review.md

## 3. Research Gaps
- **Primary gap**: ${gapAnalysis.recommendedFocus.description}
- **Supporting gaps**: ${gapAnalysis.prioritizedGaps.map(g => g.description).join('\n  - ')}
- **Gap type**: ${gapAnalysis.recommendedFocus.type}

## 4. Research Questions
### 4.1 Primary Question
${researchQuestions.primaryQuestion}

### 4.2 Sub-Questions
${researchQuestions.subQuestions.map((q, i) => `${i+1}. ${q}`).join('\n')}

### 4.3 Hypotheses
${researchQuestions.hypotheses.map((h, i) => `**H${i+1}**: ${h}`).join('\n\n')}

### 4.4 Expected Contributions
- **Academic**: ${researchQuestions.contributions.academic}
- **Practical**: ${researchQuestions.contributions.practical}
- **Community**: ${researchQuestions.contributions.community}

## 5. Methodology
### 5.1 Primary Method
${selectedMethods.primaryMethod.description}

**Justification**: ${selectedMethods.primaryMethod.justification}

### 5.2 Technical Approach
${selectedMethods.technicalApproach}

### 5.3 Datasets
${selectedMethods.datasets.map(d => `- **${d.name}**: ${d.description} (${d.size})`).join('\n')}

### 5.4 Baselines
${selectedMethods.baselines.map(b => `- ${b}`).join('\n')}

### 5.5 Evaluation Metrics
${selectedMethods.evaluationMetrics.map(m => `- **${m.name}**: ${m.description}`).join('\n')}

### 5.6 Backup Methods
${selectedMethods.backupMethods.map(m => `- ${m.name}: ${m.trigger}`).join('\n')}

## 6. Timeline
${timelineTable}

## 7. Milestones
${milestones.map((m, i) => `
### Milestone ${i+1}: ${m.name}
- **Target**: ${m.target}
- **Criteria**: ${m.criteria.join(', ')}
- **Deliverables**: ${m.deliverables.join(', ')}
`).join('\n')}

## 8. Risk Management
${riskTables}

## 9. Resource Requirements
### 9.1 Compute
${computeResourceTable}

### 9.2 Data
${dataRequirements}

### 9.3 Personnel
${personnelAllocation}

### 9.4 Tools and Software
${toolsAndSoftware}

## 10. Summary
${executiveSummary}
`)
```

Present the complete plan to user for review:
```javascript
request_user_input({
  questions: [{
    question: "The research plan is complete. Would you like to adjust anything before finalizing?",
    header: "Plan Review",
    multiSelect: false,
    options: [
      { label: "Approve as-is", description: "Plan looks good, proceed" },
      { label: "Adjust timeline", description: "Modify phase durations or milestones" },
      { label: "Revise methodology", description: "Change methods or evaluation approach" },
      { label: "Refine questions", description: "Adjust research questions or hypotheses" }
    ]
  }]
})
// Incorporate final feedback based on user selection
```

## Output

- **File**: `research-plan.md` — Final structured research proposal
- **File**: `literature-review.md` — Updated if needed during planning
- **update_plan**: Mark Phase 5 completed (all phases done)

## Completion

The scholar-ideation workflow is complete. The user now has:
1. **literature-review.md** — Structured literature review with categorized papers
2. **research-plan.md** — Complete research proposal with questions, methods, timeline, and risks
3. **Zotero collection** — Organized papers with PDFs (if enabled)

Next steps: Proceed to experiment execution using the **scholar-experiment** skill.
