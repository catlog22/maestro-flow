---
name: maestro-tools-execute
description: Load and execute tool specs by role or name
argument-hint: "[tool-name | --category <category>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
version: 0.5.50
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

**Output boundary**: File writes are governed by the individual tool's step definitions. This command itself writes NO files beyond what the loaded tool prescribes.
</context>

<invariants>
1. **Confirmation before execution** — MUST request_user_input before executing tool steps; NEVER auto-execute without user consent
2. **Sequential step execution** — steps MUST be executed in defined order; NEVER skip or reorder steps unless user explicitly requests skip
3. **Blocker escalation** — step failure MUST be reported to user with retry/skip/abort options; NEVER silently skip failed steps
4. **Read-only tool definition** — tool execution MUST NOT modify the tool's knowhow document or spec entry; only the target codebase is modified per tool steps
5. **Progress feedback** — each completed step MUST report `[Step N/M] done — <step_name>`; NEVER execute silently
6. **Output boundary** — file writes are governed by the individual tool's step definitions. This command itself writes NO files beyond what the loaded tool prescribes
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Load**
- REQUIRED: Tool name, keyword, or --category parsed from arguments (or empty for interactive mode).
- BLOCKED if: invalid category value.

**GATE 2: Load → Confirm**
- REQUIRED: Exactly one tool resolved (direct match or user selection from candidates).
- REQUIRED: Tool document loaded and steps extracted (ref entries expanded).
- BLOCKED if: E001 (no match found), E002 unresolved (multiple matches without user selection).

**GATE 3: Confirm → Execute**
- REQUIRED: User confirmed execution mode via request_user_input (execute / adjust / view only).
- BLOCKED if: user selects "View only" — display steps and END without execution.

**GATE 4: Execute → Report**
- REQUIRED: All steps attempted (completed, skipped with user approval, or aborted by user).
- REQUIRED: Results collected for each step (success/skip/fail).
- BLOCKED if: user chose abort mid-execution — report partial results and END.

### Step 1: Load Tool

**By name** (search all categories first, then filter):
```bash
maestro search "<name>" --type spec
```
Match tool entries whose title or keywords contain the name across all categories. If no results, retry with `maestro search "<name>" --type knowhow`. Present matches to user if multiple found.

**By category**:
```bash
maestro load --type spec --category <category>
```
Extract tool entries from output, list available tools.

**Empty args**:
Search all tool entries across all categories:
```bash
maestro search "tool" --type knowhow
```
Present to user with request_user_input for selection.

### Step 2: Display Tool

Show tool information:
- Name, category, keywords
- Steps overview (for ref entries, expand knowhow detail first)

Expand ref entries:
```bash
maestro load --type knowhow --id <knowhow-id>
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
