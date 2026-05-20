---
name: team-testing
description: Unified team skill for testing team. Progressive test coverage through Generator-Critic loops, shared memory, and dynamic layer selection. Triggers on "team testing".
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
---

## Sub-Agent Registration (Antigravity)

Before any `invoke_subagent` call below, register each sub-agent type once per session by reading the system_prompt from `<agy-agents-dir>/<name>.md` and passing it to `define_subagent`. The `<agy-agents-dir>` is:
- global install: `~/.gemini/antigravity-cli/agents/`
- workspace install: `<project>/.agents/agents/`

- `define_subagent(name="team-worker", description="<from agents/team-worker.md frontmatter>", system_prompt=<contents of agents/team-worker.md body>, enable_write_tools=true, enable_mcp_tools=true, enable_subagent_tools=false)`

**ConversationId tracking**: `invoke_subagent` returns a ConversationId per spawned instance. Subsequent `send_message(Recipient=<ConversationId>, Message=...)` calls require that ConversationId — never use the role name as the recipient.

---

# Team Testing

Orchestrate multi-agent test pipeline: strategist -> generator -> executor -> analyst. Progressive layer coverage (L1/L2/L3) with Generator-Critic loops for coverage convergence.

## Architecture

```
view_file(AbsolutePath="<agy-skills-dir>/team-testing/SKILL.md") + execute inline (args: "task description")
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
                    +-------+-------+-------+-------+
                    v       v       v       v
                [strat] [gen]  [exec]  [analyst]
                team-worker agents, each loads roles/<role>/role.md
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | STRATEGY-* | false |
| generator | [roles/generator/role.md](roles/generator/role.md) | TESTGEN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | TESTRUN-* | true |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | TESTANA-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TST`
- **Session path**: `.workflow/.team/TST-<slug>-<date>/`
- **Team name**: `testing`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__ccw-tools__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
invoke_subagent([{ TypeName: "team-worker", Role: "<role>", Prompt: "<Prompt>", Workspace: "inherit" }])
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID>` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |

## Completion Action

When pipeline completes, coordinator presents:

```
ask_question({
  questions: [{
    question: "Testing pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Deepen Coverage", description: "Add more test layers or increase coverage targets" }
    ]
  }]
})
```

## Session Directory

```
.workflow/.team/TST-<slug>-<date>/
├── .msg/messages.jsonl     # Team message bus
├── .msg/meta.json          # Session metadata
├── wisdom/                 # Cross-task knowledge
├── strategy/               # Strategist output
├── tests/                  # Generator output (L1-unit/, L2-integration/, L3-e2e/)
├── results/                # Executor output
└── analysis/               # Analyst output
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) — Team configuration

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| GC loop exceeded | Accept current coverage with warning |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
