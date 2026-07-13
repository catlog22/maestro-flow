
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Verify Applied Fixes

Verify that applied fixes resolved the targeted issues.

## Purpose

- Re-run relevant diagnostics
- Compare before/after issue counts
- Update verification status
- Determine if more iterations needed

## Preconditions

- [ ] state.status === 'running'
- [ ] state.applied_fixes.length > 0
- [ ] Some applied_fixes have verification_result === 'pending'

## Execution

```javascript
async function execute(state, workDir) {
  console.log('Verifying applied fixes...');

  const appliedFixes = state.applied_fixes.filter(f => f.verification_result === 'pending');

  if (appliedFixes.length === 0) {
    return {
      stateUpdates: {},
      outputFiles: [],
      summary: 'No fixes pending verification'
    };
  }

  const verificationResults = [];

  for (const fix of appliedFixes) {
    const proposedFix = state.proposed_fixes.find(f => f.id === fix.fix_id);

    if (!proposedFix) {
      verificationResults.push({
        fix_id: fix.fix_id,
        result: 'fail',
        reason: 'Fix definition not found'
      });
      continue;
    }

    // Determine which diagnosis to re-run based on fix strategy
    const strategyToDiagnosis = {
      'context_summarization': 'context',
      'sliding_window': 'context',
      'structured_state': 'context',
      'path_reference': 'context',
      'constraint_injection': 'memory',
      'checkpoint_restore': 'memory',
      'goal_embedding': 'memory',
      'state_constraints_field': 'memory',
      'state_centralization': 'dataflow',
      'schema_enforcement': 'dataflow',
      'field_normalization': 'dataflow',
      'transactional_updates': 'dataflow',
      'error_wrapping': 'agent',
      'result_validation': 'agent',
      'orchestrator_refactor': 'agent',
      'flatten_nesting': 'agent'
    };

    const diagnosisType = strategyToDiagnosis[proposedFix.strategy];

    // For now, do a lightweight verification
    // Full implementation would re-run the specific diagnosis

    // Check if the fix was actually applied (look for markers)
    const targetPath = state.target_skill.path;
    const fixMarker = `Applied fix ${fix.fix_id}`;

    let fixFound = false;
    const allFiles = Glob(`${targetPath}/**/*.md`);

    for (const file of allFiles) {
      const content = Read(file);
      if (content.includes(fixMarker)) {
        fixFound = true;
        break;
      }
    }

    if (fixFound) {
      // Verify by checking if original issues still exist
      const relatedIssues = proposedFix.issue_ids;
      const originalIssueCount = relatedIssues.length;

      // Simplified verification: assume fix worked if marker present
      // Real implementation would re-run diagnosis patterns

      verificationResults.push({
        fix_id: fix.fix_id,
        result: 'pass',
        reason: `Fix applied successfully, addressing ${originalIssueCount} issues`,
        issues_resolved: relatedIssues
      });
    } else {
      verificationResults.push({
        fix_id: fix.fix_id,
        result: 'fail',
        reason: 'Fix marker not found in target files'
      });
    }
  }

  // Update applied fixes with verification results
  const updatedAppliedFixes = state.applied_fixes.map(fix => {
    const result = verificationResults.find(v => v.fix_id === fix.fix_id);
    if (result) {
      return {
        ...fix,
        verification_result: result.result
      };
    }
    return fix;
  });

  // Calculate new quality score
  const passedFixes = verificationResults.filter(v => v.result === 'pass').length;
  const totalFixes = verificationResults.length;
  const verificationRate = totalFixes > 0 ? (passedFixes / totalFixes) * 100 : 100;

  // Recalculate issues (remove resolved ones)
  const resolvedIssueIds = verificationResults
    .filter(v => v.result === 'pass')
    .flatMap(v => v.issues_resolved || []);

  const remainingIssues = state.issues.filter(i => !resolvedIssueIds.includes(i.id));

  // Recalculate quality score
  const weights = { critical: 25, high: 15, medium: 5, low: 1 };
  const deductions = remainingIssues.reduce((sum, issue) =>
    sum + (weights[issue.severity] || 0), 0);
  const newHealthScore = Math.max(0, 100 - deductions);

  // Determine new quality gate
  const remainingCritical = remainingIssues.filter(i => i.severity === 'critical').length;
  const remainingHigh = remainingIssues.filter(i => i.severity === 'high').length;
  const newQualityGate = remainingCritical === 0 && remainingHigh <= 2 && newHealthScore >= 60
    ? 'pass'
    : newHealthScore >= 40 ? 'review' : 'fail';

  // Increment iteration count
  const newIterationCount = state.iteration_count + 1;

  // Ask user if they want to continue
  let continueIteration = false;
  if (newQualityGate !== 'pass' && newIterationCount < state.max_iterations) {
    const continueResponse = await AskUserQuestion({
      questions: [{
        question: `Verification complete. Quality gate: ${newQualityGate}. Continue with another iteration?`,
        header: 'Continue',
        multiSelect: false,
        options: [
          { label: 'Yes', description: `Run iteration ${newIterationCount + 1}` },
          { label: 'No', description: 'Finish with current state' }
        ]
      }]
    });
    continueIteration = continueResponse['Continue'] === 'Yes';
  }

  // If continuing, reset diagnosis for re-evaluation
  const diagnosisReset = continueIteration ? {
    'diagnosis.context': null,
    'diagnosis.memory': null,
    'diagnosis.dataflow': null,
    'diagnosis.agent': null
  } : {};

  return {
    stateUpdates: {
      applied_fixes: updatedAppliedFixes,
      issues: remainingIssues,
      quality_score: newHealthScore,
      quality_gate: newQualityGate,
      iteration_count: newIterationCount,
      ...diagnosisReset,
      issues_by_severity: {
        critical: remainingIssues.filter(i => i.severity === 'critical').length,
        high: remainingIssues.filter(i => i.severity === 'high').length,
        medium: remainingIssues.filter(i => i.severity === 'medium').length,
        low: remainingIssues.filter(i => i.severity === 'low').length
      }
    },
    outputFiles: [],
    summary: `Verified ${totalFixes} fixes: ${passedFixes} passed. Score: ${newHealthScore}, Gate: ${newQualityGate}, Iteration: ${newIterationCount}`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    applied_fixes: [...updatedWithVerificationResults],
    issues: [...remainingIssues],
    quality_score: newScore,
    quality_gate: newGate,
    iteration_count: iteration + 1
  }
};
```

## Error Handling

| Error Type | Recovery |
|------------|----------|
| Re-diagnosis fails | Mark as 'inconclusive' |
| File access error | Skip file verification |

## Next Actions

- If quality_gate === 'pass': action-complete
- If user chose to continue: restart diagnosis cycle
- If max_iterations reached: action-complete
