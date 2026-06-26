# Shell Execution Protocol

## Execution Mapping

**`shell_command` available** (Codex App):

```
shell_command({ command: "<cmd>", timeout_ms: <timeout> })
```

Synchronous — result returned directly.

**`exec_command` available** (Codex CLI):

```
exec_command({ cmd: "<cmd>", yield_time_ms: <timeout>, max_output_tokens: 6000 })
```

Check response:
- No `session_id` → command completed, use output directly
- Has `session_id` → poll until complete:

```
WHILE not completed:
  write_stdin({ session_id, chars: "", yield_time_ms: 60000, max_output_tokens: 6000 })
  IF completed or failed → stop
  // Increase interval: 15s → 30s → 60s (cap)
```

NEVER skip polling. NEVER abandon. Delegate output is required.
