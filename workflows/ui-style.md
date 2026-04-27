# UI Style Workflow (ui-ux-pro-max powered)

Lightweight design workflow delegating to ui-ux-pro-max for design system generation.
Command owns: requirements gathering, variant presentation, user selection, solidification.

Pipeline position: analyze -> **ui-design** -> plan -> execute -> verify

---

## Prerequisites

- `.workflow/` directory initialized
- Phase directory OR scratch mode
- Python 3 + ui-ux-pro-max skill installed (SKILL_PATH resolved by command)

---

## Phase Resolution

```
If argument is phase number/slug:
  Resolve PHASE_DIR from state.json artifact registry. Error if not found.
  SCRATCH_MODE = false

If argument is topic text (scratch mode):
  PHASE_DIR = .workflow/scratch/ui-design-{slug}-{YYYYMMDD}
  Create directory + minimal index.json (type="ui-design", goal=topic).
  SCRATCH_MODE = true
```

---

## Flag Processing

| Flag | Default | Effect |
|------|---------|--------|
| `--styles N` | 3 | Number of style variants (2-5) |
| `--stack <stack>` | html-tailwind | Tech stack for guidelines |
| `--targets <pages>` | (inferred) | Comma-separated page targets |
| `--persist` | false | Save with hierarchical page overrides |
| `-y` | false | Auto mode: skip interactive selection |

---

### Step 1: Setup

**1a. Parse flags** from $ARGUMENTS: `--styles N` (2-5, default 3), `--stack` (default html-tailwind), `--targets` (comma-separated), `--persist`, `-y`/`--yes`.

**1b. Create output directories:** `${PHASE_DIR}/design-ref/prototypes/` and `design-ref/layout-templates/`.

**1c. Display banner** with phase, style count, stack, targets.

---

### Step 2: Gather Requirements Context

Gather context from available sources:
- **2a.** Phase context.md: product type, industry, audience, preferences
- **2b.** Brainstorm results: visual direction keywords, persona, product type
- **2c.** Spec reference (index.json.spec_ref): UI-relevant requirements

**2d. Synthesize design brief:** product_type, industry, style_keywords, audience.

**2e. Infer targets** from phase goal / brainstorm / spec. Fallback: `["home"]`.

**2f. Interactive brief review** (skip if -y): present brief, allow adjustments.

---

### Step 3: Generate Style Variants via ui-ux-pro-max

**Purpose:** Call ui-ux-pro-max multiple times with different keyword emphasis to produce contrasting variants.

#### 3a. Build variant keyword sets

Generate `styleCount` contrasting keyword sets (e.g., conservative/expressive/premium directions).

#### 3b. Call ui-ux-pro-max for each variant (parallel)

```bash
# Per variant — design system
python3 "${SKILL_PATH}" "${variant_keywords[N]}" --design-system -p "${project_name}" -f markdown

# Once — stack guidelines + domain supplements
python3 "${SKILL_PATH}" "layout responsive form component" --stack ${stack}
python3 "${SKILL_PATH}" "${industry} ${product_type}" --domain color
python3 "${SKILL_PATH}" "accessibility animation interaction" --domain ux
```

Save variants to `${PHASE_DIR}/design-ref/prototypes/variant-{N}-system.md`.

#### 3c. Present variants (skip if -y)

Display each variant summary (pattern, colors, typography, effects, anti-patterns).
User selects: [1-N | "redo" | "all"]. Auto mode selects variant 1.

---

### Step 4: Solidify Selected Design

**Purpose:** Map ui-ux-pro-max output to design-ref/ structure for downstream plan/execute.

#### 4a. Persist via ui-ux-pro-max

```bash
python3 "${SKILL_PATH}" "${selected_variant_keywords}" --design-system --persist -p "${project_name}"
# If --persist + targets: generate page overrides per target with --page "${target}"
```

#### 4b. Generate design-tokens.json

Spawn agent to extract structured tokens from MASTER.md into `${PHASE_DIR}/design-ref/design-tokens.json`.

**Token schema keys:** colors (brand/surface/semantic/text/border in OKLCH), typography (family/size/weight/line_height/combinations), spacing, border_radius, shadows, component_styles (button/card/input), breakpoints.

**Rules:** hex/rgb to OKLCH, var() references in combinations/components, WCAG AA contrast (4.5:1 text, 3:1 UI).

#### 4c. Generate animation-tokens.json

Spawn agent to generate `${PHASE_DIR}/design-ref/animation-tokens.json` from design-tokens + MASTER.md.

**Token schema keys:** duration (instant-slower), easing (ease-out/ease-in-out/spring), transitions, keyframes, interactions (hover states), reduced_motion (prefers-reduced-motion strategy).

#### 4d. Map files to design-ref/

Copy `design-system/MASTER.md` and `design-system/pages/*.md` (if generated) to `${PHASE_DIR}/design-ref/`.

#### 4e. Write selection.json

```json
{
  "selected_variant": 1,
  "variant_name": "{pattern_name} — {style_name}",
  "selection_mode": "user_choice|auto",
  "source": "ui-ux-pro-max",
  "keywords": "{selected_variant_keywords}",
  "selected_at": "ISO timestamp"
}
```

#### 4f. Optional: Generate HTML prototype

For each target, spawn agent to create `${PHASE_DIR}/design-ref/prototypes/${target}.html` from design-tokens + animation-tokens + MASTER.md.

**Rules:** standalone HTML with embedded CSS, realistic content (not lorem ipsum), SVG icons (Heroicons/Lucide CDN), cursor-pointer on clickables, responsive (375/768/1024px), WCAG AA, prefers-reduced-motion.

#### 4g. Update index.json

```json
{
  "design_ref": {
    "status": "selected",
    "variant": "{variant_name}",
    "source": "ui-ux-pro-max",
    "master": "design-ref/MASTER.md",
    "tokens": "design-ref/design-tokens.json",
    "animation": "design-ref/animation-tokens.json",
    "prototypes": "design-ref/prototypes/",
    "created_at": "ISO timestamp"
  }
}
```

---

## Escalation

If the design needs exceed ui-ux-pro-max capabilities (e.g., multi-layout matrix, 6D attribute space exploration, full style x layout x target prototype grid), suggest:

```
For advanced multi-layer design exploration:
  Skill({ skill: "maestro-ui-design", args: "{phase} --full" })
```

---

## Integration with maestro-plan

Same as ui-design.md — plan.md Step 4b detects `design-ref/MASTER.md` and includes tokens in task `read_first[]`.

---

## Error Handling

| Error | Action |
|-------|--------|
| ui-ux-pro-max returns empty | Retry with broader keywords, then abort |
| Token extraction agent fails | Retry once, warn if still fails |
| User cancels selection | Save all variants, exit without solidification |

---

## State Updates

| When | Field | Value |
|------|-------|-------|
| Step 1 start | index.json.status | "designing" |
| Step 4 complete | index.json.design_ref.status | "selected" |
| Step 4 complete | index.json.updated_at | Current timestamp |
