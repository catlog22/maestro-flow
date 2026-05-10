---
name: maestro-tools-register
description: Register tool specs - extract, generate, or optimize
argument-hint: "[description]"
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
Register tool specs — extract, generate, or optimize reusable process/tool definitions into `.workflow/specs/tools.md`.
Long processes auto-use ref mode (knowhow detail doc + spec index entry).
</purpose>

<context>
$ARGUMENTS — Intent description

**Modes**:
- Extract: pull processes from code/conversations/docs
- Generate: create new tool definition from description
- Optimize: improve existing tool steps and structure

**Output format**:
- Short process (<10 steps) → inline `<spec-entry roles="..." ...>`
- Long process (>=10 steps) → ref mode (knowhow/RCP-*.md + spec index)

**Examples**:
```
/maestro-tools-register generate API integration test standard flow
/maestro-tools-register extract deployment flow from this project
/maestro-tools-register optimize integration-test tool
```
</context>

<execution>
Follow '.codex/skills/maestro-tools-register/SKILL.md' completely.
</execution>
