---
name: spec-setup
description: Initialize specs from project structure
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Initialize `.workflow/specs/` by scanning codebase for conventions. Core files always created; optional files created when signals detected. Also generates recipe knowhow for detected workflows.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-setup.md
</required_reading>

<context>
$ARGUMENTS (no arguments expected)

**Preconditions:**
- `.workflow/` directory must exist (created by `/maestro-init`)  # (see code: E001)
- Project must contain source files to scan  # (see code: E002)
</context>

<invariants>
1. **Non-destructive** — NEVER overwrite existing spec files; if a file already exists, skip it and report as already-initialized
2. **Idempotent** — safe to re-run on an initialized project; re-running MUST NOT duplicate entries or corrupt existing content
3. **Confirmation gate** — MUST AskUserQuestion showing all files to be created before writing; NEVER write without user confirmation
4. **Output boundary** — ALL file writes MUST target .workflow/specs/ (spec files) and .workflow/knowhow/ (recipe knowhow) only. NEVER modify source code, .workflow/state.json, or files outside these paths
5. **Core files mandatory** — coding-conventions.md, architecture-constraints.md, and learnings.md MUST always be created (unless they already exist)
6. **Signal-driven optionals** — optional spec files (quality-rules.md, test-conventions.md, ui-conventions.md) MUST only be created when corresponding framework/tool signals are detected in the codebase; NEVER create optional files without evidence
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-setup.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Precondition → Scan**
- REQUIRED: .workflow/ directory exists.
- REQUIRED: Project contains source files to scan.
- BLOCKED if: E001 (.workflow/ not initialized), E002 (no source files).

**GATE 2: Scan → Plan**
- REQUIRED: Codebase scan completed — framework, language, and tooling signals collected.
- REQUIRED: Core spec file list determined (always 3: coding-conventions, architecture-constraints, learnings).
- REQUIRED: Optional spec files determined by detected signals only.

**GATE 3: Plan → Write**
- REQUIRED: User confirmed the full list of files to create via AskUserQuestion (showing core specs, optional specs, recipe knowhow, and detected signals).
- BLOCKED if: user declines — abort without writing.

**GATE 4: Write → Report**
- REQUIRED: All confirmed files written to .workflow/specs/ and .workflow/knowhow/.
- REQUIRED: Existing files skipped (not overwritten).
- REQUIRED: .proposed.md files created when slug collision detected (W003).

**Confirmation gate**: After scanning codebase and determining which files/directories will be created (core specs, optional specs, recipe knowhow), AskUserQuestion showing the full list of files to create with their categories and detected signals. Proceed only on user confirm.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` directory not initialized -- run `/maestro-init` first | parse_input |
| E002 | fatal | No source files found in project -- nothing to scan | scan_codebase |
| W001 | warning | Convention detection uncertain for one or more categories -- marked `[UNCERTAIN]` | generate_specs |
| W002 | warning | Workflow recipe signals detected but commands ambiguous -- recipe skipped | generate_recipes |
| W003 | warning | Existing recipe slug found -- new content written as `.proposed.md` for manual diff | generate_recipes |
</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory created
- [ ] Core spec files always created: `coding-conventions.md`, `architecture-constraints.md`, `learnings.md`
- [ ] Optional spec files created when detected: `quality-rules.md` (linter/CI), `test-conventions.md` (test framework), `ui-conventions.md` (frontend framework). `debug-notes.md` / `review-standards.md` deferred (on demand via `/spec-add`).
- [ ] Workflow recipe knowhow created in `.workflow/knowhow/` for each detected operational workflow (test / debug / build / dev / lint). Each recipe matches the `recipe` schema in `~/.maestro/workflows/knowhow.md` Part B and contains at least one runnable command.
- [ ] Report displayed grouped by destination (specs / recipes / skipped / deferred), with `.proposed.md` files surfaced when an existing recipe slug was preserved.
</success_criteria>
