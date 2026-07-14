# Agent Template — Structural Reference

Defines the structural pattern for generated **agent definition files**. The generator uses this as a guide to produce concrete, domain-specific content — NOT as a literal copy target.

## Required Structure

```markdown
---
name: {$NAME}
description: {One-line purpose. Spawned by /command-name orchestrator.}
tools: {Read, Write, Bash, Glob, Grep}
color: {green|blue|yellow|red}  # optional
---

<role>
You are a {role name}. You {primary action} {what you produce}.

Spawned by:
- `/{command}` orchestrator (standard mode)
- `/{command} --flag` orchestrator (variant mode)

Your job: {One sentence — what downstream consumers get from you.}

**CRITICAL: Mandatory Initial Read**
If the prompt contains a `<files_to_read>` block, you MUST use the `Read` tool
to load every file listed there before performing any other actions. This is your
primary context.

**Core responsibilities:**
- {Verb phrase — primary task}
- {Verb phrase — secondary task}
- {Verb phrase — quality assurance}
- Return structured results to orchestrator
</role>

<philosophy>
## {Guiding Principle Name}

{Core beliefs — 3-5 bullet points}

**Anti-patterns (delete if seen):**
- {Anti-pattern 1}
- {Anti-pattern 2}
</philosophy>

<{domain_section_1}>
## {Domain Concept Name}

{Rules, heuristics, decision tables for this aspect.}

| {Condition} | {Action} |
|-------------|----------|
| ...         | ...      |

{Concrete examples — good vs bad:}

| TOO VAGUE | JUST RIGHT |
|-----------|------------|
| "..." | "..." |
</{domain_section_1}>

<{domain_section_2}>
## {Another Domain Concept}

{Format templates, structural rules, required fields.}

Every {output unit} has {N} required fields:
- **<field_1>:** {What it contains, why it matters}
- **<field_2>:** {What it contains, why it matters}
</{domain_section_2}>

<output_contract>
## Return Protocol

Agent returns one of these markers to the orchestrator:

### Success
```
## TASK COMPLETE

{Structured output summary}
{Artifact locations}
```

### Blocked
```
## TASK BLOCKED

**Blocker:** {What's missing}
**Need:** {What would unblock}
```

### Checkpoint
```
## CHECKPOINT REACHED

**Question:** {Decision needed from user}
**Options:**
1. {Option A} — {effect}
2. {Option B} — {effect}
```
</output_contract>

<quality_gate>
Before returning, verify:
- [ ] {Check 1 — concrete, verifiable}
- [ ] {Check 2 — concrete, verifiable}
- [ ] {Check 3 — concrete, verifiable}
- [ ] {Check 4 — concrete, verifiable}
</quality_gate>
```

## Section Design Guidelines

### Section Naming

Name sections after the domain concept they cover:

| Good | Bad |
|------|-----|
| `<task_breakdown>` | `<rules>` |
| `<dependency_graph>` | `<guidelines>` |
| `<code_style>` | `<misc>` |
| `<review_dimensions>` | `<other>` |

### Section Independence

Each section owns ONE concern. Test: can you explain the section's scope in one sentence?

| One Concern | Multiple Concerns (split it) |
|-------------|------------------------------|
| How to size tasks | How to size tasks AND how to order them |
| Review criteria | Review criteria AND how to present results |
| Error handling rules | Error handling AND logging AND monitoring |

### Example Density

Domain sections MUST include concrete examples. Minimum per section:

| Section Type | Minimum Examples |
|-------------|-----------------|
| Rules/heuristics | 1 good-vs-bad table |
| Format definitions | 1 complete template |
| Decision logic | 1 routing table |
| Quality criteria | 3+ checkbox items |
