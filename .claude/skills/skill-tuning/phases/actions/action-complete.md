
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Complete

Finalize the tuning session with summary report and cleanup.

## Purpose

- Generate final summary report
- Record tuning statistics
- Clean up temporary files (optional)
- Provide recommendations for future maintenance

## Preconditions

- [ ] state.status === 'running'
- [ ] quality_gate === 'pass' OR max_iterations reached

## Execution

```javascript
async function execute(state, workDir) {
  console.log('Finalizing skill tuning session...');

  const targetSkill = state.target_skill;
  const startTime = new Date(state.started_at);
  const endTime = new Date();
  const duration = Math.round((endTime - startTime) / 1000);

  // Generate final summary
  const summary = `# Skill Tuning Summary

**Target Skill**: ${targetSkill.name}
**Path**: ${targetSkill.path}
**Session Duration**: ${duration} seconds
**Completed**: ${endTime.toISOString()}

---

## Final Status

| Metric | Value |
|--------|-------|
| Final Health Score | ${state.quality_score}/100 |
| Quality Gate | ${state.quality_gate.toUpperCase()} |
| Total Iterations | ${state.iteration_count} |
| Issues Found | ${state.issues.length + state.applied_fixes.flatMap(f => f.issues_resolved || []).length} |
| Issues Resolved | ${state.applied_fixes.flatMap(f => f.issues_resolved || []).length} |
| Fixes Applied | ${state.applied_fixes.length} |
| Fixes Verified | ${state.applied_fixes.filter(f => f.verification_result === 'pass').length} |

---

## Diagnosis Summary

| Area | Issues Found | Severity |
|------|--------------|----------|
| Context Explosion | ${state.diagnosis.context?.issues_found || 'N/A'} | ${state.diagnosis.context?.severity || 'N/A'} |
| Long-tail Forgetting | ${state.diagnosis.memory?.issues_found || 'N/A'} | ${state.diagnosis.memory?.severity || 'N/A'} |
| Data Flow | ${state.diagnosis.dataflow?.issues_found || 'N/A'} | ${state.diagnosis.dataflow?.severity || 'N/A'} |
| Agent Coordination | ${state.diagnosis.agent?.issues_found || 'N/A'} | ${state.diagnosis.agent?.severity || 'N/A'} |

---

## Applied Fixes

${state.applied_fixes.length === 0 ? '_No fixes applied_' :
  state.applied_fixes.map((fix, i) => `
### ${i + 1}. ${fix.fix_id}

- **Applied At**: ${fix.applied_at}
- **Success**: ${fix.success ? 'Yes' : 'No'}
- **Verification**: ${fix.verification_result}
- **Rollback Available**: ${fix.rollback_available ? 'Yes' : 'No'}
`).join('\n')}

---

## Remaining Issues

${state.issues.length === 0 ? '✅ All issues resolved!' :
  `${state.issues.length} issues remain:\n\n` +
  state.issues.map(issue =>
    `- **[${issue.severity.toUpperCase()}]** ${issue.description} (${issue.id})`
  ).join('\n')}

---

## Recommendations

${generateRecommendations(state)}

---

## Backup Information

Original skill files backed up to:
\`${state.backup_dir}\`

To restore original skill:
\`\`\`bash
cp -r "${state.backup_dir}/${targetSkill.name}-backup"/* "${targetSkill.path}/"
\`\`\`

---

## Session Files

| File | Description |
|------|-------------|
| ${workDir}/tuning-report.md | Full diagnostic report |
| ${workDir}/diagnosis/*.json | Individual diagnosis results |
| ${workDir}/fixes/fix-proposals.json | Proposed fixes |
| ${workDir}/fixes/applied-fixes.json | Applied fix history |
| ${workDir}/tuning-summary.md | This summary |

---

*Skill tuning completed by skill-tuning*
`;

  Write(`${workDir}/tuning-summary.md`, summary);

  // Update final state
  return {
    stateUpdates: {
      status: 'completed',
      completed_at: endTime.toISOString()
    },
    outputFiles: [`${workDir}/tuning-summary.md`],
    summary: `Tuning complete: ${state.quality_gate} with ${state.quality_score}/100 health score`
  };
}

function generateRecommendations(state) {
  const recommendations = [];

  // Based on remaining issues
  if (state.issues.some(i => i.type === 'context_explosion')) {
    recommendations.push('- **Context Management**: Consider implementing a context summarization agent to prevent token growth');
  }

  if (state.issues.some(i => i.type === 'memory_loss')) {
    recommendations.push('- **Constraint Tracking**: Add explicit constraint injection to each phase prompt');
  }

  if (state.issues.some(i => i.type === 'dataflow_break')) {
    recommendations.push('- **State Centralization**: Migrate to single state.json with schema validation');
  }

  if (state.issues.some(i => i.type === 'agent_failure')) {
    recommendations.push('- **Error Handling**: Wrap all Task calls in try-catch blocks');
  }

  // General recommendations
  if (state.iteration_count >= state.max_iterations) {
    recommendations.push('- **Deep Refactoring**: Consider architectural review if issues persist after multiple iterations');
  }

  if (state.quality_score < 80) {
    recommendations.push('- **Regular Tuning**: Schedule periodic skill-tuning runs to catch issues early');
  }

  if (recommendations.length === 0) {
    recommendations.push('- Skill is in good health! Monitor for regressions during future development.');
  }

  return recommendations.join('\n');
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    status: 'completed',
    completed_at: '<timestamp>'
  }
};
```

## Output

- **File**: `tuning-summary.md`
- **Location**: `${workDir}/tuning-summary.md`
- **Format**: Markdown

## Error Handling

| Error Type | Recovery |
|------------|----------|
| Summary write failed | Write to alternative location |

## Next Actions

- None (terminal state)
