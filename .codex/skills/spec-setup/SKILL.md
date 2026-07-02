---
name: spec-setup
description: Initialize specs from project structure
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

**Output boundary**: ALL file writes MUST target `.workflow/specs/` (spec files) and `.workflow/knowhow/` (recipe knowhow) only. NEVER modify source code, `.workflow/state.json`, or files outside these paths.
</context>

<invariants>
1. **Non-destructive** — NEVER overwrite existing spec files; if a file already exists, skip it and report as already-initialized
2. **Idempotent** — safe to re-run on an initialized project; re-running MUST NOT duplicate entries or corrupt existing content
3. **Core files mandatory** — coding-conventions.md, architecture-constraints.md, and learnings.md MUST always be created (unless they already exist)
4. **Signal-driven optionals** — optional spec files (quality-rules.md, test-conventions.md) MUST only be created when corresponding framework/tool signals are detected in the codebase; NEVER create optional files without evidence
5. **Output boundary** — ALL file writes MUST target `.workflow/specs/` and `.workflow/knowhow/` only. NEVER modify source code or files outside these paths
6. **Confirmation gate** — MUST present all files to be created before writing; NEVER write without user awareness
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Precondition → Scan**
- REQUIRED: `.workflow/` directory exists.
- REQUIRED: Project contains source files to scan.
- BLOCKED if: E001 (`.workflow/` not initialized), E002 (no source files).

**GATE 2: Scan → Generate**
- REQUIRED: Codebase scan completed — framework, language, and tooling signals collected.
- REQUIRED: Core spec file list determined (always 3: coding-conventions, architecture-constraints, learnings).
- REQUIRED: Optional spec files determined by detected signals only.

**GATE 3: Generate → Report**
- REQUIRED: All planned files written to `.workflow/specs/`.
- REQUIRED: Existing files skipped (not overwritten).
- BLOCKED if: filesystem write errors.

### Step 1: Validate Preconditions

Verify `.workflow/` exists (E001) and project contains source files (E002).

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

### Step 5: Display Report

List created files with categories. Show next steps: `$spec-add <category> <content>`, available categories (core + extended), `$spec-remove`, wiki graph commands.

</execution>

<error_codes>

| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/` not initialized -- run `$maestro-init` first |
| E002 | fatal | No source files found in project |
| W001 | warning | Convention detection uncertain -- marked `[UNCERTAIN]` |

</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory created
- [ ] 3 core spec files always created (coding, arch, learning)
- [ ] Optional files created only when relevant signals detected
- [ ] Completion report displayed with category labels
</success_criteria>
