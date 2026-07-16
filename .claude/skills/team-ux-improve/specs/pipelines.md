

# Pipeline Definitions

UX improvement pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Chain |
|------|-------------|------------|
| standard | Full UX improvement pipeline | SCAN-001 -> DIAG-001 -> DESIGN-001 -> IMPL-001 -> TEST-001 |

## Standard Pipeline Task Registry

| Task ID | Role | blockedBy | Inner Loop | Description |
|---------|------|-----------|------------|-------------|
| SCAN-001 | scanner | [] | false | Scan UI components for interaction issues (unresponsive buttons, missing feedback, state problems) |
| DIAG-001 | diagnoser | [SCAN-001] | false | Root cause diagnosis with fix recommendations |
| DESIGN-001 | designer | [DIAG-001] | false | Feedback mechanism and state management solution design |
| IMPL-001 | implementer | [DESIGN-001] | true | Code implementation with proper state handling |
| TEST-001 | tester | [IMPL-001] | false | Test generation and validation (pass rate >= 95%, max 5 iterations) |

## Checkpoints

| Checkpoint | Trigger | Condition | Action |
|------------|---------|-----------|--------|
| Pipeline complete | TEST-001 completes | All tasks done | Coordinator Phase 5: wisdom consolidation + completion action |

## Test Iteration Behavior

| Condition | Action |
|-----------|--------|
| pass_rate >= 95% | Pipeline complete |
| pass_rate < 95% AND iterations < 5 | Tester generates fixes, re-runs (inner loop within TEST-001) |
| pass_rate < 95% AND iterations >= 5 | Accept current state, report to coordinator |

## Output Artifacts

| Task | Output Path |
|------|-------------|
| SCAN-001 | {run_dir}/outputs/scan-report.md |
| DIAG-001 | {run_dir}/outputs/diagnosis.md |
| DESIGN-001 | {run_dir}/outputs/design-guide.md |
| IMPL-001 | {run_dir}/outputs/fixes/ |
| TEST-001 | {run_dir}/outputs/test-report.md |

## Wisdom System

Workers contribute learnings to `<session>/wisdom/contributions/`. On pipeline completion, coordinator asks user to merge approved contributions to permanent wisdom at `~  or <project>/.claude/skills/team-ux-improve/wisdom/`.

| Directory | Purpose |
|-----------|---------|
| wisdom/principles/ | Core UX principles |
| wisdom/patterns/ | Solution patterns (ui-feedback, state-management) |
| wisdom/anti-patterns/ | Issues to avoid (common-ux-pitfalls) |
| wisdom/contributions/ | Session worker contributions (pending review) |
