---
title: "UI Production System Guide"
---

The Maestro UI production pipeline covers the full lifecycle from design prototypes to code implementation, forming a complete `design -> craft -> codify` workflow through three core commands.

---

## 1. Overview

### Pipeline Architecture

```
impeccable --chain build  →  impeccable (auto pipeline)  →  ui-codify
  design-ref/                critique/audit driven iteration   knowhow assets
```

**Phase pipeline position**: `analyze -> ui-design -> plan -> execute -> verify` (design precedes planning)

`maestro-impeccable` is an orchestration layer for the impeccable skill (23 commands / 6 categories), driving automated iteration loops via critique/audit scoring. The `design-ref/` produced by `--chain build` is auto-detected by `maestro-plan`, which injects design tokens into execution tasks' `read_first[]`.

---

## 2. Command Reference

### 2.1 maestro-impeccable --chain build — UI Design Prototypes

Generate design prototypes with multiple style variants. After user selection, codify into a consumable design system. (Formerly `maestro-ui-design`, now merged.)

```
/maestro-impeccable "<phase|topic>" --chain build [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<phase\|topic>` | Required | Phase number → phase mode; text → scratch mode |
| `--styles N` | 3 | Number of style variants (2-5) |
| `--stack` | html-tailwind | Technology stack constraint |
| `--targets` | Auto-inferred | Comma-separated page targets |
| `--layouts N` | 2 | Layout variants per target (1-3, full mode only) |
| `--full` | false | Force full 4-layer pipeline |
| `-y` | false | Skip interaction |

**Workflow routing**: `--full` → full pipeline | ui-ux-pro-max available → lightweight delegation | otherwise → fallback full pipeline

**Design process**: Gather requirements → call ui-ux-pro-max for N variants → user selects → codify token files

**design-ref/ artifacts**: `MASTER.md`, `design-tokens.json` (OKLCH), `animation-tokens.json`, `selection.json`, `layout-templates/`, `prototypes/`

**Next steps**:

| Next Step | Command |
|-----------|---------|
| Plan based on design | `/maestro-plan {milestone}` |
| Refine design | `/maestro-impeccable "{phase}" --chain improve` |

---

### 2.2 maestro-impeccable — UI Automated Production Pipeline

Orchestrate the impeccable skill's 23 commands into an automated quality-gated pipeline, driven by critique/audit scoring loops.

```
/maestro-impeccable <intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<intent\|target>` | Required | Intent description or target path |
| `--chain` | Auto-routed | Force specific chain type |
| `--enhance` | — | Specific command for enhance chain |
| `--threshold` | 26 | Critique pass threshold (max 40) |
| `--max-loops` | 3 | Maximum quality gate iterations |

#### Chain Types

| Chain | Execution Sequence | Gate Condition |
|-------|-------------------|----------------|
| **build** | teach? → shape → craft → critique → [loop] → audit → polish | score >= threshold AND P0 == 0 |
| **improve** | critique → [loop] → polish → audit | score >= threshold AND P0 == 0 |
| **enhance** | {cmd} → critique → polish? | score >= threshold |
| **harden** | harden → audit → polish | audit >= threshold x 0.5 |
| **live** | live | No gate (interactive) |

`teach?` only triggers when PRODUCT.md is missing.

#### Intent Auto-Routing

| Intent Keywords | Chain |
|----------------|-------|
| 新建、create、build、from-scratch、landing、page | build |
| 改进、improve、fix、optimize、iterate | improve |
| 动画、animate、color、typography、enhance | enhance |
| 生产、production、harden、ship、i18n | harden |
| 实时、live、browser、interactive | live |

Explicit `--chain` takes priority over auto-routing.

#### Score-Driven Loop

```
Execute gate (critique/audit) → Parse score (critique: N/40, audit: N/20, P0/P1)
  → Evaluate gate (score >= threshold AND P0 == 0)
    → PASS: continue next step
    → FAIL: auto-select fix commands → execute sequentially → re-run gate → warn at max_loops
```

<details>
<summary>Full Mapping Table: Finding → Command</summary>

| Issue Category | Command |
|---------------|---------|
| Visual hierarchy, layout, spacing, alignment | layout |
| Color, contrast, palette | colorize |
| Typography, fonts, readability | typeset |
| Animation, motion, transitions, micro-interactions | animate |
| Copy, labels, error messages | clarify |
| Responsive, mobile, breakpoints | adapt |
| Performance, loading, speed | optimize |
| Complexity, overload, cognitive load | distill |
| Boring, lacking personality | bolder |
| Overwhelming, overstimulating | quieter |
| Onboarding, empty states, first-run | onboard |
| Edge cases, i18n, error handling | harden |
| Personality, delight, surprise | delight |

Never auto-selected: teach, shape, craft, live, document, extract, overdrive, critique, audit
</details>

#### State Machine

```
S_PARSE → S_SETUP → S_CHAIN → S_GATE → S_REPORT
                       ↑          │
                       └─ S_REFINE ┘
```

#### Completion Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Chain complete: {chain_type}
 Critique : {score}/40 (trend: ↗/→/↘) | Audit: {score}/20
 Loops: {iterations} | Commands: {list}
 Status: PASS | PARTIAL — N issues remain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 2.3 maestro-ui-codify — UI Codification

Reverse-engineer a design system from existing source code, generate a reference package, and persist as a knowledge asset.

```
/maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<source-path>` | Required | Source directory with CSS/SCSS/JS/TS/HTML |
| `--package-name` | Auto-generated | Reference package name |
| `--output-dir` | `.workflow/reference_style` | Output directory |
| `--overwrite` | false | Overwrite existing package directory |

#### 4-Phase Pipeline

| Phase | Content | Output |
|-------|---------|--------|
| **Phase 1** Validate | Parameter validation, path verification, workspace setup | — |
| **Phase 2** Parallel Extract | Style (color/typography/spacing) + Animation (duration/easing) + Layout (patterns) | 3 token JSON files |
| **Phase 3** Reference Package | Copy tokens + generate interactive showcase | `preview.html` + `preview.css` |
| **Phase 4** Persist | `codify-to-knowhow` skill | `knowhow-manifest.json` → knowhow + spec |

---

## 3. Complete Workflows

### design → craft → codify Chain

```bash
# Step 1: Design prototypes
/maestro-impeccable "1" --chain build --styles 3 --targets home,dashboard,settings
# Step 2: Automated production (build chain)
/maestro-impeccable "new landing page" --chain build --threshold 28
# Step 3: Reverse-engineer design system
/maestro-ui-codify src/components --package-name my-design-system
```

**Data flow**: `ui-design` → `design-ref/` → consumed by `maestro-plan` → `ui-craft` operates on source → `ui-codify` extracts knowledge, closing the loop.

### Phase Pipeline Integration

```bash
/maestro-impeccable "1" --chain build  # Design first
/maestro-plan 1                         # Plan based on design
/maestro-execute 1                      # Execute implementation (with built-in verification gate E2.7)
```

### Single Command Mode

```bash
# Improve existing UI
/maestro-impeccable "optimize homepage layout" --chain improve
# Enhance motion
/maestro-impeccable "add interaction animations" --chain enhance --enhance animate
# Production hardening
/maestro-impeccable "prepare for launch" --chain harden --threshold 30
# Reverse extract
/maestro-ui-codify src/ui --package-name company-components
```

---

## 4. Usage Scenarios

| Scenario | Command | Description |
|----------|---------|-------------|
| New project, design from scratch | `impeccable --chain build` | Multi-proposal selection then codify |
| Have design, need implementation | `impeccable --chain build` | Fully automated teach → polish |
| Optimize existing page | `impeccable --chain improve` | Critique-driven iteration |
| Enhance motion/typography/color | `impeccable --chain enhance` | Single-dimension + critique validation |
| Pre-launch hardening | `impeccable --chain harden` | Audit-driven edge case handling |
| Extract design spec from code | `ui-codify` | Reverse-engineer as knowledge assets |
| Cross-project design reuse | `ui-codify` + knowhow | Extract and share via knowledge system |

```bash
# Quick prototype
/maestro-impeccable "Landing Page" --chain build -y --styles 2
# Iterative optimization
/maestro-impeccable "optimize dashboard" --chain improve --threshold 30 --max-loops 5
# Knowledge consolidation
/maestro-ui-codify src --package-name project-design-v1
```
