---
name: maestro-init
description: Initialize project with auto state detection
argument-hint: "[-y] [--from <source>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Sequential project setup skill. Detects project state (empty/code/existing), gathers project information through deep questioning or document extraction, then creates the `.workflow/` directory structure. No parallel agents — single sequential flow.

When `-y`: After config questions, run research without further interaction. Expects idea document via @ reference.
</purpose>

<context>

```bash
$maestro-init ""
$maestro-init "-y"
$maestro-init "--from brainstorm:20260318-brainstorm-auth"
```

**Flags**:
- `-y`: Skip interactive questioning; extract from provided document
- `--from <source>`: Load upstream context package (brainstorm:ID, @file, or path). Consumes context-package.json. Alias: `--from-brainstorm`

**Output**: `.workflow/` directory with project.md, state.json, config.json, specs/

</context>

<invariants>
1. **Never create roadmap** — init only creates .workflow/ structure; roadmap is a separate step
2. **Deep questioning over speed** — follow threads, ask clarifying questions (unless -y)
3. **Detect, don't assume** — scan for existing files, package managers, frameworks before asking
4. **Templates are source of truth** — always read templates before writing files
5. **Idempotent check** — if .workflow/ exists, refuse to overwrite (E002)
</invariants>

<execution>

### Step 1: Parse Arguments

Extract flags from arguments:
- `-y` flag presence
- `--from <source>` value (or `--from-brainstorm SESSION-ID` alias)
- Remaining text as project description

### Step 2: Detect Project State

Check for `.workflow/state.json` and common manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`).

Classify as:
- **existing**: `.workflow/state.json` found — warn and exit (E002)
- **code**: Source files present but no `.workflow/` — onboarding existing codebase
- **empty**: Greenfield project

### Step 3: Gather Project Information

**If `--from` (or `--from-brainstorm`)**:
- Read `.workflow/.brainstorm/{SESSION-ID}/guidance-specification.md`
- Extract these fields from the document (match by heading or frontmatter key):
  - `## Vision` or `vision:` → project.md Core Value Proposition
  - `## Goals` or `goals:` → project.md Requirements (Validated)
  - `## Constraints` or `constraints:` → project.md Constraints section
  - `## Terminology` or `terminology:` → project.md Glossary section
  - `## Tech Decisions` or `tech_stack:` → project.md Tech Stack section
- Skip interactive questioning — all project info comes from the document

**If `-y`**:
- Extract project info from provided document/@ reference
- Minimal interactive questions (confirm core value only)

**Otherwise (interactive)**:
- Deep questioning flow (ask via `request_user_input`, follow each thread with clarifying questions until satisfied):
  1. "What problem does this project solve? Who feels the pain today?" — core value proposition
  2. "Who are the target users? How do they currently work around this problem?" — user personas
  3. "What are the must-have features for a first usable version?" — key requirements (follow threads, don't rush)
  4. "What are known constraints — budget, timeline, team size, tech mandates, compliance?" — constraints/limitations
  5. "What tech stack preferences or existing infrastructure must be used?" — tech stack decisions
- For each answer, probe deeper: "Why?", "What happens if not?", "Can you give an example?"

### Step 4: Read Templates

Read the following templates:
- `~/.maestro/templates/project.md`
- `~/.maestro/templates/state.json`
- `~/.maestro/templates/config.json`

### Step 5: Create .workflow/ Structure

Create directories: `.workflow/specs`, `.workflow/scratch`, `.workflow/codebase`.

### Step 6: Write project.md

Populate template with: project name, core value proposition, requirements (Validated/Active/Out of Scope), key decisions, constraints, tech stack. Write to `.workflow/project.md`.

### Step 7: Write state.json

Initialize from template with `current_milestone: null`, `status: "initialized"`, empty `artifacts[]`. Write to `.workflow/state.json`.

### Step 8: Write config.json

Configuration questions (or defaults for -y). Ask via `request_user_input`:

**Granularity** — task decomposition detail level:
```json
{ "questions": [{ "id": "granularity", "header": "Task Granularity", "question": "How granular should task breakdowns be?", "options": [{ "label": "medium (Recommended)", "description": "Balanced: one task per logical feature" }, { "label": "fine", "description": "Detailed: one task per function/component" }, { "label": "coarse", "description": "High-level: one task per epic/module" }] }] }
```

**Workflow agents** — enable parallel research agents during analyze/plan:
```json
{ "questions": [{ "id": "workflow_agents", "header": "Workflow Agents", "question": "Enable parallel research agents for analysis and planning phases?", "options": [{ "label": "enabled (Recommended)", "description": "Spawn parallel agents for research, patterns, risks" }, { "label": "disabled", "description": "Sequential single-agent flow only" }] }] }
```

**Gate preferences** — milestone completion gates:
```json
{ "questions": [{ "id": "gate_preferences", "header": "Quality Gates", "question": "What quality gates should be enforced at milestone boundaries?", "options": [{ "label": "standard (Recommended)", "description": "Audit report required, all tasks completed" }, { "label": "strict", "description": "Audit + code review + test coverage threshold" }, { "label": "relaxed", "description": "Manual approval only, no automated checks" }] }] }
```

Write collected configuration to `.workflow/config.json`.

### Step 9: Initialize specs/

Run `Bash("maestro spec init")` to create empty seed files in `.workflow/specs/`.

If project state is **code** (existing source files detected in Step 2):
- Auto-trigger `$spec-setup` to scan codebase and populate specs with detected conventions
- This runs unconditionally for `code` state — existing source means conventions can be extracted

If project state is **empty** (greenfield, no source files found in Step 2):
- Skip spec-setup entirely — no code to scan
- Specs are populated progressively by analyze, plan, and execute stages via `maestro spec add`

### Step 10: Completion Report

Display created files and next steps: `$maestro-blueprint` (full spec), `$maestro-roadmap` (roadmap), `$manage-status`, `$maestro-brainstorm`, `$maestro-quick`.

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No arguments when -y requires document | Ask user for document reference |
| E002 | error | .workflow/ already exists | Show status, suggest manage-status |
| E003 | error | Context source not found (--from / --from-brainstorm) | List available sessions |
| W001 | warning | Could not detect tech stack | Continue with manual input |

</error_codes>

<success_criteria>
- [ ] Project state correctly detected (empty/code/existing)
- [ ] `.workflow/` directory structure created
- [ ] `project.md` populated with project information
- [ ] `state.json` initialized with correct status
- [ ] `config.json` written with configuration
- [ ] `specs/` initialized with convention files
- [ ] Completion report displayed with next steps

### Artifact Verification
Before reporting completion, verify: .workflow/project.md, .workflow/state.json, .workflow/config.json all exist. If any missing: DO NOT report completion.
</success_criteria>
