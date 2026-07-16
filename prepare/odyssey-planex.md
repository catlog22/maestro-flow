---
name: odyssey-planex
description: "Odyssey planex mode — single requirement delivery loop through acceptance criteria definition, task planning, execution, verification, and fix iteration until all criteria pass"
goal: true
argument-hint: "<requirement> [--template feature|bugfix|refactor|migration|api-endpoint] [--method auto|agent|<cli>] [--skip-verify] [--skip-generalize] [--max-iterations N] [-y] [-c]"
contract:
  consumes:
    - { kind: session, alias: prior-session, required: false }
  produces:
    - { path: outputs/session.json, kind: session, alias: planex-session, role: primary }
    - { path: outputs/evidence.ndjson, kind: evidence, alias: planex-evidence, role: evidence }
    - { path: outputs/understanding.md, kind: delivery-report, alias: planex-understanding, role: primary }
  gates:
    exit: [criteria-defined, all-criteria-passed, plan-executed]
refs:
  - { path: workflows/odyssey-base.md, when: Shared back-half (GENERALIZE → DISCOVER → RECORD → END) needed }
  - { path: ref/cli-supplementary.md, when: CLI-assisted planning or verification is needed }
  - { path: ref/finish-work.md, when: Entering the RECORD phase for wrap-up }
---

# Pre-task Thinking: odyssey-planex

## Purpose

Odyssey planex is a full requirement delivery cycle: requirement intake → acceptance criteria derivation → task planning → execution (agent or CLI) → verification → fix iteration → generalization → discovery → knowledge persistence. Unlike standalone `/plan` + `/execute` (which handle planning and execution separately), odyssey-planex owns the entire loop from requirement to all acceptance criteria passing, including iterative fix cycles and pattern generalization.

## Input Interpretation

Entry modes:

| Mode | Trigger | Requirement source |
|------|---------|-------------------|
| standalone | requirement description in `<intent>` | Parse requirement directly |
| template | `--template <name>` | Apply predefined criteria pattern (feature, bugfix, refactor, migration, api-endpoint) |
| continuation | `-c` | Resume via latest session, jump to `current_state` |

Template criteria patterns:

| Template | Criteria pattern | Use case |
|----------|-----------------|----------|
| `feature` | User story acceptance + boundary tests + UI verification | New feature |
| `bugfix` | Regression tests + root cause confirmation + boundary coverage | Bug fix |
| `refactor` | Behavior preservation + performance baseline + API compatibility | Refactoring |
| `migration` | Data consistency + rollback verification + performance comparison | Data/API migration |
| `api-endpoint` | Request/response contract + error handling + permission checks | API development |

Execution method is configurable at S_EXECUTE via interactive confirmation or `--method`:

| Method | Resolution |
|--------|-----------|
| `auto` | Domain routing — frontend/backend/general mapped to configured tools |
| `agent` | All tasks executed by Agent |
| `<cli-name>` | All tasks dispatched to specific CLI tool |

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → module boundaries, integration points
- Wiki: `maestro search "<requirement keywords>"` → prior implementations, patterns
- Specs: `maestro load --type spec --category coding` → coding standards, implementation patterns
- Review specs: `maestro load --type spec --category review` → acceptance criteria templates
- Role knowledge: `maestro search --category coding` → pick relevant items → `maestro load --type knowhow --id`
- CLI tools: `maestro delegate-config show --json` → available executors for task dispatch

When prior planex sessions of the same scope exist, check their acceptance criteria and plan to avoid duplicating work or re-implementing already-delivered features.

## Boundaries and Invariants

- **State chain:** `S_INTAKE → S_PLAN → S_EXECUTE → S_VERIFY → S_FIX → [back-half]` with FIX↔VERIFY loop until all criteria pass.
- **Acceptance criteria are sacred** — once confirmed at S_INTAKE, criteria cannot be silently dropped or weakened. All must reach `passed` (or `deferred` at max iteration with user consent).
- **Max iterations** (default 3) prevents infinite FIX↔VERIFY loops. When exceeded: Normal → [@ask] AskUserQuestion (continue/lower bar/accept) | `-y` → `deferred`, proceed S_RECORD.
- **Max 3 retries per task** — first attempt normal → retry with `--resume` simplified → fallback to Agent → all 3 fail → mark `blocked`, continue remaining. NEVER exceed 3 attempts.
- **Replan preserves criteria** — when S_VERIFY routes back to S_PLAN (fundamental plan flaw), `acceptance_criteria[]` statuses are preserved; only `plan.tasks[]` are regenerated. Passed criteria retain `passed`; failed criteria reset to `pending`.
- **Evidence append-only** — evidence.ndjson entries are immutable observations; modifying or deleting them is forbidden.
- **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
- **Generalize is mandatory** unless `skip_generalize == true`; prior-phase convergence is NOT a valid skip reason.
- **Fix scope:** fixes target diagnosed gaps in specific failed criteria, not re-implementation. Targeted code fix, not wholesale rewrite.
- **In scope:** Single requirement delivery loop. **Out of scope:** Multi-requirement orchestration → `/maestro-next roadmap` | Deep debugging → `--mode debug` | Code review → `--mode review` | UI optimization → `--mode ui`.

## Risk Checklist

- Are acceptance criteria testable and each assigned a `verify_method` (test|grep|cli-review|manual)? Vague criteria like "works well" cannot be verified.
- Is the plan decomposition complete — every criterion mapped to at least one task? Unmapped criteria will never be satisfied.
- Was execution method confirmed (or defaulted with `-y`) before task dispatch? Dispatching without confirmed config wastes cycles on wrong executors.
- Did each task respect the 3-retry hard limit? Exceeding 3 attempts on a single task is forbidden — mark `blocked` and continue.
- At S_VERIFY, was every criterion verified by its declared method? Switching methods silently (e.g., skipping `test` and using `grep` instead) undermines verification integrity.
- On replan (S_VERIFY → S_PLAN), were passed criteria preserved? Regenerating the entire criteria set loses confirmed progress.
- Are all 3 generalization layers (syntax/semantic/structural) attempted? A single-layer quick grep does NOT satisfy the thoroughness floor.
- Is every discovery hit individually classified with a reason? Blanket "pre-existing" skips are forbidden.

## Gate Intent

- `criteria-defined`: acceptance criteria are derived from the requirement (≥1 criterion in `acceptance_criteria[]`), each with a testable `criterion` statement and assigned `verify_method` (test|grep|cli-review|manual). Criteria are confirmed by user or auto-derived with deferred confirmation under `-y`. Goal G1 is marked.
- `all-criteria-passed`: every `acceptance_criteria[].status == passed` with recorded evidence and `passed_at` timestamp, verified by the declared `verify_method`. Iterations are logged in `iterations[]`. If max iterations exceeded, criteria may be `deferred` only with explicit user consent (or `-y` auto-accept). Goal G4 is marked.
- `plan-executed`: all plan tasks are executed (status `completed`) or explicitly `blocked` after 3 retries with logged evidence. Per-task execution evidence is recorded. Post-execution validation (convergence, existence, substance, anti-patterns) is completed unless `--skip-verify`. Goal G3 is marked.
