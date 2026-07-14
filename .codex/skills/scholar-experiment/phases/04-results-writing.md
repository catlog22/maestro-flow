# Phase 4: Results Writing

> **COMPACT SENTINEL [Phase 4: Results Writing]**
> This phase contains 5 execution steps (Step 4.1 -- 4.5).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/04-results-writing.md")`

Draft the Results section of the paper with proper statistical reporting, figure/table references, and structured subsections following academic writing conventions.

## Objective

- Draft a complete Results section structured for academic publication
- Include all statistical information (mean, SD/SE, test statistics, p-values, effect sizes)
- Reference figures and tables generated in Phase 3
- Follow academic writing conventions: objective tone, guided observation, hypothesis-driven structure
- Produce results-draft.md ready for integration into the paper

## Step 4.1: Determine Section Structure

Based on analysis type and available results, structure the Results section:

```
IF analysisType == "full":
  1. Overview of Main Findings (1-2 paragraphs)
  2. Experimental Setup (brief, details in Methods/Appendix)
  3. Performance Comparison (with Table 1 and Figure 1)
  4. Ablation Study (with Table 2 and Figure 2)
  5. Statistical Significance (detailed test results)
  6. Additional Analysis (hyperparameter sensitivity, efficiency)
  7. Qualitative Analysis (case studies, if applicable)

IF analysisType == "comparison":
  1. Overview of Main Findings
  2. Experimental Setup
  3. Performance Comparison (with tables and figures)
  4. Statistical Significance
  5. Efficiency Analysis (if training time data available)

IF analysisType == "ablation":
  1. Overview of Main Findings
  2. Ablation Study Design
  3. Component Contribution Analysis (with table and figure)
  4. Statistical Significance of Component Contributions
```

## Step 4.2: Draft Overview Paragraph

Write 1-2 paragraphs summarizing the core findings:

**Template**:
```markdown
We evaluate [our method] on [N datasets] and compare with [M baseline methods].
[Our method] achieves [best metric value] on [metric], outperforming the strongest
baseline [baseline name] by [improvement] percentage points. [Key secondary finding].
[Ablation study finding, if applicable].
```

**Writing rules**:
- State the main finding in the first sentence
- Quantify improvements with specific numbers
- Mention statistical significance if established
- Keep to 1-2 paragraphs maximum
- Do NOT over-interpret -- stick to what the data shows

## Step 4.3: Draft Main Results Subsections

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 4.1 -- 4.5) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/04-results-writing.md")` now.

### Performance Comparison Subsection

**Structure**:
1. Introduce the experiment purpose: "To evaluate [what], we conducted [experiment]"
2. Reference the table: "Table N shows [what]"
3. State main finding: "[Our method] achieves [value], outperforming..."
4. Guide reader observation: "Notably, [specific observation]"
5. Report statistical significance with full details
6. Reference figure: "Figure N illustrates [what trend]"

**Statistical reporting format**:
```
Complete format (required for each comparison):
  "[Method A] ([value] +/- [error]) significantly outperformed [Method B]
  ([value] +/- [error]), [test name], [statistic](df) = [value], p = [value],
  [effect size measure] = [value] ([interpretation])."

Example:
  "Our method (93.5% +/- 1.3%) significantly outperformed BERT-base
  (91.3% +/- 1.2%), paired t-test, t(8) = 3.21, p = 0.012,
  Cohen's d = 1.05 (large effect)."
```

**Pre-test reporting** (include before parametric test results):
```
"Prior to parametric testing, we verified normality using Shapiro-Wilk test
(Model A: W = [W], p = [p]; Model B: W = [W], p = [p]) and homogeneity of
variance using Levene's test (F = [F], p = [p]). All tests satisfied
parametric test assumptions."
```

**Multiple comparison reporting**:
```
"After Bonferroni correction (alpha' = [corrected value]), [all/N of M]
pairwise comparisons remained statistically significant."
```

### Ablation Study Subsection

**Structure**:
1. State purpose: "To validate the contribution of each component, we conducted ablation experiments"
2. Reference table: "Table N shows [what]"
3. Rank components by contribution: "[Component X] contributes most (+/-[delta]), followed by..."
4. Explain each component's role: "This suggests that [component] is important because..."
5. Reference figure if available

**Template**:
```markdown
To validate the contribution of each component, we conducted ablation experiments
by removing one component at a time. Table [N] shows the results. [Component A]
contributes the most to performance, with removal causing a [delta]% decrease.
This is followed by [Component B] (-[delta]%) and [Component C] (-[delta]%).
These results confirm that all components are necessary for achieving optimal
performance, with [Component A] playing the most critical role in [explanation].
```

### Efficiency Analysis Subsection (if applicable)

```markdown
Table [N] compares training efficiency across models. Our method requires
[time] hours ([GPU-hours] GPU-hours), representing a [X]% reduction compared
to [baseline]. This improvement is attributed to [reason]. Despite the additional
computational cost compared to [simpler baseline], the [improvement]% performance
gain justifies the trade-off.
```

## Step 4.4: Apply Writing Quality Rules

Check every paragraph against these rules:

### Rules for Objective Description
- Use "outperforms" or "achieves higher" instead of "is the best"
- Qualify scope: "on the N datasets tested" not "in all cases"
- Use hedging language for interpretations: "suggests", "indicates", "may be attributed to"
- Avoid superlatives without qualification

### Rules for Statistical Reporting
- Every numeric claim must include error measure (SD, SE, or CI)
- Every comparison must include test statistic, df, p-value, effect size
- Pre-test results must be reported before parametric test results
- Multiple comparison correction must be reported when applicable

### Rules for Figure/Table References
- First reference in text must introduce what the figure/table shows
- Guide the reader to specific observations: "As shown in Figure N, ..."
- Do not simply say "see Figure N" -- explain what to observe
- Every figure and table must be referenced at least once in the text

### Common Sentence Patterns

**Introducing experiments**:
- "To evaluate [hypothesis], we conducted [experiment]"
- "We first assess [method] on [dataset]"
- "Table N presents the results of [experiment]"

**Describing results**:
- "[Method] achieves [value], outperforming [baseline] by [improvement]"
- "Figure N shows [phenomenon]. We observe that [key observation]"
- "Compared to [baseline], our method improves [metric] by [percentage]"

**Statistical significance**:
- "The difference is statistically significant (p < [threshold])"
- "[Test name] reveals significant differences between groups ([statistic], p = [value])"
- "After [correction method] correction, differences remain significant"

**Ablation studies**:
- "To validate the contribution of [component], we conducted ablation experiments"
- "Removing [component] results in a [delta]% decrease, indicating [conclusion]"
- "Table N shows the contribution of each component"

**Qualitative analysis**:
- "To better understand [phenomenon], we examine [specific cases]"
- "Figure N visualizes [what], showing that [observation]"
- "This explains why [method] performs well on [specific aspect]"

## Step 4.5: Compile results-draft.md

Assemble all subsections into a complete Results draft:

```markdown
## Results

### Overview of Main Findings
[Step 4.2 output]

### Experimental Setup
[Brief setup, reference Methods/Appendix for details]

### Performance Comparison
[Step 4.3 performance subsection]

### Ablation Study
[Step 4.3 ablation subsection, if applicable]

### Additional Analysis
[Step 4.3 efficiency subsection, if applicable]

### Qualitative Analysis
[If applicable]
```

**Final checks before writing file**:
- [ ] Every numeric value has error measure
- [ ] Every comparison has full statistical reporting
- [ ] Every figure/table is referenced in text
- [ ] Tone is objective throughout
- [ ] No over-interpretation of results
- [ ] Limitations acknowledged where appropriate

## Output

- **Variable**: `resultsDraft` -- complete Results section text
- **File**: `results-draft.md` -- paper-ready Results section
- **update_plan**: Mark Phase 4 completed, Phase 5 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 5: Quality Check](05-quality-check.md).
