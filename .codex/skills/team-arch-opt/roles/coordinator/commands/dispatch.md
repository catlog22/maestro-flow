
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

1. Load user requirement and refactoring scope from team-session.json
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
  - Scope: <refactoring-scope>
  - Branch: <branch-id or 'none'>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>
---
InnerLoop: <true|false>
BranchId: <B01|A|none>"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `single` | Create 5 tasks (ANALYZE → DESIGN → REFACTOR → VALIDATE + REVIEW) -- unchanged from linear pipeline |
| `auto` | Create ANALYZE-001 + DESIGN-001 only. **Defer branch creation to CP-2.5** after design completes |
| `fan-out` | Create ANALYZE-001 + DESIGN-001 only. **Defer branch creation to CP-2.5** after design completes |
| `independent` | Create M complete pipelines immediately (one per target) |

---

### Single Mode Task Chain

Create tasks in dependency order (backward compatible, unchanged):

**ANALYZE-001** (analyzer, Stage 1):
```
update_plan({
  subject: "ANALYZE-001",
  description: "PURPOSE: Analyze codebase architecture to identify structural issues | Success: Baseline metrics captured, top 3-7 issues ranked by severity
TASK:
  - Detect project type and available analysis tools
  - Execute analysis across relevant dimensions (dependencies, coupling, cohesion, layering, duplication, dead code)
  - Collect baseline metrics and rank architecture issues by severity
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <refactoring-scope>
  - Branch: none
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/architecture-baseline.json + {run_dir}/outputs/architecture-report.md | Quantified metrics with evidence
CONSTRAINTS: Focus on <refactoring-scope> | Analyze before any changes
---
InnerLoop: false"
})
update_plan({ taskId: "ANALYZE-001", owner: "analyzer" })
```

**DESIGN-001** (designer, Stage 2):
```
update_plan({
  subject: "DESIGN-001",
  description: "PURPOSE: Design prioritized refactoring plan from architecture analysis | Success: Actionable plan with measurable success criteria per refactoring
TASK:
  - Analyze architecture report and baseline metrics
  - Select refactoring strategies per issue type
  - Prioritize by impact/effort ratio, define success criteria
  - Each refactoring MUST have a unique REFACTOR-ID (REFACTOR-001, REFACTOR-002, ...) with non-overlapping target files
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <refactoring-scope>
  - Branch: none
  - Upstream artifacts: architecture-baseline.json, architecture-report.md
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/refactoring-plan.md | Priority-ordered with structural improvement targets, discrete REFACTOR-IDs
CONSTRAINTS: Focus on highest-impact refactorings | Risk assessment required | Non-overlapping file targets per REFACTOR-ID
---
InnerLoop: false"
})
update_plan({ taskId: "DESIGN-001", addBlockedBy: ["ANALYZE-001"], owner: "designer" })
```

**REFACTOR-001** (refactorer, Stage 3):
```
update_plan({
  subject: "REFACTOR-001",
  description: "PURPOSE: Implement refactoring changes per design plan | Success: All planned refactorings applied, code compiles, existing tests pass
TASK:
  - Load refactoring plan and identify target files
  - Apply refactorings in priority order (P0 first)
  - Update all import references for moved/renamed modules
  - Validate changes compile and pass existing tests
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <refactoring-scope>
  - Branch: none
  - Upstream artifacts: refactoring-plan.md
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: Modified source files + validation passing | Refactorings applied without regressions
CONSTRAINTS: Preserve existing behavior | Update all references | Follow code conventions
---
InnerLoop: true"
})
update_plan({ taskId: "REFACTOR-001", addBlockedBy: ["DESIGN-001"], owner: "refactorer" })
```

**VALIDATE-001** (validator, Stage 4 - parallel):
```
update_plan({
  subject: "VALIDATE-001",
  description: "PURPOSE: Validate refactoring results against baseline | Success: Build passes, tests pass, no metric regressions, API compatible
TASK:
  - Load architecture baseline and plan success criteria
  - Run build validation (compilation, type checking)
  - Run test validation (existing test suite)
  - Compare dependency metrics against baseline
  - Verify API compatibility (no dangling references)
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <refactoring-scope>
  - Branch: none
  - Upstream artifacts: architecture-baseline.json, refactoring-plan.md
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/validation-results.json | Per-dimension validation with verdicts
CONSTRAINTS: Must compare against baseline | Flag any regressions or broken imports
---
InnerLoop: false"
})
update_plan({ taskId: "VALIDATE-001", addBlockedBy: ["REFACTOR-001"], owner: "validator" })
```

**REVIEW-001** (reviewer, Stage 4 - parallel):
```
update_plan({
  subject: "REVIEW-001",
  description: "PURPOSE: Review refactoring code for correctness, pattern consistency, and migration safety | Success: All dimensions reviewed, verdict issued
TASK:
  - Load modified files and refactoring plan
  - Review across 5 dimensions: correctness, pattern consistency, completeness, migration safety, best practices
  - Issue verdict: APPROVE, REVISE, or REJECT with actionable feedback
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: <refactoring-scope>
  - Branch: none
  - Upstream artifacts: refactoring-plan.md, validation-results.json (if available)
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json
EXPECTED: {run_dir}/outputs/review-report.md | Per-dimension findings with severity
CONSTRAINTS: Focus on refactoring changes only | Provide specific file:line references
---
InnerLoop: false"
})
update_plan({ taskId: "REVIEW-001", addBlockedBy: ["REFACTOR-001"], owner: "reviewer" })
```

---

### Auto / Fan-out Mode Task Chain (Deferred Branching)

For `auto` and `fan-out` modes, create only shared stages now. Branch tasks are created at **CP-2.5** after DESIGN-001 completes.

Create ANALYZE-001 and DESIGN-001 with same templates as single mode above.

**Do NOT create REFACTOR/VALIDATE/REVIEW tasks yet.** They are created by the CP-2.5 Branch Creation subroutine in monitor.md.

---

### Independent Mode Task Chain

For `independent` mode, create M complete pipelines -- one per target in `independent_targets` array.

Pipeline prefix chars: `A, B, C, D, E, F, G, H, I, J` (from config `pipeline_prefix_chars`).

For each target index `i` (0-based), with prefix char `P = pipeline_prefix_chars[i]`:

```
// Create session subdirectory for this pipeline
Bash("mkdir -p {run_dir}/outputs/pipelines/<P>")

update_plan({ subject: "ANALYZE-<P>01", ... })
update_plan({ subject: "DESIGN-<P>01", ... })
update_plan({ taskId: "DESIGN-<P>01", addBlockedBy: ["ANALYZE-<P>01"] })
update_plan({ subject: "REFACTOR-<P>01", ... })
update_plan({ taskId: "REFACTOR-<P>01", addBlockedBy: ["DESIGN-<P>01"] })
update_plan({ subject: "VALIDATE-<P>01", ... })
update_plan({ taskId: "VALIDATE-<P>01", addBlockedBy: ["REFACTOR-<P>01"] })
update_plan({ subject: "REVIEW-<P>01", ... })
update_plan({ taskId: "REVIEW-<P>01", addBlockedBy: ["REFACTOR-<P>01"] })
```

Task descriptions follow same template as single mode, with additions:
- `Pipeline: <P>` in CONTEXT
- Artifact paths use `{run_dir}/outputs/pipelines/<P>/` instead of `{run_dir}/outputs/`
- Meta.json namespace uses `<role>.<P>` (e.g., `analyzer.A`, `refactorer.B`)
- Each pipeline's scope is its specific target from `independent_targets[i]`

Example for pipeline A with target "refactor auth module":
```
update_plan({
  subject: "ANALYZE-A01",
  description: "PURPOSE: Analyze auth module architecture | Success: Auth module structural issues identified
TASK:
  - Detect project type and available analysis tools
  - Execute architecture analysis focused on auth module
  - Collect baseline metrics and rank auth module issues
CONTEXT:
  - Session: {run_dir}/work/team
  - Scope: refactor auth module
  - Pipeline: A
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json (namespace: analyzer.A)
EXPECTED: {run_dir}/outputs/pipelines/A/architecture-baseline.json + architecture-report.md
CONSTRAINTS: Focus on auth module scope
---
InnerLoop: false
PipelineId: A"
})
update_plan({ taskId: "ANALYZE-A01", owner: "analyzer" })
```

---

### CP-2.5: Branch Creation Subroutine

**Triggered by**: monitor.md handleCallback when DESIGN-001 completes in `auto` or `fan-out` mode.

**Procedure**:

1. Read `{run_dir}/outputs/refactoring-plan.md` to count REFACTOR-IDs
2. Read `.msg/meta.json` -> `designer.refactoring_count`
3. **Auto mode decision**:

| Refactoring Count | Decision |
|-------------------|----------|
| count <= 2 | Switch to `single` mode -- create REFACTOR-001, VALIDATE-001, REVIEW-001 (standard single pipeline) |
| count >= 3 | Switch to `fan-out` mode -- create branch tasks below |

4. Update team-session.json with resolved `parallel_mode` (auto -> single or fan-out)

5. **Fan-out branch creation** (when count >= 3 or forced fan-out):
   - Truncate to `max_branches` if `refactoring_count > max_branches` (keep top N by priority)
   - For each refactoring `i` (1-indexed), branch ID = `B{NN}` where NN = zero-padded i:

```
// Create branch artifact directory
Bash("mkdir -p {run_dir}/outputs/branches/B{NN}")

// Extract single REFACTOR detail to branch
Write("{run_dir}/outputs/branches/B{NN}/refactoring-detail.md",
  extracted REFACTOR-{NNN} block from refactoring-plan.md)
```

6. Create branch tasks for each branch B{NN}:

```
update_plan({
  subject: "REFACTOR-B{NN}",
  description: "PURPOSE: Implement refactoring REFACTOR-{NNN} | Success: Single refactoring applied, compiles, tests pass
TASK:
  - Load refactoring detail from branches/B{NN}/refactoring-detail.md
  - Apply this single refactoring to target files
  - Update all import references for moved/renamed modules
  - Validate changes compile and pass existing tests
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: branches/B{NN}/refactoring-detail.md
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json (namespace: refactorer.B{NN})
EXPECTED: Modified source files for REFACTOR-{NNN} only
CONSTRAINTS: Only implement this branch's refactoring | Do not touch files outside REFACTOR-{NNN} scope
---
InnerLoop: false
BranchId: B{NN}"
})
update_plan({ taskId: "REFACTOR-B{NN}", addBlockedBy: ["DESIGN-001"], owner: "refactorer" })

update_plan({
  subject: "VALIDATE-B{NN}",
  description: "PURPOSE: Validate branch B{NN} refactoring | Success: REFACTOR-{NNN} passes build, tests, and metric checks
TASK:
  - Load architecture baseline and REFACTOR-{NNN} success criteria
  - Validate build, tests, dependency metrics, and API compatibility
  - Compare against baseline, check for regressions
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: architecture-baseline.json, branches/B{NN}/refactoring-detail.md
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json (namespace: validator.B{NN})
EXPECTED: {run_dir}/outputs/branches/B{NN}/validation-results.json
CONSTRAINTS: Only validate this branch's changes
---
InnerLoop: false
BranchId: B{NN}"
})
update_plan({ taskId: "VALIDATE-B{NN}", addBlockedBy: ["REFACTOR-B{NN}"], owner: "validator" })

update_plan({
  subject: "REVIEW-B{NN}",
  description: "PURPOSE: Review branch B{NN} refactoring code | Success: Code quality verified for REFACTOR-{NNN}
TASK:
  - Load modified files from refactorer.B{NN} namespace in .msg/meta.json
  - Review across 5 dimensions for this branch's changes only
  - Issue verdict: APPROVE, REVISE, or REJECT
CONTEXT:
  - Session: {run_dir}/work/team
  - Branch: B{NN}
  - Upstream artifacts: branches/B{NN}/refactoring-detail.md
  - Shared memory: {run_dir}/work/team/wisdom/.msg/meta.json (namespace: reviewer.B{NN})
EXPECTED: {run_dir}/outputs/branches/B{NN}/review-report.md
CONSTRAINTS: Only review this branch's changes
---
InnerLoop: false
BranchId: B{NN}"
})
update_plan({ taskId: "REVIEW-B{NN}", addBlockedBy: ["REFACTOR-B{NN}"], owner: "reviewer" })
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
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| Task IDs use correct prefixes | Pattern check | Match naming rules per mode |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |
| Branch/Pipeline IDs consistent | Cross-check with team-session.json | Match |

### Naming Rules Summary

| Mode | Stage 3 | Stage 4 | Fix |
|------|---------|---------|-----|
| Single | REFACTOR-001 | VALIDATE-001, REVIEW-001 | FIX-001, FIX-002 |
| Fan-out | REFACTOR-B01 | VALIDATE-B01, REVIEW-B01 | FIX-B01-1, FIX-B01-2 |
| Independent | REFACTOR-A01 | VALIDATE-A01, REVIEW-A01 | FIX-A01-1, FIX-A01-2 |

If validation fails, fix the specific task and re-validate.
