---
name: maestro-tools-execute
description: Load and execute tool specs by role or name
argument-hint: "[tool-name | --category <category>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Load registered tool specs and execute them step-by-step. Two invocation modes:

1. **Direct** — Specify tool name, load full steps, execute sequentially
2. **Category-based** — List available tools for a category, user selects, then execute

Execution follows the tool definition steps in order, reporting progress per step and asking user on blockers.
</purpose>

<context>
$ARGUMENTS — Tool name, keyword, or --category filter

```bash
$maestro-tools-execute "integration-test"
$maestro-tools-execute "--category coding"
$maestro-tools-execute "--category review --keyword api"
$maestro-tools-execute
```

Empty arguments enters interactive mode: list all tools for user selection.
</context>

<execution>

### Step 1: Load Tool

**By name**:
```bash
maestro spec load --category coding --keyword <name>
```
Match tool entries whose title or keywords contain the name.

**By category**:
```bash
maestro spec load --category <category>
```
Extract tool entries from output, list available tools.

**Empty args**:
Load all tool entries, present to user with request_user_input for selection.

### Step 2: Display Tool

Show tool information:
- Name, category, keywords
- Steps overview (for ref entries, expand knowhow detail first)

Expand ref entries:
```bash
maestro wiki load <knowhow-id>
```

### Step 3: Confirm Execution

Ask user:
- Execute steps as-is?
- Adjust parameters/scope?
- View only, do not execute?

### Step 4: Step-by-Step Execution

Follow the tool definition steps in order:
1. Read current step description
2. Execute step action (file ops, commands, code changes, etc.)
3. Verify step completion
4. Report progress: `[Step N/M] done — <step_name>`
5. Proceed to next step

**Blocker handling**:
- Step fails → report error, ask user: retry / skip / abort
- Needs user input → request_user_input for parameters
- Prerequisites unmet → show missing items, ask how to proceed

### Step 5: Report Results

After completion, output:
- Completed steps list
- Skipped/failed steps (if any)
- Artifacts produced (generated files, test results, etc.)
- Suggested next actions

</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | No matching tool found — check name/keyword |
| E002 | warning | Multiple tools match — list options for user selection |
| E003 | warning | Step execution failed — ask user how to proceed |
</error_codes>

<success_criteria>
- [ ] Tool correctly loaded (ref expanded if applicable)
- [ ] User confirmed before execution starts
- [ ] Each step has progress feedback
- [ ] Blockers handled interactively
- [ ] Results reported clearly
</success_criteria>
