
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Diagnose Token Consumption

Analyze target skill for token consumption inefficiencies and output optimization opportunities.

## Purpose

Detect patterns that cause excessive token usage:
- Verbose prompts without compression
- Large state objects with unnecessary fields
- Full content passing instead of references
- Unbounded arrays without sliding windows
- Redundant file I/O (write-then-read patterns)

## Detection Patterns

| Pattern ID | Name | Detection Logic | Severity |
|------------|------|-----------------|----------|
| TKN-001 | Verbose Prompts | Prompt files > 4KB or high static/variable ratio | medium |
| TKN-002 | Excessive State Fields | State schema > 15 top-level keys | medium |
| TKN-003 | Full Content Passing | `Read()` result embedded directly in prompt | high |
| TKN-004 | Unbounded Arrays | `.push`/`concat` without `.slice(-N)` | high |
| TKN-005 | Redundant Write→Read | `Write(file)` followed by `Read(file)` | medium |

## Execution Steps

```javascript
async function diagnoseTokenConsumption(state, workDir) {
  const issues = [];
  const evidence = [];
  const skillPath = state.target_skill.path;

  // 1. Scan for verbose prompts (TKN-001)
  const mdFiles = Glob(`${skillPath}/**/*.md`);
  for (const file of mdFiles) {
    const content = Read(file);
    if (content.length > 4000) {
      evidence.push({
        file: file,
        pattern: 'TKN-001',
        severity: 'medium',
        context: `File size: ${content.length} chars (threshold: 4000)`
      });
    }
  }

  // 2. Check state schema field count (TKN-002)
  const stateSchema = Glob(`${skillPath}/**/state-schema.md`)[0];
  if (stateSchema) {
    const schemaContent = Read(stateSchema);
    const fieldMatches = schemaContent.match(/^\s*\w+:/gm) || [];
    if (fieldMatches.length > 15) {
      evidence.push({
        file: stateSchema,
        pattern: 'TKN-002',
        severity: 'medium',
        context: `State has ${fieldMatches.length} fields (threshold: 15)`
      });
    }
  }

  // 3. Detect full content passing (TKN-003)
  const fullContentPattern = /Read\([^)]+\)\s*[\+,]|`\$\{.*Read\(/g;
  for (const file of mdFiles) {
    const content = Read(file);
    const matches = content.match(fullContentPattern);
    if (matches) {
      evidence.push({
        file: file,
        pattern: 'TKN-003',
        severity: 'high',
        context: `Full content passing detected: ${matches[0]}`
      });
    }
  }

  // 4. Detect unbounded arrays (TKN-004)
  const unboundedPattern = /\.(push|concat)\([^)]+\)(?!.*\.slice)/g;
  for (const file of mdFiles) {
    const content = Read(file);
    const matches = content.match(unboundedPattern);
    if (matches) {
      evidence.push({
        file: file,
        pattern: 'TKN-004',
        severity: 'high',
        context: `Unbounded array growth: ${matches[0]}`
      });
    }
  }

  // 5. Detect write-then-read patterns (TKN-005)
  const writeReadPattern = /Write\([^)]+\)[\s\S]{0,100}Read\([^)]+\)/g;
  for (const file of mdFiles) {
    const content = Read(file);
    const matches = content.match(writeReadPattern);
    if (matches) {
      evidence.push({
        file: file,
        pattern: 'TKN-005',
        severity: 'medium',
        context: `Write-then-read pattern detected`
      });
    }
  }

  // Calculate severity
  const highCount = evidence.filter(e => e.severity === 'high').length;
  const mediumCount = evidence.filter(e => e.severity === 'medium').length;

  let severity = 'none';
  if (highCount > 0) severity = 'high';
  else if (mediumCount > 2) severity = 'medium';
  else if (mediumCount > 0) severity = 'low';

  return {
    status: 'completed',
    issues_found: evidence.length,
    severity: severity,
    execution_time_ms: Date.now() - startTime,
    details: {
      patterns_checked: ['TKN-001', 'TKN-002', 'TKN-003', 'TKN-004', 'TKN-005'],
      patterns_matched: [...new Set(evidence.map(e => e.pattern))],
      evidence: evidence,
      recommendations: generateRecommendations(evidence)
    }
  };
}

function generateRecommendations(evidence) {
  const recs = [];
  const patterns = [...new Set(evidence.map(e => e.pattern))];

  if (patterns.includes('TKN-001')) {
    recs.push('Apply prompt_compression: Extract static instructions to templates, use placeholders');
  }
  if (patterns.includes('TKN-002')) {
    recs.push('Apply state_field_reduction: Remove debug/cache fields, consolidate related fields');
  }
  if (patterns.includes('TKN-003')) {
    recs.push('Apply lazy_loading: Pass file paths instead of content, let agents read if needed');
  }
  if (patterns.includes('TKN-004')) {
    recs.push('Apply sliding_window: Add .slice(-N) to array operations to bound growth');
  }
  if (patterns.includes('TKN-005')) {
    recs.push('Apply output_minimization: Use in-memory data passing, eliminate temporary files');
  }

  return recs;
}
```

## Output

Write diagnosis result to `${workDir}/diagnosis/token-consumption-diagnosis.json`:

```json
{
  "status": "completed",
  "issues_found": 3,
  "severity": "medium",
  "execution_time_ms": 1500,
  "details": {
    "patterns_checked": ["TKN-001", "TKN-002", "TKN-003", "TKN-004", "TKN-005"],
    "patterns_matched": ["TKN-001", "TKN-003"],
    "evidence": [
      {
        "file": "phases/orchestrator.md",
        "pattern": "TKN-001",
        "severity": "medium",
        "context": "File size: 5200 chars (threshold: 4000)"
      }
    ],
    "recommendations": [
      "Apply prompt_compression: Extract static instructions to templates"
    ]
  }
}
```

## State Update

```javascript
updateState({
  diagnosis: {
    ...state.diagnosis,
    token_consumption: diagnosisResult
  }
});
```

## Fix Strategies Mapping

| Pattern | Strategy | Implementation |
|---------|----------|----------------|
| TKN-001 | prompt_compression | Extract static text to variables, use template inheritance |
| TKN-002 | state_field_reduction | Audit and consolidate fields, remove non-essential data |
| TKN-003 | lazy_loading | Pass paths instead of content, agents load when needed |
| TKN-004 | sliding_window | Add `.slice(-N)` after push/concat operations |
| TKN-005 | output_minimization | Use return values instead of file relay |
