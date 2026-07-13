
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Abort

Abort the tuning session due to unrecoverable errors.

## Purpose

- Safely terminate on critical failures
- Preserve diagnostic information for debugging
- Ensure backup remains available
- Notify user of failure reason

## Preconditions

- [ ] state.error_count >= state.max_errors
- [ ] OR critical failure detected

## Execution

```javascript
async function execute(state, workDir) {
  console.log('Aborting skill tuning session...');

  const errors = state.errors;
  const targetSkill = state.target_skill;

  // Generate abort report
  const abortReport = `# Skill Tuning Aborted

**Target Skill**: ${targetSkill?.name || 'Unknown'}
**Aborted At**: ${new Date().toISOString()}
**Reason**: Too many errors or critical failure

---

## Error Log

${errors.length === 0 ? '_No errors recorded_' :
  errors.map((err, i) => `
### Error ${i + 1}
- **Action**: ${err.action}
- **Message**: ${err.message}
- **Time**: ${err.timestamp}
- **Recoverable**: ${err.recoverable ? 'Yes' : 'No'}
`).join('\n')}

---

## Session State at Abort

- **Status**: ${state.status}
- **Iteration Count**: ${state.iteration_count}
- **Completed Actions**: ${state.completed_actions.length}
- **Issues Found**: ${state.issues.length}
- **Fixes Applied**: ${state.applied_fixes.length}

---

## Recovery Options

### Option 1: Restore Original Skill
If any changes were made, restore from backup:
\`\`\`bash
cp -r "${state.backup_dir}/${targetSkill?.name || 'backup'}-backup"/* "${targetSkill?.path || 'target'}/"
\`\`\`

### Option 2: Resume from Last State
The session state is preserved at:
\`${workDir}/state.json\`

To resume:
1. Fix the underlying issue
2. Reset error_count in state.json
3. Re-run skill-tuning with --resume flag

### Option 3: Manual Investigation
Review the following files:
- Diagnosis results: \`${workDir}/diagnosis/*.json\`
- Error log: \`${workDir}/errors.json\`
- State snapshot: \`${workDir}/state.json\`

---

## Diagnostic Information

### Last Successful Action
${state.completed_actions.length > 0 ? state.completed_actions[state.completed_actions.length - 1] : 'None'}

### Current Action When Failed
${state.current_action || 'Unknown'}

### Partial Diagnosis Results
- Context: ${state.diagnosis.context ? 'Completed' : 'Not completed'}
- Memory: ${state.diagnosis.memory ? 'Completed' : 'Not completed'}
- Data Flow: ${state.diagnosis.dataflow ? 'Completed' : 'Not completed'}
- Agent: ${state.diagnosis.agent ? 'Completed' : 'Not completed'}

---

*Skill tuning aborted - please review errors and retry*
`;

  // Write abort report
  Write(`${workDir}/abort-report.md`, abortReport);

  // Save error log
  Write(`${workDir}/errors.json`, JSON.stringify(errors, null, 2));

  // Notify user
  await AskUserQuestion({
    questions: [{
      question: `Skill tuning aborted due to ${errors.length} errors. Would you like to restore the original skill?`,
      header: 'Restore',
      multiSelect: false,
      options: [
        { label: 'Yes, restore', description: 'Restore original skill from backup' },
        { label: 'No, keep changes', description: 'Keep any partial changes made' }
      ]
    }]
  }).then(async response => {
    if (response['Restore'] === 'Yes, restore') {
      // Restore from backup
      if (state.backup_dir && targetSkill?.path) {
        Bash(`cp -r "${state.backup_dir}/${targetSkill.name}-backup"/* "${targetSkill.path}/"`);
        console.log('Original skill restored from backup.');
      }
    }
  }).catch(() => {
    // User cancelled, don't restore
  });

  return {
    stateUpdates: {
      status: 'failed',
      completed_at: new Date().toISOString()
    },
    outputFiles: [`${workDir}/abort-report.md`, `${workDir}/errors.json`],
    summary: `Tuning aborted: ${errors.length} errors. Check abort-report.md for details.`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    status: 'failed',
    completed_at: '<timestamp>'
  }
};
```

## Output

- **File**: `abort-report.md`
- **Location**: `${workDir}/abort-report.md`

## Error Handling

This action should not fail - it's the final error handler.

## Next Actions

- None (terminal state)
