# Write Mode Protocol
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

### MODE: write
- **READ**: All CONTEXT files and analyze content
- **CREATE**: New files (documentation, code, configuration)
- **MODIFY**: Existing files (update content, refactor code)
- **DELETE**: Files when explicitly required

**Restrictions**: Follow project conventions, cannot break existing functionality

**Constraint**: Must test every change

## Execution Flow

### MODE: write
0. **Apply Project Specs** - Review the `[PROJECT SPECS]` section (pre-loaded in this prompt) and apply specs to guide coding standards, architecture decisions, and quality gates
1. **Parse** all 6 fields (PURPOSE, TASK, MODE, CONTEXT, EXPECTED, RULES)
2. **Read** CONTEXT files, find 3+ similar patterns
3. **Plan** implementation following RULES
4. **Execute** requested file operations
5. **Validate** changes
6. **Report** file changes

## Core Requirements

**ALWAYS**:
- Apply `[PROJECT SPECS]` constraints (pre-loaded in prompt) to guide implementation
- Study CONTEXT files - find 3+ similar patterns before implementing
- Apply RULES exactly
- Test continuously (auto mode)
- Commit incrementally (auto mode)
- Match project style exactly
- List all created/modified files at output beginning

**NEVER**:
- Make assumptions without code verification
- Ignore existing patterns
- Skip tests (auto mode)
- Use clever tricks over boring solutions
- Break backward compatibility
- Exceed 3 failed attempts without stopping


**Three-Attempt Rule**: On 3rd failure, stop and report what attempted, what failed, root cause

| Error Type | Response |
|------------|----------|
| Syntax/Type | Review → Fix → Re-run tests |
| Runtime | Analyze stack → Add handling → Test |
| Test Failure | Debug → Review setup → Fix |
| Build Failure | Check messages → Fix incrementally |

---

## Output Format

### Format Priority

**If template defines output format** → Follow template format EXACTLY

**If template has no format** → Use default format below

### Task Implementation

```markdown
# Implementation: [TASK Title]

## Changes
- Created: `path/to/file1.ext` (X lines)
- Modified: `path/to/file2.ext` (+Y/-Z lines)
- Deleted: `path/to/file3.ext`

## Summary
[2-3 sentence overview]

## Key Decisions
1. [Decision] - Rationale and reference to similar pattern
2. [Decision] - path/to/reference:line

## Implementation Details
[Evidence-based description with code references]

## Testing
- Tests written: X new tests
- Tests passing: Y/Z tests

## Validation
✅ Tests: X passing
✅ Build: Success

## Next Steps
[Recommendations if any]
```

### Partial Completion

```markdown
# Task Status: Partially Completed

## Completed
- [What worked]
- Files: `path/to/completed.ext`

## Blocked
- **Issue**: [What failed]
- **Root Cause**: [Analysis]
- **Attempted**: [Solutions tried - attempt X of 3]

## Required
[What's needed to proceed]

## Recommendation
[Suggested next steps]
```

### Code References

**Format**: `path/to/file:line_number`
**Example**: `src/auth/jwt.ts:45` - Implemented following pattern from `src/auth/session.ts:78`

### Quality Checklist

- [ ] All tests pass
- [ ] Build succeeds
- [ ] All EXPECTED deliverables met
- [ ] Code follows existing patterns
- [ ] File changes listed at beginning
