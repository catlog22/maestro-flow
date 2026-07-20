---
role: analyst
prefix: TESTANA
inner_loop: false
message_types: 
---

# Test Quality Analyst

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Execution results | {run_dir}/outputs/results/run-*.json | Yes |
| Test strategy | {run_dir}/outputs/strategy/test-strategy.md | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Read .msg/meta.json for execution context (executor, generator namespaces)
3. Read all execution results:

```
Glob("{run_dir}/outputs/results/run-*.json")
Read("{run_dir}/outputs/results/run-001.json")
```

4. Read test strategy:

```
Read("{run_dir}/outputs/strategy/test-strategy.md")
```

5. Read test files for pattern analysis:

```
Glob("{run_dir}/outputs/tests/**/*")
```

## Phase 3: Quality Analysis

**Analysis dimensions**:

1. **Coverage Analysis** -- Aggregate coverage by layer:

| Layer | Coverage | Target | Status |
|-------|----------|--------|--------|
| L1 | X% | Y% | Met/Below |

2. **Defect Pattern Analysis** -- Frequency and severity:

| Pattern | Frequency | Severity |
|---------|-----------|----------|
| pattern | count | HIGH (>=3) / MEDIUM (>=2) / LOW (<2) |

3. **GC Loop Effectiveness**:

| Metric | Value | Assessment |
|--------|-------|------------|
| Rounds | N | - |
| Coverage Improvement | +/-X% | HIGH (>10%) / MEDIUM (>5%) / LOW (<=5%) |

4. **Coverage Gaps** -- per module/feature:
   - Area, Current %, Gap %, Reason, Recommendation

5. **Quality Score**:

| Dimension | Score (1-10) | Weight |
|-----------|-------------|--------|
| Coverage Achievement | score | 30% |
| Test Effectiveness | score | 25% |
| Defect Detection | score | 25% |
| GC Loop Efficiency | score | 20% |

Write report to `{run_dir}/outputs/analysis/quality-report.md`

### Tech Profile Scan

After test analysis, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check test findings → signals (`test_gap`, `perf_sensitive`)
2. Check tested code → risk signals (`sql_detected`, `auth_detected`, `injection_risk`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Trend Analysis & State Update

**Historical comparison** (if multiple sessions exist):

```
Glob("{run_dir}/work/team/.msg/meta.json")
```

- Track coverage trends over time
- Identify defect pattern evolution
- Compare GC loop effectiveness across sessions

Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `analyst` namespace:
- Merge `{ "analyst": { quality_score, coverage_gaps, top_defect_patterns, gc_effectiveness, recommendations } }`
