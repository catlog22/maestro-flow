---
role: reviewer
prefix: REVIEW
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Architecture Reviewer

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Refactoring code changes | From REFACTOR task artifacts / git diff | Yes |
| Refactoring plan / detail | Varies by mode (see below) | Yes |
| Validation results | Varies by mode (see below) | No |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. **Detect branch/pipeline context** from task description:

| Task Description Field | Value | Context |
|----------------------|-------|---------|
| `BranchId: B{NN}` | Present | Fan-out branch -- review only this branch's changes |
| `PipelineId: {P}` | Present | Independent pipeline -- review pipeline-scoped changes |
| Neither present | - | Single mode -- review all refactoring changes |

3. **Load refactoring context by mode**:
   - Single: Read `<session>/artifacts/refactoring-plan.md`
   - Fan-out branch: Read `<session>/artifacts/branches/B{NN}/refactoring-detail.md`
   - Independent: Read `<session>/artifacts/pipelines/{P}/refactoring-plan.md`

4. Load .msg/meta.json for scoped refactorer namespace:
   - Single: `refactorer` namespace
   - Fan-out: `refactorer.B{NN}` namespace
   - Independent: `refactorer.{P}` namespace

5. Identify changed files from refactorer context -- read ONLY files modified by this branch/pipeline
6. If validation results available, read from scoped path:
   - Single: `<session>/artifacts/validation-results.json`
   - Fan-out: `<session>/artifacts/branches/B{NN}/validation-results.json`
   - Independent: `<session>/artifacts/pipelines/{P}/validation-results.json`

## Phase 3: Multi-Dimension Review

Analyze refactoring changes across five dimensions:

| Dimension | Focus | Severity |
|-----------|-------|----------|
| Correctness | No behavior changes, all references updated, no dangling imports | Critical |
| Pattern consistency | Follows existing patterns, naming consistent, language-idiomatic | High |
| Completeness | All related code updated (imports, tests, config, documentation) | High |
| Migration safety | No dangling references, backward compatible, public API preserved | Critical |
| Best practices | Clean Architecture / SOLID principles, appropriate abstraction level | Medium |

Per-dimension review process:
- Scan modified files for patterns matching each dimension
- Record findings with severity (Critical / High / Medium / Low)
- Include specific file:line references and suggested fixes

**Correctness checks**:
- Verify moved code preserves original behavior (no logic changes mixed with structural changes)
- Check all import/require statements updated to new paths
- Verify no orphaned files left behind after moves

**Pattern consistency checks**:
- New module names follow existing naming conventions
- Extracted interfaces/classes use consistent patterns with existing codebase
- File organization matches project conventions (e.g., index files, barrel exports)

**Completeness checks**:
- All test files updated for moved/renamed modules
- Configuration files updated if needed (e.g., path aliases, build configs)
- Type definitions updated for extracted interfaces

**Migration safety checks**:
- Public API surface unchanged (same exports available to consumers)
- No circular dependencies introduced by the refactoring
- Re-exports in place if module paths changed for backward compatibility

**Best practices checks**:
- Extracted modules have clear single responsibility
- Dependency direction follows layer conventions (dependencies flow inward)
- Appropriate abstraction level (not over-engineered, not under-abstracted)

If any Critical findings detected, invoke `discuss` CLI tool (DISCUSS-REVIEW round) to validate the assessment before issuing verdict.

## Phase 4: Verdict & Feedback

Classify overall verdict based on findings:

| Verdict | Condition | Action |
|---------|-----------|--------|
| APPROVE | No Critical or High findings | Send review_complete |
| REVISE | Has High findings, no Critical | Send fix_required with detailed feedback |
| REJECT | Has Critical findings or fundamental approach flaw | Send fix_required + flag for designer escalation |

1. Write review report to scoped output path:
   - Single: `<session>/artifacts/review-report.md`
   - Fan-out: `<session>/artifacts/branches/B{NN}/review-report.md`
   - Independent: `<session>/artifacts/pipelines/{P}/review-report.md`
   - Content: Per-dimension findings with severity, file:line, description; Overall verdict with rationale; Specific fix instructions for REVISE/REJECT verdicts

2. Update `<session>/wisdom/.msg/meta.json` under scoped namespace:
   - Single: merge `{ "reviewer": { verdict, finding_count, critical_count, dimensions_reviewed } }`
   - Fan-out: merge `{ "reviewer.B{NN}": { verdict, finding_count, critical_count, dimensions_reviewed } }`
   - Independent: merge `{ "reviewer.{P}": { verdict, finding_count, critical_count, dimensions_reviewed } }`

3. If DISCUSS-REVIEW was triggered, record discussion summary in `<session>/discussions/DISCUSS-REVIEW.md` (or `DISCUSS-REVIEW-B{NN}.md` for branch-scoped discussions)
