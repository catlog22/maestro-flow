---
name: maestro-init
description: Initialize project with auto state detection
argument-hint: "[-y] [--from <source>] [--from-brainstorm SESSION-ID]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Initialize project: detect state, create `.workflow/` with project.md, state.json, config.json.
Entry point; downstream: maestro-roadmap or maestro-brainstorm.
</purpose>

<required_reading>
@~/.maestro/workflows/init.md
</required_reading>

<deferred_reading>
- [project.md](~/.maestro/templates/project.md) — read when generating project description
- [state.json](~/.maestro/templates/state.json) — read when creating initial state
- [config.json](~/.maestro/templates/config.json) — read when creating workflow configuration
</deferred_reading>

<context>
$ARGUMENTS — none for interactive mode, or `-y` with `@file` reference for auto mode.

**Flags:**

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Automatic mode. After config questions, runs research without further interaction. Expects idea document via @ reference. | `false` |
| `--from <source>` | Load upstream context package (brainstorm:ID, @file, or path). Consumes context-package.json to pre-fill project vision, goals, constraints, and terminology. Skips interactive questioning. Alias: `--from-brainstorm` | — |

**Load project state if exists:**
Check for `.workflow/state.json` -- loads context if project already initialized.

**Output boundary**: ALL file writes MUST target `.workflow/` (project.md, state.json, config.json, specs/) only. NEVER modify source code or files outside `.workflow/`.
</context>

<invariants>
1. **Idempotent init** — re-running init on an already-initialized project MUST detect existing `.workflow/` and warn (E002); NEVER silently overwrite existing state
2. **Scope guard** — init MUST only make initialization decisions; NEVER prejudge roadmap structure, plan scope, or implementation details
3. **All artifacts required** — init MUST NOT report completion until project.md, state.json, and config.json all exist; missing artifacts MUST be created before exit
4. **Template-driven** — deferred templates (project.md, state.json, config.json) MUST be read from `~/.maestro/templates/` and customized; NEVER generate from scratch without template
5. **Interview writes back** — all interactive decisions MUST be written to project.md/config.json before proceeding to research or completion; NEVER leave decisions unrecorded
</invariants>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (strict order): project type (greenfield / existing codebase onboarding) → tech stack detection and confirmation → directory structure preferences → initial configuration (specs categories, wiki bootstrap)
**Scope guard**: only init decisions; do not prejudge roadmap structure or plan scope
**Writeback target**: project.md (project description) + config.json (settings) + state.json (initial state)
**Additional skip conditions**: --from source (upstream context pre-fills decisions)
**Exit condition**: all configuration questions settled → proceed to workflow execution
</interview_protocol>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Pre-flight → Interview**
- REQUIRED: `.workflow/` existence check completed.
- REQUIRED: `--from` source validated (if provided).
- BLOCKED if: E002 (greenfield conflict with existing `.workflow/`) unresolved.

**GATE 2: Interview → Research**
- REQUIRED: All interview decisions recorded in project.md and config.json.
- REQUIRED: `.workflow/` directory created with initial structure.
- BLOCKED if: interview decisions not yet written to files.

**GATE 3: Research → Completion**
- REQUIRED: All 3 required artifacts exist (project.md, state.json, config.json).
- REQUIRED: `.workflow/specs/` initialized.
- BLOCKED if: any artifact missing — write it before reporting completion.

### Pre-flight

1. Check if `.workflow/` already exists — if so, load state and warn (E002 for greenfield conflicts)
2. Validate `--from` source is accessible if provided

Follow '~/.maestro/workflows/init.md' completely.

### Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  ".workflow/project.md",    // Core Value, Requirements, Key Decisions
  ".workflow/state.json",    // artifacts[], initialized to idle state
  ".workflow/config.json"    // Workflow configuration
]
```
If any artifact is missing: DO NOT report completion. Write the missing file first.
</execution>

<completion>
### Standalone report

```
=== WORKFLOW INITIALIZED ===
Project: {project_name}
State:   .workflow/state.json (active)

Created:
  .workflow/project.md
  .workflow/state.json
  .workflow/config.json
  .workflow/specs/
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
| Roadmap needed (default light) | `/maestro-roadmap <requirement>` |
| Full spec package + roadmap | `/maestro-roadmap --mode full <idea>` |
| Explore ideas first | `/maestro-brainstorm <topic>` |
| View project dashboard | `/manage-status` |
| Quick ad-hoc task | `/maestro-quick <task>` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No arguments provided when -y requires @ reference | Check arguments format, re-run with correct input |
| E002 | error | .workflow/ already exists for greenfield init | Check .workflow/ directory state, resolve conflicts |
| E003 | error | Context source not found (--from / --from-brainstorm) | Check arguments format, re-run with correct input |
| W001 | warning | Research agent failed, continuing with partial results | Retry research or proceed with partial results |
</error_codes>

<success_criteria>
- [ ] `.workflow/project.md` created with Core Value, Requirements (Validated/Active/Out of Scope), Key Decisions
- [ ] `.workflow/state.json` created with artifacts[] array, initialized to idle state
- [ ] `.workflow/config.json` created with workflow / execution / git / gates / codebase / guard / collab / specInjection / dashboard segments
- [ ] `.workflow/specs/` initialized with convention files
- [ ] All interview decisions written to project.md / config.json before proceeding
- [ ] Research completed (if enabled) — parallel agents spawned with results merged
- [ ] Next-step routing displayed in completion report
</success_criteria>
