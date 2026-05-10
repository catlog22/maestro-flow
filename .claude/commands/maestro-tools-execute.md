---
name: maestro-tools-execute
description: Load and execute tool specs by role or name
argument-hint: "[tool-name | --role <role>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---
<purpose>
Load registered tool specs and execute step-by-step. Supports direct invocation by name or role-based recommendation.
</purpose>

<context>
$ARGUMENTS — Tool name, keyword, or --role

**Invocation**:
- By name: `/maestro-tools-execute integration-test`
- By role: `/maestro-tools-execute --role implement`
- Interactive: `/maestro-tools-execute` (lists all tools for selection)

**Execution flow**:
1. Load tool definition (ref entries auto-expand knowhow detail)
2. Display steps, confirm execution
3. Execute step-by-step with progress reporting
4. Handle blockers interactively
</context>

<execution>
Follow '.codex/skills/maestro-tools-execute/SKILL.md' completely.
</execution>
