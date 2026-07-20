---
role: motion-researcher
prefix: MRESEARCH
inner_loop: false
message_types: "[state_update]"
---

# Motion & Animation Researcher

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | No |

1. Extract session path and target scope from task description
2. Detect project type and tech stack from package.json or equivalent:

| Package | Detected Stack |
|---------|---------------|
| next | nextjs |
| react | react |
| vue | vue |
| svelte | svelte |
| gsap | gsap |
| framer-motion | framer-motion |
| @react-spring/web | react-spring |
| (default) | css-vanilla |

3. Use CLI tools (e.g., `maestro delegate "..." --to agy --mode analysis`) or direct tools (Glob, Grep) to scan for existing animations, transitions, keyframes
4. Read framework context from session config

## Phase 3: Research Execution

Execute 3 analysis streams:

**Stream 1 -- Animation Inventory**:
- Search for CSS @keyframes declarations (pattern: `@keyframes`)
- Search for CSS transition properties (pattern: `transition:`, `transition-property:`)
- Search for JS animation APIs (requestAnimationFrame, Web Animations API, GSAP, Framer Motion)
- Search for IntersectionObserver usage (scroll-triggered animations)
- Catalog each animation: name, properties animated, duration, easing, trigger mechanism
- Flag unsafe properties (width, height, top, left, margin, padding, color, background-color)
- Output: `{run_dir}/outputs/research/animation-inventory.json`
  ```json
  {
    "css_keyframes": [{ "name": "", "file": "", "properties": [], "safe": true }],
    "css_transitions": [{ "file": "", "line": 0, "properties": [], "duration": "", "easing": "" }],
    "js_animations": [{ "file": "", "type": "rAF|WAAPI|gsap|framer", "properties": [] }],
    "scroll_triggers": [{ "file": "", "type": "IntersectionObserver|scroll-event", "threshold": 0 }],
    "unsafe_animations": [{ "file": "", "line": 0, "property": "", "suggestion": "" }],
    "summary": { "total": 0, "safe_count": 0, "unsafe_count": 0 }
  }
  ```

**Stream 2 -- Performance Baseline**:
- If Chrome DevTools MCP available:
  - Start performance trace: `mcp__chrome-devtools__performance_start_trace()`
  - Trigger page load or scroll interaction
  - Stop trace: `mcp__chrome-devtools__performance_stop_trace()`
  - Analyze: `mcp__chrome-devtools__performance_analyze_insight()`
  - Extract: FPS data, paint/composite times, layout thrashing events, layer count
- If Chrome DevTools unavailable:
  - Static analysis: count layout-triggering properties, estimate performance from code patterns
  - Mark `_source: "static-analysis"`
- Output: `{run_dir}/outputs/research/performance-baseline.json`
  ```json
  {
    "_source": "chrome-devtools|static-analysis",
    "fps": { "average": 0, "minimum": 0, "drops": [] },
    "paint_time_ms": 0,
    "composite_time_ms": 0,
    "layout_thrashing": [],
    "layer_count": 0,
    "will_change_count": 0
  }
  ```

**Stream 3 -- Easing Catalog**:
- Search for cubic-bezier declarations in CSS
- Search for named easing functions (ease, ease-in, ease-out, ease-in-out, linear)
- Search for JS easing implementations (spring physics, custom curves)
- Catalog each: name/value, usage count, context (hover, scroll, entry)
- Recommend additions based on gaps (missing ease-spring, missing stagger patterns)
- Reference specs/motion-tokens.md for recommended token schema
- Output: `{run_dir}/outputs/research/easing-catalog.json`
  ```json
  {
    "existing": [{ "value": "", "usage_count": 0, "contexts": [] }],
    "recommended_additions": [{ "name": "", "value": "", "reason": "" }],
    "duration_patterns": [{ "value": "", "usage_count": 0, "contexts": [] }],
    "stagger_patterns": [{ "found": false, "details": "" }]
  }
  ```

Compile research summary metrics: animation_count, safe_percentage, fps_baseline, easing_count, has_reduced_motion.

## Phase 4: Validation & Output

1. Verify all 3 output files exist and contain valid JSON with required fields:

| File | Required Fields |
|------|----------------|
| animation-inventory.json | css_keyframes array, summary |
| performance-baseline.json | _source |
| easing-catalog.json | existing array |

2. If any file missing or invalid, re-run corresponding stream

3. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `motion-researcher` namespace:
   - Read existing -> merge `{ "motion-researcher": { detected_stack, animation_count, safe_percentage, fps_baseline, easing_count, has_reduced_motion } }` -> write back
