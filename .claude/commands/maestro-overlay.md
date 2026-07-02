---
name: maestro-overlay
description: Create or edit command overlays from natural language
argument-hint: "<intent> — 描述要添加的规则或步骤，如 'always verify after execute'"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Turn natural-language instructions into command overlays — JSON patch files that augment
`.claude/commands/*.md` non-invasively. Auto-applied by `maestro install`.
</purpose>

<required_reading>
@~/.maestro/workflows/overlays.md
@~/.maestro/cli-tools.json
</required_reading>

<context>
**Overlay model**:
- JSON file: `name`, `targets[]` (command names), `patches[]`
- Patch: `section` (XML tag), `mode` (append/prepend/replace/new-section), `content`
- Apply: hashed HTML-comment markers (idempotent, surgical removal)

**Where overlays live**
- User overlays: `~/.maestro/overlays/*.json` — created by this skill
- Shared docs: `~/.maestro/overlays/docs/*.md` — referenced via `@~/.maestro/overlays/docs/*.md` inside patch content
- Shipped examples: `~/.maestro/overlays/_shipped/` — read-only, do not edit

**Management** — listing and removing overlays is handled by `maestro overlay list` (ink TUI with interactive delete). This skill focuses solely on creation.

**Available sections** (for `section:` in patches): `purpose`, `required_reading`, `deferred_reading`, `context`, `execution`, `error_codes`, `success_criteria`.

**Output boundary**: ALL file writes MUST target `~/.maestro/overlays/` (overlay JSON + docs) only. Command file patching is handled by `maestro overlay add` — this skill NEVER modifies `.claude/commands/*.md` directly.
</context>

<invariants>
1. **Non-invasive** — overlays MUST use hashed HTML-comment markers for injection; NEVER edit command file content directly outside the overlay system
2. **Idempotent** — re-running `maestro overlay apply` with the same overlay JSON MUST produce no file changes
3. **Creation only** — this skill MUST only create overlays; listing and removal are handled by `maestro overlay list` (ink TUI)
4. **Pristine source preferred** — injection point analysis MUST read from `$PKG_ROOT/.claude/commands/` (untouched originals) first, fall back to `~/.claude/commands/` only if pristine unavailable
5. **User approval before write** — overlay JSON MUST be shown and approved via AskUserQuestion before writing to disk; NEVER auto-install without confirmation
6. **Chain skip option mandatory** — if a skill chain is configured, the injected content MUST include a "Skip" option in AskUserQuestion; NEVER force the user into a chain
</invariants>

<execution>
### 1. Parse user intent

Treat the argument as natural-language intent. If unclear, ask up to 2 questions with AskUserQuestion: (a) which command(s) to target, (b) where in the command flow the injection should happen.

### 2. Identify targets, injection points, and visualize

For each likely target command, read the pristine source from `$PKG_ROOT/.claude/commands/<name>.md` (preferred — untouched by overlays) or fall back to `~/.claude/commands/<name>.md`. Inspect the XML sections and pick the right one:

- **New step after execution** → `section: execution`, `mode: append`
- **Required reading** → `section: required_reading`, `mode: append`
- **Preconditions / gating** → `section: context`, `mode: append`
- **Output quality gate** → `section: success_criteria`, `mode: append`

If the user wants a whole new section, use `mode: new-section` with `afterSection: execution` (or whichever anchor makes sense).

**Injection point preview** — after selecting section + mode, render the target command's section map showing existing overlays and the new injection point:

```
=== maestro-execute.md (1 overlay exists) ===

  <purpose>
  <required_reading>
  <context>
  <execution>
     ├─ [existing] cli-verify #1  "CLI Verification step"
     >>> NEW: append here (your overlay)
  <success_criteria>
```

Use AskUserQuestion to confirm:
- **"Confirm"** — proceed with this injection point
- **"Pick different section"** — re-select section/mode
- **"Cancel"** — abort

### 2.5. Skill chain configuration

After confirming the injection point, ask whether this overlay should chain to another skill upon completion. This enables the overlay's injected content to hand off to a skill via AskUserQuestion at runtime — similar to how `/maestro` chains commands via `Skill({ skill: "...", args: "..." })`.

Use AskUserQuestion:
- **"No chain"** — standard overlay, no skill handoff
- **"Chain to skill"** → ask for the target skill name (e.g., `quality-review`, `maestro-execute`, `quality-test`)
- **"Chain with alternatives"** → ask for primary skill + 1-2 alternative skills

If chain is selected, record the skill name(s) for use in Step 3.

### 3. Draft the overlay JSON

Build a slug from the user's intent (kebab-case, lowercase). Write to `~/.maestro/overlays/<slug>.json`:

```json
{
  "name": "<slug>",
  "description": "<short summary of what and why>",
  "targets": ["maestro-execute"],
  "priority": 50,
  "enabled": true,
  "patches": [
    {
      "section": "execution",
      "mode": "append",
      "content": "## CLI Verification (overlay)\n\nAfter execution, run:\n```\nccw cli -p \"PURPOSE: ...\" --mode analysis --rule analysis-review-code-quality\n```"
    }
  ]
}
```

**Content guidelines**
- Lead the injected block with a heading that includes `(overlay)` so readers see it's machine-injected
- Keep content concise — overlays should add a step, not rewrite the command
- `@~/.maestro/...` references are encouraged for pointing at docs
- Escape `\n` in JSON strings; use a HEREDOC via Bash if content is long

**Skill chain content** — if a chain was configured in Step 2.5, append a Skill Handoff block at the end of the patch `content`. The handoff uses AskUserQuestion so the user controls whether to proceed:

```markdown
---

**Skill Handoff** (overlay)

After the above step completes, use AskUserQuestion:
- "Proceed to /quality-review" — Hand off to quality review
- "Skip" — Continue with current command flow
- "Alternative: /maestro-execute" — Run execution with built-in verification instead

On user selection:
- Proceed → Skill({ skill: "quality-review", args: "{phase}" })
- Alternative → Skill({ skill: "maestro-execute", args: "{phase}" })
- Skip → continue normally
```

Handoff rules:
- Always include a **"Skip"** option — the user can always decline the chain
- Use `Skill({ skill: "<name>", args: "..." })` syntax consistent with maestro.md chainMap
- Mark handoff heading with `(overlay)` tag
- Support runtime variable placeholders: `{phase}`, `{description}`, `{session_id}`
- Keep handoff block under 10 lines of markdown

### 3.5. Content approval

Display the full overlay JSON to the user. AskUserQuestion:
- **"Approve & install"** — proceed to installation
- **"Edit"** — user provides corrections, re-draft
- **"Cancel"** — discard overlay, do not write

Only write the overlay JSON file to `~/.maestro/overlays/<slug>.json` after user approval.

### 4. Install via `maestro overlay add`

Run:

```bash
maestro overlay add ~/.maestro/overlays/<slug>.json
```

### 5. Report

Show the user:
- Path of the saved overlay JSON
- Which targets were patched and which were skipped (missing/disabled)
- Skill chain info (if configured)
- A reminder that `maestro install` will auto-reapply on every run
- How to remove: `maestro overlay remove <slug>`

**Report format**

```
=== OVERLAY INSTALLED ===
Name:    <slug>
Path:    ~/.maestro/overlays/<slug>.json
Targets: maestro-execute (applied), maestro-plan (skipped: missing)
Chain:   quality-review (via AskUserQuestion) | none
Scopes:  [global]

Re-apply: maestro overlay apply
Remove:   maestro overlay remove <slug>
Inspect:  maestro overlay list
```

After the report, remind the user they can run `maestro overlay list` for the interactive TUI showing section maps and overlay management.
</execution>

<success_criteria>
- [ ] Overlay JSON written to `~/.maestro/overlays/<slug>.json` and validates
- [ ] `maestro overlay add` exited successfully and applied to at least one scope
- [ ] Target command file(s) contain `<!-- maestro-overlay:<slug>#N hash=... -->` markers
- [ ] Re-running `maestro overlay apply` produces no file changes (idempotent)
- [ ] User shown the report with target list and removal instructions
- [ ] Injection point preview shown (with existing overlays + `>>>` marker) and confirmed before drafting
- [ ] If chain configured, `content` includes Skill Handoff block with AskUserQuestion + Skip option + `Skill()` calls
</success_criteria>

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Overlay installed | `maestro overlay list` for interactive management |
| Want to create another | `/maestro-overlay "<intent>"` |
| Want to remove | `maestro overlay remove <slug>` |
</completion>
