
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From team-session.json `pipeline` | Yes |
| Framework config | From team-session.json `framework` | Yes |

1. Load user requirement and motion scope from team-session.json
2. Load pipeline stage definitions from specs/pipelines.md
3. Read `pipeline` and `framework` from team-session.json

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
  - Session: {run_dir}/work/team
  - Scope: <motion-scope>
  - Framework: <framework>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `tokens` | Create 4 tasks: MRESEARCH -> CHOREO -> ANIM -> MTEST |
| `component` | Create 4 tasks: MRESEARCH -> CHOREO -> ANIM -> MTEST (GC loop) |
| `page` | Create 4+ tasks: MRESEARCH -> CHOREO -> [ANIM-001..N parallel] -> MTEST |

---

### Tokens Pipeline Task Chain

**MRESEARCH-001** (motion-researcher):
```
update_plan({
  subject: "MRESEARCH-001",
  description: "PURPOSE: Audit existing animations, measure performance baseline, catalog easing patterns | Success: 3 research artifacts produced with valid data
TASK:
  - Scan codebase for existing CSS @keyframes, transitions, JS animation code
  - Measure paint/composite costs via Chrome DevTools performance traces (if available)
  - Catalog existing easing functions and timing patterns
  - Identify properties being animated (safe vs unsafe for compositor)
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <motion-scope>
  - Framework: <framework>
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/research/*.json | All 3 research files with valid JSON
CONSTRAINTS: Read-only analysis | Focus on existing animation patterns"
})
update_plan({ taskId: "MRESEARCH-001", owner: "motion-researcher" })
```

**CHOREO-001** (choreographer):
```
update_plan({
  subject: "CHOREO-001",
  description: "PURPOSE: Design animation token system with easing functions, duration scale, stagger formulas | Success: Complete motion-tokens.json with all token categories
TASK:
  - Define easing functions (ease-out, ease-in-out, ease-spring) as cubic-bezier values
  - Define duration scale (fast, base, slow, slower, slowest)
  - Define stagger formula with base delay and increment
  - Define reduced-motion fallback tokens
  - Reference specs/motion-tokens.md for token schema
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <motion-scope>
  - Framework: <framework>
  - Upstream artifacts: {run_dir}/outputs/research/*.json
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/choreography/motion-tokens.json | Complete token system
CONSTRAINTS: Follow motion-tokens.md schema | All tokens must have reduced-motion fallback"
})
update_plan({ taskId: "CHOREO-001", addBlockedBy: ["MRESEARCH-001"], owner: "choreographer" })
```

**ANIM-001** (animator):
```
update_plan({
  subject: "ANIM-001",
  description: "PURPOSE: Implement CSS custom properties and utility classes from motion tokens | Success: Production-ready CSS with token consumption and reduced-motion overrides
TASK:
  - Generate CSS custom properties from motion-tokens.json
  - Create utility animation classes consuming tokens
  - Add prefers-reduced-motion media query overrides
  - Ensure compositor-only properties (transform, opacity) per specs/gpu-constraints.md
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <motion-scope>
  - Framework: <framework>
  - Upstream artifacts: choreography/motion-tokens.json
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/animations/keyframes/*.css | Token CSS + utility classes + reduced-motion
CONSTRAINTS: Compositor-only animations | No layout-triggering properties | will-change budget"
})
update_plan({ taskId: "ANIM-001", addBlockedBy: ["CHOREO-001"], owner: "animator" })
```

**MTEST-001** (motion-tester):
```
update_plan({
  subject: "MTEST-001",
  description: "PURPOSE: Verify animation performance and accessibility compliance | Success: 60fps confirmed, no layout thrashing, reduced-motion present
TASK:
  - Start Chrome DevTools performance trace (if available)
  - Verify compositor-only animations (no paint/layout triggers)
  - Check will-change usage (not excessive, max 3-4 elements)
  - Validate prefers-reduced-motion @media query presence
  - Static code analysis as fallback if Chrome DevTools unavailable
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <motion-scope>
  - Framework: <framework>
  - Upstream artifacts: animations/keyframes/*.css, choreography/motion-tokens.json
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/testing/reports/perf-report-001.md | Performance validation report
CONSTRAINTS: Target 60fps | Flag any layout-triggering properties"
})
update_plan({ taskId: "MTEST-001", addBlockedBy: ["ANIM-001"], owner: "motion-tester" })
```

---

### Component Pipeline Task Chain

Same as Tokens pipeline with enhanced task descriptions:

- **MRESEARCH-001**: Same as tokens, plus focus on target component(s) existing animation
- **CHOREO-001**: Same token design, plus transition state diagrams (entry/exit/hover/focus/loading) and scroll-triggered reveal sequences for the component(s)
- **ANIM-001**: Implement component-specific animations: @keyframes, IntersectionObserver triggers, rAF coordination, staggered orchestration
- **MTEST-001**: Same as tokens, plus GC loop -- if FPS < 60 or layout thrashing, send `fix_required` signal

GC loop between animator and motion-tester (max 2 rounds).

---

### Page Pipeline Task Chain

**MRESEARCH-001** and **CHOREO-001**: Same as component, but scope is full page with multiple scroll sections.

**CHOREO-001** additionally defines scroll section boundaries, parallax depths, and staggered entry sequences per section.

**ANIM-001..N** (parallel): One ANIM task per scroll section or page area:
```
update_plan({
  subject: "ANIM-<NNN>",
  description: "PURPOSE: Implement animations for <section-name> | Success: Scroll-triggered reveals with 60fps performance
TASK:
  - Implement IntersectionObserver-based scroll triggers for <section-name>
  - Apply staggered entry animations with calculated delays
  - Add scroll-linked parallax (if specified in choreography)
  - Ensure prefers-reduced-motion fallback
CONTEXT:
  - Session: {run_dir}/work/team
  - Section: <section-name>
  - Upstream artifacts: choreography/sequences/<section>.md, choreography/motion-tokens.json
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/animations/keyframes/<section>.css + orchestrators/<section>.js
CONSTRAINTS: Compositor-only | will-change budget | Follow motion-tokens"
})
update_plan({ taskId: "ANIM-<NNN>", addBlockedBy: ["CHOREO-001"], owner: "animator" })
```

**MTEST-001**: Blocked by all ANIM tasks. Full page performance validation.

---

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | list_agents count | tokens: 4, component: 4, page: 4+N |
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| Task IDs use correct prefixes | Pattern check | MRESEARCH/CHOREO/ANIM/MTEST |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |

If validation fails, fix the specific task and re-validate.
