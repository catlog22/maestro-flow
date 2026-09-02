---
title: "Installation Guide"
icon: "📦"
---

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
- Node.js ≥ 22.19
- At least one host CLI: Claude Code (default) and/or [Grok Build](https://docs.x.ai/build/overview)
- Codex CLI / Gemini CLI / OpenCode / Pi (optional, for multi-agent workflows)

---

## Install Flow

`maestro install` performs the following steps:

1. **Detect project state** — existing manifest / on-disk platform dirs / fresh install
2. **Select platforms** — interactive host picker (including Grok Build)
3. **Select components** — component picker filtered by selected platforms
4. **Choose install scope** — global (home directory) or project (`--path <dir>`)
5. **Configure hooks / MCP / Extra MCP / statusline**
6. **Copy or build files** — write to targets per component definition
7. **Generate manifest** — record installed components for incremental updates

> Shared runtime always goes to `~/.maestro/`. Platform assets go to `~/.claude/`, `~/.grok/`, or the matching project directories. `.workflow/` is project data, not an install target.

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

> Since v0.5.61 the skill surface was sharply trimmed: 20 zero-usage team/helper skills were
> deleted, and former skills-extra-team / skills-meta members were either merged into core
> or removed. Only one substantive optional pack remains.

#### skills-scholar (10 academic skills, opt-in)

End-to-end academic writing and research skill chain. Not installed by default (sourced from
`optional/skills/`); enable with `maestro install toggle`:

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

#### skills-extra-team / skills-meta (legacy no-op bundles)

No-op group bundles retained only for manifest-replay migration; they no longer install any skills. Where former members went:

- `team-arch-opt`, `team-issue`, `team-perf-opt` → became built-in team skills (skills-team)
- `skill-generator`, `skill-simplify`, `skill-iter-tune`, `skill-tuning`, `workflow-skill-designer` → merged into the core `skills` component (always installed)
- The other 17 team-* skills plus `prompt-generator`, `delegation-check`, `codify-to-knowhow`, `insight-challenge` → deleted

### Built-in Team Skills (always installed)

The following 8 team skills are installed automatically with the core `skills-team` component — no separate selection needed:

- team-arch-opt
- team-coordinate
- team-issue
- team-lifecycle-v4
- team-perf-opt
- team-review
- team-swarm
- team-testing

Six additional core meta skills are always installed with the `skills` component: maestro-help,
skill-generator, skill-iter-tune, skill-simplify, skill-tuning, workflow-skill-designer.

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
maestro install toggle --type skill --enable scholar-writing,scholar-review
maestro install toggle --type skill --disable scholar-latex-organizer

# Project-level install scope
maestro install toggle --path ./my-project --list
```

`--type` values: `command`, `skill`, `agent`. State is written to the manifest, supporting incremental updates and cross-project isolation.

---

## Install Modes

Interactive install opens the TUI; `--global` / `--path` only pre-select the scope. There is no `--mode` flag.

### Global scope (recommended)

Platform assets go under the home directory (`~/.claude/`, `~/.grok/`); shared runtime goes to `~/.maestro/`:

```bash
maestro install --global
```

Best for: personal machines, shared config across projects

### Project scope

Platform assets go into the given project (`<dir>/.claude/`, `<dir>/.grok/`):

```bash
maestro install --path <dir>
```

Best for: team / project-specific config. Grok walks from cwd up to the git root and reads every `.grok/config.toml`.

`--force` rebuilds skill / agent files and tag-injects instruction files (updates Maestro sections, keeps user prose). Without `--force`, existing component files are left in place.

Project-level MCP / hooks need the folder trusted (interactive `grok`, or `/hooks-trust`). User-level `maestro-tools` in `~/.grok/config.toml` does not. The installer never writes `trusted_folders.toml`.

---

## Extra MCP Targets

Besides Claude Code, `maestro-tools` can be registered to:

| Target ID | Config path | Format |
|-----------|-------------|--------|
| `cursor` | `.cursor/mcp.json` | JSON |
| `qoder` | project-root `mcp.json` | JSON |
| `trae` | `.mcp.json` | JSON |
| `kiro` | `.kiro/settings/mcp.json` | JSON |
| `roo` | `.roo/mcp.json` (project only) | JSON |
| `vscode-copilot` | `.vscode/mcp.json` | JSON |
| `gemini-cli` | `.gemini/settings.json` | JSON |
| `grok` | `~/.grok/config.toml` or `.grok/config.toml` | TOML `[mcp_servers.maestro-tools]` |

```bash
maestro install --force --extra-mcp grok,cursor
```

---

## Grok Build

Grok is a first-class host and a delegate backend. Tick platform `grok` and the Grok Extra MCP target in `maestro install`.

```bash
# Install the Grok CLI (macOS / Linux)
curl -fsSL https://x.ai/cli/install.sh | bash

# Windows PowerShell
irm https://x.ai/cli/install.ps1 | iex

# Install Maestro Grok assets + MCP
# Fresh machines should also include workflows,prepare,ref,arch-kb,templates,overlays
maestro install --force --components workflows,prepare,ref,arch-kb,templates,overlays,grok-context,grok-md-chinese,grok-skills,grok-agents --extra-mcp grok
```

Destinations: `.grok/rules/maestro.md`, `.grok/skills/`, `.grok/agents/` (not `AGENTS.md`). Reinstall strips leftover Maestro sections from `.grok/AGENTS.md`. Project assets go to the caller cwd (`--path` supported). After install, teach only v3: `session open` → `run next` → `run complete --advance` → `session complete`. Authenticate with `grok login` or `XAI_API_KEY`. Verify:

```bash
grok inspect
grok mcp doctor maestro-tools
maestro delegate "summarize README" --to grok --mode analysis
```

Exec IDs use the `grk-` prefix. Default model is `grok-4.6`. The prompt is passed via `--prompt-file`. `maestro delegate message` inject stops the current headless turn and respawns with `grok --continue`. Full details: `guide/install-guide.en.md`.

---

## Migration from Old Versions

### v0.5.32+ auto-migration

Old per-skill IDs are automatically mapped to new group bundle IDs:

| Old ID | New ID |
|--------|-------|
| team-arch-opt / team-issue / team-perf-opt | skills-team (now built-in) |
| team-brainstorm and other deleted team skills | skills-extra-team (legacy no-op bundle) |
| prompt-generator / delegation-check | skills-meta (legacy no-op bundle) |
| scholar-ideation and other scholar-* | skills-scholar |
| ... | ... |

Migration runs automatically during install — no manual action required.

### Manual Migration

To manually update the manifest:

```bash
# View current install status
maestro install toggle --list

# Force reinstall
maestro install --force
```

---

## Update

```bash
# Check only
maestro update --check

# Update to latest
maestro update

# Preview version notices
maestro update --notices --dry-run

# Non-interactive (CI)
maestro update --non-interactive
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
maestro install toggle --list
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
maestro install [--global|--path <dir>] [--force] [--all-platforms]
maestro install --force --extra-mcp grok,cursor --mcp --hooks standard
maestro uninstall [--yes]
maestro update [--check] [--notices] [--dry-run] [--non-interactive]

# Version info
maestro --version
```
