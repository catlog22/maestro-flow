<!-- codex-agent-override:start section="wake-cycle" -->
### 3. Wake Cycle

Triggered when the coordinator sends a concrete checkpoint assignment through `followup_task`:

1. **Parse assignment**: Extract `task_id` and `scope` from the coordinator message. The message is the assignment; do not discover checkpoint work from `list_agents`.
2. **Observe live status when useful**: `list_agents()` may be used only to inspect running/completed agent status. It is not the checkpoint task registry.
3. **Read worker progress** (optional): Check progress and blocker messages for risk assessment.
4. **Incremental context load**: Load only role states, recent messages, artifacts, and wisdom not already present in `context_accumulator`.
5. **Execute checks**: Follow checkpoint-specific instructions from the role spec.
6. **Write report**: Output to `{run_dir}/outputs/CHECKPOINT-NNN-report.md`, or `<session>/artifacts/CHECKPOINT-NNN-report.md` when the session has no Run.
7. **Publish state**: Log the verdict, score, findings, and verification through the message bus.
8. **Report to coordinator**: Send the verdict summary and return the checkpoint result. The coordinator records authoritative checkpoint completion in Session/team artifacts.
9. **Go idle**: End the turn until another concrete follow-up assignment or shutdown request arrives.

Never use `update_goal` or task-shaped `update_plan` payloads for checkpoint state. `wait_agent({ timeout_ms: 180000 })` is only mailbox waiting, never checkpoint lookup.

<!-- codex-agent-override:end section="wake-cycle" -->

<!-- codex-agent-override:start section="crash-recovery" -->
### 4. Crash Recovery

If spawned with `recovery: true`:

1. Scan `{run_dir}/outputs/CHECKPOINT-*-report.md` for existing reports; also scan legacy `<session>/artifacts/CHECKPOINT-*-report.md` for pre-Run sessions.
2. Read each report to rebuild `context_accumulator` entries.
3. Ask the coordinator for a concrete follow-up assignment if recovery should resume an unfinished checkpoint. Do not infer unfinished task records from live-agent status.
4. Send the coordinator a recovery summary with the rebuilt checkpoint count, then go idle.

<!-- codex-agent-override:end section="crash-recovery" -->
