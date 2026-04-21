---
name: maestro-overlay
description: Create or edit a non-invasive command overlay from natural-language intent. Writes a JSON patch file to ~/.maestro/overlays/, applies it via maestro overlay add, and confirms installation with idempotent re-apply support.
argument-hint: "<intent> | --list | --remove <name>"
allowed-tools: Read, Write, Bash, Glob, Grep
---

<purpose>
4-step pipeline: parse intent → identify targets + injection points → draft overlay JSON → install via CLI and report. Overlays are JSON patch files that augment `.claude/commands/*.md` non-invasively. They survive reinstalls because `maestro install` auto-reapplies them. Each overlay is idempotent: the patcher wraps content in hashed HTML-comment markers, so re-running `maestro overlay apply` produces no file changes.

```
Parse Intent  →  Identify Targets  →  Draft JSON  →  Install + Report
(or --list /      (read command        (apply_patch    (exec_command +
  --remove)         XML sections)       to overlays/)    banner)
```

**Available injection sections**: `purpose`, `required_reading`, `deferred_reading`, `context`, `execution`, `error_codes`, `success_criteria`

**Patch modes**: `append`, `prepend`, `replace`, `new-section`
</purpose>

<context>

```bash
$maestro-overlay "always run CLI verification after maestro-execute"
$maestro-overlay "require reading doc X before maestro-plan"
$maestro-overlay "--list"
$maestro-overlay "--remove cli-verify-after-execute"
```

**Flags**:
- `<intent>` — Natural-language description of what to inject and where
- `--list` — Show installed overlays and their applied state
- `--remove <name>` — Strip overlay from targets and delete its file

**Overlay storage**:
- User overlays: `~/.maestro/overlays/*.json`
- Shared docs: `~/.maestro/overlays/docs/*.md`
- Shipped examples: `~/.maestro/overlays/_shipped/` (read-only)

</context>

<invariants>
1. **Quick-exit first**: `--list` and `--remove` skip all intent parsing
2. **Pristine source preferred**: Always read `.claude/commands/<name>.md` for the untouched command spec before deciding injection point
3. **Idempotent content**: Injected blocks use hashed comment markers — re-runs produce no changes
4. **Heading required**: Every injected block must start with a `## <Title> (overlay)` heading
5. **Validate before report**: Run `maestro overlay add` successfully before displaying the report banner
6. **Max 2 clarification questions**: If intent is ambiguous, ask at most 2 focused questions then proceed with best guess
</invariants>

<execution>

### Step 1: Parse User Intent

```javascript
functions.update_plan({
  explanation: "Parsing overlay intent",
  plan: [
    { step: "Parse intent", status: "in_progress" },
    { step: "Identify targets and injection points", status: "pending" },
    { step: "Draft overlay JSON", status: "pending" },
    { step: "Install and report", status: "pending" }
  ]
})
```

**Quick-exit paths**:
- `--list` → `functions.exec_command({ cmd: "maestro overlay list" })` then stop
- `--remove <name>` → `functions.exec_command({ cmd: "maestro overlay remove <name>" })` then stop

**Ambiguous intent**: If intent does not clearly specify (a) which command to target or (b) where in the flow to inject, ask up to 2 focused questions:
```javascript
functions.request_user_input({
  id: "overlay-clarify",
  message: "Which command(s) should this overlay target? (e.g. maestro-execute, maestro-plan)"
})
```

### Step 2: Identify Targets and Injection Points

For each likely target command, read the pristine source from `$PKG_ROOT/.claude/commands/<name>.md` (preferred) or fall back to `~/.claude/commands/<name>.md`. Inspect XML sections and select injection point:

| Intent type | Section | Mode |
|-------------|---------|------|
| New step after execution | `execution` | `append` |
| Required reading / prerequisite | `required_reading` | `append` |
| Preconditions / gating | `context` | `append` |
| Output quality gate | `success_criteria` | `append` |
| Brand-new section | `execution` | `new-section` (with `afterSection`) |

### Step 3: Draft Overlay JSON

Build a slug from intent (kebab-case, lowercase, max 40 chars).

```javascript
functions.apply_patch:
*** Begin Patch
*** Add File: ~/.maestro/overlays/<slug>.json
+{
+  "name": "<slug>",
+  "description": "<short summary of what and why>",
+  "targets": ["<command-name>"],
+  "priority": 50,
+  "enabled": true,
+  "patches": [
+    {
+      "section": "<section>",
+      "mode": "<append|prepend|replace|new-section>",
+      "content": "<injected markdown content with (overlay) heading>"
+    }
+  ]
+}
*** End Patch
```

**Content guidelines**:
- Lead injected block with heading including `(overlay)` e.g. `## CLI Verification (overlay)`
- `@~/.maestro/...` references are encouraged for docs
- Keep content concise — overlay adds a step, not rewrites the command

```javascript
functions.update_plan({
  explanation: "Overlay JSON drafted",
  plan: [
    { step: "Parse intent", status: "completed" },
    { step: "Identify targets and injection points", status: "completed" },
    { step: "Draft overlay JSON", status: "completed" },
    { step: "Install and report", status: "in_progress" }
  ]
})
```

### Step 4: Install via CLI and Report

```javascript
functions.exec_command({
  cmd: "maestro overlay add ~/.maestro/overlays/<slug>.json",
  workdir: "."
})
```

On validation failure, fix the JSON and re-run (max 2 retries).

```javascript
functions.update_plan({
  explanation: "Overlay installed",
  plan: [
    { step: "Parse intent", status: "completed" },
    { step: "Identify targets and injection points", status: "completed" },
    { step: "Draft overlay JSON", status: "completed" },
    { step: "Install and report", status: "completed" }
  ]
})
```

Display report:
```
=== OVERLAY INSTALLED ===
Name:    <slug>
Path:    ~/.maestro/overlays/<slug>.json
Targets: <command> (applied), <command> (skipped: missing)
Scopes:  [global]

Re-apply: maestro overlay apply
Remove:   maestro overlay remove <slug>
Inspect:  maestro overlay list
```

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | `maestro overlay add` validation failed | Fix JSON syntax or section name, retry |
| E002 | error | No targets found (all commands missing) | Check command name spelling |
| E003 | error | `--remove` target not found in overlay store | Run `--list` to see installed overlays |
| W001 | warning | One or more targets skipped (command missing from install) | Overlay still installed; applies when command is added |

</error_codes>

<success_criteria>
- [ ] Intent parsed and targets identified
- [ ] Overlay JSON drafted with correct section and mode
- [ ] `maestro overlay add` executed successfully
- [ ] Report displayed with apply/remove/inspect commands
</success_criteria>
