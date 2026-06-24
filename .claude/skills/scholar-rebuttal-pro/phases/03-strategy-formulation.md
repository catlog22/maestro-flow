# Phase 3: Strategy Formulation

> **📌 COMPACT SENTINEL [Phase 3: strategy-formulation]**
> This phase contains 4 execution steps (Step 3.1 — 3.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/03-strategy-formulation.md")`

Select response strategies (Accept/Defend/Clarify/Experiment) based on discussion consensus, analyze paper content for supporting evidence using CLI, identify gaps requiring new experiments.

## Objective

- Map each comment to specific response strategy (Accept/Defend/Clarify/Experiment)
- Use Agy CLI to search paper content for supporting evidence
- Identify gaps requiring new experiments or additional data
- Generate strategy matrix with evidence references
- Prepare structured input for rebuttal writing phase

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

### Step 3.1: Load Consensus Strategies

Load the consensus strategies from Phase 2:

```javascript
// Input from Phase 2
const discussionConsensus = <from Phase 2 output>
const strategicRecommendations = <from Phase 2 output>

// Read consensus-strategies.json with error handling
const strategiesPath = ".workflow/.scratchpad/consensus-strategies.json"
const strategiesResult = safeReadJSON(strategiesPath, "Phase 3");

if (!strategiesResult.success) {
  console.error("Cannot proceed without consensus strategies");
  return;
}

const consensusData = strategiesResult.data;

// Extract strategies by priority
const strategies = consensusData.strategies
const criticalStrategies = strategies.filter(s => s.priority === 'critical')
const highStrategies = strategies.filter(s => s.priority === 'high')
const mediumStrategies = strategies.filter(s => s.priority === 'medium')
const lowStrategies = strategies.filter(s => s.priority === 'low')

console.log(`
Strategy Formulation Input:
  Critical: ${criticalStrategies.length}
  High: ${highStrategies.length}
  Medium: ${mediumStrategies.length}
  Low: ${lowStrategies.length}
`)
```

### Step 3.2: Map Strategies to Response Types

> **⚠️ CHECKPOINT**: Before proceeding, verify:
> 1. This phase is TodoWrite `in_progress` (active phase protection)
> 2. Full protocol (Step 3.X — 3.4) is in active memory, not just sentinel
> If only sentinel remains → `Read("phases/03-strategy-formulation.md")` now.

Classify each consensus strategy into one of four response types:

```javascript
// Strategy type mapping
const strategyTypeMap = {
  'Accept': ['acknowledge', 'agree', 'incorporate', 'add', 'include', 'fix'],
  'Defend': ['justify', 'explain', 'clarify existing', 'already addressed', 'sufficient'],
  'Clarify': ['misunderstanding', 'misinterpret', 'unclear', 'rephrase', 'elaborate'],
  'Experiment': ['new experiment', 'additional data', 'ablation', 'comparison', 'validate']
}

function classifyStrategy(strategyText) {
  const lowerStrategy = strategyText.toLowerCase()

  for (const [type, keywords] of Object.entries(strategyTypeMap)) {
    if (keywords.some(kw => lowerStrategy.includes(kw))) {
      return type
    }
  }

  // Default to Clarify if uncertain
  return 'Clarify'
}

// Map each strategy to response type
const strategyMatrix = strategies.map(s => ({
  issueId: s.issueId,
  issueText: s.issueText,
  category: s.category,
  severity: s.severity,
  priority: s.priority,
  recommendedStrategy: s.recommendedStrategy,
  responseType: classifyStrategy(s.recommendedStrategy),
  evidenceRequirements: s.evidenceRequirements,
  persuasivenessScore: s.persuasivenessScore,
  evidenceStatus: 'pending', // Will be updated in next step
  evidenceReferences: []
}))

console.log(`
Strategy Type Distribution:
  Accept: ${strategyMatrix.filter(s => s.responseType === 'Accept').length}
  Defend: ${strategyMatrix.filter(s => s.responseType === 'Defend').length}
  Clarify: ${strategyMatrix.filter(s => s.responseType === 'Clarify').length}
  Experiment: ${strategyMatrix.filter(s => s.responseType === 'Experiment').length}
`)
```

### Step 3.3: Search Paper Content for Evidence

Use Agy CLI to search paper content for supporting evidence:

```javascript
// Determine paper path
let paperPath
if (workflowPreferences.paperSource === "Provide Path") {
  paperPath = <user-provided-path>
} else if (workflowPreferences.paperSource === "Current Directory") {
  // Auto-discover paper in current directory
  const pdfFiles = Glob({ pattern: "*.pdf" })
  const texFiles = Glob({ pattern: "*.tex" })

  if (pdfFiles.length > 0) {
    paperPath = pdfFiles[0]
  } else if (texFiles.length > 0) {
    paperPath = texFiles[0]
  } else {
    console.log("No paper found in current directory, proceeding in review-only mode")
    paperPath = null
  }
} else {
  // Review Only mode
  paperPath = null
}

// If paper available, search for evidence
if (paperPath) {
  console.log(`Searching paper for evidence: ${paperPath}`)

  // For each strategy requiring evidence, search paper
  for (const strategy of strategyMatrix) {
    if (strategy.responseType === 'Defend' || strategy.responseType === 'Clarify') {
      // Use Agy CLI to search for relevant sections
      const cliCommand = `ccw cli -p "PURPOSE: Search paper content for evidence supporting response to reviewer comment

REVIEWER COMMENT:
${strategy.issueText}

RESPONSE STRATEGY:
${strategy.recommendedStrategy}

EVIDENCE REQUIREMENTS:
${strategy.evidenceRequirements}

TASK:
• Locate relevant sections in paper (methods, results, discussion)
• Extract specific evidence (figures, tables, equations, experimental results)
• Identify page/section numbers for citation
• Assess evidence strength (strong/moderate/weak)

MODE: analysis
CONTEXT: @${paperPath}
EXPECTED: JSON with {
  'evidenceFound': true|false,
  'sections': [{'section': '...', 'page': N, 'content': '...', 'relevance': 'high|medium|low'}],
  'figures': [{'figureId': '...', 'caption': '...', 'relevance': '...'}],
  'tables': [{'tableId': '...', 'caption': '...', 'relevance': '...'}],
  'equations': [{'equationId': '...', 'content': '...', 'relevance': '...'}],
  'evidenceStrength': 'strong|moderate|weak',
  'gaps': ['gap1', 'gap2']
}" --tool agy --mode analysis --rule analysis-trace-code-execution`

      // Execute CLI command
      Bash({
        command: cliCommand,
        description: `Search paper for evidence: ${strategy.issueId}`,
        run_in_background: true
      })
    }
  }

  // Wait for all CLI commands to complete
  // (In practice, this would be handled by the hook callback system)

  // Parse CLI outputs and update strategy matrix
  for (const strategy of strategyMatrix) {
    if (strategy.responseType === 'Defend' || strategy.responseType === 'Clarify') {
      const cliResult = <from CLI output>
      
      // Parse CLI output with validation
      const parseResult = parseCLIOutput(
        cliResult,
        ['evidenceFound', 'sections', 'figures', 'tables', 'gaps'],
        'Phase 3'
      );

      let evidenceResult;
      if (!parseResult.success) {
        // Fallback: mark as not found
        console.error(`Failed to parse evidence search for ${strategy.issueId}, marking as not found`);
        evidenceResult = {
          evidenceFound: false,
          sections: [],
          figures: [],
          tables: [],
          gaps: [`CLI parsing failed: ${parseResult.error}`]
        };
      } else {
        evidenceResult = parseResult.data;
      }

      if (evidenceResult.evidenceFound) {
        strategy.evidenceStatus = 'found'
        strategy.evidenceReferences = [
          ...evidenceResult.sections.map(s => ({
            type: 'section',
            id: s.section,
            page: s.page,
            content: s.content,
            relevance: s.relevance
          })),
          ...evidenceResult.figures.map(f => ({
            type: 'figure',
            id: f.figureId,
            caption: f.caption,
            relevance: f.relevance
          })),
          ...evidenceResult.tables.map(t => ({
            type: 'table',
            id: t.tableId,
            caption: t.caption,
            relevance: t.relevance
          })),
          ...evidenceResult.equations.map(e => ({
            type: 'equation',
            id: e.equationId,
            content: e.content,
            relevance: e.relevance
          }))
        ]
        strategy.evidenceStrength = evidenceResult.evidenceStrength
        strategy.evidenceGaps = evidenceResult.gaps
      } else {
        strategy.evidenceStatus = 'not_found'
        strategy.evidenceGaps = evidenceResult.gaps
      }
    } else if (strategy.responseType === 'Experiment') {
      // Mark as requiring new experiments
      strategy.evidenceStatus = 'requires_experiment'
      strategy.evidenceGaps = [strategy.evidenceRequirements]
    } else if (strategy.responseType === 'Accept') {
      // No evidence needed for acceptance
      strategy.evidenceStatus = 'not_required'
    }
  }
} else {
  // Review-only mode: mark all as pending
  console.log("Review-only mode: Evidence search skipped")
  for (const strategy of strategyMatrix) {
    strategy.evidenceStatus = 'review_only'
    strategy.evidenceReferences = []
  }
}
```

### Step 3.4: Generate Strategy Matrix and Evidence References

Generate two output files:

**1. Strategy Matrix (strategy-matrix.md)**

```javascript
let matrixReport = `# Response Strategy Matrix

Generated: ${new Date().toISOString()}

## Summary

Total Strategies: ${strategyMatrix.length}

### By Response Type
- Accept: ${strategyMatrix.filter(s => s.responseType === 'Accept').length}
- Defend: ${strategyMatrix.filter(s => s.responseType === 'Defend').length}
- Clarify: ${strategyMatrix.filter(s => s.responseType === 'Clarify').length}
- Experiment: ${strategyMatrix.filter(s => s.responseType === 'Experiment').length}

### By Evidence Status
- Found: ${strategyMatrix.filter(s => s.evidenceStatus === 'found').length}
- Not Found: ${strategyMatrix.filter(s => s.evidenceStatus === 'not_found').length}
- Requires Experiment: ${strategyMatrix.filter(s => s.evidenceStatus === 'requires_experiment').length}
- Not Required: ${strategyMatrix.filter(s => s.evidenceStatus === 'not_required').length}

---

`

// Group by response type
const groupedStrategies = {
  'Accept': strategyMatrix.filter(s => s.responseType === 'Accept'),
  'Defend': strategyMatrix.filter(s => s.responseType === 'Defend'),
  'Clarify': strategyMatrix.filter(s => s.responseType === 'Clarify'),
  'Experiment': strategyMatrix.filter(s => s.responseType === 'Experiment')
}

for (const [responseType, strategies] of Object.entries(groupedStrategies)) {
  if (strategies.length === 0) continue

  matrixReport += `## ${responseType} Strategies (${strategies.length})

`

  for (const strategy of strategies) {
    matrixReport += `### ${strategy.issueId}: ${strategy.category} (${strategy.priority} priority)

**Reviewer Comment**:
> ${strategy.issueText}

**Response Strategy**: ${strategy.recommendedStrategy}

**Evidence Status**: ${strategy.evidenceStatus}

`

    if (strategy.evidenceReferences.length > 0) {
      matrixReport += `**Evidence References**:
`
      for (const ref of strategy.evidenceReferences) {
        matrixReport += `- [${ref.type}] ${ref.id}${ref.page ? ` (page ${ref.page})` : ''} - Relevance: ${ref.relevance}
`
      }
      matrixReport += `
`
    }

    if (strategy.evidenceGaps && strategy.evidenceGaps.length > 0) {
      matrixReport += `**Evidence Gaps**:
${strategy.evidenceGaps.map(g => `- ${g}`).join('\n')}

`
    }

    matrixReport += `**Persuasiveness Score**: ${strategy.persuasivenessScore}/10

---

`
  }
}

Write(".workflow/.scratchpad/strategy-matrix.md", matrixReport)
```

**2. Evidence References (evidence-references.json)**

```javascript
const evidenceReferences = {
  timestamp: new Date().toISOString(),
  paperPath: paperPath || "review-only",
  totalStrategies: strategyMatrix.length,
  evidenceSummary: {
    found: strategyMatrix.filter(s => s.evidenceStatus === 'found').length,
    notFound: strategyMatrix.filter(s => s.evidenceStatus === 'not_found').length,
    requiresExperiment: strategyMatrix.filter(s => s.evidenceStatus === 'requires_experiment').length,
    notRequired: strategyMatrix.filter(s => s.evidenceStatus === 'not_required').length
  },
  strategies: strategyMatrix.map(s => ({
    issueId: s.issueId,
    responseType: s.responseType,
    evidenceStatus: s.evidenceStatus,
    evidenceStrength: s.evidenceStrength || null,
    evidenceReferences: s.evidenceReferences,
    evidenceGaps: s.evidenceGaps || []
  }))
}

Write(".workflow/.scratchpad/evidence-references.json", JSON.stringify(evidenceReferences, null, 2))
```

**User Confirmation (if not auto mode)**

```javascript
if (!workflowPreferences.autoYes) {
  const confirm = AskUserQuestion({
    questions: [{
      question: "Review strategy matrix and evidence references. Proceed to rebuttal writing?",
      header: "Confirm",
      multiSelect: false,
      options: [
        { label: "Proceed", description: "Continue to Phase 4 with these strategies" },
        { label: "Revise", description: "Adjust strategies or add evidence" },
        { label: "Add Experiments", description: "Plan additional experiments for gaps" }
      ]
    }]
  })

  if (confirm["Confirm"] === "Revise") {
    console.log("Please edit .workflow/.scratchpad/strategy-matrix.md and re-run this phase")
    return
  } else if (confirm["Confirm"] === "Add Experiments") {
    console.log("Please document planned experiments and update evidence-references.json")
    return
  }
}
```

## Output

- **Variable**: `strategyMatrix` (complete strategy matrix with evidence)
- **Variable**: `evidenceMap` (evidence references for each strategy)
- **File**: `.workflow/.scratchpad/strategy-matrix.md` (human-readable matrix)
- **File**: `.workflow/.scratchpad/evidence-references.json` (structured evidence data)
- **TodoWrite**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 4: Rebuttal Writing](04-rebuttal-writing.md).
