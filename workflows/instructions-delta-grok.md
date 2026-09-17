<!-- session-mode: none -->
## Agent Invocation & Join (Grok)

Spawn subagents with the native `spawn_subagent` tool only. Do NOT call `spawn_agent` / `wait_agent` / `list_agents` / `interrupt_agent` / `delegate_subagent` — those are Codex tools and do not exist in the grok host. `Task` is an alias of `spawn_subagent`; the same rules apply.

- **Default: foreground spawn (`background: false`)** — blocks and returns the child's final result. Background spawn ⇒ wait with `get_command_or_subagent_output` until terminal, `kill_command_or_subagent` if you must give up; never end a turn while your background subagent is still running.
- **Parallel waves**: the parent spawns all workers itself, then joins with `wait_commands_or_subagents({ task_ids, mode: "wait_all" })` (max 20 IDs). No nested spawning — max depth is 1.
- **No plan tools**: `update_plan` / `create_task` do not exist — track progress as checklists in session artifacts.
- **`create_goal` only** when the user explicitly asks or a workflow step declares `goal: true`.
