---
name: maestro-amend
description: Collect deficiency signals from workflow artifacts, sessions, and user reports, then generate overlays to amend workflow commands
argument-hint: "[description] [--from-verify <dir>] [--from-review <dir>] [--from-session <id>] [--from-issues ISS-xxx,...] [--scan] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Signal-driven overlay generator — collects workflow deficiency signals from heterogeneous sources (verification gaps, review findings, debug sessions, open issues, user feedback), diagnoses which commands need amendment, and batch-generates targeted overlays to fix them.

Differs from `/maestro-overlay` which takes a single explicit intent. This command **discovers** what needs amending by analyzing workflow artifacts, then proposes and applies overlay fixes automatically.

**Mechanism**: All amendments use the overlay system (`~/.maestro/overlays/*.json`) — non-invasive, idempotent, survives reinstall.
</purpose>

<required_reading>
@~/.maestro/workflows/overlays.md
@~/.maestro/cli-tools.json
</required_reading>

<context>
$ARGUMENTS — optional description and/or source flags.

### Signal Sources

| Flag | Source | What it collects |
|------|--------|------------------|
| `--from-verify <dir>` | `verification.json` | Workflow gaps exposed by verify failures |
| `--from-review <dir>` | `review.json` | Process deficiencies from code review |
| `--from-session <id>` | Session artifacts | Problems encountered during workflow execution |
| `--from-issues ISS-xxx,...` | `issues.jsonl` | Issues that trace to command deficiency |
| `--scan` | Auto-scan `.workflow/` | Discover all workflow-related signals |
| _(positional text)_ | User description | Direct observation of command deficiency |

Multiple sources combinable. No flags and no description → interactive mode.

### Control Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Generate overlay JSON, show preview, don't install |
| `-y` | Skip confirmations |

### Signal-to-Overlay Classification

A signal becomes an overlay candidate when it identifies a **workflow command deficiency** — a missing step, missing precondition, absent reading, or gap in success criteria. Signals about code bugs (not command gaps) are out of scope; suggest `/maestro-quick` or `/maestro-plan --gaps` for those.

### CLI Targeting

Overlays support the `cli` field to target different workflow systems:
- `"cli": "claude"` (default) → patches `.claude/commands/{name}.md`
- `"cli": "codex"` → patches `.codex/skills/{name}/SKILL.md`
- `"cli": "both"` → patches both paths

When diagnosing signals, determine which CLI's workflow is affected and set the `cli` field accordingly.

### Output
- Overlay files: `~/.maestro/overlays/amend-{slug}.json`
- Optional docs: `~/.maestro/overlays/docs/amend-{slug}.md`
</context>

<execution>
### 1. Collect signals

Parse $ARGUMENTS for source flags and description text.

**If no sources and no description** → interactive mode:
Scan `.workflow/` for recent artifacts containing workflow-level signals:

```
candidates = []

# Verification: workflow gaps (not code bugs)
for each verification.json in .workflow/scratch/*-verify-*/
  extract must_have_failures, anti_pattern items
  filter for items whose fix_direction points at a command gap
  (e.g., "missing pre-check step", "no reading for X", "success criteria incomplete")

# Review: process findings
for each review.json in .workflow/scratch/*-review-*/
  extract findings tagged as "process" or "workflow"

# Debug sessions: root causes tracing to command omission
for each understanding.md in .workflow/scratch/*-debug-*/
  extract root causes where cause_type mentions workflow/command

# Open issues: workflow-tagged
issues = read .workflow/issues/issues.jsonl
  | filter status == "open" AND tags include "workflow" or "command"

# Execution summaries: deviations
for each summary in .workflow/scratch/*-plan-*/.summaries/
  extract plan deviations that suggest a missing command step
```

Display scan results and use AskUserQuestion (multiSelect) to let user pick sources. Also allow user to add a freeform description.

**If source flags** → extract signals from each specified source.

**If only description** → user's text is the sole signal. Parse for:
- Which command(s) are affected
- What's missing or broken in the command flow
- What the expected behavior should be

### 2. Diagnose: map signals to command patches

For each signal, determine:

```
{
  signal_id: "SIG-001",
  source: "verify:scratch/20260426-verify-M1/",
  description: "maestro-execute skipped pre-flight when no test suite exists",
  target_command: "maestro-execute",
  target_section: "execution",
  patch_mode: "append",
  fix_direction: "Add fallback verification when no test suite detected",
  severity: "medium"
}
```

**Diagnosis heuristics:**

| Signal pattern | Target section | Mode |
|---------------|----------------|------|
| Missing pre-check / gate | `execution` | `prepend` |
| Missing post-step / verification | `execution` | `append` |
| Missing reading / context | `required_reading` or `deferred_reading` | `append` |
| Incomplete success criteria | `success_criteria` | `append` |
| Missing error handling | `error_codes` | `append` |
| Scope/context gap | `context` | `append` |
| Entirely new concern | _(new section)_ | `new-section` |

If target command is ambiguous, read the pristine source from `$PKG_ROOT/.claude/commands/<name>.md` (preferred) or `~/.claude/commands/<name>.md` to confirm the right section.

### 3. Group and plan overlays

Group signals by target command. Signals hitting the same command **and** same section merge into one patch. Different sections on the same command stay as separate patches in one overlay.

Decide overlay granularity:
- **Single-concern** (1–2 signals on same command) → one overlay per command: `patch-{command}-{slug}.json`
- **Multi-concern** (3+ signals across commands) → one umbrella overlay: `amend-{slug}.json`

For each planned overlay, read the target command's pristine source to:
- Verify the section exists
- Check for existing overlays (via `<!-- maestro-overlay:` markers)
- Confirm the injection point makes sense

### 4. Preview injection points

For each target command, render a section map with injection points (same format as `/maestro-overlay`):

```
=== maestro-execute.md (1 existing overlay) ===

  <purpose>
  <required_reading>
     ├─ [existing] require-spec-before-plan #0
  <context>
  <execution>
     ├─ [existing] require-spec-before-plan #1  "Pre-check: Load Spec"
     ├─ [existing] cli-verify-after-execute #0  "CLI Verification"
     >>> NEW: prepend — SIG-001 "Fallback verify when no tests"
     >>> NEW: append  — SIG-003 "Issue sync retry on failure"
  <error_codes>
  <success_criteria>
     >>> NEW: append  — SIG-002 "Verify issue status updated"

=== maestro-plan.md (0 existing overlays) ===

  <purpose>
  <required_reading>
  <context>
     >>> NEW: append  — SIG-004 "Load prior patch history"
  <execution>
  <success_criteria>
```

Use AskUserQuestion to confirm:
- **"Apply all"** — proceed with all patches
- **"Select patches"** — per-signal confirmation
- **"Edit"** — modify a specific signal's target/section before proceeding
- **"Cancel"** — abort

### 5. Draft overlay JSON

For each overlay, build the JSON following the overlay schema:

```json
{
  "name": "amend-execute-verify-fallback",
  "description": "Add fallback verification and issue sync retry to maestro-execute [from: AMEND-20260426]",
  "targets": ["maestro-execute"],
  "cli": "claude",
  "priority": 60,
  "enabled": true,
  "patches": [
    {
      "section": "execution",
      "mode": "prepend",
      "content": "## Fallback Verification (patch: SIG-001)\n\nIf no test suite exists for the affected module, run a structural verification instead:\n..."
    },
    {
      "section": "execution",
      "mode": "append",
      "content": "## Issue Sync Retry (patch: SIG-003)\n\nIf issue status sync fails, retry once before logging as warning:\n..."
    },
    {
      "section": "success_criteria",
      "mode": "append",
      "content": "- [ ] Issue statuses confirmed synced after execution (patch: SIG-002)"
    }
  ]
}
```

**Content rules:**
- Heading includes `(patch: SIG-NNN)` for traceability
- Content is concise — fix the gap, nothing more
- `@~/.maestro/overlays/docs/` references for anything longer than 10 lines
- If supplementary doc needed, write it to `~/.maestro/overlays/docs/amend-{slug}.md` first

Write overlay JSON to `~/.maestro/overlays/amend-{slug}.json`.

If `--dry-run`, show the JSON and section map preview, then stop.

### 6. Install overlays

For each generated overlay:

```bash
maestro overlay add ~/.maestro/overlays/amend-{slug}.json
```

On validation failure, fix the JSON and retry (max 2 attempts).

### 7. Report

```
=== AMEND OVERLAYS INSTALLED ===
Session:   AMEND-20260426
Signals:   5 collected, 4 applied, 1 skipped (code bug, not command gap)
Overlays:  2 created

  amend-execute-verify-fallback
    Targets:  maestro-execute (3 patches: exec prepend, exec append, criteria append)
    Path:     ~/.maestro/overlays/amend-execute-verify-fallback.json
    Source:   SIG-001, SIG-002, SIG-003

  amend-plan-context-history
    Targets:  maestro-plan (1 patch: context append)
    Path:     ~/.maestro/overlays/amend-plan-context-history.json
    Source:   SIG-004

Skipped:
  SIG-005   "Missing null check in auth.ts" → code bug, use /maestro-quick

Re-apply:  maestro overlay apply
Remove:    maestro overlay remove amend-execute-verify-fallback
Inspect:   maestro overlay list
```

### Post-patch routing

Use AskUserQuestion:
- **"Test commands"** — run affected commands to verify patches work
- **"View overlays"** — `maestro overlay list`
- **"Continue"** — done
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No signals found from any source | Verify artifact paths, or provide description |
| E002 | error | Source artifact not found | Check path exists |
| E003 | error | No signals map to command deficiencies (all are code bugs) | Use `/maestro-quick` or `/maestro-plan --gaps` instead |
| E004 | error | Overlay validation failed after 2 retries | Review generated JSON manually |
| W001 | warning | Some signals skipped (code bugs, not command gaps) | Route to appropriate fix command |
| W002 | warning | Target command has many existing overlays (≥3) | Consider consolidating overlays |
| W003 | warning | Scan found no recent workflow artifacts | Check `.workflow/` or provide explicit source |
</error_codes>

<success_criteria>
- [ ] Signal sources resolved and signals collected
- [ ] Each signal classified: command deficiency vs. code bug (only command deficiencies proceed)
- [ ] Signals mapped to target command + section + mode
- [ ] Pristine command sources read to verify sections and check existing overlays
- [ ] Section map with injection points shown and confirmed by user
- [ ] Overlay JSON written to `~/.maestro/overlays/amend-{slug}.json`
- [ ] Supplementary docs written to `~/.maestro/overlays/docs/` if needed
- [ ] `maestro overlay add` exited successfully for each overlay
- [ ] Target command files contain `<!-- maestro-overlay:amend-{slug}#N hash=... -->` markers
- [ ] Report shown with overlay details, source traceability, and skipped signals
- [ ] Skipped code-bug signals routed to appropriate alternative command
</success_criteria>
