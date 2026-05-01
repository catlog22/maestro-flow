# Workflow: maestro-chain-execute

Upgraded version of maestro's original direct execution strategy.
Reads session status.json, loops through steps with per-step engine selection,
context propagation, post-step Gemini analysis, and error handling.
Tracks all progress via status.json (the JSON file created during selection).

**Prerequisites:**
- Session directory with valid status.json (status: "running", pending steps)
- $SESSION_PATH passed from maestro.md dispatch

## Step 1: Load Session

Read status.json from `$SESSION_PATH`.

Extract: `session_id`, `chain_name`, `steps[]`, `context`, `auto_mode`, `exec_mode`, `cli_tool`, `gemini_session_id`.

Set `$STEP_INDEX` = `current_step` (first pending step).

Validate: `status == "running"` and at least one pending step exists.

Display banner:

```
============================================================
  CHAIN EXECUTOR
============================================================
  Session: {session_id}
  Chain:   {chain_name}
  Steps:   {completed}/{total} done, starting from step {$STEP_INDEX}
  Auto:    {auto_mode}
  Exec:    {exec_mode}
```

## Step 2: Context & Argument Assembly

Initialize context object from `status.json.context`:

```
context = {
  current_phase,    // from status.json.context or top-level phase
  user_intent,      // from status.json.context or top-level intent
  issue_id,
  spec_session_id,
  scratch_dir,
  auto_mode         // from status.json.auto_mode
}
```

### assembleArgs(step)

```
1. Substitute placeholders in step.args:
   {phase} → context.current_phase
   {description} → context.user_intent
   {issue_id} → context.issue_id
   {spec_session_id} → context.spec_session_id
   {scratch_dir} → context.scratch_dir

2. In auto_mode, append per-command flag if not already present:
   maestro-analyze / maestro-brainstorm / maestro-roadmap / maestro-ui-design → -y
   maestro-plan → --auto
   quality-test → --auto-fix
   quality-retrospective → --auto-yes

3. Shell-escape strings with single quotes for CLI delegate calls.
```

## Step 3: Step Loop

For each step starting at `$STEP_INDEX`:

### 3a. Select engine & display banner

Per-step engine selection:

```
If exec_mode is 'cli' or 'skill' → force that engine for all steps.

In 'auto' mode, select per step:
  CLI steps (heavy, context-isolated):
    maestro-plan, maestro-execute, maestro-analyze, maestro-brainstorm,
    maestro-roadmap, maestro-ui-design, quality-refactor

  Skill steps (observable, interactive, lightweight):
    everything else — verify, review, test, debug, milestone-*,
    manage-*, spec-*, quick, etc.
```

Display: `[Step {N}/{total}] /{cmd} [{engine}] — {args}`

Update status.json: step `status = "running"`, `engine`, `started_at`.

Context window hint:
- Step >= 4 and not autoYes: hint user about `/maestro -c` for fresh context resume.
- autoYes and step >= 5: log warning to status.json.

### 3b. Execute (engine-dependent)

**Skill engine** — invoke directly (synchronous, visible):

```
Skill({ skill: step.cmd, args: assembledArgs })
```

**CLI engine** — template-driven, async, context-isolated:

```
1. Load template ~/.maestro/templates/cli/prompts/coordinate-step.txt
2. Build analysisHints from previous step's next_step_hints
   (prompt_additions, cautions, context_to_carry)
3. Substitute template placeholders:
   {{COMMAND}}, {{ARGS}}, {{STEP_N}}, {{AUTO_DIRECTIVE}},
   {{CHAIN_NAME}}, {{ANALYSIS_HINTS}}
4. Run:
   Bash(maestro delegate "<prompt>" --to {cli_tool} --mode write,
        run_in_background: true, timeout: 600000)
5. **STOP** — wait for background callback
```

### 3c. Parse output & update context

Scan step output for context propagation:

```
PHASE: N         → context.current_phase
SPEC-xxx         → context.spec_session_id
scratch_dir: path → context.scratch_dir
```

CLI: capture `exec_id` from stderr `[MAESTRO_EXEC_ID=<id>]`.

**Persist context back to status.json** after each step — write updated `context` field and `current_step`. This enables resume via `/maestro -c`.

### 3d. Handle result

**Success:** mark step `status = "completed"`, set `completed_at` in status.json.
CLI: save output to `step-{N}-output.txt` in session directory.

**Failure:**
- `auto_mode` → retry once, then skip (mark `"skipped"`).
- Interactive → offer: Retry (max 2) / Skip / Abort.
- Abort → **Error E003** — update status.json `status = "aborted"`, display resume hint: `/maestro -c`.

### 3e. Post-step analysis (CLI steps only)

Skip if: step failed/skipped, or `engine == 'skill'`.

Delegate to gemini (analysis mode, `--resume` if `gemini_session_id` exists) with prompt containing:
- Step command, args, chain name, intent
- Last 200 lines of step output
- Next step info (command, args) if any

Expected JSON response:

```json
{
  "quality_score": "<0-100>",
  "execution_assessment": {
    "success": "<bool>",
    "completeness": "<full|partial|minimal>",
    "key_outputs": [],
    "missing_outputs": []
  },
  "issues": [
    { "severity": "critical|high|medium|low", "description": "" }
  ],
  "next_step_hints": {
    "prompt_additions": "<extra context for next step>",
    "cautions": ["<things to watch out for>"],
    "context_to_carry": "<key facts from this step>"
  },
  "step_summary": ""
}
```

On callback:
1. Capture gemini `exec_id` → store as `gemini_session_id` in status.json for session continuity.
2. Store analysis in `step_analyses[]` and `step-{N}-analysis.json` in session directory.
3. Advance to next step (**3a**).

## Step 4: Completion Report

Update status.json: `status = "completed"`.

```
============================================================
  MAESTRO SESSION COMPLETE
============================================================
  Session:  {session_id}
  Chain:    {chain_name}
  Steps:    {completed}/{total} completed
  Phase:    {context.current_phase}

  Results:
    [✓] 1. maestro-plan — completed [cli] (quality: 85/100)
    [✓] 2. maestro-verify — completed [skill]
    [—] 3. quality-review — skipped [skill]

  CLI Avg Quality: {avgScore}/100 (based on {cliStepCount} cli steps)

  Next: /maestro continue | /manage-status
============================================================
```
