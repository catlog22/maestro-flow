
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Diagnose Long-tail Forgetting

Analyze target skill for long-tail effect and constraint forgetting issues.

## Purpose

- Detect loss of early instructions in long execution chains
- Identify missing constraint propagation mechanisms
- Find weak goal alignment between phases
- Measure instruction retention across phases

## Preconditions

- [ ] state.status === 'running'
- [ ] state.target_skill.path is set
- [ ] 'memory' in state.focus_areas OR state.focus_areas is empty

## Detection Patterns

### Pattern 1: Missing Constraint References

```regex
# Phases that don't reference original requirements
# Look for absence of: requirements, constraints, original, initial, user_request
```

### Pattern 2: Goal Drift

```regex
# Later phases focus on immediate task without global context
/\[TASK\][^[]*(?!\[CONSTRAINTS\]|\[REQUIREMENTS\])/
```

### Pattern 3: No Checkpoint Mechanism

```regex
# Absence of state preservation at key points
# Look for lack of: checkpoint, snapshot, preserve, restore
```

### Pattern 4: Implicit State Passing

```regex
# State passed implicitly through conversation rather than explicitly
/(?<!state\.)context\./
```

## Execution

```javascript
async function execute(state, workDir) {
  const skillPath = state.target_skill.path;
  const startTime = Date.now();
  const issues = [];
  const evidence = [];

  console.log(`Diagnosing long-tail forgetting in ${skillPath}...`);

  // 1. Analyze phase chain for constraint propagation
  const phaseFiles = Glob(`${skillPath}/phases/*.md`)
    .filter(f => !f.includes('orchestrator') && !f.includes('state-schema'))
    .sort();

  // Extract phase order (for sequential) or action dependencies (for autonomous)
  const isAutonomous = state.target_skill.execution_mode === 'autonomous';

  // 2. Check each phase for constraint awareness
  let firstPhaseConstraints = [];

  for (let i = 0; i < phaseFiles.length; i++) {
    const file = phaseFiles[i];
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');
    const phaseNum = i + 1;

    // Extract constraints from first phase
    if (i === 0) {
      const constraintMatch = content.match(/\[CONSTRAINTS?\]([^[]*)/i);
      if (constraintMatch) {
        firstPhaseConstraints = constraintMatch[1]
          .split('\n')
          .filter(l => l.trim().startsWith('-'))
          .map(l => l.trim().replace(/^-\s*/, ''));
      }
    }

    // Check if later phases reference original constraints
    if (i > 0 && firstPhaseConstraints.length > 0) {
      const mentionsConstraints = firstPhaseConstraints.some(c =>
        content.toLowerCase().includes(c.toLowerCase().slice(0, 20))
      );

      if (!mentionsConstraints) {
        issues.push({
          id: `MEM-${issues.length + 1}`,
          type: 'memory_loss',
          severity: 'high',
          location: { file: relativePath, phase: `Phase ${phaseNum}` },
          description: `Phase ${phaseNum} does not reference original constraints`,
          evidence: [`Original constraints: ${firstPhaseConstraints.slice(0, 3).join(', ')}`],
          root_cause: 'Constraint information not propagated to later phases',
          impact: 'May produce output violating original requirements',
          suggested_fix: 'Add explicit constraint injection or reference to state.original_constraints'
        });
        evidence.push({
          file: relativePath,
          pattern: 'missing_constraint_reference',
          context: `Phase ${phaseNum} of ${phaseFiles.length}`,
          severity: 'high'
        });
      }
    }

    // Check for goal drift - task without constraints
    const hasTask = /\[TASK\]/i.test(content);
    const hasConstraints = /\[CONSTRAINTS?\]|\[REQUIREMENTS?\]|\[RULES?\]/i.test(content);

    if (hasTask && !hasConstraints && i > 1) {
      issues.push({
        id: `MEM-${issues.length + 1}`,
        type: 'memory_loss',
        severity: 'medium',
        location: { file: relativePath },
        description: 'Phase has TASK but no CONSTRAINTS/RULES section',
        evidence: ['Task defined without boundary constraints'],
        root_cause: 'Agent may not adhere to global constraints',
        impact: 'Potential goal drift from original intent',
        suggested_fix: 'Add [CONSTRAINTS] section referencing global rules'
      });
    }

    // Check for checkpoint mechanism
    const hasCheckpoint = /checkpoint|snapshot|preserve|savepoint/i.test(content);
    const isKeyPhase = i === Math.floor(phaseFiles.length / 2) || i === phaseFiles.length - 1;

    if (isKeyPhase && !hasCheckpoint && phaseFiles.length > 3) {
      issues.push({
        id: `MEM-${issues.length + 1}`,
        type: 'memory_loss',
        severity: 'low',
        location: { file: relativePath },
        description: 'Key phase without checkpoint mechanism',
        evidence: [`Phase ${phaseNum} is a key milestone but has no state preservation`],
        root_cause: 'Cannot recover from failures or verify constraint adherence',
        impact: 'No rollback capability if constraints violated',
        suggested_fix: 'Add checkpoint before major state changes'
      });
    }
  }

  // 3. Check for explicit state schema with constraints field
  const stateSchemaFile = Glob(`${skillPath}/phases/state-schema.md`)[0];
  if (stateSchemaFile) {
    const schemaContent = Read(stateSchemaFile);
    const hasConstraintsField = /constraints|requirements|original_request/i.test(schemaContent);

    if (!hasConstraintsField) {
      issues.push({
        id: `MEM-${issues.length + 1}`,
        type: 'memory_loss',
        severity: 'medium',
        location: { file: 'phases/state-schema.md' },
        description: 'State schema lacks constraints/requirements field',
        evidence: ['No dedicated field for preserving original requirements'],
        root_cause: 'State structure does not support constraint persistence',
        impact: 'Constraints may be lost during state transitions',
        suggested_fix: 'Add original_requirements field to state schema'
      });
    }
  }

  // 4. Check SKILL.md for constraint enforcement in execution flow
  const skillMd = Read(`${skillPath}/SKILL.md`);
  const hasConstraintVerification = /constraint.*verif|verif.*constraint|quality.*gate/i.test(skillMd);

  if (!hasConstraintVerification && phaseFiles.length > 3) {
    issues.push({
      id: `MEM-${issues.length + 1}`,
      type: 'memory_loss',
      severity: 'medium',
      location: { file: 'SKILL.md' },
      description: 'No constraint verification step in execution flow',
      evidence: ['Execution flow lacks quality gate or constraint check'],
      root_cause: 'No mechanism to verify output matches original intent',
      impact: 'Constraint violations may go undetected',
      suggested_fix: 'Add verification phase comparing output to original requirements'
    });
  }

  // 5. Calculate severity
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;
  const severity = criticalCount > 0 ? 'critical' :
                   highCount > 2 ? 'high' :
                   highCount > 0 ? 'medium' :
                   issues.length > 0 ? 'low' : 'none';

  // 6. Write diagnosis result
  const diagnosisResult = {
    status: 'completed',
    issues_found: issues.length,
    severity: severity,
    execution_time_ms: Date.now() - startTime,
    details: {
      patterns_checked: [
        'constraint_propagation',
        'goal_drift',
        'checkpoint_mechanism',
        'state_schema_constraints'
      ],
      patterns_matched: evidence.map(e => e.pattern),
      evidence: evidence,
      phase_analysis: {
        total_phases: phaseFiles.length,
        first_phase_constraints: firstPhaseConstraints.length,
        phases_with_constraint_ref: phaseFiles.length - issues.filter(i =>
          i.description.includes('does not reference')).length
      },
      recommendations: [
        highCount > 0 ? 'Implement constraint injection at each phase' : null,
        issues.some(i => i.description.includes('checkpoint'))
          ? 'Add checkpoint/restore mechanism' : null,
        issues.some(i => i.description.includes('State schema'))
          ? 'Add original_requirements to state schema' : null
      ].filter(Boolean)
    }
  };

  Write(`${workDir}/diagnosis/memory-diagnosis.json`,
        JSON.stringify(diagnosisResult, null, 2));

  return {
    stateUpdates: {
      'diagnosis.memory': diagnosisResult,
      issues: [...state.issues, ...issues]
    },
    outputFiles: [`${workDir}/diagnosis/memory-diagnosis.json`],
    summary: `Memory diagnosis: ${issues.length} issues found (severity: ${severity})`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    'diagnosis.memory': {
      status: 'completed',
      issues_found: <count>,
      severity: '<critical|high|medium|low|none>',
      // ... full diagnosis result
    },
    issues: [...existingIssues, ...newIssues]
  }
};
```

## Error Handling

| Error Type | Recovery |
|------------|----------|
| Phase file read error | Skip file, continue analysis |
| No phases found | Report as structure issue |

## Next Actions

- Success: action-diagnose-dataflow (or next in focus_areas)
- Skipped: If 'memory' not in focus_areas
