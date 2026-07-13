
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task

## Signal Detection

### Phase Count

| Keywords | Inferred Phase Count |
|----------|---------------------|
| "phase 1", "phase 2", ... | Explicit phase count from numbers |
| "milestone", "milestone 1/2/3" | Count milestones |
| "first ... then ... finally" | 3 phases |
| "step 1/2/3" | Count steps |
| No phase keywords | Default: 1 phase |

### Depth Setting

| Keywords | Depth |
|----------|-------|
| "quick", "fast", "simple", "minimal" | quick |
| "thorough", "comprehensive", "complete", "full" | comprehensive |
| default | standard |

### Gate Configuration

| Keywords | Gate |
|----------|------|
| "review each plan", "approve plan", "check before execute" | plan_check: true |
| "review each phase", "approve phase", "check between phases" | phase_check: true |
| "auto", "automated", "no review", "fully automated" | all gates: false |
| default | plan_check: false, phase_check: false |

### Pipeline Mode

| Keywords | Mode |
|----------|------|
| "interactive", "step by step", "with approval" | interactive |
| default | auto |

## Output

Write coordinator state to memory (not a file). Structure:

```json
{
  "pipeline_mode": "auto | interactive",
  "phase_count": 1,
  "depth": "quick | standard | comprehensive",
  "gates": {
    "plan_check": false,
    "phase_check": false
  },
  "task_description": "<original task text>",
  "notes": ["<any detected constraints or special requirements>"]
}
```

This state is passed to `commands/dispatch.md` and written to `config.json` in the session directory.
