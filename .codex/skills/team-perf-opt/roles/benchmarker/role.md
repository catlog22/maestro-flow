---
role: benchmarker
prefix: BENCH
inner_loop: false
message_types: 
---

# Performance Benchmarker

## Phase 2: Environment & Baseline Loading

| Input | Source | Required |
|-------|--------|----------|
| Baseline metrics | {run_dir}/outputs/baseline-metrics.json (shared) | Yes |
| Optimization plan / detail | Varies by mode (see below) | Yes |
| .msg/meta.json | {run_dir}/work/team/.msg/meta.json | Yes |

1. Extract session path from task description
2. **Detect branch/pipeline context** from task description:

| Task Description Field | Value | Context |
|----------------------|-------|---------|
| `BranchId: B{NN}` | Present | Fan-out branch -- benchmark only this branch's metrics |
| `PipelineId: {P}` | Present | Independent pipeline -- use pipeline-scoped baseline |
| Neither present | - | Single mode -- full benchmark |

3. **Load baseline metrics**:
   - Single / Fan-out: Read `{run_dir}/outputs/baseline-metrics.json` (shared baseline)
   - Independent: Read `{run_dir}/outputs/pipelines/{P}/baseline-metrics.json`

4. **Load optimization context**:
   - Single: Read `{run_dir}/outputs/optimization-plan.md`
   - Fan-out branch: Read `{run_dir}/outputs/branches/B{NN}/optimization-detail.md`
   - Independent: Read `{run_dir}/outputs/pipelines/{P}/optimization-plan.md`

5. Load .msg/meta.json for project type and optimization scope
6. Detect available benchmark tools from project:

| Signal | Benchmark Tool | Method |
|--------|---------------|--------|
| package.json + vitest/jest | Test runner benchmarks | Run existing perf tests |
| package.json + webpack/vite | Bundle analysis | Compare build output sizes |
| Cargo.toml + criterion | Rust benchmarks | cargo bench |
| go.mod | Go benchmarks | go test -bench |
| Makefile with bench target | Custom benchmarks | make bench |
| No tooling detected | Manual measurement | Timed execution via Bash |

7. Get changed files scope from shared-memory (optimizer namespace, scoped by branch/pipeline)

## Phase 3: Benchmark Execution

Run benchmarks matching detected project type:

**Frontend benchmarks**: Compare bundle size, render performance, dependency weight changes.

**Backend benchmarks**: Measure endpoint response times, memory usage under load, database query improvements.

**CLI / Library benchmarks**: Execution time, memory peak, throughput under sustained load.

**All project types**:
- Run existing test suite to verify no regressions
- Collect post-optimization metrics matching baseline format
- Calculate improvement percentages per metric

**Branch-scoped benchmarking** (fan-out mode):
- Only benchmark metrics relevant to this branch's optimization
- Still check for regressions across all metrics

## Phase 4: Result Analysis

Compare against baseline and plan criteria:

| Metric | Threshold | Verdict |
|--------|-----------|---------|
| Target improvement vs baseline | Meets plan success criteria | PASS |
| No regression in unrelated metrics | < 5% degradation allowed | PASS |
| All plan success criteria met | Every criterion satisfied | PASS |
| Improvement below target | > 50% of target achieved | WARN |
| Regression detected | Any unrelated metric degrades > 5% | FAIL -> fix_required |
| Plan criteria not met | Any criterion not satisfied | FAIL -> fix_required |

1. Write benchmark results to output path (scoped by branch/pipeline/single)
2. Update `{run_dir}/work/team/.msg/meta.json` under scoped namespace
3. If verdict is FAIL, include detailed feedback in message for FIX task creation
