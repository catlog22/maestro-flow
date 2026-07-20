
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 3: Integrity Check

Re-extract functional inventory from optimized file, compare against Phase 1 baseline, validate pseudo-code format. Report PASS/FAIL with detailed delta.

## Objective

- Re-run the same inventory extraction on optimized content
- Compare counts using role-aware classification (functional vs descriptive)
- Validate pseudo-code format issues are resolved
- Report check result with actionable details
- Revert if critical functional elements are missing

## Execution

### Step 3.1: Re-Extract Inventory from Optimized File

```javascript
const optimizedContent = Read(targetFile)
const optimizedLineCount = optimizedContent.split('\n').length

// Use SAME extraction logic as Phase 1 (including role classification)
const afterInventory = extractFunctionalInventory(optimizedContent)
```

### Step 3.2: Compare Inventories (Role-Aware)

```javascript
const beforeCounts = analysisResult.inventory.counts
const afterCounts = afterInventory.counts

const delta = {}
let hasCriticalLoss = false
let hasWarning = false

// CRITICAL: Functional elements that MUST NOT decrease
const CRITICAL = ['functionalCodeBlocks', 'dataStructures', 'routingBranches',
                  'errorHandlers', 'conditionalLogic', 'askUserQuestions',
                  'inputModes', 'outputArtifacts', 'skillInvocations']

// MERGE_AWARE: May decrease due to valid merge operations — verify coverage
const MERGE_AWARE = ['agentCalls', 'codeBlocks']

// EXPECTED_DECREASE: May decrease from merge/consolidation
const EXPECTED_DECREASE = ['descriptiveCodeBlocks', 'todoWriteBlocks',
                           'phaseHandoffs', 'tables', 'schemas']

for (const [key, before] of Object.entries(beforeCounts)) {
  const after = afterCounts[key] || 0
  const diff = after - before
  let category, status

  if (CRITICAL.includes(key)) {
    category = 'critical'
    status = diff < 0 ? 'FAIL' : 'OK'
    if (diff < 0) hasCriticalLoss = true
  } else if (MERGE_AWARE.includes(key)) {
    category = 'merge_aware'
    // Decrease is WARN (needs justification), not FAIL
    status = diff < 0 ? 'WARN' : 'OK'
    if (diff < 0) hasWarning = true
  } else {
    category = 'expected'
    status = 'OK'  // Descriptive decreases are expected
  }

  delta[key] = { before, after, diff, category, status }
}
```

### Step 3.3: Deep Verification

**For CRITICAL categories with decrease** — identify exactly what was lost:

```javascript
if (hasCriticalLoss) {
  const lostElements = {}
  for (const [key, d] of Object.entries(delta)) {
    if (d.status === 'FAIL') {
      const beforeItems = analysisResult.inventory[key]
      const afterItems = afterInventory[key]
      lostElements[key] = beforeItems.filter(beforeItem =>
        !afterItems.some(afterItem => matchesElement(beforeItem, afterItem))
      )
    }
  }
}
```

**For MERGE_AWARE categories with decrease** — verify merged coverage:

```javascript
if (hasWarning) {
  for (const [key, d] of Object.entries(delta)) {
    if (d.category === 'merge_aware' && d.diff < 0) {
      // Check if merged template covers all original variants
      // e.g., single Agent template with "// For multi: add Perspective" covers both
      const beforeItems = analysisResult.inventory[key]
      const afterItems = afterInventory[key]
      const unmatched = beforeItems.filter(beforeItem =>
        !afterItems.some(afterItem => matchesElement(beforeItem, afterItem))
      )
      if (unmatched.length > 0) {
        // Check if unmatched items are covered by merge comments in remaining items
        const mergeComments = afterItems.flatMap(item => extractMergeComments(item))
        const trulyLost = unmatched.filter(item =>
          !mergeComments.some(comment => coversElement(comment, item))
        )
        if (trulyLost.length > 0) {
          delta[key].status = 'FAIL'
          hasCriticalLoss = true
          delta[key].trulyLost = trulyLost
        }
        // else: merge-covered, WARN is correct
      }
    }
  }
}
```

### Step 3.4: Pseudo-Code Format Validation

```javascript
const afterFormatIssues = validatePseudoCode(afterInventory.codeBlocks.filter(b => b.role === 'functional'))
const beforeFormatCount = analysisResult.inventory.formatIssues.length
const afterFormatCount = afterFormatIssues.length

const formatDelta = {
  before: beforeFormatCount,
  after: afterFormatCount,
  resolved: beforeFormatCount - afterFormatCount,
  newIssues: afterFormatIssues.filter(issue =>
    !analysisResult.inventory.formatIssues.some(orig => orig.line === issue.line && orig.type === issue.type)
  )
}

// New format issues introduced by optimization = FAIL
if (formatDelta.newIssues.length > 0) {
  hasCriticalLoss = true
}
```

**Pseudo-code validation checks**:

| Check | Detection | Action on Failure |
|-------|-----------|-------------------|
| Bracket matching | Count `{([` vs `})]` per code block | FAIL — fix or revert |
| Variable consistency | `${var}` used but never declared | WARNING — note in report |
| Structural completeness | Function body has entry but no exit (return/Write/output) | WARNING |
| Nested backtick resolution | Backtick template literals inside code fences | WARNING if pre-existing, FAIL if newly introduced |
| Schema field preservation | Schema fields in after match before | FAIL if fields lost |

### Step 3.5: Generate Check Report

```javascript
const status = hasCriticalLoss ? 'FAIL' : (hasWarning ? 'WARN' : 'PASS')

const checkReport = {
  status,
  linesBefore: analysisResult.originalLineCount,
  linesAfter: optimizedLineCount,
  reduction: `${analysisResult.originalLineCount - optimizedLineCount} lines (-${Math.round((analysisResult.originalLineCount - optimizedLineCount) / analysisResult.originalLineCount * 100)}%)`,
  delta,
  formatDelta,
  lostElements: hasCriticalLoss ? lostElements : null
}

// Display report table
// | Category | Before | After | Delta | Status |
// Show all categories, highlight FAIL/WARN rows
// Show format issues summary if any
```

### Step 3.6: Act on Result

```javascript
if (status === 'FAIL') {
  Write(targetFile, analysisResult.originalContent)
  // Report: "Critical elements lost / new format issues introduced. Reverted."
}

if (status === 'WARN') {
  // Report: "Decreases from merge/descriptive removal. Verify coverage."
  // Show merge justifications for MERGE_AWARE categories
}

if (status === 'PASS') {
  // Report: "All functional elements preserved. Optimization successful."
}
```

## Element Matching Rules

How `matchesElement()` determines if a before-element exists in after-inventory:

| Element Type | Match Criteria |
|-------------|---------------|
| codeBlocks | Same language + first meaningful line (ignore whitespace/comments) |
| agentCalls | Same agentType + similar prompt keywords (>60% overlap) |
| dataStructures | Same variable name OR same field set |
| routingBranches | Same condition expression (normalized) |
| errorHandlers | Same error type/pattern |
| conditionalLogic | Same condition + same outcome set |
| askUserQuestions | Same question count + similar option labels |
| inputModes | Same mode identifier |
| outputArtifacts | Same file path pattern or artifact name |
| skillInvocations | Same skill name |
| todoWriteBlocks | Same phase names (order-independent) |
| phaseHandoffs | Same target phase reference |
| tables | Same column headers |
| schemas | Same schema name or field set |

**Merge coverage check** (`coversElement()`):
- Agent calls: Merged template contains `// For multi:` or `// Multi-perspective:` comment referencing the missing variant
- Code blocks: Merged block contains comment noting the alternative was folded in

## Completion

```javascript
update_plan({ todos: [
  { content: `Phase 1: Analysis [${Object.keys(analysisResult.inventory.counts).length} categories]`, status: "completed" },
  { content: `Phase 2: Optimize [${checkReport.reduction}]`, status: "completed" },
  { content: `Phase 3: Check [${checkReport.status}] | Format: ${formatDelta.resolved} resolved, ${formatDelta.newIssues.length} new`, status: "completed" }
]})
```
