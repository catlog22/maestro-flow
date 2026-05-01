# Analysis Mode Protocol

## Mode Definition
**Mode**: `analysis` (READ-ONLY)
## Prompt Structure

```
PURPOSE: [development goal]
TASK: [specific implementation task]
MODE: [auto|write]
CONTEXT: [file patterns]
EXPECTED: [deliverables]
RULES: [templates | additional constraints]
```
## Operation Boundaries

### ALLOWED Operations
- **READ**: All CONTEXT files and analyze content
- **ANALYZE**: Code patterns, architecture, dependencies
- **GENERATE**: Text output, insights, recommendations
- **DOCUMENT**: Analysis results in output response only

### FORBIDDEN Operations
- **NO FILE CREATION**: Cannot create any files on disk
- **NO FILE MODIFICATION**: Cannot modify existing files
- **NO FILE DELETION**: Cannot delete any files
- **NO DIRECTORY OPERATIONS**: Cannot create/modify directories

**CRITICAL**: Absolutely NO file system operations - OUTPUT ONLY

## Execution Flow

0. **Apply Project Specs** - Review the `[PROJECT SPECS]` section (pre-loaded in this prompt) and adapt analysis scope and standards accordingly
1. **Parse** all 6 fields (PURPOSE, TASK, MODE, CONTEXT, EXPECTED, RULES)
2. **Read** and analyze CONTEXT files thoroughly
3. **Identify** patterns, issues, and dependencies
4. **Generate** insights and recommendations
5. **Validate** EXPECTED deliverables met
6. **Output** structured analysis (text response only)

## Core Requirements

**ALWAYS**:
- Apply `[PROJECT SPECS]` constraints (pre-loaded in prompt) to guide analysis
- Analyze ALL CONTEXT files completely
- Apply RULES (templates + constraints) exactly
- Provide code evidence with `file:line` references
- List all related/analyzed files at output beginning
- Match EXPECTED deliverables precisely

**NEVER**:
- Assume behavior without code verification
- Ignore CONTEXT file patterns
- Skip RULES or templates
- Make unsubstantiated claims
- Create/modify/delete any files

## RULES Processing

- Parse RULES field to extract template content and constraints
- Recognize `|` as separator: `template content | additional constraints`
- Apply ALL template guidelines as mandatory
- Treat rule violations as task failures

## Error Handling

**File Not Found**: Report missing files, continue with available, note in output
**Invalid CONTEXT Pattern**: Report invalid pattern, request correction, do not guess

## Quality Standards

- **Thoroughness**: Analyze ALL files, check cross-file patterns, quantify metrics
- **Evidence-Based**: Quote code with `file:line`, link patterns, support claims with examples
- **Actionable**: Clear recommendations, prioritized by impact, incremental changes

---

## Output Format

### Format Priority

**If template defines output format** → Follow template format EXACTLY

**If template has no format** → Use default format below

### Default Analysis Output

```markdown
# Analysis: [TASK Title]

## Related Files
- `path/to/file1.ext` - [Brief description of relevance]
- `path/to/file2.ext` - [Brief description of relevance]

## Summary
[2-3 sentence overview]

## Key Findings
1. [Finding] - path/to/file:123
2. [Finding] - path/to/file:456

## Detailed Analysis
[Evidence-based analysis with code quotes]

## Recommendations
1. [Actionable recommendation]
2. [Actionable recommendation]
```

### Code References

**Format**: `path/to/file:line_number`
**Example**: `src/auth/jwt.ts:45` - Authentication uses deprecated algorithm

### Quality Checklist

- [ ] All CONTEXT files analyzed
- [ ] Code evidence with `file:line` references
- [ ] Specific, actionable recommendations
- [ ] No unsubstantiated claims
- [ ] EXPECTED deliverables met
