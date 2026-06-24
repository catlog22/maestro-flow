# Phase 5: Quality Validation

Validate rebuttal quality using Agy CLI: completeness, professionalism, persuasiveness, generate improvement suggestions.

## Objective

- Check completeness (all comments addressed)
- Assess professionalism and tone
- Evaluate persuasiveness and evidence strength
- Generate improvement recommendations
- Produce quality report with actionable feedback

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

### Step 5.1: Load Rebuttal and Reference Data

Load the generated rebuttal and reference data for validation:

```javascript
// Input from Phase 4
const rebuttalDraft = <from Phase 4 output>

// Read rebuttal.md and reference files with error handling
const rebuttalPath = ".workflow/.scratchpad/rebuttal.md"
const evidencePath = ".workflow/.scratchpad/evidence-references.json"
const strategyPath = ".workflow/.scratchpad/strategy-matrix.md"
const reviewPath = ".workflow/.scratchpad/review-analysis.json"

let rebuttalContent;
try {
  rebuttalContent = Read(rebuttalPath)
} catch (error) {
  console.error(`[Phase 5] Failed to read rebuttal.md:`, error.message);
  TodoWrite([
    {"content": "Phase 5: Quality Validation", "status": "failed"},
    {"content": `  Error: ${error.message}`, "status": "failed"}
  ]);
  throw error;
}

const evidenceResult = safeReadJSON(evidencePath, "Phase 5");
const reviewResult = safeReadJSON(reviewPath, "Phase 5");

if (!evidenceResult.success || !reviewResult.success) {
  console.error("Cannot proceed without reference data");
  return;
}

const evidenceData = evidenceResult.data;
const reviewData = reviewResult.data;

let strategyContent;
try {
  strategyContent = Read(strategyPath)
} catch (error) {
  console.error(`[Phase 5] Warning: Failed to read strategy-matrix.md:`, error.message);
  strategyContent = "Strategy matrix not available";
}

console.log(`
Quality Validation Input:
  Rebuttal Length: ${rebuttalContent.length} characters
  Total Comments: ${reviewData.summary.totalComments}
  Evidence References: ${evidenceData.evidenceSummary.found}
`)
```

### Step 5.2: Validate with Agy CLI

Use Agy CLI to perform comprehensive quality validation:

```bash
ccw cli -p "PURPOSE: Validate academic rebuttal quality across multiple dimensions (completeness, professionalism, persuasiveness, evidence strength)

REBUTTAL DOCUMENT:
${rebuttalContent}

REFERENCE DATA:
- Total Reviewer Comments: ${reviewData.summary.totalComments}
- Major Issues: ${reviewData.summary.majorCount}
- Minor Issues: ${reviewData.summary.minorCount}
- Misunderstandings: ${reviewData.summary.misunderstandingCount}
- Evidence Found: ${evidenceData.evidenceSummary.found}
- Requires Experiment: ${evidenceData.evidenceSummary.requiresExperiment}

VALIDATION CRITERIA:

1. COMPLETENESS (0-100):
   - All reviewer comments addressed (check each comment ID)
   - No missing responses
   - All evidence gaps acknowledged
   - Planned experiments documented

2. PROFESSIONALISM (0-100):
   - Respectful tone throughout
   - No defensive or dismissive language
   - Appropriate academic register
   - Clear and concise writing
   - Proper formatting and structure

3. PERSUASIVENESS (0-100):
   - Strong evidence integration
   - Clear logical arguments
   - Effective use of citations
   - Addresses concerns directly
   - Builds confidence in revisions

4. EVIDENCE STRENGTH (0-100):
   - Specific references (Figure X, Table Y, Section Z)
   - Quantitative support where appropriate
   - Sufficient detail for verification
   - Gaps acknowledged with mitigation plans

5. TONE ANALYSIS:
   - Identify any problematic phrases
   - Suggest improvements for weak responses
   - Highlight particularly effective responses

TASK:
• Check completeness: verify all comment IDs from review-analysis.json are addressed
• Assess professionalism: scan for defensive, dismissive, or overly casual language
• Evaluate persuasiveness: rate argument strength and evidence integration
• Analyze evidence: verify citations are specific and verifiable
• Generate improvement suggestions: prioritize by impact

MODE: analysis
CONTEXT: @rebuttal.md @review-analysis.json @evidence-references.json
EXPECTED: JSON with {
  'overallScore': N (0-100),
  'dimensionScores': {
    'completeness': N,
    'professionalism': N,
    'persuasiveness': N,
    'evidenceStrength': N
  },
  'completenessCheck': {
    'totalComments': N,
    'addressedComments': N,
    'missingComments': ['id1', 'id2'],
    'incompleteResponses': [{'id': '...', 'issue': '...'}]
  },
  'toneIssues': [
    {'location': '...', 'issue': '...', 'suggestion': '...', 'severity': 'high|medium|low'}
  ],
  'weakResponses': [
    {'commentId': '...', 'issue': '...', 'suggestion': '...', 'priority': 'high|medium|low'}
  ],
  'strongResponses': [
    {'commentId': '...', 'strength': '...'}
  ],
  'evidenceIssues': [
    {'location': '...', 'issue': '...', 'suggestion': '...'}
  ],
  'improvementPriorities': [
    {'priority': 1, 'issue': '...', 'action': '...', 'impact': 'high|medium|low'}
  ],
  'summary': '...'
}" --tool agy --mode analysis --rule analysis-review-code-quality
```

### Step 5.3: Parse Validation Results

Parse CLI output and analyze results:

```javascript
// Execute CLI validation
const cliResult = <from CLI execution>

// Parse CLI output with validation
const parseResult = parseCLIOutput(
  cliResult,
  ['overallScore', 'dimensionScores', 'completenessCheck', 'toneIssues', 'weakResponses', 'improvementPriorities', 'summary'],
  'Phase 5'
);

let validationResult;
if (!parseResult.success) {
  // Fallback: use minimal validation structure
  console.error("CLI validation parsing failed, using fallback structure");
  validationResult = {
    overallScore: 50,
    dimensionScores: {
      completeness: 50,
      professionalism: 50,
      persuasiveness: 50,
      evidenceStrength: 50
    },
    completenessCheck: {
      totalComments: reviewData.summary.totalComments,
      addressedComments: 0,
      missingComments: [],
      incompleteResponses: []
    },
    toneIssues: [{
      location: 'Unknown',
      issue: `CLI parsing failed: ${parseResult.error}`,
      suggestion: 'Manual review required',
      severity: 'high'
    }],
    weakResponses: [],
    strongResponses: [],
    evidenceIssues: [],
    improvementPriorities: [{
      priority: 1,
      issue: 'CLI validation failed - manual review required',
      action: 'Review rebuttal manually',
      impact: 'high'
    }],
    summary: `Validation failed due to CLI parsing error: ${parseResult.error}`
  };
} else {
  validationResult = parseResult.data;
}

// Calculate overall quality grade
function getQualityGrade(score) {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Good'
  if (score >= 70) return 'Acceptable'
  if (score >= 60) return 'Needs Improvement'
  return 'Major Revision Required'
}

const qualityGrade = getQualityGrade(validationResult.overallScore)

console.log(`
Quality Validation Results:
  Overall Score: ${validationResult.overallScore}/100 (${qualityGrade})
  Completeness: ${validationResult.dimensionScores.completeness}/100
  Professionalism: ${validationResult.dimensionScores.professionalism}/100
  Persuasiveness: ${validationResult.dimensionScores.persuasiveness}/100
  Evidence Strength: ${validationResult.dimensionScores.evidenceStrength}/100

  Missing Comments: ${validationResult.completenessCheck.missingComments.length}
  Tone Issues: ${validationResult.toneIssues.length}
  Weak Responses: ${validationResult.weakResponses.length}
  Improvement Priorities: ${validationResult.improvementPriorities.length}
`)

// Flag critical issues
const criticalIssues = [
  ...validationResult.completenessCheck.missingComments.map(id => ({
    type: 'missing_response',
    severity: 'critical',
    commentId: id,
    message: `Missing response for comment ${id}`
  })),
  ...validationResult.toneIssues.filter(t => t.severity === 'high').map(t => ({
    type: 'tone_issue',
    severity: 'high',
    location: t.location,
    message: t.issue
  })),
  ...validationResult.weakResponses.filter(w => w.priority === 'high').map(w => ({
    type: 'weak_response',
    severity: 'high',
    commentId: w.commentId,
    message: w.issue
  }))
]

if (criticalIssues.length > 0) {
  console.warn(`⚠️ ${criticalIssues.length} critical issues found that should be addressed before submission`)
}
```

### Step 5.4: Generate Quality Report and Improvement Suggestions

Generate comprehensive quality report:

```javascript
// Generate quality-report.md
let qualityReport = `# Rebuttal Quality Validation Report

Generated: ${new Date().toISOString()}

## Overall Assessment

**Quality Score**: ${validationResult.overallScore}/100 (${qualityGrade})

**Summary**: ${validationResult.summary}

---

## Dimension Scores

| Dimension | Score | Status |
|-----------|-------|--------|
| Completeness | ${validationResult.dimensionScores.completeness}/100 | ${validationResult.dimensionScores.completeness >= 80 ? '✅ Pass' : '⚠️ Needs Work'} |
| Professionalism | ${validationResult.dimensionScores.professionalism}/100 | ${validationResult.dimensionScores.professionalism >= 80 ? '✅ Pass' : '⚠️ Needs Work'} |
| Persuasiveness | ${validationResult.dimensionScores.persuasiveness}/100 | ${validationResult.dimensionScores.persuasiveness >= 80 ? '✅ Pass' : '⚠️ Needs Work'} |
| Evidence Strength | ${validationResult.dimensionScores.evidenceStrength}/100 | ${validationResult.dimensionScores.evidenceStrength >= 80 ? '✅ Pass' : '⚠️ Needs Work'} |

---

## Completeness Check

**Total Comments**: ${validationResult.completenessCheck.totalComments}
**Addressed**: ${validationResult.completenessCheck.addressedComments}
**Missing**: ${validationResult.completenessCheck.missingComments.length}

`

if (validationResult.completenessCheck.missingComments.length > 0) {
  qualityReport += `### ⚠️ Missing Responses

The following comments have no response in the rebuttal:

${validationResult.completenessCheck.missingComments.map(id => `- ${id}`).join('\n')}

**Action Required**: Add responses for all missing comments.

`
}

if (validationResult.completenessCheck.incompleteResponses.length > 0) {
  qualityReport += `### Incomplete Responses

${validationResult.completenessCheck.incompleteResponses.map(r => `
**${r.id}**: ${r.issue}
`).join('\n')}

`
}

qualityReport += `---

## Tone Analysis

`

if (validationResult.toneIssues.length === 0) {
  qualityReport += `✅ No tone issues detected. The rebuttal maintains a professional, respectful tone throughout.

`
} else {
  qualityReport += `⚠️ ${validationResult.toneIssues.length} tone issue(s) detected:

`
  for (const issue of validationResult.toneIssues) {
    qualityReport += `### ${issue.severity.toUpperCase()}: ${issue.location}

**Issue**: ${issue.issue}

**Suggestion**: ${issue.suggestion}

---

`
  }
}

qualityReport += `## Response Quality

### Strong Responses ✅

${validationResult.strongResponses.map(r => `
**${r.commentId}**: ${r.strength}
`).join('\n')}

`

if (validationResult.weakResponses.length > 0) {
  qualityReport += `### Weak Responses ⚠️

${validationResult.weakResponses.map(r => `
**${r.commentId}** (${r.priority} priority):
- **Issue**: ${r.issue}
- **Suggestion**: ${r.suggestion}
`).join('\n')}

`
}

qualityReport += `---

## Evidence Integration

`

if (validationResult.evidenceIssues.length === 0) {
  qualityReport += `✅ Evidence integration is strong. Citations are specific and verifiable.

`
} else {
  qualityReport += `⚠️ ${validationResult.evidenceIssues.length} evidence issue(s) detected:

${validationResult.evidenceIssues.map(e => `
**${e.location}**:
- **Issue**: ${e.issue}
- **Suggestion**: ${e.suggestion}
`).join('\n')}

`
}

qualityReport += `---

## Improvement Priorities

${validationResult.improvementPriorities.map((p, i) => `
### Priority ${i + 1}: ${p.impact.toUpperCase()} Impact

**Issue**: ${p.issue}

**Action**: ${p.action}

`).join('\n')}

---

## Recommendations

`

if (validationResult.overallScore >= 90) {
  qualityReport += `The rebuttal is of excellent quality and ready for submission. Minor polishing may further enhance clarity.

`
} else if (validationResult.overallScore >= 80) {
  qualityReport += `The rebuttal is of good quality. Address the improvement priorities above to strengthen the response.

`
} else if (validationResult.overallScore >= 70) {
  qualityReport += `The rebuttal is acceptable but would benefit from revisions. Focus on the high-priority improvements listed above.

`
} else {
  qualityReport += `The rebuttal requires significant revision before submission. Address all critical issues and high-priority improvements.

**Critical Actions**:
${criticalIssues.map(issue => `- ${issue.message}`).join('\n')}

`
}

qualityReport += `## Next Steps

1. Review improvement priorities and address high-impact issues
2. Revise weak responses with stronger evidence and clearer arguments
3. Fix any tone issues to maintain professionalism
4. Ensure all missing comments are addressed
5. Verify all evidence citations are specific and accurate
6. Proofread for clarity, grammar, and formatting
7. Have co-authors review the rebuttal
8. Submit before conference deadline

---

**Generated by**: Scholar Rebuttal Pro
**Validation Tool**: Agy CLI (${new Date().toISOString()})
`

Write(".workflow/.scratchpad/quality-report.md", qualityReport)

// Generate improvement-suggestions.json
const improvementSuggestions = {
  timestamp: new Date().toISOString(),
  overallScore: validationResult.overallScore,
  qualityGrade: qualityGrade,
  dimensionScores: validationResult.dimensionScores,
  criticalIssues: criticalIssues,
  improvementPriorities: validationResult.improvementPriorities,
  toneIssues: validationResult.toneIssues,
  weakResponses: validationResult.weakResponses,
  evidenceIssues: validationResult.evidenceIssues,
  missingComments: validationResult.completenessCheck.missingComments,
  readyForSubmission: validationResult.overallScore >= 80 && criticalIssues.length === 0
}

Write(".workflow/.scratchpad/improvement-suggestions.json", JSON.stringify(improvementSuggestions, null, 2))

console.log(`
Quality Report Generated:
  - .workflow/.scratchpad/quality-report.md
  - .workflow/.scratchpad/improvement-suggestions.json

Ready for Submission: ${improvementSuggestions.readyForSubmission ? 'Yes ✅' : 'No ⚠️'}
`)
```

### Step 5.5: Present Results to User

Present validation results and next steps:

```javascript
// Display summary
console.log(`
═══════════════════════════════════════════════════════════
  REBUTTAL QUALITY VALIDATION COMPLETE
═══════════════════════════════════════════════════════════

Overall Score: ${validationResult.overallScore}/100 (${qualityGrade})

Dimension Breakdown:
  ✓ Completeness:      ${validationResult.dimensionScores.completeness}/100
  ✓ Professionalism:   ${validationResult.dimensionScores.professionalism}/100
  ✓ Persuasiveness:    ${validationResult.dimensionScores.persuasiveness}/100
  ✓ Evidence Strength: ${validationResult.dimensionScores.evidenceStrength}/100

Issues Found:
  ${criticalIssues.length > 0 ? '⚠️' : '✅'} Critical Issues: ${criticalIssues.length}
  ${validationResult.toneIssues.length > 0 ? '⚠️' : '✅'} Tone Issues: ${validationResult.toneIssues.length}
  ${validationResult.weakResponses.length > 0 ? '⚠️' : '✅'} Weak Responses: ${validationResult.weakResponses.length}
  ${validationResult.completenessCheck.missingComments.length > 0 ? '⚠️' : '✅'} Missing Comments: ${validationResult.completenessCheck.missingComments.length}

Ready for Submission: ${improvementSuggestions.readyForSubmission ? 'YES ✅' : 'NO ⚠️'}

Output Files:
  📄 Rebuttal: .workflow/.scratchpad/rebuttal.md
  📊 Quality Report: .workflow/.scratchpad/quality-report.md
  🔧 Improvements: .workflow/.scratchpad/improvement-suggestions.json

═══════════════════════════════════════════════════════════
`)

// User decision
if (!workflowPreferences.autoYes) {
  const nextAction = AskUserQuestion({
    questions: [{
      question: "What would you like to do next?",
      header: "Next Steps",
      multiSelect: false,
      options: [
        { label: "Submit", description: "Rebuttal is ready for submission" },
        { label: "Revise", description: "Make manual revisions based on suggestions" },
        { label: "Regenerate", description: "Regenerate rebuttal with improvements" },
        { label: "Export", description: "Export to conference submission format" }
      ]
    }]
  })

  if (nextAction["Next Steps"] === "Revise") {
    console.log(`
Please review and edit:
  - .workflow/.scratchpad/rebuttal.md

Then re-run Phase 5 for validation, or proceed to submission.
`)
  } else if (nextAction["Next Steps"] === "Regenerate") {
    console.log(`
To regenerate with improvements:
  1. Review improvement-suggestions.json
  2. Update strategy-matrix.md or evidence-references.json
  3. Re-run Phase 4 (Rebuttal Writing)
`)
  } else if (nextAction["Next Steps"] === "Export") {
    console.log(`
Export functionality:
  - Copy .workflow/.scratchpad/rebuttal.md to conference submission system
  - Or use conference-specific export tools if available
`)
  } else {
    console.log(`
✅ Rebuttal ready for submission!

Final checklist:
  ☐ All co-authors have reviewed the rebuttal
  ☐ All evidence citations are accurate
  ☐ Word count is within conference limits
  ☐ Formatting matches conference requirements
  ☐ Submission deadline noted

Good luck with your submission!
`)
  }
}
```

## Output

- **Variable**: `qualityScore` (overall quality score and dimension scores)
- **Variable**: `improvements` (prioritized improvement suggestions)
- **File**: `.workflow/.scratchpad/quality-report.md` (comprehensive quality report)
- **File**: `.workflow/.scratchpad/improvement-suggestions.json` (structured improvement data)
- **TodoWrite**: Mark Phase 5 completed

## Next Phase

Return to orchestrator with final summary and recommendations.

## Validation Criteria Details

### Completeness (0-100)

**Scoring**:
- 100: All comments addressed with complete responses
- 80-99: All comments addressed, some responses could be more detailed
- 60-79: 1-2 comments missing or incomplete
- 40-59: 3-5 comments missing or incomplete
- 0-39: >5 comments missing or incomplete

**Checks**:
- Every comment ID from review-analysis.json appears in rebuttal
- Each response has substance (not just "We will address this")
- Planned experiments are documented with expected outcomes
- Evidence gaps are acknowledged with mitigation plans

### Professionalism (0-100)

**Scoring**:
- 100: Exemplary academic tone, respectful, clear
- 80-99: Professional with minor wording improvements possible
- 60-79: Generally professional but some defensive/casual language
- 40-59: Multiple tone issues, defensive or dismissive
- 0-39: Unprofessional, argumentative, or inappropriate

**Red Flags**:
- Defensive: "We believe the reviewer is wrong..."
- Dismissive: "This concern is not valid..."
- Casual: "Yeah, we can add that..."
- Argumentative: "The reviewer clearly did not read..."
- Vague: "We will consider this..."

**Green Patterns**:
- Respectful: "We thank the reviewer for this insightful comment..."
- Collaborative: "We agree that... and will incorporate..."
- Confident: "Our experiments demonstrate..."
- Specific: "We will add Figure X showing..."

### Persuasiveness (0-100)

**Scoring**:
- 100: Highly persuasive with strong evidence and clear logic
- 80-99: Persuasive with good evidence integration
- 60-79: Adequate arguments but could be stronger
- 40-59: Weak arguments or insufficient evidence
- 0-39: Unconvincing or lacks supporting evidence

**Factors**:
- Evidence strength and specificity
- Logical flow of arguments
- Addresses concerns directly
- Builds confidence in revisions
- Anticipates follow-up questions

### Evidence Strength (0-100)

**Scoring**:
- 100: All claims supported with specific, verifiable evidence
- 80-99: Strong evidence with minor gaps
- 60-79: Adequate evidence but some vague references
- 40-59: Weak evidence or many vague references
- 0-39: Little to no evidence provided

**Requirements**:
- Specific citations: "Figure 3", "Table 2", "Section 4.2", "Page 7"
- Quantitative support: "accuracy improved by 5%", "p < 0.01"
- Verifiable claims: Can be checked in paper or planned experiments
- No vague references: "as shown in our experiments" (which experiments?)
