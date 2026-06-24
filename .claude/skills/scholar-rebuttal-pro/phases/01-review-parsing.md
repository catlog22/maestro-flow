# Phase 1: Review Parsing & Classification

Parse reviewer comments, classify by type (Major/Minor/Typo/Misunderstanding), extract key concerns using Agy CLI semantic analysis.

## Objective

- Parse reviewer comments structure from file or inline text
- Classify comments using Agy CLI semantic analysis
- Extract sentiment and key concerns for each comment
- Generate structured review-analysis.json

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

### Step 1.1: Load Review Comments

```javascript
// Input from orchestrator
const reviewCommentsPath = <from input>
const conferenceType = workflowPreferences.conferenceType

// Read review comments with error handling
let reviewText
try {
  if (reviewCommentsPath.endsWith('.txt') || reviewCommentsPath.endsWith('.md')) {
    reviewText = Read(reviewCommentsPath)
  } else if (reviewCommentsPath.endsWith('.pdf')) {
    // Convert PDF to text first
    const convertResult = Bash({ 
      command: `ccws pdf-convert "${reviewCommentsPath}"`, 
      description: "Convert PDF to markdown" 
    })
    if (convertResult.exitCode !== 0) {
      throw new Error(`PDF conversion failed: ${convertResult.stderr}`)
    }
    reviewText = Read(reviewCommentsPath.replace('.pdf', '.md'))
  } else {
    // Inline text
    reviewText = reviewCommentsPath
  }
} catch (error) {
  console.error(`[Phase 1] Failed to load review comments:`, error.message);
  TodoWrite([
    {"content": "Phase 1: Review Parsing", "status": "failed"},
    {"content": `  Error: ${error.message}`, "status": "failed"}
  ]);
  throw error;
}
```

### Step 1.2: Parse and Classify with Agy CLI

```bash
ccw cli -p "PURPOSE: Parse and classify reviewer comments by type and severity

TASK:
• Parse comment structure (identify individual comments, reviewer IDs)
• Classify each comment: Major/Minor/Typo/Misunderstanding
• Extract key concerns and sentiment for each comment
• Assign severity: Critical/High/Medium/Low

MODE: analysis
CONTEXT: @<review-file>
EXPECTED: JSON with {
  'comments': [
    {
      'id': 'R1-C1',
      'reviewerId': 'Reviewer 1',
      'text': '...',
      'category': 'Major|Minor|Typo|Misunderstanding',
      'severity': 'Critical|High|Medium|Low',
      'sentiment': 'negative|neutral|positive',
      'keyConcerns': ['concern1', 'concern2']
    }
  ],
  'summary': {
    'totalComments': N,
    'majorCount': N,
    'minorCount': N,
    'typoCount': N,
    'misunderstandingCount': N
  }
}" --tool agy --mode analysis --rule analysis-analyze-technical-document
```

### Step 1.3: Generate Classification Report

```javascript
// Parse CLI output with validation
const cliResult = <from CLI execution>
const parseResult = parseCLIOutput(
  cliResult,
  ['comments', 'summary'],
  'Phase 1'
);

let classificationResult;
if (!parseResult.success) {
  // Fallback: use minimal structure
  console.error("CLI parsing failed, using fallback structure");
  classificationResult = {
    comments: [{
      id: 'ERROR-1',
      reviewerId: 'Unknown',
      text: 'CLI parsing failed - manual review required',
      category: 'Major',
      severity: 'Critical',
      sentiment: 'neutral',
      keyConcerns: [`CLI parsing error: ${parseResult.error}`]
    }],
    summary: {
      totalComments: 1,
      majorCount: 1,
      minorCount: 0,
      typoCount: 0,
      misunderstandingCount: 0
    }
  };
} else {
  classificationResult = parseResult.data;
}

// Write review-analysis.json with error handling
try {
  Write(".workflow/.scratchpad/review-analysis.json", JSON.stringify(classificationResult, null, 2))
} catch (error) {
  console.error(`[Phase 1] Failed to write review-analysis.json:`, error.message);
  TodoWrite([
    {"content": "Phase 1: Review Parsing", "status": "failed"},
    {"content": `  Error writing output: ${error.message}`, "status": "failed"}
  ]);
  throw error;
}

// Generate human-readable classification report
let report = `# Review Comment Classification

Generated: ${new Date().toISOString()}

## Summary

- Total Comments: ${classificationResult.summary.totalComments}
- Major Issues: ${classificationResult.summary.majorCount}
- Minor Issues: ${classificationResult.summary.minorCount}
- Misunderstandings: ${classificationResult.summary.misunderstandingCount}
- Typos: ${classificationResult.summary.typoCount}

## Detailed Classification

`

for (const comment of classificationResult.comments) {
  report += `### ${comment.id} - ${comment.category} (${comment.severity})

**Reviewer**: ${comment.reviewerId}

**Comment**:
> ${comment.text}

**Sentiment**: ${comment.sentiment}

**Key Concerns**: ${comment.keyConcerns.join(', ')}

---

`
}

try {
  Write(".workflow/.scratchpad/comment-classification.md", report)
} catch (error) {
  console.error(`[Phase 1] Failed to write comment-classification.md:`, error.message);
  // Non-critical, continue
}
```

## Output

- **Variable**: `reviewAnalysis` (parsed classification result)
- **Variable**: `commentCategories` (summary of categories)
- **File**: `.workflow/.scratchpad/review-analysis.json`
- **File**: `.workflow/.scratchpad/comment-classification.md`
- **TodoWrite**: Mark Phase 1 completed, Phase 2 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 2: Multi-Perspective Discussion](02-multi-perspective-discussion.md).
