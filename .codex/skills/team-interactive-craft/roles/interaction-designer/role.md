---
role: interaction-designer
prefix: INTERACT
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Interaction Blueprint Designer

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Research artifacts | <session>/research/*.json | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Existing blueprints | <session>/interaction/blueprints/*.md | Only for INTERACT-002+ |

1. Extract session path from task description
2. Read research findings: interaction-inventory.json, browser-api-audit.json, pattern-reference.json
3. Detect task type from subject: "001" -> Primary blueprint, "002" -> Secondary/gallery blueprint
4. If INTERACT-002+: read existing blueprints for consistency with base component

## Phase 3: Design Execution

**Primary Blueprint (INTERACT-001)**:

For each target component, produce a blueprint document containing:

### State Machine
Define complete state diagram:
```
[idle] --(pointerenter)--> [hover]
[hover] --(pointerdown)--> [active]
[hover] --(pointerleave)--> [idle]
[active] --(pointermove)--> [dragging/animating]
[active] --(pointerup)--> [hover]
[dragging] --(pointerup)--> [settling]
[settling] --(transitionend)--> [idle]
[any] --(focus)--> [focused]
[focused] --(blur)--> [previous-state]
[any] --(keydown:Escape)--> [idle]
```
- All states must be reachable
- All states must have exit transitions
- Error/reset transitions from every state back to idle

### Event Flow Map
Map events to handlers to state transitions:

| Event | Source | Handler | State Transition | Side Effect |
|-------|--------|---------|-----------------|-------------|
| pointerdown | element | onPointerDown | idle->active | setPointerCapture, preventDefault |
| pointermove | document | onPointerMove | active->dragging | update position via lerp |
| pointerup | document | onPointerUp | dragging->settling | releasePointerCapture |
| keydown:ArrowLeft | element | onKeyDown | - | decrement value |
| keydown:ArrowRight | element | onKeyDown | - | increment value |
| keydown:Escape | element | onKeyDown | any->idle | reset to default |
| keydown:Enter/Space | element | onKeyDown | idle->active | toggle/activate |

### Gesture Specification
For pointer/touch interactions:

| Gesture | Detection | Parameters |
|---------|-----------|------------|
| Drag | pointerdown + pointermove > 3px | lerp speed: 0.15, axis: x/y/both |
| Swipe | pointerup with velocity > 0.5px/ms | direction: left/right/up/down |
| Pinch | 2+ touch points, distance change | scale factor, min/max zoom |
| Scroll snap | CSS scroll-snap-type: x mandatory | align: start/center, behavior: smooth |

- Lerp interpolation: `current += (target - current) * speed`
- Dead zone: ignore movements < 3px from start
- Velocity tracking: store last 3-5 pointer positions with timestamps

### Animation Choreography
Define animation sequences:

| Animation | Trigger | Properties | Duration | Easing | GPU |
|-----------|---------|------------|----------|--------|-----|
| Entry | mount/reveal | opacity 0->1, translateY 20px->0 | 400ms | cubic-bezier(0.16,1,0.3,1) | Yes |
| Exit | unmount/hide | opacity 1->0, translateY 0->-10px | 200ms | ease-in | Yes |
| Drag follow | pointermove | translateX via lerp | per-frame | linear (lerp) | Yes |
| Settle | pointerup | translateX to snap point | 300ms | cubic-bezier(0.16,1,0.3,1) | Yes |
| Hover | pointerenter | scale 1->1.02 | 200ms | ease-out | Yes |
| Focus ring | focus-visible | outline-offset 0->2px | 150ms | ease-out | No (outline) |
| Stagger | intersection | delay: index * 80ms | 400ms+delay | cubic-bezier(0.16,1,0.3,1) | Yes |

- ALL animations must use transform + opacity only (GPU-composited)
- Exception: outline for focus indicators
- Reduced motion: replace all motion with opacity-only crossfade (200ms)

### Input Mapping Table
Unified mapping across input methods:

| Action | Mouse | Touch | Keyboard | Screen Reader |
|--------|-------|-------|----------|--------------|
| Activate | click | tap | Enter/Space | Enter/Space |
| Navigate prev | - | swipe-right | ArrowLeft | ArrowLeft |
| Navigate next | - | swipe-left | ArrowRight | ArrowRight |
| Drag/adjust | pointerdown+move | pointerdown+move | Arrow keys (step) | Arrow keys (step) |
| Dismiss | click outside | tap outside | Escape | Escape |
| Focus | pointermove (hover) | - | Tab | Tab |

### Platform API Preference

When designing interaction blueprints, prefer native APIs over custom implementations:

| Need | Native API | Custom Fallback |
|------|-----------|-----------------|
| Modal dialog | `<dialog>` + `showModal()` | Custom with focus trap + inert |
| Tooltip/popover | Popover API (`popover` attribute) | Custom with click-outside listener |
| Dropdown positioning | CSS Anchor Positioning | `position: fixed` + JS coords |
| Focus trap | `<dialog>` built-in or `inert` attribute | Manual focus cycling with tabindex |
| Escape-to-close | Built into `<dialog>` and Popover | Manual keydown listener |

Document in blueprint: which native API to use, what the fallback is for unsupported browsers, and how to feature-detect.

**Gallery/Secondary Blueprint (INTERACT-002)**:
- Design scroll-snap container interaction
- Navigation controls (prev/next arrows, dots/indicators)
- Active item detection via IntersectionObserver
- Keyboard navigation within gallery (ArrowLeft/ArrowRight between items)
- Touch momentum and snap behavior
- Reference base component blueprint for consistency

Output: `<session>/interaction/blueprints/{component-name}.md`

## Phase 4: Self-Validation

| Check | Pass Criteria |
|-------|---------------|
| State machine complete | All states reachable, all states have exit |
| Event coverage | All events mapped to handlers |
| Keyboard complete | All interactive actions have keyboard equivalent |
| Touch parity | All mouse actions have touch equivalent |
| GPU-only animations | No width/height/top/left animations |
| Reduced motion | prefers-reduced-motion fallback defined |
| Screen reader path | All actions accessible via screen reader |

If any check fails, revise the blueprint before output.

Update `<session>/wisdom/.msg/meta.json` under `interaction-designer` namespace:
- Read existing -> merge `{ "interaction-designer": { task_type, components_designed, states_count, events_count, gestures } }` -> write back
