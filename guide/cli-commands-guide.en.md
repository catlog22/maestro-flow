---
title: "CLI Terminal Commands Reference"
---

Maestro provides 21 terminal commands invoked via `maestro <command>`. Covers installation, delegation, coordination, wiki, hooks, collaboration, and more.

> **Primary workflow entry point**: `/maestro-ralph` (slash command) is the recommended way to drive the full lifecycle. See [Maestro Ralph Guide](./maestro-ralph-guide.md) for details.
>
> **Aliases**: `coord`->`coordinate`, `msg`->`agent-msg`, `kh`->`knowhow`, `bv`->`brainstorm-visualize`, `team`->`collab`.

---

## Command Overview

| Command | Alias | Purpose |
|---------|-------|---------|
| `install` | -- | Install Maestro assets (interactive) |
| `uninstall` | -- | Remove installed assets |
| `update` | -- | Check/install latest version |
| `view` | -- | Launch Dashboard kanban board |
| `stop` | -- | Stop Dashboard server |
| `delegate` | -- | Delegate task to AI agent |
| `coordinate` | `coord` | Graph workflow coordinator |
| `cli` | -- | Run CLI agent tools |
| `run` | -- | Execute a named workflow |
| `serve` | -- | Start workflow server |
| `launcher` | -- | Claude Code launcher |
| `spec` | -- | Project spec management |
| `wiki` | -- | Wiki knowledge graph queries |
| `hooks` | -- | Hook management and evaluation |
| `overlay` | -- | Command overlay management |
| `collab` | `team` | Human team collaboration |
| `agent-msg` | `msg` | Agent team message bus |
| `knowhow` | `kh` | Knowhow knowledge management |
| `brainstorm-visualize` | `bv` | Brainstorm visualization server |
| `ext` | -- | Extension management |
| `tool` | -- | Tool interaction (list/exec) |

---

## Install & Update

<details>
<summary>maestro install</summary>

Install Maestro assets to project or global directory with interactive step selection.

```bash
maestro install                           # Interactive install
maestro install --force                   # Non-interactive batch install
maestro install components                # Install file components
maestro install hooks                     # Install hooks
maestro install mcp                       # Register MCP server
```

| Option | Description |
|--------|-------------|
| `--force` | Non-interactive batch install of all components |
| `--global` | Install global assets only |
| `--path <dir>` | Install to specified project directory |
| `--hooks <level>` | Hook level: none / minimal / standard / full |
| `--codex-hooks <level>` | Codex hook level |
| `--codex-mcp` | Register Codex MCP server |

> Interactive mode now includes Codex Hooks and Codex MCP configuration steps.

</details>

<details>
<summary>maestro uninstall / update</summary>

**uninstall** -- Remove installed assets:

```bash
maestro uninstall              # Interactive uninstall
maestro uninstall --all -y     # Uninstall all, skip confirmation
```

**update** -- Check for and install the latest version:

```bash
maestro update                 # Check and prompt to install
maestro update --check         # Check only
```

</details>

---

## Dashboard

<details>
<summary>maestro view / stop</summary>

**view** -- Launch the Dashboard kanban board (browser or TUI):

```bash
maestro view                   # Launch (auto-open browser)
maestro view --tui             # Terminal UI mode
maestro view --dev             # Vite dev mode
maestro view --port 8080       # Custom port
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port`, `-p` | `3001` | Server port |
| `--host` | `127.0.0.1` | Bind host |
| `--path <dir>` | CWD | Workspace root |
| `--no-browser` | -- | Don't auto-open browser |
| `--tui` | -- | Terminal UI mode |
| `--dev` | -- | Vite dev server mode |

**stop** -- Stop Dashboard (graceful -> port lookup -> force kill):

```bash
maestro stop                   # Graceful stop
maestro stop --force           # Force kill
maestro stop --port 8080       # Custom port
```

</details>

---

## Task Execution

<details>
<summary>maestro delegate</summary>

Delegate tasks to AI agent tools (gemini/qwen/codex/claude/opencode). Supports sync, async, and session resume.

Used internally by `maestro-ralph` for CLI-type chain nodes. Ralph sets `--mode`, `--rule`, and `--cd` automatically based on session context.

```bash
maestro delegate "analyze auth module" --to gemini
maestro delegate "fix bug" --to gemini --async
maestro delegate show
maestro delegate output gem-143022-a7f2
maestro delegate status gem-143022-a7f2
maestro delegate message gem-143022-a7f2 "also check utils"
maestro delegate "continue" --to gemini --resume
```

| Option | Default | Description |
|--------|---------|-------------|
| `--to <tool>` | First enabled tool | Target tool |
| `--mode <mode>` | `analysis` | analysis (read-only) / write |
| `--model <model>` | Tool default | Model override |
| `--cd <dir>` | CWD | Working directory |
| `--rule <template>` | -- | Protocol + template loading |
| `--id <id>` | Auto-generated | Execution ID |
| `--resume [id]` | -- | Resume session |
| `--async` | -- | Run detached in background |
| `--backend <type>` | `direct` | Adapter backend: direct / terminal |

**Subcommands**: `show [--all]`, `output <id>`, `status <id>`, `tail <id>`, `cancel <id>`, `message <id> <text>`, `messages <id>`

</details>

<details>
<summary>maestro coordinate</summary>

Graph workflow coordinator with step mode and auto mode. Ralph sessions use this internally via `maestro-ralph-execute` for skill-type chain nodes.

```bash
maestro coordinate list                                    # List chain graphs
maestro coordinate run "implement auth" --chain default -y # Auto run
maestro coordinate start "implement auth" --chain default  # Step mode
maestro coordinate next <sessionId>                        # Next step
maestro coordinate status <sessionId>                      # Session state
maestro coordinate report --session <id> --node <id> --status SUCCESS
```

| Option | Description |
|--------|-------------|
| `--chain <name>` | Specify chain graph |
| `--tool <tool>` | Agent tool (default: `claude`) |
| `-y` | Auto-confirm mode |
| `--parallel` | Enable fork/join parallel execution |
| `--dry-run` | Preview execution plan |
| `-c` | Resume session |

</details>

<details>
<summary>maestro cli / run / serve</summary>

**cli** -- Unified CLI agent tool interface:

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
```

Options same as `delegate` (`-p` required). Additional subcommands: `show`, `output <id>`, `watch <id>`.

**run** -- Execute a named workflow:

```bash
maestro run <workflow>           # Execute
maestro run <workflow> --dry-run # Preview
maestro run <workflow> -c config.json
```

**serve** -- Start the workflow server:

```bash
maestro serve --port 3600 --host localhost
```

</details>

---

## Project Management

<details>
<summary>maestro launcher</summary>

Unified Claude Code launcher with workflow profile and settings switching.

```bash
maestro launcher -w my-project -s dev   # Launch with profile
maestro launcher list                    # List all profiles
maestro launcher status                  # Current active profile
maestro launcher add-workflow my-proj --claude-md ./CLAUDE.md
maestro launcher add-settings dev ./settings-dev.json
maestro launcher scan ./configs          # Scan config files
```

</details>

<details>
<summary>maestro spec</summary>

Project spec management (init, load, list, status).

```bash
maestro spec init                              # Initialize
maestro spec load --category coding --keyword auth
maestro spec list                              # List files
maestro spec status                            # Status
maestro spec add <category> "<title>" "<content>"
```

</details>

<details>
<summary>maestro wiki</summary>

Wiki knowledge graph queries and mutations. Offline by default, `--live` for HTTP API.

```bash
# Listing and search
maestro wiki list --type spec --tag security --status active --group --json
maestro wiki list -q "authentication"                # Inline BM25 search
maestro wiki search "auth token"                     # Full-text search
maestro wiki get <id>                                # Get single entry

# Create (spec / memory / note)
maestro wiki create --type spec --slug auth --title "Auth" --body "# Auth\n..."
  # Optional: --created-by, --source-ref, --parent, --frontmatter

# Entry append and removal
maestro wiki append <containerId> --body "..." --keywords "coding,exports"
maestro wiki remove-entry <entryId>

# Update / delete
maestro wiki update <id> --title "New Title"
maestro wiki delete <id>

# Graph analysis
maestro wiki health | orphans | hubs --limit 10 | backlinks <id> | forward <id> | graph
```

> **Write protection**: `specs/*.md` body updates via `wiki update` are forbidden (403) -- use `wiki append` / `wiki remove-entry`. `memory/*.md` supports full CRUD. Virtual entries are read-only.

</details>

<details>
<summary>maestro hooks</summary>

Hook management and evaluator execution. Supports both Claude Code and Codex platforms.

```bash
# Claude Code
maestro hooks install --level full
maestro hooks uninstall

# Codex
maestro hooks install --target codex --level standard
maestro hooks uninstall --target codex

# General
maestro hooks status               # Installation status (both platforms)
maestro hooks list                 # List all hooks
maestro hooks toggle spec-injector on
maestro hooks run spec-injector    # Run evaluator
```

| Option | Description |
|--------|-------------|
| `--target` | `claude` (default) or `codex` |
| `--level` | minimal / standard / full |
| `--global` | Install to global (default) |
| `--project` | Install to project-level |

> Codex hooks require `codex_hooks = true` in `~/.codex/config.toml`. Not supported on Windows.

</details>

<details>
<summary>maestro overlay</summary>

Command overlay management -- non-invasive patches for `.claude/commands`.

```bash
maestro overlay list                    # View and manage
maestro overlay apply                   # Reapply all (idempotent)
maestro overlay add my-overlay.json     # Install
maestro overlay remove my-overlay       # Remove
maestro overlay bundle -o bundle.json   # Pack into portable file
maestro overlay import-bundle bundle.json
maestro overlay push                    # Push for team sharing
```

</details>

---

## Team Collaboration

<details>
<summary>maestro collab (team)</summary>

Human team collaboration.

```bash
maestro collab join                    # Register as team member
maestro collab whoami                  # Current identity
maestro collab status                  # Team activity
maestro collab sync                    # Sync with remote
maestro collab preflight --phase 1     # Conflict preflight check
maestro collab guard                   # Namespace boundaries
maestro collab task create --title "task"
maestro collab task list --status open
maestro collab task status <id> in_progress
maestro collab task assign <id> <uid>
```

</details>

<details>
<summary>maestro agent-msg (msg)</summary>

Agent team message bus.

```bash
maestro msg send "task done" -s <session> --from worker --to coordinator
maestro msg list -s <session> --last 10
maestro msg status -s <session>
maestro msg broadcast "meeting" -s <session> --from coordinator
```

</details>

---

## Memory & Extensions

<details>
<summary>maestro knowhow (kh)</summary>

Knowhow knowledge management. 6 types: session, tip, template, recipe, reference, decision.

```bash
maestro kh add --type template --title "React Hook Form" --body "..." --lang typescript
maestro kh add --type recipe --title "Deploy" --body "Steps: ..." --tags deploy
maestro kh add --type decision --title "Use PG" --body "ADR: ..." --status accepted
maestro kh list                           # List all
maestro kh list --type template           # Filter by type
maestro kh search "deploy"                # Keyword search
maestro kh get knowhow-20260427-1912      # View detail
```

</details>

<details>
<summary>maestro brainstorm-visualize (bv) / ext / tool</summary>

**brainstorm-visualize** -- Brainstorm HTML prototype visualization server:

```bash
maestro bv start --dir ./prototypes     # Start visualizer
maestro bv status <execId>              # View status
maestro bv stop <execId>                # Stop server
```

**ext** -- Extension management:

```bash
maestro ext list                        # List extensions
```

**tool** -- Tool interaction:

```bash
maestro tool list                       # List tools
maestro tool exec read_file '{"path":"README.md"}'
```

</details>
