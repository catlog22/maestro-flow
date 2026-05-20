# Quality Gates

## 1. Quality Thresholds

| Result | Score | Action |
|--------|-------|--------|
| Pass | >= 80% | Report completed |
| Review | 60-79% | Report completed with warnings |
| Fail | < 60% | Retry Phase 3 (max 2 retries) |

## 2. Scoring Dimensions

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Completeness | 25% | All required outputs present with substantive content |
| Consistency | 25% | Terminology, formatting, cross-references are uniform |
| Accuracy | 25% | Outputs are factually correct and verifiable against sources |
| Depth | 25% | Sufficient detail for downstream consumers to act on deliverables |

**Score** = weighted average of all dimensions (0-100 per dimension).

## 3. Dynamic Role Quality Checks

Quality checks vary by `output_type` (from task-analysis.json role metadata).

### output_type: artifact

| Check | Pass Criteria |
|-------|---------------|
| Artifact exists | File written to `<session>/artifacts/` |
| Content non-empty | Substantive content, not just headers |
| Format correct | Expected format (MD, JSON) matches deliverable |
| Cross-references | All references to upstream artifacts resolve |

### output_type: codebase

| Check | Pass Criteria |
|-------|---------------|
| Files modified | Claimed files actually changed (Read to confirm) |
| Syntax valid | No syntax errors in modified files |
| No regressions | Existing functionality preserved |
| Summary artifact | Implementation summary written to artifacts/ |

### output_type: mixed

All checks from both `artifact` and `codebase` apply.

## 4. Verification Protocol

Derived from Behavioral Traits in [role-spec-template.md](role-spec-template.md).

| Step | Action | Required |
|------|--------|----------|
| 1 | Verify all claimed files exist via Read | Yes |
| 2 | Confirm artifact written to `<session>/artifacts/` | Yes |
| 3 | Check verification summary fields present | Yes |
| 4 | Score against quality dimensions | Yes |
| 5 | Apply threshold -> Pass/Review/Fail | Yes |

**On Fail**: Retry Phase 3 (max 2 retries). After 2 retries, report `partial_completion`.

**On Review**: Proceed with warnings logged to `<session>/wisdom/issues.md`.

## 5. Code Review Dimensions

For REVIEW-* or validation tasks during implementation pipelines.

### Quality

| Check | Severity |
|-------|----------|
| Empty catch blocks | Error |
| `as any` type casts | Warning |
| `@ts-ignore` / `@ts-expect-error` | Warning |
| `console.log` in production code | Warning |
| Unused imports/variables | Info |

### Security

| Check | Severity |
|-------|----------|
| Hardcoded secrets/credentials | Error |
| SQL injection vectors | Error |
| `eval()` or `Function()` usage | Error |
| `innerHTML` assignment | Warning |
| Missing input validation | Warning |

### Architecture

| Check | Severity |
|-------|----------|
| Circular dependencies | Error |
| Deep cross-boundary imports (3+ levels) | Warning |
| Files > 500 lines | Warning |
| Functions > 50 lines | Info |

### Requirements Coverage

| Check | Severity |
|-------|----------|
| Core functionality implemented | Error if missing |
| Acceptance criteria covered | Error if missing |
| Edge cases handled | Warning |
| Error states handled | Warning |

## 6. Issue Classification

| Class | Label | Action |
|-------|-------|--------|
| Error | Must fix | Blocks progression, must resolve before proceeding |
| Warning | Should fix | Should resolve, can proceed with justification |
| Info | Nice to have | Optional improvement, log for future |
