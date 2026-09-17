<!-- session-mode: none -->
## Agent Invocation & Timeouts (Codex)

V2 agents are asynchronous: after `spawn_agent` / `followup_task`, block with `wait_agent` to retrieve results — otherwise the sub-agent is orphaned and its final answer is lost.

- **Default: `wait_agent({ timeout_ms: 3600000 })`** immediately after spawn. On `timed_out` without a terminal status, wait again — never abandon. Only explicitly short tasks may use a shorter `timeout_ms` (minimum `10000`).
- The `wait_agent` message is a mailbox summary; the final result arrives as a `FINAL_ANSWER` message.
- `spawn_agents_on_csv`: set `max_runtime_seconds: 3600` explicitly.
- Track progress with `update_plan({ plan: [{ step, status }] })` — submit the full step array each call. `create_goal` only on explicit user request.
