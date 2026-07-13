
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Diagnose Context Explosion

Analyze target skill for context explosion issues - token accumulation and multi-turn dialogue bloat.

## Purpose

- Detect patterns that cause context growth
- Identify multi-turn accumulation points
- Find missing context compression mechanisms
- Measure potential token waste

## Preconditions

- [ ] state.status === 'running'
- [ ] state.target_skill.path is set
- [ ] 'context' in state.focus_areas OR state.focus_areas is empty

## Detection Patterns

### Pattern 1: Unbounded History Accumulation

```regex
# Patterns that suggest history accumulation
/\bhistory\b.*\.push\b/
/\bmessages\b.*\.concat\b/
/\bconversation\b.*\+=\b/
/\bappend.*context\b/i
```

### Pattern 2: Full Content Passing

```regex
# Patterns that pass full content instead of references
/Read\([^)]+\).*\+.*Read\(/
/JSON\.stringify\(.*state\)/  # Full state serialization
/\$\{.*content\}/  # Template literal with full content
```

### Pattern 3: Missing Summarization

```regex
# Absence of compression/summarization
# Check for lack of: summarize, compress, truncate, slice
```

### Pattern 4: Agent Return Bloat

```regex
# Agent returning full content instead of path + summary
/return\s*\{[^}]*content:/
/return.*JSON\.stringify/
```

## Execution

```javascript
async function execute(state, workDir) {
  const skillPath = state.target_skill.path;
  const startTime = Date.now();
  const issues = [];
  const evidence = [];

  console.log(`Diagnosing context explosion in ${skillPath}...`);

  // 1. Scan all phase files
  const phaseFiles = Glob(`${skillPath}/phases/**/*.md`);

  for (const file of phaseFiles) {
    const content = Read(file);
    const relativePath = file.replace(skillPath + '/', '');

    // Check Pattern 1: History accumulation
    const historyPatterns = [
      /history\s*[.=].*push|concat|append/gi,
      /messages\s*=\s*\[.*\.\.\..*messages/gi,
      /conversation.*\+=/gi
    ];

    for (const pattern of historyPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        issues.push({
          id: `CTX-${issues.length + 1}`,
          type: 'context_explosion',
          severity: 'high',
          location: { file: relativePath },
          description: 'Unbounded history accumulation detected',
          evidence: matches.slice(0, 3),
          root_cause: 'History/messages array grows without bounds',
          impact: 'Token count increases linearly with iterations',
          suggested_fix: 'Implement sliding window or summarization'
        });
        evidence.push({
          file: relativePath,
          pattern: 'history_accumulation',
          context: matches[0],
          severity: 'high'
        });
      }
    }

    // Check Pattern 2: Full content passing
    const contentPatterns = [
      /Read\s*\([^)]+\)\s*[\+,]/g,
      /JSON\.stringify\s*\(\s*state\s*\)/g,
      /\$\{[^}]*content[^}]*\}/g
    ];

    for (const pattern of contentPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        issues.push({
          id: `CTX-${issues.length + 1}`,
          type: 'context_explosion',
          severity: 'medium',
          location: { file: relativePath },
          description: 'Full content passed instead of reference',
          evidence: matches.slice(0, 3),
          root_cause: 'Entire file/state content included in prompts',
          impact: 'Unnecessary token consumption',
          suggested_fix: 'Pass file paths and summaries instead of full content'
        });
        evidence.push({
          file: relativePath,
          pattern: 'full_content_passing',
          context: matches[0],
          severity: 'medium'
        });
      }
    }

    // Check Pattern 3: Missing summarization
    const hasSummarization = /summariz|compress|truncat|slice.*context/i.test(content);
    const hasLongPrompts = content.length > 5000;

    if (hasLongPrompts && !hasSummarization) {
      issues.push({
        id: `CTX-${issues.length + 1}`,
        type: 'context_explosion',
        severity: 'medium',
        location: { file: relativePath },
        description: 'Long phase file without summarization mechanism',
        evidence: [`File length: ${content.length} chars`],
        root_cause: 'No context compression for large content',
        impact: 'Potential token overflow in long sessions',
        suggested_fix: 'Add context summarization before passing to agents'
      });
    }

    // Check Pattern 4: Agent return bloat
    const returnPatterns = /return\s*\{[^}]*(?:content|full_output|complete_result):/g;
    const returnMatches = content.match(returnPatterns);
    if (returnMatches) {
      issues.push({
        id: `CTX-${issues.length + 1}`,
        type: 'context_explosion',
        severity: 'high',
        location: { file: relativePath },
        description: 'Agent returns full content instead of path+summary',
        evidence: returnMatches.slice(0, 3),
        root_cause: 'Agent output includes complete content',
        impact: 'Context bloat when orchestrator receives full output',
        suggested_fix: 'Return {output_file, summary} instead of {content}'
      });
    }
  }

  // 2. Calculate severity
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;
  const severity = criticalCount > 0 ? 'critical' :
                   highCount > 2 ? 'high' :
                   highCount > 0 ? 'medium' :
                   issues.length > 0 ? 'low' : 'none';

  // 3. Write diagnosis result
  const diagnosisResult = {
    status: 'completed',
    issues_found: issues.length,
    severity: severity,
    execution_time_ms: Date.now() - startTime,
    details: {
      patterns_checked: [
        'history_accumulation',
        'full_content_passing',
        'missing_summarization',
        'agent_return_bloat'
      ],
      patterns_matched: evidence.map(e => e.pattern),
      evidence: evidence,
      recommendations: [
        issues.length > 0 ? 'Implement context summarization agent' : null,
        highCount > 0 ? 'Add sliding window for conversation history' : null,
        evidence.some(e => e.pattern === 'full_content_passing')
          ? 'Refactor to pass file paths instead of content' : null
      ].filter(Boolean)
    }
  };

  Write(`${workDir}/diagnosis/context-diagnosis.json`,
        JSON.stringify(diagnosisResult, null, 2));

  return {
    stateUpdates: {
      'diagnosis.context': diagnosisResult,
      issues: [...state.issues, ...issues],
      'issues_by_severity.critical': state.issues_by_severity.critical + criticalCount,
      'issues_by_severity.high': state.issues_by_severity.high + highCount
    },
    outputFiles: [`${workDir}/diagnosis/context-diagnosis.json`],
    summary: `Context diagnosis: ${issues.length} issues found (severity: ${severity})`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    'diagnosis.context': {
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
| File read error | Skip file, log warning |
| Pattern matching error | Use fallback patterns |
| Write error | Retry to alternative path |

## Next Actions

- Success: action-diagnose-memory (or next in focus_areas)
- Skipped: If 'context' not in focus_areas
