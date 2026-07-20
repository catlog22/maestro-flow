---
role: reviewer
prefix: AUDIT
inner_loop: false
message_types: "[approved, concerns, rejected, error]"
---

# Issue Reviewer

## Phase 2: Context & Solution Loading

| Input | Source | Required |
|-------|--------|----------|
| Issue IDs | Task description (GH-\d+ or ISS-\d{8}-\d{3}) | Yes |
| Explorer context | `{run_dir}/work/team/explorations/context-<issueId>.json` | No |
| Solution artifact | `{run_dir}/outputs/solutions/solution-<issueId>.json` | Yes |
| wisdom meta | {run_dir}/work/team/wisdom/.msg/meta.json | No |

1. Extract issue IDs from task description via regex
2. Load explorer context reports for each issue
3. Load the canonical Run solution artifact for each issue:

```
Read("{run_dir}/outputs/solutions/solution-<issueId>.json")
```

## Phase 3: Multi-Dimensional Review

Review each solution across three weighted dimensions:

**Technical Feasibility (40%)**:

| Criterion | Check |
|-----------|-------|
| File Coverage | Solution covers all affected files from explorer context |
| Dependency Awareness | Considers dependency cascade effects |
| API Compatibility | Maintains backward compatibility |
| Pattern Conformance | Follows existing code patterns (ACE semantic validation) |

**Risk Assessment (30%)**:

| Criterion | Check |
|-----------|-------|
| Scope Creep | Solution stays within issue boundary (task_count <= 10) |
| Breaking Changes | No destructive modifications |
| Side Effects | No unforeseen side effects |
| Rollback Path | Can rollback if issues occur |

**Completeness (30%)**:

| Criterion | Check |
|-----------|-------|
| All Tasks Defined | Task decomposition is complete (count > 0) |
| Test Coverage | Includes test plan |
| Edge Cases | Considers boundary conditions |

**Score calculation**:

```
total_score = round(
  technical_feasibility.score * 0.4 +
  risk_assessment.score * 0.3 +
  completeness.score * 0.3
)
```

**Verdict rules**:

| Score | Verdict | Message Type |
|-------|---------|-------------|
| >= 80 | approved | `approved` |
| 60-79 | concerns | `concerns` |
| < 60 | rejected | `rejected` |

## Phase 4: Compile Audit Report

1. Write audit report to `{run_dir}/outputs/audits/audit-report.json`:
   - Per-issue: issueId, solutionId, total_score, verdict, per-dimension scores and findings
   - Overall verdict (any rejected -> overall rejected)

2. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `reviewer` namespace:
   - Read existing -> merge `{ "reviewer": { overall_verdict, review_count, scores } }` -> write back

3. For rejected solutions, include specific rejection reasons and actionable feedback for SOLVE-fix task creation
