---
role: developer
prefix: DEV
inner_loop: true
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Frontend Developer

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Scope | Extracted from task description (tokens/components/full) | No (default: full) |
| Design intelligence | <session>/analysis/design-intelligence.json | No |
| Design tokens | <session>/architecture/design-tokens.json | Yes |
| Component specs | <session>/architecture/component-specs/*.md | No |
| Project structure | <session>/architecture/project-structure.md | No |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path and scope from task description
2. Load design tokens (required -- if missing, report to coordinator)
3. Load design intelligence for anti-patterns and guidelines
4. Load component specs and project structure
5. Detect tech stack from design intelligence `detected_stack`
6. Load .msg/meta.json for shared state

## Phase 3: Code Implementation

**Scope selection**:

| Scope | Output |
|-------|--------|
| `tokens` | CSS custom properties from design tokens |
| `components` | Component code from specs |
| `full` | Both token CSS and components |

**Step 1: Generate Design Token CSS** (scope: tokens or full):

Convert design-tokens.json to `src/styles/tokens.css`:

| JSON Category | CSS Variable Prefix |
|---------------|---------------------|
| color | `--color-` |
| typography.font-family | `--font-` |
| typography.font-size | `--text-` |
| spacing | `--space-` |
| border-radius | `--radius-` |
| shadow | `--shadow-` |
| transition | `--duration-` |

Add `@media (prefers-color-scheme: dark)` override for color tokens.

**Step 2: Implement Components** (scope: components or full):

Implementation strategy by complexity:

| Condition | Strategy |
|-----------|----------|
| <= 2 components | Direct inline Edit/Write |
| 3-5 components | Single batch implementation |
| > 5 components | Group by module, implement per batch |

**Coding standards** (mandatory):
- Use design token CSS variables -- never hardcode colors/spacing
- All interactive elements: `cursor: pointer`
- Transitions: 150-300ms via `var(--duration-normal)`
- Text contrast: minimum 4.5:1 ratio
- Include `focus-visible` styles for keyboard navigation
- Support `prefers-reduced-motion`
- Responsive: mobile-first with md/lg breakpoints
- No emoji as functional icons

## Phase 4: Self-Review

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Hardcoded colors | Scan for hex codes outside tokens.css | None found |
| cursor-pointer | Check buttons/links | All have cursor-pointer |
| Focus styles | Check interactive elements | All have focus styles |
| Responsive | Check for breakpoints | Breakpoints present |
| File existence | Verify all planned files | All present |
| Import resolution | Check no broken imports | All imports resolve |

Auto-fix where possible: add missing cursor-pointer, basic focus styles.

Update .msg/meta.json: merge `component_inventory` key with implemented file list.
