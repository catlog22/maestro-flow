# Phase 2: Execute Skill

> **COMPACT SENTINEL [Phase 2: Execute]**
> This phase contains 4 execution steps (Step 2.1 -- 2.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/02-execute.md")`

Execute the target skill against the test scenario using `ccw cli --tool claude --mode write`. Claude receives the full skill definition and simulates producing its expected output artifacts.

## Objective

- Snapshot current skill version before execution
- Construct execution prompt with full skill content + test scenario
- Execute via ccw cli Claude
- Collect output artifacts

## Execution

### Step 2.1: Snapshot Current Skill

```javascript
const N = state.current_iteration;
const iterDir = `${state.work_dir}/iterations/iteration-${N}`;
Bash(`mkdir -p "${iterDir}/skill-snapshot" "${iterDir}/artifacts"`);

// Chain mode: create per-skill artifact directories
if (state.execution_mode === 'chain') {
  for (const skillName of state.chain_order) {
    Bash(`mkdir -p "${iterDir}/artifacts/${skillName}"`);
  }
}

// Snapshot current skill state (so we can compare/rollback)
for (const skill of state.target_skills) {
  Bash(`cp -r "${skill.path}" "${iterDir}/skill-snapshot/${skill.name}"`);
}
```

### Step 2.2: Construct Execution Prompt (Single Mode)

Read the execute-prompt template and substitute variables.

> Skip to Step 2.2b if `state.execution_mode === 'chain'`.

```javascript
// Ref: templates/execute-prompt.md

// Build skillContent by reading only executable skill files (SKILL.md, phases/, specs/)
// Exclude README.md, docs/, and other non-executable files to save tokens
const skillContent = state.target_skills.map(skill => {
  const skillMd = Read(`${skill.path}/SKILL.md`);
  const phaseFiles = Glob(`${skill.path}/phases/*.md`).sort().map(f => ({
    relativePath: f.replace(skill.path + '/', ''),
    content: Read(f)
  }));
  const specFiles = Glob(`${skill.path}/specs/*.md`).map(f => ({
    relativePath: f.replace(skill.path + '/', ''),
    content: Read(f)
  }));

  return `### File: SKILL.md\n${skillMd}\n\n` +
    phaseFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') +
    (specFiles.length > 0 ? '\n\n' + specFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') : '');
}).join('\n\n---\n\n');

// Construct full prompt using template
const executePrompt = `PURPOSE: Simulate executing the following workflow skill against a test scenario. Produce all expected output artifacts as if the skill were invoked with the given input.

SKILL CONTENT:
${skillContent}

TEST SCENARIO:
Description: ${state.test_scenario.description}
Input Arguments: ${state.test_scenario.input_args}
Requirements: ${state.test_scenario.requirements.join('; ')}
Success Criteria: ${state.test_scenario.success_criteria}

TASK:
1. Study the complete skill structure (SKILL.md + all phase files)
2. Follow the skill execution flow sequentially
3. For each phase, produce the artifacts that phase would generate
4. Write all output artifacts to the current working directory
5. Create a manifest.json listing all produced artifacts

MODE: write
CONTEXT: @**/*
EXPECTED: All artifacts written to disk + manifest.json
CONSTRAINTS: Follow skill flow exactly, produce realistic output, not placeholders`;
```

### Step 2.3: Execute via ccw cli

> **CHECKPOINT**: Before executing CLI, verify:
> 1. This phase is TodoWrite `in_progress`
> 2. `iterDir/artifacts/` directory exists
> 3. Prompt is properly escaped

```javascript
function escapeForShell(str) {
  return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

const cliCommand = `ccw cli -p "${escapeForShell(executePrompt)}" --tool claude --mode write --cd "${iterDir}/artifacts"`;

// Execute in background, wait for hook callback
Bash({
  command: cliCommand,
  run_in_background: true,
  timeout: 600000  // 10 minutes max
});

// STOP HERE -- wait for hook callback to resume
// After callback, verify artifacts were produced
```

### Step 2.2b: Chain Execution Path

> Skip this step if `state.execution_mode === 'single'`.

In chain mode, execute each skill sequentially. Each skill receives the previous skill's artifacts as input context.

```javascript
// Chain execution: iterate through chain_order
let previousArtifacts = '';  // Accumulates upstream output

for (let i = 0; i < state.chain_order.length; i++) {
  const skillName = state.chain_order[i];
  const skill = state.target_skills.find(s => s.name === skillName);
  const skillArtifactDir = `${iterDir}/artifacts/${skillName}`;

  // Build this skill's content
  const skillMd = Read(`${skill.path}/SKILL.md`);
  const phaseFiles = Glob(`${skill.path}/phases/*.md`).sort().map(f => ({
    relativePath: f.replace(skill.path + '/', ''),
    content: Read(f)
  }));
  const specFiles = Glob(`${skill.path}/specs/*.md`).map(f => ({
    relativePath: f.replace(skill.path + '/', ''),
    content: Read(f)
  }));

  const singleSkillContent = `### File: SKILL.md\n${skillMd}\n\n` +
    phaseFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') +
    (specFiles.length > 0 ? '\n\n' + specFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') : '');

  // Build chain context from previous skill's artifacts
  const chainInputContext = previousArtifacts
    ? `\nPREVIOUS CHAIN OUTPUT (from upstream skill "${state.chain_order[i - 1]}"):\n${previousArtifacts}\n\nIMPORTANT: Use the above output as input context for this skill's execution.\n`
    : '';

  // Construct per-skill execution prompt
  // Ref: templates/execute-prompt.md
  const chainPrompt = `PURPOSE: Simulate executing the following workflow skill against a test scenario. Produce all expected output artifacts.

SKILL CONTENT (${skillName} — chain position ${i + 1}/${state.chain_order.length}):
${singleSkillContent}
${chainInputContext}
TEST SCENARIO:
Description: ${state.test_scenario.description}
Input Arguments: ${state.test_scenario.input_args}
Requirements: ${state.test_scenario.requirements.join('; ')}
Success Criteria: ${state.test_scenario.success_criteria}

TASK:
1. Study the complete skill structure
2. Follow the skill execution flow sequentially
3. Produce all expected artifacts
4. Write output to the current working directory
5. Create manifest.json listing all produced artifacts

MODE: write
CONTEXT: @**/*
CONSTRAINTS: Follow skill flow exactly, produce realistic output`;

  function escapeForShell(str) {
    return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  }

  const cliCommand = `ccw cli -p "${escapeForShell(chainPrompt)}" --tool claude --mode write --cd "${skillArtifactDir}"`;

  // Execute in background
  Bash({
    command: cliCommand,
    run_in_background: true,
    timeout: 600000
  });

  // STOP -- wait for hook callback

  // After callback: collect artifacts for next skill in chain
  const artifacts = Glob(`${skillArtifactDir}/**/*`);
  const skillSuccess = artifacts.length > 0;

  if (skillSuccess) {
    previousArtifacts = artifacts.slice(0, 10).map(f => {
      const relPath = f.replace(skillArtifactDir + '/', '');
      const content = Read(f, { limit: 100 });
      return `--- ${relPath} ---\n${content}`;
    }).join('\n\n');
  } else {
    // Mid-chain failure: keep previous artifacts for downstream skills
    // Log warning but continue chain — downstream skills receive last successful output
    state.errors.push({
      phase: 'execute',
      message: `Chain skill "${skillName}" (position ${i + 1}) produced no artifacts. Downstream skills will receive upstream output from "${state.chain_order[i - 1] || 'none'}" instead.`,
      timestamp: new Date().toISOString()
    });
    state.error_count++;
    // previousArtifacts remains from last successful skill (or empty if first)
  }

  // Update per-skill TodoWrite
  // TaskUpdate chain skill task with execution status

  // Record per-skill execution
  if (!state.iterations[N - 1].execution.chain_executions) {
    state.iterations[N - 1].execution.chain_executions = [];
  }
  state.iterations[N - 1].execution.chain_executions.push({
    skill_name: skillName,
    cli_command: cliCommand,
    artifacts_dir: skillArtifactDir,
    success: skillSuccess
  });

  // Check error budget: abort chain if too many consecutive failures
  if (state.error_count >= 3) {
    state.errors.push({
      phase: 'execute',
      message: `Chain execution aborted at skill "${skillName}" — error limit reached (${state.error_count} errors).`,
      timestamp: new Date().toISOString()
    });
    break;
  }
}
```

### Step 2.4: Collect Artifacts

After CLI completes (hook callback received):

```javascript
// List produced artifacts
const artifactFiles = Glob(`${iterDir}/artifacts/**/*`);

// Chain mode: check per-skill artifacts
if (state.execution_mode === 'chain') {
  const chainSuccess = state.iterations[N - 1].execution.chain_executions?.every(e => e.success) ?? false;
  state.iterations[N - 1].execution.success = chainSuccess;
  state.iterations[N - 1].execution.artifacts_dir = `${iterDir}/artifacts`;
} else {

if (artifactFiles.length === 0) {
  // Execution produced nothing -- record error
  state.iterations[N - 1].execution = {
    cli_command: cliCommand,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    artifacts_dir: `${iterDir}/artifacts`,
    success: false
  };
  state.error_count++;
  // Continue to Phase 3 anyway -- Gemini can evaluate the skill even without artifacts
} else {
  state.iterations[N - 1].execution = {
    cli_command: cliCommand,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    artifacts_dir: `${iterDir}/artifacts`,
    success: true
  };
}

} // end single mode branch

// Update state
Write(`${state.work_dir}/iteration-state.json`, JSON.stringify(state, null, 2));
```

## Error Handling

| Error | Recovery |
|-------|----------|
| CLI timeout (10min) | Record failure, continue to Phase 3 without artifacts |
| CLI crash | Retry once with simplified prompt (SKILL.md only, no phase files) |
| No artifacts produced | Continue to Phase 3, evaluation focuses on skill definition quality |

## Output

- **Files**: `iteration-{N}/skill-snapshot/`, `iteration-{N}/artifacts/`
- **State**: `iterations[N-1].execution` updated
- **Next**: Phase 3 (Evaluate)
