

# LLM Action Template

LLM action template for integrating LLM call capabilities into a Skill.

## Purpose

Generate LLM actions for a Skill, call Agy/Qwen/Codex through maestro delegate unified interface for analysis or generation.

## Usage Context

| Phase | Usage |
|-------|-------|
| Optional | Use when Skill requires LLM capabilities |
| Generation Trigger | User selects to add llm action type |
| Tools | agy, qwen, codex (supports fallback chain) |

---

## Configuration Structure

```typescript
interface LLMActionConfig {
  id: string;                    // "llm-analyze", "llm-generate"
  name: string;                  // "LLM Analysis"
  type: 'llm';                   // Action type identifier

  // LLM tool config
  tool: {
    primary: 'agy' | 'qwen' | 'codex';
    fallback_chain: string[];    // ['agy', 'qwen', 'codex']
  };

  // Execution mode
  mode: 'analysis' | 'write';

  // Prompt config
  prompt: {
    template: string;            // Prompt template path or inline
    variables: string[];         // Variables to replace
  };

  // Input/Output
  input: string[];               // Dependent context files
  output: string;                // Output file path

  // Timeout config
  timeout?: number;              // Milliseconds, default 600000 (10min)
}
```

---

## Template Generation Function

```javascript
function generateLLMAction(config) {
  const { id, name, tool, mode, prompt, input, output, timeout = 600000 } = config;

  return `
# ${name}

## Action: ${id}

### Execution Logic

\`\`\`javascript
async function execute${toPascalCase(id)}(context) {
  const workDir = context.workDir;
  const state = context.state;

  // 1. Collect input context
  const inputContext = ${JSON.stringify(input)}.map(f => {
    const path = \`\${workDir}/\${f}\`;
    return Read(path);
  }).join('\\n\\n---\\n\\n');

  // 2. Build prompt
  const promptTemplate = \`${prompt.template}\`;
  const finalPrompt = promptTemplate
    ${prompt.variables.map(v => `.replace('{{${v}}}', context.${v} || '')`).join('\n    ')};

  // 3. Execute LLM call (with fallback)
  const tools = ['${tool.primary}', ${tool.fallback_chain.map(t => `'${t}'`).join(', ')}];
  let result = null;
  let usedTool = null;

  for (const t of tools) {
    try {
      result = await callLLM(t, finalPrompt, '${mode}', ${timeout});
      usedTool = t;
      break;
    } catch (error) {
      console.log(\`\${t} failed: \${error.message}, trying next...\`);
    }
  }

  if (!result) {
    throw new Error('All LLM tools failed');
  }

  // 4. Save result
  Write(\`\${workDir}/${output}\`, result);

  // 5. Update state
  state.llm_calls = (state.llm_calls || 0) + 1;
  state.last_llm_tool = usedTool;

  return {
    success: true,
    output: '${output}',
    tool_used: usedTool
  };
}

// LLM call wrapper
async function callLLM(tool, prompt, mode, timeout) {
  const modeFlag = mode === 'write' ? '--mode write' : '--mode analysis';

  // Use maestro delegate unified interface
  const command = \`maestro delegate "\${escapePrompt(prompt)}" --to \${tool} \${modeFlag}\`;

  const result = Bash({
    command,
    timeout,
    run_in_background: true  // Async execution
  });

  // Wait for completion
  return await waitForResult(result.task_id, timeout);
}

function escapePrompt(prompt) {
  // Escape double quotes and special characters
  return prompt.replace(/"/g, '\\\\"').replace(/\$/g, '\\\\$');
}
\`\`\`

### Prompt Template

\`\`\`
${prompt.template}
\`\`\`

### Variable Descriptions

${prompt.variables.map(v => `- \`{{${v}}}\`: ${v} variable`).join('\n')}
`;
}

function toPascalCase(str) {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}
```

---

## Preset LLM Action Templates

### 1. Code Analysis Action

\`\`\`yaml
id: llm-code-analysis
name: LLM Code Analysis
type: llm
tool:
  primary: agy
  fallback_chain: [qwen]
mode: analysis
prompt:
  template: |
    PURPOSE: Analyze code structure and patterns, extract key design features
    TASK:
    • Identify main modules and components
    • Analyze dependencies
    • Extract design patterns
    • Evaluate code quality
    MODE: analysis
    CONTEXT: {{code_context}}
    EXPECTED: JSON formatted analysis report with modules, dependencies, patterns, quality_score
    RULES: $(cat ~/.ccw/workflows/cli-templates/protocols/analysis-protocol.md)
  variables:
    - code_context
input:
  - collected-code.md
output: analysis-report.json
timeout: 900000
\`\`\`

### 2. Documentation Generation Action

\`\`\`yaml
id: llm-doc-generation
name: LLM Documentation Generation
type: llm
tool:
  primary: agy
  fallback_chain: [qwen, codex]
mode: write
prompt:
  template: |
    PURPOSE: Generate high-quality documentation based on analysis results
    TASK:
    • Generate documentation outline based on analysis report
    • Populate chapter content
    • Add code examples and explanations
    • Generate Mermaid diagrams
    MODE: write
    CONTEXT: {{analysis_report}}
    EXPECTED: Complete Markdown documentation with table of contents, chapters, diagrams
    RULES: $(cat ~/.ccw/workflows/cli-templates/protocols/write-protocol.md)
  variables:
    - analysis_report
input:
  - analysis-report.json
output: generated-doc.md
timeout: 1200000
\`\`\`

### 3. Code Refactoring Suggestions Action

\`\`\`yaml
id: llm-refactor-suggest
name: LLM Refactoring Suggestions
type: llm
tool:
  primary: codex
  fallback_chain: [agy]
mode: analysis
prompt:
  template: |
    PURPOSE: Analyze code and provide refactoring suggestions
    TASK:
    • Identify code smells
    • Evaluate complexity hotspots
    • Propose specific refactoring plans
    • Estimate refactoring impact scope
    MODE: analysis
    CONTEXT: {{source_code}}
    EXPECTED: List of refactoring suggestions with location, issue, suggestion, impact fields
    RULES: $(cat ~/.ccw/workflows/cli-templates/protocols/analysis-protocol.md)
  variables:
    - source_code
input:
  - source-files.md
output: refactor-suggestions.json
timeout: 600000
\`\`\`

---

## Usage Examples

### Using LLM Actions in Phase

\`\`\`javascript
// phases/02-llm-analysis.md

const llmConfig = {
  id: 'llm-analyze-skill',
  name: 'Skill Pattern Analysis',
  type: 'llm',
  tool: {
    primary: 'agy',
    fallback_chain: ['qwen']
  },
  mode: 'analysis',
  prompt: {
    template: \`
PURPOSE: Analyze design patterns of existing Skills
TASK:
• Extract Skill structure specification
• Identify Phase organization patterns
• Analyze Agent invocation patterns
MODE: analysis
CONTEXT: {{skill_source}}
EXPECTED: Structured design pattern analysis
\`,
    variables: ['skill_source']
  },
  input: ['collected-skills.md'],
  output: 'skill-patterns.json'
};

// Execute
const result = await executeLLMAction(llmConfig, {
  workDir: runStart.run_dir,
  skill_source: Read(`${runStart.run_dir}/outputs/collected-skills.md`)
});
\`\`\`

### Scheduling LLM Actions in Orchestrator

\`\`\`javascript
// Schedule LLM actions in autonomous-orchestrator

const actions = [
  { type: 'collect', priority: 100 },
  { type: 'llm', id: 'llm-analyze', priority: 90 },  // LLM analysis
  { type: 'process', priority: 80 },
  { type: 'llm', id: 'llm-generate', priority: 70 }, // LLM generation
  { type: 'validate', priority: 60 }
];

for (const action of sortByPriority(actions)) {
  if (action.type === 'llm') {
    const llmResult = await executeLLMAction(
      getLLMConfig(action.id),
      context
    );
    context.state[action.id] = llmResult;
  }
}
\`\`\`

---

## Error Handling

\`\`\`javascript
async function executeLLMActionWithRetry(config, context, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await executeLLMAction(config, context);
    } catch (error) {
      lastError = error;
      console.log(\`Attempt ${attempt} failed: ${error.message}\`);

      // Exponential backoff
      if (attempt < maxRetries) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  // All retries failed
  return {
    success: false,
    error: lastError.message,
    fallback: 'manual_review_required'
  };
}
\`\`\`

---

## Best Practices

1. **Select Appropriate Tool**
   - Analysis tasks: Agy (large context) > Qwen
   - Generation tasks: Codex (autonomous execution) > Agy > Qwen
   - Code modification: Codex > Agy

2. **Configure Fallback Chain**
   - Always configure at least one fallback
   - Consider tool characteristics when ordering fallbacks

3. **Timeout Settings**
   - Analysis tasks: 10-15 minutes
   - Generation tasks: 15-20 minutes
   - Complex tasks: 20-60 minutes

4. **Prompt Design**
   - Use PURPOSE/TASK/MODE/CONTEXT/EXPECTED/RULES structure
   - Reference standard protocol templates
   - Clearly specify output format requirements
