
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。
# Phase 1: Functional Analysis

Read target file, extract functional inventory with code block classification, identify redundancy, validate pseudo-code format, and produce optimization plan.

## Objective

- Build quantitative functional inventory with code block classification (baseline for Phase 3)
- Identify redundancy categories with specific line ranges
- Detect pseudo-code format issues
- Produce optimization plan with estimated line savings

## Execution

### Step 1.1: Read & Measure Target

```javascript
const originalContent = Read(targetFile)
const lines = originalContent.split('\n')
const originalLineCount = lines.length
```

### Step 1.2: Extract Functional Inventory

Count and catalog every functional element. These counts are the **baseline** for Phase 3 verification.

```javascript
const inventory = {
  // Code structures — with role classification
  codeBlocks: [],        // { startLine, endLine, language, purpose, role: 'functional'|'descriptive' }
  agentCalls: [],        // { line, agentType, description, mergeGroup?: string }
  dataStructures: [],    // { line, name, type: 'object'|'array'|'schema' }

  // Logic elements
  routingBranches: [],   // { line, condition, outcomes[] }
  errorHandlers: [],     // { line, errorType, resolution }
  conditionalLogic: [],  // { line, condition, trueAction, falseAction }

  // Interface elements
  askUserQuestions: [],   // { line, questionCount, headers[], optionType: 'static'|'dynamic' }
  inputModes: [],        // { line, mode, description }
  outputArtifacts: [],   // { line, artifact, format }

  // Structural elements
  todoWriteBlocks: [],   // { line, phaseCount }
  phaseHandoffs: [],     // { line, fromPhase, toPhase }
  skillInvocations: [],  // { line, skillName, hasExecutionSteps: boolean }

  // Reference elements
  tables: [],            // { startLine, endLine, columns }
  schemas: [],           // { line, schemaName, fields[] }

  // Format issues
  formatIssues: [],      // { line, type, description, severity: 'error'|'warning' }

  // Totals (computed)
  counts: {}
}
```

**Extraction rules**:
- **Code blocks**: Match ` ```language ... ``` ` pairs, record start/end/language/first-line-as-purpose
- **Agent calls**: Match `spawn_agent(`, `agent_type:`, record type and message summary
- **Data structures**: Match `const xxx = {`, `const xxx = [`, JSON schema objects
- **Routing branches**: Match `if/else`, `switch/case`, ternary `? :` with meaningful branching
- **Error handlers**: Match `catch`, error table rows `| Error |`, fallback patterns
- **request_user_input**: Match `request_user_input({`, count questions array length
- **Input modes**: Match `Mode 1/2/3`, `--flag`, argument parsing
- **Output artifacts**: Match `Write(`, `Output:`, file path patterns in comments
- **update_plan**: Match `update_plan({`, count todo items
- **Phase handoffs**: Match `Read("phases/`, `Skill(`, `proceed_to_next_phase`
- **Tables**: Match `| header |` markdown table blocks
- **Schemas**: Match schema references, JSON structure definitions

### Step 1.2.1: Code Block Role Classification

For each code block, determine its role:

| Role | Criteria | Examples |
|------|----------|---------|
| `functional` | Contains algorithm logic, routing branches, conditional code, agent calls, schema definitions, data processing, request_user_input, Skill invocations | `if/else`, `spawn_agent({ task_name: "<task_name>", message: "<message>" })`, `const schema = {...}`, `Bash({...})` |
| `descriptive` | Contains ASCII art, usage examples, display templates, illustrative good/bad comparisons, folder structure trees | `┌───┐`, `# Example usage`, `❌ Bad / ✅ Good`, `├── file.ts` |

**Classification rules**:
- If block contains ANY of: `spawn_agent(`, `Bash(`, `request_user_input(`, `if (`, `switch`, `Skill(`, `Write(`, `Read(`, `update_plan(` → `functional`
- If block language is `bash` and content is only example invocations (no logic) → `descriptive`
- If block has no language tag and contains only ASCII box-drawing characters → `descriptive`
- If block is labeled as "Example" in surrounding markdown heading → `descriptive`
- **Default**: `functional` (conservative)

### Step 1.2.2: Pseudo-Code Format Validation

Scan all `functional` code blocks for format issues:

| Check | Detection | Severity |
|-------|-----------|----------|
| **Nested backticks** | Template literal `` ` `` inside ` ```javascript ``` ` code fence | warning |
| **Unclosed brackets** | Unmatched `{`, `(`, `[` in code block | error |
| **Undefined references** | `${variable}` where variable is never declared in the block or prior blocks | warning |
| **Inconsistent indentation** | Mixed tabs/spaces or inconsistent nesting depth | warning |
| **Dead code patterns** | Commented-out code blocks (`// if (`, `/* ... */` spanning 5+ lines) | warning |
| **Missing return/output** | Function-like block with no return, Write, or console.log | warning |

```javascript
inventory.formatIssues = validatePseudoCode(inventory.codeBlocks.filter(b => b.role === 'functional'))
```

### Step 1.2.3: Compute Totals

```javascript
inventory.counts = {
  codeBlocks: inventory.codeBlocks.length,
  functionalCodeBlocks: inventory.codeBlocks.filter(b => b.role === 'functional').length,
  descriptiveCodeBlocks: inventory.codeBlocks.filter(b => b.role === 'descriptive').length,
  agentCalls: inventory.agentCalls.length,
  dataStructures: inventory.dataStructures.length,
  routingBranches: inventory.routingBranches.length,
  errorHandlers: inventory.errorHandlers.length,
  conditionalLogic: inventory.conditionalLogic.length,
  askUserQuestions: inventory.askUserQuestions.length,
  inputModes: inventory.inputModes.length,
  outputArtifacts: inventory.outputArtifacts.length,
  todoWriteBlocks: inventory.todoWriteBlocks.length,
  phaseHandoffs: inventory.phaseHandoffs.length,
  skillInvocations: inventory.skillInvocations.length,
  tables: inventory.tables.length,
  schemas: inventory.schemas.length,
  formatIssues: inventory.formatIssues.length
}
```

### Step 1.3: Identify Redundancy Categories

Scan for each category, record specific line ranges:

```javascript
const redundancyMap = {
  deletable: [],       // { category, startLine, endLine, reason, estimatedSave }
  simplifiable: [],    // { category, startLine, endLine, strategy, estimatedSave }
  mergeable: [],       // { items: [{startLine, endLine}], mergeStrategy, estimatedSave }
  formatFixes: [],     // { line, type, fix }
  languageUnify: []    // { line, currentLang, targetLang }
}
```

**Deletable** (remove entirely, no functional loss):

| Pattern | Detection |
|---------|-----------|
| Duplicate Overview | `## Overview` that restates frontmatter description |
| ASCII flowchart | Flowchart that duplicates Phase Summary table or implementation structure |
| "When to use" section | Usage guidance not needed for execution |
| Best Practices section | Advisory content duplicating Core Rules |
| Duplicate examples | Code examples that repeat logic shown elsewhere |
| Folder structure duplicate | ASCII tree repeating Output Artifacts table |
| "Next Phase" paragraphs | Prose between phases when update_plan handles flow |
| Descriptive code blocks | Code blocks classified as `descriptive` whose content is covered by surrounding prose or tables |

**Simplifiable** (compress, preserve meaning):

| Pattern | Strategy |
|---------|----------|
| Verbose comments in code blocks | Reduce to single-line; keep only non-obvious logic comments |
| Multi-line console.log | Compress to single template literal |
| Wordy section intros | Remove "In this phase, we will..." preamble |
| Exploration prompt bloat | Trim to essential instructions, remove generic advice |
| Display-format code blocks | Convert code blocks that only define output format (console.log with template) to prose description |

**Mergeable** (combine related structures):

| Pattern | Strategy |
|---------|----------|
| Multiple similar request_user_input calls | Extract shared function with mode parameter |
| Repeated Option routing | Unify into single dispatch |
| Sequential single-line operations | Combine into one code block |
| update_plan full blocks x N | Template once + delta comments |
| Duplicate error handling tables | Merge into single table |
| Equivalent template variants | Single/multi-perspective templates → one template with variant comment |
| Multiple output artifact tables | Merge into single combined table |

**Format fixes** (pseudo-code quality):

| Pattern | Fix |
|---------|-----|
| Nested backtick template literals | Convert surrounding code block to prose description, or use 4-backtick fence |
| Hardcoded option lists | Add comment: `// Generate dynamically from {context source}` |
| Workflow handoff without execution steps | Add execution steps referencing the target command's actual interface |
| Unclosed brackets | Fix bracket matching |

**Language unification**:
- Detect mixed Chinese/English in functional comments
- Recommend consistent language (match majority)

### Step 1.4: Build Optimization Plan

```javascript
const optimizationPlan = {
  targetFile,
  originalLineCount,
  estimatedReduction: redundancyMap.deletable.reduce((s, d) => s + d.estimatedSave, 0)
    + redundancyMap.simplifiable.reduce((s, d) => s + d.estimatedSave, 0)
    + redundancyMap.mergeable.reduce((s, d) => s + d.estimatedSave, 0),
  categories: {
    deletable: { count: redundancyMap.deletable.length, totalLines: '...' },
    simplifiable: { count: redundancyMap.simplifiable.length, totalLines: '...' },
    mergeable: { count: redundancyMap.mergeable.length, totalLines: '...' },
    formatFixes: { count: redundancyMap.formatFixes.length },
    languageUnify: { count: redundancyMap.languageUnify.length }
  },
  // Ordered: delete → merge → simplify → format
  operations: [
    ...redundancyMap.deletable.map(d => ({ type: 'delete', ...d, priority: 1 })),
    ...redundancyMap.mergeable.map(m => ({ type: 'merge', ...m, priority: 2 })),
    ...redundancyMap.simplifiable.map(s => ({ type: 'simplify', ...s, priority: 3 })),
    ...redundancyMap.formatFixes.map(f => ({ type: 'format', ...f, priority: 4 }))
  ]
}
```

Display plan summary: category counts, estimated reduction percentage, sections NOT changed (functional core).

## Output

- **Variable**: `analysisResult = { inventory, redundancyMap, optimizationPlan, originalContent, originalLineCount }`
- **update_plan**: Mark Phase 1 completed, Phase 2 in_progress
