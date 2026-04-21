---
name: maestro-ui-design
description: Generate UI design prototypes with multiple styles. User selects style/palette/typography, generates design tokens, produces prototypes. Delegates to ui-ux-pro-max when available, falls back to self-contained pipeline.
argument-hint: "[topic] [-y] [--style-skill PKG]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
---

<purpose>
Two workflow paths, auto-selected by skill availability:
1. **Primary (ui-ux-pro-max)**: Lightweight -- delegates design generation, owns selection and solidification
2. **Fallback (self-contained)**: Full 4-layer pipeline (style -> animation -> layout -> assembly)

Both produce the same output contract for downstream plan/execute consumption.
</purpose>

<context>
$ARGUMENTS -- phase number or topic text, plus optional flags.

**Usage**:

```bash
$maestro-ui-design "3"                          # phase mode
$maestro-ui-design "landing page for SaaS"      # scratch mode
$maestro-ui-design -y "3 --styles 5"            # auto mode, 5 variants
$maestro-ui-design "3 --style-skill PKG --stack react"
```

**Flags**:
- `[topic]`: Phase number or topic text (scratch mode)
- `-y, --yes`: Auto mode -- skip all interactive selection
- `--style-skill PKG`: Override ui-ux-pro-max skill path
- `--styles N`: Number of style variants (default: 3, range: 2-5)
- `--stack <stack>`: Tech stack for implementation guidelines (default: html-tailwind)
- `--targets <pages>`: Comma-separated page/component targets
- `--persist`: Save design system with hierarchical page overrides
- `--full`: Force full 4-layer self-contained pipeline

When `--yes` or `-y`: Skip interactive selection, auto-pick top-scored variant, skip brief review.

**Output**: `{phase_dir}/design-ref/` with MASTER.md, design-tokens.json, animation-tokens.json, selection.json, prototypes/
</context>

<invariants>
1. **Output contract is fixed** -- both paths produce MASTER.md + design-tokens.json + animation-tokens.json + selection.json
2. **Colors in OKLCH** format in design-tokens.json
3. **WCAG AA** contrast: 4.5:1 text, 3:1 UI elements
4. **No lorem ipsum** -- use contextual placeholder content
5. **Agent calls use `run_in_background: false`** for synchronous execution
6. **Variant contrast** -- each variant must represent a distinctly different design direction
</invariants>

<execution>

### Step 1: Parse Input and Resolve Target

1. Parse flags from `$ARGUMENTS`: `--styles N`, `--stack`, `--targets`, `--persist`, `--full`, `-y`
2. **Phase mode** (number): resolve `.workflow/phases/{NN}-*/` directory
3. **Scratch mode** (text): create `.workflow/scratch/ui-design-{slug}-{date}/` with minimal index.json
4. Create output directories:
   ```bash
   mkdir -p "${PHASE_DIR}/design-ref/prototypes"
   mkdir -p "${PHASE_DIR}/design-ref/layout-templates"
   ```

### Step 2: Detect Skill Availability

```bash
SKILL_PATH=""
for path in \
  "skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/*/scripts/search.py"; do
  expanded=$(ls $path 2>/dev/null | tail -1)
  if [ -n "$expanded" ]; then SKILL_PATH="$expanded"; break; fi
done
```

- If `--style-skill PKG` provided: override `SKILL_PATH`
- If `--full`: force self-contained pipeline regardless of skill availability

### Step 3: Gather Requirements Context

1. Read phase context (context.md, brainstorm results, spec references)
2. Synthesize design brief: product_type, industry, style_keywords, audience
3. Infer targets from phase goal if not specified (fallback: "home")
4. **Interactive brief review** (skip if `-y`): present brief, allow user adjustments

### Step 4: Generate Style Variants

**If SKILL_PATH found (primary path):**

Generate `styleCount` keyword sets with intentional contrast, then call ui-ux-pro-max for each:
```bash
python3 "${SKILL_PATH}" "${variant_keywords}" --design-system -p "${project_name}" -f markdown
```

**If SKILL_PATH empty or --full (fallback path):**

Spawn ui-design-agent to generate variants using 6D attribute space (mood, density, contrast, rounding, motion, color-temp) for maximum contrast between styles.

### Step 5: Present and Select

Present all variants with key attributes (colors, typography, effects).

**Interactive** (default): user selects variant number, "redo", or "all"
**Auto** (`-y`): select variant 1

### Step 6: Solidify Selected Design

Spawn Agent for token extraction from selected variant:

```
Agent({
  subagent_type: "general-purpose",
  description: "Extract design tokens from selected variant",
  prompt: "Extract structured design-tokens.json and animation-tokens.json from the selected design variant. Colors in OKLCH format. Include component_styles, typography.combinations, spacing, border_radius, shadows, breakpoints. Animation tokens: duration, easing, transitions, keyframes, interactions, reduced_motion.",
  run_in_background: false
})
```

Write output artifacts:
- `design-ref/MASTER.md` -- complete design system specification
- `design-ref/design-tokens.json` -- production-ready tokens
- `design-ref/animation-tokens.json` -- animation system
- `design-ref/selection.json` -- selection metadata + rationale

### Step 7: Optional Prototype Generation

For each target, spawn Agent to generate standalone HTML prototype:

```
Agent({
  subagent_type: "general-purpose",
  description: "Generate HTML prototype for {target}",
  prompt: "Generate standalone HTML+CSS prototype from design-tokens.json and animation-tokens.json. Realistic content (not lorem ipsum). SVG icons via CDN. Responsive at 375/768/1024px. WCAG AA contrast.",
  run_in_background: false
})
```

### Step 8: Update State and Report

1. Update index.json with `design_ref` status
2. Display completion report:
   ```
   === UI DESIGN READY ===
   Phase:   {phase_name}
   Styles:  {style_count} variants, #{selected} selected
   Stack:   {stack}
   Targets: {target_list}

   Design System:
     MASTER.md:  {phase_dir}/design-ref/MASTER.md
     Tokens:     {phase_dir}/design-ref/design-tokens.json
     Animation:  {phase_dir}/design-ref/animation-tokens.json
     Prototypes: {phase_dir}/design-ref/prototypes/

   Next steps:
     Skill({ skill: "maestro-plan", args: "{phase}" })
     Skill({ skill: "maestro-ui-design", args: "{phase} --refine" })
   ```
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase or topic argument required | Prompt user |
| E002 | error | Phase directory not found | Check phase number |
| E003 | error | Python not available for ui-ux-pro-max | Fall back to self-contained pipeline |
| E004 | error | --refine requires existing design-ref/ | Run without --refine first |
| W001 | warning | Design system returned partial results | Retry with broader keywords |
| W002 | warning | Prototype rendering failed for one variant | Continue with remaining |
| W004 | warning | ui-ux-pro-max not found, using fallback | Proceed with self-contained pipeline |
</error_codes>

<success_criteria>
- [ ] Target resolved (phase or scratch directory)
- [ ] Style variants generated with intentional contrast
- [ ] User selected variant (or auto-picked in `-y` mode)
- [ ] MASTER.md + design-tokens.json + animation-tokens.json + selection.json written
- [ ] Colors in OKLCH format, WCAG AA contrast met
- [ ] Prototypes generated for all targets (if applicable)
- [ ] index.json updated with design_ref status
</success_criteria>
