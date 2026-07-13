<!-- session-mode: none -->
# Instruction File Authoring Guide

## Core Principle

**Only write what changes the model's behavior.** If removing a line doesn't change what the model does, delete it.

## Protected Content — NEVER Remove

### P1. Structural Tags

**ALWAYS preserve ALL XML-style tags** (open AND close) in command files. These serve overlay targeting, system parsing, or state machine definition. Never remove tags — only trim content inside them.

Common tags: `<purpose>`, `<context>`, `<execution>`, `<required_reading>`, `<deferred_reading>`, `<success_criteria>`, `<completion>`, `<error_codes>`, `<interview_protocol>`, `<on_complete>`.

Odyssey-specific: `<boundary>`, `<execution_discipline>`, `<self_iteration>`, `<state_machine>`, `<states>`, `<transitions>`, `<actions>`, `<appendix>`, `<next_step_routing>`.

Rule: if it has `<` and `>` wrapping a section — keep it.

### P2. Data Structure Schemas

JSON/NDJSON templates that define write formats:
- typed artifact contracts — keep `_meta`, schema, role, alias, and output path semantics; registration is runtime-owned
- `evidence.ndjson` / `decisions.ndjson` schema definitions
- Any `Append to ...` with field structure

Allowed: JSON code block → bullet-point field list. NOT allowed: compress to one narrative sentence.

### P3. Completion Status Blocks

`--- COMPLETION STATUS ---` blocks enable downstream command chaining. NEVER remove.

### P4. Routing Tables

`success_criteria` → next command mapping tables enable workflow transitions. NEVER remove.

### P5. Cross-File Reference Integrity

When removing content from command file because "workflow file has it":
- VERIFY the workflow file actually contains the referenced content
- If command says "X is defined in Y.md", Y.md MUST have X with matching identifiers
- Missing target = broken reference = FAIL

## Anti-Patterns — Fix These

### 1. Passive Dependency Assumptions

"hooks handle it" / "auto-loaded" → "ALWAYS search before acting."

### 2. Flat Tables With Equal Weight

7 equal triggers → L0 (unconditional) / L1 (conditional) / L2 (deep analysis).

### 3. Implementation Details

"BM25 full-text", "broker-managed lifecycle" → Delete. Model needs WHEN, not HOW.

### 4. Teaching-Style Explanations

"Not X but Y" pedagogy → Show template, drop explanation.

### 5. Duplicate Sections

Same info in summary + steps → Single source. Schemas are reference, NOT duplication of steps.

### 6. Soft Language for Hard Rules

"should" / "recommended" → `ALWAYS` / `NEVER`.

### 7. Verbose Descriptions

Purpose in ≤10 words. Trim `<purpose>` content but keep the tag.

### 8. Phase Gates Without BLOCKED

Every Phase Gate MUST have both `REQUIRED` conditions AND `BLOCKED if missing` consequence. A Gate with only REQUIRED is unenforceable.

### 9. Missing Structural Sections

Commands with `<execution>` logic MUST also have:
- `<completion>` — standalone report + ralph completion + next-step routing table
- `<error_codes>` — error/warning code table with recovery actions
Do NOT embed completion/routing logic inside `<execution>`. Keep them in their own tags.

## Checklist

- [ ] ALL structural tags preserved (P1)
- [ ] ALL data schemas preserved with field-level detail (P2)
- [ ] ALL completion status blocks preserved (P3)
- [ ] ALL routing tables preserved (P4)
- [ ] No line explains HOW a tool works internally
- [ ] No duplicate info across sections
- [ ] Strong constraints use ALWAYS/NEVER
- [ ] High-frequency actions visually prominent (L0 / top of list)
- [ ] Command descriptions ≤10 words
- [ ] No "fallback" framing implying automatic primary path
- [ ] Phase Gates have REQUIRED + BLOCKED pairs
- [ ] Commands with `<execution>` have matching `<completion>` and `<error_codes>`
