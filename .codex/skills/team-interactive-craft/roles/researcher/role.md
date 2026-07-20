---
role: researcher
prefix: RESEARCH
inner_loop: false
message_types: "[state_update]"
---

# Interaction Pattern Researcher

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | No |

1. Extract session path and target scope from task description
2. Detect project structure and existing interactive patterns:

| File Pattern | Detected Pattern |
|--------------|-----------------|
| *.js with addEventListener | Event-driven components |
| IntersectionObserver usage | Scroll-triggered animations |
| ResizeObserver usage | Responsive layout components |
| pointer/mouse/touch events | Interactive drag/gesture components |
| scroll-snap in CSS | Scroll-snap gallery |
| backdrop-filter in CSS | Glass/frosted effects |
| clip-path in CSS | Reveal/mask animations |

3. Use CLI tools (e.g., `maestro delegate "..." --to agy --mode analysis`) or direct tools (Glob, Grep) to scan for existing interactive components, animation patterns, event handling approaches
4. Read interaction type context from session config

## Phase 3: Research Execution

Execute 3 analysis streams:

**Stream 1 -- Interaction Inventory**:
- Search for existing interactive components (event listeners, observers, animation code)
- Identify interaction patterns in use (drag, scroll, overlay, reveal)
- Map component lifecycle (init, mount, resize, destroy)
- Find dependency patterns (any external libs vs vanilla)
- Catalog gesture handling approaches (pointer vs mouse+touch)
- Output: `{run_dir}/outputs/research/interaction-inventory.json`
- Schema:
  ```json
  {
    "existing_components": [
      { "name": "", "type": "", "events": [], "observers": [], "file": "" }
    ],
    "patterns": {
      "event_handling": "",
      "animation_approach": "",
      "lifecycle": "",
      "dependency_model": ""
    },
    "summary": { "total_interactive": 0, "vanilla_count": 0, "lib_count": 0 }
  }
  ```

**Stream 2 -- Browser API Audit**:
- Check availability and usage of target browser APIs:
  - IntersectionObserver (scroll triggers, lazy loading, visibility detection)
  - ResizeObserver (responsive layout, container queries)
  - Pointer Events (unified mouse/touch/pen input)
  - Touch Events (gesture recognition, multi-touch)
  - CSS scroll-snap (snap points, scroll behavior)
  - CSS clip-path (shape masking, reveal animations)
  - CSS backdrop-filter (blur, brightness, glass effects)
  - Web Animations API (programmatic animation control)
  - requestAnimationFrame (frame-synced updates)
- Identify polyfill needs for target browser support
- Output: `{run_dir}/outputs/research/browser-api-audit.json`
- Schema:
  ```json
  {
    "apis": {
      "<api-name>": {
        "available": true,
        "in_use": false,
        "support": "baseline|modern|polyfill-needed",
        "usage_count": 0,
        "notes": ""
      }
    },
    "polyfill_needs": [],
    "min_browser_target": ""
  }
  ```

**Stream 3 -- Pattern Reference**:
- Collect reference patterns for each target component type
- For each component, document: state machine pattern, event flow, animation approach, touch handling, accessibility pattern
- Reference well-known implementations (e.g., scroll-snap gallery, split-view compare, lightbox overlay)
- Note performance considerations and gotchas per pattern
- Output: `{run_dir}/outputs/research/pattern-reference.json`
- Schema:
  ```json
  {
    "patterns": [
      {
        "component_type": "",
        "state_machine": { "states": [], "transitions": [] },
        "events": { "primary": [], "fallback": [] },
        "animation": { "approach": "", "gpu_only": true, "easing": "" },
        "touch": { "gestures": [], "threshold_px": 0 },
        "a11y": { "role": "", "aria_states": [], "keyboard": [] },
        "performance": { "budget_ms": 0, "gotchas": [] }
      }
    ]
  }
  ```

Compile research summary metrics: existing_interactive_count, vanilla_ratio, apis_available, polyfill_count, patterns_collected.

## Phase 4: Validation & Output

1. Verify all 3 output files exist and contain valid JSON with required fields:

| File | Required Fields |
|------|----------------|
| interaction-inventory.json | existing_components array, patterns object |
| browser-api-audit.json | apis object |
| pattern-reference.json | patterns array |

2. If any file missing or invalid, re-run corresponding stream

3. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `researcher` namespace:
   - Read existing -> merge `{ "researcher": { interactive_count, vanilla_ratio, apis_available, polyfill_needs, scope } }` -> write back
