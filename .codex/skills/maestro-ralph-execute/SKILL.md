---
name: maestro-ralph-execute
description: Single-step skill executor — spawned by maestro-ralph via CSV, reads ralph session context, executes one skill command, reports result
argument-hint: "[-y] <skill_call>"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Worker agent spawned by maestro-ralph via `spawn_agents_on_csv`.
Each invocation executes exactly ONE skill command and reports the result.

Receives `skill_call` (e.g. `$maestro-plan 1`) from the wave CSV.
Before execution, reads the ralph session status.json to obtain execution context
(phase, milestone, intent, artifact paths) — uses this to enrich skill args when needed.

Writes back **nothing** to status.json — ralph coordinator reads the result CSV and updates status.json itself.
Decision nodes never arrive here — ralph processes them directly.
</purpose>

<context>
**From CSV row:**
- `skill_call` — full skill invocation string (e.g. `$maestro-plan 1`, `$quality-review 1`)
- `topic` — brief description of what this step does

**The skill_call format:** `$<skill-name> <args>`

**Ralph session status.json** — located at `.workflow/.maestro/ralph-*/status.json` (latest running session).
Read-only for this agent. Provides:

```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph",
  "intent": "用户原始输入",
  "status": "running",
  "phase": 1,
  "milestone": "MVP",
  "auto_mode": false,
  "lifecycle_position": "plan",
  "context": {
    "plan_dir": ".workflow/scratch/...",
    "analysis_dir": ".workflow/scratch/...",
    "brainstorm_dir": null
  },
  "steps": [...],
  "current_step": 3
}
```

**Project state** — `.workflow/state.json` provides artifact registry:
```json
{
  "current_milestone": "MVP",
  "artifacts": [
    { "id": "ANL-001", "type": "analyze", "phase": 1,
      "path": "phases/01-auth-multi-tenant", "status": "completed" }
  ]
}
```
</context>

<execution>

## Step 1: Parse skill_call

```
Parse $ARGUMENTS:
  Contains "-y" or "--yes" → auto = true, remove flag from remaining args
  Remaining → skill_call

Extract from skill_call:
  skill_name = text between $ and first space (e.g. "maestro-plan")
  skill_args = remainder after first space (e.g. "1")

If skill_call is empty or malformed:
  → report_agent_job_result({ status: "failed", error: "Invalid skill_call" })
  → End.
```

Also read `session.auto_mode` from ralph status.json — if `true`, treat as `-y` even if flag not passed.

## Step 2: Load ralph session context

```
Glob .workflow/.maestro/ralph-*/status.json
  Filter: status == "running"
  Sort by created_at DESC, take first
  → ralph_session

If not found: proceed with skill_args as-is (standalone execution)
```

Extract from ralph_session:
- `phase` — current phase number
- `milestone` — current milestone name
- `intent` — user's original input text
- `context.plan_dir` — latest plan artifact directory
- `context.analysis_dir` — latest analysis artifact directory
- `context.brainstorm_dir` — brainstorm output directory

Also read `.workflow/state.json` for artifact registry when needed.

## Step 3: Enrich skill args

If skill_args contain unresolved context or are insufficient, enrich based on skill type:

```
Per-skill enrichment (when args need context from session):

maestro-brainstorm:
  If args empty → args = '"{intent}"'

maestro-roadmap:
  If args empty → args = '"{intent}"'

maestro-analyze:
  If args is just a number → keep as phase number
  If args empty → args = '{phase}' or '"{intent}"'

maestro-plan:
  If args is number → keep as phase
  If needs artifact dir → resolve latest analyze artifact:
    state.json.artifacts[] → filter(type=="analyze", phase==session.phase) → latest → --dir .workflow/scratch/{path}

maestro-execute:
  If args is number → keep as phase
  If needs artifact dir → resolve latest plan artifact:
    state.json.artifacts[] → filter(type=="plan", phase==session.phase) → latest → --dir .workflow/scratch/{path}

quality-debug:
  Read previous step's result artifacts for gap/failure context
  If from verify: append gap summary from verification.json
  If from test: append --from-uat {phase}
  If from business-test: append --from-business-test {phase}

quality-* (review, test, test-gen, business-test):
  If args empty → args = '{phase}'

maestro-verify, maestro-milestone-audit, maestro-milestone-complete:
  If args empty → args = '{phase}' (or empty for milestone-*)
```

## Step 4: Execute skill

**`-y` auto flag 传播：** 当 `auto == true` 时，按传播表附加 flag：
```
auto_flag_map = {
  "maestro-init": "-y",
  "maestro-analyze": "-y",
  "maestro-brainstorm": "-y",
  "maestro-roadmap": "-y",
  "maestro-plan": "-y",
  "maestro-execute": "-y",
  "quality-auto-test": "-y",
  "quality-test": "-y --auto-fix",
  "quality-retrospective": "-y",
  "maestro-milestone-complete": "-y"
}
flag = auto_flag_map[skill_name] || ""
skill_args = flag ? `${skill_args} ${flag}` : skill_args
```

```
Read .codex/skills/{skill_name}/SKILL.md to understand the skill
Execute the skill with enriched skill_args as $ARGUMENTS

Track:
  - Artifact paths produced (scratch dirs, plan.json, verification.json, etc.)
  - Session IDs created (WFS-*, ANL-*, PLN-*, etc.)
  - Success/failure status
```

## Step 5: Report result

```
report_agent_job_result({
  status: "completed" | "failed",
  skill_call: "{original_skill_call}",
  summary: "one-line result description",
  artifacts: "comma-separated artifact paths or empty string",
  error: "failure reason or empty string"
})
```

**Artifact paths to report** (for ralph's barrier analysis):
| Skill | Report |
|-------|--------|
| maestro-analyze | scratch dir path containing context.md |
| maestro-plan | scratch dir path containing plan.json |
| maestro-execute | scratch dir path containing .summaries/ |
| maestro-brainstorm | .brainstorming/ output dir |
| maestro-roadmap | roadmap.md path |
| maestro-verify | verification.json path |
| quality-review | review.json path |
| quality-test | uat.md path |
| quality-auto-test | auto-test report path |
| Others | empty or relevant output path |

</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | skill_call parsing failed | Report failed |
| E002 | error | Skill SKILL.md not found | Report failed |
| E003 | error | Skill execution error | Report failed with error details |
| E004 | error | Ralph session not found (standalone mode) | Execute with args as-is |
| W001 | warning | Artifact dir not found for enrichment | Use args as-is, warn in summary |
</error_codes>

<success_criteria>
- [ ] skill_call correctly parsed into skill_name + skill_args
- [ ] Ralph session status.json read for context (phase, intent, artifact paths)
- [ ] Args enriched per-skill when context needed (brainstorm→intent, plan→dir, debug→gaps)
- [ ] Skill executed via its own SKILL.md
- [ ] Artifact paths accurately reported for ralph's barrier analysis
- [ ] status.json NEVER written by this agent
- [ ] Result reported via report_agent_job_result
</success_criteria>
