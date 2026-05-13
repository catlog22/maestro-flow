---
name: maestro-impeccable
description: Production-grade UI design with knowhow accumulation — 23 commands for build, evaluate, refine, enhance, fix
argument-hint: "<command> [target] [--skip-harvest] [-y]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---
<purpose>
Replaces impeccable as the primary UI design entry point. 23 commands covering the full design lifecycle:
Build (craft, shape, teach, document, extract), Evaluate (critique, audit), Refine (polish, bolder, quieter, distill, harden, onboard),
Enhance (animate, colorize, typeset, layout, delight, overdrive), Fix (clarify, adapt, optimize), Iterate (live).

Core innovation over impeccable: after each command execution, automatically harvests design decisions
into `.workflow/knowhow/` (DCS-, AST-, TIP-, REF-) for cross-session accumulation. Other maestro commands
consume this via `category: coding` auto-injection and keyword matching.
</purpose>

<deferred_reading>
- [impeccable harvest workflow](~/.maestro/workflows/impeccable.md) — read after command execution for harvest logic
</deferred_reading>

<context>
$ARGUMENTS — sub-command + target + optional flags.

**Sub-commands** (23):

| Category | Commands |
|----------|----------|
| Build | craft, shape, teach, document, extract |
| Evaluate | critique, audit |
| Refine | polish, bolder, quieter, distill, harden, onboard |
| Enhance | animate, colorize, typeset, layout, delight, overdrive |
| Fix | clarify, adapt, optimize |
| Iterate | live |

**Flags:**
- `--skip-harvest` — Execute command without knowhow capture
- `-y` — Auto-confirm where the skill allows

**Harvest behavior**: After command completion, the harvest workflow extracts design decisions
and writes knowhow entries. DCS-/AST- types also get spec index entries for discoverability.
`live` command is exempt (too ephemeral). Use `--skip-harvest` to suppress.
</context>

<execution>

## 1. Invoke Skill

```
Skill({ skill: "maestro-impeccable", args: "$ARGUMENTS" })
```

The skill handles: context loading (spec load --category ui, with load-context fallback), register detection (brand/product),
reference file loading, and command execution.

## 2. Harvest

After the skill completes, read `~/.maestro/workflows/impeccable.md` and follow the harvest workflow.

Skip harvest if:
- `--skip-harvest` flag is set
- Sub-command is `live` (interactive, no harvestable output)
- Sub-command is unrecognized

</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | Invalid sub-command (not in 23 valid commands) |
| E002 | error | No intent or target specified |
| W001 | warning | Harvest failed — design knowledge not captured (command still succeeded) |
| W002 | warning | PRODUCT.md missing — skill will auto-trigger teach |
</error_codes>

<success_criteria>
- [ ] Sub-command recognized and routed to maestro-impeccable skill
- [ ] Skill executed with context (spec load --category ui or load-context fallback, register identified)
- [ ] Design changes applied to target files
- [ ] Knowhow entry created in .workflow/knowhow/ (unless --skip-harvest or live)
- [ ] Spec index entry created for DCS-/AST- types
</success_criteria>
