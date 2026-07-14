
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Generate Consolidated Report

Generate a comprehensive tuning report merging all diagnosis results with prioritized recommendations.

## Purpose

- Merge all diagnosis results into unified report
- Prioritize issues by severity and impact
- Generate actionable recommendations
- Create human-readable markdown report

## Preconditions

- [ ] state.status === 'running'
- [ ] All diagnoses in focus_areas are completed
- [ ] state.issues.length > 0 OR generate summary report

## Execution

```javascript
async function execute(state, workDir) {
  console.log('Generating consolidated tuning report...');

  const targetSkill = state.target_skill;
  const issues = state.issues;

  // 1. Group issues by type
  const issuesByType = {
    context_explosion: issues.filter(i => i.type === 'context_explosion'),
    memory_loss: issues.filter(i => i.type === 'memory_loss'),
    dataflow_break: issues.filter(i => i.type === 'dataflow_break'),
    agent_failure: issues.filter(i => i.type === 'agent_failure')
  };

  // 2. Group issues by severity
  const issuesBySeverity = {
    critical: issues.filter(i => i.severity === 'critical'),
    high: issues.filter(i => i.severity === 'high'),
    medium: issues.filter(i => i.severity === 'medium'),
    low: issues.filter(i => i.severity === 'low')
  };

  // 3. Calculate overall health score
  const weights = { critical: 25, high: 15, medium: 5, low: 1 };
  const deductions = Object.entries(issuesBySeverity)
    .reduce((sum, [sev, arr]) => sum + arr.length * weights[sev], 0);
  const healthScore = Math.max(0, 100 - deductions);

  // 4. Generate report content
  const report = `# Skill Tuning Report

**Target Skill**: ${targetSkill.name}
**Path**: ${targetSkill.path}
**Execution Mode**: ${targetSkill.execution_mode}
**Generated**: ${new Date().toISOString()}

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Health Score | ${healthScore}/100 |
| Total Issues | ${issues.length} |
| Critical | ${issuesBySeverity.critical.length} |
| High | ${issuesBySeverity.high.length} |
| Medium | ${issuesBySeverity.medium.length} |
| Low | ${issuesBySeverity.low.length} |

### User Reported Issue
> ${state.user_issue_description}

### Overall Assessment
${healthScore >= 80 ? '✅ Skill is in good health with minor issues.' :
  healthScore >= 60 ? '⚠️ Skill has significant issues requiring attention.' :
  healthScore >= 40 ? '🔶 Skill has serious issues affecting reliability.' :
  '❌ Skill has critical issues requiring immediate fixes.'}

---

## Diagnosis Results

### Context Explosion Analysis
${state.diagnosis.context ?
  `- **Status**: ${state.diagnosis.context.status}
- **Severity**: ${state.diagnosis.context.severity}
- **Issues Found**: ${state.diagnosis.context.issues_found}
- **Key Findings**: ${state.diagnosis.context.details.recommendations.join('; ') || 'None'}` :
  '_Not analyzed_'}

### Long-tail Memory Analysis
${state.diagnosis.memory ?
  `- **Status**: ${state.diagnosis.memory.status}
- **Severity**: ${state.diagnosis.memory.severity}
- **Issues Found**: ${state.diagnosis.memory.issues_found}
- **Key Findings**: ${state.diagnosis.memory.details.recommendations.join('; ') || 'None'}` :
  '_Not analyzed_'}

### Data Flow Analysis
${state.diagnosis.dataflow ?
  `- **Status**: ${state.diagnosis.dataflow.status}
- **Severity**: ${state.diagnosis.dataflow.severity}
- **Issues Found**: ${state.diagnosis.dataflow.issues_found}
- **Key Findings**: ${state.diagnosis.dataflow.details.recommendations.join('; ') || 'None'}` :
  '_Not analyzed_'}

### Agent Coordination Analysis
${state.diagnosis.agent ?
  `- **Status**: ${state.diagnosis.agent.status}
- **Severity**: ${state.diagnosis.agent.severity}
- **Issues Found**: ${state.diagnosis.agent.issues_found}
- **Key Findings**: ${state.diagnosis.agent.details.recommendations.join('; ') || 'None'}` :
  '_Not analyzed_'}

---

## Critical & High Priority Issues

${issuesBySeverity.critical.length + issuesBySeverity.high.length === 0 ?
  '_No critical or high priority issues found._' :
  [...issuesBySeverity.critical, ...issuesBySeverity.high].map((issue, i) => `
### ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}

- **ID**: ${issue.id}
- **Type**: ${issue.type}
- **Location**: ${typeof issue.location === 'object' ? issue.location.file : issue.location}
- **Root Cause**: ${issue.root_cause}
- **Impact**: ${issue.impact}
- **Suggested Fix**: ${issue.suggested_fix}

**Evidence**:
${issue.evidence.map(e => `- \`${e}\``).join('\n')}
`).join('\n')}

---

## Medium & Low Priority Issues

${issuesBySeverity.medium.length + issuesBySeverity.low.length === 0 ?
  '_No medium or low priority issues found._' :
  [...issuesBySeverity.medium, ...issuesBySeverity.low].map((issue, i) => `
### ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}

- **ID**: ${issue.id}
- **Type**: ${issue.type}
- **Suggested Fix**: ${issue.suggested_fix}
`).join('\n')}

---

## Recommended Fix Order

Based on severity and dependencies, apply fixes in this order:

${[...issuesBySeverity.critical, ...issuesBySeverity.high, ...issuesBySeverity.medium]
  .slice(0, 10)
  .map((issue, i) => `${i + 1}. **${issue.id}**: ${issue.suggested_fix}`)
  .join('\n')}

---

## Quality Gates

| Gate | Threshold | Current | Status |
|------|-----------|---------|--------|
| Critical Issues | 0 | ${issuesBySeverity.critical.length} | ${issuesBySeverity.critical.length === 0 ? '✅ PASS' : '❌ FAIL'} |
| High Issues | ≤ 2 | ${issuesBySeverity.high.length} | ${issuesBySeverity.high.length <= 2 ? '✅ PASS' : '❌ FAIL'} |
| Health Score | ≥ 60 | ${healthScore} | ${healthScore >= 60 ? '✅ PASS' : '❌ FAIL'} |

**Overall Quality Gate**: ${
  issuesBySeverity.critical.length === 0 &&
  issuesBySeverity.high.length <= 2 &&
  healthScore >= 60 ? '✅ PASS' : '❌ FAIL'}

---

*Report generated by skill-tuning*
`;

  // 5. Write report
  Write(`${workDir}/tuning-report.md`, report);

  // 6. Calculate quality gate
  const qualityGate = issuesBySeverity.critical.length === 0 &&
                      issuesBySeverity.high.length <= 2 &&
                      healthScore >= 60 ? 'pass' :
                      healthScore >= 40 ? 'review' : 'fail';

  return {
    stateUpdates: {
      quality_score: healthScore,
      quality_gate: qualityGate,
      issues_by_severity: {
        critical: issuesBySeverity.critical.length,
        high: issuesBySeverity.high.length,
        medium: issuesBySeverity.medium.length,
        low: issuesBySeverity.low.length
      }
    },
    outputFiles: [`${workDir}/tuning-report.md`],
    summary: `Report generated: ${issues.length} issues, health score ${healthScore}/100, gate: ${qualityGate}`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    quality_score: <0-100>,
    quality_gate: '<pass|review|fail>',
    issues_by_severity: { critical: N, high: N, medium: N, low: N }
  }
};
```

## Error Handling

| Error Type | Recovery |
|------------|----------|
| Write error | Retry to alternative path |
| Empty issues | Generate summary with no issues |

## Next Actions

- If issues.length > 0: action-propose-fixes
- If issues.length === 0: action-complete
