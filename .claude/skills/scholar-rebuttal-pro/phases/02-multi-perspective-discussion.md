# Phase 2: Multi-Perspective Discussion

> **📌 COMPACT SENTINEL [Phase 2: multi-perspective-discussion]**
> This phase contains 4 execution steps (Step 2.1 — 2.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/02-multi-perspective-discussion.md")`

Simulate discussion from author, reviewer, and domain expert perspectives to develop consensus strategies for responding to reviewer comments.

## Objective

- Simulate author perspective: identify most effective response strategies
- Simulate reviewer perspective: determine what arguments are most persuasive
- Simulate domain expert perspective: ensure technical accuracy and academic norms
- Synthesize consensus strategies from all three perspectives
- Generate discussion log and strategic recommendations

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
    TodoWrite([
      {"content": `${phaseName}`, "status": "failed"},
      {"content": `  Error: ${error.message}`, "status": "failed"}
    ]);
    return { success: false, error: error.message };
  }
}

// CLI output parsing with validation
function parseCLIOutput(cliResult, expectedFields, phaseName) {
  try {
    // Parse JSON from stdout
    const output = JSON.parse(cliResult.stdout || cliResult);
    
    // Validate required fields
    for (const field of expectedFields) {
      if (!(field in output)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return { success: true, data: output };
  } catch (error) {
    console.error(`[${phaseName}] Failed to parse CLI output:`, error.message);
    console.error("Raw output:", cliResult.stdout || cliResult);
    return { success: false, error: error.message };
  }
}
```

### Step 2.1: Load Review Analysis

Load the review analysis from Phase 1:

```javascript
// Input from Phase 1
const reviewAnalysis = <from Phase 1 output>
const commentCategories = <from Phase 1 output>

// Read review-analysis.json with error handling
const analysisPath = ".workflow/.scratchpad/review-analysis.json"
const analysisResult = safeReadJSON(analysisPath, "Phase 2");

if (!analysisResult.success) {
  console.error("Cannot proceed without review analysis");
  return;
}

const analysis = analysisResult.data;

// Extract key information
const majorIssues = analysis.comments.filter(c => c.category === "Major")
const minorIssues = analysis.comments.filter(c => c.category === "Minor")
const misunderstandings = analysis.comments.filter(c => c.category === "Misunderstanding")
const typos = analysis.comments.filter(c => c.category === "Typo")

console.log(`
Review Analysis Summary:
  Major Issues: ${majorIssues.length}
  Minor Issues: ${minorIssues.length}
  Misunderstandings: ${misunderstandings.length}
  Typos: ${typos.length}
`)
```

### Step 2.2: Multi-Perspective Discussion via CLI

> **⚠️ CHECKPOINT**: Before proceeding, verify:
> 1. This phase is TodoWrite `in_progress` (active phase protection)
> 2. Full protocol (Step 2.X — 2.4) is in active memory, not just sentinel
> If only sentinel remains → `Read("phases/02-multi-perspective-discussion.md")` now.

Use Agy CLI to simulate three perspectives discussing each major issue:

```bash
# For each major issue, run multi-perspective analysis
for issue in majorIssues:
  ccw cli -p "PURPOSE: Simulate multi-perspective discussion on reviewer comment to develop robust response strategy

PERSPECTIVES:
1. Author Perspective: How can we most effectively respond to this concern? What evidence do we have? What experiments can we add?
2. Reviewer Perspective: What would convince me as a reviewer? What arguments would I find persuasive? What evidence is missing?
3. Domain Expert Perspective: Is the technical approach sound? Does it follow academic norms? Are there any accuracy concerns?

REVIEWER COMMENT:
${issue.text}

COMMENT METADATA:
- Category: ${issue.category}
- Severity: ${issue.severity}
- Sentiment: ${issue.sentiment}
- Key Concerns: ${issue.keyConcerns.join(', ')}

TASK:
• Author: Propose 2-3 response strategies with IDs (0, 1, 2)
• Reviewer: Evaluate each strategy's persuasiveness (score 1-10)
• Expert: Validate technical accuracy and suggest improvements
• Synthesize: Recommend best strategy with SOURCE STRATEGY ID

MODE: analysis
CONTEXT: @review-analysis.json
EXPECTED: JSON with {
  'authorStrategies': [
    {'id': 0, 'strategy': '...', 'evidence': '...', 'feasibility': '...'},
    {'id': 1, 'strategy': '...', 'evidence': '...', 'feasibility': '...'}
  ],
  'reviewerEvaluation': [
    {'strategyId': 0, 'persuasivenessScore': N, 'concerns': '...'},
    {'strategyId': 1, 'persuasivenessScore': N, 'concerns': '...'}
  ],
  'expertValidation': [
    {'strategyId': 0, 'technicalSoundness': '...', 'suggestions': '...'},
    {'strategyId': 1, 'technicalSoundness': '...', 'suggestions': '...'}
  ],
  'consensusRecommendation': {
    'strategy': '...',
    'rationale': '...',
    'priority': '...',
    'sourceStrategyId': 0
  }
}" --tool agy --mode analysis --rule analysis-review-architecture
```

**Alternative: Use team-ultra-analyze skill**

If `team-ultra-analyze` skill is available, use it for richer discussion:

```javascript
// Spawn team-ultra-analyze for multi-perspective discussion
Task({
  subagent_type: "team-ultra-analyze",
  description: "Multi-perspective rebuttal strategy discussion",
  prompt: `Analyze reviewer comment from three perspectives (author/reviewer/expert) and develop consensus response strategy.

REVIEWER COMMENT:
${issue.text}

COMMENT METADATA:
- Category: ${issue.category}
- Severity: ${issue.severity}
- Key Concerns: ${issue.keyConcerns.join(', ')}

ROLES:
- Author: Propose response strategies with evidence requirements (include strategy IDs)
- Reviewer: Evaluate persuasiveness of each strategy
- Expert: Validate technical accuracy and academic norms

OUTPUT: Consensus strategy with rationale, priority, and source strategy ID`,
  run_in_background: false
})
```

### Step 2.3: Aggregate Discussion Results

Collect and aggregate results from all discussions:

```javascript
const discussionResults = []

for (const issue of majorIssues) {
  // Execute CLI or agent call
  const cliResult = <from CLI execution>
  
  // Parse CLI output with validation
  const parseResult = parseCLIOutput(
    cliResult,
    ['authorStrategies', 'reviewerEvaluation', 'expertValidation', 'consensusRecommendation'],
    'Phase 2'
  );

  let discussionOutput;
  if (!parseResult.success) {
    // Fallback: use default structure
    console.error(`Failed to parse discussion for issue ${issue.id}, using fallback`);
    discussionOutput = {
      authorStrategies: [{id: 0, strategy: "Manual review required", evidence: "CLI parsing failed", feasibility: "N/A"}],
      reviewerEvaluation: [{strategyId: 0, persuasivenessScore: 0, concerns: "CLI parsing failed"}],
      expertValidation: [{strategyId: 0, technicalSoundness: "Unknown", suggestions: "Manual review required"}],
      consensusRecommendation: {
        strategy: "Manual review required",
        rationale: `CLI parsing failed: ${parseResult.error}`,
        priority: "high",
        sourceStrategyId: 0
      }
    };
  } else {
    discussionOutput = parseResult.data;
  }

  discussionResults.push({
    issueId: issue.id,
    issueText: issue.text,
    category: issue.category,
    severity: issue.severity,

    // Author perspective
    authorStrategies: discussionOutput.authorStrategies,

    // Reviewer perspective
    reviewerEvaluation: discussionOutput.reviewerEvaluation,

    // Expert perspective
    expertValidation: discussionOutput.expertValidation,

    // Consensus
    consensusStrategy: discussionOutput.consensusRecommendation.strategy,
    consensusRationale: discussionOutput.consensusRecommendation.rationale,
    priority: discussionOutput.consensusRecommendation.priority
  })
}

// Sort by priority (high to low)
discussionResults.sort((a, b) => {
  const priorityMap = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 }
  return priorityMap[b.priority] - priorityMap[a.priority]
})
```

### Step 2.4: Generate Discussion Log and Consensus Strategies

Generate two output files:

**1. Discussion Log (discussion-log.md)**

```javascript
let discussionLog = `# Multi-Perspective Discussion Log

Generated: ${new Date().toISOString()}

## Summary

Total Issues Discussed: ${discussionResults.length}
- Critical Priority: ${discussionResults.filter(r => r.priority === 'critical').length}
- High Priority: ${discussionResults.filter(r => r.priority === 'high').length}
- Medium Priority: ${discussionResults.filter(r => r.priority === 'medium').length}
- Low Priority: ${discussionResults.filter(r => r.priority === 'low').length}

---

`

for (const result of discussionResults) {
  discussionLog += `## Issue ${result.issueId}: ${result.category} (${result.priority} priority)

### Reviewer Comment

> ${result.issueText}

**Severity**: ${result.severity}

### Author Perspective

${result.authorStrategies.map((s, i) => `
**Strategy ${i+1}**: ${s.strategy}
- Evidence Required: ${s.evidence}
- Feasibility: ${s.feasibility}
`).join('\n')}

### Reviewer Perspective

${result.reviewerEvaluation.map((e, i) => `
**Strategy ${i+1} Evaluation**:
- Persuasiveness Score: ${e.persuasivenessScore}/10
- Concerns: ${e.concerns}
`).join('\n')}

### Expert Perspective

${result.expertValidation.map((v, i) => `
**Strategy ${i+1} Validation**:
- Technical Soundness: ${v.technicalSoundness}
- Suggestions: ${v.suggestions}
`).join('\n')}

### Consensus Recommendation

**Strategy**: ${result.consensusStrategy}

**Rationale**: ${result.consensusRationale}

**Priority**: ${result.priority}

---

`
}

Write(".workflow/.scratchpad/discussion-log.md", discussionLog)
```

**2. Consensus Strategies (consensus-strategies.json)**

```javascript
const consensusStrategies = {
  timestamp: new Date().toISOString(),
  totalIssues: discussionResults.length,
  strategies: discussionResults.map(r => {
    // Use index-based association with fallback
    // Find the source strategy ID from consensus recommendation
    const sourceStrategyId = r.consensusRecommendation?.sourceStrategyId;
    const sourceStrategy = r.authorStrategies.find(s => s.id === sourceStrategyId);
    const reviewerEval = r.reviewerEvaluation.find(e => e.strategyId === sourceStrategyId);
    
    return {
      issueId: r.issueId,
      issueText: r.issueText,
      category: r.category,
      severity: r.severity,
      priority: r.priority,
      recommendedStrategy: r.consensusStrategy,
      rationale: r.consensusRationale,
      evidenceRequirements: sourceStrategy?.evidence || "Evidence not specified - manual review required",
      persuasivenessScore: reviewerEval?.persuasivenessScore || 0
    };
  })
}

try {
  Write(".workflow/.scratchpad/consensus-strategies.json", JSON.stringify(consensusStrategies, null, 2))
} catch (error) {
  console.error(`[Phase 2] Failed to write consensus-strategies.json:`, error.message);
  TodoWrite([
    {"content": "Phase 2: Multi-Perspective Discussion", "status": "failed"},
    {"content": `  Error writing output: ${error.message}`, "status": "failed"}
  ]);
  throw error;
}
```

**User Confirmation (if not auto mode)**

```javascript
if (!workflowPreferences.autoYes) {
  const confirm = AskUserQuestion({
    questions: [{
      question: "Review discussion results and consensus strategies. Proceed to strategy formulation?",
      header: "Confirm",
      multiSelect: false,
      options: [
        { label: "Proceed", description: "Continue to Phase 3 with these strategies" },
        { label: "Revise", description: "Adjust strategies before proceeding" },
        { label: "Add Discussion", description: "Discuss additional issues" }
      ]
    }]
  })

  if (confirm["Confirm"] === "Revise") {
    // Allow user to edit consensus-strategies.json
    console.log("Please edit .workflow/.scratchpad/consensus-strategies.json and re-run this phase")
    return
  }
}
```

## Output

- **Variable**: `discussionConsensus` (aggregated discussion results)
- **Variable**: `strategicRecommendations` (consensus strategies for each issue)
- **File**: `.workflow/.scratchpad/discussion-log.md` (full discussion transcript)
- **File**: `.workflow/.scratchpad/consensus-strategies.json` (structured strategies)
- **TodoWrite**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 3: Strategy Formulation](03-strategy-formulation.md).
