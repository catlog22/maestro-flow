---
name: maestro-learn
description: Route learning intent to learn-* commands
argument-hint: "\"intent text\" [-y] [--dry-run] [--chain <name>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Route learning requests to the optimal learn command or multi-step chain. Supports direct chain selection via `--chain` or intent-based routing via keyword matching.

Executes commands sequentially via Skill() with session tracking.
</purpose>

<context>
$ARGUMENTS — user learning intent text, or flags.

**Flags:**
- `-y` / `--yes` — Auto mode: skip confirmation
- `--dry-run` — Show planned chain without executing
- `--chain <name>` — Force a specific chain (bypass intent detection)

**Available learn commands:**
| Command | Purpose |
|---------|---------|
| `learn-follow` | Guided reading with forcing questions, pattern extraction |
| `learn-investigate` | Hypothesis-driven question investigation |
| `learn-decompose` | 4-dimension parallel pattern extraction |
| `learn-second-opinion` | Multi-perspective review/challenge/consult |
| `learn-retro` | Unified retrospective (git metrics + decision evaluation) |

**Available chains:**
| Chain | Steps | Use when |
|-------|-------|----------|
| `follow` | learn-follow | Read/understand code or docs |
| `investigate` | learn-investigate | Answer a "how/why" question |
| `decompose` | learn-decompose | Catalog patterns in a module |
| `second-opinion` | learn-second-opinion | Get review/challenge on code |
| `retro` | learn-retro --lens all | Full retrospective (git + decisions) |
| `deep-understand` | follow → decompose → second-opinion | Thorough module analysis |
| `pattern-catalog` | decompose --save-spec --save-wiki → second-opinion --mode review | Full pattern extraction + review |

**Storage:**
- `.workflow/learning/.maestro-learn/{session_id}/status.json` — Session tracking
- All learn command outputs go to `.workflow/learning/`
</context>

<execution>

### Step 1: Parse & Route

Parse flags (`-y`, `--dry-run`, `--chain`). Extract intent text.

**If `--chain` specified:** validate against known chains, jump to Step 2.

**Intent routing table** (match first token or keywords):

| Keywords | Route |
|----------|-------|
| File path (contains `/` or `\`) | `follow` |
| Wiki ID (`type-slug` pattern) | `follow` |
| read, follow, walk through, understand, 阅读, 跟读 | `follow` |
| why, how, what if, investigate, 为什么, 怎么 | `investigate` |
| pattern, decompose, catalog, 分解, 模式 | `decompose` |
| opinion, review, challenge, consult, 评审, 挑战 | `second-opinion` |
| retro, git, commit, decision, 回顾 | `retro` |
| thorough, deep, 全面, 深入 | `deep-understand` |

**If no match:** present menu via AskUserQuestion:
```
What would you like to do?
1. Read through code/docs → follow
2. Investigate a question → investigate
3. Find patterns in code → decompose
4. Get a second opinion → second-opinion
5. Retrospective → retro
```

Max 1 clarification round. If still unclear: error.

### Step 2: Resolve Target & Build Args

- File path → pass directly
- Wiki ID → pass directly
- Topic string → pass as quoted argument
- Extract any flags (--depth, --days, --lens, --mode, --scope, etc.)

**Chain → command mapping:**
```
follow          → Skill("learn-follow", "{target} {flags}")
investigate     → Skill("learn-investigate", "\"{target}\" {flags}")
decompose       → Skill("learn-decompose", "{target} {flags}")
second-opinion  → Skill("learn-second-opinion", "{target} {flags}")
retro           → Skill("learn-retro", "{flags}")
deep-understand → [learn-follow --depth deep, learn-decompose --save-spec, learn-second-opinion --mode challenge]
pattern-catalog → [learn-decompose --save-spec --save-wiki, learn-second-opinion --mode review]
```

### Step 3: Confirm & Execute

**If `--dry-run`:** display chain plan and exit.

**If not `-y`:** show plan, ask for confirmation.

**Execute:**
1. Create session dir: `.workflow/learning/.maestro-learn/learn-{timestamp}/`
2. Write `status.json` with chain steps
3. Execute each step via `Skill()`:
   - On success: mark completed, continue
   - On failure (interactive): ask retry/skip/abort
   - On failure (auto): skip and continue
4. Display session summary with artifact list and next-step suggestion

</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent provided | Provide a learning goal or use --chain |
| E002 | error | Cannot determine intent after clarification | Rephrase or use --chain directly |
| E003 | error | Chain step failed + user chose abort | Partial progress saved in status.json |
| E005 | error | Invalid --chain name | Show valid chains |
| W001 | warning | Intent ambiguous between commands | Present options |
| W002 | warning | Chain step completed with warnings | Log and continue |
</error_codes>

<success_criteria>
- [ ] Intent routed to correct chain (or --chain validated)
- [ ] Target resolved and arguments assembled
- [ ] Session directory created with status.json
- [ ] All chain steps executed via Skill()
- [ ] Error handling: retry/skip/abort per step
- [ ] Session summary displayed with next-step routing
- [ ] No files modified outside `.workflow/learning/`
</success_criteria>
