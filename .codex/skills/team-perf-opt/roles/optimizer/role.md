---
role: optimizer
prefix: IMPL
inner_loop: dynamic
additional_prefixes: [FIX]
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Code Optimizer

## Modes

| Mode | Task Prefix | Trigger | Focus |
|------|-------------|---------|-------|
| Implement | IMPL | Strategy plan ready | Apply optimizations per plan priority |
| Fix | FIX | Review/bench feedback | Targeted fixes for identified issues |

## Phase 2: Plan & Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Optimization plan | <session>/artifacts/optimization-plan.md | Yes (IMPL, no branch) |
| Branch optimization detail | <session>/artifacts/branches/B{NN}/optimization-detail.md | Yes (IMPL with branch) |
| Pipeline optimization plan | <session>/artifacts/pipelines/{P}/optimization-plan.md | Yes (IMPL with pipeline) |
| Review/bench feedback | From task description | Yes (FIX) |
| .msg/meta.json | <session>/.msg/meta.json | Yes |
| Wisdom files | <session>/wisdom/patterns.md | No |
| Context accumulator | From prior IMPL/FIX tasks | Yes (inner loop) |

1. Extract session path and task mode (IMPL or FIX) from task description
2. **Detect branch/pipeline context** from task description:

| Task Description Field | Value | Context |
|----------------------|-------|---------|
| `BranchId: B{NN}` | Present | Fan-out branch -- load single optimization detail |
| `PipelineId: {P}` | Present | Independent pipeline -- load pipeline-scoped plan |
| Neither present | - | Single mode -- load full optimization plan |

3. **Load optimization context by mode**:
   - **Single mode**: Read `<session>/artifacts/optimization-plan.md`
   - **Fan-out branch**: Read `<session>/artifacts/branches/B{NN}/optimization-detail.md`
   - **Independent pipeline**: Read `<session>/artifacts/pipelines/{P}/optimization-plan.md`

4. For FIX: parse review/benchmark feedback for specific issues to address
5. Use ACE search or CLI tools to load implementation context for target files
6. For inner loop (single mode only): load context_accumulator from prior IMPL/FIX tasks

## Phase 3: Code Implementation

Implementation backend selection:

| Backend | Condition | Method |
|---------|-----------|--------|
| CLI | Multi-file optimization with clear plan | maestro delegate --to agy --mode write |
| Direct | Single-file changes or targeted fixes | Inline Edit/Write tools |

For IMPL tasks:
- **Single mode**: Apply optimizations in plan priority order (P0 first, then P1, etc.)
- **Fan-out branch**: Apply ONLY this branch's single optimization
- **Independent pipeline**: Apply this pipeline's optimizations in priority order
- Follow implementation guidance from plan (target files, patterns)
- Preserve existing behavior -- optimization must not break functionality

For FIX tasks:
- Read specific issues from review/benchmark feedback
- Apply targeted corrections to flagged code locations
- Verify the fix addresses the exact concern raised

General rules:
- Make minimal, focused changes per optimization
- Add comments only where optimization logic is non-obvious
- Preserve existing code style and conventions

## Phase 4: Self-Validation

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Syntax | IDE diagnostics or build check | No new errors |
| File integrity | Verify all planned files exist and are modified | All present |
| Acceptance | Match optimization plan success criteria | All target metrics addressed |
| No regression | Run existing tests if available | No new failures |

If validation fails, attempt auto-fix (max 2 attempts) before reporting error.

Append to context_accumulator for next IMPL/FIX task (single/inner-loop mode only):
- Files modified, optimizations applied, validation results
- Any discovered patterns or caveats for subsequent iterations

**Branch output paths**:
- Single: write artifacts to `<session>/artifacts/`
- Fan-out: write artifacts to `<session>/artifacts/branches/B{NN}/`
- Independent: write artifacts to `<session>/artifacts/pipelines/{P}/`
