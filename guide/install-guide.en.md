---
title: "Installation Guide"
---

Maestro-Flow installation is a two-step process: global CLI install and project initialization.

---

## Quick Install

```bash
# 1. Install the global CLI
npm install -g maestro-flow

# 2. Initialize in your project root
maestro install
```

**Prerequisites**:
- Node.js ≥ 22.19 (`package.json` `engines.node`)
- At least one host CLI:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (default host; provides `/maestro-*` slash commands)
  - [Grok Build CLI](https://docs.x.ai/build/overview) (first-class host and delegate backend)
- Codex CLI / Gemini CLI / OpenCode / Pi (optional, for multi-agent workflows)

---

## Install Flow

`maestro install` performs these steps:

1. **Detect project state** — existing manifest / on-disk platform dirs / fresh install
2. **Select platforms** — interactive host picker (Claude / Codex / Grok / 60+ EXTRA_PLATFORMS)
3. **Select components** — component picker filtered by selected platforms
4. **Choose install scope** — global (home directory) or project (`--path <dir>`)
5. **Configure hooks / MCP / Extra MCP / statusline**
6. **Copy or build files** — write to targets per component definition
7. **Generate manifest** — record installed components for incremental updates

> Scope controls where platform assets land (e.g. `~/.grok/` vs `<project>/.grok/`).
> Shared runtime files (`workflows` / `prepare` / `templates` / `overlays` / `arch-kb`) always go to `~/.maestro/`.
> `.workflow/` is project data (specs, knowhow), not an install target.

> **`maestro explore` needs extra (optional) configuration**: it is a separate OpenAI-compatible
> API channel and requires `~/.maestro/api.json` (`model` + `baseUrl` + `apiKey`; format in
> `guide/explore-guide.en.md`). The installer neither creates nor should create that file.
> Without it, explore reports "No endpoints configured" — that is expected, not a bug.
> Zero-config alternatives: `maestro search`, Grep/rg, native host `Agent()`, `maestro delegate`.

### Additive semantics (v0.5.50+)

Install is **additive** — it adds, it does not delete. Existing component files are kept; the manifest tracks `knownComponentIds`.

- **Install lock** — lockfile prevents concurrent installs from overwriting each other
- **Atomic write** — manifest uses write-tmp-then-rename
- **Idempotent** — re-running `maestro install` is safe

> **Pi Agent note**: Maestro no longer installs the Pi platform directly (it does not copy
> skills/agents into `~/.pi/`). To integrate with Pi, install the official Maestro Flow pi plugin:
>
> ```bash
> pi install https://github.com/catlog22/pi-maestro-flow
> ```

---

## Component Groups

Since v0.5.32, install components have been consolidated from 53 individual entries into 25 groups for a simpler selection experience.

### Core Components (selected by default)

| Group | Description | File Count |
|-------|-------------|------------|
| **commands** | Core slash commands | ~30 |
| **hooks** | Automation hooks | ~5 |
| **workflows** | Workflow scripts | ~10 |
| **specs** | Specification templates | 7 |

### Optional Skill Packs

| Group | Included Skills | Description |
|-------|----------------|-------------|
| **skills-scholar** | scholar-ideation, scholar-writing, scholar-review, scholar-rebuttal-pro, etc. (10 skills) | Academic research skills (optional, not installed by default; sourced from `optional/skills/`) |
| **skills-extra-team** | — | Legacy no-op bundle, retained only for manifest-replay migration |
| **skills-meta** | — | Legacy no-op bundle (members moved into core `skills`), retained for migration |

> Since v0.5.61 the skill surface was sharply trimmed: 20 zero-usage team/helper
> skills were deleted and the 10 `scholar-*` skills became opt-in. Manage skills
> with `maestro install toggle`, e.g. `maestro install toggle --enable scholar-writing`.

### Built-in Team Skills (always installed)

The following 8 team skills are automatically installed with the core `skills-team` component:

- team-arch-opt
- team-coordinate
- team-issue
- team-lifecycle-v4
- team-perf-opt
- team-review
- team-swarm
- team-testing

Six additional core meta skills are always installed with the `skills` component:
maestro-help, skill-generator, skill-iter-tune, skill-simplify, skill-tuning,
workflow-skill-designer.

---

## Install Modes

Interactive install opens the TUI; `--global` / `--path` only pre-select the scope. They also work with `--force` for non-interactive installs. There is **no** `--mode` flag.

### Global scope (recommended)

Platform assets go under the home directory (`~/.claude/`, `~/.grok/`); shared runtime goes to `~/.maestro/`:

```bash
maestro install --global
maestro install --force --global
```

Best for: personal machines, shared config across projects

### Project scope

Platform assets go into the given project (`<dir>/.claude/`, `<dir>/.grok/`):

```bash
maestro install --path ./my-project
maestro install --force --path ./my-project
```

Best for: team / project-specific config. Grok walks from cwd up to the git root and reads every `.grok/config.toml`.

`--force` rebuilds skill / agent files and tag-injects instruction files (updates `<!-- maestro:start/end -->` sections, keeps user prose outside the markers). That differs from the default additive TUI: without `--force`, existing component files are left in place.

Grok project instructions land in `.grok/rules/maestro.md`. A leftover `.grok/AGENTS.md` that still has Maestro sections is stripped (or deleted if nothing remains) so it does not double-load with `rules/maestro.md`.

Project-level MCP / hooks need the folder to be trusted (confirm in an interactive `grok` session, or `/hooks-trust` in the TUI). User-level `maestro-tools` in `~/.grok/config.toml` does not. `maestro install` never writes `~/.grok/trusted_folders.toml`.

---

## Subcommands

`maestro install` provides the following subcommands for direct access to specific install steps:

| Subcommand | Description |
|------------|-------------|
| `maestro install components` | Install file components (interactive component selection) |
| `maestro install hooks` | Install hooks (interactive level selection) |
| `maestro install mcp` | Register MCP server (interactive tool selection) |
| `maestro install toggle` | Enable/disable installed commands, skills, and agents |
| `maestro install fonts` | Install font resources |
| `maestro install workflows` | Install shared workflows / prepare / ref / arch-kb only |
| `maestro install entry-commands` | Generate thin slash-command wrappers (default: grill, collab) |
| `maestro install embedding` | Manage the local embedding model and indexes |
| `maestro install wizard` | Launch full interactive TUI wizard (legacy) |

Each subcommand supports `--global` or `--path <dir>` to specify the install scope.

---

## Toggle — Enable/Disable Management

`maestro install toggle` provides both an interactive TUI and non-interactive CLI flags to manage the enabled state of installed commands, skills, and agents.

### Three-State Model

Each item has three possible states:

| State | Icon | Meaning |
|-------|------|---------|
| **on** | ✓ | Installed and enabled |
| **off** | ✗ | Installed but disabled (file renamed to `.md.disabled`) |
| **available** | · | Present in source directory, not yet installed to target |

Disable mechanism: renames `.md` to `.md.disabled`; enable reverses the rename. For skills, disables `SKILL.md` → `SKILL.md.disabled`.

### Interactive TUI

```bash
# Toggle global installation items
maestro install toggle

# Toggle project installation items
maestro install toggle --path ./my-project
```

The ToggleView interface provides three tabs:

| Tab | Content |
|-----|---------|
| **Commands** | All `.claude/commands/*.md` command files |
| **Skills** | All `.claude/skills/*/SKILL.md` skill directories |
| **Agents** | All `.claude/agents/*.md` agent files |

Controls:
- **Tab** — switch tabs (Shift+Tab for reverse)
- **Space** — toggle current item state (available→on, on→off, off→on)
- **Up/Down arrows** — move cursor
- **Enter** — save and exit (updates disabledItems in manifest)
- **Escape** — exit (auto-saves if there are unsaved changes)

Viewport window: when items exceed 20, scroll indicators appear (↑ N more / ↓ N more).

Use `--type` to restrict to a single tab:

```bash
# Only show the commands tab
maestro install toggle --type command
```

### Non-Interactive Operations

```bash
# List all items with their status
maestro install toggle --list

# Filter by type
maestro install toggle --list --type skill

# Batch enable
maestro install toggle --enable "maestro-ralph,maestro-search"

# Batch disable
maestro install toggle --disable "team-swarm,team-review"
```

---

## Config Profile — Export/Import

Install configuration can be exported as a JSON profile file for team sharing or CI environment reproduction.

### Export Profile

```bash
# Export from global install config
maestro install --export

# Export to a specific path
maestro install --export ./team-profile.json

# Export from project config
maestro install --path ./my-project --export
```

Exported profiles include: component selection, hook levels, MCP configuration, statusline theme, and all other install settings.

### Import Profile

```bash
# Non-interactive install from profile
maestro install --import ./team-profile.json
```

Import triggers a complete install flow automatically with no human intervention. Ideal for:
- Unified team development environments
- CI/CD environment quick setup
- Multi-machine configuration sync

### Profile Storage

Exported profiles are saved to `~/.maestro/install-profiles/` by default.

---

## Extra MCP Targets

In addition to Claude Code, `maestro install` supports registering the MCP server to the following IDEs/tools:

| Target ID | Config Path | Description |
|-----------|-------------|-------------|
| `cursor` | `.cursor/mcp.json` | Cursor IDE |
| `qoder` | Root `mcp.json` | Qoder |
| `trae` | `.mcp.json` | Trae IDE |
| `kiro` | `.kiro/settings/mcp.json` | Kiro IDE |
| `roo` | `.roo/mcp.json` | Roo Code (project-level only) |
| `vscode-copilot` | `.vscode/mcp.json` | VS Code Copilot |
| `gemini-cli` | `.gemini/settings.json` | Gemini CLI |
| `grok` | `~/.grok/config.toml` or `.grok/config.toml` | Grok Build (TOML `[mcp_servers.maestro-tools]`) |

In the interactive install wizard, the Extra MCP step lets you select which targets to register. Each target supports both global and project scopes (`roo` is project-only).

MCP tools (7): `write_file`, `edit_file`, `read_file`, `read_many_files`, `team_msg`, `store_knowhow`, `delegate` (task delegation, read-only by default)

Non-interactive example:

```bash
maestro install --force --extra-mcp grok,cursor
```

`--extra-mcp` must use the IDs in the table above (`vscode-copilot`, `gemini-cli`, `grok`). Do not pass `vscode` or `gemini`.

---

## Grok Build

Grok is a first-class host and a delegate backend. After install you can use Maestro skills in the Grok TUI, or run `maestro delegate --to grok`.

### Install the Grok CLI

```bash
# macOS / Linux
curl -fsSL https://x.ai/cli/install.sh | bash

# Windows PowerShell
irm https://x.ai/cli/install.ps1 | iex
```

Authenticate with interactive `grok login`, or set `XAI_API_KEY`.

### Install Maestro's Grok assets

In interactive `maestro install`, tick platform `grok` and the Grok Extra MCP target. Equivalent non-interactive command:

```bash
# Fresh machines should also include workflows,prepare,ref,arch-kb,templates,overlays
maestro install --force --components workflows,prepare,ref,arch-kb,templates,overlays,grok-context,grok-md-chinese,grok-skills,grok-agents --extra-mcp grok
```

| Component ID | Destination |
|--------------|-------------|
| `grok-context` | `.grok/rules/maestro.md` (injected project instructions) |
| `grok-md-chinese` | Chinese-response section in the same `rules/maestro.md` |
| `grok-skills` | `.grok/skills/` (`SKILL.md` standard layout) |
| `grok-agents` | `.grok/agents/` |

Do not treat `~/.grok/AGENTS.md` or `.grok/AGENTS.md` as the project-instruction destination. Install strips leftover Maestro sections from those files. Grok discovers `./.grok/skills/` (walked up to the repo root) and `~/.grok/skills/`.

Project-level MCP / hooks need the folder to be trusted (interactive `grok`, or `/hooks-trust`). User-level `maestro-tools` does not.

After install, teach only the v3 CLI: `session open` → `run next` → `run complete --advance` → `session complete`.

The written MCP table looks like:

```toml
[mcp_servers.maestro-tools]
command = "maestro-mcp"
args = []
env = { MAESTRO_ENABLED_TOOLS = "write_file,edit_file,read_file,read_many_files,team_msg,store_knowhow,delegate" }
enabled = true
```

On Windows, `command` is the current `node.exe` and `args` is the absolute path to `maestro-mcp.js`, so hosts do not spawn `cmd /c maestro-mcp.cmd` (which flashes a console window). The writer replaces only the `maestro-tools` table and keeps the rest of the file.

### Verify

```bash
grok inspect                 # instructions / skills / MCP discovered here
grok mcp list
grok mcp doctor maestro-tools
maestro delegate "summarize README" --to grok --mode analysis
```

Project-scoped MCP is subject to Grok's folder-trust policy. User-level `~/.grok/config.toml` is the better default on a personal machine.

### Delegate

```bash
maestro delegate "<PROMPT>" --to grok --mode analysis
```

Exec IDs use the `grk-` prefix. Default model is `grok-4.6`. The prompt is passed via `--prompt-file` to avoid OS command-line limits. `maestro delegate message` inject stops the current headless turn and respawns with `grok --continue` (see `workflows/delegate-usage.md`).

Grok can also call the MCP `delegate` tool (`run` / `message` / `status` / `output` / `cancel`) without a separate shell. Default is read-only. Existing installs must re-run Extra MCP to expose the tool.

---

## Migrating from Older Versions

### v0.5.32+ Auto-Migration

Legacy individual skill IDs are automatically mapped to new group IDs:

| Old ID | New ID |
|--------|--------|
| team-arch-opt / team-issue / team-perf-opt | skills-team (now built-in) |
| team-brainstorm and other deleted team skills | skills-extra-team (legacy no-op bundle) |
| prompt-generator / delegation-check | skills-meta (legacy no-op bundle) |
| scholar-ideation and other scholar-* | skills-scholar |
| ... | ... |

Migration runs automatically during install, no manual action needed.

### Manual Migration

To manually update:

```bash
# Force reinstall
maestro install --force
```

---

## Update

```bash
# Check only, do not install
maestro update --check

# Update to latest
maestro update

# Preview version notices
maestro update --notices --dry-run

# Non-interactive (CI)
maestro update --non-interactive
```

`maestro update` reinstalls via a profile (`manifestToProfile` + `spawn --import --upgrade`), applies version notices, then runs pending migrations. Use `maestro install --force` when you only want to refresh local assets.

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
2. Clean up manifest records
3. Preserve project data in `.workflow/` (specs, knowhow, etc.)

---

## Network Proxy

To install through a proxy, configure in `~/.maestro/cli-tools.json`:

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
# Force reinstall
maestro install --force
```

### Permission errors

Global install may require admin privileges:
```bash
# macOS/Linux
sudo npm install -g maestro-flow

# Windows (run as Administrator)
npm install -g maestro-flow
```

---

## Related Commands

```bash
# Install management
maestro install [--global] [--path <dir>] [--force] [--all-platforms]
maestro install [--export [path]] [--import <path>] [--upgrade]
maestro install --force --extra-mcp grok,cursor --mcp --hooks standard
maestro uninstall [--yes]
maestro update [--check] [--notices] [--dry-run] [--from <ver>] [--to <ver>] [--non-interactive]

# Subcommands
maestro install components [--global | --path <dir>]
maestro install hooks [--global | --project]
maestro install mcp [--global | --path <dir>]
maestro install toggle [--global | --path <dir>] [--type <type>] [--enable <names>] [--disable <names>] [--list]
maestro install fonts
maestro install workflows
maestro install entry-commands [--steps <list>]
maestro install embedding [--download] [--status] [--local] [--rebuild]
maestro install wizard

# Version info
maestro --version
```
