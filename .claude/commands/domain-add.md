---
name: domain-add
description: Register a domain term into project glossary
argument-hint: "<canonical> \"<definition>\""
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Register a domain term into `.workflow/domain/glossary.yaml`. Domain terms are automatically injected into agent context via hooks (domain-compact for all prompts, domain-expanded on keyword match).
</purpose>

<required_reading>
@~/.maestro/workflows/domain-add.md
</required_reading>

<context>
$ARGUMENTS -- expects `<canonical> "<definition>"`

**Examples:**
```bash
/domain-add auth-token "Short-lived credential for API authentication"
/domain-add event-bus "Central pub-sub message broker for cross-module communication"
/domain-add 会话上下文 "Runtime state container for active workflow session"
```

Domain term lifecycle: discover/manual → register → active → (optional) deprecated → removed.

**Related commands:**
- `maestro domain list` — list all registered terms
- `maestro domain discover` — scan codebase for term candidates
- `maestro domain show <canonical>` — show term details
- `maestro domain deprecate <canonical> --successor <new>` — deprecate a term
</context>

<invariants>
1. **Single-term atomic operation** — each invocation registers exactly ONE term; NEVER batch-write multiple terms in a single execution
2. **Glossary append-only** — existing terms in `glossary.yaml` SHALL NOT be modified or removed; only new entries are appended
3. **Duplicate guard** — MUST check for exact canonical name match AND near-matches before writing; NEVER create duplicate entries
4. **Confirmation mandatory** — MUST present term details (canonical, definition, aliases, tier, path) via AskUserQuestion before any glossary write; NEVER write without user confirmation
5. **Schema compliance** — every term entry MUST include canonical name, definition, tier, and at least one alias/keyword; incomplete entries SHALL NOT be persisted
6. **Domain directory prerequisite** — `.workflow/domain/` MUST exist before writing; NEVER auto-create the directory (E002 if missing)
</invariants>

<execution>
Follow '~/.maestro/workflows/domain-add.md' completely.

**Confirmation gate**: Before writing to glossary.yaml, AskUserQuestion showing the term canonical name, definition, extracted aliases/keywords, tier, and target file path. Proceed only on user confirm.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | Canonical name and definition are both required | parse_input |
| E002 | fatal | `.workflow/domain/` not initialized — run `maestro domain init` first | validate |
| E003 | fatal | Term already registered with same canonical name | duplicate_check |
| E004 | warning | Near-match found — confirm merge or create new | duplicate_check |
</error_codes>

<success_criteria>
- [ ] Canonical name and definition parsed and validated
- [ ] No duplicate term in glossary (or user confirmed near-match)
- [ ] Aliases and keywords auto-extracted from definition
- [ ] Term written to glossary.yaml with tier and relationships
- [ ] Confirmation displayed with term details and verify command
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Verify term added | `maestro domain show <canonical>` |
| Add more terms | `/domain-add <canonical> "<definition>"` |
| Discover candidates | `maestro domain discover` |
| List all terms | `maestro domain list` |
</completion>
