---
name: team-ui-polish
description: Unified team skill for UI polish. Auto-discover and fix UI design issues using Impeccable design standards. Anti-AI-slop detection, color/typography/spacing quality, motion, interaction states, visual hierarchy. Uses team-worker agent architecture. Triggers on "team ui polish", "ui polish", "design polish".
allowed-tools: Agent, AskUserQuestion, Read, Write, Edit, Bash, Glob, Grep, TaskList, TaskGet, TaskUpdate, TaskCreate, TeamCreate, TeamDelete, SendMessage, mcp__maestro__read_file, mcp__maestro__write_file, mcp__maestro__edit_file, mcp__maestro__team_msg, mcp__chrome-devtools__evaluate_script, mcp__chrome-devtools__take_screenshot, mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__resize_page
---

# Team UI Polish

Automatic UI quality improvement pipeline: scan -> diagnose -> optimize -> verify. Built on **team-worker agent architecture** -- all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
Skill(skill="team-ui-polish", args="task description")
                    |
         SKILL.md (this file) = Router
                    |
     +--------------+--------------+
     |                             |
  no --role flag              --role <name>
     |                             |
  Coordinator                  Worker
  roles/coordinator/role.md    roles/<name>/role.md
     |
     +-- analyze -> dispatch -> spawn workers -> STOP
                                    |
                    +-------+-------+-------+
                    v       v       v       v
           [team-worker agents, each loads roles/<role>/role.md]
          scanner  diagnostician  optimizer <-> verifier (GC loop)
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | SCAN-* | false |
| diagnostician | [roles/diagnostician/role.md](roles/diagnostician/role.md) | DIAG-* | false |
| optimizer | [roles/optimizer/role.md](roles/optimizer/role.md) | OPT-* | true |
| verifier | [roles/verifier/role.md](roles/verifier/role.md) | VERIFY-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (ui)**: `maestro load --type spec --category ui` — load ui constraints as shared context
3. **Specs (coding)**: `maestro load --type spec --category coding` — load coding constraints as shared context
4. **Wiki knowledge**: `maestro search "UI polish design quality" --json` — top 5 entries as prior context
5. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `UIP`
- **Session path**: `.workflow/.team/UIP-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`
- **Max GC rounds**: 2

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "ui-polish",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: ui-polish
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) -- Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) -- Team configuration
- [specs/anti-patterns.md](specs/anti-patterns.md) -- AI slop and design anti-pattern catalog
- [specs/design-standards.md](specs/design-standards.md) -- Impeccable positive design standards
- [specs/fix-strategies.md](specs/fix-strategies.md) -- Issue-to-fix mapping
- [specs/scoring-guide.md](specs/scoring-guide.md) -- Scoring rubric

## Session Directory

```
.workflow/.team/UIP-<slug>-<date>/
+-- .msg/
|   +-- messages.jsonl         # Team message bus
|   +-- meta.json              # Pipeline config + GC state
+-- scan/                      # Scanner output
|   +-- scan-report.md
+-- diagnosis/                 # Diagnostician output
|   +-- diagnosis-report.md
+-- optimization/              # Optimizer output
|   +-- fix-log.md
+-- verification/              # Verifier output
|   +-- verify-report.md
+-- evidence/                  # Screenshots (before/after)
|   +-- *.png
+-- wisdom/                    # Cross-task knowledge
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Session corruption | Attempt recovery, fallback to manual |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| GC loop stuck > 2 rounds | Escalate to user: accept / retry / terminate |
