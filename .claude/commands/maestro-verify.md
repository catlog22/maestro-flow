---
name: maestro-verify
description: Goal-Backward verification with 3-layer must-have checks, anti-pattern scan, Nyquist test coverage validation, and gap-fix plan generation
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
- **Single plan**: `verify --dir scratch/plan-xxx` — verifies one plan, writes `verification.json` into plan dir
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

Flags (`--skip-tests`, `--skip-antipattern`, `--dir`), scope routing, output paths, and VRF artifact registration schema are defined in workflow `verify.md`.
</context>

<execution>
Follow '~/.maestro/workflows/verify.md' completely.

### Post-verify Knowledge Inquiry

After verification completes, evaluate inquiry triggers:

1. **Anti-pattern detection**: If anti-pattern scan found blockers (TODO/FIXME, stubs, empty returns):
   → Ask: "Verification found {N} anti-patterns. Should `quality-rules.md` be updated to enforce these checks? (`/spec-add quality`)"

2. **Constraint violation**: If Goal-Backward check found constraint_violations or missing wiring:
   → Ask: "Verification found architecture constraint violations. Should `architecture-constraints.md` be updated? (`/spec-add arch`)"

3. **Test coverage gaps**: If Nyquist gaps found with recurring pattern (same module/type across tasks):
   → Ask: "Persistent test coverage gap detected in {module}. Should it be added to `test-conventions.md` as a required test area? (`/spec-add test`)"

If user confirms, invoke `Skill({ skill: "spec-add", args: "<category> <content>" })`.

**Next-step routing on completion:**
- All checks pass, no gaps → /quality-review
- Gaps found (must-have failures or anti-pattern blockers) → /maestro-plan --gaps
- Low test coverage (Nyquist gaps) → /quality-test-gen

**Gap-fix closure loop:**
Gaps found → maestro-plan --gaps → maestro-execute → maestro-verify (re-run)
</execution>

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
