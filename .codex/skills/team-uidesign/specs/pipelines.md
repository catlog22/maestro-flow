

# Pipeline Definitions

UI design pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Count |
|------|-------------|------------|
| component | Single component: research -> design -> audit -> build | 4 tasks |
| system | Design system: dual-track with 2 sync points | 7 tasks |
| full-system | Full design system + final integrated audit | 8 tasks |

## Component Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| RESEARCH-001 | researcher | [] | Design system analysis, component inventory, accessibility baseline |
| DESIGN-001 | designer | [RESEARCH-001] | Design tokens + component spec with all 5 interactive states |
| AUDIT-001 | reviewer | [DESIGN-001] | 5-dimension audit: consistency, accessibility, completeness, quality, compliance |
| BUILD-001 | implementer | [AUDIT-001] | CSS custom properties + component code + ARIA + keyboard navigation |

## System Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| RESEARCH-001 | researcher | [] | Design system analysis across all components |
| DESIGN-001 | designer | [RESEARCH-001] | Token system design |
| AUDIT-001 | reviewer | [DESIGN-001] | Token audit [Sync Point 1: QUALITY-001] |
| DESIGN-002 | designer | [AUDIT-001] | Component specification (parallel) |
| BUILD-001 | implementer | [AUDIT-001] | Token code implementation (parallel) |
| AUDIT-002 | reviewer | [DESIGN-002] | Component audit [Sync Point 2] |
| BUILD-002 | implementer | [AUDIT-002, BUILD-001] | Component code implementation |

## Full-System Pipeline Task Registry

Same as System pipeline, plus:

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| AUDIT-003 | reviewer | [BUILD-002] | Final integrated audit (cross-cutting) |

## Checkpoints / Sync Points

| Checkpoint | Task | Condition | Action |
|------------|------|-----------|--------|
| QUALITY-001: Sync Point 1 | AUDIT-001 completes | Score >= 8, critical == 0 | Unblock DESIGN-002 + BUILD-001 (parallel) |
| QUALITY-001: GC Loop | AUDIT-* completes | Score < 8 or critical > 0 | Create DESIGN-fix task, new AUDIT task (max 2 rounds) |

## GC Loop Behavior

| Signal | Condition | Action |
|--------|-----------|--------|
| audit_passed | Score >= 8, critical == 0 | GC converged -> record sync_point -> unblock downstream |
| audit_result | Score 6-7, no critical | gc_rounds < max -> create DESIGN-fix task |
| fix_required | Score < 6 or critical > 0 | gc_rounds < max -> create DESIGN-fix task (CRITICAL) |
| Any | gc_rounds >= max | Escalate to user: accept / try one more / terminate |

## Parallel Spawn Rules

| Mode | After | Spawn Behavior |
|------|-------|----------------|
| component | Sequential | One task at a time |
| system | Sync Point 1 (AUDIT-001) | Spawn DESIGN-002 + BUILD-001 in parallel |
| system | AUDIT-002 | Spawn BUILD-002 |
| full-system | Sync Point 1 (AUDIT-001) | Spawn DESIGN-002 + BUILD-001 in parallel |
| full-system | BUILD-002 | Spawn AUDIT-003 |

## Output Artifacts

| Task | Output Path |
|------|-------------|
| RESEARCH-001 | {run_dir}/outputs/research/*.json |
| DESIGN-001 | {run_dir}/outputs/design/design-tokens.json + component-specs/*.md |
| AUDIT-* | {run_dir}/outputs/audit/audit-<NNN>.md |
| BUILD-001 | {run_dir}/outputs/build/token-files/* |
| BUILD-002 | {run_dir}/outputs/build/component-files/* |
