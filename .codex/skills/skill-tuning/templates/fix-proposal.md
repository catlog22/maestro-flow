

# Fix Proposal Template

Template for fix proposal documentation.

## Template

```markdown
# Fix Proposal: {{fix_id}}

**Strategy**: {{strategy}}
**Risk Level**: {{risk}}
**Issues Addressed**: {{issue_ids}}

---

## Description

{{description}}

## Rationale

{{rationale}}

---

## Affected Files

{{#each changes}}
### {{file}}

**Action**: {{action}}

```diff
{{diff}}
```

{{/each}}

---

## Implementation Steps

{{#each implementation_steps}}
{{@index}}. {{this}}
{{/each}}

---

## Risk Assessment

| Factor | Assessment |
|--------|------------|
| Complexity | {{complexity}} |
| Reversibility | {{reversible ? 'Yes' : 'No'}} |
| Breaking Changes | {{breaking_changes}} |
| Test Coverage | {{test_coverage}} |

**Overall Risk**: {{risk}}

---

## Verification Steps

{{#each verification_steps}}
- [ ] {{this}}
{{/each}}

---

## Rollback Plan

{{#if rollback_available}}
To rollback this fix:

```bash
{{rollback_command}}
```
{{else}}
_Rollback not available for this fix type._
{{/if}}

---

## Estimated Impact

{{estimated_impact}}
```

## Variable Reference

| Variable | Type | Source |
|----------|------|--------|
| `fix_id` | string | Generated ID (FIX-001) |
| `strategy` | string | Fix strategy name |
| `risk` | string | 'low' \| 'medium' \| 'high' |
| `issue_ids` | array | Related issue IDs |
| `description` | string | Human-readable description |
| `rationale` | string | Why this fix works |
| `changes` | array | File change objects |
| `implementation_steps` | array | Step-by-step guide |
| `verification_steps` | array | How to verify fix worked |
| `estimated_impact` | string | Expected improvement |

## Usage

```javascript
function renderFixProposal(fix) {
  return `# Fix Proposal: ${fix.id}

**Strategy**: ${fix.strategy}
**Risk Level**: ${fix.risk}
**Issues Addressed**: ${fix.issue_ids.join(', ')}

---

## Description

${fix.description}

## Rationale

${fix.rationale}

---

## Affected Files

${fix.changes.map(change => `
### ${change.file}

**Action**: ${change.action}

\`\`\`diff
${change.diff || change.new_content?.slice(0, 200) || 'N/A'}
\`\`\`
`).join('\n')}

---

## Verification Steps

${fix.verification_steps.map(step => `- [ ] ${step}`).join('\n')}

---

## Estimated Impact

${fix.estimated_impact}
`;
}
```

## Fix Strategy Templates

### sliding_window

```markdown
## Description
Implement sliding window for conversation history to prevent unbounded growth.

## Changes
- Add MAX_HISTORY constant
- Modify history update logic to slice array
- Update state schema documentation

## Verification
- [ ] Run skill for 10+ iterations
- [ ] Verify history.length <= MAX_HISTORY
- [ ] Check no data loss for recent items
```

### constraint_injection

```markdown
## Description
Add explicit constraint section to each phase prompt.

## Changes
- Add [CONSTRAINTS] section template
- Reference state.original_requirements
- Add reminder before output section

## Verification
- [ ] Check constraints visible in all phases
- [ ] Test with specific constraint
- [ ] Verify output respects constraint
```

### error_wrapping

```markdown
## Description
Wrap all Task calls in try-catch with retry logic.

## Changes
- Create safeTask wrapper function
- Replace direct Task calls
- Add error logging to state

## Verification
- [ ] Simulate agent failure
- [ ] Verify graceful error handling
- [ ] Check retry logic
```
