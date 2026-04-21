---
name: spec-setup
description: Initialize project specs by scanning codebase for conventions and tech stack
argument-hint: ""
allowed-tools: Read, Write, Bash, Glob, Grep
---

<purpose>
Initialize project specs by scanning the codebase and generating spec files in `.workflow/specs/`.
Core files (coding, arch, learning) always created. Optional files created only when relevant signals detected.

```bash
$spec-setup
```
</purpose>

<context>
No arguments. Scans the codebase and generates spec files in `.workflow/specs/`.
</context>

<execution>

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

### Step 3: Generate Core Spec Files (always)

Create `.workflow/specs/` directory and write:

1. **`coding-conventions.md`** — Detected naming, import, formatting patterns (category: `coding`)
2. **`architecture-constraints.md`** — Structural rules, layer boundaries (category: `arch`)
3. **`learnings.md`** — Initialized with format instructions for future entries (category: `learning`)

### Step 4: Generate Optional Spec Files (when signals detected)

| File | Created when |
|------|-------------|
| `quality-rules.md` | Linter config, CI config, or lint scripts detected |
| `test-conventions.md` | Test framework, test files, or test scripts detected |
| `debug-notes.md` | Skipped — created on demand via `spec-add debug` |
| `review-standards.md` | Skipped — created on demand via `spec-add review` |

### Step 5: Generate Tech Profile

Read template from `~/.maestro/templates/project-tech.json` if available.
Write `.workflow/project-tech.json` with detected tech stack.

### Step 6: Display Report

```
=== SPEC SETUP COMPLETE ===
Created:
  - .workflow/specs/coding-conventions.md    (category: coding)
  - .workflow/specs/architecture-constraints.md (category: arch)
  - .workflow/specs/learnings.md             (category: learning)
  {optional files if created}
  - .workflow/project-tech.json

Next: Run Skill({ skill: "spec-add", args: "<category> <content>" }) to add entries
Categories: coding, arch, quality, debug, test, review, learning
```

</execution>

<error_codes>

| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized -- run `Skill({ skill: "maestro-init" })` first |
| E002 | fatal | No source files found in project |
| W001 | warning | Convention detection uncertain -- marked `[UNCERTAIN]` |

</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory created
- [ ] 3 core spec files always created (coding, arch, learning)
- [ ] Optional files created only when relevant signals detected
- [ ] `.workflow/project-tech.json` written with detected tech stack
- [ ] Completion report displayed with category labels
</success_criteria>
