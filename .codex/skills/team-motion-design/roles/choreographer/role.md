---
role: choreographer
prefix: CHOREO
inner_loop: false
message_types: "[state_update]"
---

# Motion Choreographer

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Research artifacts | {run_dir}/outputs/research/*.json | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |
| Motion token spec | specs/motion-tokens.md | Yes |
| GPU constraints | specs/gpu-constraints.md | Yes |
| Reduced motion spec | specs/reduced-motion.md | Yes |

1. Extract session path from task description
2. Read research findings: animation-inventory.json, performance-baseline.json, easing-catalog.json
3. Read motion token schema from specs/motion-tokens.md
4. Read GPU constraints from specs/gpu-constraints.md for safe property list
5. Read reduced motion guidelines from specs/reduced-motion.md

## Phase 3: Design Execution

### Motion Token System

Define complete token system as CSS custom properties + JSON:

**Easing Functions**:
- `--ease-out`: `cubic-bezier(0.16, 1, 0.3, 1)` -- emphasis exit, deceleration
- `--ease-in-out`: `cubic-bezier(0.65, 0, 0.35, 1)` -- smooth symmetrical
- `--ease-spring`: `cubic-bezier(0.34, 1.56, 0.64, 1)` -- overshoot bounce
- Integrate existing easing functions from research (avoid duplicates, reconcile naming)

**Duration Scale**:
- `--duration-fast`: `0.15s` -- micro-interactions (button press, toggle)
- `--duration-base`: `0.3s` -- standard transitions (hover, focus)
- `--duration-slow`: `0.6s` -- content reveals, panel slides
- `--duration-slower`: `0.8s` -- page transitions, large moves
- `--duration-slowest`: `1.2s` -- hero animations, splash

**Delay Scale**:
- `--stagger-base`: `0s` -- first item in stagger sequence
- `--stagger-increment`: `0.05s` to `0.1s` -- per-item delay addition
- Formula: `delay = base_delay + (index * stagger_increment)`
- Max visible stagger: 8 items (avoid >0.8s total delay)

**Reduced Motion Overrides**:
- All durations -> `0.01ms`
- All easings -> `linear` (instant)
- No parallax, no bounce/spring
- Opacity-only fades allowed (<0.15s)

Output: `{run_dir}/outputs/choreography/motion-tokens.json`
```json
{
  "easing": {
    "ease-out": { "value": "cubic-bezier(0.16, 1, 0.3, 1)", "use": "exit emphasis, deceleration" },
    "ease-in-out": { "value": "cubic-bezier(0.65, 0, 0.35, 1)", "use": "smooth symmetrical" },
    "ease-spring": { "value": "cubic-bezier(0.34, 1.56, 0.64, 1)", "use": "overshoot bounce" }
  },
  "duration": {
    "fast": { "value": "0.15s", "use": "micro-interactions" },
    "base": { "value": "0.3s", "use": "standard transitions" },
    "slow": { "value": "0.6s", "use": "content reveals" },
    "slower": { "value": "0.8s", "use": "page transitions" },
    "slowest": { "value": "1.2s", "use": "hero animations" }
  },
  "stagger": {
    "base_delay": "0s",
    "increment": "0.05s",
    "max_items": 8
  },
  "reduced_motion": {
    "duration_override": "0.01ms",
    "easing_override": "linear",
    "allowed": ["opacity"],
    "disallowed": ["parallax", "bounce", "spring", "infinite-loop"]
  }
}
```

### Scroll Choreography Sequences

For component and page modes, define reveal sequences:

- IntersectionObserver thresholds per section (typical: 0.1 to 0.3)
- Entry direction: fade-up, fade-in, slide-left, slide-right
- Stagger groups: which elements stagger together, with calculated delays
- Parallax depths: foreground (1x), midground (0.5x), background (0.2x) scroll rates
- Scroll-linked effects: progress-based opacity, transform interpolation

Output per section: `{run_dir}/outputs/choreography/sequences/<section-name>.md`
```markdown
# Section: <name>

## Trigger
- Observer threshold: 0.2
- Root margin: "0px 0px -100px 0px"

## Sequence
1. Heading: fade-up, duration-slow, ease-out, delay 0s
2. Subheading: fade-up, duration-slow, ease-out, delay 0.05s
3. Cards[0..N]: fade-up, duration-slow, ease-out, stagger 0.08s each

## Parallax (if applicable)
- Background image: 0.2x scroll rate
- Foreground elements: 1x (normal)

## Reduced Motion Fallback
- All elements: opacity fade only, duration-fast
- No parallax, no directional movement
```

### Transition State Diagrams

Define state transitions for interactive elements:

| State Pair | Properties | Duration | Easing |
|------------|-----------|----------|--------|
| hidden -> visible (entry) | opacity: 0->1, transform: translateY(20px)->0 | duration-slow | ease-out |
| visible -> hidden (exit) | opacity: 1->0, transform: 0->translateY(-10px) | duration-base | ease-in-out |
| idle -> hover | opacity: 1->0.8, transform: scale(1)->scale(1.02) | duration-fast | ease-out |
| idle -> focus | outline: none->2px solid, outline-offset: 0->2px | duration-fast | ease-out |
| idle -> active (pressed) | transform: scale(1)->scale(0.98) | duration-fast | ease-out |
| idle -> loading | opacity: 1->0.6, add pulse animation | duration-base | ease-in-out |

All transitions use compositor-only properties (transform, opacity) per GPU constraints.

## Phase 4: Self-Validation

1. Token completeness checks:

| Check | Pass Criteria |
|-------|---------------|
| easing_complete | All 3 easing functions defined with valid cubic-bezier |
| duration_complete | All 5 duration steps defined |
| stagger_defined | Base delay, increment, and max items specified |
| reduced_motion | Override values defined for all token categories |

2. Sequence checks (if applicable):

| Check | Pass Criteria |
|-------|---------------|
| threshold_valid | IntersectionObserver threshold between 0 and 1 |
| safe_properties | Only compositor-safe properties in animations |
| stagger_budget | No stagger sequence exceeds 0.8s total |
| fallback_present | Reduced motion fallback defined for each sequence |

3. State diagram checks:

| Check | Pass Criteria |
|-------|---------------|
| states_covered | entry, exit, hover, focus, active states defined |
| compositor_only | All animated properties are transform or opacity |
| durations_use_tokens | All durations reference token scale values |

4. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `choreographer` namespace:
   - Read existing -> merge `{ "choreographer": { token_count, sequence_count, state_diagrams, has_parallax, has_stagger } }` -> write back
