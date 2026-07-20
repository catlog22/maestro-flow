---
role: diagnoser
prefix: DIAG
inner_loop: false
message_types: "[state_update]"
---

# State Diagnoser

## Phase 2: Context & Complexity Assessment

1. Load scan report from `{run_dir}/outputs/scan-report.md`
2. Load scanner state via `team_msg(operation="get_state", session_id=<run-id>, role="scanner")`

### Wisdom Input

1. Read `{run_dir}/work/team/wisdom/patterns/ui-feedback.md` and `{run_dir}/work/team/wisdom/patterns/state-management.md` if available
2. Use patterns to identify root causes of UI interaction issues
3. Reference `{run_dir}/work/team/wisdom/anti-patterns/common-ux-pitfalls.md` for common causes

3. Assess issue complexity:

| Complexity | Criteria | Strategy |
|------------|----------|----------|
| High | 5+ issues, cross-component state | CLI delegation |
| Medium | 2-4 issues, single component | CLI for analysis |
| Low | 1 issue, simple pattern | Inline analysis |

### Complex Analysis (use CLI)

For complex multi-file state management issues:

```
Bash(`maestro delegate "PURPOSE: Analyze state management patterns and identify root causes
CONTEXT: @<issue-files>
EXPECTED: Root cause analysis with fix recommendations
CONSTRAINTS: Focus on reactive update patterns" --tool agy --mode analysis`)
```

## Phase 3: Root Cause Analysis

For each issue from scan report:

### State Management Diagnosis

| Pattern | Root Cause | Fix Strategy |
|---------|------------|--------------|
| Array.splice/push | Direct mutation, no reactive trigger | Use filter/map/spread for new array |
| Object property change | Direct mutation | Use spread operator or reactive API |
| Missing useState/ref | No state tracking | Add state variable |
| Stale closure | Captured old state value | Use functional setState or ref.current |

### Event Binding Diagnosis

| Pattern | Root Cause | Fix Strategy |
|---------|------------|--------------|
| onClick without handler | Missing event binding | Add event handler function |
| Async without await | Unhandled promise | Add async/await or .then() |
| No error catching | Uncaught exceptions | Wrap in try/catch |
| Event propagation issue | stopPropagation missing | Add event.stopPropagation() |

### Async Handling Diagnosis

| Pattern | Root Cause | Fix Strategy |
|---------|------------|--------------|
| No loading state | Missing async state tracking | Add isLoading state |
| No error handling | Missing catch block | Add try/catch with error state |
| Race condition | Multiple concurrent requests | Add request cancellation or debounce |

### Visual Design Diagnosis

| Pattern | Root Cause | Fix Strategy |
|---------|------------|--------------|
| Pure black/white colors | No intentional color system | Introduce OKLCH palette with tinted neutrals |
| Generic font usage | Default font selection | Replace with distinctive alternatives from recommended list |
| Missing interaction states | Incomplete component design | Add all 8 states per Impeccable spec |
| Layout animations | Wrong animation properties | Switch to transform + opacity, add will-change via JS |
| No reduced-motion | Accessibility oversight | Add @media (prefers-reduced-motion: reduce) global query |
| All buttons primary | No hierarchy design | Establish primary/secondary/tertiary button system |
| Monotonous spacing | No spacing system | Implement 4pt scale with rhythm variation |
| Nested cards | Over-containment | Flatten to spacing + dividers |
| Missing focus-visible | Outdated focus handling | Replace :focus with :focus-visible, add ring spec |

## Phase 4: Diagnosis Report

1. Generate root cause analysis for each issue and write to `{run_dir}/outputs/diagnosis.md`

### Wisdom Contribution

If new root cause patterns discovered:
1. Write diagnosis patterns to `{run_dir}/work/team/wisdom/contributions/diagnoser-patterns-<timestamp>.md`
2. Format: Symptom, root cause, detection method, fix approach

3. Share state via team_msg:
   ```
   team_msg(operation="log", session_id=<run-id>, from="diagnoser",
            type="state_update", data={
              diagnosed_issues: <count>,
              pattern_types: {
                state_management: <count>,
                event_binding: <count>,
                async_handling: <count>,
                visual_design: <count>
              }
            })
   ```
