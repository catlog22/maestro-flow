---
name: maestro-learn
description: Route learning intent to learn-* commands
argument-hint: "\"intent text\" [-y] [--dry-run] [--chain <name>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

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
