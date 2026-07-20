---
role: strategist
prefix: STRATEGY
inner_loop: false
discuss_rounds: "[DISCUSS-OPT]"
message_types: 
---

# Optimization Strategist

## Phase 2: Analysis Loading

| Input | Source | Required |
|-------|--------|----------|
| Bottleneck report | {run_dir}/outputs/bottleneck-report.md | Yes |
| Baseline metrics | {run_dir}/outputs/baseline-metrics.json | Yes |
| .msg/meta.json | {run_dir}/work/team/.msg/meta.json | Yes |
| Wisdom files | {run_dir}/work/team/wisdom/patterns.md | No |

1. Extract session path from task description
2. Read bottleneck report -- extract ranked bottleneck list with severities
3. Read baseline metrics -- extract current performance numbers
4. Load .msg/meta.json for profiler findings (project_type, scope)
5. Assess overall optimization complexity:

| Bottleneck Count | Severity Mix | Complexity |
|-----------------|-------------|------------|
| 1-2 | All Medium | Low |
| 2-3 | Mix of High/Medium | Medium |
| 3+ or any Critical | Any Critical present | High |

## Phase 3: Strategy Formulation

For each bottleneck, select optimization approach by type:

| Bottleneck Type | Strategies | Risk Level |
|----------------|-----------|------------|
| CPU hotspot | Algorithm optimization, memoization, caching, worker threads | Medium |
| Memory leak/bloat | Pool reuse, lazy initialization, WeakRef, scope cleanup | High |
| I/O bound | Batching, async pipelines, streaming, connection pooling | Medium |
| Network latency | Request coalescing, compression, CDN, prefetching | Low |
| Rendering | Virtualization, memoization, CSS containment, code splitting | Medium |
| Database | Index optimization, query rewriting, caching layer, denormalization | High |

Prioritize optimizations by impact/effort ratio:

| Priority | Criteria |
|----------|----------|
| P0 (Critical) | High impact + Low effort -- quick wins |
| P1 (High) | High impact + Medium effort |
| P2 (Medium) | Medium impact + Low effort |
| P3 (Low) | Low impact or High effort -- defer |

If complexity is High, use CLI tools for multi-perspective analysis (DISCUSS-OPT round) to evaluate trade-offs between competing strategies before finalizing the plan.

Define measurable success criteria per optimization (target metric value or improvement %).

## Phase 4: Plan Output

1. Write optimization plan to `{run_dir}/outputs/optimization-plan.md`:

   Each optimization MUST have a unique OPT-ID and self-contained detail block:

   ```markdown
   ### OPT-001: <title>
   - Priority: P0
   - Target bottleneck: <bottleneck from report>
   - Target files: <file-list>
   - Strategy: <selected approach>
   - Expected improvement: <metric> by <X%>
   - Risk level: <Low/Medium/High>
   - Success criteria: <specific threshold to verify>
   - Implementation guidance:
     1. <step 1>
     2. <step 2>
     3. <step 3>

   ### OPT-002: <title>
   ...
   ```

   Requirements:
   - Each OPT-ID is sequentially numbered (OPT-001, OPT-002, ...)
   - Each optimization must be **non-overlapping** in target files
   - Implementation guidance must be self-contained

2. Update `{run_dir}/work/team/.msg/meta.json` under `strategist` namespace:
   - Read existing -> merge -> write back with optimization metadata

3. If DISCUSS-OPT was triggered, record discussion summary in `{run_dir}/evidence/discussions/DISCUSS-OPT.md`
