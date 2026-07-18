# Phase 2: Optimize

Apply simplification rules from analysisResult to produce optimized content. Write result to disk.

## Objective

- Execute all optimization operations in priority order (delete → merge → simplify → format)
- Preserve every functional element identified in Phase 1 inventory
- Fix pseudo-code format issues
- Write optimized content back to target file

## Pre-Step: Load Context

Run `maestro spec load --category validation` for verification rules and acceptance criteria to validate optimization preserves functional integrity.

## Execution

### Step 2.1: Apply Operations in Order

Process `analysisResult.optimizationPlan.operations` sorted by priority:

**Priority 1 — Delete** (safest, highest impact):

| Target Pattern | Action |
|----------------|--------|
| Duplicate Overview section | Remove `## Overview` if it restates frontmatter `description` |
| ASCII flowchart | Remove if Phase Summary table or implementation structure covers same info |
| "When to use" / "Use Cases" section | Remove entirely |
| Best Practices section | Remove if content duplicates Core Rules |
| Duplicate folder structure | Remove ASCII tree if Output Artifacts table covers same info |
| Redundant "Next Phase" prose | Remove when TodoWrite handles flow |
| Standalone example sections | Remove if logic already demonstrated inline |
| Descriptive code blocks | Remove if content covered by surrounding prose or tables |

**Priority 2 — Merge** (structural optimization):

| Target Pattern | Action |
|----------------|--------|
| Multiple similar AskUserQuestion blocks | Extract shared function with mode parameter |
| Repeated Option A/B/C routing | Unify into single dispatch |
| Sequential single-line bash commands | Combine into single code block |
| TodoWrite full blocks x N | Template ONCE, subsequent as one-line comment |
| Duplicate error handling across sections | Merge into single `## Error Handling` table |
| Equivalent template variants | Single/multi templates → one template with `// For multi: add Perspective` comment |
| Multiple output artifact tables | Merge into single combined table with Phase column |

**Priority 3 — Simplify** (compress descriptive content):

| Target Pattern | Action |
|----------------|--------|
| Verbose inline comments | Reduce to single-line; remove obvious restatements |
| Display-format code blocks | Convert `console.log` with template literal to prose describing output format |
| Wordy section introductions | Remove preamble sentences |
| Exploration/agent prompt padding | Remove generic advice |
| Success Criteria lists > 7 items | Trim to essential 5-7, remove obvious/generic |

**Priority 4 — Format fixes** (pseudo-code quality):

| Target Pattern | Action |
|----------------|--------|
| Nested backtick template literals | Convert code block to prose description, or use 4-backtick fence |
| Hardcoded option lists | Replace with dynamic generation: describe source of options + generation logic |
| Workflow handoff without execution steps | Add concrete steps referencing the target Maestro CLI interface (e.g., `maestro issue create ... --json`) |
| Unclosed brackets | Fix bracket matching |
| Undefined variable references | Add declaration or link to source |

### Step 2.2: Language Unification (if applicable)

```javascript
if (analysisResult.redundancyMap.languageUnify.length > 0) {
  // Detect majority language, unify non-functional text
  // DO NOT change: variable names, function names, schema fields, error messages in code
}
```

### Step 2.3: Write Optimized Content

```javascript
Write(targetFile, optimizedContent)
const optimizedLineCount = optimizedContent.split('\n').length
const reduction = originalLineCount - optimizedLineCount
const reductionPct = Math.round(reduction / originalLineCount * 100)
```

### Step 2.4: Preserve Optimization Record

```javascript
const optimizationRecord = {
  deletedSections: [],    // section names removed
  mergedGroups: [],       // { from: [sections], to: description }
  simplifiedAreas: [],    // { section, strategy }
  formatFixes: [],        // { line, type, fix }
  linesBefore: originalLineCount,
  linesAfter: optimizedLineCount
}
```

## Key Rules

1. **Never modify functional code blocks** — only compress comments/whitespace within them
2. **Descriptive code blocks may be deleted** if their content is covered by prose or tables
3. **Never change function signatures, variable names, or schema fields**
4. **Merge preserves all branches** — unified function must handle all original cases
5. **When uncertain, keep original** — conservative approach prevents functional loss
6. **Format fixes must not alter semantics** — only presentation changes

## Output

- **File**: Target file overwritten with optimized content
- **Variable**: `optimizationRecord` (changes log for Phase 3)
- **TodoWrite**: Mark Phase 2 completed, Phase 3 in_progress
