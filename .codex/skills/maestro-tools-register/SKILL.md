---
name: maestro-tools-register
description: Register tool specs - extract, generate, or optimize reusable process definitions
argument-hint: "[description or intent]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Codify reusable business processes as knowhow documents with `tool: true` in YAML frontmatter. Once registered, entries are auto-discovered by downstream agents via `spec load --category` — plan agents pick up design/architecture flows, test agents pick up verification methods, coding agents pick up execution steps.

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

**Tool registration**: Creates knowhow documents in `knowhow/` folder with `tool: true` in YAML frontmatter. Tools are auto-discovered by `spec load` based on category + tool flag.

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
</context>

<execution>

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
- Load existing tool: `maestro spec load --category coding --keyword <name>`
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

- `maestro spec load --category <category> --keyword <keyword>` to confirm loadable
- Display result: title, category, keywords, storage location

</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` does not exist — run `maestro spec init` |
| E002 | warning | Duplicate tool name detected — confirm overwrite/optimize |
| E003 | fatal | category parameter empty — tools must declare applicable category |
</error_codes>

<success_criteria>
- [ ] Tool registered as knowhow document with `tool: true` frontmatter
- [ ] category attribute correctly set
- [ ] keywords auto-extracted (3-5 terms)
- [ ] Loadable via `spec load --category <category>`
- [ ] Long processes use ref mode with knowhow file created
</success_criteria>
