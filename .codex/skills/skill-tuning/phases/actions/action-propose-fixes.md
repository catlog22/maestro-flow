
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Propose Fixes

Generate fix proposals for identified issues with implementation strategies.

## Purpose

- Create fix strategies for each issue
- Generate implementation plans
- Estimate risk levels
- Allow user to select fixes to apply

## Preconditions

- [ ] state.status === 'running'
- [ ] state.issues.length > 0
- [ ] action-generate-report completed

## Fix Strategy Catalog

### Context Explosion Fixes

| Strategy | Description | Risk |
|----------|-------------|------|
| `context_summarization` | Add summarizer agent between phases | low |
| `sliding_window` | Keep only last N turns in context | low |
| `structured_state` | Replace text context with JSON state | medium |
| `path_reference` | Pass file paths instead of content | low |

### Memory Loss Fixes

| Strategy | Description | Risk |
|----------|-------------|------|
| `constraint_injection` | Add constraints to each phase prompt | low |
| `checkpoint_restore` | Save state at milestones | low |
| `goal_embedding` | Track goal similarity throughout | medium |
| `state_constraints_field` | Add constraints field to state schema | low |

### Data Flow Fixes

| Strategy | Description | Risk |
|----------|-------------|------|
| `state_centralization` | Single state.json for all data | medium |
| `schema_enforcement` | Add Zod validation | low |
| `field_normalization` | Normalize field names | low |
| `transactional_updates` | Atomic state updates | medium |

### Agent Coordination Fixes

| Strategy | Description | Risk |
|----------|-------------|------|
| `error_wrapping` | Add try-catch to all Task calls | low |
| `result_validation` | Validate agent returns | low |
| `orchestrator_refactor` | Centralize agent coordination | high |
| `flatten_nesting` | Remove nested agent calls | medium |

## Execution

```javascript
async function execute(state, workDir) {
  console.log('Generating fix proposals...');

  const issues = state.issues;
  const fixes = [];

  // Group issues by type for batch fixes
  const issuesByType = {
    context_explosion: issues.filter(i => i.type === 'context_explosion'),
    memory_loss: issues.filter(i => i.type === 'memory_loss'),
    dataflow_break: issues.filter(i => i.type === 'dataflow_break'),
    agent_failure: issues.filter(i => i.type === 'agent_failure')
  };

  // Generate fixes for context explosion
  if (issuesByType.context_explosion.length > 0) {
    const ctxIssues = issuesByType.context_explosion;

    if (ctxIssues.some(i => i.description.includes('history accumulation'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: ctxIssues.filter(i => i.description.includes('history')).map(i => i.id),
        strategy: 'sliding_window',
        description: 'Implement sliding window for conversation history',
        rationale: 'Prevents unbounded context growth by keeping only recent turns',
        changes: [{
          file: 'phases/orchestrator.md',
          action: 'modify',
          diff: `+ const MAX_HISTORY = 5;
+ state.history = state.history.slice(-MAX_HISTORY);`
        }],
        risk: 'low',
        estimated_impact: 'Reduces token usage by ~50%',
        verification_steps: ['Run skill with 10+ iterations', 'Verify context size stable']
      });
    }

    if (ctxIssues.some(i => i.description.includes('full content'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: ctxIssues.filter(i => i.description.includes('content')).map(i => i.id),
        strategy: 'path_reference',
        description: 'Pass file paths instead of full content',
        rationale: 'Agents can read files when needed, reducing prompt size',
        changes: [{
          file: 'phases/*.md',
          action: 'modify',
          diff: `- prompt: \${content}
+ prompt: Read file at: \${filePath}`
        }],
        risk: 'low',
        estimated_impact: 'Significant token reduction',
        verification_steps: ['Verify agents can still access needed content']
      });
    }
  }

  // Generate fixes for memory loss
  if (issuesByType.memory_loss.length > 0) {
    const memIssues = issuesByType.memory_loss;

    if (memIssues.some(i => i.description.includes('constraint'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: memIssues.filter(i => i.description.includes('constraint')).map(i => i.id),
        strategy: 'constraint_injection',
        description: 'Add constraint injection to all phases',
        rationale: 'Ensures original requirements are visible in every phase',
        changes: [{
          file: 'phases/*.md',
          action: 'modify',
          diff: `+ [CONSTRAINTS]
+ Original requirements from state.original_requirements:
+ \${JSON.stringify(state.original_requirements)}`
        }],
        risk: 'low',
        estimated_impact: 'Improves constraint adherence',
        verification_steps: ['Run skill with specific constraints', 'Verify output matches']
      });
    }

    if (memIssues.some(i => i.description.includes('State schema'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: memIssues.filter(i => i.description.includes('schema')).map(i => i.id),
        strategy: 'state_constraints_field',
        description: 'Add original_requirements field to state schema',
        rationale: 'Preserves original intent throughout execution',
        changes: [{
          file: 'phases/state-schema.md',
          action: 'modify',
          diff: `+ original_requirements: string[];  // User's original constraints
+ goal_summary: string;              // One-line goal statement`
        }],
        risk: 'low',
        estimated_impact: 'Enables constraint tracking',
        verification_steps: ['Verify state includes requirements after init']
      });
    }
  }

  // Generate fixes for data flow
  if (issuesByType.dataflow_break.length > 0) {
    const dfIssues = issuesByType.dataflow_break;

    if (dfIssues.some(i => i.description.includes('multiple locations'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: dfIssues.filter(i => i.description.includes('location')).map(i => i.id),
        strategy: 'state_centralization',
        description: 'Centralize all state to single state.json',
        rationale: 'Single source of truth prevents inconsistencies',
        changes: [{
          file: 'phases/*.md',
          action: 'modify',
          diff: `- Write(\`\${workDir}/config.json\`, ...)
+ updateState({ config: ... })  // Use state manager`
        }],
        risk: 'medium',
        estimated_impact: 'Eliminates state fragmentation',
        verification_steps: ['Verify all reads come from state.json', 'Test state persistence']
      });
    }

    if (dfIssues.some(i => i.description.includes('validation'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: dfIssues.filter(i => i.description.includes('validation')).map(i => i.id),
        strategy: 'schema_enforcement',
        description: 'Add Zod schema validation',
        rationale: 'Runtime validation catches schema violations',
        changes: [{
          file: 'phases/state-schema.md',
          action: 'modify',
          diff: `+ import { z } from 'zod';
+ const StateSchema = z.object({...});
+ function validateState(s) { return StateSchema.parse(s); }`
        }],
        risk: 'low',
        estimated_impact: 'Catches invalid state early',
        verification_steps: ['Test with invalid state input', 'Verify error thrown']
      });
    }
  }

  // Generate fixes for agent coordination
  if (issuesByType.agent_failure.length > 0) {
    const agentIssues = issuesByType.agent_failure;

    if (agentIssues.some(i => i.description.includes('error handling'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: agentIssues.filter(i => i.description.includes('error')).map(i => i.id),
        strategy: 'error_wrapping',
        description: 'Wrap all Task calls in try-catch',
        rationale: 'Prevents cascading failures from agent errors',
        changes: [{
          file: 'phases/*.md',
          action: 'modify',
          diff: `+ try {
    const result = await spawn_agent({ task_name: "<task_name>", message: "<message>" });
+   if (!result) throw new Error('Empty result');
+ } catch (e) {
+   updateState({ errors: [...errors, e.message], error_count: error_count + 1 });
+ }`
        }],
        risk: 'low',
        estimated_impact: 'Improves error resilience',
        verification_steps: ['Simulate agent failure', 'Verify graceful handling']
      });
    }

    if (agentIssues.some(i => i.description.includes('nested'))) {
      fixes.push({
        id: `FIX-${fixes.length + 1}`,
        issue_ids: agentIssues.filter(i => i.description.includes('nested')).map(i => i.id),
        strategy: 'flatten_nesting',
        description: 'Flatten nested agent calls',
        rationale: 'Reduces complexity and context explosion',
        changes: [{
          file: 'phases/orchestrator.md',
          action: 'modify',
          diff: `// Instead of agent calling agent:
// Agent A returns {needs_agent_b: true}
// Orchestrator sees this and calls Agent B next`
        }],
        risk: 'medium',
        estimated_impact: 'Reduces nesting depth',
        verification_steps: ['Verify no nested Task calls', 'Test agent chaining via orchestrator']
      });
    }
  }

  // Write fix proposals
  Write(`${workDir}/fixes/fix-proposals.json`, JSON.stringify(fixes, null, 2));

  // Ask user to select fixes to apply
  const fixOptions = fixes.slice(0, 4).map(f => ({
    label: f.id,
    description: `[${f.risk.toUpperCase()} risk] ${f.description}`
  }));

  if (fixOptions.length > 0) {
    const selection = await request_user_input({
      questions: [{
        question: 'Which fixes would you like to apply?',
        header: 'Fixes',
        multiSelect: true,
        options: fixOptions
      }]
    });

    const selectedFixIds = Array.isArray(selection['Fixes'])
      ? selection['Fixes']
      : [selection['Fixes']];

    return {
      stateUpdates: {
        proposed_fixes: fixes,
        pending_fixes: selectedFixIds.filter(id => id && fixes.some(f => f.id === id))
      },
      outputFiles: [`${workDir}/fixes/fix-proposals.json`],
      summary: `Generated ${fixes.length} fix proposals, ${selectedFixIds.length} selected for application`
    };
  }

  return {
    stateUpdates: {
      proposed_fixes: fixes,
      pending_fixes: []
    },
    outputFiles: [`${workDir}/fixes/fix-proposals.json`],
    summary: `Generated ${fixes.length} fix proposals (none selected)`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    proposed_fixes: [...fixes],
    pending_fixes: [...selectedFixIds]
  }
};
```

## Error Handling

| Error Type | Recovery |
|------------|----------|
| No issues to fix | Skip to action-complete |
| User cancels selection | Set pending_fixes to empty |

## Next Actions

- If pending_fixes.length > 0: action-apply-fix
- If pending_fixes.length === 0: action-complete
