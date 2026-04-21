---
name: maestro-quick
description: Fast-track single task execution with workflow guarantees — analyze, plan, execute in one pass
argument-hint: "\"task description\" [--discuss] [--full]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
---

<purpose>
Shortened pipeline for well-understood tasks. Creates a scratch directory, runs quick analysis, generates a plan, executes tasks, and optionally verifies results. Single agent, sequential flow — no CSV waves needed.

**Pipeline**: `[discuss] → analyze-q → plan → execute → [verify]`

Quick tasks default to minimal interaction. `--discuss` adds a decision extraction step. `--full` adds plan-checking and post-execution verification.
</purpose>

<context>

```bash
$maestro-quick "add rate limiting to /api/auth endpoints"
$maestro-quick "refactor user service to use repository pattern" --discuss
$maestro-quick "fix memory leak in WebSocket handler" --full
$maestro-quick "add dark mode toggle to settings page" --discuss --full
```

**Flags**:
- `--discuss`: Decision extraction before planning (Locked/Free/Deferred classification)
- `--full`: Enable plan-checking (max 2 iterations) and post-execution verification

**Output**: `.workflow/scratch/{slug}/` with plan.json, execution results, optional verification

</context>

<invariants>
1. **Speed over ceremony** — minimal overhead, get to implementation fast
2. **Follow existing patterns** — grep for 3+ similar implementations before writing new code
3. **Atomic commits** — one commit per quick task, descriptive message
4. **Scratch isolation** — all metadata stays in .workflow/scratch/{slug}/
5. **Works without init** — quick tasks function even without full .workflow/ setup
</invariants>

<execution>

### Step 1: Parse Arguments

Extract from arguments:
- `--discuss` flag
- `--full` flag
- Remaining text as task description (required — E001 if empty)

### Step 2: Load Project Context

```bash
cat .workflow/state.json 2>/dev/null
cat .workflow/project.md 2>/dev/null
```

If `.workflow/` does not exist, create minimal scratch structure anyway (quick works without full init).

### Step 3: Create Scratch Directory

Generate slug from task description (lowercase, hyphens, max 40 chars).

```bash
mkdir -p .workflow/scratch/{slug}
```

Write `config.json` with task metadata:
```json
{
  "task": "<description>",
  "flags": { "discuss": false, "full": false },
  "created_at": "<ISO timestamp>",
  "status": "active"
}
```

### Step 4: Discussion Phase (if --discuss)

**Only when `--discuss` is set.**

Analyze the task for gray areas and ambiguities:
1. Identify decision points in the task
2. Classify each as: **Locked** (clear from context), **Free** (implementation choice), **Deferred** (need user input)
3. For Deferred items: ask user for decisions
4. Write `context.md` to scratch directory with all decisions

### Step 5: Quick Analysis

Rapid codebase exploration focused on the task:
1. Search for related files using Grep/Glob
2. Identify existing patterns to follow
3. Map dependencies and integration points
4. Write analysis findings to `context.md` (append if --discuss created it)

### Step 6: Generate Plan

Create `plan.json` in scratch directory:
- Decompose task into subtasks (typically 1-5 for quick tasks)
- Each task has: id, title, description, scope, convergence_criteria, files
- Assign single wave (sequential execution)

**If `--full`**: Present plan for review, allow up to 2 revision iterations.

### Step 7: Execute Tasks

For each task in plan.json (sequential):
1. Read task definition
2. Implement changes following existing patterns
3. Run any specified verification commands
4. Write task summary with files_modified, status

Update plan.json task statuses as completed.

### Step 8: Verification (if --full)

**Only when `--full` is set.**

Run convergence criteria checks:
```bash
# For each task, verify convergence_criteria via grep/test commands
```

If gaps found (W001): attempt single fix iteration, then report remaining gaps.

### Step 9: Commit and Report

```bash
git add -A
git commit -m "quick: {slug} - {short description}"
```

Update `.workflow/state.json` scratch task entry (if state.json exists).

```
=== QUICK TASK COMPLETE ===
Task:    {description}
Scratch: .workflow/scratch/{slug}/
Status:  {completed|completed-with-gaps}

Tasks: {completed}/{total}
Files modified: {count}

{if --full}
Verification: {PASS|GAPS}
{endif}
```

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Task description required | Ask user for description |
| E002 | error | Scratch directory creation failed | Check permissions |
| W001 | warning | Verification found minor gaps | Report gaps, continue |

</error_codes>

<success_criteria>
- [ ] Scratch directory created with config.json
- [ ] Analysis completed and context.md written
- [ ] Plan generated with subtasks
- [ ] All tasks executed and statuses updated
- [ ] Changes committed with descriptive message
- [ ] Completion report displayed
</success_criteria>
