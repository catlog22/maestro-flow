---
name: odyssey-improve
description: 6-dimension runtime quality audit → diagnose → fix → verify cycle with baseline metrics tracking and zero-residual enforcement
goal: true
argument-hint: "<target> [--dimensions <list>] [--fix-threshold <severity>] [--skip-fix] [--skip-generalize] [-y] [-c]"
contract:
  consumes:
    - { kind: session, alias: prior-session, required: false }
  produces:
    - { path: outputs/session.json, kind: audit-result, alias: latest-audit, role: primary }
    - { path: outputs/evidence.ndjson, kind: evidence, role: evidence }
    - { path: outputs/understanding.md, kind: improvement-metrics, alias: improvement-report, role: attachment }
  gates:
    exit: [all-dimensions-audited, zero-remaining-verified]
refs:
  - { path: workflows/odyssey-base.md, when: Shared back-half (GENERALIZE → DISCOVER → RECORD → END) needed }
  - { path: ref/cli-supplementary.md, when: CLI-assisted survey or verification is needed }
---

# Pre-task Thinking: odyssey-improve

## Purpose

Odyssey improve performs a systematic 6-dimension quality audit of a target module or changeset, diagnoses root causes for critical/high findings, applies exhaustive fixes by severity tier, and verifies improvements against a captured baseline. Before starting, establish the target scope, dimension coverage, and baseline metrics.

## Input Interpretation

Target resolution determines what gets audited:

| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `HEAD` / `staged` | Review changes in diff |
| Feature area keyword | Resolve to related files |
| `--all` | Full project scan (use with caution) |

The six dimensions (default all, overridable via `--dimensions`): performance, security, architecture, reliability, observability, maintainability. `--fix-threshold` controls the minimum severity that triggers a fix (default: all).

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → module boundaries, layering rules
- Wiki: `maestro search "<target keywords>"` → prior audits, known issues
- Specs: `maestro load --type spec --category coding` + `maestro load --type spec --category debug` → coding standards, known vulnerability patterns
- Role knowledge: `maestro search --category coding` → pick relevant items → `maestro load --type knowhow --id`
- Baseline metrics: capture current test pass rate, bundle size, dependency count, complexity hotspots before any changes — these form `session.json.baseline_metrics` for before/after comparison

When prior improve sessions of the same target exist, check their audit results and fixes first to avoid re-diagnosing already-resolved issues.

## Boundaries and Invariants

- **Zero-residual** — every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" and blanket "pre-existing" skips are forbidden.
- **Dimension independence** — each of the 6 dimensions produces findings independently; one dimension's result must not suppress or override another's.
- **No partial-tier advancement** — each severity tier (critical → high → medium → low) must be fully addressed before advancing to the next; blanket "pre-existing" skip forbidden.
- **Baseline integrity** — `baseline_metrics` captured at INTAKE are immutable throughout the session; before/after comparison in §8 uses these exact values.
- **Fix scope** — fixes target diagnosed root causes, not symptoms. Symptoms may indicate a deeper architectural issue requiring `--mode debug` escalation.
- **Evidence append-only** — evidence.ndjson entries are immutable observations; modifying or deleting them is forbidden.
- **Exhaustive audit** — all 6 dimensions (or `--dimensions` subset) must be attempted. Zero dimensions reviewed is BLOCKED, not a warning.

## Risk Checklist

- Is every finding anchored to `file:line` with severity, dimension, description, and measurement? Unanchored findings are not actionable.
- Were baseline metrics captured before any changes? Without a baseline, the before/after comparison in §8 is meaningless.
- Are all 6 dimensions (or the `--dimensions` subset) audited with independent agents? Missing dimensions mean incomplete coverage.
- Does root cause diagnosis trace to the true source, not the symptom? Fixing symptoms leaves the root cause live.
- After each severity tier fix, was re-verification scoped to the current tier's dimension only? Cross-dimension regression checks belong at S_VERIFY.
- Were 3 diagnosis retries exhausted before marking INCONCLUSIVE? Premature escalation misses solvable issues.
- Is zero-residual enforced — every finding has fix / issue / decision, with no blanket skips?

## Gate Intent

- `all-dimensions-audited`: all 6 dimensions (or `--dimensions` subset) completed audit with structured findings (`[{title, severity, dimension, file, line, description, suggestion, measurement}]`), merged into severity matrix, and evidence phase=audit logged for each. Zero dimensions reviewed is BLOCKED (W002 partial coverage from agent failure is a warning, not a block).
- `zero-remaining-verified`: all diagnosed findings are either fixed and verified, individually classified with justification (issue created / decision recorded), or legitimately skipped via `--skip-fix` flag. Tests pass over modified areas. Metrics re-captured and compared against `baseline_metrics`. No unaddressed actionable findings remain. Before/after improvement metrics table written to understanding.md §8.
