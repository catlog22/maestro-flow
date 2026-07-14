
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Diagnose Data Flow Issues

Analyze target skill for data flow disruption - state inconsistencies and format variations.

## Purpose

- Detect inconsistent data formats between phases
- Identify scattered state storage
- Find missing data contracts
- Measure state transition integrity

## Preconditions

- [ ] state.status === 'running'
- [ ] state.target_skill.path is set
- [ ] 'dataflow' in state.focus_areas OR state.focus_areas is empty

## Detection Patterns

### Pattern 1: Multiple Storage Locations

```regex
# Data written to multiple paths without centralization
/Write\s*\(\s*[`'"][^`'"]+[`'"]/g
```

### Pattern 2: Inconsistent Field Names

```regex
# Same concept with different names: title/name, id/identifier
```

### Pattern 3: Missing Schema Validation

```regex
# Absence of validation before state write
# Look for lack of: validate, schema, check, verify
```

### Pattern 4: Format Transformation Without Normalization

```regex
# Direct JSON.parse without error handling or normalization
/JSON\.parse\([^)]+\)(?!\s*\|\|)/
```

## Execution

```javascript
async function execute(state, workDir) {
  const skillPath = state.target_skill.path;
  const startTime = Date.now();
  const issues = [];
  const evidence = [];

  console.log(`Diagnosing data flow in ${skillPath}...`);

  // 1. Collect all Write operations to map data storage
  const allFiles = Glob(`${skillPath}/**/*.md`);
  const writeLocations = [];
  const readLocations = [];

  for (const file of allFiles) {
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');

    // Find Write operations
    const writeMatches = content.matchAll(/Write\s*\(\s*[`'"]([^`'"]+)[`'"]/g);
    for (const match of writeMatches) {
      writeLocations.push({
        file: relativePath,
        target: match[1],
        isStateFile: match[1].includes('state.json') || match[1].includes('config.json')
      });
    }

    // Find Read operations
    const readMatches = content.matchAll(/Read\s*\(\s*[`'"]([^`'"]+)[`'"]/g);
    for (const match of readMatches) {
      readLocations.push({
        file: relativePath,
        source: match[1]
      });
    }
  }

  // 2. Check for scattered state storage
  const stateTargets = writeLocations
    .filter(w => w.isStateFile)
    .map(w => w.target);

  const uniqueStateFiles = [...new Set(stateTargets)];

  if (uniqueStateFiles.length > 2) {
    issues.push({
      id: `DF-${issues.length + 1}`,
      type: 'dataflow_break',
      severity: 'high',
      location: { file: 'multiple' },
      description: `State stored in ${uniqueStateFiles.length} different locations`,
      evidence: uniqueStateFiles.slice(0, 5),
      root_cause: 'No centralized state management',
      impact: 'State inconsistency between phases',
      suggested_fix: 'Centralize state to single state.json with state manager'
    });
    evidence.push({
      file: 'multiple',
      pattern: 'scattered_state',
      context: uniqueStateFiles.join(', '),
      severity: 'high'
    });
  }

  // 3. Check for inconsistent field naming
  const fieldNamePatterns = {
    'name_vs_title': [/\.name\b/, /\.title\b/],
    'id_vs_identifier': [/\.id\b/, /\.identifier\b/],
    'status_vs_state': [/\.status\b/, /\.state\b/],
    'error_vs_errors': [/\.error\b/, /\.errors\b/]
  };

  const fieldUsage = {};

  for (const file of allFiles) {
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');

    for (const [patternName, patterns] of Object.entries(fieldNamePatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          if (!fieldUsage[patternName]) fieldUsage[patternName] = [];
          fieldUsage[patternName].push({
            file: relativePath,
            pattern: pattern.toString()
          });
        }
      }
    }
  }

  for (const [patternName, usages] of Object.entries(fieldUsage)) {
    const uniquePatterns = [...new Set(usages.map(u => u.pattern))];
    if (uniquePatterns.length > 1) {
      issues.push({
        id: `DF-${issues.length + 1}`,
        type: 'dataflow_break',
        severity: 'medium',
        location: { file: 'multiple' },
        description: `Inconsistent field naming: ${patternName.replace('_vs_', ' vs ')}`,
        evidence: usages.slice(0, 3).map(u => `${u.file}: ${u.pattern}`),
        root_cause: 'Same concept referred to with different field names',
        impact: 'Data may be lost during field access',
        suggested_fix: `Standardize to single field name, add normalization function`
      });
    }
  }

  // 4. Check for missing schema validation
  for (const file of allFiles) {
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');

    // Find JSON.parse without validation
    const unsafeParses = content.match(/JSON\.parse\s*\([^)]+\)(?!\s*\?\?|\s*\|\|)/g);
    const hasValidation = /validat|schema|type.*check/i.test(content);

    if (unsafeParses && unsafeParses.length > 0 && !hasValidation) {
      issues.push({
        id: `DF-${issues.length + 1}`,
        type: 'dataflow_break',
        severity: 'medium',
        location: { file: relativePath },
        description: 'JSON parsing without validation',
        evidence: unsafeParses.slice(0, 2),
        root_cause: 'No schema validation after parsing',
        impact: 'Invalid data may propagate through phases',
        suggested_fix: 'Add schema validation after JSON.parse'
      });
    }
  }

  // 5. Check state schema if exists
  const stateSchemaFile = Glob(`${skillPath}/phases/state-schema.md`)[0];
  if (stateSchemaFile) {
    const schemaContent = Read(stateSchemaFile);

    // Check for type definitions
    const hasTypeScript = /interface\s+\w+|type\s+\w+\s*=/i.test(schemaContent);
    const hasValidationFunction = /function\s+validate|validateState/i.test(schemaContent);

    if (hasTypeScript && !hasValidationFunction) {
      issues.push({
        id: `DF-${issues.length + 1}`,
        type: 'dataflow_break',
        severity: 'low',
        location: { file: 'phases/state-schema.md' },
        description: 'Type definitions without runtime validation',
        evidence: ['TypeScript interfaces defined but no validation function'],
        root_cause: 'Types are compile-time only, not enforced at runtime',
        impact: 'Schema violations may occur at runtime',
        suggested_fix: 'Add validateState() function using Zod or manual checks'
      });
    }
  } else if (state.target_skill.execution_mode === 'autonomous') {
    issues.push({
      id: `DF-${issues.length + 1}`,
      type: 'dataflow_break',
      severity: 'high',
      location: { file: 'phases/' },
      description: 'Autonomous skill missing state-schema.md',
      evidence: ['No state schema definition found'],
      root_cause: 'State structure undefined for orchestrator',
      impact: 'Inconsistent state handling across actions',
      suggested_fix: 'Create phases/state-schema.md with explicit type definitions'
    });
  }

  // 6. Check read-write alignment
  const writtenFiles = new Set(writeLocations.map(w => w.target));
  const readFiles = new Set(readLocations.map(r => r.source));

  const writtenButNotRead = [...writtenFiles].filter(f =>
    !readFiles.has(f) && !f.includes('output') && !f.includes('report')
  );

  if (writtenButNotRead.length > 0) {
    issues.push({
      id: `DF-${issues.length + 1}`,
      type: 'dataflow_break',
      severity: 'low',
      location: { file: 'multiple' },
      description: 'Files written but never read',
      evidence: writtenButNotRead.slice(0, 3),
      root_cause: 'Orphaned output files',
      impact: 'Wasted storage and potential confusion',
      suggested_fix: 'Remove unused writes or add reads where needed'
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
        'scattered_state',
        'inconsistent_naming',
        'missing_validation',
        'read_write_alignment'
      ],
      patterns_matched: evidence.map(e => e.pattern),
      evidence: evidence,
      data_flow_map: {
        write_locations: writeLocations.length,
        read_locations: readLocations.length,
        unique_state_files: uniqueStateFiles.length
      },
      recommendations: [
        uniqueStateFiles.length > 2 ? 'Implement centralized state manager' : null,
        issues.some(i => i.description.includes('naming'))
          ? 'Create normalization layer for field names' : null,
        issues.some(i => i.description.includes('validation'))
          ? 'Add Zod or JSON Schema validation' : null
      ].filter(Boolean)
    }
  };

  Write(`${workDir}/diagnosis/dataflow-diagnosis.json`,
        JSON.stringify(diagnosisResult, null, 2));

  return {
    stateUpdates: {
      'diagnosis.dataflow': diagnosisResult,
      issues: [...state.issues, ...issues]
    },
    outputFiles: [`${workDir}/diagnosis/dataflow-diagnosis.json`],
    summary: `Data flow diagnosis: ${issues.length} issues found (severity: ${severity})`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    'diagnosis.dataflow': {
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
| Glob pattern error | Use fallback patterns |
| File read error | Skip and continue |

## Next Actions

- Success: action-diagnose-agent (or next in focus_areas)
- Skipped: If 'dataflow' not in focus_areas
