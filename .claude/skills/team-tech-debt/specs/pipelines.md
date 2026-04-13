# Pipeline Definitions

Tech debt pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Chain |
|------|-------------|------------|
| scan | Scan and assess only, no fixes | TDSCAN-001 -> TDEVAL-001 |
| remediate | Full pipeline: scan -> assess -> plan -> fix -> validate | TDSCAN-001 -> TDEVAL-001 -> TDPLAN-001 -> TDFIX-001 -> TDVAL-001 |
| targeted | Skip scan/assess, direct fix path | TDPLAN-001 -> TDFIX-001 -> TDVAL-001 |

## Task Registry

| Task ID | Role | Prefix | blockedBy | Description |
|---------|------|--------|-----------|-------------|
| TDSCAN-001 | scanner | TDSCAN | [] | Fan-out multi-dimension codebase scan (code, architecture, testing, dependency, documentation) |
| TDEVAL-001 | assessor | TDEVAL | [TDSCAN-001] | Severity assessment with priority quadrant matrix |
| TDPLAN-001 | planner | TDPLAN | [TDEVAL-001] | 3-phase remediation plan with effort estimates |
| TDFIX-001 | executor | TDFIX | [TDPLAN-001] | Worktree-based incremental fixes (inner_loop: true) |
| TDVAL-001 | validator | TDVAL | [TDFIX-001] | 4-layer validation: syntax, tests, integration, regression |

## Checkpoints

| Checkpoint | Trigger | Condition | Action |
|------------|---------|-----------|--------|
| Plan Approval Gate | TDPLAN-001 completes | Always | AskUserQuestion: Approve / Revise / Abort |
| Worktree Creation | Plan approved | Before TDFIX | git worktree add .worktrees/TD-<slug>-<date> |
| Fix-Verify GC Loop | TDVAL-* completes | Regressions found | Create TDFIX-fix-<round> + TDVAL-recheck-<round> (max 3 rounds) |

## GC Loop Behavior

| Condition | Action |
|-----------|--------|
| No regressions | Pipeline complete |
| Regressions AND gc_rounds < 3 | Create fix-verify tasks, increment gc_rounds |
| Regressions AND gc_rounds >= 3 | Accept current state, handleComplete |

## Output Artifacts

| Task | Output Path |
|------|-------------|
| TDSCAN-001 | <session>/scan/scan-report.json |
| TDEVAL-001 | <session>/assessment/debt-assessment.json |
| TDPLAN-001 | <session>/plan/remediation-plan.md |
| TDFIX-001 | <session>/fixes/ (worktree) |
| TDVAL-001 | <session>/validation/validation-report.md |
