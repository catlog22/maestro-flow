

# Quality Gates

Quality thresholds and verification criteria for skill tuning.

## When to Use

| Phase | Usage | Section |
|-------|-------|---------|
| action-generate-report | Calculate quality score | Scoring |
| action-verify | Check quality gates | Gate Definitions |
| action-complete | Final assessment | Pass Criteria |

---

## Quality Dimensions

### 1. Issue Severity Distribution (40%)

Measures the severity profile of identified issues.

| Metric | Weight | Calculation |
|--------|--------|-------------|
| Critical Issues | -25 each | High penalty |
| High Issues | -15 each | Significant penalty |
| Medium Issues | -5 each | Moderate penalty |
| Low Issues | -1 each | Minor penalty |

**Score Calculation**:
```javascript
function calculateSeverityScore(issues) {
  const weights = { critical: 25, high: 15, medium: 5, low: 1 };
  const deductions = issues.reduce((sum, issue) =>
    sum + (weights[issue.severity] || 0), 0);
  return Math.max(0, 100 - deductions);
}
```

### 2. Fix Effectiveness (30%)

Measures success rate of applied fixes.

| Metric | Weight | Threshold |
|--------|--------|-----------|
| Fixes Verified Pass | +30 | > 80% pass rate |
| Fixes Verified Fail | -20 | < 50% triggers review |
| Issues Resolved | +10 | Per resolved issue |

**Score Calculation**:
```javascript
function calculateFixScore(appliedFixes) {
  const total = appliedFixes.length;
  if (total === 0) return 100;  // No fixes needed = good

  const passed = appliedFixes.filter(f => f.verification_result === 'pass').length;
  return Math.round((passed / total) * 100);
}
```

### 3. Coverage Completeness (20%)

Measures diagnosis coverage across all areas.

| Metric | Weight | Threshold |
|--------|--------|-----------|
| All 4 diagnosis complete | +20 | Full coverage |
| 3 diagnosis complete | +15 | Good coverage |
| 2 diagnosis complete | +10 | Partial coverage |
| < 2 diagnosis complete | +0 | Insufficient |

### 4. Iteration Efficiency (10%)

Measures how quickly issues are resolved.

| Metric | Weight | Threshold |
|--------|--------|-----------|
| Resolved in 1 iteration | +10 | Excellent |
| Resolved in 2 iterations | +7 | Good |
| Resolved in 3 iterations | +4 | Acceptable |
| > 3 iterations | +0 | Needs improvement |

---

## Gate Definitions

### Gate: PASS

**Threshold**: Quality Score >= 80 AND Critical Issues = 0 AND High Issues <= 2

**Meaning**: Skill is production-ready with minor issues.

**Actions**:
- Complete tuning session
- Generate summary report
- No further fixes required

### Gate: REVIEW

**Threshold**: Quality Score 60-79 OR High Issues 3-5

**Meaning**: Skill has issues requiring attention.

**Actions**:
- Review remaining issues
- Apply additional fixes if possible
- May require manual intervention

### Gate: FAIL

**Threshold**: Quality Score < 60 OR Critical Issues > 0 OR High Issues > 5

**Meaning**: Skill has serious issues blocking deployment.

**Actions**:
- Must fix critical issues
- Re-run diagnosis after fixes
- Consider architectural review

---

## Quality Score Calculation

```javascript
function calculateQualityScore(state) {
  // Dimension 1: Severity (40%)
  const severityScore = calculateSeverityScore(state.issues);

  // Dimension 2: Fix Effectiveness (30%)
  const fixScore = calculateFixScore(state.applied_fixes);

  // Dimension 3: Coverage (20%)
  const diagnosisCount = Object.values(state.diagnosis)
    .filter(d => d !== null).length;
  const coverageScore = [0, 0, 10, 15, 20][diagnosisCount] || 0;

  // Dimension 4: Efficiency (10%)
  const efficiencyScore = state.iteration_count <= 1 ? 10 :
                          state.iteration_count <= 2 ? 7 :
                          state.iteration_count <= 3 ? 4 : 0;

  // Weighted total
  const total = (severityScore * 0.4) +
                (fixScore * 0.3) +
                (coverageScore * 1.0) +  // Already scaled to 20
                (efficiencyScore * 1.0);  // Already scaled to 10

  return Math.round(total);
}

function determineQualityGate(state) {
  const score = calculateQualityScore(state);
  const criticalCount = state.issues.filter(i => i.severity === 'critical').length;
  const highCount = state.issues.filter(i => i.severity === 'high').length;

  if (criticalCount > 0) return 'fail';
  if (highCount > 5) return 'fail';
  if (score < 60) return 'fail';

  if (highCount > 2) return 'review';
  if (score < 80) return 'review';

  return 'pass';
}
```

---

## Verification Criteria

### For Each Issue Type

#### Context Explosion Issues
- [ ] Token count does not grow unbounded
- [ ] History limited to reasonable size
- [ ] No full content in prompts (paths used instead)
- [ ] Agent returns are compact

#### Long-tail Forgetting Issues
- [ ] Constraints visible in all phase prompts
- [ ] State schema includes requirements field
- [ ] Checkpoints exist at key milestones
- [ ] Output matches original constraints

#### Data Flow Issues
- [ ] Single state.json after execution
- [ ] No orphan state files
- [ ] Schema validation active
- [ ] Consistent field naming

#### Agent Coordination Issues
- [ ] All Task calls have error handling
- [ ] Agent results validated before use
- [ ] No nested agent calls
- [ ] Tool declarations match usage

---

## Iteration Control

### Max Iterations

Default: 5 iterations

**Rationale**:
- Each iteration may introduce new issues
- Diminishing returns after 3-4 iterations
- Prevents infinite loops

### Iteration Exit Criteria

```javascript
function shouldContinueIteration(state) {
  // Exit if quality gate passed
  if (state.quality_gate === 'pass') return false;

  // Exit if max iterations reached
  if (state.iteration_count >= state.max_iterations) return false;

  // Exit if no improvement in last 2 iterations
  if (state.iteration_count >= 2) {
    const recentHistory = state.action_history.slice(-10);
    const issuesResolvedRecently = recentHistory.filter(a =>
      a.action === 'action-verify' && a.result === 'success'
    ).length;

    if (issuesResolvedRecently === 0) {
      console.log('No progress in recent iterations, stopping.');
      return false;
    }
  }

  // Continue if critical/high issues remain
  const hasUrgentIssues = state.issues.some(i =>
    i.severity === 'critical' || i.severity === 'high'
  );

  return hasUrgentIssues;
}
```

---

## Reporting Format

### Quality Summary Table

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Severity Distribution | {score}/100 | 40% | {weighted} |
| Fix Effectiveness | {score}/100 | 30% | {weighted} |
| Coverage Completeness | {score}/20 | 20% | {score} |
| Iteration Efficiency | {score}/10 | 10% | {score} |
| **Total** | | | **{total}/100** |

### Gate Status

```
Quality Gate: {PASS|REVIEW|FAIL}

Criteria:
- Quality Score: {score} (threshold: 60)
- Critical Issues: {count} (threshold: 0)
- High Issues: {count} (threshold: 5)
```
