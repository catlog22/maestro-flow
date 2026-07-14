---
name: maestro-tools
description: Register or execute reusable tool specs (knowhow documents with tool:true)
argument-hint: "<subcommand> [args...] where subcommand = register|execute"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
session-mode: none
---
<purpose>
Manage reusable business processes codified as knowhow documents with `tool: true` in
`.workflow/knowhow/`. Two subcommands:

- **register** — extract / generate / optimize / promote tool specs.
- **execute** — load a registered tool by name or category and run it step-by-step.
</purpose>

<required_reading>
@~/.maestro/workflows/tools-spec.md
</required_reading>

<context>
$ARGUMENTS — first token selects the subcommand; the rest are subcommand arguments.

| First token | Subcommand | Remaining args |
|-------------|------------|----------------|
| `register` | Register mode | `[<description>] [--extract <path>] [--optimize <name>]` |
| `execute` | Execute mode | `[<tool-name> \| --category <category>] [--list]` |

If the first token is neither `register` nor `execute`, infer intent: presence of `--extract`, `--optimize`, `promote`, `generate`, `extract` → register; a bare tool name / `--category` / empty → execute. When ambiguous, AskUserQuestion which subcommand to run.

**register examples**:
```
/maestro-tools register extract OAuth PKCE token exchange flow from src/auth/
/maestro-tools register generate Stripe webhook idempotency verification
/maestro-tools register optimize e2e-checkout tool
/maestro-tools register promote RCP-db-migration-rollback as test tool
```

**execute examples**:
```
/maestro-tools execute integration-test
/maestro-tools execute --category coding
/maestro-tools execute --category review --keyword api
/maestro-tools execute
```
Empty execute arguments enters interactive mode: list all tools for user selection.
</context>

<invariants>
**register mode**:
1. **Schema validation** — tool knowhow document MUST include `tool: true`, `category`, `keywords`, and `summary` in YAML frontmatter; missing fields → reject write
2. **No duplicate names** — tool title MUST be unique within its category; duplicate detection → E102 warning with overwrite/optimize confirmation
3. **Category required** — every tool MUST declare exactly one category from: coding, test, review, arch, debug; empty category → E103
4. **Confirmation gate** — MUST AskUserQuestion before writing knowhow document and spec ref entry; NEVER persist without user confirmation
5. **Promote is in-place** — promote mode MUST update existing knowhow frontmatter via `maestro wiki update`; NEVER recreate the document
6. **Register output boundary** — ALL file writes MUST target .workflow/knowhow/ (tool documents) and .workflow/specs/ (ref entries via maestro spec add) only. NEVER modify source code or files outside these paths
7. **Description format** — first line after `### Title` MUST state "Use when ..." (usage timing); this is critical for ref entry summary visibility in spec load

**execute mode**:
8. **Confirmation before execution** — MUST AskUserQuestion before executing tool steps; NEVER auto-execute without user consent
9. **Sequential step execution** — steps MUST be executed in defined order; NEVER skip or reorder steps unless user explicitly requests skip
10. **Blocker escalation** — step failure MUST be reported to user with retry/skip/abort options; NEVER silently skip failed steps
11. **Read-only tool definition** — tool execution MUST NOT modify the tool's knowhow document or spec entry; only the target codebase is modified per tool steps
12. **Progress feedback** — each completed step MUST report `[Step N/M] done — <step_name>`; NEVER execute silently
13. **Execute output boundary** — file writes are governed by the individual tool's step definitions. This command itself writes NO files beyond what the loaded tool prescribes
</invariants>

<execution>

> Route on the first token: `register` → `<register_mode>`; `execute` → `<execute_mode>`.

<register_mode>
## Register — extract / generate / optimize / promote

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Gather**
- REQUIRED: Mode determined (extract/generate/optimize/promote) from argument parsing.
- REQUIRED: For optimize/promote modes, target tool/document exists and is loadable.
- BLOCKED if: empty args without user response to AskUserQuestion.

**GATE 2: Gather → Write**
- REQUIRED: Tool name, category, and usage timing confirmed.
- REQUIRED: Steps extracted or generated (extract: ≥1 step, generate: user-confirmed scope).
- REQUIRED: Inline vs ref mode decided based on step count.
- REQUIRED: User confirmed via AskUserQuestion (title, category, keywords, summary, step count).
- BLOCKED if: E101 (.workflow/specs/ not initialized), E103 (no category), user cancels.

**GATE 3: Write → Verify**
- REQUIRED: Knowhow document written with `tool: true` frontmatter (or updated in-place for promote).
- REQUIRED: Spec ref entry registered (if user confirmed).
- BLOCKED if: write failed or spec add returned error.

### Step 1: Intent Detection

Parse the register arguments to determine mode:
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
- Load existing tool: `maestro search "<name>" --type knowhow` → `maestro load --type knowhow --id <id>`
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

**Confirm before writing** — Use `AskUserQuestion` to show the user the planned knowhow document (title, category, keywords, summary, step count) and spec ref entry before persisting:

```
question: "确认写入以下 knowhow 工具文档？"
options:
  - label: "确认写入"
    description: "knowhow: {title} (category: {category}, keywords: {keywords}), spec ref entry"
  - label: "修改后写入"
    description: "调整 title/category/keywords 后重新确认"
  - label: "取消"
    description: "不写入任何文件"
```

User confirms → proceed; user edits → re-gather; user cancels → END.

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

**Optionally register spec ref entry** (after user confirmation above) for index discoverability:
```bash
maestro spec add <category> "<title>" "Use when <timing>. <scope summary>" --keywords "<csv>" \
  --description "<one-line summary>" --ref "knowhow/RCP-<slug>.md" --knowhow-type recipe
```

### Step 6: Verify

- `maestro load --type spec --category <category> --keyword <keyword>` to confirm loadable
- Display result: title, category, keywords, storage location
</register_mode>

<execute_mode>
## Execute — load and run a tool step-by-step

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Load**
- REQUIRED: Tool name, keyword, or --category parsed from arguments (or empty for interactive mode).
- BLOCKED if: invalid category value.

**GATE 2: Load → Confirm**
- REQUIRED: Exactly one tool resolved (direct match or user selection from candidates).
- REQUIRED: Tool document loaded and steps extracted (ref entries expanded via `maestro load --type knowhow`).
- BLOCKED if: E201 (no match found), E202 unresolved (multiple matches without user selection).

**GATE 3: Confirm → Execute**
- REQUIRED: User confirmed execution mode via AskUserQuestion (execute as-is / adjust / view only).
- BLOCKED if: user selects "View only" — display steps and END without execution.

**GATE 4: Execute → Report**
- REQUIRED: All steps attempted (completed, skipped with user approval, or aborted by user).
- REQUIRED: Results collected for each step (success/skip/fail).
- BLOCKED if: user chose abort mid-execution — report partial results and END.

### Step 1: Load Tool

**By name**:
```bash
maestro search "<name>" --type knowhow
```
Match knowhow documents with `tool: true` whose title or keywords contain the name. Load the matched entry with `maestro load --type knowhow --id <id>`.

**By category**:
```bash
maestro load --type spec --category <category>
```
Extract tool entries from the "Available Tools" section in output.

**Empty args**:
Load all categories, collect tool entries, present to user with AskUserQuestion for selection.

### Step 2: Display Tool

Show tool information:
- Name, category, keywords
- Steps overview (for ref entries, expand knowhow detail first)

Expand ref entries:
```bash
maestro load --type knowhow --id <knowhow-id>
```

### Step 3: Confirm Execution

AskUserQuestion (single-select, header: "执行方式"):
- **Execute as-is** (Recommended) — run all steps with current parameters
- **Adjust parameters** — modify scope or parameters before executing
- **View only** — display steps without executing

### Step 4: Step-by-Step Execution

Follow the tool definition steps in order:
1. Read current step description
2. Execute step action (file ops, commands, code changes, etc.)
3. Verify step completion
4. Report progress: `[Step N/M] done — <step_name>`
5. Proceed to next step

**Blocker handling**:
- Step fails → report error, ask user: retry / skip / abort
- Needs user input → AskUserQuestion for parameters
- Prerequisites unmet → show missing items, ask how to proceed

### Step 5: Report Results

After completion, output:
- Completed steps list
- Skipped/failed steps (if any)
- Artifacts produced (generated files, test results, etc.)
- Suggested next actions
</execute_mode>

</execution>

<error_codes>
register mode:

| Code | Severity | Description |
|------|----------|-------------|
| E101 | fatal | `.workflow/specs/` does not exist — run `maestro spec init` |
| E102 | warning | Duplicate tool name detected — confirm overwrite/optimize |
| E103 | fatal | category parameter empty — tools must declare a category |

execute mode:

| Code | Severity | Description |
|------|----------|-------------|
| E201 | fatal | No matching tool found — check name/keyword |
| E202 | warning | Multiple tools match — list options for user selection |
| E203 | warning | Step execution failed — ask user how to proceed |
</error_codes>

<success_criteria>
register mode:
- [ ] Tool registered as knowhow document with `tool: true` frontmatter
- [ ] category correctly set
- [ ] keywords auto-extracted (3-5 terms)
- [ ] Description starts with "Use when ..." (usage timing)
- [ ] Loadable via `spec load --category <category>`
- [ ] Long processes use ref mode with knowhow file created
- [ ] Ref knowhow YAML includes `summary` with usage timing

execute mode:
- [ ] Tool correctly loaded (ref expanded if applicable)
- [ ] User confirmed before execution starts
- [ ] Each step has progress feedback
- [ ] Blockers handled interactively
- [ ] Results reported clearly
</success_criteria>

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Tool registered, want to test | `/maestro-tools execute <name>` |
| Tool for test agents | `/spec load --category test` to verify discovery |
| Tool completed successfully | `/manage status` or continue workflow |
| Need to adjust tool definition | `/maestro-tools register optimize <name>` |
| Want to register another | `/maestro-tools register` |
</completion>
