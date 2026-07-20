
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 3: Section Drafting

> **COMPACT SENTINEL [Phase 3: Section Drafting]**
> This phase contains 8 execution steps (Step 3.1 -- 3.8).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/03-section-drafting.md")`

Write all paper sections as LaTeX content following the outline, writing philosophy, and style guidelines.

## Objective

- Draft all paper sections as LaTeX content
- Follow the Narrative Principle: every section supports the central contribution
- Apply writing philosophy from top ML researchers
- Produce complete draft ready for citation insertion and polishing

## Execution

### Step 3.1: Setup Draft Directory

```bash
mkdir -p $OUTPUT_DIR/.writing/drafts
```

### Step 3.2: Write Abstract

Follow the 5-sentence formula (Farquhar):

1. **What you achieved**: "We introduce...", "We prove...", "We demonstrate..."
2. **Why this is hard and important**: the gap or challenge
3. **How you do it**: method description with specialist keywords for discoverability
4. **What evidence you have**: experimental validation summary
5. **Your most remarkable number/result**: the headline result

Rules:
- 150-250 words
- Delete generic openings like "Large language models have achieved remarkable success..."
- Start with the specific contribution
- Include specialist keywords for search discoverability

Write to: `outputDir/.writing/drafts/abstract.tex`

### Step 3.3: Write Introduction

Must include (1-1.5 pages max):
- Clear problem statement (2-3 sentences)
- The gap in current approaches
- 2-4 bullet contribution list (max 1-2 lines each in two-column format)
- Brief approach overview
- Figure 1 reference

Writing rules:
- Methods should start by page 2-3 maximum
- Front-load the contribution -- reviewers form judgments before reaching methods
- The three pillars (What/Why/So What) must be crystal clear by end of introduction
- Use the stress position: place emphasis at sentence ends
- Subject-verb proximity: keep subject and verb close

Write to: `outputDir/.writing/drafts/introduction.tex`

### Step 3.4: Write Methods

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 3.1 -- 3.8) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/03-section-drafting.md")` now.

Enable reimplementation:
- Conceptual outline or pseudocode for the core algorithm
- All hyperparameters listed with values
- Architectural details sufficient for reproduction
- Present final design decisions; ablations go in experiments section

Structure:
- 3.1 Problem Setup / Preliminaries (notation, definitions)
- 3.2 Core Method (the main technical contribution)
- 3.3 Additional Components (if any)
- 3.4 Implementation Details (training, optimization)

Rules:
- Explain intuition before presenting equations
- Define all notation before first use
- Consistent terminology throughout (pick one term per concept, stick with it)
- Use verbs, not nominalizations: "We analyzed" not "We performed an analysis"

Write to: `outputDir/.writing/drafts/methods.tex`

### Step 3.5: Write Experiments

For each experiment, explicitly state:
- What claim it supports
- How it connects to the main contribution
- Experimental setting (details in appendix)
- What to observe: "the blue line shows X, which demonstrates Y"

Structure:
- 4.1 Experimental Setup (datasets, baselines, metrics, compute)
- 4.2 Main Results with Table 1
- 4.3 Ablation Studies with Table 2
- 4.4 Analysis / Qualitative Results

Requirements:
- Error bars with methodology (standard deviation vs standard error)
- Number of runs and seeds
- Hyperparameter search ranges (appendix)
- Compute infrastructure (GPU type, total hours)
- Bold best value per metric in tables
- Include direction symbols (higher-is-better / lower-is-better)

Use `booktabs` for tables:
```latex
\begin{tabular}{lcc}
\toprule
Method & Accuracy $\uparrow$ & Latency $\downarrow$ \\
\midrule
Baseline & 85.2 & 45ms \\
\textbf{Ours} & \textbf{92.1} & 38ms \\
\bottomrule
\end{tabular}
```

Write to: `outputDir/.writing/drafts/experiments.tex`

### Step 3.6: Write Related Work

Organize methodologically, not paper-by-paper:

**Good**: "One line of work uses assumption A [refs] whereas we use assumption B because..."
**Bad**: "Smith et al. introduced X. Jones et al. introduced Y."

Rules:
- Group related approaches into 2-4 thematic categories
- Position your work relative to each group
- Cite generously -- reviewers likely authored relevant papers
- Use `[CITE: description]` placeholders where citations are needed (Phase 4 will resolve)

Write to: `outputDir/.writing/drafts/related-work.tex`

### Step 3.7: Write Conclusion and Limitations

**Conclusion** (0.5 pages):
- Restate the contribution concisely
- Summarize key evidence
- Brief future directions (2-3 sentences)
- No new information

**Limitations** (required at most venues):
- Honest acknowledgment of weaknesses
- Explain why limitations do not undermine core claims
- Reviewers are instructed not to penalize honest limitation disclosure
- Pre-empt criticisms by identifying weaknesses first

Write to: `outputDir/.writing/drafts/conclusion.tex`

### Step 3.8: Write Appendix

Move supplementary material here:
- Detailed proofs (if any)
- Additional experimental results
- Full hyperparameter tables
- Dataset details
- Compute budget breakdown
- Additional qualitative examples

Write to: `outputDir/.writing/drafts/appendix.tex`

## Writing Style Reference

### Sentence-Level Clarity (Gopen & Swan)

| Principle | Rule |
|-----------|------|
| Subject-verb proximity | Keep subject and verb close |
| Stress position | Place emphasis at sentence ends |
| Topic position | Put context first, new info after |
| Old before new | Familiar info then unfamiliar info |
| One unit, one function | Each paragraph makes one point |
| Action in verb | Use verbs, not nominalizations |
| Context before new | Set stage before presenting |

### Micro-Level Tips (Perez)

- Minimize pronouns: "This shows..." -> "This result shows..."
- Verbs early: position verbs near sentence start
- Delete filler: "actually," "a bit," "very," "really," "basically," "quite," "essentially"

### Word Choice (Lipton)

- Be specific: "performance" -> "accuracy" or "latency"
- Eliminate hedging: drop "may" and "can" unless genuinely uncertain
- Delete intensifiers: "very tight approximation" -> "tight approximation"

### Precision (Steinhardt)

- Consistent terminology: different terms for same concept creates confusion
- State assumptions formally before theorems
- Intuition + rigor: intuitive explanations alongside formal proofs

## Output

All draft sections written to `outputDir/.writing/drafts/`:
- `abstract.tex`
- `introduction.tex`
- `methods.tex`
- `experiments.tex`
- `related-work.tex`
- `conclusion.tex`
- `appendix.tex`

- **Variable**: `draftSections` (path to drafts/ directory)
- **update_plan**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then continue to [Phase 4: Citation Management](04-citation-management.md).
