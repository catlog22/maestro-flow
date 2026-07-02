---
name: maestro-guard
description: Manage editing boundary restrictions
argument-hint: "<on|off|status|allow <path>|deny <path>>"
allowed-tools: Read, Write, Bash, Glob
---
<purpose>
Configure directory-level write boundaries enforced by the workflow-guard PreToolUse hook.
When enabled, Write and Edit tool calls targeting files outside allowed paths are blocked.

Subcommands:
- **on** -- Enable path guard (defaults to `["src/", "tests/", ".workflow/"]` if no paths configured)
- **off** -- Disable path guard (preserves path list)
- **status** -- Show current guard configuration
- **allow `<path>`** -- Add a directory to the allowed paths list
- **deny `<path>`** -- Switch to deny mode and add path to deny list
</purpose>

<context>
$ARGUMENTS -- Parse subcommand and optional path argument.

**Config location:** `.workflow/config.json` -> `guard` section

```json
{
  "guard": {
    "enabled": false,
    "mode": "allow",
    "paths": []
  }
}
```

**Enforcement:** The `workflow-guard` hook (PreToolUse on Write/Edit) reads this config
and blocks operations targeting files outside boundaries. Requires hooks level >= `full`.

**Output boundary**: ALL file writes MUST target `.workflow/config.json` (guard section) only. NEVER modify hook files, `.codex/settings.json`, or source code.
</context>

<invariants>
1. **Config-only mutation** — guard MUST only modify the `guard` section of `.workflow/config.json`; NEVER touch other config sections or files
2. **Non-destructive** — `off` MUST preserve existing paths and mode; NEVER clear the path list when disabling
3. **Mode switch confirmation** — switching between allow/deny mode MUST require request_user_input confirmation when existing paths will be cleared
4. **Hook dependency** — guard MUST warn when enabled but `workflow-guard` hook is not active (hooks level < full)
5. **Path normalization** — all paths MUST use forward slashes with trailing slash for directories; NEVER store raw backslash paths
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Config Read**
- REQUIRED: Subcommand parsed (on/off/status/allow/deny) or defaulted to `status`.
- BLOCKED if: invalid subcommand provided.

**GATE 2: Config Read → Execute**
- REQUIRED: `.workflow/config.json` read successfully or initialized with empty guard section.
- BLOCKED if: file unreadable and cannot be created (E001).

**GATE 3: Execute → Confirm**
- REQUIRED: Config mutation applied (for on/off/allow/deny) or status displayed (for status).
- REQUIRED: Mode-switch request_user_input answered (for allow↔deny transitions with existing paths).
- BLOCKED if: user declines mode switch.

**Step 1: Parse subcommand**

Extract from $ARGUMENTS:
- `on` / `off` / `status` / `allow <path>` / `deny <path>`
- If no subcommand, default to `status`

**Step 2: Read config**

Read `.workflow/config.json`. If file missing, initialize with empty guard section.

**Step 3: Execute subcommand**

**`status`:**
- Display: enabled/disabled, mode (allow/deny), paths list
- Check if workflow-guard hook is active (read `.codex/settings.json` for hook presence)
- If guard enabled but hook not active, warn: "WARNING: PathGuard enabled but workflow-guard hook not installed. Run `maestro hooks level full` to activate."

**`on`:**
- Set `guard.enabled = true`
- If `guard.paths` is empty, set default: `["src/", "tests/", ".workflow/"]`
- Check hook level, warn if < full
- Write config

**`off`:**
- Set `guard.enabled = false`
- Preserve existing paths and mode
- Write config

**`allow <path>`:**
- Normalize path to forward slashes, ensure trailing slash for directories
- If `guard.mode` is `deny`, switch to `allow` and clear paths with warning
- Add path to `guard.paths` (deduplicate)
- Set `guard.enabled = true` if not already
- Write config

**`deny <path>`:**
- Normalize path to forward slashes, ensure trailing slash for directories
- If `guard.mode` is `allow`, switch to `deny` and clear paths with warning
- Set `guard.mode = "deny"`
- Add path to `guard.paths` (deduplicate)
- Set `guard.enabled = true` if not already (symmetric with `allow`: adding a deny path auto-enables the guard)
- Write config

**Step 4: Confirm**

Display updated guard configuration.

</execution>

<error_codes>
- E001: `.workflow/config.json` not found and cannot be created (not a maestro project)
- W001: PathGuard enabled but workflow-guard hook not installed
</error_codes>

<success_criteria>
- [ ] Config read/written correctly
- [ ] Hook level warning displayed when applicable
- [ ] Updated configuration shown after changes
</success_criteria>
