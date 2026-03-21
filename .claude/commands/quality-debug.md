---
name: quality-debug
description: Parallel hypothesis-driven debugging with UAT integration and structured root cause collection
argument-hint: "[issue description] [--from-uat <phase>] [--parallel]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Debug issues using scientific method with subagent isolation and persistent debug state. Supports three entry modes:

1. **Standalone**: User describes an issue, gather symptoms interactively
2. **From UAT**: `--from-uat` reads uat.md gaps as pre-filled symptoms (skip gathering)
3. **Parallel**: `--parallel` spawns one debug agent per gap cluster concurrently

When root causes are found, updates the originating uat.md with diagnosis artifacts (root_cause, fix_direction, affected_files) so the UAT -> debug -> fix pipeline stays connected.

Key mechanisms from GSD diagnose-issues:
- **Pre-filled symptoms from UAT**: Skip 5-question gathering when gaps already documented
- **Parallel debug agents**: One agent per gap cluster for concurrent investigation
- **Structured root cause collection**: Standardized output format across all agents
- **UAT feedback loop**: Auto-update uat.md gaps with diagnosis results
</purpose>

<required_reading>
@~/.maestro/workflows/debug.md
</required_reading>

<context>
User's issue: $ARGUMENTS

**Flags:**
- `--from-uat <phase>` -- Read gaps from phase's uat.md as pre-filled symptoms
- `--parallel` -- Spawn parallel debug agents (one per gap cluster)

**State files:**
- `.workflow/phases/{NN}-{slug}/uat.md` -- UAT gaps (if --from-uat)
- `.workflow/phases/{NN}-{slug}/.debug/` -- Phase-scoped debug sessions
- `.workflow/scratch/debug-*/` -- Standalone debug sessions
</context>

<execution>
Follow '~/.maestro/workflows/debug.md' completely.

**Next-step routing on completion:**
- Root cause found, fix needed → Skill({ skill: "maestro-plan", args: "{phase} --gaps" })
- Root cause found (from UAT), auto-fix → Skill({ skill: "quality-test", args: "{phase} --auto-fix" })
- Inconclusive, need more info → Skill({ skill: "quality-debug", args: "{issue} -c" }) (resume session)
- Standalone fix already applied → Skill({ skill: "maestro-verify", args: "{phase}" })

Note: Debug output (.debug/) is auto-loaded by maestro-plan --gaps.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Issue description required (no arguments, no active sessions) | Check arguments format, re-run with correct input |
| E002 | error | UAT file not found for --from-uat phase | Verify UAT file exists for specified phase |
| W001 | warning | Existing debug session found, offer resume | Review existing sessions, choose resume or new |
| W002 | warning | Checkpoint reached, user input needed | Provide requested input to continue |
| W003 | warning | Some gaps inconclusive, partial diagnosis | Review partial results, retry inconclusive gaps |
</error_codes>

<success_criteria>
- [ ] Input parsed: standalone, --from-uat, or --parallel mode determined
- [ ] Active sessions checked and resume offered if applicable
- [ ] Symptoms gathered (interactive) or loaded from UAT (pre-filled)
- [ ] Debug output directory created (phase .debug/ or scratch/)
- [ ] Debug agent(s) spawned with full symptom context
- [ ] If --parallel: one agent per gap cluster, all concurrent
- [ ] evidence.ndjson written with structured NDJSON entries
- [ ] understanding.md tracks evolving understanding per cluster
- [ ] Root causes collected with fix_direction and affected_files
- [ ] If --from-uat: uat.md gaps updated with diagnosis artifacts
- [ ] Results unified into diagnosis summary
- [ ] Next step routed (plan --gaps + execute if fix needed, verify if fix applied, resume if inconclusive)
</success_criteria>
