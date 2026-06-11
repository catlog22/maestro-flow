---
name: maestro-amend
description: Generate overlays to fix workflow command deficiencies
argument-hint: "[description] [--from-verify <dir>] [--from-review <dir>] [--from-session <id>] [--from-issues ISS-xxx,...] [--scan] [--dry-run]"
allowed-tools: Read, Write, Bash, Glob, Grep, request_user_input
---
<purpose>
Signal-driven overlay generator — collect workflow deficiency signals from multiple sources, diagnose which commands need amendment, batch-generate targeted overlays. All amendments use overlay system (`~/.maestro/overlays/*.json`) — non-invasive, idempotent, survives reinstall.

Differs from `$maestro-overlay` (single explicit intent). This command **discovers** what needs amending by analyzing workflow artifacts.
</purpose>

<required_reading>
@~/.maestro/workflows/overlays.md
@~/.maestro/cli-tools.json
</required_reading>

<context>
$ARGUMENTS — optional description and/or source flags.

**Signal sources**:

| Flag | Source | Collects |
|------|--------|----------|
| `--from-verify <dir>` | verification.json | Workflow gaps from verify failures |
| `--from-review <dir>` | review.json | Process deficiencies from code review |
| `--from-session <id>` | Session artifacts | Problems during workflow execution |
| `--from-issues ISS-xxx,...` | issues.jsonl | Issues tracing to command deficiency |
| `--scan` | Auto-scan .workflow/ | Discover all workflow-related signals |
| _(positional text)_ | User description | Direct observation |

Multiple combinable. No flags + no description → interactive (scan + request_user_input).

**Control**: `--dry-run` (preview, don't install), `-y` (skip confirmations)

**CLI targeting**: `"cli": "claude"` (default, patches .claude/commands/), `"codex"` (patches .codex/skills/), `"both"` (both paths)

**Output**: `~/.maestro/overlays/amend-{slug}.json` + optional `~/.maestro/overlays/docs/amend-{slug}.md`
</context>

<state_machine>

<states>
S_COLLECT      — 收集信号（从 flags / scan / description）    PERSIST: —
S_DIAGNOSE     — 映射信号到命令补丁                           PERSIST: —
S_GROUP        — 分组、规划 overlay 粒度                      PERSIST: —
S_PREVIEW      — 展示注入点地图、用户确认                     PERSIST: —
S_DRAFT        — 生成 overlay JSON                            PERSIST: overlay files
S_INSTALL      — 安装 overlay                                 PERSIST: command files
S_REPORT       — 报告摘要 + post-patch routing                PERSIST: —
</states>

<transitions>

S_COLLECT:
  → S_DIAGNOSE    WHEN: signals found                      DO: A_COLLECT_SIGNALS
  → ERROR(E001)   WHEN: no signals from any source

S_DIAGNOSE:
  → S_GROUP       WHEN: command deficiencies identified     DO: A_DIAGNOSE_SIGNALS
  → ERROR(E003)   WHEN: all signals are code bugs (not command gaps)

S_GROUP:
  → S_PREVIEW     DO: A_GROUP_OVERLAYS

S_PREVIEW:
  → S_DRAFT       WHEN: user confirms "Apply all" or selects patches
  → S_PREVIEW     WHEN: user selects "Edit"                DO: modify signal target/section
  → END           WHEN: user cancels

S_DRAFT:
  → S_INSTALL     WHEN: not --dry-run                      DO: A_DRAFT_OVERLAYS
  → END           WHEN: --dry-run                          DO: display JSON + section map preview

S_INSTALL:
  → S_REPORT      DO: A_INSTALL_OVERLAYS (`maestro overlay add`, retry max 2 on validation failure)

S_REPORT:
  → END           DO: display summary (signals collected/applied/skipped, overlay details, skipped code-bug routing)

</transitions>

<actions>

### A_COLLECT_SIGNALS

**If source flags**: extract signals from each specified source.
**If --scan or interactive**: scan .workflow/ for:
- verification.json → must_have_failures, anti_patterns (filter for command gap direction)
- review.json → findings tagged "process" or "workflow"
- debug understanding.md → root causes with workflow/command cause_type
- issues.jsonl → status=open AND tags include "workflow"/"command"
- execution summaries → plan deviations suggesting missing command step

**If only description**: parse for affected command(s), what's missing, expected behavior.

### A_DIAGNOSE_SIGNALS

Per signal, determine:
- signal_id, source, description, target_command, target_section, patch_mode, fix_direction, severity

**Section mapping**:

| Signal pattern | Section | Mode |
|---------------|---------|------|
| Missing pre-check/gate | execution | prepend |
| Missing post-step/verification | execution | append |
| Missing reading/context | required_reading / deferred_reading | append |
| Incomplete success criteria | success_criteria | append |
| Missing error handling | error_codes | append |
| Scope/context gap | context | append |
| Entirely new concern | _(new section)_ | new-section |

Read pristine source from `$PKG_ROOT/.claude/commands/<name>.md` to confirm section.
Classify: command deficiency → proceed; code bug → skip (suggest $maestro-quick).

### A_GROUP_OVERLAYS

Group by target command + section (merge same command+section).
Granularity: 1-2 signals → `patch-{command}-{slug}.json`; 3+ cross-command → `amend-{slug}.json`.
Read target commands to verify sections exist, check existing overlays.

Display section map with injection points per target command.

### A_DRAFT_OVERLAYS

Build overlay JSON per schema: name, description, targets[], cli, priority (60), enabled, patches[{section, mode, content}].
Content rules: heading includes `(patch: SIG-NNN)`, concise, supplementary doc to `~/.maestro/overlays/docs/` if >10 lines.

### A_INSTALL_OVERLAYS

```bash
maestro overlay add ~/.maestro/overlays/amend-{slug}.json
```
On validation failure: fix JSON, retry (max 2).

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No signals from any source | Verify artifact paths or provide description |
| E003 | All signals are code bugs, not command gaps | Use $maestro-quick or $maestro-plan --gaps |
| E004 | Overlay validation failed after 2 retries | Review JSON manually |
| W001 | Some signals skipped (code bugs) | Route to appropriate fix command |
| W002 | Target command has >= 3 existing overlays | Consider consolidating |
</error_codes>

<success_criteria>
- [ ] Signals classified: command deficiency vs code bug
- [ ] Pristine command sources read to verify injection points
- [ ] Section map with injection points confirmed by user
- [ ] Overlay JSON installed successfully; command files contain overlay markers
- [ ] Skipped code-bug signals routed to alternatives
</success_criteria>
