

# Pipeline Definitions

Motion design pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Count |
|------|-------------|------------|
| tokens | Animation token system: research -> choreography -> animation -> test | 4 tasks |
| component | Component animation with GC loop for performance | 4 tasks (+fix) |
| page | Full page scroll choreography with parallel animations | 4+N tasks |

## Tokens Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| MRESEARCH-001 | motion-researcher | [] | Audit existing animations, measure perf baseline, catalog easing patterns |
| CHOREO-001 | choreographer | [MRESEARCH-001] | Design motion token system (easing, duration, stagger, reduced-motion) |
| ANIM-001 | animator | [CHOREO-001] | Implement CSS custom properties, utility animations, reduced-motion overrides |
| MTEST-001 | motion-tester | [ANIM-001] | Verify compositor-only, FPS, will-change budget, reduced-motion compliance |

## Component Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| MRESEARCH-001 | motion-researcher | [] | Audit target component animations, measure perf baseline |
| CHOREO-001 | choreographer | [MRESEARCH-001] | Design tokens + transition state diagrams + scroll sequences |
| ANIM-001 | animator | [CHOREO-001] | Implement component animations: @keyframes, IntersectionObserver, rAF |
| MTEST-001 | motion-tester | [ANIM-001] | Performance gate: FPS, compositor-only, layout thrashing, reduced-motion |

GC loop: MTEST-001 -> ANIM-fix-1 -> MTEST-002 (max 2 rounds)

## Page Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| MRESEARCH-001 | motion-researcher | [] | Full page animation audit, scroll section inventory |
| CHOREO-001 | choreographer | [MRESEARCH-001] | Page-level motion tokens + scroll choreography per section |
| ANIM-001..N | animator | [CHOREO-001] | Parallel: one ANIM task per scroll section (CP-3 Fan-out) |
| MTEST-001 | motion-tester | [ANIM-001..N] | Full page performance validation after all sections complete |

## Performance Gate (Sync Point)

| Checkpoint | Task | Condition | Action |
|------------|------|-----------|--------|
| PERF-001: Performance Gate | MTEST-* completes | FPS >= 60, no thrashing, reduced-motion OK | Pipeline complete |
| PERF-001: GC Loop | MTEST-* completes | FPS < 60 or thrashing | Create ANIM-fix task, new MTEST task (max 2 rounds) |

## GC Loop Behavior

| Signal | Condition | Action |
|--------|-----------|--------|
| perf_passed | Score >= 8, FPS >= 60, no thrashing | Performance gate passed -> pipeline complete |
| perf_warning | Score 6-7, minor issues | gc_rounds < max -> create ANIM-fix task |
| fix_required | Score < 6 or FPS < 60 or thrashing | gc_rounds < max -> create ANIM-fix task (CRITICAL) |
| Any | gc_rounds >= max | Escalate to user: accept / try one more / terminate |

## Parallel Spawn Rules

| Mode | After | Spawn Behavior |
|------|-------|----------------|
| tokens | Sequential | One task at a time |
| component | Sequential | One task at a time, GC loop on MTEST |
| page | CHOREO-001 | Spawn ANIM-001..N in parallel (CP-3 Fan-out) |
| page | All ANIM complete | Spawn MTEST-001 |

## Output Artifacts

| Task | Output Path |
|------|-------------|
| MRESEARCH-001 | {run_dir}/outputs/research/*.json |
| CHOREO-001 | {run_dir}/outputs/choreography/motion-tokens.json + sequences/*.md |
| ANIM-* | {run_dir}/outputs/animations/keyframes/*.css + orchestrators/*.js |
| MTEST-* | {run_dir}/outputs/testing/reports/perf-report-{NNN}.md |
