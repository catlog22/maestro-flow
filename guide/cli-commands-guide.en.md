# CLI Terminal Commands Reference

Maestro provides 21 terminal commands invoked via `maestro <command>`. Covers installation, delegation, coordination, wiki, hooks, collaboration, and more.

> **Aliases**: Some commands have short aliases: `coord` → `coordinate`, `msg` → `agent-msg`, `kh` → `knowhow`, `bv` → `brainstorm-visualize`, `team` → `collab`.

---

## Table of Contents

- [Command Overview](#command-overview)
- [Install & Update](#install--update)
  - [maestro install](#maestro-install)
  - [maestro uninstall](#maestro-uninstall)
  - [maestro update](#maestro-update)
- [Dashboard](#dashboard)
  - [maestro view](#maestro-view)
  - [maestro stop](#maestro-stop)
- [Task Execution](#task-execution)
  - [maestro delegate](#maestro-delegate)
  - [maestro coordinate](#maestro-coordinate)
  - [maestro cli](#maestro-cli)
  - [maestro run](#maestro-run)
  - [maestro serve](#maestro-serve)
- [Project Management](#project-management)
  - [maestro launcher](#maestro-launcher)
  - [maestro spec](#maestro-spec)
  - [maestro wiki](#maestro-wiki)
  - [maestro hooks](#maestro-hooks)
  - [maestro overlay](#maestro-overlay)
- [Team Collaboration](#team-collaboration)
  - [maestro collab](#maestro-collab)
  - [maestro agent-msg](#maestro-agent-msg)
- [Memory & Extensions](#memory--extensions)
  - [maestro knowhow](#maestro-knowhow)
  - [maestro brainstorm-visualize](#maestro-brainstorm-visualize)
  - [maestro ext / maestro tool](#maestro-ext--maestro-tool)

---

## Command Overview

| Command | Alias | Purpose |
|---------|-------|---------|
| `maestro install` | — | Install Maestro assets (interactive) |
| `maestro uninstall` | — | Remove installed assets |
| `maestro update` | — | Check/install latest version |
| `maestro view` | — | Launch Dashboard kanban board |
| `maestro stop` | — | Stop Dashboard server |
| `maestro delegate` | — | Delegate task to AI agent |
| `maestro coordinate` | `coord` | Graph workflow coordinator |
| `maestro cli` | — | Run CLI agent tools |
| `maestro run` | — | Execute a named workflow |
| `maestro serve` | — | Start workflow server |
| `maestro launcher` | — | Claude Code launcher |
| `maestro spec` | — | Project spec management |
| `maestro wiki` | — | Wiki knowledge graph queries |
| `maestro hooks` | — | Hook management and evaluation |
| `maestro overlay` | — | Command overlay management |
| `maestro collab` | `team` | Human team collaboration |
| `maestro agent-msg` | `msg` | Agent team message bus |
| `maestro knowhow` | `kh` | Knowhow knowledge management |
| `maestro brainstorm-visualize` | `bv` | Brainstorm visualization server |
| `maestro ext` | — | Extension management |
| `maestro tool` | — | Tool interaction (list/exec) |

---

## Install & Update

### maestro install

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

---

### maestro uninstall

Remove installed Maestro assets.

```bash
maestro uninstall              # Interactive uninstall
maestro uninstall --all        # Uninstall all recorded installations
maestro uninstall --all -y     # Skip confirmation
```

---

### maestro update

Check for and install the latest version.

```bash
maestro update                 # Check and prompt to install
maestro update --check         # Check only, don't install
```

---

## Dashboard

### maestro view

Launch the Dashboard kanban board (browser or TUI).

```bash
maestro view                   # Launch board (auto-open browser)
maestro view --tui             # Terminal UI mode
maestro view --dev             # Vite dev mode (HMR)
maestro view --port 8080       # Custom port
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port`, `-p` | `3001` | Server port |
| `--host` | `127.0.0.1` | Bind host |
| `--path <dir>` | CWD | Workspace root |
| `--no-browser` | — | Don't auto-open browser |
| `--tui` | — | Terminal UI mode |
| `--dev` | — | Vite dev server mode |

---

### maestro stop

Stop the Dashboard server. 3-stage strategy: graceful shutdown → port lookup kill → force kill.

```bash
maestro stop                   # Graceful stop
maestro stop --force           # Force kill
maestro stop --port 8080       # Custom port
```

---

## Task Execution

### maestro delegate

Delegate tasks to AI agent tools (gemini/qwen/codex/claude/opencode). Supports sync, async, and session resume.

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
| `--rule <template>` | — | Protocol + template loading |
| `--id <id>` | Auto-generated | Execution ID |
| `--resume [id]` | — | Resume last/specific session |
| `--async` | — | Run detached in background |
| `--backend <type>` | `direct` | Adapter backend: direct / terminal |

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `show [--all]` | List execution history |
| `output <id> [--verbose]` | Get output |
| `status <id> [--events N]` | View status |
| `tail <id>` | Recent events + history |
| `cancel <id>` | Request cancellation |
| `message <id> <text> [--delivery inject\|after_complete]` | Inject message |
| `messages <id>` | View message queue |

---

### maestro coordinate

Graph workflow coordinator with step mode and auto mode.

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
| `-y`, `--yes` | Auto-confirm mode |
| `--parallel` | Enable fork/join parallel execution |
| `--dry-run` | Preview execution plan |
| `--continue`, `-c` | Resume session |

---

### maestro cli

Unified CLI agent tool interface.

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
maestro cli show
maestro cli output <id>
maestro cli watch <id>
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p`, `--prompt` | **required** | Prompt text |
| `--tool <name>` | First enabled tool | CLI tool |
| `--mode <mode>` | `analysis` | Execution mode |
| `--model <model>` | Tool default | Model override |
| `--cd <dir>` | CWD | Working directory |
| `--rule <template>` | — | Template loading |
| `--id <id>` | Auto-generated | Execution ID |
| `--resume [id]` | — | Resume session |

---

### maestro run

Execute a named workflow.

```bash
maestro run <workflow>           # Execute workflow
maestro run <workflow> --dry-run  # Preview
maestro run <workflow> -c config.json
```

---

### maestro serve

Start the workflow server.

```bash
maestro serve --port 3600 --host localhost
```

---

## Project Management

### maestro launcher

Unified Claude Code launcher with workflow profile and settings switching.

```bash
maestro launcher -w my-project -s dev   # Launch with profile
maestro launcher list                    # List all profiles
maestro launcher status                  # Current active profile
maestro launcher add-workflow my-proj --claude-md ./CLAUDE.md
maestro launcher add-settings dev ./settings-dev.json
maestro launcher scan ./configs          # Scan config files
```

---

### maestro spec

Project spec management (init, load, list, status).

```bash
maestro spec init                              # Initialize
maestro spec load --category coding --keyword auth  # Load
maestro spec list                              # List files
maestro spec status                            # Status
```

---

### maestro wiki

Wiki knowledge graph queries and mutations. Offline by default, `--live` for HTTP API.

```bash
# Listing + filters
maestro wiki list --type spec                        # Filter by type
maestro wiki list --category security                # Filter by category
maestro wiki list --created-by manage-harvest        # Filter by creator
maestro wiki list --tag auth --status active          # Combined filters
maestro wiki list --group                            # Group by type
maestro wiki list -q "authentication"                # Inline BM25 search
maestro wiki list --json                             # JSON output

# Search
maestro wiki search "auth token"                     # BM25 full-text search
maestro wiki get <id>                                # Get single entry

# Create (spec / memory / note)
maestro wiki create --type spec --slug auth --title "Auth" --body "# Auth\n..."
maestro wiki create --type memory --slug debug-01 --title "Debug" --body "..."
maestro wiki create --type note --slug tip-01 --title "Tip" --body "..."
  # Optional: --category, --created-by, --source-ref, --parent, --frontmatter '{}'

# Spec entry append (unified write path)
maestro wiki append <containerId> --category coding --body "Use named exports"
maestro wiki append spec-learnings --category learning --body "Token rotation..." --keywords "auth,token"

# Spec entry removal
maestro wiki remove-entry <entryId>                  # Remove sub-entry by ID

# Update / delete
maestro wiki update <id> --title "New Title"         # Frontmatter update
maestro wiki delete <id>                             # Delete entire file

# Graph analysis
maestro wiki health                                  # Health score (0-100)
maestro wiki orphans                                 # Orphan nodes
maestro wiki hubs --limit 10                         # Top-N hub nodes
maestro wiki backlinks <id>                          # Incoming links
maestro wiki forward <id>                            # Outgoing links
maestro wiki graph                                   # Full graph JSON
```

| Subcommand | Purpose |
|------------|---------|
| `list` / `ls` | List + filter (type, tag, status, category, created-by, q) |
| `get` | Get single entry (with body) |
| `search` | BM25 full-text search |
| `create` | Create spec/memory/note file |
| `append` | Append `<spec-entry>` block to spec container |
| `remove-entry` | Remove sub-entry from spec container by ID |
| `update` | Update frontmatter (spec body is protected) |
| `delete` / `rm` | Delete entire entry file |
| `health` | Graph health score |
| `orphans` | Orphan node list |
| `hubs` | Hub node ranking |
| `backlinks` | Incoming links |
| `forward` | Outgoing links |
| `graph` | Full graph JSON |

> **Write protection**: `specs/*.md` body updates via `wiki update` are forbidden (403) — use `wiki append` / `wiki remove-entry` for entry-level operations. `memory/*.md` supports full CRUD. Virtual entries (issue/lesson) are read-only.

---

### maestro hooks

Hook management and evaluator execution.

```bash
maestro hooks install --level full     # Install hooks
maestro hooks status                   # Installation status
maestro hooks list                     # List all hooks
maestro hooks toggle spec-injector on  # Toggle hook
maestro hooks run spec-injector        # Run evaluator
```

Available hooks: `context-monitor`, `spec-injector`, `delegate-monitor`, `team-monitor`, `telemetry`, `session-context`, `skill-context`, `coordinator-tracker`, `preflight-guard`, `spec-validator`, `keyword-spec-injector`, `workflow-guard`

---

### maestro overlay

Command overlay management — non-invasive patches for `.claude/commands`.

```bash
maestro overlay list                    # View and manage
maestro overlay apply                   # Reapply all (idempotent)
maestro overlay add my-overlay.json     # Install
maestro overlay remove my-overlay       # Remove
maestro overlay bundle -o bundle.json   # Pack into portable file
maestro overlay import-bundle bundle.json  # Import bundle
maestro overlay push                    # Push for team sharing
```

---

## Team Collaboration

### maestro collab

Human team collaboration (alias: `team`).

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

---

### maestro agent-msg

Agent team message bus (alias: `msg`).

```bash
maestro msg send "task done" -s <session> --from worker --to coordinator
maestro msg list -s <session> --last 10
maestro msg status -s <session>
maestro msg broadcast "meeting" -s <session> --from coordinator
```

---

## Memory & Extensions

### maestro knowhow

Knowhow knowledge management (alias: `kh`). 6 types: session, tip, template, recipe, reference, decision.

```bash
maestro kh add --type template --title "React Hook Form" --body "..." --lang typescript
maestro kh add --type recipe --title "Deploy" --body "Steps: ..." --tags deploy
maestro kh add --type decision --title "Use PG" --body "ADR: ..." --status accepted
maestro kh list                           # List all
maestro kh list --type template           # Filter by type
maestro kh search "deploy"                # Keyword search
maestro kh get knowhow-20260427-1912      # View detail
```

---

### maestro brainstorm-visualize

Brainstorm HTML prototype visualization server (alias: `bv`).

```bash
maestro bv start --dir ./prototypes     # Start visualizer
maestro bv status <execId>              # View status
maestro bv stop <execId>                # Stop server
```

---

### maestro ext / maestro tool

Extension and tool management.

```bash
maestro ext list                        # List extensions
maestro tool list                       # List tools
maestro tool exec read_file '{"path":"README.md"}'  # Execute tool
```
