---
name: verify
description: Independently verify current-execution's requirement coverage, behavioral correctness, and anti-pattern risk against current-plan
argument-hint: "[scope] [--strict] [--skip-tests] [--skip-antipattern]"
contract:
  consumes:
    - { kind: plan, alias: current-plan, required: true }
    - { kind: execution, alias: current-execution, required: true }
  produces:
    - { path: outputs/verification.json, kind: verification, alias: latest-verification, role: primary }
    - { path: outputs/requirement-coverage.json, kind: requirement-coverage, role: evidence }
    - { path: outputs/antipattern-report.json, kind: antipattern-report, role: evidence }
refs:
  - { path: ref/finish-work.md, when: Wrapping up and archiving the verification }
gates: []
---

# Pre-task thinking: verify

verify is the iron-gate of an independent run; the output is a verification conclusion where "every criterion has an objective pass/fail/blocked + evidence," not "it looks fine." Establish verification discipline before you start.

## Iron law: no conclusion without fresh evidence

Before any "pass/done" declaration: IDENTIFY (which command proves it) → RUN (run it live this round, never cite historical results) → READ (read the full output, check the exit code, count failures) → VERIFY (does the output truly support the claim) → only then conclude and inline the evidence.

Forbidden phrasings: `should run now` / `probably passes` / `looks right` / `I'm confident` / `based on my review this is done` — all replaced with evidence: `Tests pass: 42/42 green (exit 0)` / `All 5 truths VERIFIED, with file:line`.

## Goal-shaping questions

- The verification sources are the two typed artifacts `current-plan` and `current-execution`, with their paths injected by create — extract criteria/requirements from plan, implementation scope from execution/change-manifest.
- `--strict`: raise the judgment bar; UNCERTAIN does not pass; boundary/error paths must be explicitly verified.
- `--skip-tests`: skip Nyquist test coverage, do only goal-backward structural verification.
- `--skip-antipattern`: skip the anti-pattern scan.
- This run **reads source only** by default — gaps found are not fixed here; fixing belongs to the plan→execute loop.

## Red-flag thinking — stop the moment one appears and run verification first

The moment you catch any of these thoughts, stop, run the verification command and read the output before reporting:

- "The code I just wrote surely runs"
- "The change is too small to break"
- "I already verified this earlier"
- "It was tested before, so it'll pass now"
- "You can tell it's correct just by reading the code"
- "Mark it done and move on first"

Table of invalid reasons: a one-line change most easily buries an insidious bug; once the code changes, historical results are stale; reading ≠ running; build success ≠ functional correctness; happy path passing ≠ boundary/error path passing; an agent's self-report is a claim, not evidence.

## Risk checklist

- Does every criterion have a method + status + evidence? method is one of test/grep/review/manual; "close enough" is forbidden.
- Did you reuse execute's self-check as the final conclusion? self-check can only be supporting evidence; the final verdict must be independently recomputed this run.
- Did you check all three layers of existence/substance/wiring? Expected file exists (L1), has real implementation not a stub (L2), is imported and used not an orphan (L3).
- Is the anti-pattern scan complete? TODO/FIXME/HACK, placeholder, empty returns, log-only functions, hardcoded test data, disabled tests.
- Is regression risk covered? Are the changed files' direct importers affected, are existing tests still green?
- Does coverage have a silent omission? Every requirement must be explicitly marked covered/partial/uncovered; missing one means verification is incomplete.

## Upstream reading suggestions

- `current-plan`: success_criteria is the primary contract (each is a testable truth), convergence.criteria is the per-task basis — verify both item by item.
- `current-execution` + change-manifest: take the implementation scope and changed-files list as the target surface for verification scanning.
- Review specs (review category): `maestro load --type spec --category review` as quality standards; when it contains tech-stack constraints, do a constraint-compliance pre-check first.
- UAT human findings (if any): merge into gaps, marked `human_verified_failure`.

## Gate selection suggestions (inline judgment, not a separate gates.json)

- All criteria verified, all failures have an actionable gap, coverage has no silent omission, and the verdict is consistent with the item-by-item results — all four together allow complete.
- verdict mapping: pass → all VERIFIED with no blocker; warn → only medium/low gaps; fail/blocked → has a critical gap or a key path unverified.
