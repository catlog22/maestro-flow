---
name: maestro-learn
description: Route learning intent to learn-* commands
argument-hint: '"intent text" [-y] [--dry-run] [--chain <name>]'
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<run_mode>
**Session mode:** `run`. This boundary is mandatory and overrides legacy Codex session-path examples below.

1. Before domain work, call `maestro run create maestro-learn -- $ARGUMENTS` and retain the returned `run_id`, `run_dir`, and `upstream`.
2. Formal deliverables go to `{run_dir}/outputs/`; evidence and worker traces go to `{run_dir}/evidence/`; synthesis and handoff go to `{run_dir}/report.md`.
3. Do not edit protocol JSON or append to project `state.json.artifacts[]`.
4. Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Later references to scratch, hidden command/team directories, milestones, phases, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` are semantic labels only. Map them into the active Run and never create a second formal truth source.
</run_mode>

<purpose>
Route learning requests to the optimal learn command or multi-step chain.
Executes commands sequentially with session tracking.

```
Intent → Route to Chain → Execute Steps → Session Summary
```
</purpose>

<context>
$ARGUMENTS — learning intent text, or flags.

**Flags:**
- `-y, --yes` — Auto mode: skip confirmation
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force specific chain

**Chains:**
| Chain | Steps | Use when |
|-------|-------|----------|
| `follow` | learn-follow | Read/understand code or docs |
| `investigate` | learn-investigate | Answer "how/why" questions |
| `decompose` | learn-decompose | Catalog patterns in a module |
| `second-opinion` | learn-second-opinion | Get review/challenge on code |
| `retro` | learn-retro --lens all | Full retrospective |
| `deep-understand` | follow → decompose → second-opinion | Thorough module analysis |
| `pattern-catalog` | decompose --save-spec --save-wiki → second-opinion --mode review | Full pattern extraction + review |

**Session state:** `.workflow/knowhow/.maestro-learn/{session_id}/status.json`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/.maestro-learn/{session_id}/` (session state) and delegate to learn-* commands for knowledge writes. NEVER modify source code or files outside `.workflow/`.
</context>

<execution>

### Step 1: Parse & Route

**Intent routing:**
| Keywords | Route |
|----------|-------|
| File path (contains `/` or `\`) | `follow` |
| read, follow, walk through, understand | `follow` |
| why, how, what if, investigate | `investigate` |
| pattern, decompose, catalog | `decompose` |
| opinion, review, challenge, consult | `second-opinion` |
| retro, git, commit, decision | `retro` |
| thorough, deep | `deep-understand` |

No match → present menu via request_user_input. Max 1 clarification.

### Step 2: Resolve Target & Build Args
Map chain to skill invocations. Extract target and flags from arguments.

### Step 3: Confirm & Execute
- `--dry-run`: display chain and exit
- Not `-y`: show plan, ask confirmation
- Execute each step sequentially. On failure: retry/skip/abort
- Write session `status.json`, display summary
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No intent provided | Provide learning goal or use --chain |
| E002 | error | Cannot determine intent | Rephrase or use --chain |
| E005 | error | Invalid --chain name | Show valid chains |
| W001 | warning | Intent ambiguous | Present options |
</error_codes>

<success_criteria>
- [ ] Intent routed to correct chain
- [ ] Session directory created with status.json
- [ ] All chain steps executed
- [ ] Session summary displayed with next-step routing
</success_criteria>
