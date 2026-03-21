---
name: maestro-verify
description: Goal-Backward verification with 3-layer must-have checks, anti-pattern scan, Nyquist test coverage validation, and gap-fix plan generation
argument-hint: "<phase> [--skip-tests] [--skip-antipattern]"
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
Verify phase execution results through three complementary methods:
1. **Goal-Backward verification** — 3-layer check (Truths → Artifacts → Wiring) that validates goals are actually achieved, not just tasks completed
2. **Anti-pattern scan** — detect stubs, placeholders, TODO/FIXME, empty returns in modified files
3. **Nyquist test coverage validation** — requirement-to-test mapping with gap classification (COVERED/PARTIAL/MISSING)

Core principle: **Task completion ≠ Goal achievement**. A task "create chat component" can be marked complete when the component is a placeholder. This verifier checks that the goal "working chat interface" is actually achieved.

Produces verification.json with must-have checks, gaps, anti-patterns, and fix plans. Optionally produces validation.json with test coverage analysis.
</purpose>

<required_reading>
@~/.maestro/workflows/verify.md
</required_reading>

<deferred_reading>
- [verification.json](~/.maestro/templates/verification.json) — read when generating verification output
- [validation.json](~/.maestro/templates/validation.json) — read when generating validation output
- [index.json](~/.maestro/templates/index.json) — read when updating phase index
</deferred_reading>

<context>
Phase: $ARGUMENTS (required -- phase number or slug)

**Flags:**
- `--skip-tests` -- Skip Nyquist test coverage validation (V2), only run Goal-Backward verification
- `--skip-antipattern` -- Skip anti-pattern scan

Context files resolved from `.workflow/phases/{NN}-{slug}/`:
- index.json (phase metadata, success_criteria, plan, execution results)
- plan.json (task overview)
- .task/TASK-{NNN}.json (task definitions with convergence.criteria)
- .summaries/TASK-{NNN}-summary.md (execution results)
</context>

<execution>
Follow '~/.maestro/workflows/verify.md' completely.

**Next-step routing on completion:**
- All checks pass, no gaps → Skill({ skill: "quality-review", args: "{phase}" })
- Gaps found (must-have failures or anti-pattern blockers) → Skill({ skill: "maestro-plan", args: "{phase} --gaps" })
- Low test coverage (Nyquist gaps) → Skill({ skill: "quality-test-gen", args: "{phase}" })

**Gap-fix closure loop:**
Gaps found → maestro-plan --gaps → maestro-execute → maestro-verify (re-run)
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase argument required | Check arguments format, re-run with correct input |
| E002 | error | Phase directory not found | Check arguments format, re-run with correct input |
| E003 | error | No execution results found (missing summaries) | Check arguments format, re-run with correct input |
| W001 | warning | Test coverage below configured threshold | Review coverage gaps, run quality-test-gen |
| W002 | warning | Anti-pattern blockers found in modified files | Fix anti-pattern blockers before proceeding |
</error_codes>

<success_criteria>
- [ ] Must-haves established (from success_criteria, convergence.criteria, or derived)
- [ ] All truths verified with status and evidence (Layer 1)
- [ ] All artifacts checked at L1 (exists), L2 (substantive), L3 (wired) (Layer 2)
- [ ] All key links verified with evidence (Layer 3)
- [ ] Anti-patterns scanned and categorized (unless skipped)
- [ ] Nyquist test coverage assessed with gap classification (unless skipped)
- [ ] Fix plans generated for identified gaps
- [ ] Human verification items identified
- [ ] verification.json written with complete results
- [ ] validation.json written if test audit ran
- [ ] index.json updated with verification status and timestamps
</success_criteria>
