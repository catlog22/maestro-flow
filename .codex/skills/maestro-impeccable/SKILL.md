---
name: maestro-impeccable
description: "Use when designing, auditing, polishing, or improving frontend UI — websites, dashboards, landing pages, components"
argument-hint: "<command|chain|intent> [target] [flags]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Sequential UI design skill. Parse input → prerequisites → read workflow file → execute → track via status.json.

- **Direct**: single command via workflow file
- **Chain**: orchestrate command sequence with quality gates
- **Search**: query design knowledge base via CLI
</purpose>

<context>
$ARGUMENTS first word determines mode:

| First Word | Mode |
|------------|------|
| Known command (see routing table) | Direct |
| Chain name: build, redesign, improve, enhance, launch, harden, foundation, live | Chain |
| continue / next / -c | Resume |
| search | Search: `maestro impeccable search "$REST"` |
| Free text (concrete task) | Direct craft — has specific target + specs/reference |
| Free text (project intent) | Intent → classify → chain |
| (empty) | Menu: show commands by category |

**Common flags**: `-y` (auto-confirm), `--skip-harvest`, `--skip-design`, `--styles <N>`
**Chain flags**: `--threshold <N>` (default 26/40), `--max-loops <N>` (default 3)
</context>

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
- `{cmd...}` = enhance supports multiple commands, comma-separated: `enhance colorize,typeset target`

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

Ambiguous + no `-y` → `request_user_input`.

### Layer 3: Concrete build task → Direct craft

Layer 1+2 both did not match, but intent is to build/create a specific thing:
- Contains a specific file path or target (`d:\path`, `src/pages/`, `index.html`)
- Contains detailed visual specs (layout, style, color scheme)
- Contains reference material (`based on...`, `like...`, `similar to...`)

→ Route to **craft** (Direct)

<invariants>
1. Prerequisites before any design work — never skip context loading or register detection
2. Read workflow file before execution — never execute a command without loading its .md
3. Interactive gates respected — teach, shape, craft retain user confirmation gates
4. status.json before chain steps — session created before any chain step runs
5. **Quality gate enforcement** — score MUST be parsed from critique/audit output (not assumed). P0 count MUST be extracted. Do NOT skip quality gate steps or mark as "passed" without parsing actual score.
6. **Chain completion verification** — all non-skipped steps MUST be executed (TodoWrite all completed). status.json MUST be updated with status: "completed" and final scores.
</invariants>

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
4. **Progress tracking**: create todo items for each major phase in the workflow file
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
3. Create session: `.workflow/.maestro/ui-craft-{YYYYMMDD-HHmmss}/status.json`
   ```json
   { "chain_type": "...", "target": "...", "steps": [...], "current_step": 0,
     "gate_history": [], "loop_count": 0, "status": "running" }
   ```
4. **Init tracking**: create todo items for all chain steps
   - One item per step, format: `[chain] step N: impeccable:{command} — {description}` (use `impeccable:` prefix to disambiguate from Direct command items)
   - If conditional step is skipped, immediately mark completed
   - Quality gate steps include threshold: `[chain] step 5: impeccable:critique ◆ gate ≥26/40`
5. For each step:
   - Read `~/.maestro/workflows/impeccable/{command}.md` → execute
   - **Step start**: mark current step in_progress
   - **Step done**: mark completed + update status.json (`current_step`, step `status`)
   - **Step failed**: mark completed (with note) + record reason
6. **Quality gate** (critique/audit steps):
   - Parse score: critique `**Total** | | **N/40**`, audit `**Total** | | **N/20**`
   - Count `[P0]` / `[P1]` tags
   - Pass: score ≥ threshold AND P0 == 0 → advance
   - Fail: collect suggested commands from findings → execute → re-gate
   - Max loops exceeded → force advance with warning
   - Record gate result in current step notes (score, P0/P1 count, pass/fail)
7. Final report: scores + trend + commands executed

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
