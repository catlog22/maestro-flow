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
| `run` | -- | Session/Run lifecycle, chain allocator, and machine protocol |
| `session` | -- | Session recovery, chain, and orchestration meta administration |
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
<summary>maestro cli / serve</summary>

**cli** -- Unified CLI agent tool interface:

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
```

Options same as `delegate` (`-p` required). Additional subcommands: `show`, `output <id>`, `watch <id>`.

**serve** -- Start the workflow server:

```bash
maestro serve --port 3600 --host localhost
```

</details>

<details>
<summary>maestro run / maestro session</summary>

`run` manages the lifecycle of one command invocation; `session` manages canonical paused recovery, the chain, and orchestration meta. The runtime writer currently emits `session/1.3` + `command-run/1.3`.

```bash
maestro run prepare <step> --platform codex
maestro run create <command> --session <id> --intent "<intent>" --json
maestro run brief <run-id> --session <id> --json
maestro run check <run-id> --session <id> --json
maestro run complete <run-id> --session <id> --json
maestro run seal-session <session-id> --json
```

Canonical paused recovery must run as `resolve` → `resume`:

```bash
maestro session resolve --session <id> --decision <point-id> --disposition proceed \
  --request-id <id> --actor <name> --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json

maestro session resume --session <id> \
  --request-id <id> --actor <name> --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json

maestro run next --session <id> --json
```

Each `resolve` handles exactly one escalated decision (`--decision` + `proceed|retry`) or failed step (`--step` + `retry|skip`) and leaves the Session `paused`. `resume` changes the Session to `running` only after every blocker is clear. Neither command creates a Run; `run next` is the sole chain allocator after recovery. When the Session has a lease, both commands require `--execution-owner`, `--owner-epoch`, and `--lease-id` together.

#### `run-response/1.0` operation matrix

| `operation` | CLI surface | Required inputs / behavior |
|-------------|-------------|----------------------------|
| `create` | `run create`; legacy confirmed `run new` | `create` requires a command; pass an explicit `--session` for stable identity |
| `next` | `run next` | Optional `--session`/`--pick`; selects a pending step and allocates its chain Run |
| `complete` | `run complete` | Optional Run ID; verdict path supports request/revision/lease guards |
| `brief` | `run brief <run-id>` | Returns the Resume Packet |
| `recall` | `run recall <command> --intent <text>` | Read-only advisory projection; never mutation authority |
| `fork` | legacy `run recall-confirm fork` / `run fork` | Confirmation-token administration compatibility surface |
| `import` | legacy `run recall-confirm import` / `run import` | Confirmation-token administration compatibility surface |
| `check` | `run check <run-id>` | Idempotently scans outputs and evaluates gates |
| `decide` | `run decide <point-id>` | Requires `--session --verdict --confidence`; receipt-backed |
| `seal-session` | `run seal-session <session-id>` | Seals the Session; not receipt-backed, so success has `replay: null` |
| `resolve` | `session resolve` | Requires audit/revision flags and exactly one recovery target; stays paused |
| `resume` | `session resume` | Requires audit/revision flags; performs only paused → running |
| `chain-insert` | `session chain insert` | Requires `--session --after --command`; receipt-backed |
| `chain-replace` | `session chain replace` | Requires `--session --step`; pending steps only |
| `chain-skip` | `session chain skip` | Requires `--session --step`; pending steps only |
| `meta-update` | `session meta update` | Requires `--session` and at least one of `--position-file`/`--decomposition-file` |

For `decide`, recovery, chain, and meta mutations, `--request-id` supplies the idempotent transition receipt; `--expected-identity-revision`, `--expected-activity-revision`, and the complete lease triple supply the fence. `resolve`/`resume` make the audit/revision fields required; chain/meta mutations accept the same guard options.

With explicit `--json`, success, business error, replay, and Commander usage for every surface in the table write exactly **one** `run-response/1.0` line to stdout, keep stderr empty, and make the process status equal the envelope `exit_code`. Common fields are `operation`, `request_id`, `locator`, suggest-only `next`, `replay`, and `result`/`error`; usage failures are `COMMANDER_USAGE` with exit 2.

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
maestro spec add <category> "<title>" "<content>" --json  # --json returns sid
maestro spec supersede <old-sid> --by <new-sid>          # Supersede (old → deprecated)
maestro spec history <sid> [--json]                      # View evolution chain
maestro spec health [--json]                             # Knowledge health report
maestro spec backfill-sid                                # Backfill legacy entries without sid
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

# Create (spec / knowhow)
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
