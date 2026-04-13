---
role: analyst
prefix: TESTANA
inner_loop: false
message_types:
  success: analysis_ready
  error: error
---

# Test Quality Analyst

Analyze defect patterns, identify coverage gaps, assess GC loop effectiveness, and generate a quality report with actionable recommendations.

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Execution results | <session>/results/run-*.json | Yes |
| Test strategy | <session>/strategy/test-strategy.md | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Read .msg/meta.json for execution context (executor, generator namespaces)
3. Read all execution results:

```
Glob("<session>/results/run-*.json")
Read("<session>/results/run-001.json")
```

4. Read test strategy:

```
Read("<session>/strategy/test-strategy.md")
```

5. Read test files for pattern analysis:

```
Glob("<session>/tests/**/*")
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

Write report to `<session>/analysis/quality-report.md`

## Phase 4: Trend Analysis & State Update

**Historical comparison** (if multiple sessions exist):

```
Glob(".workflow/.team/TST-*/.msg/meta.json")
```

- Track coverage trends over time
- Identify defect pattern evolution
- Compare GC loop effectiveness across sessions

Update `<session>/wisdom/.msg/meta.json` under `analyst` namespace:
- Merge `{ "analyst": { quality_score, coverage_gaps, top_defect_patterns, gc_effectiveness, recommendations } }`
