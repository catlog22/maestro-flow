---
name: maestro-roadmap
description: Roadmap generation with dual mode — light (requirement→roadmap) or full (requirement→spec package→roadmap)
argument-hint: "<requirement> [--mode light|full] [-y] [-c] [-m progressive|direct|auto] [--from-brainstorm SESSION-ID] [--revise [instructions]] [--review]"
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
Unified roadmap generation with two execution paths:

- **Light mode** (default): Directly from requirements to roadmap. No specification documents.
- **Full mode** (`--mode full`): 7-phase document chain (Product Brief → PRD → Architecture → Epics → Roadmap) producing a complete specification package in `.workflow/.spec/` plus `.workflow/roadmap.md`.

Additional operation modes (light mode only):
- **Revise** (`--revise`): Modify existing roadmap while preserving completed phase progress
- **Review** (`--review`): Health assessment of current roadmap (read-only)

Both modes produce `.workflow/roadmap.md` with milestone/phase structure ready for maestro-plan.
</purpose>

<required_reading>
@~/.maestro/workflows/roadmap-common.md
@~/.maestro/templates/roadmap.md
</required_reading>

<deferred_reading>
- [roadmap.md](~/.maestro/workflows/roadmap.md) — read when mode is light (default)
- [spec-generate.md](~/.maestro/workflows/spec-generate.md) — read when mode is full
- [spec-config.json](~/.maestro/templates/spec-config.json) — read when initializing spec configuration (full mode)
</deferred_reading>

<context>
$ARGUMENTS -- requirement text, @file reference, or brainstorm session reference.

**Flags (shared):**
- `--mode light|full`: Execution path (default: light)
- `-y` / `--yes`: Auto mode — skip interactive questions, use recommended defaults
- `-c` / `--continue`: Resume from last checkpoint
- `--from-brainstorm SESSION-ID`: Import guidance-specification.md from a brainstorm session as seed

**Flags (light mode only):**
- `-m progressive|direct|auto`: Decomposition strategy (default: auto)
- `--revise [instructions]`: Revise existing roadmap. If instructions provided, apply directly. If omitted, ask user. Preserves completed phase progress.
- `--review`: Roadmap health assessment (read-only)

**Input types:**
- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Brainstorm import: `--from-brainstorm WFS-xxx`
- No args + `--revise` / `--review`: Operate on existing `.workflow/roadmap.md`

**Pipeline position:**
```
maestro-brainstorm (optional upstream)
        ↓ guidance-specification.md
maestro-init (project setup)
        ↓ project.md, state.json, config.json
maestro-roadmap [--mode light]     → roadmap.md directly
maestro-roadmap --mode full        → spec package + roadmap.md
        ↓
maestro-plan → maestro-execute → maestro-verify
```

**Note (full mode):** `maestro-init` MUST run before `--mode full`. It creates the `.workflow/` directory and project context.
</context>

<execution>

### Mode routing

1. Read `@~/.maestro/workflows/roadmap-common.md` (always — shared logic)
2. Parse `--mode` flag:
   - `light` or omitted → read `@~/.maestro/workflows/roadmap.md`, follow its process
   - `full` → read `@~/.maestro/workflows/spec-generate.md`, follow its process
3. If `--revise` or `--review` present → force light mode (these are light-mode-only operations)

### Light mode (default)

Follow `~/.maestro/workflows/roadmap.md` completely.

Sub-modes:
- **Create** (default): Build roadmap from requirements
- **Revise** (`--revise`): Follow workflow roadmap.md "Mode: Revise" section
- **Review** (`--review`): Follow workflow roadmap.md "Mode: Review" section

### Full mode (`--mode full`)

Follow `~/.maestro/workflows/spec-generate.md` completely.

### Next-step routing on completion

| Condition | Suggestion |
|-----------|-----------|
| Roadmap approved, need analysis | /maestro-analyze 1 |
| Simple project, ready to plan | /maestro-plan 1 |
| Need UI design first | /maestro-ui-design 1 |
| View project dashboard | /manage-status |
| Need project setup (full mode) | /maestro-init |
</execution>

<error_codes>

**Shared:**
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Requirement/idea text or @file required | Prompt user for input |
| E002 | error | Brainstorm session not found (--from-brainstorm) | Show available sessions |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W005 | warning | External research agent failed | Continue without apiResearchContext |

**Light mode:**
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E003 | error | Circular dependency detected in phases | Prompt user to re-decompose |
| E004 | error | roadmap.md not found (--revise/--review) | Run maestro-roadmap first |
| E005 | error | Revision invalidates completed phase work | Warn user, ask to confirm or adjust |
| W002 | warning | Max refinement rounds (5) reached | Force proceed with current roadmap |

**Full mode:**
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E006 | error | `.workflow/` not initialized | Run maestro-init first |
| E007 | error | Phase 6 readiness Fail after 2 auto-fix iterations | Present manual fix options |
| W002 | warning | Codebase exploration failed | Continue without codebase context |
| W003 | warning | Glossary has < 5 terms | Note in readiness check |
| W004 | warning | Review-level readiness score (60-79%) | Proceed with caveats |
</error_codes>

<success_criteria>

**Light mode:**
- [ ] Requirement parsed with goal, constraints, stakeholders
- [ ] Decomposition strategy selected (progressive or direct)
- [ ] Phases defined with success criteria, dependencies, and requirement mappings
- [ ] Every Active requirement from project.md mapped to exactly one phase
- [ ] No circular dependencies in phase ordering
- [ ] User approved roadmap (or auto-approved with -y)
- [ ] `.workflow/roadmap.md` written with phase details, scope decisions, and progress table
- [ ] No phase directories created (phases are labels in roadmap, not directories)

**Full mode (in addition to light mode criteria for roadmap):**
- [ ] `spec-config.json` created with session metadata and phase tracking
- [ ] `product-brief.md` with vision, goals, scope, multi-perspective synthesis
- [ ] `glossary.json` with 5+ core terms for cross-document consistency
- [ ] `requirements/` directory with `_index.md` + individual `REQ-*.md` + `NFR-*.md` files
- [ ] All requirements have RFC 2119 keywords and acceptance criteria
- [ ] `architecture/` directory with `_index.md` + individual `ADR-*.md` files
- [ ] Architecture includes state machine, config model, error handling, observability (service type)
- [ ] `epics/` directory with `_index.md` + individual `EPIC-*.md` files
- [ ] Cross-Epic dependency map (Mermaid) and MVP subset tagged
- [ ] `readiness-report.md` with 4-dimension quality scores and traceability matrix
- [ ] `spec-summary.md` with one-page executive summary
- [ ] All documents have valid YAML frontmatter with session_id
- [ ] Glossary terms used consistently across all documents
- [ ] Readiness gate: Pass (>=80%) or Review (>=60%) with documented caveats
- [ ] `.workflow/roadmap.md` written
</success_criteria>
