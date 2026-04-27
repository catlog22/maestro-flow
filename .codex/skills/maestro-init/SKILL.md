---
name: maestro-init
description: Initialize project with auto state detection — creates .workflow/ directory, project.md, state.json, config.json, and specs/
argument-hint: "[--auto] [--from-brainstorm SESSION-ID]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Sequential project setup skill. Detects project state (empty/code/existing), gathers project information through deep questioning or document extraction, then creates the `.workflow/` directory structure. No parallel agents — single sequential flow.

When `--auto`: After config questions, run research without further interaction. Expects idea document via @ reference.
</purpose>

<context>

```bash
$maestro-init ""
$maestro-init "--auto"
$maestro-init "--from-brainstorm 20260318-brainstorm-auth"
```

**Flags**:
- `--auto`: Skip interactive questioning; extract from provided document
- `--from-brainstorm SESSION-ID`: Import vision/goals/constraints from brainstorm guidance-specification.md

**Output**: `.workflow/` directory with project.md, state.json, config.json, specs/

</context>

<invariants>
1. **Never create roadmap** — init only creates .workflow/ structure; roadmap is a separate step
2. **Deep questioning over speed** — follow threads, ask clarifying questions (unless --auto)
3. **Detect, don't assume** — scan for existing files, package managers, frameworks before asking
4. **Templates are source of truth** — always read templates before writing files
5. **Idempotent check** — if .workflow/ exists, refuse to overwrite (E002)
</invariants>

<execution>

### Step 1: Parse Arguments

Extract flags from arguments:
- `--auto` flag presence
- `--from-brainstorm SESSION-ID` value
- Remaining text as project description

### Step 2: Detect Project State

Check for `.workflow/state.json` and common manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`).

Classify as:
- **existing**: `.workflow/state.json` found — warn and exit (E002)
- **code**: Source files present but no `.workflow/` — onboarding existing codebase
- **empty**: Greenfield project

### Step 3: Gather Project Information

**If `--from-brainstorm`**:
- Read `.workflow/.brainstorm/{SESSION-ID}/guidance-specification.md`
- Extract: vision, goals, constraints, terminology, tech decisions
- Skip interactive questioning

**If `--auto`**:
- Extract project info from provided document/@ reference
- Minimal interactive questions (confirm core value only)

**Otherwise (interactive)**:
- Deep questioning flow:
  1. What is the core value proposition?
  2. Who are the target users?
  3. What are the key requirements? (follow threads, don't rush)
  4. What are known constraints/limitations?
  5. What tech stack preferences exist?
- Follow each thread with clarifying questions until satisfied

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

Configuration questions (or defaults for --auto): granularity (fine/medium/coarse), workflow agents (enable/disable), gate preferences. Write to `.workflow/config.json`.

### Step 9: Initialize specs/

Create in `.workflow/specs/`: `conventions.md` (detected coding conventions), `learnings.md` (empty placeholder).

### Step 10: Completion Report

Display created files and next steps: `$maestro-spec-generate` (full spec), `$maestro-roadmap` (light), `$manage-status`, `$maestro-brainstorm`, `$maestro-quick`.

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No arguments when --auto requires document | Ask user for document reference |
| E002 | error | .workflow/ already exists | Show status, suggest manage-status |
| E003 | error | Brainstorm session not found | List available sessions |
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
</success_criteria>
