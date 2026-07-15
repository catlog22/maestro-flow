---
name: odyssey-review
description: "Odyssey review mode — multi-dimensional deep code review through archaeology, exploration, 4-dimension audit, exhaustive severity-tiered fix, and zero-residual confirmation, producing review findings with full evidence trail"
argument-hint: "<target: file|dir|HEAD|staged|phase#|PR#> [--skip-fix] [--skip-generalize] [-y] [-c]"
contract:
  consumes:
    - { kind: session, alias: prior-session, required: false }
  produces:
    - { path: outputs/session.json, kind: session, alias: review-session, role: primary }
    - { path: outputs/evidence.ndjson, kind: evidence, alias: review-evidence, role: evidence }
    - { path: outputs/explore.json, kind: exploration, alias: review-explore, role: evidence }
    - { path: outputs/understanding.md, kind: review-report, alias: review-understanding, role: primary }
  gates:
    exit: [discovery-complete, all-dimensions-reviewed, zero-remaining]
refs:
  - { path: ref/cli-supplementary.md, when: CLI supplementary evidence collection is needed }
  - { path: ref/finish-work.md, when: Entering the RECORD phase for wrap-up }
---

# Pre-task Thinking: odyssey-review

## Purpose

Odyssey review is a full-lifecycle code review cycle: target intake → archaeology → code exploration → multi-dimensional review audit → exhaustive severity-tiered fix → zero-residual confirmation → generalization → discovery → knowledge persistence. Unlike standalone code review (which produces only findings), odyssey-review carries through to fix ALL findings by severity, confirm zero residual, generalize patterns project-wide, and persist learnings.

## Input Interpretation

Entry modes:

| Mode | Trigger | Target source |
|------|---------|---------------|
| file/dir | file or directory path in `<intent>` | Review those files directly |
| diff | `HEAD` or `staged` in `<intent>` | `git diff HEAD` or `git diff --staged` |
| phase | phase number in `<intent>` | state.json → changed files for that phase |
| PR | PR number in `<intent>` | `git diff main...HEAD` |
| continuation | `-c` | Resume via latest session, jump to `current_state` |

Target resolution table:

| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | state.json → changed files |
| PR number | `git diff main...HEAD` |

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → module boundaries, ownership
- Wiki: `maestro search "<target keywords>" --json` → prior reviews and known patterns
- Specs: `maestro load --type spec --category review` → known review standards and recurring patterns
- Coding specs: `maestro load --type spec --category coding` → patterns relevant to the review area
- Role knowledge: `maestro search --category review` → pick relevant items → `maestro load --type knowhow --id`

When prior review artifacts of the same scope exist, check their findings first to avoid re-reviewing already-addressed patterns.

## Boundaries and Invariants

- **State chain:** `S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → [back-half]`
- **Zero-residual applies** — fix ALL findings within fix_threshold (default: all severity levels). No partial-tier advancement.
- **Evidence is append-only** — never delete or overwrite evidence.ndjson entries; each entry is an immutable observation.
- **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
- **4-dimension mandatory** — all dimensions (correctness, security, performance, architecture) must be reviewed. Zero dimensions reviewed is BLOCKED.
- **Exhaustive fix by severity** — descend through [critical, high, medium, low], each tier fully addressed before advancing. Blanket "pre-existing" classification forbidden; each finding must be individually assessed.
- **max_fix_rounds = 5** — hard limit on fix retry rounds. After 5 rounds with remaining > 0, escalate to user or classify as deferred.
- **Generalize is mandatory** unless `skip_generalize == true`; prior-phase convergence is NOT a valid skip reason.
- **Fix scope:** source code modifications during fix phase are in-scope but MUST be committed per tier. Session artifacts target `{run_dir}/outputs/` only.
- **In scope:** Multi-dimensional deep review → exhaustive fix → generalize. **Out of scope:** Root cause debug → `--mode debug` | Feature implementation → `--mode planex` | UI visual optimization → `--mode ui`.

## Risk Checklist

- Are all 4 review dimensions (correctness, security, performance, architecture) covered? Missing a dimension leaves an entire class of findings undetected.
- Is every finding backed by file, line, and description evidence? Vague findings without location are not actionable.
- Did you descend severity tiers in order (critical → high → medium → low)? Skipping tiers leaves high-severity issues unfixed.
- Is every finding in a tier either fixed or individually classified with a reason? Blanket "pre-existing" skips are forbidden.
- Have fix rounds exceeded 5? Stop and escalate — do not continue fixing indefinitely.
- Are archaeology/explore results properly logged even on partial failure (W003/W006)? Missing evidence must be flagged, not silently omitted.
- Is every discovery hit individually classified with a reason? Blanket skips are forbidden.
- Are all 3 generalization layers (syntax/semantic/structural) attempted? A single-layer quick grep does NOT satisfy the thoroughness floor.
- Did the zero-residual confirmation actually re-review modified areas? A pass-through without re-review does not satisfy the CONFIRM gate.

## Gate Intent

- `discovery-complete`: archaeology and/or exploration phases have logged evidence, understanding.md §2-§3 are updated, and explore goal (G2) is marked. Archaeology partial results via W003 are acceptable; explore skip via W006 is acceptable if no CLI tools are available.
- `all-dimensions-reviewed`: all 4 dimension agents (correctness, security, performance, architecture) have completed, findings are merged into review_result with severity classification, evidence phase=review is logged, and understanding.md §4 severity matrix is written. G1 is marked. Zero dimensions reviewed is BLOCKED (W002 partial with at least 1 dimension is allowed).
- `zero-remaining`: exhaustive fix has been applied tier-by-tier, `remaining_actionable == 0` (or all remaining individually classified as deferred after 5-round escalation), tests pass, CLI re-review confirms no new findings, confirmation is written, understanding.md §5 is updated, and G3 is marked. `needs_rework` routes back to FIX. Skippable only when `skip_fix == true`.
