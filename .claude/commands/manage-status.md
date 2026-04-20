---
name: manage-status
description: Display project dashboard with phase progress, active tasks, and next steps
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<purpose>
Display a unified project dashboard showing artifact progress, task counts, active work, and intelligent next-step suggestions.
Reads state.json artifact registry and roadmap to render a formatted overview with progress and status tables.
Provides situational awareness before continuing work. Uses virtual phase view derived from artifact registry.
</purpose>

<required_reading>
@~/.maestro/workflows/status.md
</required_reading>

<context>
$ARGUMENTS (no arguments required)

**State files read:**
- `.workflow/state.json` -- project-level state machine + artifact registry
- `.workflow/roadmap.md` -- milestone and phase structure
- `.workflow/scratch/*/plan.json` -- plan metadata (via artifact registry paths)
- `.workflow/scratch/*/.task/TASK-*.json` -- individual task statuses
</context>

<execution>
Follow '~/.maestro/workflows/status.md' completely.

**Next-step decision table:**
| Current state | Suggested command | Reason |
|---------------|-------------------|--------|
| No phases planned | `/maestro-brainstorm 1` or `/maestro-plan 1` | Explore ideas or start planning first phase |
| Phase pending, needs analysis | `/maestro-analyze <N>` | Evaluate feasibility before planning |
| Phase pending, needs decisions | `/maestro-analyze <N> -q` | Quick decision extraction |
| Phase planned, not executed | `/maestro-execute <N>` | Execute the planned phase |
| Phase executing, tasks blocked | `/quality-debug <N>` | Unblock stuck tasks |
| Phase executed, not verified | `/maestro-verify <N>` | Verify execution results |
| Phase verified with gaps | `/maestro-plan <N> --gaps` | Plan gap fixes |
| Phase verified, not reviewed | `/quality-review <N>` | Code quality review before UAT |
| Phase reviewed, verdict BLOCK | `/maestro-plan <N> --gaps` | Fix critical review findings first |
| Phase reviewed, verdict PASS/WARN | `/quality-test <N>` | Proceed to UAT testing |
| Phase verified, low test coverage | `/quality-test-gen <N>` | Generate missing automated tests |
| UAT passed, all phases done | `/maestro-milestone-audit` | Cross-phase integration check |
| UAT has failures | `/quality-debug --from-uat <N>` | Debug UAT gaps with parallel agents |
| Need integration test cycle | `/quality-integration-test <N>` | Self-iterating integration tests |
| All phases in milestone complete | `/maestro-milestone-audit` | Cross-phase integration check |
| Milestone audit passed | `/maestro-milestone-complete` | Archive milestone, advance |
| Ad-hoc small task | `/maestro-quick <task>` | Quick execute without full pipeline |
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` not initialized -- run `/maestro-init` first | parse_input |
| E002 | fatal | `state.json` missing or corrupt -- project state unrecoverable | parse_input |
</error_codes>

<success_criteria>
- [ ] Project state loaded from `state.json`
- [ ] Roadmap parsed with milestone/phase structure
- [ ] Per-phase progress calculated (task counts, completion %)
- [ ] Dashboard rendered with progress bars and status table
- [ ] Active work section shows current phase details
- [ ] Next steps suggested based on current state analysis
- [ ] Wiki health score displayed (or graceful unavailable message)
</success_criteria>
