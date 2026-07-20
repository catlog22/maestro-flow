
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 4: Rebuttal Writing

## Objective

- Load conference-specific rebuttal template
- Call rebuttal-writer agent with strategy matrix and evidence
- Write point-by-point responses with evidence integration
- Optimize professional tone and persuasiveness
- Generate final rebuttal.md and draft version

## Execution

### Helper Functions

```javascript
// Unified error handling for JSON file reading
function safeReadJSON(filePath, phaseName) {
  try {
    const content = Read(filePath);
    const data = JSON.parse(content);
    return { success: true, data };
  } catch (error) {
    console.error(`[${phaseName}] Failed to read ${filePath}:`, error.message);
    update_plan([
      {"content": `${phaseName}`, "status": "failed"},
      {"content": `  Error: ${error.message}`, "status": "failed"}
    ]);
    return { success: false, error: error.message };
  }
}
```

### Step 4.1: Load Strategy Matrix and Conference Template

Load the strategy matrix from Phase 3 and select conference template:

```javascript
// Input from Phase 3
const strategyMatrix = <from Phase 3 output>
const evidenceMap = <from Phase 3 output>

// Read strategy-matrix and evidence-references with error handling
const matrixPath = "{run_dir}/outputs/strategy-matrix.md"
const evidencePath = "{run_dir}/outputs/evidence-references.json"

let strategyMatrixContent;
try {
  strategyMatrixContent = Read(matrixPath)
} catch (error) {
  console.error(`[Phase 4] Failed to read strategy-matrix.md:`, error.message);
  update_plan([
    {"content": "Phase 4: Rebuttal Writing", "status": "failed"},
    {"content": `  Error: ${error.message}`, "status": "failed"}
  ]);
  throw error;
}

const evidenceResult = safeReadJSON(evidencePath, "Phase 4");
if (!evidenceResult.success) {
  console.error("Cannot proceed without evidence references");
  return;
}
const evidenceData = evidenceResult.data;

// Select conference template based on user preference
const conferenceType = workflowPreferences.conferenceType

const templateMap = {
  'ML Conferences': 'neurips-icml-iclr',
  'CV Conferences': 'cvpr-eccv-iccv',
  'NLP Conferences': 'acl-emnlp',
  'Generic': 'generic'
}

const templateId = templateMap[conferenceType] || 'generic'

console.log(`
Rebuttal Writing Configuration:
  Conference Type: ${conferenceType}
  Template: ${templateId}
  Total Strategies: ${evidenceData.totalStrategies}
  Evidence Found: ${evidenceData.evidenceSummary.found}
  Requires Experiment: ${evidenceData.evidenceSummary.requiresExperiment}
`)
```

### Step 4.2: Load Conference-Specific Template

> **⚠️ CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 4.X — 4.4) is in active memory, not just sentinel
> If only sentinel remains → `Read("phases/04-rebuttal-writing.md")` now.

Load template from the skill-local `templates/` directory (paths relative to the skill root, same convention as phase file reads):

```javascript
// Template search paths
const templatePaths = [
  `templates/${templateId}-template.md`, // skill-local, user may add conference-specific templates
  `templates/discussion.md`              // Fallback to generic discussion template
]

let templateContent = null
let templatePath = null

for (const path of templatePaths) {
  try {
    templateContent = Read(path)
    templatePath = path
    console.log(`Loaded template: ${path}`)
    break
  } catch (e) {
    // Template not found, try next
    continue
  }
}

if (!templateContent) {
  // Use built-in generic template
  templateContent = `# Rebuttal to Reviewers

We thank the reviewers for their thoughtful comments and constructive feedback. Below we address each concern point-by-point.

## Response to Reviewer Comments

[Point-by-point responses will be inserted here]

## Summary

We believe these revisions address all major concerns and strengthen the paper significantly. We are committed to incorporating all accepted suggestions in the final version.
`
  console.log("Using built-in generic template")
}
```

### Step 4.3: Call Rebuttal-Writer Agent

Dispatch rebuttal-writer agent to generate responses:

```javascript
// Prepare agent prompt
const agentPrompt = `Generate a professional academic rebuttal document responding to reviewer comments.

CONFERENCE TYPE: ${conferenceType}
TEMPLATE: ${templateId}

STRATEGY MATRIX:
${strategyMatrixContent}

EVIDENCE REFERENCES:
${JSON.stringify(evidenceData, null, 2)}

TEMPLATE STRUCTURE:
${templateContent}

REQUIREMENTS:
1. Write point-by-point responses for each reviewer comment
2. Use appropriate response type (Accept/Defend/Clarify/Experiment)
3. Integrate evidence references with specific citations (Figure X, Table Y, Section Z, Page N)
4. Maintain professional, respectful tone throughout
5. For Accept strategies: acknowledge concern and commit to changes
6. For Defend strategies: provide strong evidence and clear justification
7. For Clarify strategies: address misunderstanding with clear explanation
8. For Experiment strategies: outline planned experiments and expected outcomes
9. Follow conference-specific conventions:
   - ML Conferences: Emphasize novelty, theoretical soundness, experimental rigor
   - CV Conferences: Focus on visual results, one-page limit, concise responses
   - NLP Conferences: Address linguistic appropriateness, ethical considerations
   - Generic: Universal academic tone and structure
10. Optimize persuasiveness: lead with strongest evidence, acknowledge valid concerns

OUTPUT FORMAT:
- Markdown document following template structure
- Clear section headers for each reviewer
- Numbered responses matching comment IDs
- Evidence citations in [brackets] or footnotes
- Professional, confident but respectful tone

TONE GUIDELINES:
- Respectful: "We thank the reviewer for this insightful comment..."
- Confident: "Our experiments demonstrate...", "The results clearly show..."
- Collaborative: "We agree that...", "We will incorporate..."
- Evidence-based: "As shown in Figure 3...", "Table 2 demonstrates..."
- Avoid defensive language: "We believe the reviewer may have overlooked..."
- Avoid dismissive language: "This concern is not valid..."
`

// Call rebuttal-writer agent
const agentResult = Task({
  subagent_type: "general-purpose", // Use general-purpose agent with full write capabilities
  description: "Generate academic rebuttal document",
  prompt: agentPrompt,
  run_in_background: false
})

// Parse agent output
const rebuttalDraft = agentResult.output || agentResult
```

### Step 4.4: Post-Process and Generate Final Rebuttal

Post-process the draft and generate final files:

```javascript
// Post-processing: ensure all comments addressed
const strategyIds = evidenceData.strategies.map(s => s.issueId)
let missingResponses = []

for (const issueId of strategyIds) {
  if (!rebuttalDraft.includes(issueId)) {
    missingResponses.push(issueId)
  }
}

if (missingResponses.length > 0) {
  console.warn(`Warning: Missing responses for: ${missingResponses.join(', ')}`)

  // Generate placeholder responses for missing items
  let additionalResponses = `\n\n## Additional Responses\n\n`

  for (const issueId of missingResponses) {
    const strategy = evidenceData.strategies.find(s => s.issueId === issueId)
    additionalResponses += `### ${issueId}

**Response**: [TODO: Address this comment based on ${strategy.responseType} strategy]

`
  }

  rebuttalDraft += additionalResponses
}

// Add metadata header
const rebuttalWithMetadata = `---
title: Rebuttal to Reviewers
conference: ${conferenceType}
generated: ${new Date().toISOString()}
template: ${templateId}
total_comments: ${evidenceData.totalStrategies}
---

${rebuttalDraft}

---

## Revision Checklist

- [ ] All reviewer comments addressed
- [ ] Evidence citations verified
- [ ] Tone reviewed for professionalism
- [ ] Planned experiments documented
- [ ] Accepted changes committed to
- [ ] Word count within conference limits
- [ ] Formatting matches conference requirements
`

// Write final rebuttal.md
Write("{run_dir}/outputs/rebuttal.md", rebuttalWithMetadata)

// Write versioned draft
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
Write(`{run_dir}/outputs/rebuttal-draft-v1-${timestamp}.md`, rebuttalWithMetadata)

console.log(`
Rebuttal Generation Complete:
  Total Comments: ${evidenceData.totalStrategies}
  Missing Responses: ${missingResponses.length}
  Output Files:
    - {run_dir}/outputs/rebuttal.md
    - {run_dir}/outputs/rebuttal-draft-v1-${timestamp}.md
`)
```

**User Review (if not auto mode)**

```javascript
if (!workflowPreferences.autoYes) {
  const confirm = request_user_input({
    questions: [{
      question: "Review the generated rebuttal. Proceed to quality validation?",
      header: "Confirm",
      multiSelect: false,
      options: [
        { label: "Proceed", description: "Continue to Phase 5 for quality validation" },
        { label: "Revise", description: "Edit rebuttal manually before validation" },
        { label: "Regenerate", description: "Regenerate with different template or tone" }
      ]
    }]
  })

  if (confirm["Confirm"] === "Revise") {
    console.log("Please edit {run_dir}/outputs/rebuttal.md and re-run this phase")
    return
  } else if (confirm["Confirm"] === "Regenerate") {
    console.log("Please adjust preferences and re-run Phase 4")
    return
  }
}
```

## Output

- **Variable**: `rebuttalDraft` (generated rebuttal content)
- **File**: `{run_dir}/outputs/rebuttal.md` (final rebuttal document)
- **File**: `{run_dir}/outputs/rebuttal-draft-v1-{timestamp}.md` (versioned draft)
- **update_plan**: Mark Phase 4 completed, Phase 5 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 5: Quality Validation](05-quality-validation.md).

## Conference-Specific Guidelines

### ML Conferences (NeurIPS/ICML/ICLR)

**Emphasis**:
- Novelty and theoretical contributions
- Experimental rigor and reproducibility
- Comparison with state-of-the-art
- Ablation studies and analysis

**Tone**: Technical, precise, evidence-heavy

**Common Concerns**:
- Limited novelty → Emphasize unique contributions
- Insufficient experiments → Commit to additional ablations
- Missing baselines → Add comparisons or justify exclusions
- Unclear methodology → Provide detailed clarification

### CV Conferences (CVPR/ECCV/ICCV)

**Emphasis**:
- Visual results and qualitative analysis
- One-page limit (concise responses)
- Comparison with recent methods
- Real-world applicability

**Tone**: Concise, visual-focused, practical

**Common Concerns**:
- Limited visual results → Add qualitative comparisons
- Missing comparisons → Commit to additional experiments
- Unclear architecture → Provide detailed diagrams
- Computational cost → Report efficiency metrics

### NLP Conferences (ACL/EMNLP)

**Emphasis**:
- Linguistic appropriateness
- Ethical considerations and bias
- Dataset quality and diversity
- Human evaluation

**Tone**: Careful, ethically aware, linguistically precise

**Common Concerns**:
- Dataset bias → Acknowledge and commit to analysis
- Limited languages → Justify scope or expand
- Ethical issues → Address thoroughly with mitigation
- Missing human eval → Commit to human studies

### Generic Template

**Emphasis**:
- Clear, respectful communication
- Evidence-based responses
- Commitment to improvements
- Professional academic tone

**Tone**: Balanced, respectful, collaborative

**Structure**:
1. Thank reviewers
2. Point-by-point responses
3. Summary of changes
4. Commitment to revisions
