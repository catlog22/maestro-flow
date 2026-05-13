---
name: maestro-ui-codify
description: Extract design system from code, generate reference package, persist as knowledge assets
argument-hint: "<source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - Skill
---
<purpose>
Codify UI design system from existing source code. 4-phase pipeline:

1. **Validate** (inline): Parameter validation, workspace setup, file discovery
2. **Extract** (3 parallel agents): Style Agent + Animation Agent + Layout Agent produce design-tokens.json, animation-tokens.json, layout-templates.json
3. **Package** (agent): Copy tokens to package directory, generate preview.html + preview.css
4. **Knowhow** (manifest + skill): Build knowhow-manifest.json, call codify-to-knowhow to persist as knowledge assets

Position in pipeline: code -> **ui-codify** -> knowhow + specs
</purpose>

<deferred_reading>
- [ui-codify.md](~/.maestro/workflows/ui-codify.md) — read always (main workflow orchestrator)
- [ui-codify-extract.md](~/.maestro/workflows/ui-codify-extract.md) — read when Phase 2 starts (style extraction with 3 agents)
- [ui-codify-package.md](~/.maestro/workflows/ui-codify-package.md) — read when Phase 3 starts (reference package generation)
- [ui-codify-knowhow.md](~/.maestro/workflows/ui-codify-knowhow.md) — read when Phase 4 starts (knowledge asset generation)
</deferred_reading>

<context>
$ARGUMENTS — source path (required) with optional flags.

Flags:
- `<source-path>` (positional, required): Directory containing CSS/SCSS/JS/TS/HTML source files
- `--package-name <name>`: Package name for reference output (default: auto-generated from source directory)
- `--output-dir <path>`: Output directory for reference package (default: `.workflow/reference_style`)
- `--overwrite`: Allow overwriting existing package directory
</context>

<execution>
## 1. Load UI Specs

Load project UI conventions before extracting design system:

```bash
maestro spec load --category ui
```

If specs not initialized, continue without — the workflow still produces valid output.

## 2. Execute Workflow

Route to `~/.maestro/workflows/ui-codify.md` and follow completely.

The workflow orchestrates 4 phases with deferred loading of phase-specific workflow files. Each phase reads its workflow file only when execution reaches that phase.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | Source path argument required | parse_input |
| E002 | error | Source path not found or not a directory | validate |
| E003 | error | Package directory exists without --overwrite flag | validate |
| W001 | warning | animation-tokens.json not found (optional, extraction continues) | extract |
</error_codes>

<success_criteria>
- [ ] UI specs loaded via `spec load --category ui` (if available)
- [ ] Source path validated and file discovery completed
- [ ] design-tokens.json generated with color, typography, spacing tokens
- [ ] layout-templates.json generated with component patterns (universal/specialized)
- [ ] animation-tokens.json generated (optional, W001 if missing)
- [ ] preview.html + preview.css generated as interactive showcase
- [ ] knowhow-manifest.json created with AST/DCS assets and spec entries
- [ ] codify-to-knowhow called and completed successfully
- [ ] Temporary workspace cleaned up
</success_criteria>
