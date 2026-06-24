---
name: scholar-experiment
description: Systematic experimental results analysis workflow for ML/AI research papers. Connects experimental data to publication-ready Results sections with statistical validation, visualizations, and quality checks. Triggers on "analyze experimental results", "generate results section", "statistical analysis of experiments", "compare model performance", "create results visualization".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, TodoWrite
---

# Scholar Experiment: Results Analysis Workflow

A systematic workflow for analyzing ML/AI experimental results and generating publication-ready Results sections. Transforms raw experimental data into validated statistical analyses, publication-quality visualizations, and well-structured paper content.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
                     scholar-experiment
                           |
     ┌─────────────────────┼─────────────────────┐
     |                     |                       |
  [User Input]    [Experiment Context]    [Preferences]
     |                     |                       |
     └─────────┬───────────┘                       |
               v                                   |
┌──────────────────────────┐                       |
│  Phase 1: Data Loading   │ <─ preferences ───────┘
│  Load, validate, inspect │
└────────────┬─────────────┘
             │ cleanedData, dataProfile
             v
┌──────────────────────────┐
│  Phase 2: Statistical    │
│  Analysis & Testing      │
└────────────┬─────────────┘
             │ statisticalResults
             v
┌──────────────────────────┐
│  Phase 3: Visualization  │
│  Plots, charts, tables   │
└────────────┬─────────────┘
             │ figureSpecs, tableSpecs
             v
┌──────────────────────────┐
│  Phase 4: Results Writing│
│  Draft Results section   │
└────────────┬─────────────┘
             │ resultsDraft
             v
┌──────────────────────────┐
│  Phase 5: Quality Check  │
│  Validate & verify       │
└──────────────────────────┘
             │
             v
        [Output Files]
        - analysis-report.md
        - results-draft.md
        - visualization-specs.md
```

## Key Design Principles

1. **Statistical rigor first**: Every claim must be backed by appropriate statistical tests with complete reporting (mean, SD/SE, p-value, effect size)
2. **Pre-test before test**: Always check assumptions (normality, variance homogeneity) before selecting parametric vs non-parametric tests
3. **Publication-quality output**: All visualizations must meet journal standards (vector format, colorblind-friendly, proper error representation)
4. **Complete reporting**: Never report p-values alone — always include effect sizes, confidence intervals, and descriptive statistics
5. **No cherry-picking**: Report all planned comparisons, not just significant results
6. **Reproducibility**: Document all analysis steps, parameters, and random seeds

## Statistical Tools and Libraries

This workflow requires statistical computing capabilities. Recommended implementations:

**Python Stack** (recommended for ML/AI research):
```python
import numpy as np              # Numerical computing
import pandas as pd             # Data manipulation
import scipy.stats as stats     # Statistical tests
import matplotlib.pyplot as plt # Visualization
import seaborn as sns           # Statistical visualization
from statsmodels.stats import multitest  # Multiple comparison corrections
```

**R Stack** (alternative for advanced statistics):
```r
library(tidyverse)  # Data manipulation and visualization
library(stats)      # Statistical tests
library(effsize)    # Effect size calculations
library(multcomp)   # Multiple comparisons
```

**Minimum Requirements**:
- Statistical test functions (t-test, ANOVA, Mann-Whitney, Kruskal-Wallis, etc.)
- Effect size calculations (Cohen's d, eta-squared, r)
- Multiple comparison corrections (Bonferroni, Holm, FDR)
- Normality tests (Shapiro-Wilk, Kolmogorov-Smirnov)
- Variance homogeneity tests (Levene's test)

**Note**: If these libraries are not available, the workflow will guide you to use online statistical calculators or manual computation, but automated analysis is strongly recommended for reproducibility.
2. **Pre-test before test**: Always verify assumptions (normality, homogeneity of variance) before selecting parametric tests
3. **No cherry-picking**: Report all experimental runs, not just the best ones
4. **Publication-quality output**: All visualizations follow colorblind-friendly, vector-format, error-bar standards
5. **Reproducibility**: Track random seeds, hyperparameter ranges, compute resources, and experimental setup

## Interactive Preference Collection

Before dispatching to phases, collect analysis preferences:

```javascript
const prefResponse = AskUserQuestion({
  question: "How would you like to configure the analysis?",
  options: [
    {
      label: "Analysis Type",
      description: "Select the type of analysis",
      choices: [
        { value: "full", label: "Full Analysis", description: "Complete pipeline: stats + visualization + writing" },
        { value: "comparison", label: "Model Comparison", description: "Focus on comparing multiple models/methods" },
        { value: "ablation", label: "Ablation Study", description: "Focus on component contribution analysis" },
        { value: "visualization", label: "Visualization Only", description: "Generate visualization specs only" }
      ]
    },
    {
      label: "Statistical Reporting",
      description: "Choose error reporting format",
      choices: [
        { value: "sd", label: "Standard Deviation (SD)", description: "Report mean +/- SD (describes data variability)" },
        { value: "se", label: "Standard Error (SE)", description: "Report mean +/- SE (describes mean uncertainty)" },
        { value: "ci", label: "95% Confidence Interval", description: "Report mean [95% CI: low, high]" }
      ]
    },
    {
      label: "Visualization Style",
      description: "Choose visualization palette",
      choices: [
        { value: "okabe-ito", label: "Okabe-Ito (Recommended)", description: "Most widely used colorblind-friendly palette" },
        { value: "paul-tol", label: "Paul Tol", description: "Alternative colorblind-friendly palette" }
      ]
    }
  ]
});

const workflowPreferences = {
  analysisType: prefResponse.analysisType || "full",
  errorFormat: prefResponse.statisticalReporting || "sd",
  colorPalette: prefResponse.visualizationStyle || "okabe-ito"
};
```

## Auto Mode Defaults

When user provides explicit analysis type (e.g., `/scholar-experiment comparison`):
- `analysisType`: from argument
- `errorFormat`: "sd" (standard deviation)
- `colorPalette`: "okabe-ito"

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase -- preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### Phase 1: Data Loading
Load experimental data, validate format, perform initial inspection.
- Ref: phases/01-data-loading.md
- Input: raw data files (CSV, JSON, TensorBoard logs, pickle), experiment context
- Output: `cleanedData`, `dataProfile` (format, dimensions, completeness, outlier flags)

### Phase 2: Statistical Analysis
Compute descriptive statistics, run pre-tests, perform hypothesis testing, calculate effect sizes.
- Ref: phases/02-statistical-analysis.md
- Input: `cleanedData`, `dataProfile`, `workflowPreferences`
- Output: `statisticalResults` (descriptive stats, test results, effect sizes, multiple comparison corrections)

### Phase 3: Visualization
Generate visualization specifications for publication-quality figures and tables.
- Ref: phases/03-visualization.md
- Input: `cleanedData`, `statisticalResults`, `workflowPreferences`
- Output: `figureSpecs`, `tableSpecs`, `visualization-specs.md`

### Phase 4: Results Writing
Draft the Results section with proper statistical reporting and figure/table references.
- Ref: phases/04-results-writing.md
- Input: `statisticalResults`, `figureSpecs`, `tableSpecs`, `workflowPreferences`
- Output: `resultsDraft`, `results-draft.md`

### Phase 5: Quality Check
Validate analysis completeness, check reproducibility, verify statistical reporting.
- Ref: phases/05-quality-check.md
- Input: all prior outputs
- Output: `analysis-report.md` (final validated report), quality checklist

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-data-loading.md](phases/01-data-loading.md) | Load and validate data | TodoWrite driven |
| 2 | [phases/02-statistical-analysis.md](phases/02-statistical-analysis.md) | Statistical testing | TodoWrite driven + sentinel |
| 3 | [phases/03-visualization.md](phases/03-visualization.md) | Figure/table specs | TodoWrite driven |
| 4 | [phases/04-results-writing.md](phases/04-results-writing.md) | Draft Results section | TodoWrite driven + sentinel |
| 5 | [phases/05-quality-check.md](phases/05-quality-check.md) | Validate and verify | TodoWrite driven |

**Compact Rules**:
1. **TodoWrite `in_progress`** -> preserve full content, do not compress
2. **TodoWrite `completed`** -> may compress to summary
3. **sentinel fallback** -> phases marked with sentinel contain compact sentinel; if after compact only sentinel remains without full Step protocol, MUST immediately `Read("phases/0N-xxx.md")` to recover before continuing

## Core Rules

1. **Never skip pre-tests**: Always run normality (Shapiro-Wilk) and homogeneity of variance (Levene) tests before parametric testing
2. **Report completely**: Every statistical result must include test statistic, degrees of freedom, p-value, and effect size
3. **Correct for multiple comparisons**: When running multiple tests, apply Bonferroni or FDR correction
4. **Use appropriate tests**: Select parametric or non-parametric tests based on pre-test results
5. **Vector format only**: All figure specs must target PDF/EPS output format
6. **Colorblind-friendly**: All visualizations must use Okabe-Ito or Paul Tol palettes
7. **Honest reporting**: Report all runs including negative results; never cherry-pick

## Input Processing

User provides data path and optional analysis type:

```
USER INPUT: [data_path] [analysis_type?]

Structured format:
  DATA_PATH: path/to/results/ or path/to/results.csv
  ANALYSIS_TYPE: full | comparison | ablation | visualization
  EXPERIMENT_CONTEXT: (read from experiment session if available)
```

Supported data formats:
- CSV files: tabular data with headers
- JSON files: structured results objects
- TensorBoard logs: training curves
- Python pickle: complex objects

## Data Flow

```
Phase 1 output:
  cleanedData    → Phase 2, 3
  dataProfile    → Phase 2

Phase 2 output:
  statisticalResults → Phase 3, 4, 5

Phase 3 output:
  figureSpecs    → Phase 4, 5
  tableSpecs     → Phase 4, 5

Phase 4 output:
  resultsDraft   → Phase 5

Phase 5 output:
  analysis-report.md      (final report)
  results-draft.md        (paper-ready text)
  visualization-specs.md  (figure specifications)
```

## TodoWrite Pattern

```
Phase starts:
  -> Sub-tasks ATTACHED to TodoWrite (in_progress + pending)
  -> Execute sub-tasks sequentially

Phase ends:
  -> Sub-tasks COLLAPSED back to high-level summary (completed)
  -> Next phase begins
```

Example:
```
[x] Phase 1: Data Loading (completed - 3 datasets loaded, validated)
[ ] Phase 2: Statistical Analysis (in_progress)
    [ ] 2.1 Descriptive statistics
    [ ] 2.2 Pre-tests (normality, variance)
    [ ] 2.3 Hypothesis testing
    [ ] 2.4 Effect size calculation
    [ ] 2.5 Multiple comparison correction
[ ] Phase 3: Visualization
[ ] Phase 4: Results Writing
[ ] Phase 5: Quality Check
```

## Error Handling

| Error | Recovery |
|-------|----------|
| Data format unreadable | Ask user for format clarification, try alternative parsers |
| Sample size too small (< 3 runs) | Warn user, proceed with non-parametric tests, note limitation |
| Normality assumption violated | Switch to non-parametric tests (Wilcoxon, Mann-Whitney U, Kruskal-Wallis) |
| Variance homogeneity violated | Switch to Welch's t-test or Welch's ANOVA |
| Missing values detected | Report percentage, suggest imputation or exclusion strategy |
| Outliers detected | Report via IQR method, run sensitivity analysis (with/without outliers) |

## Coordinator Checklist

**Before each phase**:
- [ ] Previous phase output available
- [ ] TodoWrite updated (current phase in_progress)
- [ ] Phase document read via `Read("phases/0N-xxx.md")`

**After each phase**:
- [ ] Output files generated
- [ ] TodoWrite updated (current phase completed, next phase in_progress)
- [ ] Data flow variables passed to next phase

**After all phases**:
- [ ] All output files present (analysis-report.md, results-draft.md, visualization-specs.md)
- [ ] Quality checklist completed
- [ ] User notified of results

## Related Skills

- **scholar-writing**: Integrates results-draft.md into full paper structure
- **scholar-review**: Reviews the Results section for quality and completeness
