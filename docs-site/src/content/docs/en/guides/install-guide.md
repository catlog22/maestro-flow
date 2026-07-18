# Installation Guide

Maestro-Flow installation has two steps: global CLI install and project initialization.

---

## Quick Install

```bash
# 1. Install the global CLI
npm install -g maestro-flow

# 2. Initialize the project (run in the project root)
maestro install
```

**Prerequisites**:
- Node.js ≥ 18
- Claude Code CLI (required)
- Codex CLI / Gemini CLI (optional, for multi-agent workflows)

---

## Install Flow

`maestro install` performs the following steps:

1. **Detect project state** — empty project / existing code / existing .workflow/
2. **Select components** — interactive component selection
3. **Choose install mode** — global (~/.maestro/) or project-level (.workflow/)
4. **Copy files** — copy components to target locations per component definitions
5. **Generate manifest** — record installed components for incremental updates

---

## Component Groups

Since v0.5.32, install components are consolidated from 53 individual entries into 25 grouped bundles for a cleaner selection experience.

### Core Components (selected by default)

| Group | Description | Files |
|-------|-------------|-------|
| **commands** | Core slash commands | ~30 |
| **hooks** | Automation hooks | ~5 |
| **workflows** | Workflow scripts | ~10 |
| **specs** | Spec templates | 7 |

### Optional Skill Packs

The following 3 skill packs are unchecked by default (`defaultSelected: false`) — opt in as needed. After install, use `maestro install toggle` to enable/disable individual skills (see the *Enable/Disable Individual Skills* section below).

#### skills-extra-team (16 extra team skills)

Team collaboration enhancers covering architecture, frontend, debugging, motion, performance, UX, and accessibility:

| Skill | Description |
|-------|-------------|
| team-arch-opt | Architecture optimization |
| team-brainstorm | Multi-role brainstorming |
| team-designer | Team skill scaffolding |
| team-frontend | Frontend development |
| team-frontend-debug | Frontend debugging (Chrome DevTools) |
| team-interactive-craft | Interactive component crafting |
| team-issue | Issue resolution pipeline |
| team-motion-design | Animation & motion design |
| team-perf-opt | Performance optimization |
| team-planex | Plan-and-execute pipeline |
| team-roadmap-dev | Roadmap-driven development |
| team-ui-polish | UI polish |
| team-uidesign | Design tokens & audit |
| team-ultra-analyze | Deep collaborative analysis |
| team-ux-improve | UX interaction fixes |
| team-visual-a11y | Visual accessibility QA |

#### skills-scholar (10 academic skills)

End-to-end academic writing and research skill chain:

| Skill | Description |
|-------|-------------|
| scholar-ideation | Research ideation |
| scholar-writing | End-to-end paper writing |
| scholar-experiment | Experiment analysis |
| scholar-citation-verify | Citation verification |
| scholar-anti-ai-writing | Remove AI writing patterns |
| scholar-latex-organizer | LaTeX organizer |
| scholar-review | Paper review |
| scholar-rebuttal-pro | Rebuttal Pro |
| scholar-thesis-docx | Thesis Word formatting |
| scholar-publish | Post-acceptance preparation |

#### skills-meta (5 meta skills)

Skill and prompt engineering tooling:

| Skill | Description |
|-------|-------------|
| skill-generator | Skill generator |
| skill-simplify | Skill simplify |
| skill-tuning | Skill tuning |
| prompt-generator | Prompt generator |
| delegation-check | Delegation check |

### Built-in Team Skills (always installed)

The following 9 team skills are installed automatically with the core components — no separate selection needed:

- team-adversarial-swarm
- team-coordinate
- team-executor
- team-lifecycle-v4
- team-quality-assurance
- team-review
- team-swarm
- team-tech-debt
- team-testing

### Enable/Disable Individual Skills (install toggle)

After installing skill packs as groups, use `maestro install toggle` for fine-grained control over individual skills, commands, or agents:

```bash
# Interactive TUI — tick/untick individual items
maestro install toggle

# List all items with status (✓ enabled / ✗ disabled / · not installed)
maestro install toggle --list

# Filter by type
maestro install toggle --type skill --list

# Non-interactive enable/disable (comma-separated)
maestro install toggle --type skill --enable team-planex,scholar-writing
maestro install toggle --type skill --disable team-arch-opt

# Project-level install scope
maestro install toggle --path ./my-project --list
```

`--type` values: `command`, `skill`, `agent`. State is written to the manifest, supporting incremental updates and cross-project isolation.

---

## Install Modes

### Global Mode (recommended)

Install to `~/.maestro/`, shared across all projects:

```bash
maestro install --mode global
```

Best for: personal dev machine, multi-project shared config

### Project Mode

Install to the project directory `.workflow/`, scoped to the current project:

```bash
maestro install --mode project
```

Best for: team collaboration, project-specific config

---

## Migration from Old Versions

### v0.5.32+ auto-migration

Old per-skill IDs are automatically mapped to new group bundle IDs:

| Old ID | New ID |
|--------|-------|
| team-arch-opt | skills-extra-team |
| team-brainstorm | skills-extra-team |
| scholar-ideation | skills-scholar |
| ... | ... |

Migration runs automatically during install — no manual action required.

### Manual Migration

To manually update the manifest:

```bash
# View current install status
maestro install --status

# Force reinstall
maestro install --force
```

---

## Update

```bash
# Check for updates
maestro update

# Preview changes (dry run)
maestro update --dry-run

# Force overwrite
maestro update --force
```

---

## Uninstall

```bash
# Interactive uninstall
maestro uninstall

# Batch uninstall (skip confirmation)
maestro uninstall --yes
```

Uninstall will:
1. Remove installed component files
2. Clean manifest records
3. Preserve project data in `.workflow/` (specs, knowhow, etc.)

---

## Network Proxy

To install through a proxy, configure `~/.maestro/cli-tools.json`:

```json
{
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  }
}
```

---

## FAQ

### Install hangs

1. Check network connection
2. Try configuring a proxy (see above)
3. Use `--verbose` for detailed logs

### Missing components

```bash
# Reinstall
maestro install --force

# Check component status
maestro install --status
```

### Permission errors

Global install may require admin privileges:
```bash
# macOS/Linux
sudo npm install -g maestro-flow

# Windows (run as administrator)
npm install -g maestro-flow
```

---

## Related Commands

```bash
# Install management
maestro install [--mode global|project] [--force] [--status]
maestro uninstall [--yes]
maestro update [--dry-run] [--force]

# Version info
maestro --version
```
