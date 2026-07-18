---
name: roadmap
prepare: roadmap
commands: [maestro-roadmap]
session-mode: inherited
---

# Workflow: Roadmap

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
- `state.json.sessions[]` → completed sessions (done work), planned sessions (deferred/upcoming work)
- `.workflow/specs/` → project-level specs and knowhow
- `.workflow/codebase/` → feature inventory from codebase docs

**Context assembly** — pass downstream as `project_context`:
```json
{
  "already_completed": ["20260301-auth-setup: User auth", "20260315-api-layer: API layer"],
  "current_scope": ["REQ-003: Payments", "REQ-004: i18n"],
  "planned_sessions": ["20260401-payment: Payment integration (planned)"],
  "locked_decisions": ["JWT stateless auth", "PostgreSQL"],
  "learnings": ["JWT has perf issues at scale — consider caching"],
  "project_history": "Session auth-setup completed 2026-03-15: auth + API layer shipped"
}
```

**Rules**:
- NEVER re-plan features from `already_completed` sessions — they are done
- `planned_sessions` items are HIGH PRIORITY candidates for new sessions (may need revision)
- `locked_decisions` constrain technology choices in decomposition
- `learnings` inform risk assessment and session sizing

---

## Codebase Exploration (conditional)

- Detect if project has source files
- MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: If yes, spawn `cli-explore-agent` for context discovery
  - If `project_context.already_completed` exists: include as "feature audit" directive — agent should verify which shipped features are present in code and identify integration points for new work
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

## Session Decomposition Principle

Session decomposition follows the rules defined in the prepare contract (see prepare/roadmap.md Boundaries).

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

## Decomposition Flow

### Create mode (default)

Build the session DAG from the requirement (or upstream context loaded via `--from`).

1. **Parse requirement** into goal, constraints, stakeholders. BLOCKED if no parsed requirement — cannot decompose.
2. **Decompose** into sessions with intent, scope, success criteria. Define DAG edges with `depends_on`. Every Active requirement from project.md maps to exactly one session. No circular dependencies (E003 if detected). **GATE: dag-valid**
3. **Refine** against the sizing checklist. Present the DAG for approval (auto-approved with `-y`).

### Revise mode (`--revise`)

Read the `current-roadmap` artifact. Apply the requested changes. Preserve any session whose `status` is already `completed` — E005 if a revision would modify one (warn user, ask to confirm or adjust). E004 if `current-roadmap` artifact not found.

### Review mode (`--review`)

Read-only health assessment of the session DAG: dependency validity, requirement coverage, session sizing. No writes. E004 if `current-roadmap` artifact not found.

---

## Roadmap Write Logic

### Output Files

Artifact paths and metadata are declared in `prepare/roadmap.md` contract. Write to `{run_dir}/outputs/`:

1. **`roadmap.json`** — Machine-readable session DAG
2. **`roadmap.md`** — Human-readable session summary using the roadmap template (see `ref/roadmap-template.md`)

Do NOT write to `.workflow/roadmap.md` — roadmap is a Run artifact, not a project-level file.

### Session Registration

Artifact registration and state updates (session DAG registration, activation) are handled by `maestro run complete`. **GATE: sessions-registered** — every session written to `state.json.sessions[]` with `roadmap_artifact_id` and `seed_ref`.

---

## Root Session Activation

After outputs are written, confirm which root session to activate via `AskUserQuestion`:
- Activate the recommended root session (first root in the DAG)
- Choose a different session from the DAG
- Defer activation (keep all sessions `planned`)

Skip in auto mode (`-y`) — select the first root session automatically. The chosen activation is applied by the runtime via `maestro run complete`.

---

## Success Criteria

- [ ] Requirement parsed with goal, constraints, stakeholders
- [ ] Sessions defined with intent, scope, success criteria, and seed data
- [ ] Decomposition strategy selected (progressive or direct)
- [ ] DAG edges defined with `depends_on` relationships
- [ ] Every Active requirement from project.md mapped to exactly one session
- [ ] No circular dependencies in session DAG
- [ ] User approved session DAG (or auto-approved with -y)
- [ ] `outputs/roadmap.json` written with session DAG
- [ ] `outputs/roadmap.md` written with session summary and frontmatter `kind: roadmap`
- [ ] Sessions registered in `state.json.sessions[]` with `roadmap_artifact_id` and `seed_ref`
- [ ] Root session activation confirmed via AskUserQuestion

---

## Completion

Report session count, root sessions, strategy, and output path. Verdict `DONE` on normal completion, `DONE_WITH_CONCERNS` if concerns surfaced (e.g. unmapped requirement, low-confidence research).

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | Requirement/idea text or @file required | Prompt user for input |
| E002 | Context source not found (`--from` / `--from-brainstorm`) | Show available sessions/sources |
| E003 | Circular dependency detected in session DAG | Prompt user to re-decompose |
| E004 | current-roadmap artifact not found (`--revise`/`--review`) | Run roadmap create first |
| E005 | Revision would modify a completed session | Warn user, ask to confirm or adjust |
| W001 | CLI analysis failed, using fallback | Continue with available data |
| W002 | Max refinement rounds (5) reached | Force proceed with current DAG |
| W005 | External research agent failed | Continue without apiResearchContext |

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Session activated, need analysis | `analyze --session {active-session-slug}` |
| Simple project, ready to plan | `plan --session {active-session-slug}` |
| Need UI design first | `impeccable build` |
| View project dashboard | `/maestro-manage status` |
| Need formal spec documents | `blueprint` |
