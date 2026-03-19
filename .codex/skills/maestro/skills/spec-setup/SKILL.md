---
name: maestro-spec-setup
description: Initialize project specs by scanning codebase for conventions and tech stack
argument-hint: ""
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Spec Setup

## Usage

```bash
$maestro-spec-setup
```

No arguments. Scans the codebase and generates spec files in `.workflow/specs/`.

---

## Implementation

### Step 1: Validate Preconditions

```bash
test -d .workflow || exit 1  # E001: not initialized
```

Verify project contains source files to scan (E002 if empty).

### Step 2: Scan Codebase

Detect conventions and tech stack by scanning:
- Package files (`package.json`, `Cargo.toml`, `go.mod`, etc.)
- Config files (`.eslintrc`, `tsconfig.json`, `.prettierrc`, etc.)
- Source structure (directories, naming patterns, import style)
- Test patterns (framework, naming, location)

### Step 3: Generate Spec Files

Create `.workflow/specs/` directory and write:

1. **`coding-conventions.md`** -- Detected naming, import, formatting patterns
2. **`architecture-constraints.md`** -- Structural rules, layer boundaries
3. **`quality-rules.md`** -- Linting, testing, coverage requirements
4. **`learnings.md`** -- Initialized with format instructions for future entries

### Step 4: Generate Tech Profile

Read template from `~/.maestro/templates/project-tech.json` if available.
Write `.workflow/project-tech.json` with detected tech stack:
- Language, framework, build system, test framework
- Key dependencies, module system, TypeScript config

### Step 5: Display Report

```
=== SPEC SETUP COMPLETE ===
Created:
  - .workflow/specs/coding-conventions.md
  - .workflow/specs/architecture-constraints.md
  - .workflow/specs/quality-rules.md
  - .workflow/specs/learnings.md
  - .workflow/project-tech.json

Next: Run Skill({ skill: "spec-add", args: "<type> <content>" }) to add entries
```

---

## Error Handling

| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized -- run `Skill({ skill: "maestro-init" })` first |
| E002 | fatal | No source files found in project |
| W001 | warning | Convention detection uncertain -- marked `[UNCERTAIN]` |
