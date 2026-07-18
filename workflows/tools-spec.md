<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Tool Spec Reference

## Storage

Path: `.workflow/knowhow/` with `tool: true` in YAML frontmatter.

## Entry Format

Knowhow document (`knowhow/RCP-<slug>.md`):
```yaml
---
title: Tool Name
type: recipe
tool: true
summary: "Use when {timing}. {scope description}"
tags: [keyword1, keyword2]
category: coding
---

## Prerequisites
...

## Steps
1. ...
```

## Description Rules

- First line after `### Title` must state **when to use** this tool
- For ref entries: `maestro-spec load` shows only the first 200 chars after heading — timing must be in that window
- For ref knowhow docs: YAML `summary` field is shown by `wiki list` and wiki-role-loader hook

## Discovery Path

```
Register (knowhow/ + tool: true) → maestro-spec load --category / spec-injector auto-inject → agent discovers tool
```

Agents discover tool specs via:
- `maestro-spec load --category <category>` — scans knowhow/ for `category + tool: true` matches
- `spec-injector` hook — auto-injects at Agent launch based on agent type → category mapping
- `maestro-spec load --keyword <word>` — keyword search across all entries (cross-category)

## Category Reference

`category` = **who consumes** (agent type), not what the content is about.

| Category | Consumer Agent | Decision Question | Signal Words |
|---|---|---|---|
| coding | code-developer, workflow-executor | 开发者实现时需要？ | build, deploy, integrate, configure, api-contract |
| test | tdd-developer, test-fix-agent | 测试者验证时需要？ | verify, validate, e2e, regression, idempotency |
| review | workflow-reviewer | 审查者检查时需要？ | audit, checklist, compliance, quality-gate |
| arch | workflow-planner | 规划者设计时需要？ | design, architecture, decompose, blueprint |
| debug | debug-explore-agent | 调试者排查时需要？ | diagnose, trace, root-cause, reproduce |

**Multi-consumer**: If tool serves multiple agents, split into separate docs with different categories.

## CLI Commands

```bash
# Register new tool as knowhow document
maestro knowhow add "knowhow/RCP-<slug>.md" --type recipe --tool

# Promote existing knowhow to tool (in place)
maestro wiki update <id> --frontmatter '{"tool": true, "category": "<cat>", "summary": "..."}'

# Load specs by category
maestro spec load --category <category>
maestro spec load --category <category> --keyword <word>
```
