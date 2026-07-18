---
title: "Quality Pipeline Guide"
---

Complete reference for the Maestro quality pipeline: seven stages organized around a **"Review → Test → Debug → Refactor → Retrospective"** closed loop.

---

## Command Overview

| Command | Purpose | Core Question | Artifact ID |
|----------|---------|---------------|-------------|
| `maestro-ralph --engine swarm --script wf-review` | Multi-level code review | Does code quality meet standards? | `REV-{NNN}` |
| `maestro "<test intent>"` | Conversational UAT | Does it work from the user's perspective? | `TST-{NNN}` |
| `maestro-ralph --engine swarm` | Unified automated testing | Do coverage and regression checks pass? | `TST-{NNN}` |
| `odyssey --mode debug` | Hypothesis-driven debugging | What is the root cause? | `DBG-{NNN}` |
| `quality-refactor` | Reflection-driven refactoring | Is technical debt converging? | `WBR-{NNN}` |
| `manage sync codebase` | Documentation synchronization | Are docs consistent with code? | -- |
| `maestro-next --promote` | Phase retrospective | What insights are reusable? | `INS-{8hex}` |

---

## maestro-ralph --engine swarm --script wf-review — Multi-Level Code Review

```bash
/maestro-ralph --engine swarm --script wf-review "<phase>" [--level quick|standard|deep] [--dimensions security,architecture,...] [--skip-specs]
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
| `PASS` | All dimensions passed | `/maestro "<test intent: {phase}>"` |
| `WARN` | Non-critical issues, can proceed | `/maestro "<test intent: {phase}>"` |
| `BLOCK` | Critical issues, must fix | `/maestro-next "{phase} --gaps"` |

---

## maestro "<test intent>" — Conversational UAT

```bash
/maestro "<test intent> [phase]" [--smoke] [--auto-fix]
```

| Parameter | Description |
|-----------|-------------|
| `--smoke` | Inject smoke tests before UAT |
| `--auto-fix` | Auto gap-fix loop (verify→plan--gaps→execute→re-verify, max 2 rounds) |

**Flow**: Extract scenarios from `verification.json` → per-scenario interaction → auto-infer severity (blocker/major/minor/cosmetic) → parallel debug per gap cluster

Artifact path: `scratch/{YYYYMMDD}-test-P{N}-{slug}/` (uat.md, test-plan.json, test-results.json)

| Condition | Next Step |
|-----------|-----------|
| All passed | `/maestro-session-seal` |
| `--auto-fix` succeeded | Verified via `/maestro-ralph` decision gate |
| Issues remain | `/odyssey --mode debug "<from-uat {phase}>"` |
| Insufficient coverage | `/maestro-ralph --engine swarm "{phase}"` |

---

## maestro-ralph --engine swarm — Unified Automated Testing

```bash
/maestro-ralph --engine swarm "<phase>" [--max-iter N] [--layer L0-L3] [--strategy name] [--dry-run] [--re-run] [-y]
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
| Converged (≥95%) | Verified via `/maestro-ralph` decision gate |
| Bugs found | `/odyssey --mode debug "<from-uat {phase}>"` |
| Max iterations, >80% | `/maestro "<test intent: {phase}>"` |
| Max iterations, <80% | `/odyssey --mode debug "{phase}"` |

---

## odyssey --mode debug — Hypothesis-Driven Debugging

```bash
/odyssey --mode debug "<issue description>" [--from-uat <phase>] [--parallel]
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
| Root cause found | `/maestro-next "{phase} --gaps"` |
| UAT handoff + auto-fix | `/maestro "<test intent: {phase}>" --auto-fix` |
| Unclear conclusion | Resume debug session |

---

## quality-refactor — Reflection-Driven Refactoring

```bash
/quality-refactor [<scope>]    # scope: module path | feature area | all
```

Each round: **Analysis** (identify impact) → **Planning** (execute after confirmation) → **Reflection** (test verification + strategy adjustment)

Artifact path: `scratch/{YYYYMMDD}-refactor-{scope}/reflection-log.md`

---

## manage sync codebase — Documentation Synchronization

```bash
/manage sync codebase [--full] [--since <commit|HEAD~N>] [--dry-run]
```

Detects changes via `git diff` → traces impact chains through `doc-index.json` → updates `.workflow/codebase/` documents.

---

## maestro-next --promote — Phase Retrospective

```bash
/maestro-next --promote [phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [-y]
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
                    ┌──────────────────────────────────────────────────┐
                    │           Phase execution complete               │
                    └──────────────┬───────────────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────────────┐
              ┌─────┤   maestro-ralph wf-review (review)                 │
              │     └──────────────┬───────────────────────────────────┘
              │ BLOCK              │ PASS/WARN
              ▼                    ▼
    ┌──────────────────┐  ┌──────────────────────────────────────────┐
    │ maestro-next      │  │  maestro test / maestro-ralph swarm      │
    │ --gaps (fix)      │  │            (testing)                    │
    └────────┬─────────┘  └──────────────┬───────────────────────────┘
             │                          │
             │ Apply fix                │ Issues found
             ▼                          ▼
    ┌──────────────────┐      ┌──────────────────────────┐
    │ maestro-ralph    │◄─────┤   odyssey --mode debug    │
    │ continue         │ debug │   (debugging)             │
    └────────┬─────────┘      └──────────┬───────────────┘
             │                           │
             │ Root cause found          │
             ▼                            │
    ┌──────────────────┐                  │
    │ Re-run test loop │◄─────────────────┘
    └────────┬─────────┘
             │ All passed
             ▼
    ┌──────────────────────────────────────────────────┐
    │  quality-refactor (optional, tech debt)          │
    │  manage sync codebase (sync docs)                │
    │  maestro-next --promote (retro, feedback)        │
    └──────────────────────────────────────────────────┘
```

<details>
<summary>Decision tree: when to use which command</summary>

```
Code just executed
  ├─ Need code quality assessment? ──> /maestro-ralph --engine swarm --script wf-review "<phase>"
  │    ├─ PASS/WARN ──> Continue to testing
  │    └─ BLOCK ──> /maestro-next "<phase> --gaps"
  │
  ├─ Need user acceptance? ──> /maestro "<test intent: <phase>>"
  │    ├─ All passed ──> /maestro-session-seal
  │    └─ Issues found ──> /odyssey --mode debug "<from-uat <phase>>"
  │
  ├─ Need automated testing? ──> /maestro-ralph --engine swarm "<phase>"
  │    ├─ Converged ──> Verified via maestro-ralph decision gate
  │    └─ Bugs found ──> /odyssey --mode debug "<from-uat <phase>>"
  │
  ├─ Known bugs? ──> /odyssey --mode debug "<issue>"
  │    ├─ Root cause clear ──> /maestro-next "<phase> --gaps"
  │    └─ Unclear ──> Continue debugging
  │
  ├─ Need to reduce tech debt? ──> /quality-refactor <scope>
  │    ├─ Tests pass ──> /manage sync codebase
  │    └─ Tests fail ──> /odyssey --mode debug "<scope>"
  │
  ├─ Code changed but docs not updated? ──> /manage sync codebase
  │
  └─ Phase complete, need retrospective? ──> /maestro-next --promote
       ├─ Insights found ──> Auto-route to spec/issue/knowhow
       └─ Complete ──> /manage status
```

</details>

---

## Integration with Phase Pipeline

After `maestro-ralph` decision gate confirms Phase goals, quality commands are the standard entry point:

```bash
/maestro-ralph continue 1 → /maestro-ralph --engine swarm --script wf-review "1" → /maestro-ralph --engine swarm "1" → /maestro "<test intent: 1>" → /maestro-next --promote
```

`--gaps` is the core bridge between quality and Phase pipelines:

| Trigger Scenario | Command |
|-----------------|---------|
| `maestro-ralph wf-review` verdict BLOCK | `/maestro-next "{phase} --gaps"` |
| `odyssey --mode debug` confirms root cause | `/maestro-next "{phase} --gaps"` |
| `maestro "<test intent>" --auto-fix` | Auto-invokes `maestro-next --gaps → maestro-ralph continue → decision gate` |

**Pre-milestone-audit checkpoints**: All Phases verified via maestro-ralph decision gate → Critical Phases reviewed → Core functionality tested → Issues resolved → Retrospective completed
