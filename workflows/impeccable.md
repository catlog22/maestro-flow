<!-- session-mode: inherited -->
# Impeccable Harvest Workflow

> **Note**: Post-harvest hook, distinct from `/maestro-impeccable` command. This file is the harvest workflow invoked AFTER an impeccable run; it is not the impeccable command entry itself (see `chainMap['impeccable_*']` in `maestro.md`).

Post-execution knowledge capture for maestro-impeccable commands. Extracts design decisions and persists to `.workflow/knowhow/` + `specs/`.

---

## Pre-check

- If `--skip-harvest` → STOP, return
- If sub-command is `live` → STOP, return (interactive, no harvestable output)
- If `.workflow/knowhow/` does not exist → create it

---

## Step 1: Determine Harvest Type

Map sub-command to knowhow type:

| Command | Type | Prefix | Source |
|---------|------|--------|--------|
| craft | decision + asset | DCS- + AST- | Conversation (design decisions + tokens) |
| shape | decision | DCS- | Conversation (design brief decisions) |
| teach | reference | REF- | PRODUCT.md (read brand/user/principles) |
| document | asset | AST- | DESIGN.md YAML frontmatter (token system) |
| extract | asset | AST- | Conversation (extracted patterns) |
| critique | tip | TIP- | .impeccable/critique/ (latest snapshot) OR conversation |
| audit | tip | TIP- | Conversation (5-dimension scores) |
| polish | tip | TIP- | Conversation (polish points) |
| bolder | decision | DCS- | Conversation (amplification decisions) |
| quieter | decision | DCS- | Conversation (reduction decisions) |
| distill | decision | DCS- | Conversation (simplification decisions) |
| harden | tip | TIP- | Conversation (hardening patterns) |
| onboard | tip | TIP- | Conversation (onboarding patterns) |
| animate | decision | DCS- | Conversation (animation strategy) |
| colorize | decision | DCS- | Conversation (color strategy + OKLCH) |
| typeset | decision | DCS- | Conversation (typography decisions) |
| layout | decision | DCS- | Conversation (layout/spacing decisions) |
| delight | decision | DCS- | Conversation (personality decisions) |
| overdrive | decision | DCS- | Conversation (creative decisions) |
| clarify | tip | TIP- | Conversation (copy improvements) |
| adapt | tip | TIP- | Conversation (responsive decisions) |
| optimize | tip | TIP- | Conversation (performance fixes) |

---

## Step 2: Extract Content

### File-source commands

**teach**: Read `PRODUCT.md` at project root. Extract: register, users, brand personality, anti-references, design principles. Summarize as reference.

**document**: Read `DESIGN.md` at project root. Parse YAML frontmatter for color tokens, typography scale, spacing, components. If `.impeccable/design.json` exists, read it for extended metadata.

**critique**: Check `.impeccable/critique/` for latest snapshot matching the target slug. If found, read score + findings. Otherwise extract from conversation.

### Conversation-source commands (all others)

Summarize from the conversation context that is available after Skill() returns:
- **What decisions were made** (color strategy, font choice, spacing system, etc.)
- **What values were chosen** (OKLCH values, scale ratios, timing curves, etc.)
- **Why** (rationale, constraints, user requirements)

Keep concise: 5-15 bullet points maximum. Capture decisions, not process.

---

## Step 3: Write Knowhow Entry

### For DCS- (decision), TIP- (tip), REF- (reference)

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: use `store_knowhow` MCP tool:

```json
{
  "operation": "add",
  "type": "<decision|tip|reference>",
  "title": "maestro-impeccable <command>: <concise description>",
  "description": "<one-line summary for search results>",
  "body": "<markdown content from Step 2>",
  "tags": ["impeccable", "<command>", "<category>", ...domain keywords]
}
```

**Body structure** for decision type:
```markdown
## Context
maestro-impeccable {command} on {target}

## Decisions
- {key decision 1}: {value/choice}
- {key decision 2}: {value/choice}
- ...

## Rationale
{why these choices were made}

## Source
/maestro-impeccable {command} {target}
```

**Body structure** for tip type:
```markdown
## Summary
{command} on {target}: {one-line outcome}

## Key Points
- {finding/fix 1}
- {finding/fix 2}
- ...

## Source
/maestro-impeccable {command} {target}
```

### For AST- (asset)

Write directly to `.workflow/knowhow/AST-impeccable-<slug>-<YYYYMMDD>.md`:

```yaml
---
title: "maestro-impeccable <command>: <description>"
type: asset
assetType: <design-tokens|component-patterns|design-system>
category: ui
keywords: [impeccable, <command>, ...domain keywords]
codePaths: [<files modified by command>]
created: "<ISO-8601>"
tags: [impeccable, <command>]
---
```

Body: structured design token data or pattern descriptions extracted in Step 2.

### For craft (dual entry)

Create both:
1. DCS- via store_knowhow (design decisions)
2. AST- via Write (concrete tokens/patterns committed)

---

## Step 4: Create Spec Index (DCS- and AST- only)

For decision and asset entries, create a spec reference for discoverability:

```bash
# MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
maestro spec add ui "<title>" "<one-line summary>" \
  --keywords impeccable,<command>,<domain keywords> \
  --ref "knowhow/<filename>"
```

Skip for TIP- and REF- types (too lightweight for spec indexing).

---

## Step 5: Report

Output one-line harvest summary:

```
收割: <type> <knowhow-id> — <title>
查看: maestro wiki load <id>
```

If harvest fails, emit W001 and continue (command execution already succeeded); flag harvest as [LOW CONFIDENCE] (harvest failed).
