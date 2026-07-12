---
name: maestro-tools-register
description: Register tool specs - extract, generate, or optimize reusable
  process definitions
argument-hint: "[description or intent]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
---

<purpose>
Codify reusable business processes as knowhow documents with `tool: true` in YAML frontmatter.

**Storage architecture**: `knowhow/` is the single source of truth for tool content. Spec index entries (`specs/`) serve only as discovery pointers — they reference knowhow documents via `ref:` links but never store tool steps directly. Downstream agents discover tools via `maestro search` or `maestro load --type knowhow --keyword <name>`, with spec index providing category-based routing.

Four modes:

1. **Extract** — Pull reusable processes from conversations/code/docs
2. **Generate** — Create new tool definitions from user description
3. **Optimize** — Improve existing tool spec steps, structure, clarity
4. **Promote** — Convert existing knowhow document to tool (add `tool: true` + category in place)

Short processes (<10 steps) inline; long processes (>=10 steps or with code examples) use ref mode with knowhow detail doc (RCP-/DOC-).
</purpose>

<context>
$ARGUMENTS — User intent description, or empty (interactive guidance)

```bash
$maestro-tools-register "extract OAuth PKCE token exchange flow from src/auth/"
$maestro-tools-register "generate Stripe webhook idempotency verification"
$maestro-tools-register "generate E2E checkout flow with payment gateway mock setup"
$maestro-tools-register "optimize e2e-checkout tool"
$maestro-tools-register "promote RCP-db-migration-rollback as test tool"
$maestro-tools-register "promote knowhow-auth-api to coding tool"
```

**Tool registration**: Creates knowhow documents in `.workflow/knowhow/` (single source of truth for tool content). Tools are discovered via `maestro search` or `maestro load --type knowhow` by category + tool flag.

**Knowhow format**:
```yaml
---
title: Tool Name
type: recipe
category: coding
summary: "Use when <timing>. <scope description>"
tags: [testing, api]
tool: true
---
Step content...
```

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/` (tool documents) and `.workflow/specs/` (ref entries) only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Schema validation** — tool knowhow document MUST include `tool: true`, `category`, `keywords/tags`, and `summary` in YAML frontmatter; missing fields → reject write
2. **No duplicate names** — tool title MUST be unique within its category; duplicate detection → E002 warning with overwrite/optimize confirmation
3. **Category required** — every tool MUST declare exactly one category from: coding, test, review, arch, debug; empty category → E003
4. **Confirmation gate** — MUST request_user_input before writing knowhow document and spec ref entry; NEVER persist without user confirmation
5. **Promote is in-place** — promote mode MUST update existing knowhow frontmatter; NEVER recreate the document
6. **Output boundary** — ALL file writes MUST target `.workflow/knowhow/` (tool documents) and `.workflow/specs/` (ref entries) only. NEVER modify source code or files outside these paths
7. **Description format** — first line after `### Title` MUST state "Use when ..." (usage timing); this is critical for ref entry summary visibility
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Gather**
- REQUIRED: Mode determined (extract/generate/optimize/promote) from argument parsing.
- REQUIRED: For optimize/promote modes, target tool/document exists and is loadable.
- BLOCKED if: empty args without user response to request_user_input.

**GATE 2: Gather → Write**
- REQUIRED: Tool name, category, and usage timing confirmed.
- REQUIRED: Steps extracted or generated (extract: ≥1 step, generate: user-confirmed scope).
- REQUIRED: User confirmed via request_user_input (title, category, keywords, summary, step count).
- BLOCKED if: E001 (`.workflow/specs/` not initialized), E003 (no category), user cancels.

**GATE 3: Write → Verify**
- REQUIRED: Knowhow document written with `tool: true` frontmatter (or updated in-place for promote).
- BLOCKED if: write failed or spec add returned error.

### Step 1: Intent Detection

Parse $ARGUMENTS to determine mode:
- Contains "extract" → extract mode
- Contains "optimize/improve" → optimize mode
- Contains "promote" or references existing knowhow doc (path/ID) → promote mode
- Other → generate mode
- Empty → ask user with request_user_input

### Step 2: Gather Information

**Extract mode**:
- Identify source (current conversation, specified files, codebase scan)
- Extract step sequence, prerequisites, expected outputs

**Generate mode**:
- Confirm tool name, applicable roles, target scenario
- If unclear, ask user with request_user_input

**Optimize mode**:
- Load existing tool: `maestro load --type spec --category coding --keyword <name>`
- Analyze improvement points (step splitting, prerequisites, error handling)

**Promote mode** (existing knowhow → tool):
- Locate document: `maestro search "<name>" --type knowhow` or by path in `.workflow/knowhow/`
- Read document, verify it contains actionable steps (numbered list or ## Steps section)
- If no actionable steps, suggest extract mode instead
- Determine category (Step 3) and summary ("Use when ...")
- Update frontmatter via: `maestro wiki update <id> --frontmatter '{"tool": true, "category": "<cat>", "summary": "<summary>"}'`
- Do NOT recreate the document — modify in place

**For all modes** — identify the usage timing: when should an agent or user invoke this tool? This becomes the first line of the entry description (see Step 5).

### Step 3: Determine Category

**Core principle**: `category` = **who consumes this tool** (which agent type discovers and uses it), not what the content is about.

| Category | Consumer Agent | Decision Question | Signal Words |
|---|---|---|---|
| `coding` | code-developer, workflow-executor | 开发者实现时需要这个流程吗？ | build, deploy, integrate, configure, setup, migrate, api-contract |
| `test` | tdd-developer, test-fix-agent | 测试者验证行为时需要这个流程吗？ | verify, validate, assert, e2e, regression, coverage, idempotency |
| `review` | workflow-reviewer | 审查者需要这个作为 checklist 吗？ | audit, checklist, compliance, quality-gate, standard |
| `arch` | workflow-planner | 规划者设计方案时需要这个吗？ | design, architecture, decompose, trade-off, migration-strategy |
| `debug` | debug-explore-agent | 调试者排查问题时需要这个吗？ | diagnose, trace, investigate, root-cause, reproduce |

**Multi-consumer split**: If content serves multiple consumers (e.g., API doc for both dev and test), split into separate documents:
- API contract (what endpoints look like) → `category: coding` (AST-*, tool: false)
- API verification steps (how to test) → `category: test` (RCP-*, tool: true)
- Ask user when ambiguous: "This tool content serves both developers and testers. Split into separate documents?"

**Ambiguous cases**: Choose the **primary consumer** — the agent that would fail without this knowledge.

### Step 4: Decide Inline vs Ref

- Steps <10 and no code blocks → **inline mode**
- Steps >=10 or contains code examples/config → **ref mode**

### Step 5: Write

**Description format**: First line after `### Title` must state **when to use** this tool (the usage timing from Step 2). This is critical for ref entries — `spec load` only shows the first 200 chars after the heading as the summary.

```
### {Title}

Use when {timing/trigger condition}.

1. Step one ...
```

**Inline mode**:
Create a knowhow document in `knowhow/` with `tool: true` frontmatter:
```yaml
---
title: <Title>
type: recipe
category: <category>
summary: "Use when <timing>. <scope description>"
tags: [<keywords>]
tool: true
---
Use when <timing>.

1. <step1>
2. <step2>
```

**Ref mode**:
1. Generate knowhow detail document (RCP- or DOC- prefix). YAML frontmatter must include `summary` with usage timing and `tool: true`:
```yaml
---
title: <Title>
type: recipe
category: <category>
summary: "Use when <timing>. <scope description>"
tags: [<keywords>]
tool: true
---
```

### Step 6: Verify

- Verify knowhow document exists: `maestro load --type knowhow --id <id>` to confirm loadable
- Verify discovery works: `maestro search "<keyword>" --type knowhow` to confirm searchable
- Display result: title, category, keywords, storage location (knowhow/)

</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` does not exist — run `maestro spec init` |
| E002 | warning | Duplicate tool name detected — confirm overwrite/optimize |
| E003 | fatal | category parameter empty — tools must declare applicable category |
</error_codes>

<success_criteria>
- [ ] Tool registered as knowhow document in `.workflow/knowhow/` with `tool: true` frontmatter
- [ ] category attribute correctly set
- [ ] keywords auto-extracted (3-5 terms)
- [ ] Discoverable via `maestro search` and `maestro load --type knowhow`
- [ ] Long processes use ref mode with knowhow file created
- [ ] No tool content duplicated in spec index — spec entries use `ref:` links only
</success_criteria>
