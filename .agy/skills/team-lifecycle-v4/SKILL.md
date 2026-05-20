---
name: team-lifecycle-v4
description: Full lifecycle team skill — plan, develop, test, review in one coordinated session. Role-based architecture with coordinator-driven beat model. Triggers on "team lifecycle v4".
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - replace_file_content
  - run_command
  - send_message
  - view_file
  - write_to_file
agy-subagents:
  - team-worker
  - team-supervisor
---

## Sub-Agent Registration (Antigravity)

Before any `invoke_subagent` call below, register each sub-agent type once per session by reading the system_prompt from `<agy-agents-dir>/<name>.md` and passing it to `define_subagent`. The `<agy-agents-dir>` is:
- global install: `~/.gemini/antigravity-cli/agents/`
- workspace install: `<project>/.agents/agents/`

- `define_subagent(name="team-worker", description="<from agents/team-worker.md frontmatter>", system_prompt=<contents of agents/team-worker.md body>, enable_write_tools=true, enable_mcp_tools=true, enable_subagent_tools=false)`
- `define_subagent(name="team-supervisor", description="<from agents/team-supervisor.md frontmatter>", system_prompt=<contents of agents/team-supervisor.md body>, enable_write_tools=true, enable_mcp_tools=true, enable_subagent_tools=false)`

**ConversationId tracking**: `invoke_subagent` returns a ConversationId per spawned instance. Subsequent `send_message(Recipient=<ConversationId>, Message=...)` calls require that ConversationId — never use the role name as the recipient.

---

# Team Lifecycle v4

Orchestrate multi-agent software development: specification → planning → implementation → testing → review.

## Architecture

```
view_file(AbsolutePath="<agy-skills-dir>/team-lifecycle-v4/SKILL.md") + execute inline (args: "task description")
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
     +-- analyze → dispatch → spawn → STOP
                                 |
                    +--------+---+--------+
                    v        v            v
             [team-worker]  ...    [team-supervisor]
              per-task               resident agent
              lifecycle              message-driven
                                     (woken via send_message)
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | RESEARCH-* | false |
| writer | [roles/writer/role.md](roles/writer/role.md) | DRAFT-* | true |
| planner | [roles/planner/role.md](roles/planner/role.md) | PLAN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | IMPL-* | true |
| tester | [roles/tester/role.md](roles/tester/role.md) | TEST-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REVIEW-*, QUALITY-*, IMPROVE-* | false |
| supervisor | [roles/supervisor/role.md](roles/supervisor/role.md) | CHECKPOINT-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TLV4`
- **Session path**: `.workflow/.team/TLV4-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__ccw-tools__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
invoke_subagent([{ TypeName: "team-worker", Role: "<role>", Prompt: "<Prompt>", Workspace: "inherit" }])
```

## Supervisor Spawn Template

Supervisor is a **resident agent** (independent from team-worker). Spawned once during session init, woken via send_message for each CHECKPOINT task.

### Spawn (Phase 2 — once per session)

```
invoke_subagent([{ TypeName: "team-supervisor", Role: "supervisor", Prompt: "<Prompt>", Workspace: "inherit" }])
```

### Wake (handleSpawnNext — per CHECKPOINT task)

```
send_message({
  type: "message",
  recipient: "supervisor",
  content: `## Checkpoint Request
task_id: <CHECKPOINT-NNN>
scope: [<upstream-task-ids>]
pipeline_progress: <done>/<total> tasks completed`,
  summary: "Checkpoint request: <CHECKPOINT-NNN>"
})
```

### Shutdown (handleComplete)

```
send_message({
  type: "shutdown_request",
  recipient: "supervisor",
  content: "Pipeline complete, shutting down supervisor"
})
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID> [feedback]` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |
| `recheck` | Re-run quality check |
| `improve [dimension]` | Auto-improve weakest dimension |

## Completion Action

When pipeline completes, coordinator presents:

```
ask_question({
  questions: [{
    question: "Pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory" }
    ]
  }]
})
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/quality-gates.md](specs/quality-gates.md) — Quality gate criteria and scoring
- [specs/knowledge-transfer.md](specs/knowledge-transfer.md) — Artifact and state transfer protocols

## Session Directory

```
.workflow/.team/TLV4-<slug>-<date>/
├── team-session.json           # Session state + role registry
├── spec/                       # Spec phase outputs
├── plan/                       # Implementation plan + TASK-*.json
├── artifacts/                  # All deliverables
├── wisdom/                     # Cross-task knowledge
├── explorations/               # Shared explore cache
├── discussions/                # Discuss round records
└── .msg/                       # Team message bus
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| CLI tool fails | Worker fallback to direct implementation |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Supervisor crash | Respawn with `recovery: true`, auto-rebuilds from existing reports |
| Supervisor not ready for CHECKPOINT | Spawn/respawn supervisor, wait for ready, then wake |
| Completion action fails | Default to Keep Active |
