# Orchestrator

State-driven orchestrator for autonomous skill-tuning workflow.

## Role

Read state → Select action → Execute → Update → Repeat until termination.

## Decision Logic

### Termination Checks (priority order)

| Condition | Action |
|-----------|--------|
| `status === 'user_exit'` | null (exit) |
| `status === 'completed'` | null (exit) |
| `error_count >= max_errors` | action-abort |
| `iteration_count >= max_iterations` | action-complete |
| `quality_gate === 'pass'` | action-complete |

### Action Selection

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | `status === 'pending'` | action-init |
| 2 | Init done, req analysis missing | action-analyze-requirements |
| 3 | Req needs clarification | null (wait) |
| 4 | Req coverage unsatisfied | action-agy-analysis |
| 5 | Agy requested/critical issues | action-agy-analysis |
| 6 | Agy running | null (wait) |
| 7 | Diagnosis pending (in order) | action-diagnose-{type} |
| 8 | All diagnosis done, no report | action-generate-report |
| 9 | Report done, issues exist | action-propose-fixes |
| 10 | Pending fixes exist | action-apply-fix |
| 11 | Fixes need verification | action-verify |
| 12 | New iteration needed | action-diagnose-context (restart) |
| 13 | Default | action-complete |

**Diagnosis Order**: context → memory → dataflow → agent → docs → token_consumption

**Agy Triggers**:
- `agy_analysis_requested === true`
- Critical issues detected
- Focus areas include: architecture, prompt, performance, custom
- Second iteration with unresolved issues

## State Management

```javascript
// Read
const state = JSON.parse(Read(`${workDir}/state.json`));

// Update (with sliding window for history)
function updateState(workDir, updates) {
  const state = JSON.parse(Read(`${workDir}/state.json`));
  const newState = {
    ...state,
    ...updates,
    updated_at: new Date().toISOString()
  };
  Write(`${workDir}/state.json`, JSON.stringify(newState, null, 2));
  return newState;
}
```

## Execution Loop

```javascript
async function runOrchestrator(workDir) {
  let iteration = 0;
  const MAX_LOOP = 50;

  while (iteration++ < MAX_LOOP) {
    // 1. Read state
    const state = JSON.parse(Read(`${workDir}/state.json`));

    // 2. Select action
    const actionId = selectNextAction(state);
    if (!actionId) break;

    // 3. Update: mark current action (sliding window)
    updateState(workDir, {
      current_action: actionId,
      action_history: [...state.action_history, {
        action: actionId,
        started_at: new Date().toISOString()
      }].slice(-10)  // Keep last 10
    });

    // 4. Execute action
    try {
      const actionPrompt = Read(`phases/actions/${actionId}.md`);

      // Pass state path + key fields (not full state)
      const stateKeyInfo = {
        status: state.status,
        iteration_count: state.iteration_count,
        quality_gate: state.quality_gate,
        target_skill: { name: state.target_skill.name, path: state.target_skill.path }
      };

      const result = await Agent({
        subagent_type: 'universal-executor',
        description: `Execute skill-tuning action: ${actionId}`,
        run_in_background: false,
        prompt: `
[CONTEXT]
Action: ${actionId}
Work directory: ${workDir}

[STATE KEY INFO]
${JSON.stringify(stateKeyInfo, null, 2)}

[FULL STATE PATH]
${workDir}/state.json
(Read full state from this file if needed)

[ACTION INSTRUCTIONS]
${actionPrompt}

[OUTPUT]
Return JSON: { stateUpdates: {}, outputFiles: [], summary: "..." }
`
      });

      // 5. Parse result
      let actionResult = result;
      try { actionResult = JSON.parse(result); } catch {}

      // 6. Update: mark complete
      updateState(workDir, {
        current_action: null,
        completed_actions: [...state.completed_actions, actionId],
        ...actionResult.stateUpdates
      });

    } catch (error) {
      // Error handling (sliding window for errors)
      updateState(workDir, {
        current_action: null,
        errors: [...state.errors, {
          action: actionId,
          message: error.message,
          timestamp: new Date().toISOString()
        }].slice(-5),  // Keep last 5
        error_count: state.error_count + 1
      });
    }
  }
}
```

## Action Preconditions

| Action | Precondition |
|--------|-------------|
| action-init | status='pending' |
| action-analyze-requirements | Init complete, not done |
| action-diagnose-* | status='running', focus area includes type |
| action-agy-analysis | Requested OR critical issues OR high complexity |
| action-generate-report | All diagnosis complete |
| action-propose-fixes | Report generated, issues > 0 |
| action-apply-fix | pending_fixes > 0 |
| action-verify | applied_fixes with pending verification |
| action-complete | Quality gates pass OR max iterations |
| action-abort | error_count >= max_errors |

## User Interaction Points

1. **action-init**: Confirm target skill, describe issue
2. **action-propose-fixes**: Select which fixes to apply
3. **action-verify**: Review verification, decide to continue or stop
4. **action-complete**: Review final summary

## Error Recovery

| Error Type | Strategy |
|------------|----------|
| Action execution failed | Retry up to 3 times, then skip |
| State parse error | Restore from backup |
| File write error | Retry with alternative path |
| User abort | Save state and exit gracefully |

## Termination Conditions

- Normal: `status === 'completed'`, `quality_gate === 'pass'`
- User: `status === 'user_exit'`
- Error: `status === 'failed'`, `error_count >= max_errors`
- Iteration limit: `iteration_count >= max_iterations`
- Clarification wait: `requirement_analysis.status === 'needs_clarification'` (pause, not terminate)
