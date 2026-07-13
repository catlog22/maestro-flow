

# Autonomous Action Template

Template for action files in Autonomous execution mode.

## Purpose

Generate Action files for Autonomous execution mode, defining independent executable action units.

## Usage Context

| Phase | Usage |
|-------|-------|
| Phase 3 (Phase Generation) | Generated when `config.execution_mode === 'autonomous'` |
| Generation Trigger | Generate one action file for each `config.autonomous_config.actions` |
| Output Location | `.claude/skills/{skill-name}/phases/actions/{action-id}.md` |

---

## Template Structure

```markdown
# Action: {{action_name}}

{{action_description}}

## Purpose

{{purpose}}

## Preconditions

{{preconditions_list}}

## Scripts

\`\`\`yaml
# Declare scripts used in this action (optional)
# - script-id        # Corresponds to scripts/script-id.py or .sh
\`\`\`

## Execution

\`\`\`javascript
async function execute(state) {
  {{execution_code}}

  // Script execution example
  // const result = await ExecuteScript('script-id', { input: state.context.data });
  // if (!result.success) throw new Error(result.stderr);
}
\`\`\`

## State Updates

\`\`\`javascript
return {
  stateUpdates: {
    {{state_updates}}
  }
};
\`\`\`

## Error Handling

| Error Type | Recovery |
|------------|----------|
{{error_handling_table}}

## Next Actions (Hints)

{{next_actions_hints}}
```

## Variable Descriptions

| Variable | Description |
|----------|-------------|
| `{{action_name}}` | Action name |
| `{{action_description}}` | Action description |
| `{{purpose}}` | Detailed purpose |
| `{{preconditions_list}}` | List of preconditions |
| `{{execution_code}}` | Execution code |
| `{{state_updates}}` | State updates |
| `{{error_handling_table}}` | Error handling table |
| `{{next_actions_hints}}` | Next action hints |

## Action Lifecycle

```
State-driven execution flow:

  state.status === 'pending'
       |
       v
  +-- Init --+          <- 1 execution, environment preparation
  | Create working directory
  | Initialize context
  | status -> running
  +----+----+
       |
       v
  +-- CRUD Loop --+     <- N iterations, core business
  | Orchestrator selects action  |    List / Create / Edit / Delete
  | execute(state)  |    Shared pattern: collect input -> operate context.items -> return updates
  | Update state
  +----+----+
       |
       v
  +-- Complete --+      <- 1 execution, save results
  | Serialize output
  | status -> completed
  +----------+

Shared state structure:
  state.status          -> 'pending' | 'running' | 'completed'
  state.context.items   -> Business data array
  state.completed_actions -> List of executed action IDs
```

## Action Type Templates

### 1. Initialize Action (Init)

**Trigger condition**: `state.status === 'pending'`, executes once

```markdown
# Action: Initialize

Initialize Skill execution state.

## Purpose

Set initial state, prepare execution environment.

## Preconditions

- [ ] state.status === 'pending'

## Execution

\`\`\`javascript
async function execute(state) {
  Bash(\`mkdir -p "\${workDir}"\`);

  return {
    stateUpdates: {
      status: 'running',
      started_at: new Date().toISOString(),
      context: { items: [], metadata: {} }
    }
  };
}
\`\`\`

## Next Actions

- Success: Enter main processing loop (Orchestrator selects first CRUD action)
- Failure: action-abort
```

### 2. CRUD Actions (List / Create / Edit / Delete)

**Trigger condition**: `state.status === 'running'`, loop until user exits

> Example shows Create action demonstrating shared pattern. List / Edit / Delete follow same structure with different execution logic and state update fields.

```markdown
# Action: Create Item

Create new item.

## Purpose

Collect user input, append new record to context.items.

## Preconditions

- [ ] state.status === 'running'

## Execution

\`\`\`javascript
async function execute(state) {
  // 1. Collect input
  const input = await AskUserQuestion({
    questions: [{
      question: "Please enter item name:",
      header: "Name",
      multiSelect: false,
      options: [{ label: "Manual input", description: "Enter custom name" }]
    }]
  });

  // 2. Operate context.items (core logic differs by action type)
  const newItem = {
    id: Date.now().toString(),
    name: input["Name"],
    status: 'pending',
    created_at: new Date().toISOString()
  };

  // 3. Return state update
  return {
    stateUpdates: {
      context: {
        ...state.context,
        items: [...(state.context.items || []), newItem]
      },
      last_action: 'create'
    }
  };
}
\`\`\`

## Next Actions

- Continue operations: Orchestrator selects next action based on state
- User exit: action-complete
```

**Other CRUD Actions Differences:**

| Action | Core Logic | Extra Preconditions | Key State Field |
|--------|-----------|-------------------|-----------------|
| List | `items.forEach(-> console.log)` | None | `current_view: 'list'` |
| Create | `items.push(newItem)` | None | `last_created_id` |
| Edit | `items.map(-> replace matching)` | `selected_item_id !== null` | `updated_at` |
| Delete | `items.filter(-> exclude matching)` | `selected_item_id !== null` | Confirm dialog -> execute |

### 3. Complete Action

**Trigger condition**: User explicitly exits or termination condition met, executes once

```markdown
# Action: Complete

Complete task and exit.

## Purpose

Serialize final state, end Skill execution.

## Preconditions

- [ ] state.status === 'running'

## Execution

\`\`\`javascript
async function execute(state) {
  Write(\`\${workDir}/final-output.json\`, JSON.stringify(state.context, null, 2));

  const summary = {
    total_items: state.context.items?.length || 0,
    duration: Date.now() - new Date(state.started_at).getTime(),
    actions_executed: state.completed_actions.length
  };

  console.log(\`Task complete: \${summary.total_items} items, \${summary.actions_executed} operations\`);

  return {
    stateUpdates: {
      status: 'completed',
      completed_at: new Date().toISOString(),
      summary
    }
  };
}
\`\`\`

## Next Actions

- None (terminal state)
```

## Generation Function

```javascript
function generateAction(actionConfig, skillConfig) {
  return `# Action: ${actionConfig.name}

${actionConfig.description || `Execute ${actionConfig.name} operation`}

## Purpose

${actionConfig.purpose || 'TODO: Describe detailed purpose of this action'}

## Preconditions

${actionConfig.preconditions?.map(p => `- [ ] ${p}`).join('\n') || '- [ ] No special preconditions'}

## Execution

\`\`\`javascript
async function execute(state) {
  // TODO: Implement action logic

  return {
    stateUpdates: {
      completed_actions: [...state.completed_actions, '${actionConfig.id}']
    }
  };
}
\`\`\`

## State Updates

\`\`\`javascript
return {
  stateUpdates: {
    // TODO: Define state updates
${actionConfig.effects?.map(e => `    // Effect: ${e}`).join('\n') || ''}
  }
};
\`\`\`

## Error Handling

| Error Type | Recovery |
|------------|----------|
| Data validation failed | Return error, no state update |
| Execution exception | Log error, increment error_count |

## Next Actions (Hints)

- Success: Orchestrator decides based on state
- Failure: Retry or action-abort
`;
}
```
