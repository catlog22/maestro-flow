
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 5: Quality Check

Validate the complete analysis pipeline output: verify statistical rigor, check reproducibility information, confirm visualization standards, and ensure the Results draft meets publication requirements.

## Objective

- Validate all statistical analyses for correctness and completeness
- Check reproducibility information (seeds, hyperparameters, compute resources)
- Verify visualization specifications meet publication standards
- Confirm Results draft follows academic writing conventions
- Generate final analysis-report.md with quality assessment
- Produce actionable quality checklist with pass/warn/fail status

## Step 5.1: Statistical Rigor Check

Review all statistical results from Phase 2:

### Completeness Checklist

```
For each comparison reported:
  [ ] Mean value reported
  [ ] Error measure reported (SD/SE/CI -- explicitly labeled)
  [ ] Sample size (number of runs) stated
  [ ] Pre-test results reported:
      [ ] Normality test (Shapiro-Wilk): W statistic, p-value
      [ ] Variance homogeneity (Levene): F statistic, p-value
  [ ] Hypothesis test reported:
      [ ] Test name stated
      [ ] Test statistic with degrees of freedom
      [ ] p-value (exact or threshold)
  [ ] Effect size reported:
      [ ] Measure type (Cohen's d / eta-squared / r)
      [ ] Value and interpretation (small/medium/large)
  [ ] Multiple comparison correction applied (if multiple tests):
      [ ] Correction method stated (Bonferroni / Holm / FDR)
      [ ] Corrected threshold stated
      [ ] Post-correction significance noted
```

### Common Statistical Errors to Check

```
ERROR CHECK 1: Cherry-picking
  - Verify ALL experimental runs are reported (not just best)
  - Check that number of runs matches across all models
  - Flag if only subset of datasets/metrics reported without justification

ERROR CHECK 2: SD vs SE confusion
  - Verify consistent labeling throughout
  - Check that error type matches caption descriptions
  - Confirm correct formula used (SE = SD / sqrt(n))

ERROR CHECK 3: Wrong test selection
  - Verify pre-test results justify chosen test (parametric vs non-parametric)
  - Check degrees of freedom match sample sizes
  - Verify paired vs independent test matches data structure

ERROR CHECK 4: Missing multiple comparison correction
  - Count total number of pairwise comparisons
  - Verify correction applied if comparisons > 1
  - Check corrected alpha is correctly calculated

ERROR CHECK 5: p-value without effect size
  - Every p-value must have accompanying effect size
  - Effect size interpretation must be stated
```

## Step 5.2: Reproducibility Check

Verify all information needed for experiment reproduction is documented:

```
Reproducibility Information:
  [ ] Random seeds listed (specific values, e.g., {42, 123, 456, 789, 1024})
  [ ] Number of experimental runs stated
  [ ] Hardware specified (GPU type, count, memory)
  [ ] Training time reported (wall clock and/or GPU-hours)
  [ ] Hyperparameters documented:
      [ ] Learning rate (and search range if tuned)
      [ ] Batch size
      [ ] Number of epochs / early stopping criteria
      [ ] Optimizer and its parameters
      [ ] Model-specific hyperparameters
  [ ] Hyperparameter search method stated (grid/random/Bayesian)
  [ ] Hyperparameter search range provided
  [ ] Dataset splits described (train/val/test sizes)
  [ ] Preprocessing steps documented
  [ ] Software versions noted (framework, libraries)
  [ ] Code availability mentioned (or planned)
```

## Step 5.3: Visualization Quality Check

Review all figure and table specifications from Phase 3:

```
For each figure:
  [ ] Vector format specified (PDF/EPS)
  [ ] Colorblind-friendly palette used (Okabe-Ito or Paul Tol)
  [ ] Error representation included:
      [ ] Bar charts: error bars
      [ ] Line plots: error bands (shaded regions)
  [ ] Error type stated in caption (SD/SE/CI)
  [ ] Caption is self-contained (understandable without reading main text)
  [ ] Caption includes: what is shown, experimental conditions, key observation
  [ ] Axis labels present with units
  [ ] Font sizes >= 8pt
  [ ] Line widths >= 1.5pt
  [ ] Y-axis range appropriate (starts from 0 unless justified)
  [ ] Legend does not obscure data points
  [ ] Black-and-white readability ensured (different line styles)
  [ ] Figure size matches column format (single: 3.5", double: 7")

For each table:
  [ ] Best results bolded
  [ ] Direction indicators present (up-arrow/down-arrow for metrics)
  [ ] Error measures included
  [ ] Caption describes table content, run count, error type
  [ ] Numeric columns right-aligned
  [ ] Consistent decimal places
```

## Step 5.4: Writing Quality Check

Review the Results draft from Phase 4:

```
Structure Check:
  [ ] Clear section organization (overview -> setup -> results -> ablation -> analysis)
  [ ] Every experiment has stated purpose (what hypothesis it tests)
  [ ] Logical flow between subsections

Content Check:
  [ ] Every figure/table referenced at least once in text
  [ ] References guide reader observation (not just "see Figure N")
  [ ] All numeric claims have error measures
  [ ] All comparisons have complete statistical reporting
  [ ] Pre-test results reported before parametric test results

Tone Check:
  [ ] Objective language throughout (no "best ever", "proves")
  [ ] Results qualified to tested scope ("on the N datasets tested")
  [ ] Interpretations use hedging ("suggests", "indicates")
  [ ] Limitations acknowledged
  [ ] Negative results reported honestly (if any)

Consistency Check:
  [ ] Numbers match between text, tables, and figures
  [ ] Error format consistent throughout (all SD or all SE, not mixed)
  [ ] Model names consistent throughout
  [ ] Metric names consistent throughout
```

## Step 5.5: Generate analysis-report.md

Compile the complete analysis report:

```markdown
# Experimental Results Analysis Report

**Project**: [Project name]
**Analysis Date**: [Date]
**Analysis Type**: [full/comparison/ablation/visualization]

---

## Executive Summary

[2-3 sentences summarizing key findings, statistical significance, and practical implications]

---

## 1. Experimental Setup

### Datasets
[Table: dataset name, size, classes, domain]

### Models
[Brief description of each model/method compared]

### Training Configuration
[Key hyperparameters, hardware, random seeds, run count]

---

## 2. Statistical Summary

### Descriptive Statistics
[Full table: model x dataset x metric with mean +/- error]

### Statistical Significance Tests
[Pre-test results, hypothesis test results, effect sizes, corrections]

---

## 3. Key Findings

[Numbered list of key findings with supporting statistics]

---

## 4. Ablation Study (if applicable)

[Component contribution table and analysis]

---

## 5. Visualization Specifications

[Summary of figures and tables with file paths]

---

## 6. Quality Assessment

### Statistical Rigor: [PASS / WARN / FAIL]
[Checklist results from Step 5.1]

### Reproducibility: [PASS / WARN / FAIL]
[Checklist results from Step 5.2]

### Visualization Quality: [PASS / WARN / FAIL]
[Checklist results from Step 5.3]

### Writing Quality: [PASS / WARN / FAIL]
[Checklist results from Step 5.4]

### Overall Status: [PASS / WARN / FAIL]

---

## 7. Recommendations

### For Paper Writing
[Specific suggestions for the Results section]

### For Additional Experiments
[Suggested supplementary experiments if needed]

### Limitations to Address
[Known limitations that should be discussed]

---

## Generated Files
- `analysis-report.md` -- This report
- `results-draft.md` -- Paper-ready Results section text
- `visualization-specs.md` -- Complete figure and table specifications
```

## Output

- **File**: `analysis-report.md` -- complete analysis report with quality assessment
- **File**: `results-draft.md` -- confirmed or updated Results draft
- **File**: `visualization-specs.md` -- confirmed visualization specifications
- **update_plan**: Mark Phase 5 completed, all phases completed

## Completion

All phases complete. Notify user of generated output files and overall quality assessment status.
