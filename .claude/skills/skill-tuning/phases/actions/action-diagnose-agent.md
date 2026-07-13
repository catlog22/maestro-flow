
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Diagnose Agent Coordination

Analyze target skill for agent coordination failures - call chain fragility and result passing issues.

## Purpose

- Detect fragile agent call patterns
- Identify result passing issues
- Find missing error handling in agent calls
- Analyze agent return format consistency

## Preconditions

- [ ] state.status === 'running'
- [ ] state.target_skill.path is set
- [ ] 'agent' in state.focus_areas OR state.focus_areas is empty

## Detection Patterns

### Pattern 1: Unhandled Agent Failures

```regex
# Task calls without try-catch or error handling
/Task\s*\(\s*\{[^}]*\}\s*\)(?![^;]*catch)/
```

### Pattern 2: Missing Return Validation

```regex
# Agent result used directly without validation
/const\s+\w+\s*=\s*await?\s*Task\([^)]+\);\s*(?!.*(?:if|try|JSON\.parse))/
```

### Pattern 3: Inconsistent Agent Configuration

```regex
# Different agent configurations in same skill
/subagent_type:\s*['"](\w+)['"]/g
```

### Pattern 4: Deeply Nested Agent Calls

```regex
# Agent calling another agent (nested)
/Task\s*\([^)]*prompt:[^)]*Task\s*\(/
```

## Execution

```javascript
async function execute(state, workDir) {
  const skillPath = state.target_skill.path;
  const startTime = Date.now();
  const issues = [];
  const evidence = [];

  console.log(`Diagnosing agent coordination in ${skillPath}...`);

  // 1. Find all Task/agent calls
  const allFiles = Glob(`${skillPath}/**/*.md`);
  const agentCalls = [];
  const agentTypes = new Set();

  for (const file of allFiles) {
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');

    // Find Task calls
    const taskMatches = content.matchAll(/Task\s*\(\s*\{([^}]+)\}/g);
    for (const match of taskMatches) {
      const config = match[1];

      // Extract agent type
      const typeMatch = config.match(/subagent_type:\s*['"]([^'"]+)['"]/);
      const agentType = typeMatch ? typeMatch[1] : 'unknown';
      agentTypes.add(agentType);

      // Check for error handling context
      const hasErrorHandling = /try\s*\{.*Task|\.catch\(|await\s+Task.*\.then/s.test(
        content.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100)
      );

      // Check for result validation
      const hasResultValidation = /JSON\.parse|if\s*\(\s*result|result\s*\?\./s.test(
        content.slice(match.index, match.index + match[0].length + 200)
      );

      // Check for background execution
      const runsInBackground = /run_in_background:\s*true/.test(config);

      agentCalls.push({
        file: relativePath,
        agentType,
        hasErrorHandling,
        hasResultValidation,
        runsInBackground,
        config: config.slice(0, 200)
      });
    }
  }

  // 2. Analyze agent call patterns
  const totalCalls = agentCalls.length;
  const callsWithoutErrorHandling = agentCalls.filter(c => !c.hasErrorHandling);
  const callsWithoutValidation = agentCalls.filter(c => !c.hasResultValidation);

  // Issue: Missing error handling
  if (callsWithoutErrorHandling.length > 0) {
    issues.push({
      id: `AGT-${issues.length + 1}`,
      type: 'agent_failure',
      severity: callsWithoutErrorHandling.length > 2 ? 'high' : 'medium',
      location: { file: 'multiple' },
      description: `${callsWithoutErrorHandling.length}/${totalCalls} agent calls lack error handling`,
      evidence: callsWithoutErrorHandling.slice(0, 3).map(c =>
        `${c.file}: ${c.agentType}`
      ),
      root_cause: 'Agent failures not caught, may crash workflow',
      impact: 'Unhandled agent errors cause cascading failures',
      suggested_fix: 'Wrap Task calls in try-catch with graceful fallback'
    });
    evidence.push({
      file: 'multiple',
      pattern: 'missing_error_handling',
      context: `${callsWithoutErrorHandling.length} calls affected`,
      severity: 'high'
    });
  }

  // Issue: Missing result validation
  if (callsWithoutValidation.length > 0) {
    issues.push({
      id: `AGT-${issues.length + 1}`,
      type: 'agent_failure',
      severity: 'medium',
      location: { file: 'multiple' },
      description: `${callsWithoutValidation.length}/${totalCalls} agent calls lack result validation`,
      evidence: callsWithoutValidation.slice(0, 3).map(c =>
        `${c.file}: ${c.agentType} result not validated`
      ),
      root_cause: 'Agent results used directly without type checking',
      impact: 'Invalid agent output may corrupt state',
      suggested_fix: 'Add JSON.parse with try-catch and schema validation'
    });
  }

  // 3. Check for inconsistent agent types usage
  if (agentTypes.size > 3 && state.target_skill.execution_mode === 'autonomous') {
    issues.push({
      id: `AGT-${issues.length + 1}`,
      type: 'agent_failure',
      severity: 'low',
      location: { file: 'multiple' },
      description: `Using ${agentTypes.size} different agent types`,
      evidence: [...agentTypes].slice(0, 5),
      root_cause: 'Multiple agent types increase coordination complexity',
      impact: 'Different agent behaviors may cause inconsistency',
      suggested_fix: 'Standardize on fewer agent types with clear roles'
    });
  }

  // 4. Check for nested agent calls
  for (const file of allFiles) {
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');

    // Detect nested Task calls
    const hasNestedTask = /Task\s*\([^)]*prompt:[^)]*Task\s*\(/s.test(content);

    if (hasNestedTask) {
      issues.push({
        id: `AGT-${issues.length + 1}`,
        type: 'agent_failure',
        severity: 'high',
        location: { file: relativePath },
        description: 'Nested agent calls detected',
        evidence: ['Agent prompt contains another Task call'],
        root_cause: 'Agent calls another agent, creating deep nesting',
        impact: 'Context explosion, hard to debug, unpredictable behavior',
        suggested_fix: 'Flatten agent calls, use orchestrator to coordinate'
      });
    }
  }

  // 5. Check SKILL.md for agent configuration consistency
  const skillMd = Read(`${skillPath}/SKILL.md`);

  // Check if allowed-tools includes Task
  const allowedTools = skillMd.match(/allowed-tools:\s*([^\n]+)/i);
  if (allowedTools && !allowedTools[1].includes('Task') && totalCalls > 0) {
    issues.push({
      id: `AGT-${issues.length + 1}`,
      type: 'agent_failure',
      severity: 'medium',
      location: { file: 'SKILL.md' },
      description: 'Agent tool used but not declared in allowed-tools',
      evidence: [`${totalCalls} Task calls found, but Task not in allowed-tools`],
      root_cause: 'Tool declaration mismatch',
      impact: 'May cause runtime permission issues',
      suggested_fix: 'Add Task to allowed-tools in SKILL.md front matter'
    });
  }

  // 6. Check for agent result format consistency
  const returnFormats = new Set();
  for (const file of allFiles) {
    const content = Read(file);

    // Look for return format definitions
    const returnMatch = content.match(/\[RETURN\][^[]*|return\s*\{[^}]+\}/gi);
    if (returnMatch) {
      returnMatch.forEach(r => {
        const format = r.includes('JSON') ? 'json' :
                       r.includes('summary') ? 'summary' :
                       r.includes('file') ? 'file_path' : 'other';
        returnFormats.add(format);
      });
    }
  }

  if (returnFormats.size > 2) {
    issues.push({
      id: `AGT-${issues.length + 1}`,
      type: 'agent_failure',
      severity: 'medium',
      location: { file: 'multiple' },
      description: 'Inconsistent agent return formats',
      evidence: [...returnFormats],
      root_cause: 'Different agents return data in different formats',
      impact: 'Orchestrator must handle multiple format types',
      suggested_fix: 'Standardize return format: {status, output_file, summary}'
    });
  }

  // 7. Calculate severity
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;
  const severity = criticalCount > 0 ? 'critical' :
                   highCount > 1 ? 'high' :
                   highCount > 0 ? 'medium' :
                   issues.length > 0 ? 'low' : 'none';

  // 8. Write diagnosis result
  const diagnosisResult = {
    status: 'completed',
    issues_found: issues.length,
    severity: severity,
    execution_time_ms: Date.now() - startTime,
    details: {
      patterns_checked: [
        'error_handling',
        'result_validation',
        'agent_type_consistency',
        'nested_calls',
        'return_format_consistency'
      ],
      patterns_matched: evidence.map(e => e.pattern),
      evidence: evidence,
      agent_analysis: {
        total_agent_calls: totalCalls,
        unique_agent_types: agentTypes.size,
        calls_without_error_handling: callsWithoutErrorHandling.length,
        calls_without_validation: callsWithoutValidation.length,
        agent_types_used: [...agentTypes]
      },
      recommendations: [
        callsWithoutErrorHandling.length > 0
          ? 'Add try-catch to all Task calls' : null,
        callsWithoutValidation.length > 0
          ? 'Add result validation with JSON.parse and schema check' : null,
        agentTypes.size > 3
          ? 'Consolidate agent types for consistency' : null
      ].filter(Boolean)
    }
  };

  Write(`${workDir}/diagnosis/agent-diagnosis.json`,
        JSON.stringify(diagnosisResult, null, 2));

  return {
    stateUpdates: {
      'diagnosis.agent': diagnosisResult,
      issues: [...state.issues, ...issues]
    },
    outputFiles: [`${workDir}/diagnosis/agent-diagnosis.json`],
    summary: `Agent diagnosis: ${issues.length} issues found (severity: ${severity})`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    'diagnosis.agent': {
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
| Regex match error | Use simpler patterns |
| File access error | Skip and continue |

## Next Actions

- Success: action-generate-report
- Skipped: If 'agent' not in focus_areas
