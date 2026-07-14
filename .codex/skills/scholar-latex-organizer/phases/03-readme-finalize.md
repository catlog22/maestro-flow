# Phase 3: README & Finalize

## Objective

Generate a comprehensive README.md with conference submission requirements and usage instructions, verify the template compiles correctly, clean up temporary files, and present a final summary to the user.

## Input

- `analysisResult`: From Phase 1 (fileInventory, mainFile, conferenceType, issues)
- `conferenceInfo`: Conference name or URL provided by user
- `outputDir`: Path to the organized template directory (from Phase 2)

## Execution

### Step 3.1: Gather Conference Info

Collect submission requirements from available sources.

**If user provided a conference URL**, use WebFetch to extract requirements:

```
WebFetch(url=conferenceURL, prompt="Extract the following information from this conference page:
1. Paper page limit (main content + references)
2. Anonymity requirements (double-blind, single-blind)
3. Format requirements (single/double column, font size, margins)
4. Submission deadlines (abstract, full paper, supplementary)
5. Required sections or formatting rules
6. Compiler requirements (pdflatex, xelatex, lualatex)
7. Any special instructions or warnings")
```

**If no URL provided**, fall back to these sources in order:

1. **Template comments**: Search the original main file and .cls files for submission instructions embedded as comments.
   ```bash
   grep -i 'page\|limit\|deadline\|anonymous\|blind\|submission\|compiler\|format' "$TEMP_DIR"/*.tex "$TEMP_DIR"/*.cls 2>/dev/null | head -30
   ```

2. **Document class inference**: Use the detected `\documentclass` to determine standard requirements.

3. **Known conference defaults**: Use the reference table below.

**Common conference requirements reference**:

| Conference | Document Class | Page Limit | Columns | Anonymity | Compiler | Key Notes |
|------------|---------------|-----------|---------|-----------|----------|-----------|
| KDD (ACM) | `acmart` | 9+refs (research), 4+refs (applied) | 2 | Double-blind | pdflatex | `nonacm` for anonymous submission |
| ACM General | `acmart` | Varies | 2 | Double-blind | pdflatex | `anonymous,review` options |
| CVPR/ICCV | `cvpr` | 8+refs | 2 | Double-blind | pdflatex | Strict page limits enforced |
| NeurIPS | `neurips_20XX` | 9+refs | 1 | Double-blind | pdflatex | Supplementary allowed |
| ICLR | `iclr20XX` | 10+refs | 2 | Double-blind | pdflatex | OpenReview submission |
| AAAI | `aaaiXX` | 8+refs (7+1 ethical) | 2 | Double-blind | pdflatex | Ethics statement required |

Store gathered information as `conferenceRequirements` for README generation.

### Step 3.2: Generate README.md

Create a comprehensive README.md in the output directory covering all aspects of the template.

```bash
cat > "$OUTPUT_DIR/README.md" << 'README_EOF'
# [Conference Name] Paper Template

## Conference Information

| Item | Detail |
|------|--------|
| **Conference** | [Conference Name and Year] |
| **Website** | [Conference URL] |
| **Template Version** | [Template version or date] |
| **Document Class** | `[document class]` |

## Submission Requirements

| Requirement | Value |
|------------|-------|
| **Page Limit** | [N pages + references] |
| **Columns** | [Single / Double] |
| **Font Size** | [10pt / 11pt / 12pt] |
| **Anonymity** | [Double-blind / Single-blind / None] |
| **Compiler** | [pdflatex / xelatex / lualatex] |
| **Paper Size** | [letter / A4] |

### Deadlines

| Milestone | Date |
|-----------|------|
| Abstract Deadline | [Date or TBD] |
| Full Paper Deadline | [Date or TBD] |
| Supplementary Material | [Date or TBD] |
| Notification | [Date or TBD] |
| Camera-Ready | [Date or TBD] |

## Overleaf Usage

### Upload Steps

1. Compress the entire template directory into a `.zip` file
2. Go to [Overleaf](https://www.overleaf.com) and click **New Project** > **Upload Project**
3. Upload the `.zip` file
4. Overleaf will automatically detect the project structure

### Compiler Settings

1. Click the **Menu** button (top-left)
2. Set **Compiler** to `[pdflatex / xelatex / lualatex]`
3. Set **Main document** to `main.tex`
4. Click **Recompile**

## File Descriptions

| File/Directory | Description |
|---------------|-------------|
| `main.tex` | Main document file. Contains preamble, metadata, and section imports. |
| `text/` | Section content files. Edit these to write your paper. |
| `text/01-introduction.tex` | Introduction section |
| `text/02-related-work.tex` | Related work / literature review |
| `text/03-method.tex` | Methodology / proposed approach |
| `text/04-experiments.tex` | Experiments and results |
| `text/05-conclusion.tex` | Conclusion and future work |
| `figures/` | Image files (.png, .jpg, .pdf, .eps) |
| `tables/` | Table definition files |
| `styles/` | Style files (.sty, .cls, .bst) -- DO NOT modify |
| `references.bib` | Bibliography database |

## Common Operations

### Adding a Figure

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\linewidth]{your-figure-name}
  \caption{Your caption here.}
  \label{fig:your-label}
\end{figure}
```

Place image files in the `figures/` directory. The `\graphicspath` is already configured in `main.tex`.

For side-by-side figures:

```latex
\begin{figure}[t]
  \centering
  \begin{subfigure}[b]{0.48\linewidth}
    \includegraphics[width=\linewidth]{figure-a}
    \caption{Sub-caption A}
    \label{fig:sub-a}
  \end{subfigure}
  \hfill
  \begin{subfigure}[b]{0.48\linewidth}
    \includegraphics[width=\linewidth]{figure-b}
    \caption{Sub-caption B}
    \label{fig:sub-b}
  \end{subfigure}
  \caption{Overall caption.}
  \label{fig:overall}
\end{figure}
```

### Adding a Table

```latex
\begin{table}[t]
  \caption{Your table caption.}
  \label{tab:your-label}
  \centering
  \begin{tabular}{lcc}
    \toprule
    Method & Metric 1 & Metric 2 \\
    \midrule
    Baseline A & 0.00 & 0.00 \\
    Baseline B & 0.00 & 0.00 \\
    \textbf{Ours} & \textbf{0.00} & \textbf{0.00} \\
    \bottomrule
  \end{tabular}
\end{table}
```

Or use an external table file:

```latex
\input{tables/your-table}
```

### Adding References

1. Add entries to `references.bib`:

```bibtex
@inproceedings{author2025title,
  title     = {Paper Title},
  author    = {Last, First and Last, First},
  booktitle = {Proceedings of Conference},
  year      = {2025},
  pages     = {1--10}
}
```

2. Cite in your text:

```latex
\cite{author2025title}        % (Author et al., 2025)
\citet{author2025title}       % Author et al. (2025)
\citep{author2025title}       % [1] or (Author et al., 2025)
```

### Adding a New Section

1. Create a new file in `text/`, e.g., `text/06-appendix.tex`
2. Add `\input{text/06-appendix}` in `main.tex` at the desired position
3. The file should contain only the section content (starting with `\section{...}`)

## Notes and Warnings

- **DO NOT modify** files in the `styles/` directory
- **Anonymous submission**: Author information is hidden in the current configuration. For camera-ready, update `\documentclass` options and uncomment author blocks in `main.tex`
- **Page limit**: Ensure your content fits within [N] pages (excluding references)
- **Images**: Use vector formats (.pdf, .eps) for best quality. Bitmap images (.png, .jpg) should be at least 300 DPI
- **Bibliography style**: The bibliography style is set in `main.tex`. Do not change unless required by the conference
README_EOF
```

Customize the README by replacing all `[bracketed placeholders]` with actual values from `conferenceRequirements` and `analysisResult`.

### Step 3.3: Verify Compilation

If a LaTeX compiler is available, attempt to compile the template to verify it works.

```bash
# Check if pdflatex is available
if command -v pdflatex &> /dev/null; then
  echo "pdflatex found, attempting compilation..."
  
  cd "$OUTPUT_DIR"
  
  # Set TEXINPUTS to include styles directory
  export TEXINPUTS="./styles//:$TEXINPUTS"
  
  # First pass
  pdflatex -interaction=nonstopmode main.tex 2>&1 | tail -20
  
  # Check for bibtex
  if command -v bibtex &> /dev/null; then
    bibtex main 2>&1 | tail -5
  fi
  
  # Second pass (resolve references)
  pdflatex -interaction=nonstopmode main.tex 2>&1 | tail -20
  
  # Check result
  if [ -f main.pdf ]; then
    echo "Compilation successful: main.pdf generated"
    echo "PDF size: $(du -h main.pdf | cut -f1)"
  else
    echo "WARNING: Compilation failed. Check errors above."
    echo "Common fixes:"
    echo "  - Missing packages: install via tlmgr or upload to Overleaf"
    echo "  - Encoding issues: ensure UTF-8 encoding"
    echo "  - Path issues: check \\graphicspath and \\input paths"
  fi
  
  # Clean auxiliary files
  rm -f main.aux main.log main.out main.bbl main.blg main.fls main.fdb_latexmk main.synctex.gz 2>/dev/null
  
else
  echo "pdflatex not found. Skipping compilation check."
  echo "The template should compile correctly on Overleaf."
fi
```

**Common compilation issues and fixes**:

| Error | Cause | Fix |
|-------|-------|-----|
| `File not found` | Style file not in search path | Add `\makeatletter\def\input@path{{styles/}}\makeatother` to preamble |
| `Undefined control sequence` | Missing package | Add required `\usepackage{}` |
| `Missing \begin{document}` | Encoding issue | Ensure file is UTF-8, remove BOM |
| `Too many unprocessed floats` | Too many figures/tables | Add `\clearpage` between sections |
| `Font ... not found` | Font not installed | Use standard fonts or switch compiler |

### Step 3.4: Cleanup

Remove the temporary extraction directory created in Phase 1.

```bash
# Remove temp directory
if [ -d "$TEMP_DIR" ]; then
  rm -rf "$TEMP_DIR"
  echo "Cleaned up temp directory: $TEMP_DIR"
fi
```

### Step 3.5: Present Summary

Display the final summary to the user.

```
=== Template Organization Complete ===

Output Directory: [outputDir]

File Structure:
  outputDir/
  ├── main.tex              (cleaned, configured for [conference])
  ├── text/
  │   ├── 01-introduction.tex
  │   ├── 02-related-work.tex
  │   ├── 03-method.tex
  │   ├── 04-experiments.tex
  │   └── 05-conclusion.tex
  ├── figures/              ([N] files)
  ├── tables/               ([N] files)
  ├── styles/               ([N] files)
  ├── references.bib
  └── README.md

Summary:
  - Conference: [Conference Name]
  - Document class: [class] with [options]
  - Anonymity: [enabled/disabled]
  - Section files: [N] created
  - Style files: [N] preserved
  - Image files: [N] copied
  - Compilation: [success / skipped / failed with notes]

Next Steps:
  1. Compress the output directory to .zip
  2. Upload to Overleaf (New Project > Upload Project)
  3. Set compiler to [pdflatex] and main document to main.tex
  4. Start writing in text/ section files
  5. See README.md for detailed usage instructions

Warnings:
  [Any warnings or issues that need attention]
```

## Output

Complete `outputDir/` ready for Overleaf upload, containing:
- All organized template files from Phase 2
- `README.md` with conference requirements, usage instructions, and LaTeX examples
- Verified compilation (if compiler available)
- Temporary files cleaned up

## Next Phase

None -- this is the final phase. The organized template is ready for use.
