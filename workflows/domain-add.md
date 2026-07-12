<!-- session-mode: inherited -->
---
name: domain-add
alias: domain-add
---

# Workflow: domain-add

Register a domain term into `.workflow/domain/glossary.yaml`.

## Arguments

```
$ARGUMENTS: "<canonical> <definition>"

canonical -- kebab-case term name (e.g. "auth-token", "event-bus")
definition -- one-line definition (≤200 chars)
```

## Prerequisites

- `.workflow/domain/` directory must exist (run `maestro domain init` if missing)

## Execution Steps

### Step 1: Parse Arguments

```
Parse $ARGUMENTS:
  1. canonical = first token (kebab-case, e.g. "auth-token")
  2. definition = remaining text
Validate:
  - canonical is non-empty, kebab-case (lowercase, hyphens only)
  - definition is non-empty, ≤200 chars
On failure: show usage `domain-add <canonical> "<definition>"`, exit
```

### Step 2: Check Glossary State

Verify `.workflow/domain/glossary.yaml` exists. If not, create via `maestro domain init`.

Read existing glossary and check for:
- **Exact duplicate**: same canonical name already registered → report existing entry, exit
- **Near match**: Levenshtein distance ≤ 2 or alias overlap → warn, ask to confirm or merge

### Step 3: Extract Metadata

Auto-derive from the definition and codebase context:

- **aliases** (1-3): common abbreviations, Chinese translations, or alternate forms the term is known by
- **keywords** (3-5): search terms for discovery
- **tier**: `core` (fundamental project concept) | `extended` (secondary) | `peripheral` (rarely referenced)
- **relationships**: scan existing glossary for related terms (semantic overlap or dependency)

### Step 4: Register Term

Write via `maestro domain add`:

```bash
# MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
maestro domain add "<canonical>" "<definition>" --tier <tier>
```

If aliases or relationships identified, update immediately:

```bash
maestro domain update "<canonical>" --aliases "alias1,alias2" --keywords "kw1,kw2,kw3" --relationships "related-term-1,related-term-2"
```

Records `source.kind = 'manual'`, `source.registered_at = now`.

**GATE Step 4→5**: REQUIRED term written via `maestro domain add` (exit 0); BLOCKED if write failed or term missing from glossary.

### Step 5: Verify Injection

Confirm the term is injectable by checking:

```bash
# MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
maestro domain show "<canonical>"
```

Display: canonical name, definition, aliases, tier, relationships, and verify command:
```
maestro domain list
```

**GATE Step 5→6**: REQUIRED term verified injectable via `maestro domain show`; BLOCKED if not injectable.

### Step 6: Report

```
=== DOMAIN TERM REGISTERED ===
Term:      {canonical}
Definition: {definition}
Aliases:   {alias1, alias2}
Tier:      {tier}
Related:   {rel1, rel2}
Injection: domain-compact (always) + domain-expanded (on keyword match)
Next:      maestro domain list | maestro domain discover (find more candidates)
```

## Auto-Discovery Alternative

For batch registration from codebase scanning:

```bash
maestro domain discover    # scan codebase for term candidates
maestro domain import      # batch import from external source
```

## Domain Term Lifecycle

```
discover/manual → register → active → (optional) deprecated → removed
                                ↑
                          update aliases/keywords/relationships
```

## Output

One domain term entry added to `.workflow/domain/glossary.yaml`.
