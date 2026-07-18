<!-- codex-agent-override:start section="assignment-lifecycle" -->
### 3. Assigned Work Lifecycle

Codex workers receive one concrete assignment in the initial `spawn_agent` prompt. A later `followup_task` prompt may extend or correct that same assignment. The coordinator and Session/team artifacts remain authoritative for dependency readiness, ownership, claim state, and completion.

1. Treat the current spawn or follow-up prompt as the complete work assignment; do not discover pending work from a tool.
2. Validate that the assignment matches the role prefix declared by `role_spec`. If it does not, report the mismatch to the coordinator and stop.
3. Do not claim or complete pipeline work through `update_goal` or task-shaped `update_plan` payloads. `update_plan` is optional local progress projection only and, when used, must submit the complete `plan` array.
4. Use `list_agents()` only to observe live agent status when that observation is relevant. It is not a task list and does not expose dependency or ownership records.
5. Use `wait_agent({ timeout_ms: 180000 })` only to wait for mailbox/agent updates. It does not fetch assignment details by task ID.

**Resume check**: Before executing, inspect the assignment's declared output paths. If a complete artifact already exists, verify it and proceed to reporting without rewriting it blindly.

<!-- codex-agent-override:end section="assignment-lifecycle" -->

<!-- codex-agent-override:start section="report-and-advance" -->
### 7. Report and Return

1. Publish the required deliverable and message-bus state update.
2. Send the coordinator a final report containing completed scope, artifact paths, files modified, verification, decisions, and warnings.
3. Return the final result to the parent. This return is the live-agent completion signal; the coordinator records authoritative completion in Session/team artifacts.
4. Do not self-discover or claim another assignment. With `inner_loop=true`, continue only after the coordinator sends a concrete follow-up assignment with `followup_task`.
5. If follow-up work requires a different worker or checkpoint, request that dispatch from the coordinator. Workers do not spawn successors.

<!-- codex-agent-override:end section="report-and-advance" -->

<!-- codex-agent-override:start section="input" -->
## Input
- Initial `spawn_agent` prompt or concrete `followup_task` prompt with the assignment fields
- Role spec file containing execution instructions
- Session folder with wisdom files and upstream artifacts
- Optional `run_dir` resolved according to the prompt contract

<!-- codex-agent-override:end section="input" -->

<!-- codex-agent-override:start section="output" -->
## Output
- Completed artifacts in `{run_dir}/outputs/` (or `<session>/artifacts/` when the session has no Run)
- Wisdom contributions under `<session>/wisdom/`
- State updates through the message bus
- Final report delivered to the coordinator and returned to the parent agent

<!-- codex-agent-override:end section="output" -->
