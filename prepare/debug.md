---
name: debug
description: Locate root cause via scientific method — reproduction, hypothesis testing, and backward tracing — producing only diagnosis and fix directions
argument-hint: "[issue] [-c] [--from-test <scope>] [--parallel]"
contract:
  consumes:
    - { kind: test-results, alias: latest-test, required: false }
    - { kind: review-findings, alias: latest-review, required: false }
    - { kind: execution, alias: current-execution, required: false }
  produces:
    - { path: outputs/diagnosis.json, kind: diagnosis, alias: latest-debug, role: primary }
    - { path: outputs/hypotheses.json, kind: hypotheses, role: evidence }
    - { path: outputs/reproduction.json, kind: reproduction, role: evidence }
    - { path: outputs/fix-directions.json, kind: fix-directions, role: attachment }
refs:
  - { path: ref/scientific-debug.md, when: The full Iron Law / 3-strike / backward tracing discipline is needed }
  - { path: ref/cli-supplementary.md, when: CLI supplementary evidence collection is needed }
gates: [hypothesis-tested, evidence-grounded]
---

# Pre-task Thinking: debug

## Purpose

Debug locates root cause via the scientific method, producing only a diagnosis and not executing a fix. Before starting, determine the entry mode and symptom baseline.

## Input Interpretation

Entry modes:

| Mode | Trigger | Symptom source |
|------|---------|----------------|
| standalone | issue description given directly | interactively collect expected/actual/errors/timeline/reproduction |
| from-test | `--from-test <scope>` | read `latest-test` gaps as pre-filled symptoms |
| parallel | `--parallel` | dispatch agents in parallel by non-overlapping cluster |
| continuation | `-c` | resume via run parent/retry linkage, not scanning old directories |

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → module boundaries
- Wiki: `maestro search "<symptom keywords>" --json` → prior investigations
- specs: `maestro load --type spec --category debug --keyword "<symptom>"` → known issues/workarounds
- Role knowledge: `maestro search --category debug` → pick relevant items → `maestro load --type knowhow --id`

When prior debug artifacts of the same scope exist, check their root cause first to avoid re-investigating an already-confirmed root cause.

## Boundaries and Invariants

- Investigation is read-only on source — no quick fix, no trial edits to source, no changing multiple variables at once; diagnosis produces only diagnosis, evidence, report.
- **Root cause may not be confirmed without a reproduction or code/log evidence**; a hypothesis without evidence stays "suspected".
- evidence is append-only; each entry is an immutable observation — modifying or deleting them is forbidden.
- Each hypothesis must record tested action, evidence, status; **stop after 3 hypotheses fail** and escalate to architecture inspection — do not propose a 4th hypothesis on your own.
- **backward trace** from where the error first appears to where correct data turned wrong, and fix at the source, not at the symptom.
- Score confidence with a multi-factor model, not a bare high/medium/low.
- debug produces only `fix_direction` and `affected_files`, **never applying a fix**; fix execution belongs to the plan→execute loop.
- The full investigation discipline (Iron Law, Red Flags, Rationalization Table, 3-strike, backward tracing) is in `ref/scientific-debug.md`.

## Risk Checklist

- Is every confirmed root cause backed by a reproduction or code/log evidence? A hypothesis without evidence must stay "suspected", never promoted to confirmed.
- Did you change only one variable at a time? Simultaneous changes make it impossible to attribute the observed effect to a cause.
- Have 3 hypotheses failed? Stop and escalate to architecture inspection — do not free-associate a 4th hypothesis.
- Did the trace reach the true source? Fixing at the symptom rather than where correct data first turned wrong leaves the root cause live.

## Gate Intent

- `hypothesis-tested`: each hypothesis records a tested action + evidence + status; investigation stops after 3 failures and escalates to architecture inspection rather than free-associating a 4th.
- `evidence-grounded`: root cause is confirmed only with a reproduction or code/log evidence (`understanding.md` + `evidence.ndjson` present); an unproven hypothesis stays "suspected" and status maps confirmed/partial/inconclusive accordingly.
