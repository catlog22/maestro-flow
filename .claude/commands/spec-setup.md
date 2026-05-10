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
---
<purpose>
Initialize the project-level specs directory by scanning the codebase for conventions, patterns, and tech stack.
Core files (coding, arch, knowhow) are always created. Optional files (quality, debug, test, review) are created only when relevant signals are detected.
All output lands in `.workflow/specs/`.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-setup.md
</required_reading>

<deferred_reading>
</deferred_reading>

<context>
$ARGUMENTS (no arguments expected)

**Preconditions:**
- `.workflow/` directory must exist (created by `/maestro-init`)  # (see code: E001)
- Project must contain source files to scan  # (see code: E002)
</context>

<execution>
Follow '~/.maestro/workflows/specs-setup.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` directory not initialized -- run `/maestro-init` first | parse_input |
| E002 | fatal | No source files found in project -- nothing to scan | scan_codebase |
| W001 | warning | Convention detection uncertain for one or more categories -- marked `[UNCERTAIN]` | generate_specs |
</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory created
- [ ] Core files always created: `coding-conventions.md`, `architecture-constraints.md`, `knowhow.md`
- [ ] Optional files created when detected: `quality-rules.md` (linter/CI), `test-conventions.md` (test framework), `debug-notes.md` (on demand), `review-standards.md` (on demand)
- [ ] Report displayed with summary and next steps
</success_criteria>
</output>
