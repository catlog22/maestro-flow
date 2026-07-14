# Phase 1: Extract & Analyze

## Objective

Extract the template .zip file, inventory all contents, identify the main LaTeX file and conference type, diagnose structural issues, and present a cleanup plan for user approval.

## Input

- `templatePath`: Path to the .zip template file
- `conferenceInfo`: Conference name or URL (optional)

## Execution

### Step 1.1: Extract Files

Extract the .zip archive to a temporary directory and list all contents.

```bash
# Create temp extraction directory
TEMP_DIR=$(mktemp -d)
echo "Extracting to: $TEMP_DIR"

# Extract the zip file
unzip -o "$TEMPLATE_PATH" -d "$TEMP_DIR"

# List all extracted files with structure
find "$TEMP_DIR" -type f | sort
```

If extraction fails, check file integrity and ask the user to verify or re-download the .zip file.

### Step 1.2: Identify File Types

Categorize all extracted files into groups:

| Category | Extensions | Purpose |
|----------|-----------|---------|
| **LaTeX source** | `.tex` | Main content and section files |
| **Style files** | `.sty`, `.cls` | Document class and style definitions |
| **Bibliography** | `.bib` | Reference databases |
| **Images** | `.png`, `.jpg`, `.jpeg`, `.pdf`, `.eps` | Figures and graphics |
| **Other** | `.txt`, `.md`, `.bat`, `.sh`, etc. | Supporting files |

```bash
# Categorize files
echo "=== LaTeX Sources ==="
find "$TEMP_DIR" -name "*.tex" -type f

echo "=== Style Files ==="
find "$TEMP_DIR" \( -name "*.sty" -o -name "*.cls" -o -name "*.bst" \) -type f

echo "=== Bibliography ==="
find "$TEMP_DIR" -name "*.bib" -type f

echo "=== Images ==="
find "$TEMP_DIR" \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.pdf" -o -name "*.eps" \) -type f

echo "=== Other ==="
find "$TEMP_DIR" -type f ! \( -name "*.tex" -o -name "*.sty" -o -name "*.cls" -o -name "*.bst" -o -name "*.bib" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.pdf" -o -name "*.eps" \)
```

### Step 1.3: Identify Main File

Determine the main LaTeX file using this priority order:

1. **Check common names** (in order):
   - `main.tex`
   - `paper.tex`
   - `document.tex`
   - `sample-sigconf.tex`
   - `template.tex`
   - `manuscript.tex`

2. **Search for `\documentclass`**: If no common name matches, search all .tex files for `\documentclass` declarations.

```bash
# Check common names first
for name in main.tex paper.tex document.tex sample-sigconf.tex template.tex manuscript.tex; do
  found=$(find "$TEMP_DIR" -name "$name" -type f)
  if [ -n "$found" ]; then
    echo "Found main file candidate: $found"
  fi
done

# Search for \documentclass in all .tex files
echo "=== Files containing \\documentclass ==="
grep -rl '\\documentclass' "$TEMP_DIR" --include="*.tex"
```

3. **Multiple candidates**: If multiple files contain `\documentclass`, present the list to the user and ask which is the main file. Look for clues:
   - Files that `\input` or `\include` other .tex files are more likely the main file
   - Files named `sample*` or `example*` are typically examples, not the main file
   - The file with the most `\input`/`\include` statements is usually the main file

### Step 1.4: Detect Conference Type

Extract the document class and options from the main file's `\documentclass` declaration.

```bash
# Extract \documentclass line
grep '\\documentclass' "$MAIN_FILE"
```

Parse the result to identify:

| Document Class | Conference | Key Options |
|---------------|-----------|-------------|
| `acmart` | ACM (KDD, SIGIR, WWW, etc.) | `sigconf`, `anonymous`, `review`, `nonacm` |
| `cvpr` | CVPR/ICCV | `review` for anonymous |
| `neurips_2024` / `neurips_2025` | NeurIPS | Year-specific class |
| `iclr2024_conference` / `iclr2025_conference` | ICLR | Year-specific class |
| `aaai24` / `aaai25` | AAAI | Year-specific class |
| `IEEEtran` | IEEE conferences | `conference` option |
| `article` | Generic | Various options |

Also detect relevant options:
- `anonymous` -- anonymous submission mode
- `review` -- review/submission mode
- `nonacm` -- non-ACM affiliated (used in KDD)
- `sigconf` -- ACM SIGCONF format

### Step 1.5: Diagnose Issues

Check the template for common problems that need cleanup:

**Disorganized file structure**:
- Multi-level directory nesting where flat would suffice
- .tex files scattered across multiple directories
- Images mixed with source files

**Redundant content**:
- Files named `sample*`, `example*`, `demo*`, `test*`
- Multiple versions of the same file
- Template documentation files (e.g., `acmguide.pdf`)

**Excessive comments**:
- Instructional comments like `%% DELETE THIS SECTION`
- Long blocks of commented-out example text
- Tutorial-style inline comments explaining LaTeX basics

**Missing dependencies**:
- .sty or .cls files referenced in `\usepackage` or `\documentclass` but not present in the archive
- Check `\RequirePackage` statements in .cls files

**Incorrect reference paths**:
- `\includegraphics` paths that reference non-existent locations
- `\input` or `\include` paths that would break after reorganization
- `\bibliography` path mismatches

```bash
# Check for redundant files
echo "=== Potential Redundant Files ==="
find "$TEMP_DIR" -type f \( -name "sample*" -o -name "example*" -o -name "demo*" -o -name "test*" \) | grep -i '\.tex$'

# Check for excessive comments (instructional markers)
echo "=== Instructional Comment Markers ==="
grep -rn 'DELETE\|REMOVE\|TODO.*delete\|Replace this\|Your .* here' "$TEMP_DIR" --include="*.tex" | head -20

# Check referenced packages
echo "=== Referenced Packages ==="
grep -rh '\\usepackage' "$MAIN_FILE" | sed 's/.*{\(.*\)}.*/\1/' | sort -u

# Check image references
echo "=== Image References ==="
grep -rh '\\includegraphics' "$MAIN_FILE" | head -20
```

### Step 1.6: Present Analysis

Present the complete analysis to the user in a structured format:

```
=== Template Analysis ===

1. File Inventory:
   - LaTeX sources: N files
   - Style files: N files (.sty/.cls/.bst)
   - Bibliography: N files
   - Images: N files
   - Other: N files
   - Total: N files

2. Main File: [filename]
   - Document class: [class] with options [options]

3. Conference: [detected conference name]
   - Type: [submission/camera-ready]
   - Anonymous: [yes/no]

4. Issues Found:
   - [x] Disorganized structure: [details]
   - [x] Redundant files: [list]
   - [x] Excessive comments: [count] instructional markers
   - [ ] Missing dependencies: none
   - [x] Path issues: [details]

5. Proposed Cleanup Plan:
   a. Create clean directory structure (main.tex, text/, figures/, tables/, styles/)
   b. Extract and clean main.tex (remove examples, keep config)
   c. Create section files in text/
   d. Copy style files to styles/
   e. Copy images to figures/
   f. Consolidate bibliography to references.bib
   g. Remove [N] redundant files

Proceed with cleanup? (Y/n)
```

Wait for user confirmation before proceeding to Phase 2.

## Output

`analysisResult` object containing:

| Field | Type | Description |
|-------|------|-------------|
| `fileInventory` | object | Categorized file lists (tex, sty, bib, images, other) |
| `mainFile` | string | Path to identified main .tex file |
| `conferenceType` | object | `{class, options, conference, anonymous}` |
| `issues` | array | List of diagnosed issues with severity |
| `approvedPlan` | boolean | Whether user approved the cleanup plan |
| `tempDir` | string | Path to temporary extraction directory |

## Next Phase

Phase 2: Cleanup & Organize (`phases/02-cleanup-organize.md`)
- Receives: `analysisResult`, `sectionStructure`, `outputDir`
- Creates the clean directory structure and reorganizes files
