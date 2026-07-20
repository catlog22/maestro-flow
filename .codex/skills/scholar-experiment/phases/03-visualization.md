
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 3: Visualization

Generate visualization specifications for publication-quality figures and formatted tables suitable for academic papers.

## Objective

- Design publication-quality figure specifications (chart type, data, style)
- Generate formatted table specifications for performance comparisons and ablation studies
- Ensure all visualizations are colorblind-friendly, vector-format ready, and include error representation
- Produce visualization-specs.md with complete specifications for each figure and table

## Step 3.1: Determine Required Visualizations

Based on analysis type and available data, select which visualizations to generate:

```
analysisType = workflowPreferences.analysisType

IF analysisType == "full":
  - Performance comparison table (all models x all datasets x all metrics)
  - Performance comparison bar chart
  - Training curves (if temporal data available)
  - Ablation table (if ablation data available)
  - Ablation bar chart
  - Hyperparameter sensitivity plot (if sweep data available)

IF analysisType == "comparison":
  - Performance comparison table
  - Performance comparison bar chart
  - Training curves (if temporal data available)
  - Statistical significance summary table

IF analysisType == "ablation":
  - Ablation table with delta column
  - Ablation bar chart with performance drop annotations
  - Component contribution waterfall chart (optional)

IF analysisType == "visualization":
  - All applicable chart types based on data structure
```

## Step 3.2: Table Specifications

### Performance Comparison Table

```markdown
**Table N**: Model performance comparison on [dataset(s)]. Values are mean +/- [SD/SE]
across [N] runs. Best results in bold. [up-arrow] higher is better, [down-arrow] lower is better.

| Method | Metric1 [up-arrow] | Metric2 [up-arrow] | Metric3 [down-arrow] |
|--------|---------------------|---------------------|----------------------|
| Baseline A | 82.1 +/- 1.8 | 79.3 +/- 2.1 | 45ms |
| Baseline B | 84.2 +/- 1.5 | 81.7 +/- 1.9 | 42ms |
| **Ours** | **85.3 +/- 2.1** | **83.5 +/- 2.0** | **38ms** |
```

**Table design rules**:
- Bold the best result in each column
- Use arrows to indicate metric direction (higher/lower is better)
- Include error bars (SD, SE, or CI based on preferences)
- Right-align numeric columns
- Include run count in caption

### Ablation Study Table

```markdown
**Table N**: Ablation study results. Delta shows performance change relative to full model.

| Configuration | Metric1 | Metric2 | Delta |
|--------------|---------|---------|-------|
| Full Model | 93.5 | 92.8 | - |
| w/o Component A | 91.2 | 90.5 | -2.3 |
| w/o Component B | 92.1 | 91.3 | -1.4 |
| w/o Component C | 90.8 | 89.9 | -2.7 |
```

**Ablation table rules**:
- First row is always the full model
- Each subsequent row removes exactly one component
- Delta column shows difference from full model
- Order by delta magnitude (largest contribution first) or alphabetically

### Statistical Significance Table

```markdown
**Table N**: Pairwise statistical comparisons. Pre-tests: normality (Shapiro-Wilk),
variance homogeneity (Levene). Corrections: Bonferroni (alpha' = [value]).

| Comparison | Test | Statistic | p-value | Effect Size | Significant |
|-----------|------|-----------|---------|-------------|-------------|
| Ours vs Baseline A | Paired t-test | t(8)=5.67 | <0.001 | d=2.13 | Yes |
| Ours vs Baseline B | Paired t-test | t(8)=3.21 | 0.012 | d=1.05 | Yes |
```

## Step 3.3: Figure Specifications

### Color Palette Configuration

```
IF workflowPreferences.colorPalette == "okabe-ito":
  colors = {
    orange:  "#E69F00",
    skyBlue: "#56B4E9",
    green:   "#009E73",
    yellow:  "#F0E442",
    blue:    "#0072B2",
    red:     "#D55E00",
    pink:    "#CC79A7",
    black:   "#000000"
  }
  // Assignment: Ours = blue, Baseline1 = orange, Baseline2 = skyBlue, ...

IF workflowPreferences.colorPalette == "paul-tol":
  // Use Paul Tol bright qualitative palette
  colors = { blue: "#4477AA", cyan: "#66CCEE", green: "#228833",
             yellow: "#CCBB44", red: "#EE6677", purple: "#AA3377", grey: "#BBBBBB" }
```

### Common Figure Properties

```
Format:      PDF (vector)
Font:        Times New Roman or Computer Modern
Font sizes:  axis labels 10-12pt, tick labels 8-10pt, legend 8-10pt
Line width:  1.5-2.0 pt
Marker size: 4-6 pt
Grid:        alpha=0.3, light gray
DPI:         N/A (vector format)
```

### Performance Comparison Bar Chart

```yaml
Figure:
  type: bar_chart
  title: null  # Use caption instead
  size: [7, 3.5]  # inches, double-column width
  x_axis:
    label: "Dataset"
    categories: [dataset_names]
  y_axis:
    label: "Accuracy (%)"
    range: [0, 100]  # Start from 0 unless justified
  series:
    - name: "Baseline A"
      values: [mean_per_dataset]
      error: [sd_per_dataset]
      color: colors.orange
    - name: "Baseline B"
      values: [mean_per_dataset]
      error: [sd_per_dataset]
      color: colors.skyBlue
    - name: "Ours"
      values: [mean_per_dataset]
      error: [sd_per_dataset]
      color: colors.blue
  error_bars: true
  bar_width: 0.25
  bar_gap: 0.05
  legend: { position: "upper right", frameon: false }
  caption: >
    Performance comparison of [N] models on [M] datasets.
    Error bars represent [SD/SE] across [K] runs.
    Our method significantly outperforms all baselines (p < [threshold]).
  save_as: "figures/performance_comparison.pdf"
```

### Training Curve (Line Plot)

```yaml
Figure:
  type: line_plot
  size: [3.5, 2.5]  # inches, single-column
  x_axis:
    label: "Epoch"
    range: [1, max_epoch]
  y_axis:
    label: "Validation Accuracy (%)"
  series:
    - name: "Baseline A"
      values: [epoch_means]
      error_band: [epoch_sds]  # Shaded region, alpha=0.2
      color: colors.orange
      linestyle: "dashed"
    - name: "Ours"
      values: [epoch_means]
      error_band: [epoch_sds]
      color: colors.blue
      linestyle: "solid"
  error_representation: "band"  # Shaded band, NOT error bars
  legend: { position: "lower right" }
  grid: { alpha: 0.3 }
  caption: >
    Training curves on [dataset]. Shaded regions represent [SD/SE]
    across [K] runs. Our method converges in [X] epochs vs [Y] for baseline.
  save_as: "figures/training_curve.pdf"
```

### Ablation Bar Chart

```yaml
Figure:
  type: bar_chart
  size: [3.5, 2.5]  # single-column
  x_axis:
    label: "Configuration"
    categories: ["Full", "w/o A", "w/o B", "w/o C"]
  y_axis:
    label: "Average Accuracy (%)"
    range: [0, 100]
  series:
    - name: "Performance"
      values: [full, wo_a, wo_b, wo_c]
      color: [colors.blue, colors.orange, colors.orange, colors.orange]
  annotations:
    - text: "Delta -2.3"  # Performance drop annotations
      position: above_bar
  caption: >
    Ablation study results. Each bar shows mean accuracy with one
    component removed. Numbers indicate performance change from full model.
  save_as: "figures/ablation.pdf"
```

### Hyperparameter Sensitivity Curve

```yaml
Figure:
  type: line_plot
  size: [3.5, 2.5]
  x_axis:
    label: "Learning Rate"
    scale: "log"  # Logarithmic scale for learning rate
  y_axis:
    label: "Average Accuracy (%)"
  series:
    - name: "Sensitivity"
      values: [lr_sweep_means]
      error_band: [lr_sweep_sds]
      color: colors.blue
      markers: true
  annotations:
    - text: "Optimal"
      position: at_peak
  caption: >
    Hyperparameter sensitivity analysis for learning rate.
    Shaded region represents [SD/SE] across [K] runs.
    Optimal learning rate: [value].
  save_as: "figures/lr_sensitivity.pdf"
```

## Step 3.4: Visualization Quality Checklist

Before finalizing specs, verify each figure meets publication standards:

```
For each figure specification:
  [ ] Vector format (PDF/EPS) specified
  [ ] Colorblind-friendly palette (Okabe-Ito or Paul Tol)
  [ ] Error representation included (bars or bands)
  [ ] Caption is self-contained and complete
  [ ] Caption specifies error type (SD/SE/CI)
  [ ] Axis labels include units
  [ ] Font sizes >= 8pt
  [ ] Line width >= 1.5pt
  [ ] Y-axis starts from 0 (or truncation justified)
  [ ] Legend does not obscure data
  [ ] Maximum 5-7 series per figure
  [ ] Black-and-white readability (different line styles if needed)
```

## Step 3.5: Generate visualization-specs.md

Compile all specifications into a single document:

```markdown
# Visualization Specifications

## Color Palette: [Okabe-Ito / Paul Tol]
[Color assignments for each model/method]

## Figures

### Figure 1: [Title]
[Full YAML specification]

### Figure 2: [Title]
[Full YAML specification]

...

## Tables

### Table 1: [Title]
[Full markdown table]

### Table 2: [Title]
[Full markdown table]

...

## Python Code Templates

### Bar Chart Template
[matplotlib code for generating the bar chart]

### Line Plot Template
[matplotlib code for generating the line plot]
```

## Output

- **Variable**: `figureSpecs` -- list of figure specifications with data, style, and captions
- **Variable**: `tableSpecs` -- list of formatted table specifications with captions
- **File**: `visualization-specs.md` -- complete visualization specification document
- **update_plan**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 4: Results Writing](04-results-writing.md).
