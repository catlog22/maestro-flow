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

## Dashboard (Retired)

The Dashboard UI is no longer published, and `maestro view` and `maestro stop` are hidden from command help. For compatibility with existing scripts, both commands still accept their legacy options, but only print a retirement notice and never start or terminate a process.

Use these commands to inspect the current workflow:

- `maestro run brief` — show the current Run resume packet
- `maestro run check` — evaluate the current Run gates and completion guidance
- `maestro session status` — show canonical Session/Run status

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

Graph workflow coordinator with step mode and auto mode. Orchestrated chains use the generic `run-executor` and canonical Run lifecycle for Skill steps.

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

`run` manages one command invocation; `session` manages canonical Session identity and compatibility administration, while `execution` owns bounded lifecycle and orchestration authority. Wave 2 remains additive: capabilities support Session writes `session/1.3` + `session/2.0`, but the default writer remains `session/1.3`. There is no silent default switch. Statusless `session/2.0` is available only through an explicit `.workflow/config.json` `session-schema-selection/1.0` opt-in with `writer: "session/2.0"` and `session_statusless: true`; only Run mutations with complete Execution authority write `command-run/1.4` bound to strict `execution/1.0` / `execution-lease/1.0`.

Schema compatibility separates reads from writes. Known historical `session/1.0`-`session/1.3` and `command-run/1.0`-`command-run/1.4` versions retain their strict compatibility paths. Unknown future Session/Run versions use opaque/best-effort read compatibility: the passthrough reader preserves fields so an older CLI can attempt a projection, but a command may still fail when fields expected by the older shape are absent. Read acceptance is neither full semantic compatibility nor a claim that every unknown read fails closed. Mutations cross a fail-closed mutation boundary and must validate against the explicitly selected strict writer schema; Execution mutations also require the exact locator, revision fence, and lease claim.

Discover the protocol surface before selecting it:

```bash
maestro capabilities --json
```

This writes one raw `maestro-capabilities/1.0` line. `session_schema_writes` is exactly `session/1.3` + `session/2.0`, Execution writes are exactly `execution/1.0`, and response writes are `run-response/1.0` + `run-response/1.1`. The exact features are `execution_generation=true`, `core_execution_lease=true`, `execution_handoff=true`, `execution_operation_drain=true`, `session_statusless=true`, and `legacy_session_aliases=true`. Capability support does not select a project writer; without the explicit selection below, new Sessions still use `session/1.3`.

```json
{
  "session_schema": {
    "schema_version": "session-schema-selection/1.0",
    "writer": "session/2.0",
    "features": { "session_statusless": true }
  }
}
```

With that opt-in, `maestro session create` is identity-only: chain, engine, quality, auto, and platform belong to an Execution. Existing 1.x Sessions move only through the separately explicit migration gate; configuration alone never migrates stored authority.

```bash
maestro session create "statusless topic" --id <id> --json
maestro session migrate --session <id> --to session/2.0
maestro session archive --session <id> --request-id <id> --actor <actor> \
  --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json
maestro session unarchive --session <id> --request-id <id> --actor <actor> \
  --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json
```

A `session/2.0` identity has no stored Session `status` or `active_run_id`. It stores `current_execution_id`, `latest_execution_id`, and archive metadata; `session list|show|status` reports `derived_status`/derived availability, Execution status, and active Run from canonical Execution authority. Archive/unarchive uses `session-archive-receipt/1.0`, requires both CAS revisions and audit evidence, replays by request ID, and links its immutable receipt chain through `previous_receipt_hash`.

Canonical Execution generation and lease commands:

```bash
maestro execution start --session <id> --request-id <id> \
  --owner-id <owner> --owner-kind codex --json
maestro execution status --session <id> --execution <execution-id> --json
maestro execution lease heartbeat --session <id> --execution <execution-id> \
  --request-id <id> --expected-execution-revision <n> \
  --owner-id <owner> --owner-kind codex --lease-epoch <n> --lease-id <token> --json
maestro execution handoff prepare --session <id> --execution <execution-id> \
  --request-id <id> --expected-execution-revision <n> \
  --owner-id <owner> --owner-kind codex --lease-epoch <n> --lease-id <token> \
  --to-owner-id <owner> --claim-output <private-path>
maestro execution lease recover --session <id> --execution <execution-id> \
  --request-id <id> --expected-execution-revision <n> \
  --owner-id <owner> --owner-kind manual --stale-after-ms <n> --json
```

The tree is `execution start|attach|status|pause|resolve|resume|seal`, `execution handoff prepare|accept|cancel`, and `execution lease status|heartbeat|release|recover`. Every mutation requires the exact locator, an idempotent request, and `--expected-execution-revision`; leased mutations also require owner/kind, `--lease-epoch`, and private `--lease-id`. Acquisition surfaces may use `--claim-output` for a mode-0600 claim; status, ordinary responses, and receipts expose only public lease/hash fields. `maestro execution seal` closes one generation, not the permanent Session identity, and writes an immutable `execution-seal-receipt/1.0` snapshot of sealed Runs, chain, gates, Artifact registry/content hashes, Evidence, and corpus references. Receipt-backed recall/import uses `source-fence/1.1`; receipt-backed reuse uses `reuse-source-fence/1.1`. Both remain valid across later Session activity while failing closed on receipt, Run, Artifact, generation, or cross-Session drift. Artifact aliases remain Session-global, rather than being frozen inside one Execution. `session ... --execution` and `run status --execution` are deprecated aliases; new callers use `maestro execution ...`.

session-source knowledge is also independent of a permanent Session seal. `maestro knowledge stage ... --session <id> --evidence <ref>` writes a candidate snapshot; after a fresh session-level reconciliation, explicit `maestro knowledge promote <session-id> ...` may promote it without sealing the Session. Run-source candidates still require their source Runs to be sealed. Promotion never happens implicitly at Execution or legacy Session seal.

Execution-aware `run create|next|complete|decide` additionally requires `--execution <id> --generation <n>` plus the revision/lease options above. It emits `run-response/1.1` and writes `command-run/1.4`. Omitting the entire Execution option group preserves legacy `run-response/1.0` + `command-run/1.3`; partial authority returns `COMMANDER_USAGE` without falling back.

Human-facing usage should prefer `run start` / `run done` / `run edit`; `run create` / `run complete` remain the stable machine protocol and compatibility surface.

```bash
maestro run start "understand auth flow" --cmd learn --session 20260721-learn-auth --arg "src/auth"
maestro run start "fix login flow" --chain analyze plan execute verify
maestro session create "fix login flow" --chain analyze plan execute verify --engine manual
maestro run edit test review --after latest
maestro run done --verdict done-with-concerns --note "mirror docs later"

maestro run prepare <step> --platform codex
maestro run create <command> --session <id> --intent "<intent>" --json
maestro run brief <run-id> --session <id> --json
maestro run check <run-id> --session <id> --json
maestro run complete <run-id> --session <id> --chain-proposal outputs/chain-proposal.json --json
maestro run seal-session <session-id> --json
maestro session status <session-id>
maestro session check <session-id>
maestro session evidence <session-id> --status accepted
maestro skills --platform codex --steps --json
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

Every entry point shares one Session and one chain; the historical `engine` field is compatibility metadata only. A Skill that declares `orchestration.chain_effects` may emit a typed proposal. The orchestrator accepts, rejects, or requests revision, and the Runtime atomically commits the Run seal, verdict, and accepted proposal through `run complete --chain-proposal`. `/maestro` and `/maestro-ralph` can continue the same Session without promotion or engine rewriting.

#### Machine operation matrix (1.0 legacy + 1.1 additive)

| `operation` | CLI surface | Required inputs / behavior |
|-------------|-------------|----------------------------|
| human wrapper | `run start` | Handwritten entry; single-Run mode wraps `create`, chain mode creates a Session and may dispatch the first `next` |
| human wrapper | `run done` | Handwritten entry; wraps `complete --verdict` and returns suggest-only next without executing it |
| human wrapper | `run edit` | Handwritten entry; inserts/replaces/skips pending chain steps without allocating a Run |
| `create` | `run create`; legacy confirmed `run new` | `create` requires a command; pass an explicit `--session` for stable identity |
| `next` | `run next` | Optional `--session`/`--pick`; selects a pending step and allocates its chain Run |
| `complete` | `run complete` | Optional Run ID; `--chain-proposal` atomically applies an accepted Skill proposal while preserving request/revision/lease guards |
| `brief` | `run brief <run-id>` | Returns the Resume Packet |
| `recall` | `run recall <command> --intent <text>` | Read-only advisory projection; never mutation authority |
| `fork` | legacy `run recall-confirm fork` / `run fork` | Confirmation-token administration compatibility surface |
| `import` | legacy `run recall-confirm import` / `run import` | Confirmation-token administration compatibility surface |
| `check` | `run check <run-id>` | Idempotently scans outputs and evaluates gates |
| `decide` | `run decide <point-id>` | Requires `--session --verdict --confidence`; receipt-backed |
| `seal-session` | `run seal-session <session-id>` | Historical `session/1.x` compatibility only; not the Wave 2 completion or promotion gate |
| `execution-seal` | `execution seal` | Seals one Execution generation and writes an `execution-seal-receipt/1.0` snapshot; Session identity remains reusable |
| `execution-operation-claim` / `execution-operation-heartbeat` / `execution-operation-release` / `execution-operation-status` | `execution operation claim|heartbeat|release|status` | Manages root/child operation lineage with Execution revision and operation registry revision CAS; only claim success returns a raw `operation_token`, while registry/receipt/status and persisted or logged projections retain a hash or remove the token |
| `session-archive` / `session-unarchive` | `session archive` / `session unarchive` | Statusless identity lifecycle with audited CAS flags and a hash-linked receipt chain |
| `resolve` | `session resolve` | Requires audit/revision flags and exactly one recovery target; stays paused |
| `resume` | `session resume` | Requires audit/revision flags; performs only paused → running |
| session creation | `session create --chain` | Creates a simple command-chain Session; `--chain-file` is only for advanced JSON definitions |
| session query | `session status/check/evidence` | Engine-neutral status, consistency checks, and canonical Evidence Registry queries |
| `chain-insert` | `session chain insert` | Requires `--session --after --command`; receipt-backed |
| `chain-replace` | `session chain replace` | Requires `--session --step`; pending steps only |
| `chain-skip` | `session chain skip` | Requires `--session --step`; pending steps only |
| `meta-update` | `session meta update` | Requires `--session` and at least one of `--position-file`/`--decomposition-file` |
| `accept-reuse` | `run accept-reuse <run-id>` | Requires request/revision guards, `--actor`, `--reason`, and at least one `--evidence`; receipt-backed |
| `plan-publish` | `plan publish <path>` | Publishes immutable approved Markdown as the sealed `plan/1.0` `current-plan` artifact. Under `session/3.0` it drives a producer Run (`session open --chain plan-publish` → `run next` → `run complete --advance`) that registers the artifact in the Session Artifact Registry; under legacy `session/1.x/2.0` it targets a running Session or creates an `execute -> verify` Session with Execution/lease authority. Idempotent by handoff key and receipt-backed |

For `decide`, recovery, chain, and meta mutations, `--request-id` supplies the idempotent transition receipt; `--expected-identity-revision`, `--expected-activity-revision`, and the complete lease triple supply the fence. `resolve`/`resume` make the audit/revision fields required; chain/meta mutations accept the same guard options.

With explicit `--json`, legacy/default success, business errors, replay, and Commander usage continue to write exactly one strict `run-response/1.0` line to stdout, keep stderr empty, and match process status to envelope `exit_code`.

Execution lifecycle, Execution-aware Run mutations, and deprecated Execution aliases use strict `run-response/1.1`. It accepts all 1.0 operations and adds `capabilities`, `session-create`, `session-archive`, `session-unarchive`, `execution-start`, `execution-attach`, `execution-status`, `execution-pause`, `execution-resolve`, `execution-resume`, `execution-seal`, `execution-handoff-prepare`, `execution-handoff-accept`, `execution-handoff-cancel`, `execution-lease-status`, `execution-lease-heartbeat`, `execution-lease-release`, `execution-lease-recover`, `execution-operation-claim`, `execution-operation-heartbeat`, `execution-operation-release`, and `execution-operation-status`. Version 1.1 adds `disposition`, an Execution locator, revision/lease fences, and warnings while retaining one-line stdout, empty stderr, and exit parity. Usage failures are `COMMANDER_USAGE` with exit 2. `maestro capabilities --json` instead writes one raw capability JSON line.

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
maestro spec history <sid>                          # View evolution chain
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

Knowhow knowledge management. Nine compatible types: session, tip, template, recipe, reference, decision, asset, blueprint, and document. Ordinary creation requires only type, title, and content; all metadata is optional. CLI `--repo` resolves a selector and selects the physical destination; repeatable `--applies-to-repo` records applicability without retargeting. Host/MCP `targetRepoId` is not a CLI flag: omit it for current-repository writes, and use only an exact host-supplied UUID with a live matching-corpus capability for an explicitly selected linked write. Never infer identity from cwd/name/alias/path.

```bash
maestro kh add --type template --title "React Hook Form" --content "..." --language typescript
maestro kh add --type recipe --title "Deploy" --content "Steps: ..." --keywords deploy
maestro kh add --type decision --title "Use PG" --content "ADR: ..." --decision-state accepted
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
