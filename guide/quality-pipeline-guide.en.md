---
title: "Quality Pipeline Guide"
---

Complete reference for the Maestro quality pipeline: seven commands organized around a **"Review → Test → Debug → Refactor → Retrospective"** closed loop.

---

## Command Overview

| Command | Purpose | Core Question | Artifact ID |
|----------|---------|---------------|-------------|
| `quality-review` | Multi-level code review | Does code quality meet standards? | `REV-{NNN}` |
| `quality-test` | Conversational UAT | Does it work from the user's perspective? | `TST-{NNN}` |
| `quality-auto-test` | Unified automated testing | Do coverage and regression checks pass? | `TST-{NNN}` |
| `quality-debug` | Hypothesis-driven debugging | What is the root cause? | `DBG-{NNN}` |
| `quality-refactor` | Reflection-driven refactoring | Is technical debt converging? | `WBR-{NNN}` |
| `quality-sync` | Documentation synchronization | Are docs consistent with code? | -- |
| `quality-retrospective` | Phase retrospective | What insights are reusable? | `INS-{8hex}` |

---

## quality-review — Multi-Level Code Review

```bash
/quality-review <phase> [--level quick|standard|deep] [--dimensions security,architecture,...] [--skip-specs]
```

| Parameter | Description |
|-----------|-------------|
| `<phase>` | Required. Phase number or slug |
| `--level` | Review level: `quick` / `standard` / `deep`. Default: auto-detected |
| `--dimensions` | Comma-separated review dimensions. Overrides level defaults |

**Three levels**: Quick (inline for small changes) → Standard (parallel agents per dimension, auto deep-dive) → Deep (multi-round aggregation)

Artifact path: `scratch/{YYYYMMDD}-review-P{N}-{slug}/review.json`

| Verdict | Meaning | Next Step |
|---------|---------|-----------|
| `PASS` | All dimensions passed | `/quality-test {phase}` |
| `WARN` | Non-critical issues, can proceed | `/quality-test {phase}` |
| `BLOCK` | Critical issues, must fix | `/maestro-plan {phase} --gaps` |

---

## quality-test — Conversational UAT

```bash
/quality-test [phase] [--smoke] [--auto-fix]
```

| Parameter | Description |
|-----------|-------------|
| `--smoke` | Inject smoke tests before UAT |
| `--auto-fix` | Auto gap-fix loop (verify→plan--gaps→execute→re-verify, max 2 rounds) |

**Flow**: Extract scenarios from `verification.json` → per-scenario interaction → auto-infer severity (blocker/major/minor/cosmetic) → parallel debug per gap cluster

Artifact path: `scratch/{YYYYMMDD}-test-P{N}-{slug}/` (uat.md, test-plan.json, test-results.json)

| Condition | Next Step |
|-----------|-----------|
| All passed | `/maestro-milestone-audit` |
| `--auto-fix` succeeded | `/maestro-verify {phase}` |
| Issues remain | `/quality-debug --from-uat {phase}` |
| Insufficient coverage | `/quality-auto-test {phase}` |

---

## quality-auto-test — Unified Automated Testing

```bash
/quality-auto-test <phase> [--max-iter N] [--layer L0-L3] [--strategy name] [--dry-run] [--re-run] [-y]
```

| Parameter | Description |
|-----------|-------------|
| `--max-iter N` | Max iteration count (default 5) |
| `--layer L` | Specify layer (L0/L1/L2/L3) |
| `--dry-run` | Generate plan only, no execution |
| `--re-run` | Re-run failed scenarios only |

**Smart routing**:

| Priority | Condition | Route |
|----------|-----------|-------|
| 1 | Active session exists | Resume session |
| 2 | `--re-run` + previous failures | Re-run failed |
| 3 | REQ-*.md exists | Spec route |
| 4 | Coverage gaps exist | Gap route |
| 5 | Default | Code route |

**Level waves**: L0→L1→L2→L3 sequential, CSV parallel writes + CSV parallel diagnosis

Artifact path: `scratch/{YYYYMMDD}-auto-test-P{N}-{slug}/` (test-plan.json, scenarios.csv, report.json)

| Condition | Next Step |
|-----------|-----------|
| Converged (≥95%) | `/maestro-verify {phase}` |
| Bugs found | `/quality-debug --from-uat {phase}` |
| Max iterations, >80% | `/quality-test {phase}` |
| Max iterations, <80% | `/quality-debug {phase}` |

---

## quality-debug — Hypothesis-Driven Debugging

```bash
/quality-debug [issue description] [--from-uat <phase>] [--parallel]
```

| Mode | Trigger | Symptom Source |
|------|---------|----------------|
| Standalone | Provide issue description directly | Interactive collection |
| UAT handoff | `--from-uat` | Loaded from `uat.md` gaps |
| Parallel | `--parallel` | Independent agent per gap cluster |

**Debug loop**: Symptom collection → Hypothesis generation → Isolation verification → Root cause confirmation → Readiness gate → Stress testing

Artifact path: `scratch/{YYYYMMDD}-debug-P{N}-{slug}/` (understanding.md, evidence.ndjson)

| Condition | Next Step |
|-----------|-----------|
| Root cause found | `/maestro-plan {phase} --gaps` |
| UAT handoff + auto-fix | `/quality-test {phase} --auto-fix` |
| Unclear conclusion | Resume debug session |

---

## quality-refactor — Reflection-Driven Refactoring

```bash
/quality-refactor [<scope>]    # scope: module path | feature area | all
```

Each round: **Analysis** (identify impact) → **Planning** (execute after confirmation) → **Reflection** (test verification + strategy adjustment)

Artifact path: `scratch/{YYYYMMDD}-refactor-{scope}/reflection-log.md`

---

## quality-sync — Documentation Synchronization

```bash
/quality-sync [--full] [--since <commit|HEAD~N>] [--dry-run]
```

Detects changes via `git diff` → traces impact chains through `doc-index.json` → updates `.workflow/codebase/` documents.

---

## quality-retrospective — Phase Retrospective

```bash
/quality-retrospective [phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [-y]
```

4 parallel Lenses (Technical / Process / Quality / Decision), insights auto-routed:

| Routing Target | Condition |
|----------------|-----------|
| Spec stub | Reusable patterns/constraints |
| Issue | Recurring gaps |
| Knowhow tip | Process notes/reminders |
| Learnings | All insights (always) |

---

## Quality Closed Loop

```
                    ┌──────────────────────────────────────────┐
                    │           Phase execution complete         │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
              ┌─────┤        quality-review (review)            │
              │     └──────────────┬───────────────────────────┘
              │ BLOCK              │ PASS/WARN
              ▼                    ▼
    ┌─────────────────┐  ┌────────────────────────────────────┐
    │ maestro-plan     │  │     quality-test / quality-auto-test │
    │ --gaps (fix)     │  │            (testing)                │
    └────────┬────────┘  └──────────────┬─────────────────────┘
             │                          │
             │ Apply fix                │ Issues found
             ▼                          ▼
    ┌─────────────────┐      ┌──────────────────────┐
    │ maestro-execute  │◄─────┤   quality-debug       │
    └────────┬────────┘ debug │   (debugging)         │
             │                └──────────┬───────────┘
             │ Root cause found          │
             ▼                           │
    ┌─────────────────┐                  │
    │ Re-run test loop │◄─────────────────┘
    └────────┬────────┘
             │ All passed
             ▼
    ┌──────────────────────────────────────────┐
    │  quality-refactor (optional, tech debt)   │
    │  quality-sync (sync docs)                │
    │  quality-retrospective (retro, feedback)  │
    └──────────────────────────────────────────┘
```

<details>
<summary>Decision tree: when to use which command</summary>

```
Code just executed
  ├─ Need code quality assessment? ──> /quality-review <phase>
  │    ├─ PASS/WARN ──> Continue to testing
  │    └─ BLOCK ──> /maestro-plan <phase> --gaps
  │
  ├─ Need user acceptance? ──> /quality-test <phase>
  │    ├─ All passed ──> /maestro-milestone-audit
  │    └─ Issues found ──> /quality-debug --from-uat <phase>
  │
  ├─ Need automated testing? ──> /quality-auto-test <phase>
  │    ├─ Converged ──> /maestro-verify <phase>
  │    └─ Bugs found ──> /quality-debug --from-uat <phase>
  │
  ├─ Known bugs? ──> /quality-debug "<issue>"
  │    ├─ Root cause clear ──> /maestro-plan <phase> --gaps
  │    └─ Unclear ──> Continue debugging
  │
  ├─ Need to reduce tech debt? ──> /quality-refactor <scope>
  │    ├─ Tests pass ──> /quality-sync
  │    └─ Tests fail ──> /quality-debug <scope>
  │
  ├─ Code changed but docs not updated? ──> /quality-sync
  │
  └─ Phase complete, need retrospective? ──> /quality-retrospective <phase>
       ├─ Insights found ──> Auto-route to spec/issue/knowhow
       └─ Complete ──> /manage-status
```

</details>

---

## Integration with Phase Pipeline

After `maestro-verify` confirms Phase goals, quality commands are the standard entry point:

```bash
/maestro-execute 1 → /maestro-verify 1 → /quality-review 1 → /quality-auto-test 1 → /quality-test 1 → /quality-retrospective 1
```

`--gaps` is the core bridge between quality and Phase pipelines:

| Trigger Scenario | Command |
|-----------------|---------|
| `quality-review` verdict BLOCK | `/maestro-plan {phase} --gaps` |
| `quality-debug` confirms root cause | `/maestro-plan {phase} --gaps` |
| `quality-test --auto-fix` | Auto-invokes `plan--gaps → execute → verify` |

**Pre-milestone-audit checkpoints**: All Phases verified → Critical Phases reviewed → Core functionality tested → Issues resolved → Retrospective completed
