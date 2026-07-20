---
role: planner
prefix: TDPLAN
inner_loop: false
message_types: "[state_update]"
---

# Tech Debt Planner

## Phase 2: Load Assessment Data

| Input | Source | Required |
|-------|--------|----------|
| Session path | task description (regex: `session:\s*(.+)`) | Yes |
| .msg/meta.json | {run_dir}/work/team/.msg/meta.json | Yes |
| Priority matrix | {run_dir}/outputs/assessment/priority-matrix.json | Yes |

1. Extract session path from task description
2. Read .msg/meta.json for debt_inventory
3. Read priority-matrix.json for quadrant groupings
4. Group items: quickWins (quick-win), strategic (strategic), backlog (backlog), deferred (defer)

## Phase 3: Create Remediation Plan

**Strategy selection**:

| Item Count (quick-win + strategic) | Strategy |
|------------------------------------|----------|
| <= 5 | Inline: generate steps from item data |
| > 5 | CLI-assisted: agy generates detailed remediation steps |

**3-Phase Plan Structure**:

| Phase | Name | Source Items | Focus |
|-------|------|-------------|-------|
| 1 | Quick Wins | quick-win quadrant | High impact, low cost -- immediate execution |
| 2 | Systematic | strategic quadrant | High impact, high cost -- structured refactoring |
| 3 | Prevention | Generated from dimension patterns | Long-term prevention mechanisms |

**Action Type Mapping**:

| Dimension | Action Type |
|-----------|-------------|
| code | refactor |
| architecture | restructure |
| testing | add-tests |
| dependency | update-deps |
| documentation | add-docs |

**Prevention Actions** (generated when dimension has >= 3 items):

| Dimension | Prevention Action |
|-----------|-------------------|
| code | Add linting rules for complexity thresholds and code smell detection |
| architecture | Introduce module boundary checks in CI pipeline |
| testing | Set minimum coverage thresholds in CI and add pre-commit test hooks |
| dependency | Configure automated dependency update bot (Renovate/Dependabot) |
| documentation | Add JSDoc/docstring enforcement in linting rules |

For CLI-assisted mode, prompt agy with debt summary requesting specific fix steps per item, grouped into phases, with dependencies and estimated time.

## Phase 4: Validate & Save

1. Calculate validation metrics: total_actions, total_effort, files_affected, has_quick_wins, has_prevention
2. Write `{run_dir}/outputs/plan/remediation-plan.md` (markdown with per-item checklists)
3. Write `{run_dir}/outputs/plan/remediation-plan.json` (machine-readable)
4. Update .msg/meta.json with `remediation_plan` summary
