---
role: analyst
prefix: ANALYZE
inner_loop: false
message_types:
  success: analyze_ready
  error: error
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Requirements Analyst

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Industry context | Extracted from task description | Yes |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path, industry type, and tech stack from task description
2. Detect existing design system:

| Signal | Detection Method |
|--------|-----------------|
| Token files | Glob `**/*token*.*` |
| CSS files | Glob `**/*.css` |
| Package.json | Read for framework dependencies |

3. Detect tech stack from package.json:

| Dependency | Stack |
|------------|-------|
| `next` | nextjs |
| `react` | react |
| `vue` | vue |
| `svelte` | svelte |
| `@shadcn/ui` | shadcn |
| (none) | html-tailwind |

4. Load .msg/meta.json for shared state

## Phase 3: Design Intelligence Retrieval

Retrieve design intelligence via ui-ux-pro-max skill integration.

**Step 1: Invoke ui-ux-pro-max** (primary path):

| Action | Invocation |
|--------|------------|
| Full design system | `Skill(skill="ui-ux-pro-max", args="<industry> <keywords> --design-system")` |
| UX guidelines | `Skill(skill="ui-ux-pro-max", args="accessibility animation responsive --domain ux")` |
| Tech stack guide | `Skill(skill="ui-ux-pro-max", args="<keywords> --stack <detected-stack>")` |

**Step 2: Fallback** (if skill unavailable):
- Generate design recommendations from LLM general knowledge
- Log warning: `ui-ux-pro-max not installed. Install via: /plugin install ui-ux-pro-max@ui-ux-pro-max-skill`

**Step 3: Analyze existing codebase** (if token/CSS files found):
- Explore existing design patterns (color palette, typography scale, spacing, component patterns)

**Step 4: Competitive reference** (optional, if industry is not "Other"):
- `WebSearch({ query: "<industry> web design trends best practices" })`

**Step 5: Compile design-intelligence.json**:

| Field | Source |
|-------|--------|
| `_source` | "ui-ux-pro-max-skill" or "llm-general-knowledge" |
| `industry` | Task description |
| `detected_stack` | Phase 2 detection |
| `design_system` | Skill output (colors, typography, effects) |
| `ux_guidelines` | Skill UX domain output |
| `stack_guidelines` | Skill stack output |
| `recommendations` | Synthesized: style, anti-patterns, must-have |

**Output files**:
- `<session>/analysis/design-intelligence.json`
- `<session>/analysis/requirements.md`

### Tech Profile Scan

After analysis, scan findings for context-aware trigger signals (based on detected codebase characteristics):

1. Check detected_stack and dependencies → framework signals (`frontend_framework`, `api_surface`)
2. Check codebase patterns → risk signals (`perf_sensitive`, `test_gap`, `legacy_patterns`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Self-Review

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| JSON validity | Parse design-intelligence.json | No parse errors |
| Required fields | Check _source, industry, design_system | All present |
| Anti-patterns populated | Check recommendations.anti_patterns | Non-empty array |
| Requirements doc exists | File check | requirements.md written |

Update .msg/meta.json: merge `design_intelligence` and `industry_context` keys.
