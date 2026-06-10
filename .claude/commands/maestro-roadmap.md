---
name: maestro-roadmap
description: Generate roadmap with milestone/phase structure from requirements or upstream context
argument-hint: "<requirement> [-y] [-c] [-m progressive|direct|auto] [--from <source>] [--revise [instructions]] [--review]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Generate a milestone/phase roadmap from requirements or upstream context. Produces `.workflow/roadmap.md` with Milestone > Phase hierarchy ready for maestro-analyze and maestro-plan.

Operation modes:
- **Create** (default): Build roadmap from requirements or upstream context
- **Revise** (`--revise`): Modify existing roadmap while preserving completed phase progress
- **Review** (`--review`): Health assessment of current roadmap (read-only)

For formal specification documents (Product Brief, PRD, Architecture, Epics), use `/maestro-blueprint` instead.
</purpose>

<required_reading>
@~/.maestro/workflows/roadmap-common.md
@~/.maestro/templates/roadmap.md
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
| `--revise [instructions]` | Revise existing roadmap. If instructions provided, apply directly. If omitted, ask user. Preserves completed phase progress. | — |
| `--review` | Roadmap health assessment (read-only) | — |

**Input types:**
- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` or `--from analyze:ANL-xxx` or `--from blueprint:BLP-xxx`
- No args + `--revise` / `--review`: Operate on existing `.workflow/roadmap.md`

**Pipeline position:**
```
maestro-brainstorm ─┐
maestro-blueprint  ─┤ (optional upstream, parallel)
maestro-analyze    ─┘ context-package.json
        ↓
maestro-roadmap → .workflow/roadmap.md (Milestone > Phase hierarchy)
        ↓
maestro-analyze {phase} → maestro-plan → maestro-execute
```

### Pre-load

1. **Specs**: `maestro spec load --category arch` — load architecture constraints for phase decomposition
2. **Wiki search**: `maestro search "{requirement keywords}" --json` → prior knowledge
3. All optional — proceed without if unavailable
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (strict order): mode (create / revise / review) → requirement scope (MVP / complete / phased) → decomposition strategy (progressive / direct / auto) → milestone boundaries → phase dependencies and order
**Scope guard**: only roadmap shape; do not pre-resolve intra-phase task breakdown (belongs to plan)
**Writeback target**: .workflow/roadmap.md "Roadmap Decisions" section (create if absent)
**Additional skip conditions**: --revise, --review (skip to respective mode)
**Exit condition**: on consensus or explicit user signal → finalize Roadmap Decisions section
</interview_protocol>

<execution>

1. Read `@~/.maestro/workflows/roadmap-common.md` (always — shared logic)
2. Read `@~/.maestro/workflows/roadmap.md`, follow its process

Sub-modes:
- **Create** (default): Build roadmap from requirements or upstream context
- **Revise** (`--revise`): Follow workflow roadmap.md "Mode: Revise" section
- **Review** (`--review`): Follow workflow roadmap.md "Mode: Review" section

### Phase Gates (MANDATORY, BLOCKING — Create mode)

**GATE 1: Input → Decomposition**
- REQUIRED: Requirement parsed with goal, constraints, stakeholders.
- REQUIRED: Upstream context loaded via --from (if specified).

**GATE 2: Decomposition → Refinement**
- REQUIRED: Milestones defined with deliverable targets.
- REQUIRED: Phases defined within milestones with dependencies.
- REQUIRED: Every Active requirement from project.md mapped to exactly one phase.
- REQUIRED: No circular dependencies in phase ordering.

**GATE 3: Refinement → Completion**
- REQUIRED: User approved roadmap (or auto-approved with -y).
- REQUIRED: `.workflow/roadmap.md` written with Milestone > Phase hierarchy.
- REQUIRED: Artifact registered in state.json with milestone entries.

### Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  ".workflow/roadmap.md"    // Milestone > Phase hierarchy with progress table
]
```
If missing: DO NOT report completion.

</execution>

<completion>
### Standalone report

```
=== ROADMAP READY ===
Milestones: {count}
Phases: {total_phases}
Strategy: {progressive|direct|auto}
Output: .workflow/roadmap.md
--- COMPLETION STATUS ---
Status: {DONE|DONE_WITH_CONCERNS}
Concerns: {if any}
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
| Roadmap approved, need analysis | `/maestro-analyze 1` |
| Simple project, ready to plan | `/maestro-plan 1` |
| Need UI design first | `/maestro-impeccable build` |
| View project dashboard | `/manage-status` |
| Need formal spec documents | `/maestro-blueprint` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Requirement/idea text or @file required | Prompt user for input |
| E002 | error | Context source not found (--from / --from-brainstorm) | Show available sessions/sources |
| E003 | error | Circular dependency detected in phases | Prompt user to re-decompose |
| E004 | error | roadmap.md not found (--revise/--review) | Run maestro-roadmap first |
| E005 | error | Revision invalidates completed phase work | Warn user, ask to confirm or adjust |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W002 | warning | Max refinement rounds (5) reached | Force proceed with current roadmap |
| W005 | warning | External research agent failed | Continue without apiResearchContext |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decision table appended to `.workflow/roadmap.md` "Roadmap Decisions" section
- [ ] Requirement parsed with goal, constraints, stakeholders
- [ ] Milestones defined with deliverable targets and version tags
- [ ] Decomposition strategy selected (progressive or direct)
- [ ] Phases defined within milestones with success criteria, dependencies, and requirement mappings
- [ ] Every Active requirement from project.md mapped to exactly one phase
- [ ] No circular dependencies in phase ordering
- [ ] User approved roadmap (or auto-approved with -y)
- [ ] `.workflow/roadmap.md` written with Milestone > Phase hierarchy, scope decisions, and progress table
- [ ] No phase directories created (phases are labels in roadmap, not directories)
- [ ] Artifact registered in state.json with milestone entries
</success_criteria>
