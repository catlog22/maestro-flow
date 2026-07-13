<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: Roadmap Common

## Worktree Guard

Block if `.workflow/worktree-scope.json` exists — must run from main worktree.

---

## Load Project Context

### Load Specs

```
specs_content = maestro spec load --category arch
```

### Load Project History (if `.workflow/` exists)

Read project artifacts to understand what has already been built:

- `project.md` → already_shipped (Validated), current_scope (Active), project_history (Context), locked_decisions (Key Decisions)
- `state.json.sessions[]` → sealed sessions (completed work), planned sessions (deferred/upcoming work)
- `.workflow/specs/` → project-level specs and knowhow
- `.workflow/codebase/` → feature inventory from codebase docs

**Context assembly** — pass downstream as `project_context`:
```json
{
  "already_sealed": ["20260301-auth-setup: User auth", "20260315-api-layer: API layer"],
  "current_scope": ["REQ-003: Payments", "REQ-004: i18n"],
  "planned_sessions": ["20260401-payment: Payment integration (planned)"],
  "locked_decisions": ["JWT stateless auth", "PostgreSQL"],
  "learnings": ["JWT has perf issues at scale — consider caching"],
  "project_history": "Session auth-setup sealed 2026-03-15: auth + API layer shipped"
}
```

**Rules**:
- NEVER re-plan features from `already_sealed` sessions — they are done
- `planned_sessions` items are HIGH PRIORITY candidates for new sessions (may need revision)
- `locked_decisions` constrain technology choices in decomposition
- `learnings` inform risk assessment and session sizing

---

## Codebase Exploration (conditional)

- Detect if project has source files
- MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: If yes: spawn `cli-explore-agent` for context discovery
  - If `project_context.already_sealed` exists: include as "feature audit" directive — agent should verify which shipped features are present in code and identify integration points for new work
- Output: relevant files, patterns, tech stack, feature_audit

---

## External Research — API & Technology Details (Optional)

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-external-researcher` agent when requirement mentions specific technologies, APIs, or external services.

**Trigger**: Technology keywords detected in requirement or codebase exploration found external dependencies. Auto-trigger in auto mode (`-y`). Skip if requirement is purely organizational/conceptual.

Extract named technologies/APIs/frameworks/protocols from requirement + codebase exploration.

If topics found → spawn `workflow-external-researcher` agent for API research:
- Per technology: stable version, core API surface, auth model, integration patterns, limitations, effort signals
- Focus on details affecting session decomposition and dependency ordering
- Output → `apiResearchContext` (in-memory)

If no topics or research fails → `apiResearchContext = null`, continue; flag roadmap as [LOW CONFIDENCE] (no external research).

---

## Session Decomposition Principle (MANDATORY)

**Core rule: Session = independent work unit.** Each Session runs a full analyze→plan→execute→verify lifecycle. More sessions = more synchronization overhead. The wave DAG inside each Session's plan already handles task ordering and parallelism, so only create a new Session when work **cannot** start until a previous Session's entire output exists.

**Default: 1 Session.** Put everything into a single Session unless a hard dependency forces a split.

| Rule | Constraint |
|------|-----------|
| **Default** | **1 Session**. All work in one analyze→plan→execute cycle; wave DAG handles internal ordering. |
| **Split justification** | All three hard-dependency conditions must be met (see below). |
| **Minimum tasks per session** | 5 tasks/stories. If a session would have fewer, merge it into an adjacent session. |
| **Merge principle** | Same-module, same-concern, or tightly-coupled work belongs in ONE session. |

**Hard dependency — all three conditions required to justify a Session split:**
1. **Runtime dependency**: Session B code at runtime MUST call Session A's real output (cannot mock/stub).
2. **Not parallelizable**: A and B cannot develop concurrently via contract/interface/type agreement.
3. **Full barrier**: ALL of Session A's tasks must complete before ANY of Session B's tasks can start.

If only 1-2 conditions are met → keep in the same Session, use wave dependencies instead.

**Session sizing checklist (applied after decomposition, before presenting to user):**
1. Count total sessions. If > 3 → justify each split against the 3 hard-dependency conditions, merge if unjustified.
2. Count estimated tasks per session. Any session < 5 tasks → merge into neighbor.
3. Verify each session has a meaningful deliverable boundary (not just "setup" or "cleanup").

**Progressive mode**:
- Progressive layers (MVP → Usable → Refined) map to sessions with `depends_on` chain.
- Each progressive layer is a session that depends on the previous one.
- MVP session must be self-contained (no external dependencies, `depends_on: []`).
- Each feature in exactly ONE session (no overlap).

**Direct mode**:
- All sessions are independent (parallel, no `depends_on` edges).
- Each session scoped to a coherent domain boundary.

**Session format** (both modes):
```json
{
  "session_id": "{YYYYMMDD}-{intent-slug}",
  "intent": "<what this session achieves>",
  "depends_on": ["<prerequisite session_id or empty>"],
  "scope": {
    "requirements": ["<REQ-IDs mapped from project.md Active requirements>"],
    "success_criteria": ["<observable behavior from user perspective>"],
    "definition_of_done": "<single summary sentence>"
  },
  "seed": {
    "features": ["<key deliverables>"],
    "constraints": ["<locked technology/design constraints>"],
    "risks": [{ "name": "...", "severity": "low|medium|high", "mitigation": "..." }],
    "estimated_complexity": "small|medium|large"
  },
  "status": "planned"
}
```

**Requirements traceability**: Every Active requirement from project.md MUST appear in exactly one session's `scope.requirements`. If a requirement maps to no session, surface it as a gap.

---

## Roadmap Write Logic

### Output Files

Write to `{run_dir}/outputs/`:

1. **`roadmap.json`** — Machine-readable session DAG (primary artifact, `_meta.kind: "roadmap"`)
2. **`roadmap.md`** — Human-readable session summary using `@templates/roadmap.md`

Do NOT write to `.workflow/roadmap.md` — roadmap is a Run artifact, not a project-level file.

### state.json Session Registration

After writing roadmap outputs, register sessions in state.json:

| Scenario | Action |
|----------|--------|
| `state.json` exists | Append new sessions to `sessions[]` array. Set `roadmap_artifact_id` and `seed_ref` for each. Do NOT modify existing sealed sessions. |
| `state.json` does not exist | Do not create (leave to maestro-init) |

Do NOT write to `milestones[]`, `current_milestone`, or `accumulated_context` — these are deprecated fields.

### Run output directory

Ensure Run output directory exists: `mkdir -p {run_dir}/outputs/`
