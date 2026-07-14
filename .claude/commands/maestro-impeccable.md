---
name: maestro-impeccable
description: Use when designing, auditing, polishing, improving, or codifying frontend UI — websites, dashboards, landing pages, components, design systems
argument-hint: "<command|intent> [target] [flags] — chain: build|redesign|improve|enhance|launch|harden|foundation|live · --codify <source-path> 提取设计系统"
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
  - TodoWrite
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<deferred_reading>
Codify mode only (read when `--codify` and the corresponding phase starts):
- [ui-codify.md](~/.maestro/workflows/ui-codify.md) — read always in codify mode (main workflow orchestrator)
- [ui-codify-extract.md](~/.maestro/workflows/ui-codify-extract.md) — read when Codify Phase 2 starts (style extraction with 3 agents)
- [ui-codify-package.md](~/.maestro/workflows/ui-codify-package.md) — read when Codify Phase 3 starts (reference package generation)
- [ui-codify-knowhow.md](~/.maestro/workflows/ui-codify-knowhow.md) — read when Codify Phase 4 starts (knowledge asset generation)
</deferred_reading>

<purpose>
UI design command: direct single-command, chain multi-step with quality gates, codify a design system from existing code, or search design knowledge.
Parse input → prerequisites → read workflow file → execute → track.
</purpose>

## Input

$ARGUMENTS first word determines mode:

| First Word | Mode |
|------------|------|
| `--codify` / `codify` | Codify — extract design system from existing code (see `<codify_mode>`) |
| Known command (see routing table) | Direct |
| Chain name: build, redesign, improve, enhance, launch, harden, foundation, live | Chain |
| continue / next / -c | Resume |
| search | Search: `maestro impeccable search "$REST"` |
| Free text (concrete task) | Direct craft — has specific target + specs/reference |
| Free text (project intent) | Intent → classify → chain |
| (empty) | Menu: show commands by category |

## Command Routing

All workflows at `~/.maestro/workflows/impeccable/{command}.md`:

| Command | Category | Description |
|---------|----------|-------------|
| craft | Build | Shape then build end-to-end — full page/component implementation |
| shape | Build | Plan UX/UI before code — information architecture, wireframe, visual direction |
| teach | Build | Set up PRODUCT.md — users, brand, tone, anti-references, principles |
| document | Build | Generate DESIGN.md from existing code — extract tokens, typography, colors |
| extract | Build | Pull tokens/components into reusable design system |
| explore | Build | Multi-style comparison — generate variants, render prototypes, visual compare, select/mix |
| critique | Evaluate | UX heuristic review with Nielsen scoring (/40) + P0/P1 findings |
| audit | Evaluate | Technical quality checks — a11y, performance, responsive, code quality (/20) |
| polish | Refine | Final quality pass — micro-adjustments, pixel perfection |
| bolder | Refine | Amplify bland/safe designs — stronger personality, more contrast |
| quieter | Refine | Tone down aggressive/overwhelming designs — reduce visual noise |
| distill | Refine | Strip to essence — remove clutter, reduce cognitive load |
| harden | Refine | Production-ready — error states, i18n, edge cases, overflow, empty states |
| onboard | Refine | First-run flows, empty states, activation paths, progressive disclosure |
| animate | Enhance | Add purposeful motion — transitions, micro-interactions, scroll effects |
| colorize | Enhance | Add strategic color — OKLCH palette, contrast, color strategy |
| typeset | Enhance | Improve typography — scale, hierarchy, font pairing, line length |
| layout | Enhance | Fix spacing, rhythm, visual hierarchy, alignment, grid |
| delight | Enhance | Add personality — memorable details, joy, surprise moments |
| overdrive | Enhance | Push past conventional limits — ambitious visual effects |
| clarify | Fix | Improve UX copy — labels, error messages, microcopy, CTAs |
| adapt | Fix | Adapt for devices/screens — responsive, touch targets, breakpoints |
| optimize | Fix | Fix UI performance — loading, rendering, bundle, paint/layout jank |
| live | Iterate | Browser-based variant iteration — real-time design in DevTools |

Reference files (loaded by workflow as needed, not standalone commands):
brand.md, product.md, design.md, codex.md, heuristics-scoring.md, cognitive-load.md,
color-and-contrast.md, interaction-design.md, motion-design.md, personas.md,
responsive-design.md, spatial-design.md, typography.md, ux-writing.md

## Chains

Chain step names below reuse Command Routing names but resolve through the chain runner. To avoid ambiguity with Direct command invocation, internal display, todo items, and session status records always tag chain steps with the `impeccable:` prefix (e.g. `impeccable:craft`, `impeccable:critique`). The bare names in this table refer to the workflow file at `~/.maestro/workflows/impeccable/{name}.md` that the chain step reads.

| Chain | Steps | Scenario |
|-------|-------|----------|
| build | teach? → explore? → shape → craft → critique → [refine] → audit → polish | New from scratch |
| redesign | document → explore → shape → craft → critique → [refine] → audit → polish | Redesign existing code |
| improve | critique → [refine] → polish → audit | Iterative improvement |
| enhance | {cmd...} → critique → [refine] → polish | Targeted enhancement (multi-command) |
| launch | harden → adapt → optimize → audit → polish | Full production readiness |
| harden | harden → audit → polish | Edge case hardening |
| foundation | teach? → explore → document → extract | Design system setup |
| live | live | Real-time iteration |

- `?` = conditional: teach if PRODUCT.md missing; explore if DESIGN.md missing and --skip-design not set
- `[refine]` = quality gate loop: gate fails → auto-select fix commands from findings → re-gate
- `{cmd...}` = enhance supports multiple commands, comma-separated: `enhance colorize,typeset landing-page`

Chain flags: --threshold <N> (default 26/40), --max-loops <N> (default 3), --skip-design, --styles <N>, -y

## Free Text Routing

Three-layer priority matching. Stop on first match — do not continue to lower layers.

### Layer 1: Single command intent → Direct

Semantically match user description against the Command Routing table's Description column. Match the closest **single** command.

**Skip condition**: If the prompt also contains a Layer 2 chain keyword AND does not focus on a single design dimension, skip this layer.
Example: `enhance colors and typography` — "enhance" is a chain keyword + multiple design dimensions → skip to Layer 2.

| Intent signal | Command |
|---------------|---------|
| review, check UX, score, heuristic, evaluate usability | critique |
| audit, a11y, accessibility, technical check, performance audit, code quality | audit |
| add animation, motion, transitions, micro-interactions | animate |
| color, palette, OKLCH, contrast, color scheme | colorize |
| font, typography, type scale, line height, font pairing | typeset |
| layout, spacing, grid, alignment, visual hierarchy | layout |
| too loud, tone down, visual noise, make it simpler, too busy | quieter |
| too bland, bolder, more personality, stronger, more contrast | bolder |
| too complex, simplify, strip, remove clutter, cognitive load | distill |
| polish, fine-tune, pixel perfect, final pass, refine details | polish |
| copy, labels, error messages, UX writing, microcopy, CTAs | clarify |
| responsive, mobile, adapt, breakpoints, touch targets | adapt |
| performance, loading, bundle, jank, speed, rendering | optimize |
| edge cases, error states, i18n, overflow, empty state hardening | harden |
| onboarding, first-run, empty state, activation, progressive disclosure | onboard |
| fun, surprise, personality, memorable, joy, delight | delight |
| extraordinary, push limits, ambitious effects, cutting-edge | overdrive |
| plan UX, wireframe, information architecture, visual direction | shape |
| multi-style, variants, compare styles, style comparison | explore |
| brand definition, PRODUCT.md, product context | teach |
| extract design, DESIGN.md, document design system | document |
| pull tokens, extract components, design system extraction | extract |
| real-time, browser iteration, live editing | live |

### Layer 2: Project intent → Chain

Layer 1 did not match. Check for chain-level keywords — even if the prompt also contains a specific target/path, chain matching takes priority.

| Pattern | Chain |
|---------|-------|
| new, create, build, from scratch, start fresh | build |
| redo, redesign, rethink, restyle, overhaul, revamp | redesign |
| improve, iterate, better, refine overall | improve |
| enhance, visual upgrade, level up | enhance |
| launch, deploy, ship, production-ready, go live | launch |
| harden, production-harden, edge cases | harden |
| design system, tokens, design foundation, design infrastructure | foundation |
| real-time, live, browser | live |

Ambiguous + no `-y`:

AskUserQuestion (single-select, header: "意图确认"):
- Options: top 2-3 matched chains from Layer 2 table, each with label = chain name, description = matched keywords
- Last option: **"直接构建"** — skip chain, route to Layer 3 craft

### Layer 3: Concrete build task → Direct craft

Layer 1+2 both did not match, but intent is to build/create a specific thing:
- Contains a specific file path or target (`d:\path`, `src/pages/`, `index.html`)
- Contains detailed visual specs (layout, style, color scheme)
- Contains reference material (`based on...`, `like...`, `similar to...`)

→ Route to **craft** (Direct)

## Prerequisites

Before reading any command workflow:

1. **Context**: `maestro load --type spec --category ui` → if empty → `maestro impeccable load-context`
2. **PRODUCT.md**: missing/placeholder (<200 chars / `[TODO]`) → execute teach first, then resume original task
3. **Register**: identify brand/product → Read `~/.maestro/workflows/impeccable/{brand|product}.md`

## Direct Execution

1. Prerequisites ✓
2. **Display execution info**:
   ```
   ── Command: {command} ────────────────────
   Category: {category} | Target: {target}
   ─────────────────────────────────────────
   ```
3. Read `~/.maestro/workflows/impeccable/{command}.md`
4. **TodoWrite tracking**: create todo items for each major phase in the workflow file
   - Format: `[{command}] {phase description}`
   - Mark each phase completed immediately upon finishing
5. Follow workflow file instructions
6. Post: suggest logical next command (teach→shape, shape→craft, craft→critique, etc.)

## Chain Execution

1. Prerequisites ✓
2. **Display chain preview**: parse chain definition, output full step preview (chain steps prefixed `impeccable:` to disambiguate from Direct commands):
   ```
   ── Chain: build ──────────────────────────
    1. impeccable:teach        (conditional: PRODUCT.md missing)
    2. impeccable:explore      (conditional: DESIGN.md missing)
    3. impeccable:shape
    4. impeccable:craft
    5. impeccable:critique     ◆ quality gate (threshold: 26/40)
    6. impeccable:[refine]     ↺ auto-fix loop (max: 3)
    7. impeccable:audit        ◆ quality gate (threshold: 14/20)
    8. impeccable:polish
   ─────────────────────────────────────────
   Target: {target}
   ```
   - `◆` marks quality gate steps with threshold
   - `↺` marks refine loop with max iteration count
   - Conditional steps show trigger condition
   - Skipped conditional steps marked `(skipped)`
3. **Confirm chain session**: AskUserQuestion "Create chain session for '{chain_type}' targeting '{target}'?" — proceed only if user confirms. On decline, abort chain.
   Create session: `.workflow/.maestro/ui-craft-{YYYYMMDD-HHmmss}/status.json`
   ```json
   { "chain_type": "...", "target": "...", "steps": [...], "current_step": 0,
     "gate_history": [], "loop_count": 0, "status": "running" }
   ```
4. **TodoWrite init**: create todo items for all chain steps
   - One item per step, format: `[chain] step N: impeccable:{command} — {description}` (use `impeccable:` prefix to disambiguate from Direct command items)
   - If conditional step is skipped, immediately mark completed
   - Quality gate steps include threshold: `[chain] step 5: impeccable:critique ◆ gate ≥26/40`
5. For each step:
   - Read `~/.maestro/workflows/impeccable/{command}.md` → execute
   - **Step start**: TodoWrite marks current step in_progress
   - **Step done**: TodoWrite marks completed + update status.json (`current_step`, step `status`)
   - **Step failed**: TodoWrite marks completed (with note) + record reason
6. **Quality gate** (critique/audit steps):
   - Parse score: critique `**Total** | | **N/40**`, audit `**Total** | | **N/20**`
   - Count `[P0]` / `[P1]` tags
   - Pass: score ≥ threshold AND P0 == 0 → advance
   - Fail: collect suggested commands from findings → execute → re-gate
   - Max loops exceeded → force advance with warning
   - TodoWrite: record gate result in current step notes (score, P0/P1 count, pass/fail)
7. Final report: scores + trend + commands executed

## Codify Execution

<codify_mode>
Extract a design system from existing source code into tokens, a reference package, and knowledge assets. 4-phase pipeline: validate → extract → package → knowhow.

**Trigger**: first word is `--codify` or `codify`. Also reachable when the `foundation` chain reaches its `document`/`extract` steps and the user wants full reverse-extraction with knowhow persistence.

**Arguments**: `--codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]`
- `<source-path>` (required): Directory containing CSS/SCSS/JS/TS/HTML source files
- `--package-name <name>`: Package name for reference output (default: auto-generated from source directory)
- `--output-dir <path>`: Output directory for reference package (default: `.workflow/reference_style`)
- `--overwrite`: Allow overwriting existing package directory

**Output boundary**: ALL file writes MUST target the `--output-dir` path (default: `.workflow/reference_style/`) for reference packages, and `.workflow/knowhow/` for knowledge assets (via `codify-to-knowhow`). NEVER modify the source directory being analyzed.

### Codify Invariants
1. **Source read-only** — the source path being analyzed MUST NOT be modified; extraction is purely read-only
2. **Phase-sequential loading** — workflow files (ui-codify-extract, ui-codify-package, ui-codify-knowhow) MUST be read only when their phase starts; NEVER load all phases eagerly
3. **User confirmation before knowhow** — Phase 3→4 gate MUST present AskUserQuestion before generating knowledge assets; NEVER auto-proceed to knowhow generation
4. **Overwrite protection** — existing package directory MUST NOT be overwritten without `--overwrite` flag (E102)
5. **Artifact completeness** — all 5 required artifacts MUST exist before reporting completion; NEVER skip artifact verification
6. **Token-first extraction** — design-tokens.json MUST be generated before layout-templates.json; layout extraction depends on token foundation

### Step 1: Load UI Specs
```bash
maestro load --type spec --category ui
```

### Step 2: Execute Workflow
Route to `~/.maestro/workflows/ui-codify.md` and follow completely. The workflow orchestrates 4 phases with deferred loading of phase-specific workflow files (see `<deferred_reading>`). Each phase reads its workflow file only when execution reaches that phase.

### Codify Phase Gates (MANDATORY, BLOCKING)

**GATE Phase 1 → Phase 2: Validation → Extraction**
- REQUIRED: Source path validated and file discovery completed.
- REQUIRED: design-tokens.json generated with color, typography, spacing tokens.
- BLOCKED if missing: source path invalid (E101) or design-tokens.json not generated — extraction cannot proceed without token foundation.

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
</codify_mode>

## Resume

Scan `.workflow/.maestro/ui-craft-*/status.json` for `status == "running"` → most recent → resume from `current_step`.

## Quality Gate — Finding → Command Fallback

When findings lack explicit suggested command:

| Finding Category | Command |
|-----------------|---------|
| Layout, spacing, hierarchy, alignment | layout |
| Color, contrast, palette | colorize |
| Typography, font, readability | typeset |
| Animation, motion, transitions | animate |
| Copy, labels, UX writing | clarify |
| Responsive, mobile, breakpoints | adapt |
| Performance, loading, speed | optimize |
| Complexity, overload, clutter | distill |
| Bland, safe, generic | bolder |
| Aggressive, overwhelming | quieter |
| Onboarding, empty state | onboard |
| Edge cases, i18n, error handling | harden |
| Personality, memorability | delight |

Never auto-select: teach, shape, craft, live, document, extract, overdrive, critique, audit.

## Chain Phase Gates (MANDATORY for chain mode)

**GATE: Quality Gate Step → Next Step**
- REQUIRED: Score parsed from critique/audit output (not assumed or estimated).
- REQUIRED: P0 count extracted from findings — P0 == 0 required for pass.
- REQUIRED: If gate fails, refine commands executed and re-gate attempted.
- BLOCKED if: score not parsed from actual output, or P0 > 0 and max refine loops not exhausted — do not advance past gate.
- Do NOT skip quality gate steps or mark as "passed" without parsing actual score.

**GATE: Chain → Completion**
- REQUIRED: All non-skipped steps executed (TodoWrite all completed).
- REQUIRED: status.json updated with `status: "completed"` and final scores.
- REQUIRED: If any step failed: documented in status.json with reason.
- BLOCKED if missing: steps not all completed or status.json not updated — chain is incomplete.

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No command or intent resolved from input | Provide a known command, chain name, or descriptive intent |
| E002 | error | Source/target path not found | Verify path exists |
| E003 | error | PRODUCT.md missing and teach step failed | Run `maestro impeccable teach` manually first |
| E004 | error | Chain quality gate failed after max loops | Review findings manually, fix critical issues, then resume |
| W001 | warning | UI specs not found via spec load | Continuing without specs — output may miss project conventions |
| W002 | warning | Quality gate score below threshold but P0 == 0 | Auto-refine loop triggered |
| W003 | warning | Chain step failed but non-blocking | Step failure documented, chain continues |
| E101 | error | Codify: source path not found or not a directory | Verify `--codify <source-path>` exists |
| E102 | error | Codify: package directory exists without `--overwrite` | Re-run with `--overwrite` or a new `--output-dir` |
| W004 | warning | Codify: animation-tokens.json not found (optional) | Extraction continues without animation tokens |
</error_codes>

<success_criteria>
Direct mode:
- [ ] Command resolved from input (routing table or free text matching)
- [ ] Prerequisites satisfied (UI specs loaded, PRODUCT.md present)
- [ ] Workflow file read and executed completely
- [ ] TodoWrite tracking created and all phases marked completed
- [ ] Next-step suggestion provided

Chain mode:
- [ ] Chain steps resolved and preview displayed
- [ ] Session status.json created in `.workflow/.maestro/ui-craft-*/`
- [ ] TodoWrite items created for all chain steps
- [ ] Each step executed with workflow file read
- [ ] Quality gates parsed with actual scores (not estimated)
- [ ] Refine loops executed when gate fails (up to max-loops)
- [ ] status.json updated with `status: "completed"` and final scores
- [ ] Final report with scores, trend, and commands executed

Codify mode:
- [ ] UI specs loaded via `spec load --category ui` (if available)
- [ ] Source path validated and file discovery completed
- [ ] design-tokens.json generated with color, typography, spacing tokens
- [ ] layout-templates.json generated with component patterns (universal/specialized)
- [ ] animation-tokens.json generated (optional, W004 if missing)
- [ ] preview.html + preview.css generated as interactive showcase
- [ ] knowhow-manifest.json created with AST/DCS assets and spec entries
- [ ] codify-to-knowhow called and completed successfully (after Phase 3→4 confirmation)
- [ ] Temporary workspace cleaned up
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Direct teach complete | `maestro impeccable shape` |
| Direct shape complete | `maestro impeccable craft` |
| Direct craft complete | `maestro impeccable critique` |
| Direct critique findings | `maestro impeccable polish` or targeted fix command |
| Chain complete | Review final scores, consider `maestro impeccable improve` for iteration |
| Chain paused/interrupted | `maestro impeccable continue` to resume |
| Codify complete | Use extracted tokens in `maestro impeccable craft` for new builds |
| Codify design system needs refinement | `maestro impeccable document` to regenerate DESIGN.md |
| Codify knowledge assets persisted | `maestro search --type knowhow "design system"` to verify |
</completion>
