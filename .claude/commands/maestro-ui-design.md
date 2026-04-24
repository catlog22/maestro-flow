---
name: maestro-ui-design
description: Generate UI design prototypes with multiple styles via ui-ux-pro-max, user selects winner, solidify as code reference
argument-hint: "<phase|topic> [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Generate UI design prototypes for a phase or topic. Two workflow paths, auto-selected by skill availability:

1. **Primary (ui-style.md):** Delegates design to ui-ux-pro-max skill. Generates multiple style variants via `--design-system`, user selects, solidifies as code reference. Lightweight and fast.
2. **Fallback (ui-design.md):** Self-contained 4-layer pipeline (style → animation → layout → assembly) with 6D attribute space, OKLCH tokens, layout templates, and full prototype matrix. Used when ui-ux-pro-max is unavailable or `--full` is requested.

Both paths produce the same output contract: MASTER.md + design-tokens.json + animation-tokens.json + selection.json for downstream plan/execute consumption.

Position in pipeline: analyze -> **ui-design** -> plan -> execute -> verify
</purpose>

<deferred_reading>
- [ui-style.md](~/.maestro/workflows/ui-style.md) — read when SKILL_PATH found (primary path)
- [ui-design.md](~/.maestro/workflows/ui-design.md) — read when SKILL_PATH empty or --full (fallback path)
- [index.json](~/.maestro/templates/index.json) — read when updating phase metadata
- [scratch-index.json](~/.maestro/templates/scratch-index.json) — read when operating in scratch mode
</deferred_reading>

<context>
$ARGUMENTS — phase number for phase mode, topic text for scratch mode, with optional flags.

**Flags:**
- `--styles N` — Number of style variants to generate (default: 3, range: 2-5)
- `--layouts N` — Number of layout variants per target (default: 2, range: 1-3)
- `--stack <stack>` — Tech stack for implementation guidelines (default: html-tailwind). Options: html-tailwind, react, nextjs, vue, svelte, shadcn
- `--targets <pages>` — Comma-separated page/component targets to prototype (default: inferred from phase goal or "home")
- `--refine` — Refinement mode: fine-tune an existing design-ref instead of generating from scratch (ui-design.md only)
- `--persist` — Save design system with hierarchical page overrides (MASTER.md + pages/)
- `--full` — Force full 4-layer pipeline (ui-design.md) even when ui-ux-pro-max is available
- `-y` / `--yes` — Auto mode: skip interactive selection, pick top-scored variant

**Workflow routing:**
- Default: auto-detect ui-ux-pro-max skill → if found, use `ui-style.md` (lightweight); if not, use `ui-design.md` (self-contained)
- `--full`: always use `ui-design.md` regardless of skill availability
- Flags `--layouts N` and `--refine` are only effective with `ui-design.md` (full pipeline)

**Phase mode** (number): resolves phase directory, reads context.md/brainstorm for requirements.
**Scratch mode** (text): creates `.workflow/scratch/{YYYYMMDD}-ui-design-{slug}/` for standalone exploration.

**Output artifacts (in phase or scratch directory):**
| Artifact | Description |
|----------|-------------|
| `design-ref/` | Root directory for all design outputs |
| `design-ref/MASTER.md` | Selected design system (colors, typography, spacing, effects, anti-patterns) |
| `design-ref/design-tokens.json` | Production-ready tokens (OKLCH colors, typography.combinations, component_styles, opacity) |
| `design-ref/animation-tokens.json` | Animation system (duration, easing, transitions, keyframes, interactions) |
| `design-ref/layout-templates/` | Structural layout templates per target (dom_structure + css_layout_rules) |
| `design-ref/prototypes/` | Assembled HTML/CSS prototypes (styles x layouts x targets) |
| `design-ref/prototypes/compare.html` | Interactive matrix comparison page |
| `design-ref/.intermediates/` | Analysis options, user selections, exploration data |
| `design-ref/selection.json` | User selection metadata + rationale |
| `design-ref/pages/{page}.md` | Page-specific design overrides (if --persist) |
</context>

<execution>
## Workflow Routing (skill detection)

Detect ui-ux-pro-max skill availability:

```bash
SKILL_PATH=""
for path in \
  "skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/*/scripts/search.py"; do
  expanded=$(ls $path 2>/dev/null | tail -1)
  if [ -n "$expanded" ]; then SKILL_PATH="$expanded"; break; fi
done
[ -z "$SKILL_PATH" ] && SKILL_PATH=$(find "$HOME/.claude/plugins" -path "*/ui-ux-pro-max/*/scripts/search.py" -print -quit 2>/dev/null)
```

**Route:**
- **`--full` flag present** → Follow '~/.maestro/workflows/ui-design.md' completely (forced full pipeline)
- **SKILL_PATH found** → Follow '~/.maestro/workflows/ui-style.md' completely (lightweight, delegates design to ui-ux-pro-max)
- **SKILL_PATH empty** → Follow '~/.maestro/workflows/ui-design.md' completely (self-contained 4-layer pipeline fallback)

Pass `SKILL_PATH` to the workflow when using ui-style.md.

**Report format on completion:**

```
=== UI DESIGN READY ===
Phase:   {phase_name}
Styles:  {style_count} variants, #{selected} selected
Layouts: {layout_count} per target
Targets: {target_list}
Stack:   {stack}
Matrix:  {S x L x T} = {total} prototypes

Design System:
  MASTER.md:        {scratch_dir}/design-ref/MASTER.md
  Tokens:           {scratch_dir}/design-ref/design-tokens.json
  Animation:        {scratch_dir}/design-ref/animation-tokens.json
  Layout Templates: {scratch_dir}/design-ref/layout-templates/
  Prototypes:       {scratch_dir}/design-ref/prototypes/
  Compare:          {scratch_dir}/design-ref/prototypes/compare.html

Next steps:
  /maestro-plan {phase}              -- Plan with design reference
  /maestro-ui-design {phase} --refine -- Refine selected design
  /maestro-analyze {phase}           -- Analyze before planning
```
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | Phase or topic argument required | parse_input |
| E002 | error | Phase directory not found | parse_input |
| E003 | error | Python not available (both paths need Python for ui-ux-pro-max or agent fallback) | setup |
| E004 | error | --refine requires existing design-ref/ | parse_input |
| W001 | warning | Design system generation returned partial results | generate |
| W002 | warning | Prototype rendering failed for one variant | render |
| W003 | warning | No context.md found, using phase goal only | context |
| W004 | warning | ui-ux-pro-max not found, falling back to full pipeline | routing |
</error_codes>

<success_criteria>
**Both paths (common):**
- [ ] Requirements extracted from phase context (context.md, brainstorm, spec, or user input)
- [ ] N style variants generated with contrasting design directions
- [ ] User selected preferred variant (or auto-selected in -y mode)
- [ ] MASTER.md written with complete design system specification
- [ ] design-tokens.json written with production-ready tokens (OKLCH colors, component_styles)
- [ ] animation-tokens.json written (duration, easing, transitions, keyframes)
- [ ] selection.json recorded with choice metadata
- [ ] index.json updated with design_ref status

**ui-style.md path (primary):**
- [ ] ui-ux-pro-max --design-system called with product/industry/style keywords
- [ ] Tokens extracted from ui-ux-pro-max output into structured JSON

**ui-design.md path (--full or fallback):**
- [ ] 6D attribute space used for maximum contrast between variants
- [ ] Layout templates generated per target (dom_structure + css_layout_rules)
- [ ] HTML prototypes assembled: styles x layouts x targets
- [ ] compare.html generated as interactive matrix viewer
</success_criteria>
</output>
