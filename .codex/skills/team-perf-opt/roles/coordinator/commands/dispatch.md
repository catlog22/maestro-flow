
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline definition | From SKILL.md Pipeline Definitions | Yes |
| Parallel mode | From team-session.json `parallel_mode` | Yes |
| Max branches | From team-session.json `max_branches` | Yes |
| Independent targets | From team-session.json `independent_targets` (independent mode only) | Conditional |

1. Load user requirement and optimization scope from team-session.json
2. Load pipeline stage definitions from SKILL.md Task Metadata Registry
3. Read `parallel_mode` and `max_branches` from team-session.json
4. For `independent` mode: read `independent_targets` array from team-session.json

## Phase 3: Task Chain Creation (Mode-Branched)

### Task Description Template

Every task description uses structured format for clarity:

```
update_plan({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <optimization-scope>
  - Branch: <branch-id or 'none'>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>
---
InnerLoop: <true|false>
BranchId: <B01|A|none>",
  status: "pending"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `single` | Create 5 tasks (PROFILE → STRATEGY → IMPL → BENCH + REVIEW) -- unchanged from linear pipeline |
| `auto` | Create PROFILE-001 + STRATEGY-001 only. **Defer branch creation to CP-2.5** after strategy completes |
| `fan-out` | Create PROFILE-001 + STRATEGY-001 only. **Defer branch creation to CP-2.5** after strategy completes |
| `independent` | Create M complete pipelines immediately (one per target) |

---

### Single Mode Task Chain

Create tasks in dependency order (backward compatible, unchanged):

**PROFILE-001** (profiler, Stage 1):
```
update_plan({
  subject: "PROFILE-001",
  description: "PURPOSE: Profile application performance to identify bottlenecks | Success: Baseline metrics captured, top 3-5 bottlenecks ranked by severity
TASK:
  - Detect project type and available profiling tools
  - Execute profiling across relevant dimensions (CPU, memory, I/O, network, rendering)
  - Collect baseline metrics and rank bottlenecks by severity
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <optimization-scope>
  - Branch: none
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/baseline-metrics.json + {run_dir}/outputs/bottleneck-report.md | Quantified metrics with evidence
CONSTRAINTS: Focus on <optimization-scope> | Profile before any changes
---
InnerLoop: false",
  status: "pending"
})
```

**STRATEGY-001** (strategist, Stage 2):
```
update_plan({
  subject: "STRATEGY-001",
  description: "PURPOSE: Design prioritized optimization plan from bottleneck analysis | Success: Actionable plan with measurable success criteria per optimization
TASK:
  - Analyze bottleneck report and baseline metrics
  - Select optimization strategies per bottleneck type
  - Prioritize by impact/effort ratio, define success criteria
  - Each optimization MUST have a unique OPT-ID (OPT-001, OPT-002, ...) with non-overlapping target files
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <optimization-scope>
  - Branch: none
  - Upstream artifacts: baseline-metrics.json, bottleneck-report.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/optimization-plan.md | Priority-ordered with improvement targets, discrete OPT-IDs
CONSTRAINTS: Focus on highest-impact optimizations | Risk assessment required | Non-overlapping file targets per OPT-ID
---
InnerLoop: false",
  status: "pending"
})
update_plan({ taskId: "STRATEGY-001", addBlockedBy: ["PROFILE-001"] })
```

**IMPL-001** (optimizer, Stage 3):
```
update_plan({
  subject: "IMPL-001",
  description: "PURPOSE: Implement optimization changes per strategy plan | Success: All planned optimizations applied, code compiles, existing tests pass
TASK:
  - Load optimization plan and identify target files
  - Apply optimizations in priority order (P0 first)
  - Validate changes compile and pass existing tests
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <optimization-scope>
  - Branch: none
  - Upstream artifacts: optimization-plan.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: Modified source files + validation passing | Optimizations applied without regressions
CONSTRAINTS: Preserve existing behavior | Minimal changes per optimization | Follow code conventions
---
InnerLoop: true",
  status: "pending"
})
update_plan({ taskId: "IMPL-001", addBlockedBy: ["STRATEGY-001"] })
```

**BENCH-001** (benchmarker, Stage 4 - parallel):
```
update_plan({
  subject: "BENCH-001",
  description: "PURPOSE: Benchmark optimization results against baseline | Success: All plan success criteria met, no regressions detected
TASK:
  - Load baseline metrics and plan success criteria
  - Run benchmarks matching project type
  - Compare before/after metrics, calculate improvements
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <optimization-scope>
  - Branch: none
  - Upstream artifacts: baseline-metrics.json, optimization-plan.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/benchmark-results.json | Per-metric comparison with verdicts
CONSTRAINTS: Must compare against baseline | Flag any regressions
---
InnerLoop: false",
  status: "pending"
})
update_plan({ taskId: "BENCH-001", addBlockedBy: ["IMPL-001"] })
```

**REVIEW-001** (reviewer, Stage 4 - parallel):
```
update_plan({
  subject: "REVIEW-001",
  description: "PURPOSE: Review optimization code for correctness, side effects, and regression risks | Success: All dimensions reviewed, verdict issued
TASK:
  - Load modified files and optimization plan
  - Review across 5 dimensions: correctness, side effects, maintainability, regression risk, best practices
  - Issue verdict: APPROVE, REVISE, or REJECT with actionable feedback
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <optimization-scope>
  - Branch: none
  - Upstream artifacts: optimization-plan.md, benchmark-results.json (if available)
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/review-report.md | Per-dimension findings with severity
CONSTRAINTS: Focus on optimization changes only | Provide specific file:line references
---
InnerLoop: false",
  status: "pending"
})
update_plan({ taskId: "REVIEW-001", addBlockedBy: ["IMPL-001"] })
```

---

### Auto / Fan-out Mode Task Chain (Deferred Branching)

For `auto` and `fan-out` modes, create only shared stages now. Branch tasks are created at **CP-2.5** after STRATEGY-001 completes.

Create PROFILE-001 and STRATEGY-001 with same templates as single mode above.

**Do NOT create IMPL/BENCH/REVIEW tasks yet.** They are created by the CP-2.5 Branch Creation subroutine in monitor.md.

---

### Independent Mode Task Chain

For `independent` mode, create M complete pipelines -- one per target in `independent_targets` array.

Pipeline prefix chars: `A, B, C, D, E, F, G, H, I, J` (from config `pipeline_prefix_chars`).

For each target index `i` (0-based), with prefix char `P = pipeline_prefix_chars[i]`:

```
// Create session subdirectory for this pipeline
Bash("mkdir -p {run_dir}/outputs/pipelines/<P>")

update_plan({ subject: "PROFILE-<P>01", ... })
update_plan({ subject: "STRATEGY-<P>01", ... })
update_plan({ subject: "IMPL-<P>01", ... })
update_plan({ subject: "BENCH-<P>01", ... })
update_plan({ subject: "REVIEW-<P>01", ... })
// Then set dependencies via update_plan:
update_plan({ taskId: "STRATEGY-<P>01", addBlockedBy: ["PROFILE-<P>01"] })
update_plan({ taskId: "IMPL-<P>01", addBlockedBy: ["STRATEGY-<P>01"] })
update_plan({ taskId: "BENCH-<P>01", addBlockedBy: ["IMPL-<P>01"] })
update_plan({ taskId: "REVIEW-<P>01", addBlockedBy: ["IMPL-<P>01"] })
```

Task descriptions follow same template as single mode, with additions:
- `Branch: <P>` in CONTEXT
- Artifact paths use `{run_dir}/outputs/pipelines/<P>/` instead of `{run_dir}/outputs/`
- Shared-memory namespace uses `<role>.<P>` (e.g., `profiler.A`, `optimizer.B`)
- Each pipeline's scope is its specific target from `independent_targets[i]`

Example for pipeline A with target "optimize rendering":
```
update_plan({
  subject: "PROFILE-A01",
  description: "PURPOSE: Profile rendering performance | Success: Rendering bottlenecks identified
TASK:
  - Detect project type and available profiling tools
  - Execute profiling focused on rendering performance
  - Collect baseline metrics and rank rendering bottlenecks
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: optimize rendering
  - Pipeline: A
  - Shared memory: {run_dir}/work/team/.msg/meta.json (namespace: profiler.A)
EXPECTED: {run_dir}/outputs/pipelines/A/baseline-metrics.json + bottleneck-report.md
CONSTRAINTS: Focus on rendering scope
---
InnerLoop: false
PipelineId: A",
  status: "pending"
})
```

---

### CP-2.5: Branch Creation Subroutine

**Triggered by**: monitor.md handleCallback when STRATEGY-001 completes in `auto` or `fan-out` mode.

**Procedure**:

1. Read `{run_dir}/outputs/optimization-plan.md` to count OPT-IDs
2. Read `.msg/meta.json` -> `strategist.optimization_count`
3. **Auto mode decision**:

| Optimization Count | Decision |
|-------------------|----------|
| count <= 2 | Switch to `single` mode -- create IMPL-001, BENCH-001, REVIEW-001 (standard single pipeline) |
| count >= 3 | Switch to `fan-out` mode -- create branch tasks below |

4. Update team-session.json with resolved `parallel_mode` (auto -> single or fan-out)

5. **Fan-out branch creation** (when count >= 3 or forced fan-out):
   - Truncate to `max_branches` if `optimization_count > max_branches` (keep top N by priority)
   - For each optimization `i` (1-indexed), branch ID = `B{NN}` where NN = zero-padded i:

```
// Create branch artifact directory
Bash("mkdir -p {run_dir}/outputs/branches/B{NN}")

// Extract single OPT detail to branch
Write("{run_dir}/outputs/branches/B{NN}/optimization-detail.md",
  extracted OPT-{NNN} block from optimization-plan.md)
```

6. Create branch tasks for each branch B{NN}:

```
update_plan({
  subject: "IMPL-B{NN}",
  description: "PURPOSE: Implement optimization OPT-{NNN} | Success: Single optimization applied, compiles, tests pass
TASK:
  - Load optimization detail from branches/B{NN}/optimization-detail.md
  - Apply this single optimization to target files
  - Validate changes compile and pass existing tests
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: branches/B{NN}/optimization-detail.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json (namespace: optimizer.B{NN})
EXPECTED: Modified source files for OPT-{NNN} only
CONSTRAINTS: Only implement this branch's optimization | Do not touch files outside OPT-{NNN} scope
---
InnerLoop: false
BranchId: B{NN}",
  status: "pending"
})
update_plan({ taskId: "IMPL-B{NN}", addBlockedBy: ["STRATEGY-001"] })

update_plan({
  subject: "BENCH-B{NN}",
  description: "PURPOSE: Benchmark branch B{NN} optimization | Success: OPT-{NNN} metrics meet success criteria
TASK:
  - Load baseline metrics and OPT-{NNN} success criteria
  - Benchmark only metrics relevant to this optimization
  - Compare against baseline, calculate improvement
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: baseline-metrics.json, branches/B{NN}/optimization-detail.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json (namespace: benchmarker.B{NN})
EXPECTED: {run_dir}/outputs/branches/B{NN}/benchmark-results.json
CONSTRAINTS: Only benchmark this branch's metrics
---
InnerLoop: false
BranchId: B{NN}",
  status: "pending"
})
update_plan({ taskId: "BENCH-B{NN}", addBlockedBy: ["IMPL-B{NN}"] })

update_plan({
  subject: "REVIEW-B{NN}",
  description: "PURPOSE: Review branch B{NN} optimization code | Success: Code quality verified for OPT-{NNN}
TASK:
  - Load modified files from optimizer.B{NN} shared-memory namespace
  - Review across 5 dimensions for this branch's changes only
  - Issue verdict: APPROVE, REVISE, or REJECT
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: branches/B{NN}/optimization-detail.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json (namespace: reviewer.B{NN})
EXPECTED: {run_dir}/outputs/branches/B{NN}/review-report.md
CONSTRAINTS: Only review this branch's changes
---
InnerLoop: false
BranchId: B{NN}",
  status: "pending"
})
update_plan({ taskId: "REVIEW-B{NN}", addBlockedBy: ["IMPL-B{NN}"] })
```

7. Update team-session.json:
   - `branches`: array of branch IDs (["B01", "B02", ...])
   - `fix_cycles`: object keyed by branch ID, all initialized to 0

---

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | list_agents count | single: 5, auto/fan-out: 2 (pre-CP-2.5), independent: 5*M |
| Dependencies correct | Trace dependency graph | Acyclic, correct addBlockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| Task IDs use correct prefixes | Pattern check | Match naming rules per mode |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |
| Branch/Pipeline IDs consistent | Cross-check with team-session.json | Match |

### Naming Rules Summary

| Mode | Stage 3 | Stage 4 | Fix |
|------|---------|---------|-----|
| Single | IMPL-001 | BENCH-001, REVIEW-001 | FIX-001, FIX-002 |
| Fan-out | IMPL-B01 | BENCH-B01, REVIEW-B01 | FIX-B01-1, FIX-B01-2 |
| Independent | IMPL-A01 | BENCH-A01, REVIEW-A01 | FIX-A01-1, FIX-A01-2 |

If validation fails, fix the specific task and re-validate.
