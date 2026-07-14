
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。
# Conversion Specification

Rules for restyling existing command/agent files to GSD conventions. **Zero content loss is mandatory.**

## Core Principle

Conversion = structural transformation, NOT content rewriting. Every line of source content must appear in the output. Only the container (XML tags, section ordering, frontmatter format) changes.

## Content Loss Prevention Protocol

### Pre-conversion Inventory

Before converting, count:
- `$SRC_LINES` — total non-empty lines
- `$SRC_BLOCKS` — code block count (``` pairs)
- `$SRC_TABLES` — table count (lines starting with `|`)
- `$SRC_SECTIONS` — section count (## headers)

### Post-conversion Verification

| Metric | Rule | Action on Fail |
|--------|------|----------------|
| Lines | output >= source × 0.95 | STOP — find missing content |
| Code blocks | output >= source | STOP — find missing blocks |
| Tables | output >= source | STOP — find missing tables |
| Sections | output >= source | WARN — sections may have merged |

### Diff Display

After conversion, show summary:
```
Conversion Summary:
  Source: {path} ({src_lines} lines, {src_blocks} code blocks)
  Output: {path} ({out_lines} lines, {out_blocks} code blocks)
  Delta:  {+/-} lines, {+/-} code blocks
  New sections added: {list of TODO sections}
```

## Artifact Type Detection

Before applying conversion rules, determine the source type:

| Source Location | Type |
|----------------|------|
| `.claude/commands/**/*.md` | command |
| `.claude/skills/*/SKILL.md` | skill |
| `.claude/agents/*.md` | agent |

**Skill detection signals**: `allowed-tools:` in frontmatter, located in `.claude/skills/` directory, progressive phase loading pattern (`Read("phases/...")`)

## Skill Conversion Rules

### Critical: No @ References

Skills are loaded progressively inline. The canonical Run lifecycle is a permitted shared `@` dependency; phase and domain references remain progressive.

### Source Pattern → Target Pattern (Skill)

| Source Style | Target Style |
|-------------|-------------|
| `# Title` + flat markdown overview | `<purpose>` (2-3 sentences) |
| `## Implementation` / `## Execution Flow` / `## Phase Summary` | `<process>` with numbered `## N.` steps |
| Phase file references as prose | `Read("phases/...")` calls within process steps |
| `## Success Criteria` / `## Coordinator Checklist` | `<success_criteria>` with checkbox list |
| `## Auto Mode` / `## Auto Mode Defaults` | `<auto_mode>` section |
| `## Error Handling` | Preserve as-is within `<process>` or as standalone section |
| Code blocks, tables, ASCII diagrams | **Preserve exactly** |

### What NOT to Add (Skill-Specific)

| Element | Why NOT |
|---------|---------|
| `<required_reading>` | Canonical Run lifecycle only; other context uses progressive loading |
| `@specs/...` or `@phases/...` | Not allowed; read phase/domain files on demand |
| `<offer_next>` | Skills chain via `Skill()` calls, not offer menus |

### What to ADD (Skill-Specific)

| Missing Element | Add |
|----------------|-----|
| `<purpose>` | Extract from overview/description |
| `<process>` wrapper | Wrap implementation steps |
| `<success_criteria>` | Generate from coordinator checklist or existing content |
| `<auto_mode>` | If auto mode behavior exists, wrap in tag |

### Frontmatter Conversion (Skill)

| Source Field | Target Field | Transformation |
|-------------|-------------|----------------|
| `name` | `name` | Keep as-is |
| `description` | `description` | Keep as-is |
| `allowed-tools` | `allowed-tools` | Keep as-is |
| Missing `allowed-tools` | `allowed-tools` | Infer from content |

## Command Conversion Rules

### Source Pattern → Target Pattern

| Source Style | Target Style |
|-------------|-------------|
| `# Title` + `## Phase N:` flat markdown | `<purpose>` + `<process>` with numbered `## N.` steps |
| `## Implementation` + `### Phase N` | `<process>` with numbered steps, content preserved |
| `## Overview` / `## Core Principle` | `<purpose>` (merge into 2-3 sentences) + keep details in steps |
| `## Usage` with examples | Keep as-is inside `<process>` step 1 or before `<process>` |
| `## Auto Mode` / `## Auto Mode Defaults` | `<auto_mode>` section |
| `## Quick Reference` | Preserve as-is within appropriate section |
| Inline `request_user_input` calls | Preserve verbatim — these belong in commands |
| `spawn_agent()` / agent spawning calls | Convert per Agent Dispatch Conversion rules below |
| Banner displays (`━━━`) | Preserve verbatim |
| Code blocks (```bash, ```javascript, etc.) | **Preserve exactly** — never modify code content |
| Tables | **Preserve exactly** — never reformat table content |

### Frontmatter Conversion

| Source Field | Target Field | Transformation |
|-------------|-------------|----------------|
| `name` | `name` | Keep as-is |
| `description` | `description` | Keep as-is |
| `argument-hint` | `argument-hint` | Keep as-is |
| `allowed-tools` | `allowed-tools` | Keep as-is |
| Missing `allowed-tools` | `allowed-tools` | Infer from content (Read, Write, etc.) |

### Section Wrapping

Content that was under plain `##` headers gets wrapped in XML tags:

```
## Overview / ## Core Principle  → content moves to <purpose>
## Process / ## Implementation  → content moves to <process>
## Success Criteria             → content moves to <success_criteria>
## Error Codes                  → preserve as-is (optional section)
```

**Everything else**: Wrap in appropriate GSD tag or keep as custom section inside `<process>`.

### What to ADD (with TODO markers)

| Missing Element | Add |
|----------------|-----|
| `<purpose>` | Extract from overview/description, mark `<!-- TODO: refine -->` if uncertain |
| `<success_criteria>` | Generate from existing content, mark `<!-- TODO: verify -->` |
| `<offer_next>` | Add skeleton with `<!-- TODO: fill next commands -->` |
| Banners | Add before major transitions if missing |

## Agent Dispatch Conversion

> **Canonical V2 API reference**: `.codex/multi-agents-v2-schema.md` — 见 `## 调用模板` section 获取 copy-paste-ready 模板和字段契约。

When converting Claude commands/skills to Codex, all agent dispatch calls must be rewritten to V2 `spawn_agent()` protocol:

### Claude Agent() → Codex spawn_agent()

| Claude (source) | Codex V2 (target) |
|-----------------|-------------------|
| `Agent({ subagent_type: "X", prompt: "..." })` | `spawn_agent({ task_name: "X", message: "...", agent_type: "X" })` |
| `Agent({ subagent_type: "X", description: "D", prompt: "..." })` | `spawn_agent({ task_name: "X", message: "...", fork_turns: "none", agent_type: "X" })` |
| `SendMessage({ to: "X", message: "..." })` | `send_message({ target: "X", message: "..." })` |
| Waiting for task-notification | `wait_agent({ timeout_ms: 3600000 })` |
| `AskUserQuestion(...)` | `request_user_input(...)` |

### Field Mapping

| Claude field | V2 field | Notes |
|-------------|----------|-------|
| `subagent_type` | `agent_type` | **MUST map** — without this the spawned agent runs without its system prompt |
| `prompt` | `message` | Rename only |
| `description` | *(drop or use as task_name suffix)* | V2 has no description field |
| `name` | `task_name` | V2 uses task_name for addressing |
| `run_in_background` | *(drop)* | V2 agents are async by default; use `wait_agent()` to block |

### agent_type Resolution

1. Check `.codex/agents/*.toml` for matching `name` field (underscore form of the agent name)
2. Claude `subagent_type: "ralph-executor"` → Codex `agent_type: "ralph_executor"` (hyphen → underscore)
3. Claude `subagent_type: "team-worker"` → Codex `agent_type: "team_worker"`
4. If no matching `.toml` exists → omit `agent_type` (default agent) and add `<!-- TODO: create agent definition -->`
5. If source `Agent()` has no `subagent_type` (generic agent) → omit `agent_type`（不是遗漏，是设计决策；Claude 原版用 `// generic agent` 注释标注）

### Existing spawn_agent() Calls

If source already contains `spawn_agent()` calls (pre-converted or Codex-native):
- Verify `agent_type` is present when a specialized agent is intended
- Fix `subagent_type` → `agent_type` if the wrong field name was used
- Preserve all other fields verbatim

## Agent Conversion Rules

### Source Pattern → Target Pattern

| Source Style | Target Style |
|-------------|-------------|
| Plain prose role description | `<role>` with structured format |
| `## Core Philosophy` / `## Principles` | `<philosophy>` |
| `## Execution Process` / `## How to` | Domain section with descriptive name |
| `## Quality Gates` / `## Standards` | `<quality_gate>` with checkbox format |
| Flat numbered list of responsibilities | `<role>` core responsibilities bullet list |
| `## Examples` section | Move examples INTO relevant domain sections |

### Frontmatter Conversion

| Source Field | Target Field | Transformation |
|-------------|-------------|----------------|
| `name` | `name` | Keep as-is |
| `description` | `description` | Append "Spawned by /command orchestrator." if missing |
| `color` | `color` | Keep as-is |
| Missing `tools` | `tools` | Infer from content (Read, Write, Bash, etc.) |

### Section Restructuring

1. **`<role>` MUST be first** — gather identity content from wherever it appears
2. **Add "Spawned by:"** if missing — infer from description or mark `<!-- TODO: specify spawner -->`
3. **Add "Mandatory Initial Read"** block if missing
4. **Rename generic sections**: `<rules>` → descriptive name based on content
5. **Add `<output_contract>`** if missing — with TODO marker
6. **Add `<quality_gate>`** if missing — with TODO marker

### What NOT to Change

- Code blocks inside sections — preserve exactly
- Tables — preserve exactly
- Concrete examples (good/bad comparisons) — preserve exactly
- Shell commands — preserve exactly
- Agent prompts — preserve exactly
- Domain-specific terminology — preserve exactly

## Batch Conversion

For converting multiple files:

```bash
# List candidates
ls .claude/commands/**/*.md .claude/agents/*.md

# Convert one at a time, verify each
/prompt-generator convert .claude/commands/issue/new.md
/prompt-generator convert .claude/agents/universal-executor.md
```

## Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|-------------|----------------|
| Rewriting code blocks | Content loss — code is sacred |
| Summarizing verbose sections | Content loss — preserve verbatim |
| Removing "redundant" content | User may depend on it |
| Merging sections without inventory | May lose content silently |
| Adding content beyond structural tags | Conversion adds structure, not content |
| Skipping post-conversion line count | Cannot verify zero content loss |
