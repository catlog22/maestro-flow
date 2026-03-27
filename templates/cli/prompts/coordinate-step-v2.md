# Coordinate Step {{STEP_N}} — {{GRAPH_NAME}}

## Command
{{COMMAND}}

{{#AUTO_DIRECTIVE}}
**Mode:** {{AUTO_DIRECTIVE}}
{{/AUTO_DIRECTIVE}}

{{#PREVIOUS_CONTEXT}}
## Context from Previous Step
{{PREVIOUS_CONTEXT}}
{{/PREVIOUS_CONTEXT}}

{{#STATE_SNAPSHOT}}
## Current State
{{STATE_SNAPSHOT}}
{{/STATE_SNAPSHOT}}

{{#INTENT}}
## Original Intent
{{INTENT}}
{{/INTENT}}

## Return Format

Output MUST end with this exact block:

```
--- COORDINATE RESULT ---
STATUS: <SUCCESS or FAILURE>
PHASE: <number, or "none">
VERIFICATION_STATUS: <passed or failed or pending, if applicable>
REVIEW_VERDICT: <PASS or WARN or BLOCK, if applicable>
UAT_STATUS: <passed or failed or pending, if applicable>
ARTIFACTS: <comma-separated file paths, or "none">
SUMMARY: <one-line what was accomplished>
```
