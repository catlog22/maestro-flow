---
title: "Overlay System Guide"
---

Maestro's Overlay system provides a non-invasive command extension mechanism -- injecting custom steps, reading requirements, quality gates, and other content without modifying the original `.claude/commands/*.md` files. Overlays are automatically reapplied on every `maestro install`, ensuring that extended content persists across installation upgrades.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Overlay File Format](#overlay-file-format)
- [Injection Mechanism](#injection-mechanism)
- [Command Reference](#command-reference)
- [Bundle Packaging and Import](#bundle-packaging-and-import)
- [Interactive Management TUI](#interactive-management-tui)
- [Overlay Creation Workflow](#overlay-creation-workflow)
- [Best Practices](#best-practices)

---

## Core Concepts

### The Problem

`.claude/commands/*.md` files are managed by `maestro install`. Directly editing these files will be overwritten on the next install. However, users frequently need to:

- Add CLI verification steps after `/maestro-ralph continue`
- Add required reading documents to `/maestro-next`
- Append quality gates at the end of `/maestro-ralph --engine swarm --script wf-review`

### The Solution

An Overlay is a JSON file that declares "what content to inject into which section of which command." The Patcher wraps injected content with HTML comment markers, achieving:

- **Idempotency** -- repeated applies do not produce duplicate content
- **Traceability** -- markers clearly indicate which overlay each piece of content comes from
- **Reversibility** -- `remove` precisely strips marked content without affecting other parts

### File Layout

```
~/.maestro/overlays/
├── cli-verify.json              # User overlay
├── quality-gate.json            # User overlay
├── docs/                        # Documents referenced by overlays
│   └── verify-protocol.md
└── _shipped/                    # Read-only overlays shipped with maestro (do not edit)
```

---

## Overlay File Format

```json
{
  "name": "cli-verify",
  "description": "Add CLI verification after execution",
  "targets": ["maestro-ralph", "maestro-next"],
  "priority": 50,
  "enabled": true,
  "patches": [
    {
      "section": "required_reading",
      "mode": "append",
      "content": "## CLI Verification Protocol (overlay)\n\n@~/.maestro/overlays/docs/verify-protocol.md"
    },
    {
      "section": "execution",
      "mode": "append",
      "content": "## CLI Verification (overlay)\n\nAfter execution, run:\n```bash\nmaestro delegate \"PURPOSE: Verify...\" --mode analysis\n```"
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier, kebab-case (`/^[a-z0-9][a-z0-9-_]*$/`) |
| `description` | string | No | Human-readable description |
| `targets` | string[] | Yes | Target command names (without `.md`), e.g. `["maestro-ralph"]` |
| `priority` | number | No | Application priority; lower numbers are applied first (default 50) |
| `enabled` | boolean | No | Set to `false` to temporarily disable (default true) |
| `scope` | string | No | `"global"` / `"project"` / `"any"` (default any) |
| `docs` | string[] | No | List of referenced document paths |
| `patches` | Patch[] | Yes | List of patches |

### Patch Fields

| Field | Type | Description |
|-------|------|-------------|
| `section` | string | Target XML section name |
| `mode` | string | `"append"` / `"prepend"` / `"replace"` / `"new-section"` |
| `content` | string | Markdown content to inject |
| `afterSection` | string | `new-section` mode only: insert the new section after this section |

### Available Sections

XML section tags in command files:

| Section | Purpose |
|---------|---------|
| `purpose` | Command purpose |
| `required_reading` | Required reading before execution |
| `deferred_reading` | Deferred reference materials |
| `context` | Context and background information |
| `execution` | Execution steps |
| `error_codes` | Error code handling |
| `success_criteria` | Success criteria |

### Mode Behavior

| Mode | Behavior |
|------|----------|
| `append` | Appends content before the section's closing tag |
| `prepend` | Inserts content after the section's opening tag |
| `replace` | Replaces the entire section content |
| `new-section` | Creates a new XML section (position controlled via `afterSection`) |

---

## Injection Mechanism

### Marker Format

The Patcher wraps each patch's injected content with HTML comment markers:

```markdown
<execution>
... original content ...

<!-- maestro-overlay:cli-verify#1 hash=a3f8b2c1 -->
## CLI Verification (overlay)

After execution, run:
...
<!-- /maestro-overlay:cli-verify#1 -->
</execution>
```

- `cli-verify` -- overlay name
- `#1` -- patch index within the overlay
- `hash=a3f8b2c1` -- SHA-256 short hash of the patch content, used for change detection

### Idempotency Guarantee

On each apply, the patcher first checks whether the same marker already exists. If it exists with a matching hash, it is skipped (unchanged); if the hash differs, the old marker is stripped before re-injecting (changed).

### Priority Ordering

When multiple overlays target the same section, they are applied in ascending `priority` order (lower numbers first; later appended content appears below earlier appended content).

---

## Command Reference

### Basic Operations

```bash
# View all overlays and section map (interactive TUI)
maestro overlay list

# Non-interactive mode (suitable for pipelines/CI)
maestro overlay list --no-interactive

# Apply all overlays (idempotent)
maestro overlay apply

# Add a single overlay and apply immediately
maestro overlay add <file.json>

# import is an alias for add
maestro overlay import <file.json>

# Export a single overlay to a file
maestro overlay export <name>
maestro overlay export <name> -o /path/to/output.json

# Remove an overlay (strip markers + delete file)
maestro overlay remove <name>
```

### Bundle Operations

```bash
# Package all overlays into a single bundle file
maestro overlay bundle
maestro overlay bundle -o my-overlays.json

# Package only specified overlays
maestro overlay bundle -n cli-verify quality-gate

# Import all overlays from a bundle and apply
maestro overlay import-bundle overlays-bundle.json
```

---

## Bundle Packaging and Import

### Purpose

Bundles solve overlay sharing and migration problems:

- **Team sharing** -- package the project team's overlay configuration for new members
- **Machine migration** -- restore all overlays on a new machine with one command
- **Backup** -- overlays and referenced docs are packaged together, nothing gets left behind

### Bundle Format

```json
{
  "version": "1.0",
  "overlays": [
    { "name": "cli-verify", "targets": [...], "patches": [...] },
    { "name": "quality-gate", "targets": [...], "patches": [...] }
  ],
  "docs": {
    "verify-protocol.md": "# Verify Protocol\n\n...",
    "quality-gate-spec.md": "# Quality Gate\n\n..."
  }
}
```

- `overlays` -- complete array of OverlayMeta objects
- `docs` -- documents referenced in overlay patch content via `@~/.maestro/overlays/docs/<name>`, automatically collected during packaging

### Automatic Document Collection

During packaging, the system scans all selected overlays' patch content, extracts `@~/.maestro/overlays/docs/<filename>` references, and automatically includes the corresponding file contents in the bundle's `docs` field. During import, these documents are restored to the `~/.maestro/overlays/docs/` directory.

### Workflow Example

```bash
# Machine A: Export
maestro overlay bundle -o team-overlays.json
# → Generates a bundle containing 2 overlays + 1 doc

# Machine B: Import
maestro overlay import-bundle team-overlays.json
# → Unpacks overlays + docs → auto apply
```

---

## Interactive Management TUI

Running `maestro overlay list` launches a terminal UI based on [ink](https://github.com/vadimdemedes/ink):

```
Overlays

cli-verify  [enabled]  priority=50  applied[global]
    targets: maestro-ralph, maestro-next
    Add CLI verification after execution

quality-gate  [enabled]  priority=60  applied[global]
    targets: maestro-ralph
    Quality gate for execution output

=== maestro-ralph.md (2 overlays) ===
  [L5-L12]    <required_reading>
                 ├─ cli-verify (#0)  "verify-protocol.md ref"
  [L20-L85]   <execution>
                 ├─ cli-verify (#1)  "CLI Verification step"
                 ├─ quality-gate (#0)  "Quality gate check"
  [L86-L95]   <success_criteria>
                 ├─ quality-gate (#1)  "Pass rate criterion"

[d] Delete  [q] Quit
```

### Features

| Shortcut | Action |
|----------|--------|
| `d` | Enter delete mode -- use arrow keys to select an overlay, Enter to confirm deletion |
| `q` / `Esc` | Quit |
| `↑` / `↓` | Navigate selection in delete mode |
| `Enter` | Confirm deletion of the selected overlay |

### Section Map Explanation

The section map is grouped by **target command file**, with each section showing its line range and the overlay patches it contains. Patches are grouped by **overlay name** (not individual patch numbers), so multiple patches from the same overlay are displayed together, corresponding to the delete operation (which removes an entire overlay by name).

---

## Overlay Creation Workflow

Use the `/maestro-overlay` command to create overlays via natural language:

```bash
# Describe your intent in natural language
/maestro-overlay "Add CLI code quality verification after maestro-ralph continue"

# Interactive flow:
# 1. Parse intent → confirm target command and injection location
# 2. Preview injection points (showing existing overlays and >>> NEW markers)
# 3. Optional Skill Chain configuration (auto-redirect to other commands after execution)
# 4. Generate overlay JSON and install via maestro overlay add
# 5. Output installation report
```

### Manual Creation

1. Write the overlay JSON file
2. `maestro overlay add <file.json>` to install and apply
3. `maestro overlay list` to verify

---

## Best Practices

### Naming

- Use descriptive kebab-case names: `cli-verify-after-execute`, not `patch1`
- Names should reflect "what it does" rather than "what it modifies"

### Content

- Add an `(overlay)` suffix to injected content headings, making it easy for human readers to identify machine-injected content
- Keep injected content concise -- an overlay should "add a step", not "rewrite the entire command"
- Reference external documents using `@~/.maestro/overlays/docs/` paths; they will be automatically collected during packaging

### Priority

- `10-30`: Infrastructure (required reading, prerequisites)
- `40-60`: Standard steps (default 50)
- `70-90`: Post-checks, quality gates

### Team Collaboration

- Use `bundle` / `import-bundle` to share team configurations
- Store project-level overlays in version control and distribute via `maestro overlay import-bundle` in CI
- The `_shipped/` directory is reserved for official maestro overlays -- do not edit manually
