---
name: maestro-tools-register
description: Register tool specs - extract, generate, or optimize
argument-hint: "[<description>] [--extract <path>] [--optimize <name>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---
<purpose>
Codify reusable business processes as knowhow documents with `tool: true` in `.workflow/knowhow/`.
Four modes: Extract, Generate, Optimize, Promote. Short processes inline; long use ref mode.
</purpose>

<required_reading>
@~/.maestro/workflows/tools-spec.md
</required_reading>

<context>
$ARGUMENTS — Intent description

**Examples**:
```
/maestro-tools-register extract OAuth PKCE token exchange flow from src/auth/
/maestro-tools-register generate Stripe webhook idempotency verification
/maestro-tools-register generate E2E checkout flow with payment gateway mock setup
/maestro-tools-register optimize e2e-checkout tool
/maestro-tools-register promote RCP-db-migration-rollback as test tool
/maestro-tools-register promote knowhow-auth-api to coding tool
```
</context>

<execution>

### Step 1: Intent Detection

Parse $ARGUMENTS to determine mode:
- Contains "extract" → extract mode
- Contains "optimize/improve" → optimize mode
- Contains "promote" or references existing knowhow doc (path/ID) → promote mode
- Other → generate mode
- Empty → ask user with AskUserQuestion

### Step 2: Gather Information

**Extract mode**:
- Identify source (current conversation, specified files, codebase scan)
- Extract step sequence, prerequisites, expected outputs

**Generate mode**:
- Confirm tool name, applicable roles, target scenario
- If unclear, ask user with AskUserQuestion

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

### Step 3: Determine Category

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

**Create knowhow tool document** in `.workflow/knowhow/` with `tool: true` in YAML frontmatter:
```yaml
---
title: <Title>
type: recipe
category: <category>
keywords: [<keywords>]
tool: true
summary: "Use when <timing>. <scope description>"
---

## Steps
1. Step one ...
```

**Optionally register spec ref entry** for index discoverability:
```bash
maestro spec add <category> "<title>" "Use when <timing>. <scope summary>" --keywords "<csv>" \
  --description "<one-line summary>" --ref "knowhow/RCP-<slug>.md" --knowhow-type recipe
```

### Step 6: Verify

- `maestro load --type spec --category <category> --keyword <keyword>` to confirm loadable
- Display result: title, category, keywords, storage location

</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` does not exist — run `maestro spec init` |
| E002 | warning | Duplicate tool name detected — confirm overwrite/optimize |
| E003 | fatal | category parameter empty — tools must declare a category |
</error_codes>

<success_criteria>
- [ ] Tool registered as knowhow document with `tool: true` frontmatter
- [ ] category correctly set
- [ ] keywords auto-extracted (3-5 terms)
- [ ] Description starts with "Use when ..." (usage timing)
- [ ] Loadable via `spec load --category <category>`
- [ ] Long processes use ref mode with knowhow file created
- [ ] Ref knowhow YAML includes `summary` with usage timing
</success_criteria>

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Tool registered, want to test | `/maestro-tools-execute <name>` |
| Want to register another | `/maestro-tools-register` |
| Tool for test agents | `/spec-load --category test` to verify discovery |
</completion>
