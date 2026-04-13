# Fix

Revision workflow for bug fixes and feedback-driven changes.

## Workflow

1. Read original task + feedback/revision notes from task description
2. Load original implementation context (files modified, approach taken)
3. Analyze feedback to identify specific changes needed
4. Apply fixes:
   - Agent mode: Edit tool for targeted changes
   - CLI mode: Resume previous session with fix prompt
5. Re-validate convergence criteria
6. Report: original task, changes applied, validation result

## Fix Prompt Template (CLI mode)

```
PURPOSE: Fix issues in <task.title> based on feedback
TASK:
  - Review original implementation
  - Apply feedback: <feedback text>
  - Verify fixes address all feedback points
MODE: write
CONTEXT: @<modified files>
EXPECTED: All feedback points addressed, convergence criteria met
CONSTRAINTS: Minimal changes | No scope creep
```

## Quality Rules

- Fix ONLY what feedback requests
- No refactoring beyond fix scope
- Verify original convergence criteria still pass
- Report partial_completion if some feedback unclear
