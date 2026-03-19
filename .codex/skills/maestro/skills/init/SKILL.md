---
name: maestro-init
description: Initialize project with auto state detection — creates .workflow/ directory, project.md, state.json, config.json, and specs/
argument-hint: "[--auto] [--from-brainstorm SESSION-ID]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--auto`: After config questions, run research without further interaction. Expects idea document via @ reference.

# Maestro Init (Single Agent)

## Usage

```bash
$maestro-init ""
$maestro-init "--auto"
$maestro-init "--from-brainstorm brainstorm-auth-20260318"
```

**Flags**:
- `--auto`: Skip interactive questioning; extract from provided document
- `--from-brainstorm SESSION-ID`: Import vision/goals/constraints from brainstorm guidance-specification.md

**Output**: `.workflow/` directory with project.md, state.json, config.json, specs/

---

## Overview

Sequential project setup skill. Detects project state (empty/code/existing), gathers project information through deep questioning or document extraction, then creates the `.workflow/` directory structure. No parallel agents — single sequential flow.

---

## Implementation

### Step 1: Parse Arguments

Extract flags from arguments:
- `--auto` flag presence
- `--from-brainstorm SESSION-ID` value
- Remaining text as project description

### Step 2: Detect Project State

```bash
# Check existing state
ls .workflow/state.json 2>/dev/null
ls package.json pyproject.toml Cargo.toml go.mod 2>/dev/null
```

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

```bash
mkdir -p .workflow/specs .workflow/phases .workflow/scratch .workflow/codebase
```

### Step 6: Write project.md

Populate template with gathered information:
- Project name, core value proposition
- Requirements: Validated / Active / Out of Scope
- Key decisions and constraints
- Tech stack (detected or specified)

Write to `.workflow/project.md`.

### Step 7: Write state.json

Initialize state from template:
- `current_phase`: null
- `current_milestone`: null
- `status`: "initialized"

Write to `.workflow/state.json`.

### Step 8: Write config.json

Configuration questions (or defaults for --auto):
- Granularity: fine / medium / coarse
- Workflow agents: enable/disable optional agents
- Gate preferences: verification strictness

Write to `.workflow/config.json`.

### Step 9: Initialize specs/

Create convention files in `.workflow/specs/`:
- `conventions.md` — detected or specified coding conventions
- `learnings.md` — empty, populated during phase transitions

### Step 10: Completion Report

```
=== WORKFLOW INITIALIZED ===
Project: {project_name}
State:   .workflow/state.json (active)

Created:
  .workflow/project.md
  .workflow/state.json
  .workflow/config.json
  .workflow/specs/

Next steps (choose one path to create roadmap):
  $maestro-spec-generate "<idea>"   -- Full spec package + roadmap (heavy)
  $maestro-roadmap "<requirement>"  -- Direct interactive roadmap (light)

Other commands:
  $maestro-status                   -- View project dashboard
  $maestro-brainstorm "<topic>"     -- Explore ideas first
  $maestro-quick "<task>"           -- Quick ad-hoc task
```

---

## Error Handling

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No arguments when --auto requires document | Ask user for document reference |
| E002 | error | .workflow/ already exists | Show status, suggest manage-status |
| E003 | error | Brainstorm session not found | List available sessions |
| W001 | warning | Could not detect tech stack | Continue with manual input |

---

## Core Rules

1. **Never create roadmap** — init only creates .workflow/ structure; roadmap is a separate step
2. **Deep questioning over speed** — follow threads, ask clarifying questions (unless --auto)
3. **Detect, don't assume** — scan for existing files, package managers, frameworks before asking
4. **Templates are source of truth** — always read templates before writing files
5. **Idempotent check** — if .workflow/ exists, refuse to overwrite (E002)
