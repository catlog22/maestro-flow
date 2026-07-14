---
name: review
description: Perform layered multi-dimensional code review of executed changes, producing traceable review-findings
argument-hint: "[scope] [--level quick|standard|deep] [--dimensions <list>] [--skip-specs]"
contract:
  consumes:
    - { kind: execution, alias: current-execution, required: true }
    - { kind: verification, alias: latest-verification, required: false }
    - { kind: review-findings, alias: prior-review, required: false }
  produces:
    - { path: outputs/review-findings.json, kind: review-findings, alias: latest-review, role: primary }
    - { path: outputs/spec-conflicts.json, kind: spec-conflicts, role: evidence }
    - { path: outputs/issue-candidates.json, kind: issue-candidates, role: attachment }
refs:
  - { path: ref/spec-conflict.md, when: A contradiction between code and a spec entry is found }
  - { path: ref/cli-supplementary.md, when: standard/deep needs CLI cross-validation }
gates: []
---

## Preparation

Review is a read-only assessment of `current-execution`'s change manifest. Before starting, establish awareness of this round's scope and existing constraints.

### Level determination

The review level determines dimension coverage and execution method, inferred automatically by changed-file count by default:

| Level | Trigger | Dimensions | Execution |
|-------|---------|------------|-----------|
| quick | `--level quick` or auto ≤3 files | correctness, security | inline scan, no agents dispatched |
| standard | default, or auto 4-19 files | all 6 dimensions | parallel agents |
| deep | `--level deep` or auto ≥20 files / critical session | all 6 dimensions | parallel agents + mandatory deep-dive |

The six dimensions: correctness, security, performance, architecture, maintainability, best-practices. `--dimensions <list>` can override the level default.

### Context injection (optional, may continue if missing)

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → component boundaries, layering rules
- Wiki constraints: `maestro search "architecture constraint" --json` → recorded decisions
- Review specs: `maestro load --type spec --category review` → review standards, checklist, discoverable knowhow tools
- Conflict state: `maestro spec conflict list` → spec entries currently marked as conflicting (prioritize during review)
- Role knowledge: `maestro search --category review` → pick relevant items → `maestro load --type knowhow --id`

### Boundaries

- Review is read-only on source — problems found are not fixed in this run; source modification belongs to the debug→plan→execute loop.
- Every finding must be anchored to `file:line` and carry severity, evidence, impact, recommendation; vague conclusions without anchors are forbidden.
- The verdict is driven by findings data; do not change severity based on user preference without new evidence.
- Each dimension produces findings independently; one dimension's result must not suppress or override another's.
- When a same-session `prior-review` exists, do a delta comparison; do not re-report already-resolved findings as new problems.
- When code and a spec entry contradict: if the code is evolved practice (spec is outdated), suggest `maestro spec supersede`; if there's a genuine dispute, `maestro spec conflict mark`; never silently accept the contradiction or edit the spec in place.
