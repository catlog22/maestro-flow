---
name: maestro-roadmap
description: Decompose requirements into session DAG with dependency edges
argument-hint: "<requirement> [-y] [-c] [-m progressive|direct|auto] [--from <source>] [--from-brainstorm SESSION-ID] [--revise [instructions]] [--review]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces:
    - { path: "outputs/roadmap.json", kind: "roadmap", role: "primary", alias: "current-roadmap" }
    - { path: "outputs/roadmap.md", kind: "roadmap-doc", role: "attachment" }
  gates: { entry: [], exit: [] }
---

<purpose>
Decompose requirements into a session DAG. Each session is an atomic work unit with scope, success criteria, and dependency edges. Three modes: create (default), revise (`--revise`), review (`--review`). For formal spec documents, use `/maestro-blueprint`.

Pipeline: brainstorm/blueprint/analyze → **roadmap** → analyze {session} → plan → execute.
</purpose>

<required_reading>
@~/.maestro/workflows/roadmap-common.md
@~/.maestro/templates/roadmap.md
@~/.maestro/workflows/run-mode.md
</required_reading>

<deferred_reading>
- [roadmap.md](~/.maestro/workflows/roadmap.md) — read for roadmap generation workflow
</deferred_reading>

<context>
$ARGUMENTS -- requirement text, @file reference, or upstream context source.

**Flags:**

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — skip interactive questions, use recommended defaults | false |
| `-c` / `--continue` | Resume from last checkpoint | false |
| `-m progressive\|direct\|auto` | Decomposition strategy | auto |
| `--from <source>` | Load upstream context package (brainstorm:ID, blueprint:BLP-xxx, analyze:ANL-xxx, @file, or path). Consumes context-package.json | — |
| `--from-brainstorm SESSION-ID` | Backward compat alias for `--from brainstorm:ID` | — |
| `--revise [instructions]` | Revise existing roadmap. Reads `current-roadmap` artifact. Preserves sealed sessions. | — |
| `--review` | Roadmap health assessment (read-only) | — |

**Input types:**
- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` or `--from analyze:ANL-xxx` or `--from blueprint:BLP-xxx`
- No args + `--revise` / `--review`: Operate on existing `current-roadmap` artifact

### Pre-load

1. **Specs**: `maestro load --type spec --category arch` — load architecture constraints for session decomposition
2. **Wiki search**: `maestro search "{requirement keywords}" --json` → prior knowledge
3. All optional — proceed without if unavailable
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (strict order): mode (create / revise / review) → requirement scope (MVP / complete / phased) → decomposition strategy (progressive / direct / auto) → session boundaries → session dependencies
**Scope guard**: only roadmap shape; do not pre-resolve task breakdown or session-internal decomposition (belongs to plan)
**Writeback target**: `{run_dir}/outputs/roadmap.md` "Roadmap Decisions" section (create if absent)
**Additional skip conditions**: --revise, --review (skip to respective mode)
**Exit condition**: on consensus or explicit user signal → finalize Roadmap Decisions section
</interview_protocol>

<execution>

1. Read `@~/.maestro/workflows/roadmap-common.md` (always — shared logic)
2. Read `@~/.maestro/workflows/roadmap.md`, follow its process

Sub-modes:
- **Create** (default): Build session DAG from requirements or upstream context
- **Revise** (`--revise`): Read `current-roadmap` artifact, apply changes, preserve sealed sessions
- **Review** (`--review`): Read-only health assessment of session DAG

### Gates (MANDATORY, BLOCKING — Create mode)

**GATE 1: Input → Decomposition**
- REQUIRED: Requirement parsed with goal, constraints, stakeholders.
- REQUIRED: Upstream context loaded via --from (if specified).
- BLOCKED if missing: cannot decompose without parsed requirement.

**GATE 2: Decomposition → Refinement**
- REQUIRED: Sessions defined with intent, scope, and success criteria.
- REQUIRED: DAG edges defined with `depends_on` relationships.
- REQUIRED: Every Active requirement from project.md mapped to exactly one session.
- REQUIRED: No circular dependencies in session DAG (E003 if detected).
- BLOCKED if incomplete: finish session decomposition before refinement.

**GATE 3: Refinement → Completion**
- REQUIRED: User approved session DAG (or auto-approved with -y).
- REQUIRED: `outputs/roadmap.json` written with session DAG and `_meta` self-description.
- REQUIRED: `outputs/roadmap.md` written with session summary.
- REQUIRED: Sessions registered in `state.json.sessions[]`.
- BLOCKED if missing: do not report completion without written outputs.

</execution>

<completion>
### Standalone report

```
=== ROADMAP READY ===
Sessions: {count}
Root sessions: {roots_count} ({root_slugs})
Strategy: {progressive|direct|auto}
Output: {run_dir}/outputs/roadmap.json
--- COMPLETION STATUS ---
Status: {DONE|DONE_WITH_CONCERNS}
Concerns: {if any}
```

After report, use `AskUserQuestion` to confirm root session activation:
```
question: "推荐激活 root session: {first-root-slug}，是否确认？"
options:
  - label: "激活推荐 session"
    description: "设置 {first-root-slug} 为 active_session_id"
  - label: "选择其他 session"
    description: "从 DAG 中选择"
  - label: "暂不激活"
    description: "保持所有 sessions 为 planned 状态"
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Session activated, need analysis | `/maestro-analyze --session {active-session-slug}` |
| Simple project, ready to plan | `/maestro-plan --session {active-session-slug}` |
| Need UI design first | `/maestro-impeccable build` |
| View project dashboard | `/manage-status` |
| Need formal spec documents | `/maestro-blueprint` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Requirement/idea text or @file required | Prompt user for input |
| E002 | error | Context source not found (--from / --from-brainstorm) | Show available sessions/sources |
| E003 | error | Circular dependency detected in session DAG | Prompt user to re-decompose |
| E004 | error | current-roadmap artifact not found (--revise/--review) | Run maestro-roadmap first |
| E005 | error | Revision would modify sealed session | Warn user, ask to confirm or adjust |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W002 | warning | Max refinement rounds (5) reached | Force proceed with current DAG |
| W005 | warning | External research agent failed | Continue without apiResearchContext |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decision table appended to `outputs/roadmap.md` "Roadmap Decisions" section
- [ ] Requirement parsed with goal, constraints, stakeholders
- [ ] Sessions defined with intent, scope, success criteria, and seed data
- [ ] Decomposition strategy selected (progressive or direct)
- [ ] DAG edges defined with `depends_on` relationships
- [ ] Every Active requirement from project.md mapped to exactly one session
- [ ] No circular dependencies in session DAG
- [ ] User approved session DAG (or auto-approved with -y)
- [ ] `outputs/roadmap.json` written with `_meta` self-description and session DAG
- [ ] `outputs/roadmap.md` written with session summary and frontmatter `kind: roadmap`
- [ ] Sessions registered in `state.json.sessions[]` with `roadmap_artifact_id` and `seed_ref`
- [ ] Root session activation confirmed via AskUserQuestion
</success_criteria>
