
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 1: Repo Understanding

Explore the research repository to understand the project, identify the main contribution, locate results, and find existing citations.

## Objective

- Understand project structure, code, and experimental results
- Identify the main contribution and key findings
- Find existing citations and references in the codebase
- Build a repo context document for downstream phases

## Execution

### Step 1.1: Explore Repository Structure

Map the repository layout to understand what exists:

```bash
# Get directory structure
find $REPO_PATH -type f -name "*.py" -o -name "*.md" -o -name "*.txt" -o -name "*.bib" -o -name "*.tex" | head -50

# Check for results/outputs
ls -la $REPO_PATH/results/ $REPO_PATH/outputs/ $REPO_PATH/experiments/ 2>/dev/null

# Check for existing paper drafts
find $REPO_PATH -name "*.tex" -o -name "*.bib" -o -name "paper*" -o -name "draft*" | head -20
```

Look for:
- `README.md` -- project overview and claims
- `results/`, `outputs/`, `experiments/` -- key findings
- `configs/` -- experimental settings
- Existing `.bib` files or citation references
- Any draft documents, notes, or slides

### Step 1.2: Read Key Documentation

Read the most informative files first:

1. **README.md** -- project overview, stated claims, usage instructions
2. **Existing papers/drafts** -- any `.tex` or draft files
3. **Experiment configs** -- what experiments were run
4. **Results files** -- tables, metrics, logs

For each file, extract:
- What problem does this solve?
- What method is proposed?
- What results are claimed?
- What baselines are compared?

### Step 1.3: Analyze Code for Contributions

Identify the core technical contribution by examining:

```bash
# Find main model/method implementations
grep -rl "class.*Model\|class.*Network\|def forward\|def train" $REPO_PATH --include="*.py" | head -10

# Find evaluation scripts
grep -rl "evaluate\|metrics\|accuracy\|loss" $REPO_PATH --include="*.py" | head -10

# Find configuration/hyperparameters
grep -rl "config\|args\|hyperparameter" $REPO_PATH --include="*.py" --include="*.yaml" --include="*.json" | head -10
```

Document:
- Core algorithm or model architecture
- Key hyperparameters and their values
- Training procedure
- Evaluation methodology

### Step 1.4: Extract Experimental Results

Locate and parse experimental results:

```bash
# Find result files
find $REPO_PATH -name "*.csv" -o -name "*.json" -o -name "*.log" | head -20

# Look for tables, metrics, figures
grep -r "accuracy\|f1\|bleu\|rouge\|perplexity\|loss" $REPO_PATH --include="*.md" --include="*.txt" --include="*.log" | head -20
```

Record:
- Main metrics and their values
- Baseline comparisons
- Ablation study results (if any)
- Statistical significance information (error bars, seeds, number of runs)

### Step 1.5: Find Existing Citations

Search for papers already referenced in the codebase:

```bash
# Find citation references
grep -r "arxiv\|doi\|cite\|@article\|@inproceedings" $REPO_PATH --include="*.md" --include="*.bib" --include="*.py" --include="*.tex" | head -30

# Find .bib files
find $REPO_PATH -name "*.bib"
```

These are high-signal starting points for Related Work -- the researcher has already deemed them relevant.

### Step 1.6: Identify Contribution

Based on all gathered information, formulate:

1. **One-sentence contribution**: What is the single thing this work contributes?
2. **The What**: 1-3 specific novel claims
3. **The Why**: What evidence supports these claims?
4. **The So What**: Why should the community care?

**Present to user for confirmation**:

> "Based on my understanding of the repo, the main contribution appears to be [X].
> The key results show [Y]. Is this the framing you want for the paper,
> or should we emphasize different aspects?"

### Step 1.7: Check Existing Materials

If `paperPreferences.existingMaterials` is not 'none':
- Read existing drafts or notes
- Identify sections already written
- Note the framing and narrative direction
- Flag conflicts with repo analysis

## Output

Write `outputDir/.writing/repo-context.md`:

```markdown
# Repository Context

## Project Overview
[Summary of what the project does]

## Main Contribution
[One-sentence contribution statement]

### The What
- [Claim 1]
- [Claim 2]

### The Why
- [Evidence for each claim]

### The So What
- [Why this matters to the community]

## Key Results
| Metric | Ours | Best Baseline | Improvement |
|--------|------|---------------|-------------|
| ... | ... | ... | ... |

## Technical Details
- Architecture: [description]
- Training: [procedure]
- Datasets: [list]
- Compute: [GPU type, hours if known]

## Existing Citations
- [paper1]: used as baseline
- [paper2]: method builds on this
- [paper3]: cited in README

## Existing Materials
- [list of drafts, notes, slides found]

## Open Questions for Scientist
- [Any ambiguities or uncertainties]
```

- **Variable**: `repoContext` (path to repo-context.md)
- **update_plan**: Mark Phase 1 completed, Phase 2 in_progress

## Next Phase

Return to orchestrator, then continue to [Phase 2: Structure Planning](02-structure-planning.md).
