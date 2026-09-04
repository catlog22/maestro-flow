<!-- session-mode: none -->
# Maestro

<!-- session-mode: none -->
# Coding Philosophy

## Core Beliefs

- **Pursue good taste** - Eliminate edge cases to make code logic natural and elegant
- **Embrace extreme simplicity** - Complexity is the root of all evil
- **Be pragmatic** - Code must solve real-world problems, not hypothetical ones
- **Data structures first** - Bad programmers worry about code; good programmers worry about data structures
- **Never break backward compatibility** - Existing functionality is sacred and inviolable
- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Clear intent over clever code** - Be boring and obvious
- **Follow existing code style** - Match import patterns, naming conventions, and formatting of existing codebase
- **Minimize changes** - Only modify what's directly required; avoid refactoring, adding features, or "improving" code beyond the request
- **No unsolicited documentation** - NEVER generate reports, documentation files, or summaries without explicit user request. When the active command requires a report, write it only to the current Run's `report.md` or declared typed output.

## Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks - choose the boring solution
- If you need to explain it, it's too complex

## Fix, Don't Hide

**Solve problems, don't silence symptoms** - Skipped tests, `@ts-ignore`, empty catch, `as any`, excessive timeouts = hiding bugs, not fixing them

**NEVER**:
- Make assumptions - verify with existing code
- Generate reports, summaries, or documentation files without explicit user request
- Use suppression mechanisms (`skip`, `ignore`, `disable`) without fixing root cause

**ALWAYS**:
- Plan complex tasks thoroughly before implementation
- Generate task decomposition for multi-module work (>3 modules or >5 subtasks)
- Track progress using TODO checklists for complex tasks
- Validate planning documents before starting development
- Commit working code incrementally
- Update plan documentation and progress tracking as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess
- **Edit fallback**: When Edit tool fails 2+ times on same file, try Bash sed/awk first, then Write to recreate if still failing

## Learning the Codebase

- Find 3 similar features/components
- Identify common patterns and conventions
- Use same libraries/utilities when possible
- Follow existing test patterns

## Tooling

- Use project's existing build system
- Use project's test framework
- Use project's formatter/linter settings
- Don't introduce new tools without strong justification

## Content Uniqueness Rules

- **Each layer owns its abstraction level** - no content sharing between layers
- **Reference, don't duplicate** - point to other layers, never copy content
- **Maintain perspective** - each layer sees the system at its appropriate scale
- **Avoid implementation creep** - higher layers stay architectural

# Context Requirements

Before implementation, always:
- Identify 3+ existing similar patterns
- Map dependencies and integration points
- Understand testing framework and coding conventions


## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

## Explore

Route code search by the Query Rules table (Knowledge System below) — it is the single source for tool selection. Use `maestro explore` only when the entry point is uncertain or a cross-file relationship needs evidence-backed synthesis. For exact text, regex, known files, or exhaustive call-site scans, use `rg`/Grep directly. When using `maestro explore`, call it and stop to wait for results.

```bash
maestro explore "FIND: <target + condition>\nSCOPE: <paths>" [more prompts...] [options]
```

Lightweight read-only codebase search. 1 prompt = 1 agent. Not for write-mode/long sessions — use `delegate`.

| Option | Description |
|--------|-------------|
| `-e, --endpoint <names>` | Endpoint name(s), comma-separated |
| `--all` | Fan out each prompt to all endpoints |
| `--json` | Output results as JSON |

Long-tail options (`--max-turns`, `-f`, `--cd`) — see `maestro explore --help`.

### Context Injection

Explore agents have no project awareness — inject context before calling:

| Injection | Field | Content |
|-----------|-------|---------|
| Structure | SCOPE | Concrete paths of relevant directories (no wildcard sweeps) |
| Domain | SCOPE | Key file paths already returned by `maestro search` |
| Constraints | ATTENTION | Framework, language, naming conventions |

```
FIND: authentication middleware that validates JWT tokens
SCOPE: src/middleware/, src/auth/, src/api/routes/
ATTENTION: Express.js, middleware files named *.middleware.ts
```

### Prompt Structure

**FIND + SCOPE is the minimum bar.** One declarative sentence per field; no nested conditions.

| Field | Required | Rule |
|-------|----------|------|
| `FIND` | **Yes** | Decidable concrete target (what + acceptance condition) |
| `SCOPE` | **Yes** | Explicit paths or globs; `**/*` sweeps forbidden |
| `EXCLUDE` | No | File types or directories to skip |
| `ATTENTION` | No | Framework, naming conventions, known pitfalls |
| `EXPECTED` | Recommended | Output format: `file:line` list / summary / JSON |

```
FIND: Functions that call db.query() with string concatenation instead of $1/$2
SCOPE: src/db/**/*.ts, src/api/**/*.ts
EXCLUDE: **/*.test.ts
EXPECTED: file:line list with the SQL string
```

### Cross-Search

For important searches, run 2-3 prompts from different angles concurrently; Claude cross-validates results.

**Split by angle, not by keyword:**

| Angle | Prompt A | Prompt B |
|-------|----------|----------|
| Definition vs call sites | Find function definitions | Find call sites |
| Positive vs negative | Find correct usage | Find missed usage |
| Entry vs implementation | Find exports/routes | Find internal logic |
| By file type | Usage in .ts | Usage in .vue |

**Result confidence:**
- Both hit → high confidence, use directly
- Single hit → verify with Grep/Read
- Zero hits → retry from a different angle or target doesn't exist

### Execution

Multi-prompt — background; single lookup — foreground:

```
Bash({ command: "maestro explore \"p1\" \"p2\" --json", run_in_background: true })
Bash({ command: "maestro explore \"FIND: ...\nSCOPE: ...\"" })
```

Session: `maestro explore show` / `maestro explore output <id>`

## Knowledge System

**Knowledge Gate (required)**: Resolve project knowledge before reading, analyzing, planning against, or modifying project files.

| Context | Required opening |
|---------|------------------|
| Standalone task | First project-related tool call: `maestro search "<1-3 task-specific keywords>" [--type <type>] --json` |
| Fresh orchestrated Run | Inspect the injected birth packet and `knowledge_context`, then make the task-specific search the first project-related tool call |
| Reattached/compacted Run | `maestro run brief <run-id>` may run first; inspect `knowledge_context`, then search/load before project-file access |

This applies to process/ops, code changes, debugging, architecture, review, planning, and config/skill work. `git status`, file-name search, Grep/Read, and `rg '*knowhow*'` do not satisfy the Gate.

When the user says "参考", "参照", `knowhow`, `spec`, or "reference the process", derive the query from the task subject and operation, add the named `--type`, and explicitly load every governing hit before file exploration. Search results, automatic injection, and `knowledge_context` are exposure only; explicit `maestro load` records consumption. `knowledge_context.run.knowledge_ids` lists consumed IDs, not full content: do not repeat load when the full entry is already in context, but reload when reattachment preserved only an ID or summary.

**Architecture-template exception:** `source=arch-kb`, `kind=template` results and `maestro load --type template` are global reference-only evidence. They do not satisfy the project Knowledge Gate and deliberately do not record project knowledge consumption. Follow `@~/.maestro/templates/search-tools.md`.

Empty results permit normal discovery only after inspection. If search returns an initialization or recovery hint, execute it and retry first.

**Re-search triggers** (re-query mid-task with new keywords, never repeat old queries): entering a new module/subsystem boundary; same fix failed twice; before architecture/approach decisions.

```bash
maestro search "<query>" [--type <type>] [--category <cat>] [--tag <tag>] [--keyword <word>] [--code] [--kg]
maestro load --type <type> [--list] [--category <cat>] [--keyword <word>] [--tag <tag>] [--id <id>]
```

**--type**: `spec`, `knowhow`, `domain`, `issue`, `session`, `scratch`, `note`, `project`, `roadmap`, `template` (global Arch-KB reference only)
**--category** (spec only): `coding`, `arch`, `debug`, `test`, `review`, `learning`, `ui`
**--tag**: Filter by exact tag match (e.g. `diagnosis`, `review-findings`, `lessons`), wiki only
**--keyword**: Filter by keyword in title/body (substring match), wiki only

### Query Rules

1-3 core keywords per query — multiple short queries beat one long one.
Separate concepts from symbols. Add `--kg` for full-source.

| Target | Tool |
|--------|------|
| Known symbol → definition/signature | `maestro search "<Symbol>" --code` (file:line, no agent cost) |
| Concept / knowledge / conventions | `maestro search "<keywords>"` |
| Architecture template reference | Reuse upstream evidence; otherwise upstream researcher runs `maestro search "<keywords>" --type template --json` and loads selected `openCommand` |
| Debug symptoms / review lessons (sealed artifacts) | `maestro search "<keywords>" --tag diagnosis` / `--tag lessons` |
| Exact text / regex / known-file search | `rg` / Grep |
| Exhaustive usage sweep with a known symbol or syntax pattern | `rg` / Grep |
| Unknown entry point / cross-file data flow / pattern needing an evidence-backed synthesis | `maestro explore` |

**Association follow-through** — after a hit, walk one hop along relations instead of re-issuing broad queries:

- Hit a chunked entry (id with `-NNN` suffix) → `maestro load --type knowhow --id <parent-entry-id>` for full text
- Trace references (who cites it / what it cites) → `maestro wiki backlinks <id>` / `maestro wiki forward <id>`
- Rule evolution history → `maestro spec history <sid>`

Zero code hits with a hint (e.g. `code index not initialized`) → run the hinted command, then retry — don't abandon code search.

```bash
# ❌ keyword dump
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ targeted
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro load --type spec --category coding
```

### Stable Run Knowledge Invariants

Runtime birth packets, `maestro run brief`, completion receipts, and the `maestro run check` finish checklist are authoritative for Run-specific IDs, reconciliation state, and next commands; their emitted commands override static examples. Static instructions own only these stable rules:

1. Search and automatic injection are exposure; explicit `load` records consumption except `maestro load --type template`, which loads global reference evidence without project-knowledge attribution.
2. Put accepted decisions and locked constraints in `report.md` frontmatter (completion stages them as pending candidates) — prescriptive rules only; NEVER execution-state narration (seal auto-stages every accepted/locked entry as a corpus candidate).
3. **Staging Quality Bar** — stage only content future work can directly reuse: pitfall warning / failure lesson / non-trivial trade-off / new prescriptive constraint. NEVER process notes, re-descriptions, trivial ops, or raw traces; **zero candidates is a legitimate outcome**. Stage with `maestro knowledge stage spec|knowhow "<title>" --content-file <path|-> --run <run-id>` (or `--session <session-id> --evidence <file:line,...>` outside a Run); add `--signal cited|validated|contradicted --signal-ids <ids>` when relating to existing knowledge.
4. Routine Run completion never writes project Spec/Knowhow directly and never promotes candidates; the finish checklist is soft guidance — unresolved items go in `report.md` concerns (unresolved reconciliation may be sealed but cannot be promoted).
5. Review, resolve, promote, supersede, conflict marking, and audit are explicit governance actions — only on user request or a confirmed workflow step.

Outside a Run, governed staging still works; direct `/maestro-spec` or `/maestro-knowhow` writes stay reserved for explicit knowledge-management work. Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, tests→`test`.

### Governance Boundary

Use commands supplied by the current `knowledge_context`, completion receipt, and `run check` output; those Runtime surfaces override static examples here.

- `maestro knowledge review <session-id> --refresh` refreshes reconciliation. **Review Presentation Protocol**: run `review --json`, present each candidate (title, content summary, evidence anchors, evidence-backed matches, recommended disposition + one-line rationale), collect user decisions, then execute `maestro knowledge promote <session-id> --resolve <candidate-id> --as <choice> [--target <knowledge-id>] --reason "<reason>"` (TOCTOU fence + resolve + promote in one call; `review --resolve` remains a compatible fallback). The user decides; the agent never hands over the raw review command as the whole task.
- Promotion requires eligible candidates with fresh receipts. Run-source candidates require every source Run sealed. A `session/2.0` session-source candidate does not require Session seal: it requires immutable candidate version/content hash, exact Session activity revision, non-empty evidence roots/hash, and a fresh session reconciliation receipt for the candidate snapshot and current corpus fingerprint, revalidated at final commit. Normal completion and Execution seal never imply approval or promotion.
- Direct-write whitelist: only explicit knowledge-management commands write the corpus directly (`maestro spec add`, `maestro knowhow add`, `maestro domain add`, and the knowhow/wiki maintenance commands). Content-producing workflows (retrospective, wiki-digest, wiki-connect, maestro-learn, ui-codify-knowhow, harvest, finish-work) MUST route knowledge through `stage → review → promote` — never direct `.workflow/specs/` or `.workflow/knowhow/` writes.
- A pending backlog remains durable and visible; nothing silently promotes or discards candidates. Deprecated/superseded knowledge stays auditable but excluded from search/injection; low exposure never triggers automatic deletion or pruning.
- **Fast path for standalone insights (outside any Run)**: `maestro knowhow add --type <tip|recipe|template|reference|decision|session> --title "<title>" --body-file <path>` writes `.workflow/knowhow/` directly — no Session, no `--evidence`, no review/promote cycle. Use it when an insight is standalone and needs no Run binding (a quick tip, a self-contained recipe, a one-off decision). The `stage → review → promote` pipeline is for candidates needing adjudication against the corpus; routine Run completion still must not call `knowhow add` directly (Run-internal knowledge still routes through `stage --run`).
