

# Pipeline Definitions

Interactive craft pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Count |
|------|-------------|------------|
| single | Single component: research -> interaction design -> build -> a11y test | 4 tasks |
| gallery | Gallery: base component + scroll container, two build phases | 6 tasks |
| page | Full page: parallel component builds after single interaction design | 3 + N tasks |

## Single Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| RESEARCH-001 | researcher | [] | Interaction inventory, browser API audit, pattern reference |
| INTERACT-001 | interaction-designer | [RESEARCH-001] | State machine, event flow, gesture spec, animation choreography |
| BUILD-001 | builder | [INTERACT-001] | Vanilla JS + CSS component: ES module, GPU animations, touch-aware |
| A11Y-001 | a11y-tester | [BUILD-001] | Keyboard, screen reader, reduced motion, focus, contrast audit |

## Gallery Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| RESEARCH-001 | researcher | [] | Interaction patterns for base component + gallery container |
| INTERACT-001 | interaction-designer | [RESEARCH-001] | Base component interaction blueprint |
| BUILD-001 | builder | [INTERACT-001] | Base component implementation |
| INTERACT-002 | interaction-designer | [BUILD-001] | Gallery/scroll-snap container blueprint |
| BUILD-002 | builder | [INTERACT-002] | Gallery container + navigation implementation |
| A11Y-001 | a11y-tester | [BUILD-002] | Full gallery accessibility audit |

## Page Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| RESEARCH-001 | researcher | [] | Interaction patterns for all page sections |
| INTERACT-001 | interaction-designer | [RESEARCH-001] | Blueprints for all interactive sections |
| BUILD-001 | builder | [INTERACT-001] | Section 1 component |
| BUILD-002 | builder | [INTERACT-001] | Section 2 component |
| ... | builder | [INTERACT-001] | Additional sections (parallel) |
| BUILD-00N | builder | [INTERACT-001] | Section N component |
| A11Y-001 | a11y-tester | [BUILD-001..N] | Full page accessibility audit |

## Quality Gate (A11y Checkpoint)

| Checkpoint | Task | Condition | Action |
|------------|------|-----------|--------|
| A11Y Gate | A11Y-001 completes | 0 critical, 0 high | Pipeline complete |
| A11Y GC Loop | A11Y-* completes | Critical or high issues | Create BUILD-fix task, new A11Y task (max 2 rounds) |

## GC Loop Behavior

| Signal | Condition | Action |
|--------|-----------|--------|
| a11y_passed | 0 critical, 0 high | GC converged -> pipeline complete |
| a11y_result | 0 critical, high > 0 | gc_rounds < max -> create BUILD-fix task |
| fix_required | critical > 0 | gc_rounds < max -> create BUILD-fix task (CRITICAL) |
| Any | gc_rounds >= max | Escalate to user: accept / try one more / terminate |

## Parallel Spawn Rules

| Mode | After | Spawn Behavior |
|------|-------|----------------|
| single | Sequential | One task at a time |
| gallery | Sequential | One task at a time |
| page | INTERACT-001 | Spawn BUILD-001..N in parallel (CP-3 fan-out) |
| page | All BUILD complete | Spawn A11Y-001 |

## Collaboration Patterns

| Pattern | Roles | Description |
|---------|-------|-------------|
| CP-1 Linear Pipeline | All | Base sequential flow for single/gallery modes |
| CP-2 Review-Fix | builder <-> a11y-tester | GC loop with max 2 rounds |
| CP-3 Parallel Fan-out | builder (multiple) | Page mode: multiple BUILD tasks in parallel |

## Output Artifacts

| Task | Output Path |
|------|-------------|
| RESEARCH-001 | {run_dir}/outputs/research/*.json |
| INTERACT-* | {run_dir}/outputs/interaction/blueprints/*.md |
| BUILD-* | {run_dir}/outputs/build/components/*.js + *.css |
| A11Y-* | {run_dir}/outputs/a11y/a11y-audit-*.md |
