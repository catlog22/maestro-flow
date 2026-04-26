# Phase 1: Setup

Initialize workspace, backup skills, parse inputs.

## Objective

- Parse skill path(s) and test scenario from user input
- Validate all skill paths exist and contain SKILL.md
- Create isolated workspace directory structure
- Backup original skill files
- Initialize iteration-state.json

## Execution

### Step 1.1: Parse Input

Parse `$ARGUMENTS` to extract skill paths and test scenario.

```javascript
// Parse skill paths (first argument or comma-separated)
const args = $ARGUMENTS.trim();
const pathMatch = args.match(/^([^\s]+)/);
const rawPaths = pathMatch ? pathMatch[1].split(',') : [];

// Parse test scenario
const scenarioMatch = args.match(/(?:--scenario|--test)\s+"([^"]+)"/);
const scenarioText = scenarioMatch ? scenarioMatch[1] : args.replace(rawPaths.join(','), '').trim();

// Record chain order (preserves input order for chain mode)
const chainOrder = rawPaths.map(p => p.startsWith('.claude/') ? p.split('/').pop() : p);

// If no scenario, ask user
if (!scenarioText) {
  const response = AskUserQuestion({
    questions: [{
      question: "Please describe the test scenario for evaluating this skill:",
      header: "Test Scenario",
      multiSelect: false,
      options: [
        { label: "General quality test", description: "Evaluate overall skill quality with a generic task" },
        { label: "Specific scenario", description: "I'll describe a specific test case" }
      ]
    }]
  });
  // Use response to construct testScenario
}
```

### Step 1.2: Validate Skill Paths

```javascript
const targetSkills = [];
for (const rawPath of rawPaths) {
  const skillPath = rawPath.startsWith('.claude/') ? rawPath : `.claude/skills/${rawPath}`;

  // Validate SKILL.md exists
  const skillFiles = Glob(`${skillPath}/SKILL.md`);
  if (skillFiles.length === 0) {
    throw new Error(`Skill not found at: ${skillPath} -- SKILL.md missing`);
  }

  // Collect all skill files
  const allFiles = Glob(`${skillPath}/**/*.md`);
  targetSkills.push({
    name: skillPath.split('/').pop(),
    path: skillPath,
    files: allFiles.map(f => f.replace(skillPath + '/', '')),
    primary_file: 'SKILL.md'
  });
}
```

### Step 1.3: Create Workspace

```javascript
const ts = Date.now();
const workDir = `.workflow/.scratchpad/skill-iter-tune-${ts}`;

Bash(`mkdir -p "${workDir}/backups" "${workDir}/iterations"`);
```

### Step 1.4: Backup Original Skills

```javascript
for (const skill of targetSkills) {
  Bash(`cp -r "${skill.path}" "${workDir}/backups/${skill.name}"`);
}
```

### Step 1.5: Initialize State

Write `iteration-state.json` with initial state:

```javascript
const initialState = {
  status: 'running',
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  target_skills: targetSkills,
  test_scenario: {
    description: scenarioText,
    // Parse --requirements and --input-args from $ARGUMENTS if provided
    // e.g., --requirements "clear output,no errors" --input-args "my-skill --scenario test"
    requirements: parseListArg(args, '--requirements') || [],
    input_args: parseStringArg(args, '--input-args') || '',
    success_criteria: parseStringArg(args, '--success-criteria') || 'Produces correct, high-quality output'
  },
  execution_mode: workflowPreferences.executionMode || 'single',
  chain_order: workflowPreferences.executionMode === 'chain'
    ? targetSkills.map(s => s.name)
    : [],
  current_iteration: 0,
  max_iterations: workflowPreferences.maxIterations,
  quality_threshold: workflowPreferences.qualityThreshold,
  latest_score: 0,
  score_trend: [],
  converged: false,
  iterations: [],
  errors: [],
  error_count: 0,
  max_errors: 3,
  work_dir: workDir,
  backup_dir: `${workDir}/backups`
};

Write(`${workDir}/iteration-state.json`, JSON.stringify(initialState, null, 2));

// Chain mode: create per-skill tracking tasks
if (initialState.execution_mode === 'chain') {
  for (const skill of targetSkills) {
    TaskCreate({
      subject: `Chain: ${skill.name}`,
      activeForm: `Tracking ${skill.name}`,
      description: `Skill chain member: ${skill.path} | Position: ${targetSkills.indexOf(skill) + 1}/${targetSkills.length}`
    });
  }
}
```

## Output

- **Variables**: `workDir`, `targetSkills[]`, `testScenario`, `chainOrder` (chain mode)
- **Files**: `iteration-state.json`, `backups/` directory with skill copies
- **TodoWrite**: Mark Phase 1 completed, start Iteration Loop. Chain mode: per-skill tracking tasks created
