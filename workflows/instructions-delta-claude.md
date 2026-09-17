<!-- session-mode: none -->
## Agent Invocation & Join (Claude)

- **Default: synchronous `Agent()`** (`run_in_background: false`) — the call blocks and returns the child's final result; prefer it unless parallelism is genuinely required.
- **Background `Agent()` ⇒ join in this turn.** Collect every background agent's result with the host's wait/notification flow before you finish; a failed or timed-out worker must be stopped/collected too — never end a turn with your own background agents still running.
- **Never use a `Stop` hook to "wait for running subagents"** (registry drift turns it into an infinite loop, Claude Code #58637). Join is the model's job, not the hook's.
- **Agent Teams**: before ending, send `shutdown_request` to each teammate and `TeamDelete` the team — `SubagentStop` can be skipped for team members (#44971).
