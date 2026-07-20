---
role: refactorer
prefix: REFACTOR
inner_loop: dynamic
message_types: "[state_update]"
---

# Code Refactorer

## Modes

| Mode | Task Prefix | Trigger | Focus |
|------|-------------|---------|-------|
| Refactor | REFACTOR | Design plan ready | Apply refactorings per plan priority |
| Fix | FIX | Review/validation feedback | Targeted fixes for identified issues |

## Phase 2: Plan & Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Refactoring plan | {run_dir}/outputs/refactoring-plan.md | Yes (REFACTOR, no branch) |
| Branch refactoring detail | {run_dir}/outputs/branches/B{NN}/refactoring-detail.md | Yes (REFACTOR with branch) |
| Pipeline refactoring plan | {run_dir}/outputs/pipelines/{P}/refactoring-plan.md | Yes (REFACTOR with pipeline) |
| Review/validation feedback | From task description | Yes (FIX) |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |
| Wisdom files | {run_dir}/work/team/wisdom/patterns.md | No |
| Context accumulator | From prior REFACTOR/FIX tasks | Yes (inner loop) |

1. Extract session path and task mode (REFACTOR or FIX) from task description
2. **Detect branch/pipeline context** from task description:

| Task Description Field | Value | Context |
|----------------------|-------|---------|
| `BranchId: B{NN}` | Present | Fan-out branch -- load single refactoring detail |
| `PipelineId: {P}` | Present | Independent pipeline -- load pipeline-scoped plan |
| Neither present | - | Single mode -- load full refactoring plan |

3. **Load refactoring context by mode**:
   - **Single mode (no branch)**: Read `{run_dir}/outputs/refactoring-plan.md` -- extract ALL priority-ordered changes
   - **Fan-out branch**: Read `{run_dir}/outputs/branches/B{NN}/refactoring-detail.md` -- extract ONLY this branch's refactoring (single REFACTOR-ID)
   - **Independent pipeline**: Read `{run_dir}/outputs/pipelines/{P}/refactoring-plan.md` -- extract this pipeline's plan

4. For FIX: parse review/validation feedback for specific issues to address
5. Use `explore` CLI tool to load implementation context for target files
6. For inner loop (single mode only): load context_accumulator from prior REFACTOR/FIX tasks

**Meta.json namespace**:
- Single: write to `refactorer` namespace
- Fan-out: write to `refactorer.B{NN}` namespace
- Independent: write to `refactorer.{P}` namespace

## Phase 3: Code Implementation

Implementation backend selection:

| Backend | Condition | Method |
|---------|-----------|--------|
| CLI | Multi-file refactoring with clear plan | maestro delegate --to agy --mode write |
| Direct | Single-file changes or targeted fixes | Inline Edit/Write tools |

For REFACTOR tasks:
- **Single mode**: Apply refactorings in plan priority order (P0 first, then P1, etc.)
- **Fan-out branch**: Apply ONLY this branch's single refactoring (from refactoring-detail.md)
- **Independent pipeline**: Apply this pipeline's refactorings in priority order
- Follow implementation guidance from plan (target files, patterns)
- **Preserve existing behavior -- refactoring must not change functionality**
- **Update ALL import references** when moving/renaming modules
- **Update ALL test files** that reference moved/renamed symbols

For FIX tasks:
- Read specific issues from review/validation feedback
- Apply targeted corrections to flagged code locations
- Verify the fix addresses the exact concern raised

General rules:
- Make minimal, focused changes per refactoring
- Add comments only where refactoring logic is non-obvious
- Preserve existing code style and conventions
- Verify no dangling imports after module moves

## Phase 4: Self-Validation

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Syntax | IDE diagnostics or build check | No new errors |
| File integrity | Verify all planned files exist and are modified | All present |
| Import integrity | Verify no broken imports after moves | All imports resolve |
| Acceptance | Match refactoring plan success criteria | All structural changes applied |
| No regression | Run existing tests if available | No new failures |

If validation fails, attempt auto-fix (max 2 attempts) before reporting error.

Append to context_accumulator for next REFACTOR/FIX task (single/inner-loop mode only):
- Files modified, refactorings applied, validation results
- Any discovered patterns or caveats for subsequent iterations

**Branch output paths**:
- Single: write artifacts to `{run_dir}/outputs/`
- Fan-out: write artifacts to `{run_dir}/outputs/branches/B{NN}/`
- Independent: write artifacts to `{run_dir}/outputs/pipelines/{P}/`
