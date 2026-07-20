---
role: validator
prefix: VALIDATE
inner_loop: false
message_types: "[state_update]"
---

# Architecture Validator

## Phase 2: Environment & Baseline Loading

| Input | Source | Required |
|-------|--------|----------|
| Architecture baseline | {run_dir}/outputs/architecture-baseline.json (shared) | Yes |
| Refactoring plan / detail | Varies by mode (see below) | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. **Detect branch/pipeline context** from task description:

| Task Description Field | Value | Context |
|----------------------|-------|---------|
| `BranchId: B{NN}` | Present | Fan-out branch -- validate only this branch's changes |
| `PipelineId: {P}` | Present | Independent pipeline -- use pipeline-scoped baseline |
| Neither present | - | Single mode -- full validation |

3. **Load architecture baseline**:
   - Single / Fan-out: Read `{run_dir}/outputs/architecture-baseline.json` (shared baseline)
   - Independent: Read `{run_dir}/outputs/pipelines/{P}/architecture-baseline.json`

4. **Load refactoring context**:
   - Single: Read `{run_dir}/outputs/refactoring-plan.md` -- all success criteria
   - Fan-out branch: Read `{run_dir}/outputs/branches/B{NN}/refactoring-detail.md` -- only this branch's criteria
   - Independent: Read `{run_dir}/outputs/pipelines/{P}/refactoring-plan.md`

5. Load .msg/meta.json for project type and refactoring scope
6. Detect available validation tools from project:

| Signal | Validation Tool | Method |
|--------|----------------|--------|
| package.json + tsc | TypeScript compiler | Type-check entire project |
| package.json + vitest/jest | Test runner | Run existing test suite |
| package.json + eslint | Linter | Run lint checks for import/export issues |
| Cargo.toml | Rust compiler | cargo check + cargo test |
| go.mod | Go tools | go build + go test |
| Makefile with test target | Custom tests | make test |
| No tooling detected | Manual validation | File existence + import grep checks |

7. Get changed files scope from .msg/meta.json:
   - Single: `refactorer` namespace
   - Fan-out: `refactorer.B{NN}` namespace
   - Independent: `refactorer.{P}` namespace

## Phase 3: Validation Execution

Run validations across four dimensions:

**Build validation**:
- Compile/type-check the project -- zero new errors allowed
- Verify all moved/renamed files are correctly referenced
- Check for missing imports or unresolved modules

**Test validation**:
- Run existing test suite -- all previously passing tests must still pass
- Identify any tests that need updating due to module moves (update, don't skip)
- Check for test file imports that reference old paths

**Dependency metric validation**:
- Recalculate architecture metrics post-refactoring
- Compare coupling scores against baseline (must improve or stay neutral)
- Verify no new circular dependencies introduced
- Check cohesion metrics for affected modules

**API compatibility validation**:
- Verify public API signatures are preserved (exported function/class/type names)
- Check for dangling references (imports pointing to removed/moved files)
- Verify no new dead exports introduced by the refactoring
- Check that re-exports maintain backward compatibility where needed

**Branch-scoped validation** (fan-out mode):
- Only validate metrics relevant to this branch's refactoring (from refactoring-detail.md)
- Still check for regressions across all metrics (not just branch-specific ones)

## Phase 4: Result Analysis

Compare against baseline and plan criteria:

| Metric | Threshold | Verdict |
|--------|-----------|---------|
| Build passes | Zero compilation errors | PASS |
| All tests pass | No new test failures | PASS |
| Coupling improved or neutral | No metric degradation > 5% | PASS |
| No new cycles introduced | Cycle count <= baseline | PASS |
| All plan success criteria met | Every criterion satisfied | PASS |
| Partial improvement | Some metrics improved, none degraded | WARN |
| Build fails | Compilation errors detected | FAIL -> fix_required |
| Test failures | Previously passing tests now fail | FAIL -> fix_required |
| New cycles introduced | Cycle count > baseline | FAIL -> fix_required |
| Dangling references | Unresolved imports detected | FAIL -> fix_required |

1. Write validation results to output path:
   - Single: `{run_dir}/outputs/validation-results.json`
   - Fan-out: `{run_dir}/outputs/branches/B{NN}/validation-results.json`
   - Independent: `{run_dir}/outputs/pipelines/{P}/validation-results.json`
   - Content: Per-dimension: name, baseline value, current value, improvement/regression, verdict; Overall verdict: PASS / WARN / FAIL; Failure details (if any)

2. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under scoped namespace:
   - Single: merge `{ "validator": { verdict, improvements, regressions, build_pass, test_pass } }`
   - Fan-out: merge `{ "validator.B{NN}": { verdict, improvements, regressions, build_pass, test_pass } }`
   - Independent: merge `{ "validator.{P}": { verdict, improvements, regressions, build_pass, test_pass } }`

3. If verdict is FAIL, include detailed feedback in message for FIX task creation:
   - Which validations failed, specific errors, suggested investigation areas
