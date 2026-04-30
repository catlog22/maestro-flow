# Workflow: Roadmap Common

Shared logic for roadmap generation — used by both light mode (roadmap.md) and full mode (spec-generate.md).

---

## Worktree Guard

Block if `.workflow/worktree-scope.json` exists — must run from main worktree.

---

## Load Project Context

### Load Specs

```
specs_content = maestro spec load --category arch
```

Ensure phases respect architectural constraints.

### Load Project History (if `.workflow/` exists)

Read project artifacts to understand what has already been built:

- `project.md` → already_shipped (Validated), current_scope (Active), project_history (Context), locked_decisions (Key Decisions)
- `state.json.accumulated_context` → deferred[] (candidate reqs), key_decisions[] (constraints), blockers[] (risks)
- `.workflow/codebase/` → feature inventory from codebase docs

**Context assembly** — pass downstream as `project_context`:
```json
{
  "already_shipped": ["REQ-001: User auth", "REQ-002: API layer"],
  "current_scope": ["REQ-003: Payments", "REQ-004: i18n"],
  "deferred_from_previous": ["Internationalization deferred from v1.0"],
  "locked_decisions": ["JWT stateless auth", "PostgreSQL"],
  "learnings": ["JWT has perf issues at scale — consider caching"],
  "project_history": "Milestone v1.0 completed 2026-03-15: auth + API layer shipped"
}
```

**Rules**:
- NEVER re-plan features listed in `already_shipped` — they are done
- `deferred_from_previous` items are HIGH PRIORITY candidates for new phases
- `locked_decisions` constrain technology choices in decomposition
- `learnings` inform risk assessment and phase sizing

---

## Codebase Exploration (conditional)

- Detect if project has source files
- If yes: spawn `cli-explore-agent` for context discovery
  - If `project_context.already_shipped` exists: include as "feature audit" directive — agent should verify which shipped features are present in code and identify integration points for new work
- Output: relevant files, patterns, tech stack, feature_audit

---

## External Research — API & Technology Details (Optional)

Spawn `workflow-external-researcher` agent when requirement mentions specific technologies, APIs, or external services.

**Trigger**: Technology keywords detected in requirement or codebase exploration found external dependencies. Auto-trigger in auto mode (`-y`). Skip if requirement is purely organizational/conceptual.

Extract named technologies/APIs/frameworks/protocols from requirement + codebase exploration.

If topics found → spawn `workflow-external-researcher` agent for API research:
- Per technology: stable version, core API surface, auth model, integration patterns, limitations, effort signals
- Focus on details affecting phase decomposition and dependency ordering
- Output → `apiResearchContext` (in-memory)

If no topics or research fails → `apiResearchContext = null`, continue.

---

## Minimum-Phase Principle (MANDATORY)

**Core rule: Phase = synchronization barrier.** Each Phase triggers a full plan→execute→verify→transition serial cycle. More phases = slower delivery. The wave DAG inside each Phase already handles task ordering and parallelism, so only create a new Phase when tasks **cannot** start until a previous Phase's entire output exists.

**Default: 1 Phase.** Put everything into a single Phase unless a hard dependency forces a split.

| Rule | Constraint |
|------|-----------|
| **Default** | **1 Phase**. All work in one plan→execute cycle; wave DAG handles internal ordering. |
| **Maximum** | **2 Phases**. Only when a hard dependency boundary exists that cannot be resolved. |
| **Exceptional** | **3 Phases**. Must explicitly justify why 2 is insufficient. |
| **Minimum tasks per phase** | 5 tasks/stories. If a phase would have fewer, merge it into an adjacent phase. |
| **Merge principle** | Same-module, same-concern, or tightly-coupled work belongs in ONE phase. Infra + core logic + API in one phase is fine. Multiple Epics → one phase is normal. |
| **Split principle** | Only split when ALL three hard-dependency conditions are met (see below). |

**Hard dependency — all three conditions required to justify a Phase split:**
1. **Runtime dependency**: Phase B code at runtime MUST call Phase A's real output (cannot mock/stub).
2. **Not parallelizable**: A and B cannot develop concurrently via contract/interface/type agreement.
3. **Full barrier**: ALL of Phase A's tasks must complete before ANY of Phase B's tasks can start.

If only 1-2 conditions are met → keep in the same Phase, use wave dependencies instead.

**Phase sizing checklist (applied after decomposition, before presenting to user):**
1. Count total phases. If > 2 → justify each split against the 3 hard-dependency conditions, merge if unjustified.
2. Count estimated tasks per phase. Any phase < 5 tasks → merge into neighbor.
3. Verify each phase has a meaningful deliverable boundary (not just "setup" or "cleanup").

**Scope escalation:**
- **Single project** (any size): 1-2 Phases. Use wave DAG for internal parallelism.
- **Large scope** (monorepo with 2+ independently deployable services): Use **Milestones** to divide scope. Each Milestone follows the 1-2 Phase limit independently.

**Progressive mode**:
- Progressive layers (MVP → Usable → Refined) map to **Milestones**, not Phases.
- Each Milestone contains 1-2 Phases following the minimum-phase principle.
- MVP must be self-contained (no external dependencies)
- Each feature in exactly ONE milestone (no overlap)

**Direct mode**:
- Topologically-sorted task sequence
- Each task: title, type, scope, inputs, outputs, convergence, depends_on
- parallel_group for truly independent tasks

**Phase format** (both modes):
```markdown
### Phase {N}: {Title}
- **Goal**: <what this phase achieves>
- **Depends on**: <prerequisite phases or "Nothing">
- **Requirements**: <REQ-IDs mapped from project.md Active requirements>
- **Success Criteria** (what must be TRUE):
  1. <observable behavior from user perspective>
  2. <observable behavior from user perspective>
```

Phase numbering: integers (1, 2, 3) for planned work, decimals (2.1, 2.2) for inserted phases.
Decimal phases count toward the total phase limit.
Phase directories use `{NN}-{slug}` format (e.g., `01-auth`, `02-api`).

**Requirements traceability**: Every Active requirement from project.md MUST appear in exactly one phase's Requirements field. If a requirement maps to no phase, surface it as a gap.

---

## Roadmap Write Logic

### Roadmap Template

Write `roadmap.md` to `.workflow/roadmap.md` using `@templates/roadmap.md`:

```markdown
# Roadmap: {project_name}

## Overview
<one paragraph describing the journey>

## Phases
- [ ] **Phase 1: {Title}** - {one-line description}

## Phase Details

### Phase 1: {Title}
**Goal**: {what this phase delivers}
**Depends on**: Nothing (first phase)
**Requirements**: {REQ-IDs}
**Success Criteria** (what must be TRUE):
  1. {observable behavior from user perspective}
  2. {observable behavior from user perspective}

## Scope Decisions
- **In scope**: <included>
- **Deferred**: <later milestones>
- **Out of scope**: <excluded>

## Progress
| Phase | Status | Completed |
|-------|--------|-----------|
| 1. {Title} | Not started | - |
```

**Requirements traceability**: Cross-check that every Active requirement from project.md maps to exactly one phase. Surface unmapped requirements as gaps.

### Overwrite vs Edit Rules (MANDATORY)

Before writing `.workflow/roadmap.md`, check existing state:

| Scenario | Action |
|----------|--------|
| `roadmap.md` does not exist | Create (write) |
| `roadmap.md` exists, no completed phases in Progress table | Overwrite (with `-y` auto-confirm, otherwise ask user) |
| `roadmap.md` exists, has completed phases | **Refuse overwrite** → instruct user to use `--revise` mode |

### state.json Update Rules

After writing roadmap.md, update state.json consistently regardless of mode:

| Scenario | Action |
|----------|--------|
| `state.json` exists | Update `milestones` array and `current_milestone` field from roadmap phases (partial update, not overwrite) |
| `state.json` does not exist | Do not create (leave to maestro-init) |

### Scratch Directory

Ensure scratch directory exists: `mkdir -p .workflow/scratch/`
