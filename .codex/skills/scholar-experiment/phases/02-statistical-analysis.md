# Phase 2: Statistical Analysis

> **COMPACT SENTINEL [Phase 2: Statistical Analysis]**
> This phase contains 5 execution steps (Step 2.1 -- 2.5).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/02-statistical-analysis.md")`

Compute descriptive statistics, execute pre-tests for assumption verification, perform appropriate hypothesis testing, calculate effect sizes, and apply multiple comparison corrections.

## Objective

- Calculate descriptive statistics (mean, SD, SE, CI) for all models and metrics
- Run pre-tests: normality (Shapiro-Wilk) and homogeneity of variance (Levene)
- Select and execute appropriate statistical tests based on pre-test results
- Calculate effect sizes (Cohen's d, eta-squared)
- Apply multiple comparison corrections (Bonferroni, FDR)
- Produce complete statistical results for downstream phases

## Step 2.1: Descriptive Statistics

**⚠️ MINIMUM SAMPLE SIZE CHECK**:
```javascript
// Check sample size before proceeding
if (n_runs < 3) {
  Write("analysis-report.md", `
# Statistical Analysis Report

## ⚠️ CRITICAL ERROR: Insufficient Sample Size

**Sample size**: ${n_runs} runs
**Minimum required**: 3 runs
**Status**: FAIL

### Issue
Statistical tests require a minimum of 3 independent runs to compute meaningful statistics. With fewer than 3 runs:
- Standard deviation cannot be reliably estimated
- Confidence intervals are undefined or unreliable
- Hypothesis tests lack statistical power
- Effect sizes are unstable

### Recommendation
1. **Immediate**: Run at least 3 independent experiments with different random seeds
2. **Preferred**: Run 5-10 independent experiments for robust statistics
3. **Best practice**: Run 10+ experiments for high-stakes claims (e.g., SOTA comparisons)

### Cannot Proceed
This workflow cannot continue with n < 3. Please collect additional experimental runs.
  `)

  // Mark phase as failed and stop
  update_plan: Mark Phase 2 as "blocked" with reason "Insufficient sample size (n < 3)"
  return // Stop execution
}

// If n >= 3, proceed with descriptive statistics
```

For each model, dataset, and metric combination, compute:

```
Mean:                mu = sum(x) / n
Standard Deviation:  SD = sqrt(sum((x - mu)^2) / (n - 1))
Standard Error:      SE = SD / sqrt(n)
95% Confidence Interval: CI = mu +/- t(alpha/2, n-1) * SE
```

**Sample size warnings**:
- n = 3: Minimum viable, but results are unstable. Report with caution.
- n = 4-5: Acceptable for preliminary results. Consider additional runs for final paper.
- n >= 5: Good statistical power for most comparisons.
- n >= 10: Robust statistics, recommended for high-stakes claims.

**Reporting format** (based on workflowPreferences.errorFormat):
- `sd`: "85.3% +/- 2.1% (SD, N runs)"
- `se`: "85.3% +/- 0.7% (SE, N runs)"
- `ci`: "85.3% [95% CI: 83.9%, 86.7%]"

Output table structure:
```
| Model | Dataset | Metric | N | Mean | SD | SE | 95% CI |
|-------|---------|--------|---|------|----|----|--------|
```

## Step 2.2: Pre-Tests (Assumption Verification)

**CRITICAL**: These tests MUST be run before selecting parametric vs non-parametric tests.

### Normality Test (Shapiro-Wilk)

```
For each group (model x dataset x metric):
  Run Shapiro-Wilk test
  - H0: Data follows normal distribution
  - If p > 0.05: Accept normality assumption
  - If p <= 0.05: Reject normality, flag for non-parametric testing

  Record: W statistic, p-value, decision
```

**Sample size considerations**:
- n < 50: Use Shapiro-Wilk (most powerful for small samples)
- n >= 50: Use Kolmogorov-Smirnov
- Always: Supplement with Q-Q plot visual inspection

### Homogeneity of Variance (Levene Test)

```
For each comparison group set:
  Run Levene test
  - H0: All groups have equal variance
  - If p > 0.05: Accept homogeneity assumption
  - If p <= 0.05: Reject homogeneity, flag for Welch's variants

  Record: F statistic, p-value, decision
```

### Pre-Test Decision Matrix

```
Normality: PASS + Variance: PASS  -> Use parametric tests (t-test, ANOVA)
Normality: PASS + Variance: FAIL  -> Use Welch's variants (Welch's t-test, Welch's ANOVA)
Normality: FAIL                   -> Use non-parametric tests (Wilcoxon, Mann-Whitney, Kruskal-Wallis)
```

### Pre-Test Reporting Template

```
"Prior to parametric testing, we verified normality using Shapiro-Wilk test
(Model A: W = [W], p = [p]; Model B: W = [W], p = [p]) and homogeneity of
variance using Levene's test (F = [F], p = [p]). [All tests satisfied /
Normality was violated for...] parametric test assumptions."
```

## Step 2.3: Hypothesis Testing

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 2.1 -- 2.5) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/02-statistical-analysis.md")` now.

Select tests based on pre-test results and data structure:

### Test Selection Flow

```
Data type?
  |
  Paired data? (same datasets, multiple models)
  | YES:
  |   Two groups?
  |   | YES:
  |   |   Normal? -> Paired t-test
  |   |   Not normal? -> Wilcoxon signed-rank test
  |   | NO (3+ groups):
  |   |   Normal? -> Repeated measures ANOVA + post-hoc (Tukey HSD)
  |   |   Not normal? -> Friedman test + post-hoc (Nemenyi)
  |
  | NO (independent data):
  |   Two groups?
  |   | YES:
  |   |   Normal + equal variance? -> Independent t-test
  |   |   Normal + unequal variance? -> Welch's t-test
  |   |   Not normal? -> Mann-Whitney U test
  |   | NO (3+ groups):
  |   |   Normal + equal variance? -> One-way ANOVA + post-hoc (Tukey HSD)
  |   |   Normal + unequal variance? -> Welch's ANOVA + Games-Howell
  |   |   Not normal? -> Kruskal-Wallis + Dunn test
```

### Parametric Tests

**Independent t-test**:
- H0: mu1 = mu2 (means are equal)
- Report: "Method A (85.3% +/- 2.1%) significantly outperformed Method B (82.1% +/- 1.8%), t(df) = [t], p = [p]"

**Paired t-test**:
- H0: mu_d = 0 (mean difference is zero)
- Report: "Across N datasets, Method A significantly outperformed Method B, t(df) = [t], p = [p]"

**Welch's t-test** (unequal variances):
- Report: "Welch's t(df) = [t], p = [p]"

**One-way ANOVA**:
- H0: mu1 = mu2 = ... = muk (all means equal)
- Report: "Significant differences found among methods, F(df1, df2) = [F], p = [p]"
- IMPORTANT: ANOVA only tells you "at least one group differs" -- must follow with post-hoc tests

**Post-hoc tests** (after significant ANOVA):
- Tukey HSD: Default choice, controls family-wise error rate
- Dunnett: When comparing multiple methods against one baseline
- Bonferroni: Most conservative

### Non-Parametric Tests

**Wilcoxon signed-rank test** (paired, 2 groups):
- Report: "Wilcoxon signed-rank test: Z = [Z], p = [p]"

**Mann-Whitney U test** (independent, 2 groups):
- Report: "Mann-Whitney U test: U = [U], p = [p]"

**Kruskal-Wallis test** (independent, 3+ groups):
- Report: "Kruskal-Wallis test: H(df) = [H], p = [p]"
- Post-hoc: Dunn test with Bonferroni correction

**Friedman test** (paired, 3+ groups):
- Report: "Friedman test: chi-squared(df) = [chi2], p = [p]"
- Post-hoc: Nemenyi test or Wilcoxon with Bonferroni

## Step 2.4: Effect Size Calculation

Always calculate effect sizes alongside p-values:

```
Cohen's d (for t-tests):
  d = (mean1 - mean2) / pooled_SD
  Interpretation: |d| < 0.2 small, 0.2-0.5 medium, 0.5-0.8 large, >= 0.8 very large

Eta-squared (for ANOVA):
  eta2 = SS_between / SS_total
  Interpretation: 0.01 small, 0.06 medium, 0.14 large

r (for non-parametric):
  r = Z / sqrt(N)
  Interpretation: 0.1 small, 0.3 medium, 0.5 large
```

**Reporting**: MUST report both p-value AND effect size for every comparison.

Example: "Our method significantly outperformed the baseline (t(8) = 5.67, p < 0.001, Cohen's d = 2.13, large effect)"

## Step 2.5: Multiple Comparison Correction

When running k pairwise comparisons:

```
Problem: P(at least one false positive) = 1 - (1 - alpha)^k
  Example: 10 comparisons at alpha=0.05 -> 40% chance of at least one false positive

Correction methods:
  Bonferroni:          alpha' = alpha / k  (most conservative)
  Holm-Bonferroni:     Step-down procedure  (less conservative)
  FDR (Benjamini-Hochberg): Controls false discovery rate (for exploratory analysis)
```

**Selection guide**:
- Few comparisons (< 10): Bonferroni
- Moderate comparisons (10-50): Holm-Bonferroni
- Many comparisons (> 50, exploratory): FDR

**Reporting template**:
```
"After Bonferroni correction (alpha' = 0.05/[k] = [alpha']), [all/N of M]
comparisons remained significant."
```

## Output

- **Variable**: `statisticalResults` -- complete statistical analysis including:
  - Descriptive statistics table
  - Pre-test results (normality, variance homogeneity)
  - Hypothesis test results (test statistic, df, p-value)
  - Effect sizes (Cohen's d / eta-squared / r)
  - Multiple comparison correction results
  - Test selection rationale
- **update_plan**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 3: Visualization](03-visualization.md).
