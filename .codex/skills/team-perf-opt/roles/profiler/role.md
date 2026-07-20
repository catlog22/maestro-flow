---
role: profiler
prefix: PROFILE
inner_loop: false
message_types: 
---

# Performance Profiler

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | {run_dir}/work/team/.msg/meta.json | No |

1. Extract session path and target scope from task description
2. Detect project type by scanning for framework markers:

| Signal File | Project Type | Profiling Focus |
|-------------|-------------|-----------------|
| package.json + React/Vue/Angular | Frontend | Render time, bundle size, FCP/LCP/CLS |
| package.json + Express/Fastify/NestJS | Backend Node | CPU hotspots, memory, DB queries |
| Cargo.toml / go.mod / pom.xml | Native/JVM Backend | CPU, memory, GC tuning |
| Mixed framework markers | Full-stack | Split into FE + BE profiling passes |
| CLI entry / bin/ directory | CLI Tool | Startup time, throughput, memory peak |
| No detection | Generic | All profiling dimensions |

3. Use ACE search or CLI tools to map performance-critical code paths within target scope
4. Detect available profiling tools (test runners, benchmark harnesses, linting tools)

## Phase 3: Performance Profiling

Execute profiling based on detected project type:

**Frontend profiling**:
- Analyze bundle size and dependency weight via build output
- Identify render-blocking resources and heavy components
- Check for unnecessary re-renders, large DOM trees, unoptimized assets

**Backend profiling**:
- Trace hot code paths via execution analysis or instrumented runs
- Identify slow database queries, N+1 patterns, missing indexes
- Check memory allocation patterns and potential leaks

**CLI / Library profiling**:
- Measure startup time and critical path latency
- Profile throughput under representative workloads
- Identify memory peaks and allocation churn

**All project types**:
- Collect quantified baseline metrics (timing, memory, throughput)
- Rank top 3-5 bottlenecks by severity (Critical / High / Medium)
- Record evidence: file paths, line numbers, measured values

### Tech Profile Scan

After profiling, scan findings for context-aware trigger signals (based on detected codebase characteristics):

1. Check profiling results → signals (`perf_sensitive`, `scaling_concern`, `concurrency_issue`)
2. Check code patterns found → risk signals (`sql_detected`, `realtime_detected`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Report Generation

1. Write baseline metrics to `{run_dir}/outputs/baseline-metrics.json`:
   - Key metric names, measured values, units, measurement method
   - Timestamp and environment details

2. Write bottleneck report to `{run_dir}/outputs/bottleneck-report.md`:
   - Ranked list of bottlenecks with severity, location (file:line), measured impact
   - Evidence summary per bottleneck
   - Detected project type and profiling methods used

3. Update `{run_dir}/work/team/.msg/meta.json` under `profiler` namespace:
   - Read existing -> merge `{ "profiler": { project_type, bottleneck_count, top_bottleneck, scope } }` -> write back
