---
title: "Knowledge Management System Guide"
---

Maestro's knowledge management consists of **Spec** (coded constraints/tools) and **Wiki** (broad knowledge graph). Spec provides role-based project specifications, Wiki provides knowhow, design assets, and learning notes. Both layers are unified through `<entry>` tag format, WikiIndexer indexing, and role-based retrieval.

## Table of Contents

- [Spec System](#spec-system)
- [Wiki Knowledge Graph](#wiki-knowledge-graph)
- [Unified Index & Injection](#unified-index--injection)
- [File Structure](#file-structure)
- [CLI Reference](#cli-reference)

---

## Spec System

### Scope

| Scope | Directory | Auto-Init |
|-------|-----------|-----------|
| `project` (default) | `.workflow/specs/` | Yes |
| `global` | `~/.maestro/specs/` | Yes |
| `team` | `.workflow/collab/specs/` | No |
| `personal` | `.workflow/collab/specs/{uid}/` | No |

**Loading priority** (low to high): global -> project -> team -> personal. Later layers append, never overwrite.

### File to Role Mapping

Each spec file serves as the primary document for a role. `maestro-spec load --role` loads the primary file in full, plus cross-file entries tagged with that role.

| File | Primary Role | Purpose |
|------|-------------|---------|
| `coding-conventions.md` | implement | Naming, imports, formatting, patterns |
| `architecture-constraints.md` | plan | Module structure, layer boundaries |
| `quality-rules.md` | review | Quality rules, lint config |
| `debug-notes.md` | analyze | Debug tips, root cause records |
| `test-conventions.md` | test | Test framework, coverage requirements |
| `review-standards.md` | review | Review checklists, quality gates |
| `learnings.md` | implement | Bugs, pitfalls, lessons |
| `tools.md` | _(per-entry)_ | Reusable process/tool definitions |

### Entry Format

All entries use `<spec-entry>` closed tags with **roles** as the primary attribute:

<details>
<summary>Example</summary>

```markdown
<spec-entry roles="implement,test" keywords="auth,token,rotation" date="2026-04-21">
### Token rotation needs email carried through refresh flow
Revoked column must be set rather than deleting tokens.
</spec-entry>
```

</details>

| Attribute | Required | Description |
|-----------|----------|-------------|
| `roles` | Yes* | Comma-separated agent roles (implement, plan, test, review, analyze, explore) |
| `keywords` | Yes | Comma-separated, lowercase |
| `date` | Yes | `YYYY-MM-DD` |
| `source` | No | Origin (manual / agent / phase) |
| `ref` | No | Path to knowhow detail document |

*Backward compat: `category` attribute is still parsed and auto-mapped to roles.

### Tool Spec

Tool specs are reusable process/tool definitions stored in `tools.md`. They declare per-entry roles and can reference knowhow detail documents.

<details>
<summary>Inline mode (short) vs Ref mode (long)</summary>

```markdown
<!-- Inline (<10 steps) -->
<spec-entry roles="implement,test" keywords="testing,integration,api" date="2026-05-10">
### Integration Test Flow
1. Setup test environment  2. Seed test data  3. Run integration suite
</spec-entry>

<!-- Ref (>=10 steps) -->
<spec-entry roles="implement" keywords="deploy,pipeline,production" date="2026-05-10"
  ref="knowhow/RCP-deploy-flow.md">
### Production Deploy Flow
Standard deployment procedure with rollback safety.
</spec-entry>
```

</details>

- **Registration**: `/maestro-spec add` -- extract, generate, or optimize tool definitions
- **Execution**: `/maestro-ralph` -- load tool by name or role, execute step-by-step

### Spec Commands

```bash
maestro spec init [--scope <scope>]
maestro spec add <category> "<title>" "<content>" --roles r1,r2 --keywords kw1,kw2
maestro spec add <category> "<title>" "<content>" --ref "knowhow/RCP-oauth.md"
maestro spec load --role <role>              # Primary + cross-file role entries
maestro spec load --role <role> --keyword <kw>
maestro spec load --keyword <kw>             # Cross all files
```

### Progressive Fill

```
maestro-init    -> maestro-spec setup       /maestro-ralph --engine swarm --script wf-analyze -> plan, implement
/maestro-next   -> implement, test  /maestro-ralph continue -> implement, analyze
(retired; integrated into /maestro-ralph decision gate) -> review
```

### Keyword System

- `maestro-spec add` auto-extracts 3-5 domain keywords
- `maestro-spec load --keyword <kw>` matches `<spec-entry>` `keywords` attribute
- Legacy heading entries fallback to text search

---

## Wiki Knowledge Graph

### Knowhow System

Broad knowledge storage in `.workflow/knowhow/`, distinguished by filename prefix:

| Prefix | Category | Purpose |
|--------|----------|---------|
| `KNW-` | session | Session compact records |
| `TIP-` | tip | Quick context tips |
| `TPL-` | template | Code/config templates |
| `RCP-` | recipe | Step-by-step guides |
| `REF-` | reference | External doc summaries |
| `DCS-` | decision | Architecture/design decisions |
| `AST-` | asset | Code assets (API contracts, data models) |
| `BLP-` | blueprint | Architecture blueprints |
| `DOC-` | document | Long-form documents (fallback) |

#### Container Pattern

Knowhow files support multi-entry mode via `<knowhow-entry>` tags. Sub-entries inherit container's roles; entry-level overrides when present.

<details>
<summary>Container example</summary>

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

</details>

#### Ref Pattern (Spec -> Knowhow Bridge)

Spec = index + rules (auto-loaded). Knowhow = detail docs (on demand). `ref` bridges from index to detail.

<details>
<summary>Inline vs Ref mode + display comparison</summary>

```markdown
<!-- Inline (short) -->
<spec-entry roles="implement" keywords="auth,jwt" date="2026-05-10">
### JWT Token Rotation
Always rotate refresh tokens on use.
</spec-entry>

<!-- Ref (complex -> knowhow detail) -->
<spec-entry roles="implement" keywords="oauth,pkce" date="2026-05-10"
  ref="knowhow/RCP-oauth-flow.md">
### OAuth 2.0 Integration
Complete OAuth PKCE flow design.
</spec-entry>
```

Inline display: `### JWT Token Rotation > implement . auth, jwt . 2026-05-10`
Ref display: `-> Detail: maestro wiki load knowhow-oauth-flow`

</details>

### Role-Based Retrieval

Wiki entries support `roles` annotation aligned with delegate system roles: `analyze | explore | review | implement | plan | brainstorm | research`.

```bash
maestro wiki list --role analyze       # Browse by role
maestro wiki load <id1> [id2...]       # Load selected documents
```

### Three-Layer Loading

| Layer | Command | Depth | Use |
|-------|---------|-------|-----|
| Index browse | `wiki list --role <role>` | id + title | Browse |
| Precise load | `wiki load <id1> [id2...]` | Full body | Load by ID |
| Hook auto-inject | `loadWikiByRole()` | title + summary | Context injection |

### Wiki Commands

```bash
maestro wiki list [--type <type>] [--role <role>] [--category <cat>] [-q <query>]
maestro wiki load <id1> [id2...] [--json]
maestro wiki get <id> | search <query>
maestro wiki create --type knowhow --slug <slug> --title <title>
maestro wiki append <containerId> --category <cat> --body <text>
maestro wiki remove-entry <subEntryId>

maestro knowhow add --type <type> --title <title> --body <text>
maestro knowhow add --type asset --asset-type api-contract --code-paths "src/api/"
maestro knowhow list [--type <type>] | search <query>

maestro wiki health | graph | orphans | hubs
```

---

## Unified Index & Injection

### Atomic Node Index

WikiIndexer parses `<spec-entry>` and `<knowhow-entry>` into independent WikiEntry sub-nodes. Sub-nodes inherit container's roles; entry-level overrides. Keywords bubble up.

```
+-------------------+        +----------------------------+
| specs/tools.md    |   ->   | spec:project:tools         | (container)
|   <spec-entry>    |   ->   | spec:project:tools-001     | (sub-node)
+-------------------+        +----------------------------+
```

### Write Path

All write operations share unified WikiWriter: detect container type -> append entry block -> bubble keywords -> refresh index.

### Write Protection

| Operation | specs | knowhow | virtual |
|-----------|:-----:|:-------:|:-------:|
| Read / title update / append / remove / delete | Y | Y | Y* |
| body overwrite | **Forbidden** | **Forbidden** | -- |

### Auto-Injection

**Spec injection**: `spec-injector` at `PreToolUse:Agent` auto-injects specs by agent role:

| Agent Type | Role | Loaded Content |
|-----------|------|---------------|
| code-developer, tdd-developer | implement | Primary + cross-file implement entries |
| workflow-planner | plan | Primary + cross-file plan entries |
| workflow-reviewer | review | Primary + cross-file review entries |
| debug-explore-agent | analyze | Primary + cross-file analyze entries |

**Wiki injection**: Simultaneously loads role-relevant wiki (title + summary) from index. Controlled by context budget (full/reduced/minimal/skip).

**Keyword injection**: `keyword-spec-injector` at `UserPromptSubmit` extracts keywords, matches entries (max 5/trigger, session-deduped via bridge file).

---

## File Structure

```
~/.maestro/specs/                    # scope: global
    coding-conventions.md

.workflow/
+-- specs/                           # scope: project
|   +-- coding-conventions.md        # role: implement
|   +-- architecture-constraints.md  # role: plan
|   +-- quality-rules.md             # role: review
|   +-- debug-notes.md               # role: analyze
|   +-- test-conventions.md          # role: test
|   +-- review-standards.md          # role: review
|   +-- learnings.md                 # role: implement
|   +-- tools.md                     # role: per-entry
+-- knowhow/                         # Broad knowledge
|   +-- KNW-/TIP-/TPL-/RCP-/REF-/DCS-/AST-/BLP-/DOC-*.md
+-- collab/specs/                    # scope: team
|       +-- {uid}/                   # scope: personal
+-- issues/issues.jsonl              # Issue tracking (virtual)
+-- learning/patterns.jsonl          # SelfLearningService data
+-- wiki-index.json                  # Persisted index (auto-generated)
```

---

## CLI Reference

```bash
# -- Spec -----------------------------------------------------------------
maestro spec init [--scope <scope>]
maestro spec load [--role <role>] [--keyword <kw>] [--scope <scope>] [--json]
maestro spec add <category> "<title>" "<content>" [--roles r1,r2] [--keywords kw1,kw2] [--source <src>] [--ref <path>] [--knowhow-type <type>]
maestro spec list [--scope <scope>] | status [--scope <scope>]

# -- Tool Spec ------------------------------------------------------------
/maestro-spec add "<description>"
/maestro-ralph "<name>" | --role <role>

# -- Wiki -----------------------------------------------------------------
maestro wiki list [--type <type>] [--role <role>] [--category <cat>] [--tag <tag>] [-q <query>] [--group] [--json]
maestro wiki load <id1> [id2...] [--json]
maestro wiki get <id> [--json]
maestro wiki search <query> [--json]
maestro wiki create --type <spec|knowhow> --slug <slug> --title <title> [--body <text>]
maestro wiki append <containerId> --category <cat> --body <text> [--keywords <kw>]
maestro wiki remove-entry <subEntryId> | update <id> [--title <title>] [--frontmatter <json>] | delete <id>

# -- Knowhow --------------------------------------------------------------
maestro knowhow add --type <type> --title <title> --body <text> [--tags <csv>]
maestro knowhow add --type asset --asset-type <type> --code-paths <paths>
maestro knowhow list [--type <type>] [--json] | search <query> [--json] | get <id> [--json]

# -- Graph ----------------------------------------------------------------
maestro wiki health | graph | orphans | hubs [--limit N] | backlinks <id> | forward <id>

# -- Hooks ----------------------------------------------------------------
maestro hooks install --level standard | status
```
