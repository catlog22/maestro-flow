# Knowledge Management System Guide

Maestro's knowledge management consists of **Spec** (coded constraints/tools) and **Wiki** (broad knowledge graph). Spec provides role-based project specifications, Wiki provides knowhow, design assets, and learning notes. Both layers are unified through `<entry>` tag format, WikiIndexer indexing, and role-based retrieval.

## Table of Contents

- [Spec System](#spec-system)
  - [Scope](#scope)
  - [File → Role Mapping](#file--role-mapping)
  - [Entry Format](#entry-format)
  - [Tool Spec](#tool-spec)
  - [Commands](#spec-commands)
  - [Progressive Fill](#progressive-fill)
  - [Auto-Init](#auto-init)
  - [Keyword System](#keyword-system)
- [Wiki Knowledge Graph](#wiki-knowledge-graph)
  - [Knowhow System](#knowhow-system)
  - [Role-Based Retrieval](#role-based-retrieval)
  - [Three-Layer Loading](#three-layer-loading)
  - [Wiki Commands](#wiki-commands)
- [Unified Index & Injection](#unified-index--injection)
  - [Atomic Node Index](#atomic-node-index)
  - [Write Path](#write-path)
  - [Write Protection](#write-protection)
  - [Auto-Injection](#auto-injection)
  - [Session Dedup](#session-dedup)
- [File Structure](#file-structure)
- [CLI Reference](#cli-reference)

---

## Spec System

### Scope

Spec supports 4 scopes via `--scope`:

| Scope | Directory | Purpose | Auto-Init |
|-------|-----------|---------|-----------|
| `project` (default) | `.workflow/specs/` | Project-level specs, shared by all | Yes |
| `global` | `~/.maestro/specs/` | Cross-project universal specs | Yes |
| `team` | `.workflow/collab/specs/` | Team shared specs | No |
| `personal` | `.workflow/collab/specs/{uid}/` | Personal preference overrides | No |

**Loading priority** (low → high): global → project → team → personal. Later layers append, never overwrite.

### File → Role Mapping

Each spec file serves as the **primary document** for a role. `spec load --role` loads the primary file in full, plus cross-file entries tagged with that role.

| File | Primary Role | Purpose |
|------|-------------|---------|
| `coding-conventions.md` | implement | Naming, imports, formatting, coding patterns |
| `architecture-constraints.md` | plan | Module structure, layer boundaries, arch decisions |
| `quality-rules.md` | review | Quality rules, lint config, enforcement standards |
| `debug-notes.md` | analyze | Debug tips, root cause records, known issues |
| `test-conventions.md` | test | Test framework, patterns, coverage requirements |
| `review-standards.md` | review | Review checklists, quality gates |
| `learnings.md` | implement | Bugs, pitfalls, lessons learned |
| `tools.md` | _(per-entry)_ | Reusable process/tool definitions |

### Entry Format

All entries use `<spec-entry>` closed tags with **`roles`** as the primary attribute:

```markdown
<spec-entry roles="implement,test" keywords="auth,token,rotation" date="2026-04-21">

### Token rotation needs email carried through refresh flow

Revoked column must be set rather than deleting tokens.

</spec-entry>
```

| Attribute | Required | Format | Description |
|-----------|----------|--------|-------------|
| `roles` | Yes* | Comma-separated | Applicable agent roles (implement, plan, test, review, analyze, explore) |
| `keywords` | Yes | Comma-separated, lowercase | Searchable keywords |
| `date` | Yes | `YYYY-MM-DD` | Creation date |
| `source` | No | String | Origin (manual / agent / phase) |
| `ref` | No | Path | Reference to knowhow detail document |

*Backward compat: `category` attribute is still parsed and auto-mapped to roles via fallback table.

### Tool Spec

Tool specs are reusable process/tool definitions stored in `tools.md`. They declare per-entry roles and can reference knowhow detail documents for long procedures.

**Inline mode** (short process, <10 steps):
```markdown
<spec-entry roles="implement,test" keywords="testing,integration,api" date="2026-05-10">

### Integration Test Flow

1. Setup test environment
2. Seed test data
3. Run integration suite
4. Validate coverage threshold
5. Generate report

</spec-entry>
```

**Ref mode** (long process, >=10 steps or with code examples):
```markdown
<spec-entry roles="implement" keywords="deploy,pipeline,production" date="2026-05-10"
  ref="knowhow/RCP-deploy-flow.md">

### Production Deploy Flow

Standard deployment procedure with rollback safety. See referenced document.

</spec-entry>
```

**Registration**: `/maestro-tools-register` — extract, generate, or optimize tool definitions.

**Execution**: `/maestro-tools-execute` — load tool by name or role, execute step-by-step.

### Spec Commands

```bash
# Initialize
maestro spec init [--scope <scope>] [--uid <uid>]

# Add entry
maestro spec add coding "Always use named exports" --roles "implement"
maestro spec add tools "Test Flow" "Steps..." --roles "implement,test" --keywords "testing"
maestro spec add tools "OAuth PKCE" "Summary" --roles "implement" --ref "knowhow/RCP-oauth.md"
echo '{"category":"coding","title":"...","content":"..."}' | maestro spec add --stdin
maestro spec add coding "title" "content" --json   # JSON 格式输出

# Load
maestro spec load --role implement              # Primary doc + cross-file role entries
maestro spec load --role implement --keyword auth
maestro spec load --keyword auth                # Keyword-only filter across all files
echo '{"role":"implement"}' | maestro spec load --stdin

# CLI equivalent
maestro spec add <category> "<title>" "<content>" --roles r1,r2 --keywords kw1,kw2 [--uid <uid>]
maestro spec load --role <role> [--keyword <word>] [--uid <uid>] --json
```

### Progressive Fill

Specs are progressively enriched by pipeline phases:

```
maestro-init       → spec-setup (skeleton + scan)
maestro-analyze    → Locked decisions → plan, code patterns → implement
maestro-plan       → Design conventions → implement/plan, test strategy → test
maestro-execute    → Learnings → implement, root causes → analyze
maestro-verify     → Quality findings → review
```

### Auto-Init

`loadSpecs()` auto-detects and creates missing spec directories (with 8 seed files including `tools.md`), no manual init required.

### Keyword System

- `spec add` auto-extracts 3-5 domain keywords
- `spec load --keyword <kw>` matches `<spec-entry>` `keywords` attribute
- Legacy heading entries fallback to text search

---

## Wiki Knowledge Graph

### Knowhow System

Knowhow is broad knowledge storage supporting multiple document types. All files stored in `.workflow/knowhow/`, distinguished by filename prefix:

| Prefix | Category | Purpose |
|--------|----------|---------|
| `KNW-` | session | Session compact records |
| `TIP-` | tip | Quick context tips |
| `TPL-` | template | Code/config templates |
| `RCP-` | recipe | Step-by-step guides |
| `REF-` | reference | External doc summaries |
| `DCS-` | decision | Architecture/design decisions |
| `AST-` | asset | General code assets (API contracts, data models, UI prototypes) |
| `BLP-` | blueprint | Architecture blueprints, system designs |
| `DOC-` | document | Long-form specs/documents (general fallback) |

#### Container Pattern (`<knowhow-entry>`)

Similar to spec's `<spec-entry>`, knowhow files support container multi-entry mode:

```markdown
---
title: Session Compact 20260510
category: session
roles: [analyze, review]
---

<knowhow-entry category="pattern" keywords="auth,jwt" date="2026-05-10" roles="implement">

### JWT Refresh Token Rotation

Always rotate refresh tokens on use to prevent replay attacks.

</knowhow-entry>
```

Each `<knowhow-entry>` is parsed by WikiIndexer as an independent WikiEntry sub-node.

#### Code Asset Association (codePaths)

Code asset documents (AST-/BLP-) associate source code via frontmatter `codePaths`:

```yaml
---
title: Auth API Contract
category: asset
assetType: api-contract
codePaths:
  - src/api/auth/
  - src/types/auth.ts
roles: [implement, review]
tags: [auth, api, jwt]
---
```

#### Ref Pattern (Spec → Knowhow Bridge)

Spec is the index/rule layer, Knowhow is the detail layer. When a topic is too complex for inline spec-entry, use `ref` to bridge:

```markdown
<!-- Inline mode (short insight) -->
<spec-entry roles="implement" keywords="auth,jwt" date="2026-05-10">

### JWT Token Rotation

Always rotate refresh tokens on use.

</spec-entry>

<!-- Ref mode (complex topic → knowhow detail) -->
<spec-entry roles="implement" keywords="oauth,pkce" date="2026-05-10"
  ref="knowhow/RCP-oauth-flow.md">

### OAuth 2.0 Integration

Complete OAuth PKCE flow design. See referenced document.

</spec-entry>
```

**`spec load` display comparison**:

Inline entry (full content):
```
### JWT Token Rotation
> implement · auth, jwt · 2026-05-10

Always rotate refresh tokens on use.
```

Ref entry (summary + load command):
```
### OAuth 2.0 Integration

Complete OAuth PKCE flow design.

→ Detail: maestro wiki load knowhow-oauth-flow
```

**Separation principle**:
- **Spec** (`specs/`) = index + rules. Short entries, auto-loaded by agents
- **Knowhow** (`knowhow/`) = detail docs. Full documents, loaded on demand
- **ref** = bridge from index entry to detail doc

### Role-Based Retrieval

Wiki entries support `roles` annotation, aligned with the 7 delegate system roles:

```
analyze | explore | review | implement | plan | brainstorm | research
```

Declared via frontmatter `roles: [analyze, review]` or entry-level `roles` attribute.

```bash
# Browse knowledge index by role
maestro wiki list --role analyze

# Load selected documents
maestro wiki load knowhow-auth-api spec:project:arch-001
```

Sub-entries inherit container's roles. Entry-level roles override container roles when present.

### Three-Layer Loading

| Layer | Command | Depth | Use |
|-------|---------|-------|-----|
| Index browse | `maestro wiki list --role <role>` | id + title | Browse, decide what to load |
| Precise load | `maestro wiki load <id1> [id2...]` | Full body | Load selected docs by ID |
| Hook auto-inject | `loadWikiByRole()` | title + summary | Lightweight context injection (sync) |

**Usage flow** (commands/agents):
1. `maestro wiki list --role analyze` → browse role-relevant doc index
2. Analyze index, identify task-relevant entries
3. `maestro wiki load <id1> <id2>` → load selected full docs
4. Review loaded knowledge, then execute

### Wiki Commands

```bash
# Entry management
maestro wiki list [--type <type>] [--role <role>] [--category <cat>] [-q <query>]
maestro wiki load <id1> [id2...] [--json]
maestro wiki get <id>
maestro wiki search <query>
maestro wiki create --type knowhow --slug <slug> --title <title>
maestro wiki append <containerId> --category <cat> --body <text>
maestro wiki remove-entry <subEntryId>

# Knowhow CLI
maestro knowhow add --type <type> --title <title> --body <text>
maestro knowhow add --type asset --asset-type api-contract --code-paths "src/api/"
maestro knowhow list [--type <type>]
maestro knowhow search <query>

# Graph analysis
maestro wiki health
maestro wiki graph
maestro wiki orphans
maestro wiki hubs
```

---

## Unified Index & Injection

### Atomic Node Index

WikiIndexer parses `<spec-entry>` and `<knowhow-entry>` into independent WikiEntry sub-nodes:

```
Container file                      WikiEntry nodes
┌───────────────────┐        ┌──────────────────────────┐
│ specs/tools.md    │   ──>  │ spec:project:tools       │ (container)
│   <spec-entry>    │   ──>  │ spec:project:tools-001   │ (sub-node, parent=container)
│   <spec-entry>    │   ──>  │ spec:project:tools-002   │
└───────────────────┘        └──────────────────────────┘
```

Sub-nodes inherit container's `roles`, `createdBy`, `sourceRef`. Entry-level `roles` override container roles. Keywords bubble up to container frontmatter.

### Write Path

Spec and Knowhow share unified WikiWriter write path:

```
/spec-add tools "..."            ──┐
maestro wiki append spec-...     ──┤──> WikiWriter.appendEntry()
maestro wiki append knowhow-...  ──┘     │
                                         ├── Detect container type → <spec-entry> or <knowhow-entry>
                                         ├── Append entry block
                                         ├── Bubble keywords to frontmatter
                                         └── Refresh WikiIndex
```

### Write Protection

| Operation | specs/*.md | knowhow/*.md | virtual (issue) |
|-----------|:---------:|:-----------:|:---------------:|
| Read | Y | Y | Y |
| title/frontmatter update | Y | Y | -- |
| body overwrite | **Forbidden (403)** | **Forbidden (403)** | -- |
| Entry append (appendEntry) | Y | Y | -- |
| Entry remove (removeEntry) | Y | Y | -- |
| File delete | Y | Y | -- |

### Auto-Injection

#### Spec Injection (by role)

`spec-injector` hook at `PreToolUse:Agent` auto-injects specs based on agent role:

| Agent Type | Role | Loaded Content |
|-----------|------|---------------|
| code-developer, tdd-developer | implement | Primary doc + cross-file implement entries |
| workflow-planner | plan | Primary doc + cross-file plan entries |
| workflow-reviewer | review | Primary doc + cross-file review entries |
| debug-explore-agent | analyze | Primary doc + cross-file analyze entries |

#### Wiki Injection (by role)

`spec-injector` simultaneously loads role-relevant wiki knowledge (title + summary) from `wiki-index.json`.

Both layers merged and controlled by context budget (full/reduced/minimal/skip).

#### Keyword Injection

`keyword-spec-injector` at `UserPromptSubmit` extracts keywords from prompt, matches spec entries (max 5 per trigger, session-deduped).

### Session Dedup

- **Bridge file**: `{tmpdir}/maestro-spec-kw-{sessionId}.json`
- Records injected keywords + entry IDs
- Three injection points (user input / Agent launch / Coordinator) share bridge

---

## File Structure

```
~/.maestro/
└── specs/                              # scope: global
    ├── coding-conventions.md
    └── ...

.workflow/
├── specs/                              # scope: project
│   ├── coding-conventions.md           # role: implement
│   ├── architecture-constraints.md     # role: plan
│   ├── quality-rules.md               # role: review
│   ├── debug-notes.md                 # role: analyze
│   ├── test-conventions.md            # role: test
│   ├── review-standards.md            # role: review
│   ├── learnings.md                   # role: implement
│   └── tools.md                       # role: per-entry
├── knowhow/                            # Broad knowledge (unified markdown)
│   ├── KNW-20260427-1912.md            # Session records
│   ├── TPL-20260427-1913.md            # Templates
│   ├── RCP-20260428-0900.md            # Recipes / tool procedures
│   ├── REF-20260428-1000.md            # References
│   ├── DCS-20260429-1100.md            # Decisions
│   ├── TIP-20260429-1200.md            # Tips
│   ├── AST-auth-api.md                 # Code assets (API contracts)
│   ├── BLP-microservice-arch.md        # Architecture blueprints
│   └── DOC-api-design-standard.md      # Long-form documents
├── collab/
│   └── specs/                          # scope: team
│       └── {uid}/                      # scope: personal
├── issues/
│   └── issues.jsonl                    # Issue tracking (virtual entry)
├── learning/
│   └── patterns.jsonl                  # SelfLearningService internal data
└── wiki-index.json                     # Persisted index (auto-generated)
```

---

## CLI Reference

```bash
# ── Spec ────────────────────────────────────────────────────────
maestro spec init [--scope <scope>] [--uid <uid>]
maestro spec load [--role <role>] [--keyword <kw>] [--scope <scope>] [--json] [--uid <uid>] [--stdin]
maestro spec add <category> "<title>" "<content>" [--roles r1,r2] [--keywords kw1,kw2] [--source <src>] [--ref <path>] [--knowhow-type <type>] [--uid <uid>] [--stdin] [--json]
maestro spec list [--scope <scope>] [--uid <uid>]
maestro spec ls [--scope <scope>] [--uid <uid>]               # list 别名
maestro spec status [--scope <scope>] [--uid <uid>]

# ── Tool Spec (via spec system) ───────────────────────────────
/maestro-tools-register "<description>"          # Extract, generate, or optimize tool definitions
/maestro-tools-execute "<name>" | --role <role>   # Load and execute tool step-by-step

# ── Wiki Retrieval ────────────────────────────────────────────
maestro wiki list [--type <type>] [--role <role>] [--category <cat>] [--tag <tag>] [-q <query>] [--group] [--json]
maestro wiki load <id1> [id2...] [--json]
maestro wiki get <id> [--json]
maestro wiki search <query> [--json]

# ── Wiki Write ────────────────────────────────────────────────
maestro wiki create --type <spec|knowhow> --slug <slug> --title <title> [--body <text>]
maestro wiki append <containerId> --category <cat> --body <text> [--keywords <kw>]
maestro wiki remove-entry <subEntryId>
maestro wiki update <id> [--title <title>] [--frontmatter <json>]
maestro wiki delete <id>

# ── Wiki Graph ────────────────────────────────────────────────
maestro wiki health
maestro wiki graph
maestro wiki orphans
maestro wiki hubs [--limit N]
maestro wiki backlinks <id>
maestro wiki forward <id>

# ── Knowhow ──────────────────────────────────────────────────
maestro knowhow add --type <type> --title <title> --body <text> [--tags <csv>]
maestro knowhow add --type asset --asset-type <type> --code-paths <paths>
maestro knowhow list [--type <type>] [--json]
maestro knowhow search <query> [--json]
maestro knowhow get <id> [--json]

# ── Hook Management ───────────────────────────────────────────
maestro hooks install --level standard
maestro hooks status
```
