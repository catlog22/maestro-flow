
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 3: Phase Generation

Generate Phase files based on execution mode, including declarative workflow orchestration and context strategy support.

## Objective

- Sequential Mode: Generate sequential Phase files + **declarative orchestrator**
- Autonomous Mode: Generate orchestrator and action files
- Support **file-based context** and **memory context** strategies


## Context Strategy (P0 Enhancement)

Generate different context management code based on `config.context_strategy`:

| Strategy | Use Case | Advantages | Disadvantages |
|----------|----------|------------|---------------|
| `file` | Complex multi-phase tasks | Persistence, debuggable, recoverable | I/O overhead |
| `memory` | Simple linear tasks | Fast speed | Not recoverable, hard to debug |

```javascript
const CONTEXT_STRATEGIES = {
  file: {
    read: (key) => `JSON.parse(Read(\`\${workDir}/context/${key}.json\`))`,
    write: (key, data) => `Write(\`\${workDir}/context/${key}.json\`, JSON.stringify(${data}, null, 2))`,
    init: `Bash(\`mkdir -p "\${workDir}/context"\`)`
  },
  memory: {
    read: (key) => `state.context.${key}`,
    write: (key, data) => `state.context.${key} = ${data}`,
    init: `state.context = {}`
  }
};
```

## Execution Steps

### Step 1: Load Configuration and Templates

```javascript
const config = JSON.parse(Read(`${workDir}/skill-config.json`));
const skillDir = `.claude/skills/${config.skill_name}`;
const contextStrategy = config.context_strategy || 'file'; // Default file strategy

// Load templates
const skillRoot = '.claude/skills/skill-generator';
```

### Step 2: Sequential Mode - Generate Phase Files + Declarative Orchestrator

```javascript
if (config.execution_mode === 'sequential') {
  const phases = config.sequential_config.phases;

  // ========== P0 Enhancement: Generate declarative orchestrator ==========
  const workflowOrchestrator = generateSequentialOrchestrator(config, phases);
  Write(`${skillDir}/phases/_orchestrator.md`, workflowOrchestrator);

  // ========== P0 Enhancement: Generate workflow definition ==========
  const workflowDef = generateWorkflowDefinition(config, phases);
  Write(`${skillDir}/workflow.json`, JSON.stringify(workflowDef, null, 2));

  // ========== P0 Enhancement: Generate Phase 0 (mandatory specification study) ==========
  const phase0Content = generatePhase0Spec(config);
  Write(`${skillDir}/phases/00-spec-study.md`, phase0Content);

  // ========== Generate user-defined phase files ==========
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const prevPhase = i > 0 ? phases[i-1] : null;
    const nextPhase = i < phases.length - 1 ? phases[i+1] : null;

    const content = generateSequentialPhase({
      phaseNumber: i + 1,
      phaseId: phase.id,
      phaseName: phase.name,
      phaseDescription: phase.description || `Execute ${phase.name}`,
      input: prevPhase ? prevPhase.output : "phase 0 output", // Phase 0 as first input source
      output: phase.output,
      nextPhase: nextPhase ? nextPhase.id : null,
      config: config,
      contextStrategy: contextStrategy
    });

    Write(`${skillDir}/phases/${phase.id}.md`, content);
  }
}

// ========== P0 Enhancement: Declarative workflow definition ==========
function generateWorkflowDefinition(config, phases) {
  // ========== P0: Add mandatory Phase 0 ==========
  const phase0 = {
    id: '00-spec-study',
    name: 'Specification Study',
    order: 0,
    input: null,
    output: 'spec-study-complete.flag',
    description: 'MANDATORY: Read all specification documents before execution',
    parallel: false,
    condition: null,
    agent: {
      type: 'universal-executor',
      run_in_background: false
    }
  };

  return {
    skill_name: config.skill_name,
    version: "1.0.0",
    execution_mode: "sequential",
    context_strategy: config.context_strategy || "file",

    // ========== P0: Phase 0 placed first ==========
    phases_to_run: ['00-spec-study', ...phases.map(p => p.id)],

    // ========== P0: Phase 0 + user-defined phases ==========
    phases: [
      phase0,
      ...phases.map((p, i) => ({
        id: p.id,
        name: p.name,
        order: i + 1,
        input: i === 0 ? phase0.output : phases[i-1].output, // First phase depends on Phase 0
        output: p.output,
        parallel: p.parallel || false,
        condition: p.condition || null,
        // Agent configuration (supports LLM integration)
        agent: p.agent || (config.llm_integration?.enabled ? {
          type: "llm",
          tool: config.llm_integration.default_tool,
          mode: config.llm_integration.mode || "analysis",
          fallback_chain: config.llm_integration.fallback_chain || [],
          run_in_background: false
        } : {
          type: "universal-executor",
          run_in_background: false
        })
      }))
    ],

    // Termination conditions
    termination: {
      on_success: "all_phases_completed",
      on_error: "stop_and_report",
      max_retries: 3
    }
  };
}

// ========== P0 Enhancement: Declarative orchestrator ==========
function generateSequentialOrchestrator(config, phases) {
  return `# Sequential Orchestrator

Declarative workflow orchestrator that executes phases in order defined by \`workflow.json\`.

## Workflow Definition

\`\`\`javascript
const workflow = JSON.parse(Read(\`\${skillDir}/workflow.json\`));
\`\`\`

## Orchestration Logic

\`\`\`javascript
async function runSequentialWorkflow(workDir) {
  const workflow = JSON.parse(Read(\`\${skillDir}/workflow.json\`));
  const contextStrategy = workflow.context_strategy;

  // Initialize context
  ${config.context_strategy === 'file' ?
    `Bash(\`mkdir -p "\${workDir}/context"\`);` :
    `const state = { context: {} };`}

  // Execution state tracking
  const execution = {
    started_at: new Date().toISOString(),
    phases_completed: [],
    current_phase: null,
    errors: []
  };

  Write(\`\${workDir}/execution-state.json\`, JSON.stringify(execution, null, 2));

  // Execute phases in declared order
  for (const phaseId of workflow.phases_to_run) {
    const phaseConfig = workflow.phases.find(p => p.id === phaseId);

    // Update execution state
    execution.current_phase = phaseId;
    Write(\`\${workDir}/execution-state.json\`, JSON.stringify(execution, null, 2));

    console.log(\`[Orchestrator] Executing: \${phaseId}\`);

    try {
      // Check conditional execution
      if (phaseConfig.condition) {
        const shouldRun = evaluateCondition(phaseConfig.condition, execution);
        if (!shouldRun) {
          console.log(\`[Orchestrator] Skipping \${phaseId} (condition not met)\`);
          continue;
        }
      }

      // Execute phase
      const result = await executePhase(phaseId, phaseConfig, workDir);

      // Record completion
      execution.phases_completed.push({
        id: phaseId,
        completed_at: new Date().toISOString(),
        output: phaseConfig.output
      });

    } catch (error) {
      execution.errors.push({
        phase: phaseId,
        message: error.message,
        timestamp: new Date().toISOString()
      });

      // Error handling strategy
      if (workflow.termination.on_error === 'stop_and_report') {
        console.error(\`[Orchestrator] Failed at \${phaseId}: \${error.message}\`);
        break;
      }
    }

    Write(\`\${workDir}/execution-state.json\`, JSON.stringify(execution, null, 2));
  }

  // Complete
  execution.current_phase = null;
  execution.completed_at = new Date().toISOString();
  Write(\`\${workDir}/execution-state.json\`, JSON.stringify(execution, null, 2));

  return execution;
}

async function executePhase(phaseId, phaseConfig, workDir) {
  const phasePrompt = Read(\`\${skillDir}/phases/\${phaseId}.md\`);

  // Use Task to invoke Agent
  const result = await spawn_agent({
    subagent_type: phaseConfig.agent?.type || 'universal-executor',
    run_in_background: phaseConfig.agent?.run_in_background || false,
    prompt: \`
[PHASE] \${phaseId}
[WORK_DIR] \${workDir}
[INPUT] \${phaseConfig.input ? \`\${workDir}/\${phaseConfig.input}\` : 'None'}
[OUTPUT] \${workDir}/\${phaseConfig.output}

\${phasePrompt}
\`
  });

  return JSON.parse(result);
}
\`\`\`

## Phase Execution Plan

**Execution Flow**:

\`\`\`
START
    ↓
Phase 0: Specification Study
    ↓ Output: spec-study-complete.flag
    ↓
Phase 1: ${phases[0]?.name || 'First Phase'}
    ↓ Output: ${phases[0]?.output || 'phase-1.json'}
${phases.slice(1).map((p, i) => \`    ↓
Phase \${i+2}: \${p.name}
    ↓ Output: \${p.output}\`).join('\n')}
    ↓
COMPLETE
\`\`\`

**Phase List**:

| Order | Phase | Input | Output | Agent |
|-------|-------|-------|--------|-------|
| 0 | 00-spec-study | - | spec-study-complete.flag | universal-executor |
${phases.map((p, i) =>
  \`| \${i+1} | \${p.id} | \${i === 0 ? 'spec-study-complete.flag' : phases[i-1].output} | \${p.output} | \${p.agent?.type || 'universal-executor'} |\`
).join('\n')}

## Error Recovery

\`\`\`javascript
// Resume execution from specified phase
async function resumeFromPhase(phaseId, workDir) {
  const workflow = JSON.parse(Read(\`\${skillDir}/workflow.json\`));
  const startIndex = workflow.phases_to_run.indexOf(phaseId);

  if (startIndex === -1) {
    throw new Error(\`Phase not found: \${phaseId}\`);
  }

  // Continue execution from specified phase
  const remainingPhases = workflow.phases_to_run.slice(startIndex);
  // ...continue execution
}
\`\`\`
`;
}

// Generate phase files (enhanced context strategy support)
function generateSequentialPhase(params) {
  const contextCode = params.contextStrategy === 'file' ? {
    readPrev: `const prevOutput = JSON.parse(Read(\`\${workDir}/${params.input}\`));`,
    writeResult: `Write(\`\${workDir}/${params.output}\`, JSON.stringify(result, null, 2));`,
    readContext: (key) => `JSON.parse(Read(\`\${workDir}/context/${key}.json\`))`,
    writeContext: (key) => `Write(\`\${workDir}/context/${key}.json\`, JSON.stringify(data, null, 2))`
  } : {
    readPrev: `const prevOutput = state.context.prevPhaseOutput;`,
    writeResult: `state.context.${params.phaseId.replace(/-/g, '_')}_output = result;`,
    readContext: (key) => `state.context.${key}`,
    writeContext: (key) => `state.context.${key} = data`
  };

  return `# Phase ${params.phaseNumber}: ${params.phaseName}

${params.phaseDescription}

## Objective

- Primary objective description
- Specific task list

## Input

- Dependency: \`${params.input}\`
- Configuration: \`{workDir}/skill-config.json\`
- Context Strategy: \`${params.contextStrategy}\`

## Execution Steps

### Step 1: Read Input

\`\`\`javascript
// Context strategy: ${params.contextStrategy}
${params.phaseNumber > 1 ? contextCode.readPrev : '// First phase, start directly from config'}
\`\`\`

### Step 2: Core Processing

\`\`\`javascript
// TODO: Implement core logic
const result = {
  status: 'completed',
  data: {
    // Processing results
  },
  metadata: {
    phase: '${params.phaseId}',
    timestamp: new Date().toISOString()
  }
};
\`\`\`

### Step 3: Output Results

\`\`\`javascript
// Write phase output (context strategy: ${params.contextStrategy})
${contextCode.writeResult}

// Return summary information to orchestrator
return {
  status: 'completed',
  output_file: '${params.output}',
  summary: 'Phase ${params.phaseNumber} completed'
};
\`\`\`

## Output

- **File**: \`${params.output}\`
- **Format**: ${params.output.endsWith('.json') ? 'JSON' : 'Markdown'}
- **Context Strategy**: ${params.contextStrategy}

## Quality Checklist

- [ ] Input data validation passed
- [ ] Core logic executed successfully
- [ ] Output format correct
- [ ] Context saved correctly

${params.nextPhase ?
  `## Next Phase\n\n→ [Phase ${params.phaseNumber + 1}: ${params.nextPhase}](${params.nextPhase}.md)` :
  `## Completion\n\nThis is the final phase, produce final deliverables.`}
`;
}
```

### Step 3: Autonomous Mode - Generate Enhanced Orchestrator

```javascript
if (config.execution_mode === 'autonomous' || config.execution_mode === 'hybrid') {
  const contextStrategy = config.context_strategy || 'file';

  // Generate state schema (enhanced file strategy support)
  const stateSchema = generateStateSchema(config, contextStrategy);
  Write(`${skillDir}/phases/state-schema.md`, stateSchema);

  // Generate enhanced orchestrator
  const orchestrator = generateEnhancedOrchestrator(config, contextStrategy);
  Write(`${skillDir}/phases/orchestrator.md`, orchestrator);

  // Generate action catalog
  const actionCatalog = generateActionCatalog(config);
  Write(`${skillDir}/specs/action-catalog.md`, actionCatalog);

  // Generate action files
  for (const action of config.autonomous_config.actions) {
    const actionContent = generateEnhancedAction(action, config, contextStrategy);
    Write(`${skillDir}/phases/actions/${action.id}.md`, actionContent);
  }
}

// Enhanced orchestrator generation
function generateEnhancedOrchestrator(config, contextStrategy) {
  const actions = config.autonomous_config.actions;

  return `# Orchestrator (Enhanced)

Enhanced orchestrator supporting declarative action scheduling and file-based context strategy.

## Configuration

- **Context Strategy**: ${contextStrategy}
- **Termination Conditions**: ${config.autonomous_config.termination_conditions?.join(', ') || 'task_completed'}

## Declarative Action Catalog

\`\`\`javascript
const ACTION_CATALOG = ${JSON.stringify(actions.map(a => ({
  id: a.id,
  name: a.name,
  preconditions: a.preconditions || [],
  effects: a.effects || [],
  priority: a.priority || 0
})), null, 2)};
\`\`\`

## Context Management (${contextStrategy} Strategy)

\`\`\`javascript
const ContextManager = {
  ${contextStrategy === 'file' ? \`
  // File strategy: persist to .scratchpad
  init: (workDir) => {
    Bash(\`mkdir -p "\${workDir}/context"\`);
    Write(\`\${workDir}/state.json\`, JSON.stringify(initialState, null, 2));
  },

  readState: (workDir) => JSON.parse(Read(\`\${workDir}/state.json\`)),

  writeState: (workDir, state) => {
    state.updated_at = new Date().toISOString();
    Write(\`\${workDir}/state.json\`, JSON.stringify(state, null, 2));
  },

  readContext: (workDir, key) => {
    try {
      return JSON.parse(Read(\`\${workDir}/context/\${key}.json\`));
    } catch { return null; }
  },

  writeContext: (workDir, key, data) => {
    Write(\`\${workDir}/context/\${key}.json\`, JSON.stringify(data, null, 2));
  }\` : \`
  // Memory strategy: maintain only at runtime
  state: null,
  context: {},

  init: (workDir) => {
    ContextManager.state = { ...initialState };
    ContextManager.context = {};
  },

  readState: () => ContextManager.state,

  writeState: (workDir, state) => {
    state.updated_at = new Date().toISOString();
    ContextManager.state = state;
  },

  readContext: (workDir, key) => ContextManager.context[key],

  writeContext: (workDir, key, data) => {
    ContextManager.context[key] = data;
  }\`}
};
\`\`\`

## Decision Logic

\`\`\`javascript
function selectNextAction(state) {
  // 1. Check termination conditions
${config.autonomous_config.termination_conditions?.map(c =>
  \`  if (\${getTerminationCheck(c)}) return null;\`
).join('\n') || '  if (state.status === "completed") return null;'}

  // 2. Check error limit
  if (state.error_count >= 3) return 'action-abort';

  // 3. Select actions that meet preconditions, sorted by priority
  const availableActions = ACTION_CATALOG
    .filter(a => checkPreconditions(a.preconditions, state))
    .filter(a => !state.completed_actions.includes(a.id))
    .sort((a, b) => b.priority - a.priority);

  if (availableActions.length > 0) {
    return availableActions[0].id;
  }

  // 4. Default complete
  return 'action-complete';
}

function checkPreconditions(conditions, state) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(cond => {
    // Support multiple condition formats
    if (cond.includes('===')) {
      const [left, right] = cond.split('===').map(s => s.trim());
      return eval(\`state.\${left}\`) === eval(right);
    }
    return state[cond] === true;
  });
}
\`\`\`

## Execution Loop (Enhanced)

\`\`\`javascript
async function runOrchestrator(workDir) {
  console.log('=== Orchestrator Started ===');
  console.log(\`Context Strategy: ${contextStrategy}\`);

  // Initialize
  ContextManager.init(workDir);

  let iteration = 0;
  const MAX_ITERATIONS = 100;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // 1. Read state
    const state = ContextManager.readState(workDir);
    console.log(\`[Iteration \${iteration}] Status: \${state.status}, Completed: \${state.completed_actions.length}\`);

    // 2. Select action
    const actionId = selectNextAction(state);

    if (!actionId) {
      console.log('=== All actions completed ===');
      state.status = 'completed';
      ContextManager.writeState(workDir, state);
      break;
    }

    console.log(\`[Iteration \${iteration}] Executing: \${actionId}\`);

    // 3. Update current action
    state.current_action = actionId;
    ContextManager.writeState(workDir, state);

    // 4. Execute action
    try {
      const actionPrompt = Read(\`\${skillDir}/phases/actions/\${actionId}.md\`);

      const result = await spawn_agent({
        subagent_type: 'universal-executor',
        run_in_background: false,
        prompt: \`
[STATE]
\${JSON.stringify(state, null, 2)}

[WORK_DIR]
\${workDir}

[CONTEXT_STRATEGY]
${contextStrategy}

[ACTION]
\${actionPrompt}

[RETURN FORMAT]
Return JSON: { "status": "completed"|"failed", "stateUpdates": {...}, "summary": "..." }
\`
      });

      const actionResult = JSON.parse(result);

      // 5. Update state
      state.completed_actions.push(actionId);
      state.current_action = null;
      Object.assign(state, actionResult.stateUpdates || {});

      console.log(\`[Iteration \${iteration}] Completed: \${actionResult.summary || actionId}\`);

    } catch (error) {
      console.error(\`[Iteration \${iteration}] Error: \${error.message}\`);
      state.errors.push({
        action: actionId,
        message: error.message,
        timestamp: new Date().toISOString()
      });
      state.error_count++;
      state.current_action = null;
    }

    ContextManager.writeState(workDir, state);
  }

  console.log('=== Orchestrator Finished ===');
  return ContextManager.readState(workDir);
}
\`\`\`

## Action Catalog

| Action | Priority | Preconditions | Effects |
|--------|----------|---------------|---------|
${actions.map(a =>
  \`| [${a.id}](actions/${a.id}.md) | ${a.priority || 0} | ${a.preconditions?.join(', ') || '-'} | ${a.effects?.join(', ') || '-'} |\`
).join('\n')}

## Debugging and Recovery

\`\`\`javascript
// Resume from specific state
async function resumeFromState(workDir) {
  const state = ContextManager.readState(workDir);
  console.log(\`Resuming from: \${state.current_action || 'start'}\`);
  console.log(\`Completed actions: \${state.completed_actions.join(', ')}\`);
  return runOrchestrator(workDir);
}

// Retry failed action
async function retryFailedAction(workDir) {
  const state = ContextManager.readState(workDir);
  if (state.errors.length > 0) {
    const lastError = state.errors[state.errors.length - 1];
    console.log(\`Retrying: \${lastError.action}\`);
    state.error_count = Math.max(0, state.error_count - 1);
    ContextManager.writeState(workDir, state);
    return runOrchestrator(workDir);
  }
}
\`\`\`
`;
}

// Enhanced action generation
function generateEnhancedAction(action, config, contextStrategy) {
  return `# Action: ${action.name}

${action.description || 'Execute ' + action.name + ' operation'}

## Purpose

${action.description || 'TODO: Describe the purpose of this action'}

## Preconditions

${action.preconditions?.map(p => \`- [ ] \\\`${p}\\\`\`).join('\n') || '- [ ] No special preconditions'}

## Context Access (${contextStrategy} Strategy)

\`\`\`javascript
// Read shared context
${contextStrategy === 'file' ?
  \`const sharedData = JSON.parse(Read(\\\`\${workDir}/context/shared.json\\\`));\` :
  \`const sharedData = state.context.shared || {};\`}

// Write shared context
${contextStrategy === 'file' ?
  \`Write(\\\`\${workDir}/context/shared.json\\\`, JSON.stringify(updatedData, null, 2));\` :
  \`state.context.shared = updatedData;\`}
\`\`\`

## Execution

\`\`\`javascript
async function execute(state, workDir) {
  // 1. Read necessary data
  ${contextStrategy === 'file' ?
    \`const input = JSON.parse(Read(\\\`\${workDir}/context/input.json\\\`));\` :
    \`const input = state.context.input || {};\`}

  // 2. Execute core logic
  // TODO: Implement action logic
  const result = {
    // Processing results
  };

  // 3. Save results (${contextStrategy} strategy)
  ${contextStrategy === 'file' ?
    \`Write(\\\`\${workDir}/context/${action.id.replace(/-/g, '_')}_result.json\\\`, JSON.stringify(result, null, 2));\` :
    \`// Results returned via stateUpdates\`}

  // 4. Return state updates
  return {
    status: 'completed',
    stateUpdates: {
      completed_actions: [...state.completed_actions, '${action.id}'],
      ${contextStrategy === 'memory' ? \`context: { ...state.context, ${action.id.replace(/-/g, '_')}_result: result }\` : '// File strategy: results saved to file'}
    },
    summary: '${action.name} completed'
  };
}
\`\`\`

## State Updates

\`\`\`javascript
return {
  status: 'completed',
  stateUpdates: {
    completed_actions: [...state.completed_actions, '${action.id}'],
${action.effects?.map(e => \`    // Effect: ${e}\`).join('\n') || '    // No additional effects'}
  }
};
\`\`\`

## Error Handling

| Error Type | Handling |
|------------|----------|
| Data validation failure | Return error, do not update state |
| Execution exception | Log error, increment error_count |
| Context read failure | Use default value or skip |

## Next Actions (Hints)

- Success: Determined by orchestrator based on \`ACTION_CATALOG\` priority
- Failure: Retry or \`action-abort\`
`;
}

// Generate action catalog
function generateActionCatalog(config) {
  const actions = config.autonomous_config.actions;

  return `# Action Catalog

Available action catalog for ${config.display_name} (declarative).

## Action Definition

\`\`\`json
${JSON.stringify(actions.map(a => ({
  id: a.id,
  name: a.name,
  description: a.description,
  preconditions: a.preconditions || [],
  effects: a.effects || [],
  priority: a.priority || 0
})), null, 2)}
\`\`\`

## Action Dependency Graph

\`\`\`mermaid
graph TD
${actions.map((a, i) => {
  const deps = a.preconditions?.filter(p => p.startsWith('completed_actions.includes'))
    .map(p => p.match(/'([^']+)'/)?.[1])
    .filter(Boolean) || [];

  if (deps.length === 0 && i === 0) {
    return \`    START((Start)) --> ${a.id.replace(/-/g, '_')}[${a.name}]\`;
  } else if (deps.length > 0) {
    return deps.map(d => \`    ${d.replace(/-/g, '_')} --> ${a.id.replace(/-/g, '_')}[${a.name}]\`).join('\n');
  }
  return '';
}).filter(Boolean).join('\n')}
    ${actions[actions.length-1]?.id.replace(/-/g, '_') || 'last'} --> END((End))
\`\`\`

## Selection Priority

| Priority | Action | Description |
|----------|--------|-------------|
${actions.sort((a, b) => (b.priority || 0) - (a.priority || 0)).map(a =>
  \`| ${a.priority || 0} | ${a.id} | ${a.description || a.name} |\`
).join('\n')}
`;
}
```

### Step 4: Helper Functions

```javascript
// ========== P0: Phase 0 generation function ==========
function generatePhase0Spec(config) {
  const skillRoot = '.claude/skills/skill-generator';
  const specsToRead = [
    '../_shared/SKILL-DESIGN-SPEC.md',
    `${skillRoot}/templates/*.md`
  ];

  return `# Phase 0: Specification Study

MANDATORY PREREQUISITE - This phase cannot be skipped

## Objective

Complete reading of all specification documents before generating any files, understand Skill design standards.

## Why This Matters

**Without reading specifications ()**:
\`\`\`
Skip specifications
    ├─ Does not meet standards
    ├─ Messy structure
    └─ Quality issues
\`\`\`

**With reading specifications ()**:
\`\`\`
Complete reading
    ├─ Standardized output
    ├─ High quality code
    └─ Easy to maintain
\`\`\`

## Required Reading

### P0 - Core Design Specification

\`\`\`javascript
// Universal design standards (MUST READ)
const designSpec = Read('.claude/skills/_shared/SKILL-DESIGN-SPEC.md');

// Key content checkpoints:
const checkpoints = {
  structure: 'Directory structure conventions',
  naming: 'Naming standards',
  quality: 'Quality standards',
  output: 'Output format requirements'
};
\`\`\`

### P1 - Template Files (Must read before generation)

\`\`\`javascript
// Load corresponding templates based on execution mode
const templates = {
  all: [
    'templates/skill-md.md'  // SKILL.md entry file template
  ],
  sequential: [
    'templates/sequential-phase.md'
  ],
  autonomous: [
    'templates/autonomous-orchestrator.md',
    'templates/autonomous-action.md'
  ]
};

const mode = '${config.execution_mode}';
const requiredTemplates = [...templates.all, ...templates[mode]];

requiredTemplates.forEach(template => {
  const content = Read(\`.claude/skills/skill-generator/\${template}\`);
  // Understand template structure, variable positions, generation rules
});
\`\`\`

## Execution

\`\`\`javascript
// ========== Load specifications ==========
const specs = [];

// 1. Design specification (P0)
specs.push({
  file: '../_shared/SKILL-DESIGN-SPEC.md',
  content: Read('.claude/skills/_shared/SKILL-DESIGN-SPEC.md'),
  priority: 'P0'
});

// 2. Template files (P1)
const templateFiles = Glob('.claude/skills/skill-generator/templates/*.md');
templateFiles.forEach(file => {
  specs.push({
    file: file,
    content: Read(file),
    priority: 'P1'
  });
});

// ========== Internalize specifications ==========
console.log('Reading specifications...');
specs.forEach(spec => {
  console.log(\`  [\${spec.priority}] \${spec.file}\`);
  // Understand content (no need to generate files, only memory processing)
});

// ========== Generate completion flag ==========
const result = {
  status: 'completed',
  specs_loaded: specs.length,
  timestamp: new Date().toISOString()
};

Write(\`\${workDir}/spec-study-complete.flag\`, JSON.stringify(result, null, 2));
\`\`\`

## Output

- **Flag File**: \`spec-study-complete.flag\` (proves reading completion)
- **Side Effect**: Internalize specification knowledge, subsequent phases follow standards

## Success Criteria

Completion criteria:
- [ ] Read SKILL-DESIGN-SPEC.md
- [ ] Read execution mode corresponding template files
- [ ] Understand directory structure conventions
- [ ] Understand naming standards
- [ ] Understand quality standards

## Next Phase

→ [Phase 1: Requirements Discovery](01-requirements-discovery.md)

**Key**: Only after completing specification study can Phase 1 correctly collect requirements and generate specification-compliant configurations.
`;
}

// ========== Other helper functions ==========
function toPascalCase(str) {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function getDefaultValue(type) {
  if (type.endsWith('[]')) return '[]';
  if (type === 'number') return '0';
  if (type === 'boolean') return 'false';
  if (type === 'string') return '""';
  return '{}';
}

function getTerminationCheck(condition) {
  const checks = {
    'user_exit': 'state.status === "user_exit"',
    'error_limit': 'state.error_count >= 3',
    'task_completed': 'state.status === "completed"',
    'max_iterations': 'iteration >= MAX_ITERATIONS'
  };
  return checks[condition] || `state.${condition}`;
}

function getPreconditionCheck(action) {
  if (!action.preconditions?.length) return 'true';
  return action.preconditions.map(p => `state.${p}`).join(' && ');
}
```


## Next Phase

→ [Phase 4: Specifications & Templates](04-specs-templates.md)

**Data Flow to Phase 4**:
- All phase/action files generated in phases/ directory
- Complete skill directory structure ready for specs and templates generation
- skill-config.json for reference in documentation generation
