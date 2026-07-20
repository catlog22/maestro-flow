
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 6: Conference Formatting

Assemble all polished sections into a complete LaTeX manuscript using the target conference template. Compile and verify.

## Objective

- Copy the correct conference LaTeX template
- Assemble polished sections into paper.tex
- Include verified bibliography
- Compile and fix any LaTeX errors
- Apply conference-specific requirements (checklist, disclosures)
- Ensure page limit compliance

## Execution

### Step 6.1: Setup Conference Template

Copy the appropriate template to the output directory. Templates are available at `G:/github_lib/claude-scholar/skills/ml-paper-writing/templates/`.

| Conference | Template Directory | Main File | Style File |
|------------|-------------------|-----------|------------|
| NeurIPS 2025 | `neurips2025/` | `main.tex` | `neurips.sty` |
| ICML 2026 | `icml2026/` | `example_paper.tex` | `icml2026.sty` |
| ICLR 2026 | `iclr2026/` | `iclr2026_conference.tex` | `iclr2026_conference.sty` |
| ACL | `acl/` | `acl_latex.tex` | `acl.sty` |
| AAAI 2026 | `aaai2026/` | `aaai2026-unified-template.tex` | `aaai2026.sty` |
| COLM 2025 | `colm2025/` | `colm2025_conference.tex` | `colm2025_conference.sty` |

**Template copy with error handling**:
```bash
# Set template source and destination
TEMPLATE_SOURCE="G:/github_lib/claude-scholar/skills/ml-paper-writing/templates/${CONFERENCE_DIR}"
OUTPUT_DIR="./paper-output"

# Check if template source exists
if [ ! -d "$TEMPLATE_SOURCE" ]; then
  echo "ERROR: Template directory not found: $TEMPLATE_SOURCE"
  echo "Available templates:"
  ls -1 "G:/github_lib/claude-scholar/skills/ml-paper-writing/templates/" 2>/dev/null || echo "  Template directory not accessible"
  echo ""
  echo "Fallback options:"
  echo "  1. Download template from conference website"
  echo "  2. Use generic LaTeX article template"
  echo "  3. Specify custom template path"
  exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Copy entire template directory (not just main.tex)
cp -r "$TEMPLATE_SOURCE"/* "$OUTPUT_DIR/" 2>&1
COPY_STATUS=$?

if [ $COPY_STATUS -ne 0 ]; then
  echo "ERROR: Failed to copy template files"
  echo "Possible causes:"
  echo "  - Permission denied (check file permissions)"
  echo "  - Disk space full"
  echo "  - Path contains special characters"
  echo ""
  echo "Manual fallback:"
  echo "  1. Manually copy files from: $TEMPLATE_SOURCE"
  echo "  2. To destination: $OUTPUT_DIR"
  exit 1
fi

# Verify template structure is complete
echo "Template files copied successfully:"
ls -la "$OUTPUT_DIR/"
# Should see: main.tex, *.sty, *.bst, etc.

# Verify critical files exist
CRITICAL_FILES=("main.tex" "*.sty")
for pattern in "${CRITICAL_FILES[@]}"; do
  if ! ls "$OUTPUT_DIR"/$pattern 1> /dev/null 2>&1; then
    echo "WARNING: Critical file pattern not found: $pattern"
    echo "Template may be incomplete. Check manually."
  fi
done
```

IMPORTANT: Copy the ENTIRE directory. Templates include:
- Style files (`.sty`) -- required for compilation
- Bibliography styles (`.bst`) -- required for references
- Makefiles -- for easy compilation
- Math command definitions (if any)

**If template copy fails**, use fallback strategy:
1. **Download from conference website**: Most conferences provide LaTeX templates on their submission page
2. **Use generic template**: Create minimal LaTeX document with `\documentclass{article}`
3. **Request user assistance**: Ask user to manually place template files in output directory

### Step 6.2: Verify Template Compiles

Before making any changes, compile the template as-is:

```bash
cd $OUTPUT_DIR
# Using latexmk (recommended)
latexmk -pdf main.tex

# Or manual compilation
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

If the unmodified template does not compile, fix that first:
- Missing TeX packages: `tlmgr install <package>`
- Wrong TeX distribution: use TeX Live (recommended)

### Step 6.3: Assemble Paper Content

Replace template example content with polished sections. Work section by section:

1. **Preamble**: Keep the template preamble intact. Only add:
   - `\usepackage{booktabs}` (if not present, for tables)
   - Custom macros for method name: `\newcommand{\method}{YourMethodName}`
   - Anonymization flag (for blind review)

2. **Title and Authors**: Set title, anonymize authors for submission
   ```latex
   \title{Your Paper Title}
   % For blind review:
   \author{Anonymous Authors}
   ```

3. **Content sections**: Replace template content with polished sections
   - Read each file from `outputDir/.writing/polished/`
   - Insert into the appropriate `\section{}` blocks
   - Preserve all `\cite{}` commands
   - Preserve all figure/table environments

4. **Bibliography**: Copy `references.bib` to the output directory
   ```bash
   cp $OUTPUT_DIR/.writing/references.bib $OUTPUT_DIR/references.bib
   ```
   Update `\bibliography{references}` or `\addbibresource{references.bib}` as needed.

### Step 6.4: Conference-Specific Additions

Apply requirements specific to the target conference:

| Conference | Required Additions |
|------------|-------------------|
| NeurIPS | Paper checklist (appendix), lay summary if accepted |
| ICML | Broader Impact Statement (after conclusion) |
| ICLR | LLM usage disclosure, reciprocal reviewing agreement |
| ACL/EMNLP | Limitations section (mandatory), Ethics Statement |
| AAAI | Strict adherence to style file (no modifications to .sty) |
| COLM | Reframe for language model focus if needed |

For NeurIPS checklist, include in appendix:
```latex
\section*{NeurIPS Paper Checklist}
\begin{enumerate}
  \item Claims: [Yes/No/NA] + justification
  \item Limitations: [Yes/No] + justification
  % ... (see references/checklists.md for full list)
\end{enumerate}
```

### Step 6.5: Compile and Fix Errors

Compile the assembled paper:

```bash
cd $OUTPUT_DIR
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

Common errors and fixes:

| Error | Fix |
|-------|-----|
| Undefined citation | Check .bib key matches \cite{} key |
| Missing package | Add \usepackage{} or install via tlmgr |
| Overfull hbox | Adjust line breaks, figure sizes |
| Encoding error | Ensure UTF-8, use LaTeX escapes for special chars |
| Bibliography not found | Check \bibliography{} path |

Retry compilation after each fix. Maximum 3 fix-compile cycles.

### Step 6.6: Page Limit Verification

Check that the paper fits within the page limit:

```bash
# Count pages (requires pdfinfo)
pdfinfo main.pdf | grep Pages
```

If over the page limit:
- Move detailed proofs to appendix
- Condense related work (cite surveys instead of individual papers)
- Combine similar experiments into unified tables
- Use smaller figure sizes with subfigures
- Tighten writing: eliminate redundancy, use active voice
- Reduce whitespace between sections (but do NOT modify .sty files)

If under the page limit (by more than 0.5 pages):
- Expand ablation studies
- Add qualitative examples
- Expand limitations discussion
- Include additional baselines

### Step 6.7: Final Verification Checklist

Before declaring complete:

- [ ] Paper compiles without errors
- [ ] All citations resolve (no `??` in PDF)
- [ ] Page limit respected
- [ ] Authors anonymized (for blind review)
- [ ] No `[CITATION NEEDED]` or `[TODO]` markers remain (or all are explicitly flagged)
- [ ] Figures render correctly
- [ ] Tables use booktabs style
- [ ] Conference-specific sections included
- [ ] No modifications to .sty files
- [ ] References formatted correctly

### Step 6.8: Delivery

Report to user:

> "Paper assembled and compiled successfully.
> - Conference: [name]
> - Pages: [N] / [limit]
> - Citations: [verified] / [total] ([placeholders] need your verification)
> - Output: [path to paper.tex and paper.pdf]
>
> Remaining items for you:
> - [list of placeholder citations to verify]
> - [list of figures to create/replace]
> - [any other action items]"

## Output

- **File**: `outputDir/main.tex` (or conference-specific name) -- complete manuscript (paper workspace)
- **File**: `outputDir/main.pdf` -- compiled PDF (paper workspace)
- **File**: `outputDir/references.bib` -- verified bibliography (paper workspace)
- **Run**: Write the delivery manifest (paths above + verification/page status + remaining action items) to `{run_dir}/report.md`, and the delivery-paths list to `{run_dir}/outputs/`. See run-mode.md.
- **update_plan**: Mark Phase 6 completed

## Completion

Close the Run before declaring completion (see run-mode.md):

```bash
maestro run check {run_id}     # repair any reported gate
maestro run complete {run_id}
```

Report completion only after `run complete` succeeds. The user then has:
1. A complete LaTeX manuscript formatted for their target conference
2. A verified bibliography
3. A list of any remaining action items

Next steps for the researcher:
- Review and revise the draft
- Create/finalize figures
- Verify any placeholder citations
- Run the `scholar-review` skill for self-review before submission
