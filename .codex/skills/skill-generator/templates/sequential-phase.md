
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。


# Sequential Phase Template

Template for Phase files in Sequential execution mode.

## Purpose

Generate Phase files for Sequential execution mode, defining fixed-order execution steps.

## Usage Context

| Phase | Usage |
|-------|-------|
| Phase 3 (Phase Generation) | Generated when `config.execution_mode === 'sequential'` |
| Generation Trigger | Generate one phase file for each `config.sequential_config.phases` |
| Output Location | `.claude/skills/{skill-name}/phases/{phase-id}.md` |

---

## Important Notes

> **Phase 0 is mandatory prerequisite**: Before implementing any Phase (1, 2, 3...), Phase 0 specification review must be completed first.
>
> When generating Sequential Phase, ensure:
> 1. Phase 0 specification review step is included in SKILL.md
> 2. Each Phase file references related specification documents
> 3. Execution flow clearly marks Phase 0 as non-skippable prerequisite

## Template Structure

```markdown
# Phase {{phase_number}}: {{phase_name}}

{{phase_description}}

## Objective

{{objectives}}

## Input

- Dependency: `{{input_dependency}}`
- Config: `{workDir}/skill-config.json`

## Scripts

\`\`\`yaml
# Declare scripts used in this phase (optional)
# - script-id        # Corresponds to scripts/script-id.py or .sh
\`\`\`

## Execution Steps

### Step 1: {{step_1_name}}

\`\`\`javascript
{{step_1_code}}
\`\`\`

### Step 2: {{step_2_name}}

\`\`\`javascript
{{step_2_code}}
\`\`\`

### Step 3: Execute Script (Optional)

\`\`\`javascript
// Script execution example
// const result = await ExecuteScript('script-id', { input_path: `${workDir}/data.json` });
// if (!result.success) throw new Error(result.stderr);
// console.log(result.outputs.output_file);
\`\`\`

## Output

- **File**: `{{output_file}}`
- **Format**: {{output_format}}

## Quality Checklist

{{quality_checklist}}

## Completion Status

Return one of: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT with structured reason.
See [Completion Status Protocol](./../_shared/SKILL-DESIGN-SPEC.md#13) for output format.

## Next Phase

{{next_phase_link}}
```

## Variable Descriptions

| Variable | Description |
|----------|-------------|
| `{{phase_number}}` | Phase number (1, 2, 3...) |
| `{{phase_name}}` | Phase name |
| `{{phase_description}}` | One-line description |
| `{{objectives}}` | List of objectives |
| `{{input_dependency}}` | Input dependency file |
| `{{step_N_name}}` | Step name |
| `{{step_N_code}}` | Step code |
| `{{output_file}}` | Output filename |
| `{{output_format}}` | Output format |
| `{{quality_checklist}}` | Quality checklist items |
| `{{next_phase_link}}` | Next phase link |

## Script Invocation Guide

### Directory Convention

```
scripts/
├── process-data.py    # id: process-data, runtime: python
├── validate.sh        # id: validate, runtime: bash
└── transform.js       # id: transform, runtime: node
```

- **Name is ID**: Filename (without extension) = script ID
- **Extension is runtime**: `.py` → python, `.sh` → bash, `.js` → node

### Invocation Syntax

```javascript
// Single-line invocation
const result = await ExecuteScript('script-id', { key: value });

// Check result
if (!result.success) throw new Error(result.stderr);

// Get output
const { output_file } = result.outputs;
```

### Return Format

```typescript
interface ScriptResult {
  success: boolean;    // exit code === 0
  stdout: string;      // Standard output
  stderr: string;      // Standard error
  outputs: object;     // JSON output parsed from stdout
}
```

## Phase Type Templates

### 1. Collection Phase

```markdown
# Phase 1: Requirements Collection

Collect user requirements and project configuration.

## Objective

- Collect user input
- Auto-detect project information
- Generate configuration file

## Execution Steps

### Step 1: User Interaction

\`\`\`javascript
const userInput = await request_user_input({
  questions: [
    {
      question: "Please select...",
      header: "Option",
      multiSelect: false,
      options: [
        { label: "Option A", description: "..." },
        { label: "Option B", description: "..." }
      ]
    }
  ]
});
\`\`\`

### Step 2: Auto-detection

\`\`\`javascript
// Detect project information
const packageJson = JSON.parse(Read('package.json'));
const projectName = packageJson.name;
\`\`\`

### Step 3: Generate Configuration

\`\`\`javascript
const config = {
  name: projectName,
  userChoice: userInput["Option"],
  // ...
};

Write(\`${workDir}/config.json\`, JSON.stringify(config, null, 2));
\`\`\`

## Output

- **File**: \`config.json\`
- **Format**: JSON
```

### 2. Analysis Phase

```markdown
# Phase 2: Deep Analysis

Analyze code structure in depth.

## Objective

- Scan code files
- Extract key information
- Generate analysis report

## Execution Steps

### Step 1: File Scanning

\`\`\`javascript
const files = Glob('src/**/*.ts');
\`\`\`

### Step 2: Content Analysis

\`\`\`javascript
const analysisResults = [];
for (const file of files) {
  const content = Read(file);
  // Analysis logic
  analysisResults.push({ file, /* analysis results */ });
}
\`\`\`

### Step 3: Generate Report

\`\`\`javascript
Write(\`${workDir}/analysis.json\`, JSON.stringify(analysisResults, null, 2));
\`\`\`

## Output

- **File**: \`analysis.json\`
- **Format**: JSON
```

### 3. Parallel Phase

```markdown
# Phase 3: Parallel Processing

Process multiple subtasks in parallel.

## Objective

- Launch multiple agents for parallel execution
- Collect results from each agent
- Merge outputs

## Execution Steps

### Step 1: Prepare Tasks

\`\`\`javascript
const tasks = [
  { id: 'task-a', prompt: '...' },
  { id: 'task-b', prompt: '...' },
  { id: 'task-c', prompt: '...' }
];
\`\`\`

### Step 2: Parallel Execution

\`\`\`javascript
const results = await Promise.all(
  tasks.map(task =>
    spawn_agent({ task_name: "<task_name>", message: "<message>", agent_type: "universal_executor" })
  )
);
\`\`\`

### Step 3: Merge Results

\`\`\`javascript
const merged = results.map((r, i) => ({
  task_id: tasks[i].id,
  result: JSON.parse(r)
}));

Write(\`${workDir}/parallel-results.json\`, JSON.stringify(merged, null, 2));
\`\`\`

## Output

- **File**: \`parallel-results.json\`
- **Format**: JSON
```

### 4. Assembly Phase

```markdown
# Phase 4: Document Assembly

Assemble final output documents.

## Objective

- Read outputs from each phase
- Merge content
- Generate final document

## Execution Steps

### Step 1: Read Outputs

\`\`\`javascript
const config = JSON.parse(Read(\`${workDir}/config.json\`));
const analysis = JSON.parse(Read(\`${workDir}/analysis.json\`));
const sections = Glob(\`${workDir}/sections/*.md\`).map(f => Read(f));
\`\`\`

### Step 2: Assemble Content

\`\`\`javascript
const document = \`
# \${config.name}

## Overview
\${config.description}

## Detailed Content
\${sections.join('\\n\\n')}
\`;
\`\`\`

### Step 3: Write File

\`\`\`javascript
Write(\`${workDir}/\${config.name}-output.md\`, document);
\`\`\`

## Output

- **File**: \`{name}-output.md\`
- **Format**: Markdown
```

### 5. Validation Phase

```markdown
# Phase 5: Validation

Verify output quality.

## Objective

- Check output completeness
- Verify content quality
- Generate validation report

## Execution Steps

### Step 1: Completeness Check

\`\`\`javascript
const outputFile = \`${workDir}/\${config.name}-output.md\`;
const content = Read(outputFile);
const completeness = {
  hasTitle: content.includes('# '),
  hasSections: content.match(/## /g)?.length >= 3,
  hasContent: content.length > 500
};
\`\`\`

### Step 2: Quality Assessment

\`\`\`javascript
const quality = {
  completeness: Object.values(completeness).filter(v => v).length / 3 * 100,
  // Other dimensions...
};
\`\`\`

### Step 3: Generate Report

\`\`\`javascript
const report = {
  status: quality.completeness >= 80 ? 'PASS' : 'REVIEW',
  scores: quality,
  issues: []
};

Write(\`${workDir}/validation-report.json\`, JSON.stringify(report, null, 2));
\`\`\`

## Output

- **File**: \`validation-report.json\`
- **Format**: JSON
```

## Generation Function

```javascript
function generateSequentialPhase(phaseConfig, index, phases, skillConfig) {
  const prevPhase = index > 0 ? phases[index - 1] : null;
  const nextPhase = index < phases.length - 1 ? phases[index + 1] : null;

  return `# Phase ${index + 1}: ${phaseConfig.name}

${phaseConfig.description || `Execute ${phaseConfig.name}`}

## Objective

- ${phaseConfig.objectives?.join('\n- ') || 'TODO: Define objectives'}

## Input

- Dependency: \`${prevPhase ? prevPhase.output : 'user input'}\`
- Config: \`{workDir}/skill-config.json\`

## Execution Steps

### Step 1: Preparation

\`\`\`javascript
${prevPhase ?
  `const prevOutput = JSON.parse(Read(\`${workDir}/${prevPhase.output}\`));` :
  '// First phase, start from configuration'}
\`\`\`

### Step 2: Processing

\`\`\`javascript
// TODO: Implement core logic
\`\`\`

### Step 3: Output

\`\`\`javascript
Write(\`${workDir}/${phaseConfig.output}\`, JSON.stringify(result, null, 2));
\`\`\`

## Output

- **File**: \`${phaseConfig.output}\`
- **Format**: ${phaseConfig.output.endsWith('.json') ? 'JSON' : 'Markdown'}

## Quality Checklist

- [ ] Input validation passed
- [ ] Core logic executed successfully
- [ ] Output format correct

## Completion Status

Return one of: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT with structured reason.
See [Completion Status Protocol](./../_shared/SKILL-DESIGN-SPEC.md#13) for output format.

${nextPhase ?
  `## Next Phase\n\n→ [Phase ${index + 2}: ${nextPhase.name}](${nextPhase.id}.md)` :
  '## Completion\n\nThis is the final phase.'}
`;
}
```
