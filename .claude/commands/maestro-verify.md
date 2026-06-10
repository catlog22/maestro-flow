---
name: maestro-verify
description: Use after execution to verify goals are actually achieved with evidence-based structural checks
argument-hint: "[phase] [--skip-tests] [--skip-antipattern] [--dir <path>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Verify execution results through three complementary methods:
1. **Goal-Backward verification** — 3-layer check (Truths → Artifacts → Wiring) that validates goals are actually achieved
2. **Anti-pattern scan** — detect stubs, placeholders, TODO/FIXME, empty returns in modified files
3. **Nyquist test coverage validation** — requirement-to-test mapping with gap classification

Supports dual-level verification:
- **Single plan**: `verify --dir scratch/{YYYYMMDD}-plan-xxx` — verifies one plan, writes `verification.json` into plan dir
- **Milestone**: `verify` (no args) — aggregates all execute artifacts for current milestone into `scratch/{YYYYMMDD}-verify-M{N}-{slug}/milestone-verification.json`

Registers VRF artifact in state.json on completion.
</purpose>

<required_reading>
@~/.maestro/workflows/verify.md
</required_reading>

<deferred_reading>
- [verification.json](~/.maestro/templates/verification.json) — read when generating output
- [validation.json](~/.maestro/templates/validation.json) — read when generating test output
</deferred_reading>

<context>
$ARGUMENTS — phase number or no args for milestone-wide, with optional flags.

### Flags

| Flag | Effect | Default |
|------|--------|---------|
| `--skip-tests` | Skip Nyquist test coverage validation (V2), only run Goal-Backward verification | false |
| `--skip-antipattern` | Skip anti-pattern scan step | false |
| `--dir <path>` | Verify a single plan directory instead of milestone-wide | — (milestone mode) |

**Scope routing:**
| Input | Scope | Resolution |
|-------|-------|------------|
| `--dir scratch/{dir}` | single plan | Verify one plan, write verification.json into plan dir |
| numeric arg | phase | Verify all execute artifacts for that phase |
| no args | milestone | Aggregate all execute artifacts for current milestone |

Output paths and VRF artifact registration schema are defined in workflow `verify.md`.

### Pre-load context (before verification)

1. **Codebase docs**: If `.workflow/codebase/` exists, read `ARCHITECTURE.md` for expected module wiring and `FEATURES.md` for component mapping. Use in Layer 3 (Connection) checks.
2. **Review specs**: Run `maestro spec load --category review` to load review standards. Use as quality baseline for anti-pattern scan and constraint checks.
3. **Wiki constraints**: Run `maestro search "architecture constraint" --json 2>/dev/null`. If results found, include documented invariants as additional truth checks in Layer 1.
4. **Role Knowledge**:
   - Browse: `maestro search --category review`
   - Load task-relevant entries: `maestro wiki load <id1> [id2...]`
5. All are optional — proceed without if unavailable.
</context>

<execution>
Follow '~/.maestro/workflows/verify.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Setup → Verification** (Pre-load → V1)
- REQUIRED: Must-haves established from convergence.criteria in task definitions.
- REQUIRED: At least one executed plan found with `.summaries/` directory.
- BLOCKED if no executed plans: error E001 — run maestro-execute first.

**GATE 2: V1 → V2** (Goal-Backward → Anti-Pattern Scan)
- REQUIRED: All truths verified with status and evidence (Layer 1: Existence).
- REQUIRED: All artifacts checked at L1/L2/L3 (Layer 2: Substance + Wiring).
- REQUIRED: All key links verified with evidence (Layer 3: Connection).
- Do NOT skip layers or mark as "assumed pass" without evidence.
- BLOCKED if any layer incomplete: complete verification before scanning.

**GATE 3: V2 → Report** (Scan → Output)
- REQUIRED: Anti-pattern scan completed (unless --skip-antipattern).
- REQUIRED: Nyquist test coverage assessed (unless --skip-tests).
- REQUIRED: `verification.json` written with per-layer results and evidence.
- BLOCKED if missing: produce verification output before reporting.

### Evidence Requirement

Every truth/artifact/link verdict MUST include concrete evidence:
- Valid evidence: file exists + content grep match, test passes, import chain verified
- INVALID: "Assumed working based on code reading" without structural check
- Each FAIL verdict MUST include: what was expected, what was found, suggested fix

### Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  "verification.json"    // Per-layer results, evidence, gaps, fix plans
]
```
If missing: DO NOT report completion.

### Post-verify Knowledge Inquiry

| Condition | Ask | Route |
|-----------|-----|-------|
| Anti-pattern blockers found (TODO/FIXME/stubs) | "Update quality-rules.md?" | spec-add quality |
| Architecture constraint violations | "Update architecture-constraints.md?" | spec-add arch |
| Recurring test coverage gap (same module across tasks) | "Add to test-conventions.md?" | spec-add test |

On confirm → `Skill("spec-add", "<category> <content> --description \"<summary>\"")`.

</execution>

<completion>
### Standalone report

```
=== VERIFY COMPLETE ===
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY
CONCERNS: {description if applicable}
NEXT: /quality-review
=== END VERIFY ===
```

Status mapping:
- **DONE** — All checks pass, no gaps → NEXT: /quality-review
- **DONE_WITH_CONCERNS** — Gaps found (must-have failures or anti-pattern blockers) → NEXT: /maestro-execute (after /maestro-plan --gaps)
- **NEEDS_RETRY** — Verification could not complete (missing artifacts, corrupt data)

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| All checks pass, no gaps | `/quality-review` |
| Gaps found (must-have failures or anti-pattern blockers) | `/maestro-plan --gaps` |
| Low test coverage (Nyquist gaps) | `/quality-auto-test` |

**Gap-fix closure loop:**
Gaps found → maestro-plan --gaps → maestro-execute → maestro-verify (re-run)
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No executed plans found for verification | Run maestro-execute first |
| E002 | error | Plan directory not found | Check --dir path |
| E003 | error | No execution results found (missing summaries) | Run maestro-execute first |
| W001 | warning | Test coverage below configured threshold | Review coverage gaps |
| W002 | warning | Anti-pattern blockers found in modified files | Fix blockers before proceeding |
</error_codes>

<success_criteria>
- [ ] Must-haves established (from convergence.criteria in tasks)
- [ ] All truths verified with status and evidence (Layer 1)
- [ ] All artifacts checked at L1 (exists), L2 (substantive), L3 (wired) (Layer 2)
- [ ] All key links verified with evidence (Layer 3)
- [ ] Anti-patterns scanned and categorized (unless skipped)
- [ ] Nyquist test coverage assessed (unless skipped)
- [ ] Fix plans generated for identified gaps
- [ ] verification.json written to plan dir (single plan) or milestone verify dir
- [ ] VRF artifact registered in state.json
</success_criteria>
