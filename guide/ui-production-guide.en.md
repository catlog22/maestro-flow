# UI Production System Guide

The Maestro UI production pipeline covers the full lifecycle from design prototypes to code implementation, forming a complete `design -> craft -> codify` workflow through three core commands.

---

## 1. Overview

### Pipeline Architecture

```
maestro-ui-craft --chain build   maestro-ui-craft         maestro-ui-codify
  Design prototype gen            Automated production      Design system codification
       |                               |                        |
       v                               v                        v
  MASTER.md                       impeccable skill          design-tokens.json
  design-tokens.json              critique/audit scoring     animation-tokens.json
  animation-tokens.json           Auto-iteration loop        layout-templates.json
  selection.json                  Quality gate driven         knowhow asset persistence
       |                        |                        |
       +------------------------+------------------------+
                        Knowledge consolidation
```

### Integration with Phase Pipeline

The UI production system's position within the Maestro Phase pipeline:

```
analyze -> ui-design -> plan -> execute -> verify
                         ^
                  Design precedes planning
```

The `design-ref/` directory produced by `maestro-ui-craft --chain build` is automatically detected by `maestro-plan`, which injects design tokens and specifications into the execution tasks' `read_first[]` list, ensuring implementations strictly follow design intent.

### Integration with impeccable skill

`maestro-ui-craft` is an orchestration layer for the impeccable skill. Impeccable provides 23 commands across 6 categories (build, evaluate, enhance, harden, live, setup). `maestro-ui-craft` chains these commands together, driving an automated iteration loop through critique/audit scoring.

---

## 2. Command Reference

### 2.1 maestro-ui-craft --chain build — UI Design Prototypes

**Purpose**: Generate design prototypes with multiple style variants. After user selection, codify them into a consumable design system. (Formerly `maestro-ui-design`, now part of `maestro-ui-craft`.)

**Command Syntax**:

```
/maestro-ui-craft "<phase|topic>" --chain build [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y]
```

**Parameter Reference**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<phase\|topic>` | Required | Phase number enters phase mode; text enters scratch mode |
| `--styles N` | 3 | Number of style variants (2-5) |
| `--stack <stack>` | html-tailwind | Technology stack constraint |
| `--targets <pages>` | Auto-inferred | Comma-separated page targets |
| `--layouts N` | 2 | Layout variants per target (1-3, full mode only) |
| `--refine` | false | Refine existing design |
| `--persist` | false | Generate design with hierarchical page coverage |
| `--full` | false | Force full 4-layer pipeline |
| `-y` | false | Auto mode, skip interaction |

#### Automatic Workflow Selection

The command automatically routes to different workflows based on the environment:

| Condition | Workflow | Description |
|-----------|----------|-------------|
| `--full` flag | ui-design.md (full pipeline) | Force 4-layer pipeline: style -> animation -> layout -> assembly |
| ui-ux-pro-max available | ui-style.md (lightweight delegation) | Delegate to skill for design system generation, fast and lightweight |
| ui-ux-pro-max unavailable | ui-design.md (full pipeline) | Self-contained fallback path |

#### Design Process (Lightweight Path)

1. **Gather Requirements**: Extract product type, industry, audience, and style keywords from the phase's context.md, brainstorm, and spec
2. **Generate Variants**: Call ui-ux-pro-max `--design-system` to generate N comparative style proposals
3. **User Selection**: Display summaries of each proposal (patterns, colors, typography, motion); user picks the winner
4. **Codify Design**:
   - Extract design-tokens.json (OKLCH colors, typography, spacing, component styles)
   - Generate animation-tokens.json (duration, easing, transitions, keyframes)
   - Map to design-ref/ directory structure
   - Write selection.json recording selection metadata

#### design-ref/ Directory Structure

```
design-ref/
  MASTER.md                 # Complete design system specification
  design-tokens.json        # Production-grade design tokens (OKLCH colors)
  animation-tokens.json     # Motion tokens
  selection.json            # User selection record
  layout-templates/         # Layout templates
  prototypes/               # HTML prototype files
    variant-1-system.md     # Style variant raw output
    home.html               # Page prototype
```

#### PRODUCT.md Format

`PRODUCT.md` is the impeccable skill's project context file, describing product positioning, target users, and design direction. When the file is missing, the craft pipeline automatically triggers the teach command for interactive creation.

#### Next Steps Routing

| Next Step | Command |
|-----------|---------|
| Plan based on design | `/maestro-plan {phase}` |
| Refine selected design | `/maestro-ui-craft "{phase}" --chain improve` |
| Analyze before planning | `/maestro-analyze {phase}` |

---

### 2.2 maestro-ui-craft — UI Automated Production Pipeline

**Purpose**: Orchestrate the impeccable skill's 23 commands into an automated quality-gated pipeline, driven by critique/audit scoring loops.

**Command Syntax**:

```
/maestro-ui-craft <intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y]
```

**Parameter Reference**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<intent\|target>` | Required | Intent description or target path |
| `--chain <type>` | Auto-routed | Force specific chain type |
| `--enhance <cmd>` | — | Specific command for the enhance chain |
| `--threshold <score>` | 26 | Critique pass threshold (max 40) |
| `--max-loops <n>` | 3 | Maximum quality gate iterations |
| `-y` | false | Auto mode |

#### Chain Type Definitions

| Chain | Execution Sequence | Gate Condition |
|-------|-------------------|----------------|
| **build** | teach? -> shape -> craft -> critique -> [refine loop] -> audit -> polish | critique >= threshold AND P0 == 0 |
| **improve** | critique -> [refine loop] -> polish -> audit | critique >= threshold AND P0 == 0 |
| **enhance** | {cmd} -> critique -> polish (if needed) | critique >= threshold |
| **harden** | harden -> audit -> polish | audit >= threshold x 0.5 |
| **live** | live | No gate (interactive) |

`teach?` indicates conditional execution — only triggered when PRODUCT.md is missing.

#### Intent Auto-Routing

| Intent Keywords | Chain |
|----------------|-------|
| 新建、create、build、从零、landing、feature、page | build |
| 改进、improve、fix、优化、iterate、better、迭代 | improve |
| 动画、颜色、排版、animate、color、type、bold、delight、enhance | enhance |
| 生产、production、harden、上线、ship、edge case、i18n | harden |
| 实时、live、browser、浏览器、variant | live |

Explicit `--chain` takes priority over auto-routing. When the intent is ambiguous and `-y` is not set, the user will be prompted for confirmation.

#### Score-Driven Loop Mechanism

Core innovation — critique/audit score-driven automatic iteration:

```
Execute gate command (critique/audit)
       |
       v
  Parse score
  - critique: N/40 (Nielsen's heuristic)
  - audit: N/20 (dimension score)
  - P0/P1 issue count
       |
       v
  Evaluate gate
  - critique_pass = (score >= threshold) AND (P0_count == 0)
  - audit_pass    = (score >= threshold * 0.5) AND (P0_count == 0)
       |
       +-- PASS ---> Continue to next chain step
       |
       +-- FAIL ---> Auto-select fix commands
                    |
                    +-- Extract suggested commands from P0/P1 findings
                    +-- No suggestions -> use category mapping table
                    +-- Deduplicate, max 3 commands per iteration
                    +-- Sort by priority (P0 first)
                    +-- Execute fix commands sequentially
                    +-- Re-run gate command
                         |
                         +-- Reached max_loops ---> Force continue with warning
```

#### Finding-to-Command Mapping Table

When critique/audit does not provide explicit suggestions, commands are auto-selected by issue category:

| Issue Category | Command |
|---------------|---------|
| Visual hierarchy, layout, spacing, alignment | layout |
| Color, contrast, palette, monochrome | colorize |
| Typography, fonts, readability, hierarchy | typeset |
| Animation, motion, transitions, micro-interactions | animate |
| Copy, labels, error messages, UX writing | clarify |
| Responsive, mobile, breakpoints, touch targets | adapt |
| Performance, loading, speed, bundle size | optimize |
| Complexity, overload, clutter, cognitive load | distill |
| Boring, conservative, generic, lacking personality | bolder |
| Over-the-top, overwhelming, overstimulating | quieter |
| Onboarding, empty states, first-run, activation | onboard |
| Edge cases, i18n, error handling, overflow | harden |
| Personality, memorability, delight, surprise | delight |

The following commands are never auto-selected (structural/interactive): teach, shape, craft, live, document, extract, overdrive, critique, audit.

#### State Machine

```
S_PARSE --> S_SETUP --> S_CHAIN --> S_GATE --> S_REPORT
                            |           |
                            |    +------+
                            |    v
                            |  S_REFINE --> S_GATE
                            |
                            +---- (next step) --> S_GATE
```

#### Output Artifacts

Craft outputs are produced by impeccable commands modifying source files directly, with no additional intermediate artifacts. Key state is tracked via TodoWrite for progress monitoring.

#### Completion Report

A standard report is output upon execution completion:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Chain complete: {chain_type}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Critique : {score}/40 (trend: ↗/→/↘)
 Audit    : {score}/20
 Loops    : {total_iterations}
 Commands : {executed_command_list}

 Status   : PASS | PARTIAL — N issues remain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 2.3 maestro-ui-codify — UI Codification

**Purpose**: Reverse-engineer a design system from existing source code, generate a reference package, and persist it as a knowledge asset.

**Command Syntax**:

```
/maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]
```

**Parameter Reference**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<source-path>` | Required | Source code directory containing CSS/SCSS/JS/TS/HTML |
| `--package-name <name>` | Auto-generated | Reference package name |
| `--output-dir <path>` | `.workflow/reference_style` | Output directory |
| `--overwrite` | false | Allow overwriting existing package directory |

#### 4-Phase Pipeline

```
Phase 1 (inline)        Phase 2 (3 parallel Agents)  Phase 3 (Agent)         Phase 4 (persistence)
  Parameter validation    +-- Style Agent              Copy tokens +           Manifest +
  |-- Parse params        |-- Animation Agent          generate preview        codify-to-knowhow
  |-- Validate src path   +-- Layout Agent
  |-- Package name resolve  v                           v                       v
  +-- Workspace prep      design-tokens.json           preview.html            knowhow-manifest.json
                          animation-tokens.json         preview.css             -> knowhow files
                          layout-templates.json                                 -> spec entries
```

**Phase 1 — Validation & Preparation**: Parameter validation, source path verification, package name generation, workspace creation.

**Phase 2 — Parallel Extraction**: Three agents run simultaneously:
- **Style Agent**: Extract colors (OKLCH), typography, spacing, shadows, component styles
- **Animation Agent**: Extract duration, easing, transitions, keyframes, interaction motion
- **Layout Agent**: Extract component layout patterns (generic/specific)

**Phase 3 — Reference Package**: Copy token files to the package directory, generate `preview.html` + `preview.css` interactive showcase.

**Phase 4 — Knowledge Persistence**: Generate `knowhow-manifest.json`, invoke `codify-to-knowhow` skill to persist the design system as knowledge assets and spec entries.

#### Output Artifacts

```
.workflow/reference_style/{package-name}/
  design-tokens.json        # Color, typography, spacing, component style tokens
  animation-tokens.json     # Motion tokens (optional)
  layout-templates.json     # Layout patterns
  preview.html              # Interactive design showcase
  preview.css               # Showcase styles
  knowhow-manifest.json     # Knowledge asset manifest
```

---

## 3. Complete Workflows

### design -> craft -> codify Chain

This is the standard UI production pipeline, with three commands executed in sequence:

```bash
# Step 1: Design prototypes
/maestro-ui-craft "1" --chain build --styles 3 --targets home,dashboard,settings

# Step 2: Automated production based on design-ref (build chain)
/maestro-ui-craft "新建 landing page" --chain build --threshold 28

# Step 3: Extract design system from implementation code as reference
/maestro-ui-codify src/components --package-name my-design-system
```

**Data Flow**:
- `ui-design` produces `design-ref/` for `maestro-plan` to consume
- `ui-craft` directly operates on source code through the impeccable skill
- `ui-codify` reverse-engineers design knowledge from finished code, closing the loop

### Integration with Phase Pipeline

UI design-driven Phase pipeline (`ui-craft-build` chain graph):

```
ui-design -> plan -> execute -> verify -> check_verify
```

Corresponding command sequence:

```bash
# Design-driven full Phase pipeline
/maestro-ui-craft "1" --chain build  # Design first
/maestro-plan 1                # Plan based on design
/maestro-execute 1             # Execute implementation
/maestro-verify 1              # Verify goal completion
```

The key value of design preceding planning: `maestro-plan` detects the existence of `design-ref/MASTER.md` and injects design tokens and specifications into each execution task's `read_first[]`, ensuring implementations strictly follow design intent.

### Craft-Only Mode (Design Already Available)

If the design is already ready or the design phase is not needed:

```bash
# Improve existing UI
/maestro-ui-craft "优化首页布局和色彩" --chain improve

# Enhance motion
/maestro-ui-craft "添加交互动画" --chain enhance --enhance animate

# Production hardening
/maestro-ui-craft "准备上线" --chain harden --threshold 30
```

### Codify-Only Mode (Reverse Engineering)

Extract a design system from an existing codebase:

```bash
# Extract design system from component library
/maestro-ui-codify src/ui --package-name company-components

# Extract and overwrite existing reference
/maestro-ui-codify src/styles --package-name v2-design --overwrite
```

---

## 4. Usage Scenarios

### When to Use Which Command

| Scenario | Command | Description |
|----------|---------|-------------|
| New project needs UI design from scratch | `maestro-ui-craft --chain build` | Generate multiple style proposals, codify after selection |
| Have design, need high-quality implementation | `maestro-ui-craft --chain build` | Fully automated from teach to polish |
| Existing page needs optimization | `maestro-ui-craft --chain improve` | Critique-driven iterative improvement |
| Need to enhance motion/typography/color | `maestro-ui-craft --chain enhance` | Single-dimension enhancement + critique validation |
| Pre-launch hardening | `maestro-ui-craft --chain harden` | Audit-driven edge case handling |
| Existing code needs design spec extraction | `maestro-ui-codify` | Reverse-engineer and persist as knowledge assets |
| Need cross-project design system reuse | `maestro-ui-codify` + knowhow | Extract and share via knowledge system |

### Single Command vs. Pipeline Mode

**Single command** is suitable for:
- Quick exploration of design direction (`ui-design` scratch mode)
- Targeted optimization of a specific aspect (`ui-craft --chain enhance`)
- Extracting design assets from existing code (`ui-codify`)

**Pipeline mode** is suitable for:
- Brand-new feature UI production (`design -> craft -> codify`)
- Phase-level complete delivery (`ui-craft-build` chain graph)
- Iterative loops requiring quality assurance (`craft`'s auto refine loop)

### Common Combinations

```bash
# Quick prototype validation (shortest path)
/maestro-ui-craft "Landing Page" --chain build -y --styles 2

# Complete new page production
/maestro-ui-craft "2" --chain build --targets home,profile,settings
/maestro-ui-craft "新建用户中心" --chain build -y

# Iterative optimization of existing page
/maestro-ui-craft "优化 dashboard 布局" --chain improve --threshold 30 --max-loops 5

# Motion enhancement
/maestro-ui-craft "丰富交互体验" --chain enhance --enhance animate

# Design knowledge consolidation
/maestro-ui-codify src --package-name project-design-v1
```
