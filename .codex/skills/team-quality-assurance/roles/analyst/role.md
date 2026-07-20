---
role: analyst
prefix: QAANA
inner_loop: false
message_types: 
---

# Quality Analyst

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |
| Discovered issues | meta.json -> discovered_issues | No |
| Test strategy | meta.json -> test_strategy | No |
| Generated tests | meta.json -> generated_tests | No |
| Execution results | meta.json -> execution_results | No |
| Historical patterns | meta.json -> defect_patterns | No |

1. Extract session path from task description
2. Read .msg/meta.json for all accumulated QA data
3. Read coverage data from `coverage/coverage-summary.json` if available
4. Read layer execution results from `{run_dir}/outputs/results/run-*.json`
5. Select analysis mode:

| Data Points | Mode |
|-------------|------|
| <= 5 issues + results | Direct inline analysis |
| > 5 | CLI-assisted deep analysis via agy |

## Phase 3: Multi-Dimensional Analysis

**Five analysis dimensions**:

1. **Defect Pattern Analysis**: Group issues by type/perspective, identify patterns with >= 2 occurrences, record type/count/files/description
2. **Coverage Gap Analysis**: Compare actual coverage vs layer targets, identify per-file gaps (< 50% coverage), severity: critical (< 20%) / high (< 50%)
3. **Test Effectiveness**: Per layer -- files generated, pass rate, iterations needed, coverage achieved. Effective = pass_rate >= 95% AND iterations <= 2
4. **Quality Trend**: Compare against coverage_history. Trend: improving (delta > 5%), declining (delta < -5%), stable
5. **Quality Score** (0-100 starting from 100):

| Factor | Impact |
|--------|--------|
| Security issues | -10 per issue |
| Bug issues | -5 per issue |
| Coverage gap | -0.5 per gap percentage |
| Test failures | -(100 - pass_rate) * 0.3 per layer |
| Effective test layers | +5 per layer |
| Improving trend | +3 |

For CLI-assisted mode:
```
PURPOSE: Deep quality analysis on QA results to identify defect patterns and improvement opportunities
TASK: Classify defects by root cause, identify high-density files, analyze coverage gaps vs risk, generate recommendations
MODE: analysis
```

### Tech Profile Scan

After quality analysis, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check defect patterns → signals (`injection_risk`, `auth_detected`, `sql_detected`)
2. Check coverage data → risk signals (`test_gap`, `perf_sensitive`, `legacy_patterns`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Report Generation & Output

1. Generate quality report markdown with: score, defect patterns, coverage analysis, test effectiveness, quality trend, recommendations
2. Write report to `{run_dir}/outputs/analysis/quality-report.md`
3. Update `{run_dir}/work/team/wisdom/.msg/meta.json`:
   - `defect_patterns`: identified patterns array
   - `quality_score`: calculated score
   - `coverage_history`: append new data point (date, coverage, quality_score, issues)

**Score-based recommendations**:

| Score | Recommendation |
|-------|----------------|
| >= 80 | Quality is GOOD. Maintain current testing practices. |
| 60-79 | Quality needs IMPROVEMENT. Focus on coverage gaps and recurring patterns. |
| < 60 | Quality is CONCERNING. Recommend comprehensive review and testing effort. |
