---
role: verifier
prefix: VERIFY
inner_loop: false
message_types: [verify_passed, verify_failed, fix_required, error]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Verification & Regression Check

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Original scan report | <session>/scan/scan-report.md | Yes |
| Fix log | <session>/optimization/fix-log.md | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Anti-patterns catalog | specs/anti-patterns.md | Yes |
| Design standards | specs/design-standards.md | Yes |
| Scoring guide | specs/scoring-guide.md | Yes |

1. Extract session path from task description
2. Read original scan report: parse before-scores per dimension and issue inventory
3. Read fix log: parse all fixes applied and files modified
4. Read specs for scoring reference

## Phase 3: Verification

### Step 1: Re-scan Fixed Code

Apply the same 8-dimension scan as the scanner role (reference roles/scanner/role.md Phase 3) to the current state of files. Use identical checklist items and scoring criteria.

If Chrome DevTools available:
- Take screenshots at same 3 viewports (mobile 375px, tablet 768px, desktop 1440px)
- Save to `<session>/evidence/after-mobile.png`, `after-tablet.png`, `after-desktop.png`

### Step 2: Calculate Score Delta

For each dimension, compare before and after:

| Dimension | Before | After | Delta | Status |
|-----------|--------|-------|-------|--------|
| 1. Anti-Patterns | X/4 | Y/4 | +/-N | improved/same/regressed |
| 2. Color Quality | X/4 | Y/4 | +/-N | improved/same/regressed |
| 3. Typography | X/4 | Y/4 | +/-N | improved/same/regressed |
| 4. Spacing/Layout | X/4 | Y/4 | +/-N | improved/same/regressed |
| 5. Motion | X/4 | Y/4 | +/-N | improved/same/regressed |
| 6. Interaction States | X/4 | Y/4 | +/-N | improved/same/regressed |
| 7. Visual Hierarchy | X/4 | Y/4 | +/-N | improved/same/regressed |
| 8. Responsive | X/4 | Y/4 | +/-N | improved/same/regressed |
| **Total** | X/32 | Y/32 | +/-N | |

### Step 3: Regression Detection

Check for NEW issues not present in original scan report:

| Check | Method |
|-------|--------|
| New issues introduced | Compare current issue inventory against original. Any issue not in original = regression |
| Score dropped | Any dimension score lower than before = regression |
| Positive findings broken | Items from original "Positive Findings" no longer hold |
| Build broken | Modified files have syntax errors or lint failures |

Classify regressions:
- **Critical**: Score dropped in any dimension, WCAG AA violation introduced, build broken
- **Non-critical**: New minor issues introduced but overall score improved

### Step 4: Determine Signal

| Condition | Signal |
|-----------|--------|
| No regressions AND total score >= before score | `verify_passed` |
| Non-critical regressions AND total score improved | `verify_failed` (fixable) |
| Critical regressions OR total score dropped | `fix_required` (urgent) |

## Phase 4: Generate Verification Report

Output: `<session>/verification/verify-report.md`

```markdown
# Verification Report

## Verdict: <PASSED | FAILED | FIX REQUIRED>

## Score Comparison

| Dimension | Before | After | Delta |
|-----------|--------|-------|-------|
| 1. Anti-Patterns | X/4 | Y/4 | +N |
| 2. Color Quality | X/4 | Y/4 | +N |
| 3. Typography | X/4 | Y/4 | +N |
| 4. Spacing/Layout | X/4 | Y/4 | +N |
| 5. Motion | X/4 | Y/4 | +N |
| 6. Interaction States | X/4 | Y/4 | +N |
| 7. Visual Hierarchy | X/4 | Y/4 | +N |
| 8. Responsive | X/4 | Y/4 | +N |
| **Total** | **X/32** | **Y/32** | **+N** |

## Before Rating: <rating-band> -> After Rating: <rating-band>

## Regressions Found
<list of regressions with location, severity, description>
<or "None" if clean>

## Remaining Issues
<issues from original scan that were NOT fixed>

## Improvements
<per-dimension improvement details>

## Screenshots
- Before: <session>/evidence/before-*.png
- After: <session>/evidence/after-*.png
<or "Chrome DevTools not available" if no screenshots>

## Metadata
- Original scan: <session>/scan/scan-report.md
- Fix log: <session>/optimization/fix-log.md
- GC round: <round number>
- Timestamp: <ISO timestamp>
```

After writing the report, send signal-appropriate message:

**If verify_passed**:
```
mcp__maestro__team_msg(session_id, role="verifier", type="verify_passed", content="Verification passed. Score: before X/32 -> after Y/32 (+N). No regressions.")
SendMessage(participant="coordinator", message="[verifier] VERIFY-001 passed. Score: X/32 -> Y/32 (+N). No regressions. Report: <session>/verification/verify-report.md")
```

**If verify_failed**:
```
mcp__maestro__team_msg(session_id, role="verifier", type="verify_failed", content="Verification failed. N non-critical regressions found. Score: X/32 -> Y/32.")
SendMessage(participant="coordinator", message="[verifier] VERIFY-001 failed. N regressions (non-critical). Score: X/32 -> Y/32. Report: <session>/verification/verify-report.md")
```

**If fix_required**:
```
mcp__maestro__team_msg(session_id, role="verifier", type="fix_required", content="Fix required. N critical regressions. Score dropped: X/32 -> Y/32.")
SendMessage(participant="coordinator", message="[verifier] VERIFY-001 fix_required. N critical regressions. Score: X/32 -> Y/32 (DROPPED). Report: <session>/verification/verify-report.md")
```
