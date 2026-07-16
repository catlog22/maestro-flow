---
name: odyssey-debug
description: "Odyssey debug mode — symptom-driven investigation through archaeology, exploration, hypothesis testing, fix, and confirmation, producing diagnosis with full evidence trail"
goal: true
argument-hint: "<issue> [--template performance|memory-leak|race-condition|regression|crash] [--skip-fix] [--skip-generalize] [-y] [-c]"
contract:
  consumes:
    - { kind: session, alias: prior-session, required: false }
  produces:
    - { path: outputs/session.json, kind: session, alias: debug-session, role: primary }
    - { path: outputs/evidence.ndjson, kind: evidence, alias: debug-evidence, role: evidence }
    - { path: outputs/explore.json, kind: exploration, alias: debug-explore, role: evidence }
    - { path: outputs/understanding.md, kind: diagnosis-report, alias: debug-understanding, role: primary }
  gates:
    exit: [discovery-complete, diagnosis-confirmed, fix-confirmed]
refs:
  - { path: ref/scientific-debug.md, when: Hypothesis testing and backward tracing discipline is needed }
  - { path: ref/cli-supplementary.md, when: CLI supplementary evidence collection is needed }
  - { path: ref/finish-work.md, when: Entering the RECORD phase for wrap-up }
---

# Pre-task Thinking: odyssey-debug

## Purpose

Odyssey debug is a full-lifecycle debugging cycle: symptom intake → archaeology → code exploration → hypothesis-driven diagnosis → fix → confirmation → generalization → discovery → knowledge persistence. Unlike standalone `/debug` (which produces only a diagnosis), odyssey-debug carries through to fix, confirm, generalize sibling occurrences, and persist learnings.

## Input Interpretation

Entry modes:

| Mode | Trigger | Symptom source |
|------|---------|----------------|
| standalone | issue description in `<intent>` | Parse issue description directly |
| template | `--template <name>` | Apply predefined investigation strategy (performance, memory-leak, race-condition, regression, crash) |
| continuation | `-c` | Resume via latest session, jump to `current_state` |

Template strategies:

| Template | Strategy | Use case |
|----------|----------|----------|
| `performance` | profiling → hot path → allocation → cache | Performance degradation |
| `memory-leak` | heap snapshot → retention chain → lifecycle | Memory leaks |
| `race-condition` | timeline → concurrent access → lock analysis | Race conditions |
| `regression` | git bisect → diff analysis → boundary check | Regressions |
| `crash` | stack trace → null chain → error propagation | Crashes / exceptions |

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → module boundaries, ownership
- Wiki: `maestro search "<symptom keywords>" --json` → prior investigations
- Specs: `maestro load --type spec --category debug --keyword "<symptom>"` → known issues/workarounds
- Coding specs: `maestro load --type spec --category coding` → patterns relevant to the issue area
- Role knowledge: `maestro search --category debug` → pick relevant items → `maestro load --type knowhow --id`

When prior debug artifacts of the same scope exist, check their root cause first to avoid re-investigating an already-confirmed root cause.

## Boundaries and Invariants

- **State chain:** `S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_DIAGNOSE → S_FIX → S_CONFIRM → [back-half]`
- **Evidence is append-only** — never delete or overwrite evidence.ndjson entries; each entry is an immutable observation.
- **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
- **Root cause confirmation requires evidence** — a hypothesis without reproduction or code/log evidence stays "suspected", never promoted to confirmed.
- **3-strike escalation** — stop after 3 failed hypotheses and escalate (delegate or ask user); do not free-associate a 4th.
- **Backward trace** from where the error first appears to where correct data turned wrong; fix at the source, not at the symptom.
- **Generalize is mandatory** unless `skip_generalize == true`; prior-phase convergence is NOT a valid skip reason.
- **Fix scope:** source code modifications during fix phase are in-scope but MUST be committed per action. Session artifacts target `{run_dir}/outputs/` only.
- **In scope:** Single bug/issue full loop. **Out of scope:** Features → `--mode planex` | Quality review → `--mode review` | UI → `--mode ui` | Architecture → `/maestro-next plan`.

## Risk Checklist

- Is every confirmed root cause backed by a reproduction or code/log evidence? A hypothesis without evidence must stay "suspected".
- Did you change only one variable at a time during diagnosis? Simultaneous changes make attribution impossible.
- Have 3 hypotheses failed? Stop and escalate — do not propose a 4th hypothesis on your own.
- Did the trace reach the true source? Fixing at the symptom rather than where correct data first turned wrong leaves the root cause live.
- Are archaeology/explore results properly logged even on partial failure (W003/W006)? Missing evidence must be flagged, not silently omitted.
- Is every discovery hit individually classified with a reason? Blanket "pre-existing" skips are forbidden.
- Are all 3 generalization layers (syntax/semantic/structural) attempted? A single-layer quick grep does NOT satisfy the thoroughness floor.

## Gate Intent

- `discovery-complete`: archaeology and/or exploration phases have logged evidence, understanding.md §2-§3 are updated, and discovery goal (G2) is marked. Archaeology partial results via W003 are acceptable; explore skip via W006 is acceptable if no CLI tools are available.
- `diagnosis-confirmed`: all hypotheses are tested with evidence logged (phase=diagnosis), root cause is confirmed with reproduction or code/log evidence (or INCONCLUSIVE after 3-strike escalation), and understanding.md §4-§5 are written. Zero hypotheses tested is BLOCKED.
- `fix-confirmed`: fix is implemented and tests pass, CLI review completed, `confirmation.overall` is set, understanding.md §6 is written, and verify goal (G3) is marked. `needs_rework` routes back to FIX. Skippable only when `skip_fix == true`.
