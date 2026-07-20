
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 2: Cleanup & Organize

## Objective

Create a clean, Overleaf-ready directory structure from the analyzed template. Clean the main .tex file, create modular section files, copy assets to proper locations, and apply conference-specific configuration.

> **COMPACT SENTINEL**: This is Phase 2 (Cleanup & Organize) of scholar-latex-organizer.
> If only this sentinel remains after context compression, immediately `Read("phases/02-cleanup-organize.md")` to recover full phase content.
> Status: Check update_plan for current step progress.

## Input

- `analysisResult`: From Phase 1 (fileInventory, mainFile, conferenceType, issues, tempDir)
- `sectionStructure`: Standard (default) or custom section list
- `outputDir`: Target output directory path

## Execution

### Step 2.1: Create Output Structure

Create the clean directory structure for the organized template.

```bash
# Create output directory structure
mkdir -p "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/text"
mkdir -p "$OUTPUT_DIR/figures"
mkdir -p "$OUTPUT_DIR/tables"
mkdir -p "$OUTPUT_DIR/styles"

echo "Created directory structure:"
find "$OUTPUT_DIR" -type d | sort
```

Target structure:
```
outputDir/
├── main.tex              # Cleaned main file with \input references
├── text/                 # Section content files
│   ├── 01-introduction.tex
│   ├── 02-related-work.tex
│   ├── 03-method.tex
│   ├── 04-experiments.tex
│   └── 05-conclusion.tex
├── figures/              # All image files
├── tables/               # Table definitions
│   └── example-table.tex # Placeholder to prevent Overleaf auto-deletion
├── styles/               # .sty and .cls files (untouched)
├── references.bib        # Consolidated bibliography
└── README.md             # Generated in Phase 3
```

### Step 2.2: Clean Main File (main.tex)

Read the original main file and create a cleaned version. The cleaned main.tex should:

**Keep**:
- `\documentclass` declaration with correct options
- Required `\usepackage` declarations
- Core configuration (page setup, theorem definitions, custom commands)
- `\begin{document}` ... `\end{document}` wrapper
- `\maketitle`, `\bibliography`, `\appendix` commands

**Remove**:
- Example/sample section content (everything between `\begin{document}` and `\end{document}` that is example text)
- Verbose instructional comments (multi-line tutorial blocks)
- Example `\author`, `\title`, `\affiliation` content (replace with TODO placeholders)
- Lines containing `DELETE`, `REMOVE`, `Replace this`, `Your ... here`
- Commented-out code blocks longer than 3 lines

**Add**:
- `\input{text/01-introduction}` imports for each section file
- TODO comment placeholders for title, author, abstract

**Example cleaned main.tex for ACM template**:

```latex
\documentclass[sigconf,anonymous,nonacm]{acmart}

% --- Required Packages ---
\usepackage{booktabs}
\usepackage{graphicx}
\usepackage{subcaption}
\usepackage{amsmath}

% --- Path Configuration ---
\graphicspath{{figures/}}

% --- Custom Commands ---
% Add your custom commands here

% === Document Metadata ===
% TODO: Replace with your paper information
\title{Your Paper Title}

\author{Anonymous Author(s)}
% \author{First Author}
% \affiliation{%
%   \institution{University Name}
%   \city{City}
%   \country{Country}
% }
% \email{author@example.com}

\begin{document}

% --- Abstract ---
\begin{abstract}
% TODO: Write your abstract here
\end{abstract}

\maketitle

% --- Main Content ---
\input{text/01-introduction}
\input{text/02-related-work}
\input{text/03-method}
\input{text/04-experiments}
\input{text/05-conclusion}

% --- Acknowledgments ---
% \begin{acks}
% TODO: Add acknowledgments (hidden during anonymous review)
% \end{acks}

% --- References ---
\bibliographystyle{ACM-Reference-Format}
\bibliography{references}

% --- Appendix ---
% \appendix
% \input{text/appendix}

\end{document}
```

---

**CHECKPOINT**: Before proceeding to Step 2.3, verify:
- [ ] Output directory structure created successfully
- [ ] Main file cleaned and written to `outputDir/main.tex`
- [ ] All `\input` references point to correct `text/` paths
- [ ] `\graphicspath` set to `{figures/}`
- [ ] `\bibliography` points to `references` (without .bib extension)

If any check fails, fix before continuing.

---

### Step 2.3: Conference-Specific Configuration

Apply the correct configuration based on the detected conference type from `analysisResult.conferenceType`.

#### KDD 2026 (ACM acmart with nonacm)

**Submission version** (anonymous):
```latex
\documentclass[sigconf,anonymous,nonacm]{acmart}

% KDD-specific settings
\settopmatter{printacmref=false,printccs=false,printfolios=false}
\setcopyright{none}
\renewcommand\footnotetextcopyrightpermission[1]{}
\pagestyle{plain}

% Remove ACM reference format
\AtBeginDocument{%
  \providecommand\BibTeX{{%
    Bib\TeX}}}
```

**Camera-ready version** (de-anonymized):
```latex
\documentclass[sigconf]{acmart}

% KDD camera-ready settings
\setcopyright{acmlicensed}
\acmConference[KDD '26]{Proceedings of the 32nd ACM SIGKDD Conference on Knowledge Discovery and Data Mining}{August 3--7, 2026}{Toronto, ON, Canada}
\acmBooktitle{Proceedings of the 32nd ACM SIGKDD Conference on Knowledge Discovery and Data Mining (KDD '26), August 3--7, 2026, Toronto, ON, Canada}
\acmDOI{10.1145/xxxxxxx.xxxxxxx}
\acmISBN{978-x-xxxx-xxxx-x}

% Include author information
\author{First Author}
\affiliation{%
  \institution{University Name}
  \city{City}
  \country{Country}
}
\email{author@example.com}
```

#### General ACM (acmart)

```latex
\documentclass[sigconf,anonymous,review]{acmart}

% Standard ACM anonymous submission
\settopmatter{printacmref=false}
\setcopyright{none}
\renewcommand\footnotetextcopyrightpermission[1]{}
```

#### NeurIPS

```latex
\documentclass{neurips_2025}
% Options: [preprint] for preprint, [final] for camera-ready
% Default (no option) = anonymous submission

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{hyperref}
\usepackage{url}
\usepackage{booktabs}
\usepackage{amsfonts}
\usepackage{nicefrac}
\usepackage{microtype}
```

#### ICLR

```latex
\documentclass{iclr2025_conference}
% Anonymous submission by default

\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{natbib}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage{url}
```

#### CVPR/ICCV

```latex
\documentclass[10pt,twocolumn,letterpaper]{article}
\usepackage{cvpr}

% Submission mode
\usepackage[pagenumbers]{cvpr} % Use this for submission
% \usepackage{cvpr}            % Use this for camera-ready

\usepackage{graphicx}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{booktabs}

\def\cvprPaperID{****} % Replace with your paper ID
```

#### AAAI

```latex
\documentclass[letterpaper]{article}
\usepackage{aaai25}
\usepackage{times}
\usepackage{helvet}
\usepackage{courier}
\usepackage[hyphens]{url}
\usepackage{graphicx}
\urlstyle{rm}

\pdfinfo{
/Title (Your Paper Title)
/Author (Anonymous)
}
```

Apply the matching configuration to `main.tex`. If the conference type is uncertain, keep the original `\documentclass` line and add a comment noting the detected type.

### Step 2.4: Create Section Files (text/)

Create independent .tex files for each section. Each file contains ONLY the section content -- no preamble, no `\begin{document}`, no `\end{document}`.

**Standard section structure** (default):

```bash
# Create section files
cat > "$OUTPUT_DIR/text/01-introduction.tex" << 'SECTION_EOF'
\section{Introduction}
\label{sec:introduction}

% TODO: Write your introduction here
%
% Suggested structure:
% - Problem statement and motivation
% - Key challenges
% - Your approach and contributions
% - Paper organization

SECTION_EOF

cat > "$OUTPUT_DIR/text/02-related-work.tex" << 'SECTION_EOF'
\section{Related Work}
\label{sec:related-work}

% TODO: Write your related work review here
%
% Suggested structure:
% - Group related work by topic/approach
% - Compare and contrast with your work
% - Identify gaps your work addresses

SECTION_EOF

cat > "$OUTPUT_DIR/text/03-method.tex" << 'SECTION_EOF'
\section{Method}
\label{sec:method}

% TODO: Describe your method/approach here
%
% Suggested structure:
% - Problem formulation
% - Overview of your approach
% - Technical details (subsections)
% - Theoretical analysis (if applicable)

SECTION_EOF

cat > "$OUTPUT_DIR/text/04-experiments.tex" << 'SECTION_EOF'
\section{Experiments}
\label{sec:experiments}

% TODO: Present your experimental evaluation here
%
% Suggested structure:
% - Experimental setup (datasets, baselines, metrics)
% - Main results
% - Ablation studies
% - Case studies / qualitative analysis

SECTION_EOF

cat > "$OUTPUT_DIR/text/05-conclusion.tex" << 'SECTION_EOF'
\section{Conclusion}
\label{sec:conclusion}

% TODO: Write your conclusion here
%
% Suggested structure:
% - Summary of contributions
% - Key findings
% - Limitations
% - Future work

SECTION_EOF

echo "Created section files:"
ls -la "$OUTPUT_DIR/text/"
```

**IMPORTANT**: Section files must contain ONLY section content. Never include:
- `\documentclass`
- `\usepackage`
- `\begin{document}` / `\end{document}`
- Preamble configuration

If the user specified custom sections, create files matching their structure instead.

### Step 2.5: Copy Assets

Copy all supporting files to their correct locations.

**Style files** (.sty, .cls, .bst):
```bash
# Copy style files to styles/ directory
find "$TEMP_DIR" \( -name "*.sty" -o -name "*.cls" -o -name "*.bst" \) -type f -exec cp {} "$OUTPUT_DIR/styles/" \;

echo "Copied style files:"
ls -la "$OUTPUT_DIR/styles/"
```

**IMPORTANT**: Never modify .sty or .cls files. Copy them exactly as-is.

If style files are in the styles/ subdirectory, ensure `main.tex` can find them. Add to main.tex preamble if needed:
```latex
% Style file path (if styles are in subdirectory)
\makeatletter
\def\input@path{{styles/}}
\makeatother
```

**Images** (.png, .jpg, .jpeg, .pdf, .eps):
```bash
# Copy non-PDF image files to figures/ directory
find "$TEMP_DIR" \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.eps" \) -type f -exec cp {} "$OUTPUT_DIR/figures/" \;

# For PDF files, only copy those actually referenced by \includegraphics in .tex files
# Step 1: Extract referenced PDF filenames from all .tex files
REFERENCED_PDFS=$(grep -roh '\\includegraphics\[.*\]{[^}]*\.pdf}' "$TEMP_DIR"/*.tex "$TEMP_DIR"/**/*.tex 2>/dev/null \
  | sed 's/.*{\([^}]*\)}/\1/' | xargs -I{} basename {} 2>/dev/null | sort -u)

# Step 2: Copy only referenced PDFs
if [ -n "$REFERENCED_PDFS" ]; then
  echo "$REFERENCED_PDFS" | while read pdf_name; do
    find "$TEMP_DIR" -name "$pdf_name" -type f -exec cp {} "$OUTPUT_DIR/figures/" \;
  done
fi

# Step 3: List unreferenced PDFs for user review
echo "--- Unreferenced PDF files (may need manual placement) ---"
find "$TEMP_DIR" -name "*.pdf" -type f | while read pdf_file; do
  pdf_basename=$(basename "$pdf_file")
  if ! echo "$REFERENCED_PDFS" | grep -q "$pdf_basename"; then
    echo "  $pdf_file"
  fi
done

echo "Copied image files:"
ls -la "$OUTPUT_DIR/figures/"
```

**Tables placeholder** (prevent Overleaf auto-deletion of empty dirs):
```bash
# Create example table file
cat > "$OUTPUT_DIR/tables/example-table.tex" << 'TABLE_EOF'
% Example table template
% Usage in section files: \input{tables/example-table}
%
% \begin{table}[t]
%   \caption{Your Table Caption}
%   \label{tab:example}
%   \begin{tabular}{lcc}
%     \toprule
%     Method & Metric 1 & Metric 2 \\
%     \midrule
%     Baseline & 0.00 & 0.00 \\
%     Ours     & 0.00 & 0.00 \\
%     \bottomrule
%   \end{tabular}
% \end{table}
TABLE_EOF
```

**Bibliography** (.bib):
```bash
# Consolidate bibliography files
# If multiple .bib files exist, merge them
BIB_FILES=$(find "$TEMP_DIR" -name "*.bib" -type f)
BIB_COUNT=$(echo "$BIB_FILES" | grep -c .)

if [ "$BIB_COUNT" -eq 1 ]; then
  cp "$BIB_FILES" "$OUTPUT_DIR/references.bib"
elif [ "$BIB_COUNT" -gt 1 ]; then
  # Merge multiple .bib files
  cat $BIB_FILES > "$OUTPUT_DIR/references.bib"
  echo "Merged $BIB_COUNT .bib files into references.bib"
else
  # Create empty .bib file
  cat > "$OUTPUT_DIR/references.bib" << 'BIB_EOF'
% Bibliography file
% Add your references here or use a reference manager export

% Example entry:
% @inproceedings{author2025title,
%   title={Paper Title},
%   author={Author, First and Author, Second},
%   booktitle={Conference Name},
%   year={2025}
% }
BIB_EOF
  echo "Created empty references.bib template"
fi
```

### Final Verification

After all steps, verify the output structure:

```bash
echo "=== Final Output Structure ==="
find "$OUTPUT_DIR" -type f | sort

echo ""
echo "=== File Counts ==="
echo "Section files: $(ls "$OUTPUT_DIR/text/"*.tex 2>/dev/null | wc -l)"
echo "Style files: $(ls "$OUTPUT_DIR/styles/"* 2>/dev/null | wc -l)"
echo "Figures: $(ls "$OUTPUT_DIR/figures/"* 2>/dev/null | wc -l)"
echo "Tables: $(ls "$OUTPUT_DIR/tables/"* 2>/dev/null | wc -l)"
echo "Main file: $(test -f "$OUTPUT_DIR/main.tex" && echo 'YES' || echo 'MISSING')"
echo "Bibliography: $(test -f "$OUTPUT_DIR/references.bib" && echo 'YES' || echo 'MISSING')"
```

## Output

Organized template directory at `outputDir/` containing:
- `main.tex` -- cleaned and configured for the detected conference
- `text/` -- modular section files (01 through 05)
- `figures/` -- all image assets
- `tables/` -- table templates with placeholder
- `styles/` -- all .sty/.cls/.bst files (unmodified)
- `references.bib` -- consolidated bibliography

## Next Phase

Phase 3: README & Finalize (`phases/03-readme-finalize.md`)
- Receives: `analysisResult`, `conferenceInfo`, `outputDir`
- Generates README.md with submission requirements and usage instructions
