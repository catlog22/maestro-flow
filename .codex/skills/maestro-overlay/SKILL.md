---
name: maestro-overlay
description: Create or edit command overlays from natural language, or
  auto-generate them from workflow deficiency signals
argument-hint: <intent> | --amend [description] [--from-verify <dir>]
  [--from-review <dir>] [--from-session <id>] [--from-issues ISS-xxx,...]
  [--scan] [--dry-run] [-y]
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
session-mode: none
version: 0.5.51
---

<purpose>
Turn instructions into command overlays — JSON patch files that augment `.claude/commands/*.md`
non-invasively, auto-applied by `maestro install`. Two modes:

- **Default (intent)** — turn a natural-language instruction into one overlay interactively.
- **`--amend`** — signal-driven auto-generation: collect workflow deficiency signals from
  multiple sources, diagnose which commands need amendment, batch-generate targeted overlays.

Both modes use the same overlay system (`~/.maestro/overlays/*.json`) — non-invasive, idempotent,
survives reinstall.
</purpose>

<context>
**Mode selection**: `--amend` (or any `--from-*` / `--scan` signal flag) → **Amend mode** (signal-driven auto-generation, jump to `<amend_mode>` in execution). Otherwise → **Default mode** (natural-language intent, steps 1–5 below).

**Overlay model**:
- JSON file: `name`, `targets[]` (command names), `patches[]`
- Patch: `section` (XML tag), `mode` (append/prepend/replace/new-section), `content`
- Apply: hashed HTML-comment markers (idempotent, surgical removal)

**Where overlays live**
- User overlays: `~/.maestro/overlays/*.json` — created by this skill
- Shared docs: `~/.maestro/overlays/docs/*.md` — referenced via `@~/.maestro/overlays/docs/*.md` inside patch content
- Shipped examples: `~/.maestro/overlays/_shipped/` — read-only, do not edit

**Management** — listing and removing overlays is handled by `maestro overlay list` (ink TUI with interactive delete). This skill focuses solely on creation.

**Available sections** (for `section:` in patches): `purpose`, `required_reading`, `deferred_reading`, `context`, `execution`, `completion`, `invariants`, `error_codes`, `success_criteria`.

**Amend mode signal sources** (when `--amend`):

| Flag | Source | Collects |
|------|--------|----------|
| `--from-verify <dir>` | verification.json | Workflow gaps from verify failures |
| `--from-review <dir>` | review.json | Process deficiencies from code review |
| `--from-session <id>` | Session artifacts | Problems during workflow execution |
| `--from-issues ISS-xxx,...` | issues.jsonl | Issues tracing to command deficiency |
| `--scan` | Auto-scan .workflow/ | Discover all workflow-related signals |
| _(positional text)_ | User description | Direct observation |

Multiple combinable. `--amend` with no flags/description → interactive (scan + request_user_input).
Amend control: `--dry-run` (preview, don't install), `-y` (skip confirmations).
Amend output: `~/.maestro/overlays/amend-{slug}.json` + optional `~/.maestro/overlays/docs/amend-{slug}.md`.

**Output boundary**: ALL file writes MUST target `~/.maestro/overlays/` (overlay JSON + docs) only. Command file patching is handled by `maestro overlay add` — this skill NEVER modifies `.claude/commands/*.md` directly.
</context>

<invariants>
1. **Non-invasive** — overlays MUST use hashed HTML-comment markers for injection; NEVER edit command file content directly outside the overlay system
2. **Idempotent** — re-running `maestro overlay apply` with the same overlay JSON MUST produce no file changes
3. **Creation only** — this skill MUST only create overlays; listing and removal are handled by `maestro overlay list` (ink TUI)
4. **Pristine source preferred** — injection point analysis MUST read from `$PKG_ROOT/.claude/commands/` (untouched originals) first, fall back to `~/.claude/commands/` only if pristine unavailable
5. **User approval before write** — overlay JSON MUST be shown and approved via request_user_input before writing to disk; NEVER auto-install without confirmation
6. **Chain skip option mandatory** — if a skill chain is configured, the injected content MUST include a "Skip" option in request_user_input; NEVER force the user into a chain

**Amend mode only** (when `--amend`):

7. **Pristine source reads** — signal diagnosis MUST read from `$PKG_ROOT/.claude/commands/` (untouched originals), not installed copies
8. **Code bugs excluded** — signals classified as code bugs MUST be routed to step `quick` or step `plan` (`--gaps`), NEVER patched via overlay
9. **Section existence verified** — target section MUST be confirmed to exist in the pristine source before drafting a patch; missing sections trigger `new-section` mode
</invariants>

<execution>

> **Amend mode** (`--amend` or any `--from-*` / `--scan` flag): skip steps 1–5 below and follow `<amend_mode>` at the end of this section instead. **Default mode**: continue with steps 1–5.

### 1. Parse user intent

Treat the argument as natural-language intent. If unclear, ask up to 2 questions with request_user_input: (a) which command(s) to target, (b) where in the command flow the injection should happen.

### 2. Identify targets, injection points, and visualize

For each likely target command, read the pristine source from `$PKG_ROOT/.claude/commands/<name>.md` (preferred — untouched by overlays) or fall back to `~/.claude/commands/<name>.md`. Inspect the XML sections and pick the right one:

- **New step after execution** → `section: execution`, `mode: append`
- **Required reading** → `section: required_reading`, `mode: append`
- **Preconditions / gating** → `section: context`, `mode: append`
- **Output quality gate** → `section: success_criteria`, `mode: append`

If the user wants a whole new section, use `mode: new-section` with `afterSection: execution` (or whichever anchor makes sense).

**Injection point preview** — after selecting section + mode, render the target command's section map showing existing overlays and the new injection point:

```
=== quick.md (1 overlay exists) ===

  <purpose>
  <required_reading>
  <context>
  <execution>
     ├─ [existing] cli-verify #1  "CLI Verification step"
     >>> NEW: append here (your overlay)
  <success_criteria>
```

Use request_user_input to confirm:
- **"Confirm"** — proceed with this injection point
- **"Pick different section"** — re-select section/mode
- **"Cancel"** — abort

### 2.5. Skill chain configuration

After confirming the injection point, ask whether this overlay should chain to another skill upon completion. This enables the overlay's injected content to hand off to a skill via request_user_input at runtime, using `spawn_agent({ task_name: "...", message: "Execute skill ..., args: "..."" })` syntax.

Use request_user_input:
- **"No chain"** — standard overlay, no skill handoff
- **"Chain to skill"** → ask for the target skill name (e.g., a step like `review`, `execute`, `test` invoked via `maestro run prepare --platform codex <step>` + `maestro run create <step> --session YYYYMMDD-<step>-{topic} --intent "{goal}"`)
- **"Chain with alternatives"** → ask for primary skill + 1-2 alternative skills

If chain is selected, record the skill name(s) for use in Step 3.

### 3. Draft the overlay JSON

Build a slug from the user's intent (kebab-case, lowercase). Write to `~/.maestro/overlays/<slug>.json`:

```json
{
  "name": "<slug>",
  "description": "<short summary of what and why>",
  "targets": ["quick"],
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

**Skill chain content** — if a chain was configured in Step 2.5, append a Skill Handoff block at the end of the patch `content`. The handoff uses request_user_input so the user controls whether to proceed:

```markdown
---

**Skill Handoff** (overlay)

After the above step completes, use request_user_input:
- "Proceed to review" — Hand off to step `review` (`maestro run prepare --platform codex review` + `maestro run create review --session YYYYMMDD-review-{topic} --intent "{goal}"`)
- "Skip" — Continue with current command flow
- "Alternative: execute" — Run step `execute` with built-in verification instead

On user selection:
- Proceed → run step `review` (`maestro run prepare --platform codex review` + `maestro run create review --session YYYYMMDD-review-{topic} --intent "{goal}"`)
- Alternative → run step `execute` (`maestro run prepare --platform codex execute` + `maestro run create execute --session YYYYMMDD-execute-{topic} --intent "{goal}"`)
- Skip → continue normally
```

Handoff rules:
- Always include a **"Skip"** option — the user can always decline the chain
- Use `spawn_agent({ task_name: "<name>", message: "Execute skill <name>, args: "..."" })` syntax for handoff calls
- Mark handoff heading with `(overlay)` tag
- Support runtime variable placeholders: `{phase}`, `{description}`, `{session_id}`
- Keep handoff block under 10 lines of markdown

### 3.5. Content approval

Display the full overlay JSON to the user. request_user_input:
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
Targets: quick (applied), maestro-init (skipped: missing)
Chain:   review (via request_user_input) | none
Scopes:  [global]

Re-apply: maestro overlay apply
Remove:   maestro overlay remove <slug>
Inspect:  maestro overlay list
```

After the report, remind the user they can run `maestro overlay list` for the interactive TUI showing section maps and overlay management.

<amend_mode>
## Amend Mode — signal-driven auto-generation

Runs when `--amend` (or any `--from-*` / `--scan` signal flag) is present. Collects deficiency signals, diagnoses which commands need patching, batch-generates targeted overlays. State machine:

```
S_COLLECT   — 收集信号（从 flags / scan / description）    PERSIST: —
S_DIAGNOSE  — 映射信号到命令补丁                           PERSIST: —
S_GROUP     — 分组、规划 overlay 粒度                      PERSIST: —
S_PREVIEW   — 展示注入点地图、用户确认                     PERSIST: —
S_DRAFT     — 生成 overlay JSON                            PERSIST: overlay files
S_INSTALL   — 安装 overlay                                 PERSIST: command files
S_REPORT    — 报告摘要 + post-patch routing                PERSIST: —
```

Transitions: S_COLLECT → S_DIAGNOSE (signals found; else ERROR E001) → S_GROUP (command deficiencies found; else ERROR E003 when all signals are code bugs) → S_PREVIEW → S_DRAFT (user confirms "Apply all" / selects patches; "Edit" loops back to S_PREVIEW; cancel → END) → S_INSTALL (skipped when `--dry-run`, which displays JSON + section map and ENDs) → S_REPORT → END.

### A. Collect signals

**If source flags**: extract signals from each specified source.
**If `--scan` or interactive**: scan `.workflow/` for:
- verification.json → must_have_failures, anti_patterns (filter for command gap direction)
- review.json → findings tagged "process" or "workflow"
- debug understanding.md → root causes with workflow/command cause_type
- issues.jsonl → status=open AND tags include "workflow"/"command"
- execution summaries → plan deviations suggesting missing command step

**If only description**: parse for affected command(s), what's missing, expected behavior.

### B. Diagnose signals

Per signal, determine: signal_id, source, description, target_command, target_section, patch_mode, fix_direction, severity.

**Section mapping**:

| Signal pattern | Section | Mode |
|---------------|---------|------|
| Missing pre-check/gate | execution | prepend |
| Missing post-step/verification | execution | append |
| Missing reading/context | required_reading / deferred_reading | append |
| Incomplete success criteria | success_criteria | append |
| Missing error handling | error_codes | append |
| Scope/context gap | context | append |
| Wrong/missing next-step routing | completion | replace / append |
| Missing/wrong invariant | invariants | append |
| Entirely new concern | _(new section)_ | new-section |

Read pristine source from `$PKG_ROOT/.claude/commands/<name>.md` to confirm section.
Classify: command deficiency → proceed; code bug → skip (suggest step `quick`).

### C. Group overlays

Group by target command + section (merge same command+section). Granularity: 1-2 signals → `patch-{command}-{slug}.json`; 3+ cross-command → `amend-{slug}.json`. Read target commands to verify sections exist, check existing overlays. Display section map with injection points per target command.

### D. Preview & confirm

Display the section map with injection points. request_user_input: **Apply all** / **Select patches** / **Edit** (modify signal target/section, loop back) / **Cancel**. Skip confirmation if `-y`.

### E. Draft overlays

Build overlay JSON per schema: name, description, targets[], cli, priority (60), enabled, patches[{section, mode, content}]. Content rules: heading includes `(patch: SIG-NNN)`, concise, supplementary doc to `~/.maestro/overlays/docs/` if >10 lines. If `--dry-run`: display JSON + section map preview and END.

**CLI targeting**: `"cli": "claude"` (default, patches .claude/commands/), `"codex"` (patches .codex/skills/), `"both"` (both paths).

### F. Install

```bash
maestro overlay add ~/.maestro/overlays/amend-{slug}.json
```
On validation failure: fix JSON, retry (max 2).

### G. Report

Display summary: signals collected/applied/skipped, overlay details, skipped code-bug routing (to step `quick` or step `plan --gaps`).
</amend_mode>
</execution>

<error_codes>
Amend mode only:

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No signals from any source | Verify artifact paths or provide description |
| E002 | Signal source path invalid or unreadable | Check `--from-*` path; ensure artifact exists |
| E003 | All signals are code bugs, not command gaps | Use step `quick` or step `plan --gaps` |
| E004 | Overlay validation failed after 2 retries | Review JSON manually |
| W001 | Some signals skipped (code bugs) | Route to appropriate fix command |
| W002 | Target command has >= 3 existing overlays | Consider consolidating |
</error_codes>

<success_criteria>
Default mode:
- [ ] Overlay JSON written to `~/.maestro/overlays/<slug>.json` and validates
- [ ] `maestro overlay add` exited successfully and applied to at least one scope
- [ ] Target command file(s) contain `<!-- maestro-overlay:<slug>#N hash=... -->` markers
- [ ] Re-running `maestro overlay apply` produces no file changes (idempotent)
- [ ] User shown the report with target list and removal instructions
- [ ] Injection point preview shown (with existing overlays + `>>>` marker) and confirmed before drafting
- [ ] If chain configured, `content` includes Skill Handoff block with request_user_input + Skip option + `Skill()` calls

Amend mode:
- [ ] Signals classified: command deficiency vs code bug
- [ ] Pristine command sources read to verify injection points
- [ ] Section map with injection points confirmed by user (unless `-y`)
- [ ] Overlay JSON installed successfully; command files contain overlay markers
- [ ] Skipped code-bug signals routed to alternatives
</success_criteria>

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Overlay installed | `maestro overlay list` for interactive management |
| Want to create another | `/maestro-overlay "<intent>"` |
| Want to auto-fix from signals | `/maestro-overlay --amend --scan` |
| Want to remove | `maestro overlay remove <slug>` |
</completion>
