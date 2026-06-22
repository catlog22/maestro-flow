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

<execution>
Follow '~/.maestro/workflows/specs-setup.md' completely.
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
