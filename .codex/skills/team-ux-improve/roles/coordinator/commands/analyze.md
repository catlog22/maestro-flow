# Analyze Task

## Signal Detection

| Keywords | Signal | Pipeline Hint |
|----------|--------|---------------|
| button, click, tap, unresponsive | interaction-issues | standard |
| loading, spinner, feedback, progress | feedback-missing | standard |
| state, refresh, update, stale | state-issues | standard |
| form, input, validation, error | input-issues | standard |
| accessibility, a11y, keyboard, screen reader | accessibility | standard |
| performance, slow, lag, freeze | performance | standard |
| all, full, complete, comprehensive | full-scope | standard |

## Framework Detection

| Keywords | Framework |
|----------|-----------|
| react, jsx, tsx, useState, useEffect | React |
| vue, .vue, ref(), reactive(), v-model | Vue |
| angular, ng-, @Component | Angular |
| Default | auto-detect |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Single component scope | +1 |
| Multiple components | +2 |
| Full project scope | +3 |
| Accessibility required | +1 |
| Performance issues | +1 |
| Complex state management | +1 |

Results: 1-2 Low (targeted fix), 3-4 Medium (standard pipeline), 5+ High (full pipeline)

## Scope Determination

| Signal | Pipeline Mode |
|--------|---------------|
| Specific component or file mentioned | targeted |
| Multiple issues or general project | standard |
| "Full audit" or "complete scan" | standard |
| Unclear | ask user |

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "standard",
  "project_path": "<detected-or-provided-path>",
  "framework": "<react|vue|angular|auto>",
  "scope": "<detected-scope>",
  "issue_signals": ["interaction", "feedback", "state"],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
