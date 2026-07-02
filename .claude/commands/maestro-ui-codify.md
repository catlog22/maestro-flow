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
  - AskUserQuestion
---
<purpose>
Extract design system from source code into tokens, reference package, and knowledge assets.
4-phase pipeline: validate → extract → package → knowhow.
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

**Output boundary**: ALL file writes MUST target the `--output-dir` path (default: `.workflow/reference_style/`) for reference packages, and `.workflow/knowhow/` for knowledge assets (via `codify-to-knowhow`). NEVER modify the source directory being analyzed.
</context>

<invariants>
1. **Source read-only** — the source path being analyzed MUST NOT be modified; extraction is purely read-only
2. **Phase-sequential loading** — workflow files (ui-codify-extract, ui-codify-package, ui-codify-knowhow) MUST be read only when their phase starts; NEVER load all phases eagerly
3. **User confirmation before knowhow** — Phase 3→4 gate MUST present AskUserQuestion before generating knowledge assets; NEVER auto-proceed to knowhow generation
4. **Overwrite protection** — existing package directory MUST NOT be overwritten without `--overwrite` flag (E003)
5. **Artifact completeness** — all 5 required artifacts MUST exist before reporting completion; NEVER skip artifact verification
6. **Token-first extraction** — design-tokens.json MUST be generated before layout-templates.json; layout extraction depends on token foundation
</invariants>

<execution>
## 1. Load UI Specs

Load project UI conventions before extracting design system:

```bash
maestro load --type spec --category ui
```

## 2. Execute Workflow

Route to `~/.maestro/workflows/ui-codify.md` and follow completely.

The workflow orchestrates 4 phases with deferred loading of phase-specific workflow files. Each phase reads its workflow file only when execution reaches that phase.

### Phase Gates (MANDATORY, BLOCKING)

**GATE Phase 1 → Phase 2: Validation → Extraction**
- REQUIRED: Source path validated and file discovery completed.
- REQUIRED: design-tokens.json generated with color, typography, spacing tokens.
- BLOCKED if missing: source path invalid (E002) or design-tokens.json not generated — extraction cannot proceed without token foundation.

**GATE Phase 2 → Phase 3: Extraction → Package**
- REQUIRED: layout-templates.json generated with component patterns.
- BLOCKED if missing: layout-templates.json absent — package generation requires component patterns as input.

**GATE Phase 3 → Phase 4: Package → Knowhow**
- REQUIRED: preview.html + preview.css generated as interactive showcase.
- BLOCKED if missing: preview artifacts not generated — knowhow phase needs rendered reference for validation.
- REQUIRED: AskUserQuestion confirmation before proceeding to knowhow generation:
  ```
  question: "Preview 生成完成。是否继续将设计系统持久化为 knowhow 知识资产？"
  options:
    - label: "继续生成 knowhow"
      description: "调用 codify-to-knowhow 写入 AST/DCS assets 和 spec entries"
    - label: "仅保留 preview，跳过 knowhow"
      description: "保留 preview.html + preview.css，不写入知识库"
  ```

**GATE Phase 4 → Completion: Knowhow → Done**
- REQUIRED: knowhow-manifest.json created with AST/DCS assets and spec entries.
- REQUIRED: codify-to-knowhow called and completed (only after user confirmation at Phase 3→4 gate).
- BLOCKED if missing: knowhow-manifest.json absent or codify-to-knowhow not invoked — knowledge assets not persisted.

### Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  "design-tokens.json",      // Phase 1
  "layout-templates.json",   // Phase 2
  "preview.html",            // Phase 3
  "preview.css",             // Phase 3
  "knowhow-manifest.json"    // Phase 4
]
```
If any artifact is missing: DO NOT report completion.
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

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Codify complete | Use extracted tokens in `maestro impeccable craft` for new builds |
| Design system needs refinement | `maestro impeccable document` to regenerate DESIGN.md |
| Knowledge assets persisted | `maestro search --type knowhow "design system"` to verify |
</completion>
