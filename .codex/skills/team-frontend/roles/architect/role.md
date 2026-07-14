---
role: architect
prefix: ARCH
inner_loop: false
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Frontend Architect

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Scope | Extracted from task description (tokens/components/full) | No (default: full) |
| Design intelligence | <session>/analysis/design-intelligence.json | Yes |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path and scope from task description
2. Load design intelligence from analyst output
3. Load .msg/meta.json for shared state (industry_context, design_intelligence)
4. Detect existing project structure via Glob `src/**/*`

**Fail-safe**: If design-intelligence.json not found, use default token values and log warning.

## Phase 3: Architecture Design

**Scope selection**:

| Scope | Output |
|-------|--------|
| `tokens` | Design token system only |
| `components` | Component specs only |
| `full` | Both tokens and components + project structure |

**Step 1: Design Token System** (scope: tokens or full):

Generate `<session>/architecture/design-tokens.json` with categories:

| Category | Content | Source |
|----------|---------|--------|
| `color` | Primary, secondary, background, surface, text, CTA | ui-ux-pro-max |
| `typography` | Font families, font sizes (scale) | ui-ux-pro-max |
| `spacing` | xs through 2xl | Standard scale |
| `border-radius` | sm, md, lg, full | Standard scale |
| `shadow` | sm, md, lg | Standard elevation |
| `transition` | fast, normal, slow | Standard durations |

Use `$type` + `$value` format (Design Tokens Community Group). Support light/dark mode via nested values.

**Step 2: Component Architecture** (scope: components or full):

Generate component specs in `<session>/architecture/component-specs/`:
- Design reference (style, stack)
- Props table (name, type, default, description)
- Variants table
- Accessibility requirements (role, keyboard, ARIA, contrast)
- Anti-patterns to avoid (from design intelligence)

**Step 3: Project Structure** (scope: full):

Generate `<session>/architecture/project-structure.md` with stack-specific layout:

| Stack | Key Directories |
|-------|----------------|
| react | src/components/, src/pages/, src/hooks/, src/styles/ |
| nextjs | app/(routes)/, app/components/, app/lib/, app/styles/ |
| vue | src/components/, src/views/, src/composables/, src/styles/ |
| html-tailwind | src/components/, src/pages/, src/styles/ |

## Phase 4: Self-Review

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| JSON validity | Parse design-tokens.json | No errors |
| Required categories | Check color, typography, spacing | All present |
| Anti-pattern compliance | Token values vs anti-patterns | No violations |
| Component specs complete | Each has props + accessibility | All complete |
| File existence | Verify all planned files | All present |

Update .msg/meta.json: merge `design_token_registry` and `component_inventory` keys.
