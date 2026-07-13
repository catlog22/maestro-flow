

# Diagnosis Report Template

Template for individual diagnosis action reports.

## Template

```markdown
# {{diagnosis_type}} Diagnosis Report

**Target Skill**: {{skill_name}}
**Diagnosis Type**: {{diagnosis_type}}
**Executed At**: {{timestamp}}
**Duration**: {{duration_ms}}ms

---

## Summary

| Metric | Value |
|--------|-------|
| Issues Found | {{issues_found}} |
| Severity | {{severity}} |
| Patterns Checked | {{patterns_checked_count}} |
| Patterns Matched | {{patterns_matched_count}} |

---

## Patterns Analyzed

{{#each patterns_checked}}
### {{pattern_name}}

- **Status**: {{status}}
- **Matches**: {{match_count}}
- **Files Affected**: {{affected_files}}

{{/each}}

---

## Issues Identified

{{#if issues.length}}
{{#each issues}}
### {{id}}: {{description}}

| Field | Value |
|-------|-------|
| Type | {{type}} |
| Severity | {{severity}} |
| Location | {{location}} |
| Root Cause | {{root_cause}} |
| Impact | {{impact}} |

**Evidence**:
{{#each evidence}}
- `{{this}}`
{{/each}}

**Suggested Fix**: {{suggested_fix}}

---
{{/each}}
{{else}}
_No issues found in this diagnosis area._
{{/if}}

---

## Recommendations

{{#if recommendations.length}}
{{#each recommendations}}
{{@index}}. {{this}}
{{/each}}
{{else}}
No specific recommendations - area appears healthy.
{{/if}}

---

## Raw Data

Full diagnosis data available at:
`{{output_file}}`
```

## Variable Reference

| Variable | Type | Source |
|----------|------|--------|
| `diagnosis_type` | string | 'context' \| 'memory' \| 'dataflow' \| 'agent' |
| `skill_name` | string | state.target_skill.name |
| `timestamp` | string | ISO timestamp |
| `duration_ms` | number | Execution time |
| `issues_found` | number | issues.length |
| `severity` | string | Calculated severity |
| `patterns_checked` | array | Patterns analyzed |
| `patterns_matched` | array | Patterns with matches |
| `issues` | array | Issue objects |
| `recommendations` | array | String recommendations |
| `output_file` | string | Path to JSON file |

## Usage

```javascript
function renderDiagnosisReport(diagnosis, diagnosisType, skillName, outputFile) {
  return `# ${diagnosisType} Diagnosis Report

**Target Skill**: ${skillName}
**Diagnosis Type**: ${diagnosisType}
**Executed At**: ${new Date().toISOString()}
**Duration**: ${diagnosis.execution_time_ms}ms

---

## Summary

| Metric | Value |
|--------|-------|
| Issues Found | ${diagnosis.issues_found} |
| Severity | ${diagnosis.severity} |
| Patterns Checked | ${diagnosis.details.patterns_checked.length} |
| Patterns Matched | ${diagnosis.details.patterns_matched.length} |

---

## Issues Identified

${diagnosis.details.evidence.map((e, i) => `
### Issue ${i + 1}

- **File**: ${e.file}
- **Pattern**: ${e.pattern}
- **Severity**: ${e.severity}
- **Context**: \`${e.context}\`
`).join('\n')}

---

## Recommendations

${diagnosis.details.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}

---

## Raw Data

Full diagnosis data available at:
\`${outputFile}\`
`;
}
```
