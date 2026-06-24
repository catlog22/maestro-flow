# CLI Integration Specification

maestro delegate integration specification that defines how to properly call external CLI tools within Skills.

---

## Execution Modes

### 1. Synchronous Execution (Blocking)

Suitable for scenarios that need immediate results.

```javascript
// Agent call - synchronous
const result = Agent({
  subagent_type: 'universal-executor',
  prompt: 'Execute task...',
  run_in_background: false  // Key: synchronous execution
});

// Result immediately available
console.log(result);
```

### 2. Asynchronous Execution (Background)

Suitable for long-running CLI commands.

```javascript
// CLI call - asynchronous
const task = Bash({
  command: 'maestro delegate "..." --to agy --mode analysis',
  run_in_background: true  // Key: background execution
});

// Returns immediately without waiting for result
// task.task_id available for later queries
```

---

## maestro delegate Call Specification

### Basic Command Structure

```bash
maestro delegate "<PROMPT>" --to <agy|qwen|codex> --mode <analysis|write>
```

### Parameter Description

| Parameter | Required | Description |
|-----------|----------|-------------|
| `-p "<prompt>"` | Yes | Prompt text (use double quotes) |
| `--tool <tool>` | Yes | Tool selection: agy, qwen, codex |
| `--mode <mode>` | Yes | Execution mode: analysis, write |
| `--cd <path>` | - | Working directory |
| `--includeDirs <dirs>` | - | Additional directories (comma-separated) |
| `--resume [id]` | - | Resume session |

### Mode Selection

```
- Analysis/Documentation tasks?
  → --mode analysis (read-only)

- Implementation/Modification tasks?
  → --mode write (read-write)
```

---

## Agent Types and Selection

### universal-executor

General-purpose executor, the most commonly used agent type.

```javascript
Agent({
  subagent_type: 'universal-executor',
  prompt: `
Execute task:
1. Read configuration file
2. Analyze dependencies
3. Generate report to ${outputPath}
  `,
  run_in_background: false
});
```

**Applicable Scenarios**:
- Multi-step task execution
- File operations (read/write/edit)
- Tasks that require tool invocation

### Explore

Code exploration agent for quick codebase understanding.

```javascript
Agent({
  subagent_type: 'Explore',
  prompt: `
Explore src/ directory:
- Identify main modules
- Understand directory structure
- Find entry points

Thoroughness: medium
  `,
  run_in_background: false
});
```

**Applicable Scenarios**:
- Codebase exploration
- File discovery
- Structure understanding

### cli-explore-agent

Deep code analysis agent.

```javascript
Agent({
  subagent_type: 'cli-explore-agent',
  prompt: `
Deep analysis of src/auth/ module:
- Authentication flow
- Session management
- Security mechanisms
  `,
  run_in_background: false
});
```

**Applicable Scenarios**:
- Deep code understanding
- Design pattern identification
- Complex logic analysis

---

## Session Management

### Session Recovery

```javascript
// Save session ID
const session = Bash({
  command: 'maestro delegate "Initial analysis..." --to agy --mode analysis',
  run_in_background: true
});

// Resume later
const continuation = Bash({
  command: `maestro delegate "Continue analysis..." --to agy --mode analysis --resume ${session.id}`,
  run_in_background: true
});
```

### Multi-Session Merge

```javascript
// Merge context from multiple sessions
const merged = Bash({
  command: `maestro delegate "Aggregate analysis..." --to agy --mode analysis --resume ${id1},${id2}`,
  run_in_background: true
});
```

---

## CLI Integration Patterns in Skills

### Pattern 1: Single Call

Simple tasks completed in one call.

```javascript
// Phase execution
async function executePhase(context) {
  const result = Bash({
    command: `maestro delegate "
PURPOSE: Analyze project structure
TASK: Identify modules, dependencies, entry points
MODE: analysis
CONTEXT: @src/**/*
EXPECTED: JSON format structure report
" --tool agy --mode analysis --cd ${context.projectRoot}`,
    run_in_background: true,
    timeout: 600000
  });

  // Wait for completion
  return await waitForCompletion(result.task_id);
}
```

### Pattern 2: Chained Calls

Multi-step tasks where each step depends on previous results.

```javascript
async function executeChain(context) {
  // Step 1: Collect
  const collectId = await runCLI('collect', context);

  // Step 2: Analyze (depends on Step 1)
  const analyzeId = await runCLI('analyze', context, `--resume ${collectId}`);

  // Step 3: Generate (depends on Step 2)
  const generateId = await runCLI('generate', context, `--resume ${analyzeId}`);

  return generateId;
}

async function runCLI(step, context, resumeFlag = '') {
  const prompts = {
    collect: 'PURPOSE: Collect code files...',
    analyze: 'PURPOSE: Analyze code patterns...',
    generate: 'PURPOSE: Generate documentation...'
  };

  const result = Bash({
    command: `maestro delegate "${prompts[step]}" --to agy --mode analysis ${resumeFlag}`,
    run_in_background: true
  });

  return await waitForCompletion(result.task_id);
}
```

### Pattern 3: Parallel Calls

Independent tasks executed in parallel.

```javascript
async function executeParallel(context) {
  const tasks = [
    { type: 'structure', tool: 'agy' },
    { type: 'dependencies', tool: 'agy' },
    { type: 'patterns', tool: 'qwen' }
  ];

  // Start tasks in parallel
  const taskIds = tasks.map(task =>
    Bash({
      command: `maestro delegate "Analyze ${task.type}..." --to ${task.tool} --mode analysis`,
      run_in_background: true
    }).task_id
  );

  // Wait for all to complete
  const results = await Promise.all(
    taskIds.map(id => waitForCompletion(id))
  );

  return results;
}
```

### Pattern 4: Fallback Chain

Automatically switch tools on failure.

```javascript
async function executeWithFallback(context) {
  const tools = ['agy', 'qwen', 'codex'];
  let result = null;

  for (const tool of tools) {
    try {
      result = await runWithTool(tool, context);
      if (result.success) break;
    } catch (error) {
      console.log(`${tool} failed, trying next...`);
    }
  }

  if (!result?.success) {
    throw new Error('All tools failed');
  }

  return result;
}

async function runWithTool(tool, context) {
  const task = Bash({
    command: `maestro delegate "..." --to ${tool} --mode analysis`,
    run_in_background: true,
    timeout: 600000
  });

  return await waitForCompletion(task.task_id);
}
```

---

## Prompt Template Integration

### Reference Protocol Templates

```bash
# Analysis mode - use --rule to auto-load protocol and template (appended to prompt)
maestro delegate "
CONSTRAINTS: ...
..." --tool agy --mode analysis --rule analysis-code-patterns

# Write mode - use --rule to auto-load protocol and template (appended to prompt)
maestro delegate "
CONSTRAINTS: ...
..." --tool codex --mode write --rule development-feature
```

### Dynamic Template Building

```javascript
function buildPrompt(config) {
  const { purpose, task, mode, context, expected, constraints } = config;

  return `
PURPOSE: ${purpose}
TASK: ${task.map(t => `• ${t}`).join('\n')}
MODE: ${mode}
CONTEXT: ${context}
EXPECTED: ${expected}
CONSTRAINTS: ${constraints || ''}
`; // Use --rule option to auto-append protocol + template
}
```

---

## Timeout Configuration

### Recommended Timeout Values

| Task Type | Timeout (ms) | Description |
|-----------|--------------|-------------|
| Quick analysis | 300000 | 5 minutes |
| Standard analysis | 600000 | 10 minutes |
| Deep analysis | 1200000 | 20 minutes |
| Code generation | 1800000 | 30 minutes |
| Complex tasks | 3600000 | 60 minutes |

### Special Codex Handling

Codex requires longer timeout (recommend 3x).

```javascript
const timeout = tool === 'codex' ? baseTimeout * 3 : baseTimeout;

Bash({
  command: `maestro delegate "..." --to ${tool} --mode write`,
  run_in_background: true,
  timeout: timeout
});
```

---

## Error Handling

### Common Errors

| Error | Cause | Handler |
|-------|-------|---------|
| ETIMEDOUT | Network timeout | Retry or switch tool |
| Exit code 1 | Command execution failed | Check parameters, switch tool |
| Context overflow | Input context too large | Reduce input scope |

### Retry Strategy

```javascript
async function executeWithRetry(command, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const task = Bash({
        command,
        run_in_background: true,
        timeout: 600000
      });

      return await waitForCompletion(task.task_id);
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt} failed: ${error.message}`);

      // Exponential backoff
      if (attempt < maxRetries) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw lastError;
}
```

---

## Best Practices

### 1. run_in_background Rule

```
Agent calls (Task):
  run_in_background: false  → Synchronous, get result immediately

CLI calls (Bash + maestro delegate):
  run_in_background: true   → Asynchronous, run in background
```

### 2. Tool Selection

```
Analysis tasks: agy > qwen
Generation tasks: codex > agy > qwen
Code modification: codex > agy
```

### 3. Session Management

- Use `--resume` for related tasks to maintain context
- Do not use `--resume` for independent tasks

### 4. Prompt Specification

- Always use PURPOSE/TASK/MODE/CONTEXT/EXPECTED/CONSTRAINTS structure
- Use `--rule <template>` to auto-append protocol + template to prompt
- Template name format: `category-function` (e.g., `analysis-code-patterns`)

### 5. Result Processing

- Persist important results to workDir
- Brief returns: path + summary, avoid context overflow
- JSON format convenient for downstream processing
