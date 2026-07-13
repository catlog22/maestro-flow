---
name: domain-add
description: Register a domain term into project glossary
argument-hint: <canonical> <definition>
allowed-tools: Read, Write, Bash, Glob, Grep
session-mode: none
version: 0.5.50
---

<purpose>
Register a domain term into `.workflow/domain/glossary.yaml`. Domain terms are automatically injected into agent context via hooks (domain-compact for all prompts, domain-expanded on keyword match).

```bash
$domain-add "auth-token" "Short-lived credential for API authentication"
$domain-add "event-bus" "Central pub-sub message broker for cross-module communication"
```

**CLI alternative**: `maestro domain add "<canonical>" "<definition>" --tier core|extended|peripheral`. Used by `maestro run complete` for programmatic domain term extraction from session outputs.
</purpose>

<context>
$ARGUMENTS — `<canonical> <definition>` where canonical is a kebab-case term name.

**Prerequisites**: `.workflow/domain/` must exist (run `maestro domain init` if missing).

**Domain term lifecycle**: discover/manual → register → active → (optional) deprecated → removed

**Output boundary**: ALL file writes MUST target `.workflow/domain/glossary.yaml` only. NEVER modify source code or files outside this path.
</context>

<invariants>
1. **Single-term atomic operation** — each invocation registers exactly ONE term; NEVER batch-write multiple terms in a single execution
2. **Glossary append-only** — existing terms in `glossary.yaml` SHALL NOT be modified or removed; only new entries are appended
3. **Duplicate guard** — MUST check for exact canonical name match AND near-matches before writing; NEVER create duplicate entries
4. **Confirmation mandatory** — MUST present term details (canonical, definition, aliases, tier, path) via `request_user_input` before any glossary write; NEVER write without user confirmation (unless `--yes`)
5. **Schema compliance** — every term entry MUST include canonical name, definition, tier, and at least one alias/keyword; incomplete entries SHALL NOT be persisted
6. **Domain directory prerequisite** — `.workflow/domain/` MUST exist before writing; NEVER auto-create the directory without user confirmation (E002 if missing)
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Validate**
- REQUIRED: Canonical name and definition both parsed and non-empty.
- BLOCKED if: either missing (E001).

**GATE 2: Validate → Dedup Check**
- REQUIRED: `.workflow/domain/glossary.yaml` exists and is readable.
- BLOCKED if: domain directory not initialized (E002).

**GATE 3: Dedup → Register**
- REQUIRED: No exact duplicate found (E003). Near-matches resolved via user confirmation.
- REQUIRED: User confirmed term details (canonical, definition, aliases, tier) via `request_user_input` (unless `--yes`).
- BLOCKED if: user declines confirmation.

### Step 1: Parse Input

Extract canonical (first token, kebab-case) and definition (remainder) from arguments.
- Validate canonical is non-empty, kebab-case (lowercase, hyphens only)
- Validate definition is non-empty, ≤200 chars (E001 if missing)

### Step 2: Validate Domain Directory

Verify `.workflow/domain/glossary.yaml` exists. If missing, ask user to confirm auto-initialization (`maestro domain init`). Proceed on confirmation; abort with E002 if declined. Skip confirmation when `--yes` flag is set.

### Step 3: Check Duplicates

Read existing glossary and check for:
- Exact duplicate (same canonical name) → report existing entry, exit
- Near match (Levenshtein ≤ 2 or alias overlap) → warn, ask to confirm or merge

### Step 4: Extract & Confirm Metadata

Auto-derive from the definition and codebase context:
- **aliases** (1-3): common abbreviations, Chinese translations, alternate forms
- **keywords** (3-5): search terms for discovery
- **tier**: `core` | `extended` | `peripheral`
- **relationships**: scan existing glossary for related terms

Display a preview of all derived metadata and ask user to confirm or edit before proceeding. When `--yes` / `-y` flag is set, skip confirmation and write directly.

### Step 5: Register Term

```bash
maestro domain add "<canonical>" "<definition>" --tier <tier>
maestro domain update "<canonical>" --aliases "alias1,alias2" --keywords "kw1,kw2" --relationships "rel1,rel2"
```

### Step 6: Confirm

Display: canonical name, definition, aliases, tier, relationships, and verify command `maestro domain list`.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | Canonical name and definition are both required |
| E002 | fatal | `.workflow/domain/` not initialized and user declined auto-init |
| E003 | fatal | Term already registered with same canonical name |
</error_codes>

<success_criteria>
- [ ] Canonical name and definition parsed and validated
- [ ] No duplicate term in glossary
- [ ] Aliases and keywords auto-extracted
- [ ] Term written to glossary.yaml with tier and relationships
- [ ] Confirmation displayed with verify command
</success_criteria>
