
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From session meta.json `pipeline` | Yes |
| Interaction type | From session meta.json `interaction_type` | Yes |

1. Load user requirement and scope from session meta.json
2. Load pipeline stage definitions from specs/pipelines.md
3. Read `pipeline` and `interaction_type` from session meta.json

## Phase 3: Task Chain Creation (Mode-Branched)

### Task Description Template

Every task description uses structured format:

```
update_plan({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: <session-folder>
  - Scope: <interaction-scope>
  - Components: <component-list>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `single` | Create 4 tasks: RESEARCH -> INTERACT -> BUILD -> A11Y |
| `gallery` | Create 6 tasks: RESEARCH -> INTERACT-001 -> BUILD-001 -> INTERACT-002 -> BUILD-002 -> A11Y |
| `page` | Create 4+ tasks: RESEARCH -> INTERACT -> [BUILD-001..N parallel] -> A11Y |

---

### Single Pipeline Task Chain

**RESEARCH-001** (researcher):
```
update_plan({
  subject: "RESEARCH-001",
  description: "PURPOSE: Analyze interaction patterns, browser API availability, and reference implementations | Success: 3 research artifacts with valid data
TASK:
  - Catalog existing interactive components in project
  - Audit browser API usage (IntersectionObserver, ResizeObserver, Pointer Events, Touch Events)
  - Collect reference patterns for target component type
CONTEXT:
  - Session: <session-folder>
  - Scope: <interaction-scope>
  - Components: <component-list>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/research/*.json | All 3 research files with valid JSON
CONSTRAINTS: Read-only analysis | Focus on <interaction-scope>"
})
update_plan({ taskId: "RESEARCH-001", owner: "researcher" })
```

**INTERACT-001** (interaction-designer):
```
update_plan({
  subject: "INTERACT-001",
  description: "PURPOSE: Design complete interaction blueprint with state machine and event flows | Success: Blueprint with all states, events, and keyboard mappings defined
TASK:
  - Define state machine (idle -> hover -> active -> animating -> complete)
  - Map event flows (pointer/touch/keyboard -> handlers -> state transitions)
  - Specify gesture parameters (lerp speed, thresholds, easing)
  - Design animation choreography (entry/exit/idle transitions)
  - Create touch/keyboard/mouse mapping table
CONTEXT:
  - Session: <session-folder>
  - Scope: <interaction-scope>
  - Upstream artifacts: research/*.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/interaction/blueprints/<component-name>.md | Complete state machine + event map + keyboard coverage
CONSTRAINTS: Vanilla JS only | GPU-only animations | Progressive enhancement"
})
update_plan({ taskId: "INTERACT-001", addBlockedBy: ["RESEARCH-001"], owner: "interaction-designer" })
```

**BUILD-001** (builder):
```
update_plan({
  subject: "BUILD-001",
  description: "PURPOSE: Implement interactive component as vanilla JS + CSS | Success: Working ES module + CSS with all states, touch-aware, keyboard accessible
TASK:
  - Implement ES module component class from interaction blueprint
  - Write CSS with custom properties (no preprocessor)
  - Add progressive enhancement (content works without JS)
  - Use GPU-only animations (transform + opacity)
  - Implement pointer events with touch fallback
  - Add ResizeObserver for responsive behavior
  - Add IntersectionObserver for scroll triggers (if applicable)
CONTEXT:
  - Session: <session-folder>
  - Scope: <interaction-scope>
  - Upstream artifacts: interaction/blueprints/*.md, research/*.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/build/components/<name>.js + <name>.css | Zero dependencies, all states implemented
CONSTRAINTS: No npm packages | ES modules only | No inline styles | < 5ms per frame"
})
update_plan({ taskId: "BUILD-001", addBlockedBy: ["INTERACT-001"], owner: "builder" })
```

**A11Y-001** (a11y-tester):
```
update_plan({
  subject: "A11Y-001",
  description: "PURPOSE: Audit accessibility of built component | Success: Audit report with pass/fail per check, 0 critical issues
TASK:
  - Test keyboard navigation (tab order, arrow keys, escape, enter/space)
  - Check screen reader compatibility (ARIA roles, states, live regions)
  - Verify reduced motion fallback (prefers-reduced-motion)
  - Test focus management (visible indicator, focus trap for overlays)
  - Check color contrast (foreground/background ratio)
CONTEXT:
  - Session: <session-folder>
  - Scope: <interaction-scope>
  - Upstream artifacts: build/components/*.js, build/components/*.css, interaction/blueprints/*.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/a11y/a11y-audit-001.md | Per-check pass/fail with remediation suggestions
CONSTRAINTS: Read-only analysis | GC convergence: 0 critical issues"
})
update_plan({ taskId: "A11Y-001", addBlockedBy: ["BUILD-001"], owner: "a11y-tester" })
```

---

### Gallery Pipeline Task Chain

Create tasks in dependency order:

| Task | Role | blockedBy | Description |
|------|------|-----------|-------------|
| RESEARCH-001 | researcher | (none) | Interaction patterns + browser API audit |
| INTERACT-001 | interaction-designer | RESEARCH-001 | Base component interaction blueprint |
| BUILD-001 | builder | INTERACT-001 | Base component implementation |
| INTERACT-002 | interaction-designer | BUILD-001 | Gallery/scroll-snap interaction blueprint |
| BUILD-002 | builder | INTERACT-002 | Gallery container + navigation implementation |
| A11Y-001 | a11y-tester | BUILD-002 | Full gallery accessibility audit |

Task descriptions follow same template as single pipeline, with subject-specific content:
- INTERACT-002 focuses on scroll-snap container, navigation dots, active item detection
- BUILD-002 focuses on gallery container with CSS scroll-snap, IntersectionObserver for active item, navigation controls

---

### Page Pipeline Task Chain

| Task | Role | blockedBy | Description |
|------|------|-----------|-------------|
| RESEARCH-001 | researcher | (none) | Interaction patterns for all page sections |
| INTERACT-001 | interaction-designer | RESEARCH-001 | Blueprints for all interactive sections |
| BUILD-001..N | builder | INTERACT-001 | One task per section (parallel fan-out) |
| A11Y-001 | a11y-tester | BUILD-001..N (all) | Full page accessibility audit |

**Parallel fan-out**: Create one BUILD task per distinct interactive section detected in the interaction blueprint. Each BUILD task is blocked only by INTERACT-001. A11Y-001 is blocked by ALL BUILD tasks.

Task descriptions for each BUILD-00N specify which section to implement, referencing the corresponding section in the interaction blueprint.

---

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | list_agents count | single: 4, gallery: 6, page: 3+N |
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| Task IDs use correct prefixes | Pattern check | RESEARCH/INTERACT/BUILD/A11Y |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |

If validation fails, fix the specific task and re-validate.
