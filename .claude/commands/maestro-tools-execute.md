---
name: maestro-tools-execute
description: Load and execute tool specs by category or name
argument-hint: "[<tool-name> | --category <category>] [--list]"
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
Load registered tool documents and execute them step-by-step.
Direct (by name) or category-based (list + select) invocation.
</purpose>

<required_reading>
@~/.maestro/workflows/tools-spec.md
</required_reading>

<context>
$ARGUMENTS — Tool name, keyword, or --category filter

**Examples**:
```
/maestro-tools-execute integration-test
/maestro-tools-execute --category coding
/maestro-tools-execute --category review --keyword api
/maestro-tools-execute
```

Empty arguments enters interactive mode: list all tools for user selection.
</context>

<invariants>
1. **Confirmation before execution** — MUST AskUserQuestion before executing tool steps; NEVER auto-execute without user consent
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
- REQUIRED: Tool document loaded and steps extracted (ref entries expanded via `maestro load --type knowhow`).
- BLOCKED if: E001 (no match found), E002 unresolved (multiple matches without user selection).

**GATE 3: Confirm → Execute**
- REQUIRED: User confirmed execution mode via AskUserQuestion (execute as-is / adjust / view only).
- BLOCKED if: user selects "View only" — display steps and END without execution.

**GATE 4: Execute → Report**
- REQUIRED: All steps attempted (completed, skipped with user approval, or aborted by user).
- REQUIRED: Results collected for each step (success/skip/fail).
- BLOCKED if: user chose abort mid-execution — report partial results and END.

### Step 1: Load Tool

**By name**:
```bash
maestro load --type spec --category coding --keyword <name>
```
Match knowhow documents with `tool: true` whose title or keywords contain the name.

**By category**:
```bash
maestro load --type spec --category <category>
```
Extract tool entries from the "Available Tools" section in output.

**Empty args**:
Load all categories, collect tool entries, present to user with AskUserQuestion for selection.

### Step 2: Display Tool

Show tool information:
- Name, category, keywords
- Steps overview (for ref entries, expand knowhow detail first)

Expand ref entries:
```bash
maestro load --type knowhow --id <knowhow-id>
```

### Step 3: Confirm Execution

AskUserQuestion (single-select, header: "执行方式"):
- **Execute as-is** (Recommended) — run all steps with current parameters
- **Adjust parameters** — modify scope or parameters before executing
- **View only** — display steps without executing

### Step 4: Step-by-Step Execution

Follow the tool definition steps in order:
1. Read current step description
2. Execute step action (file ops, commands, code changes, etc.)
3. Verify step completion
4. Report progress: `[Step N/M] done — <step_name>`
5. Proceed to next step

**Blocker handling**:
- Step fails → report error, ask user: retry / skip / abort
- Needs user input → AskUserQuestion for parameters
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

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Tool completed successfully | `/manage-status` or continue workflow |
| Want to register a new tool | `/maestro-tools-register` |
| Need to adjust tool definition | `/maestro-tools-register --optimize <name>` |
</completion>
