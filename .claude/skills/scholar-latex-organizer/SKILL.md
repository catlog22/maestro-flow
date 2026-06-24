---
name: scholar-latex-organizer
description: Organize messy conference LaTeX template .zip files into clean Overleaf-ready structure. Extracts, analyzes, cleans up, and generates README with submission requirements. Triggers on "organize LaTeX template", "clean up template", "prepare Overleaf template", "整理LaTeX模板".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, TodoWrite
---

# Scholar LaTeX Organizer

Transform messy conference LaTeX template .zip files into clean, Overleaf-ready submission templates. Official templates often contain excessive examples and disorganized files — this skill converts them into templates ready for writing.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
User: "Organize this LaTeX template"
         |
         v
┌──────────────────────────────────────────────────────────────┐
│  SKILL.md (Orchestrator)                                      │
│  Collect preferences → Dispatch phases → Track progress       │
└──────────┬───────────────────────────────────────────────────┘
           |
   ┌───────┼───────────┬──────────────┐
   v       v           v              v
┌──────┐┌──────────┐┌──────────────┐
│ P1   ││ P2       ││ P3           │
│Extract││ Cleanup  ││ README &     │
│ &    ││ &        ││ Finalize     │
│Analyze││ Organize ││              │
└──┬───┘└────┬─────┘└──────┬───────┘
   │         │             │
   v         v             v
 analysis   clean        output/
 + plan     structure    (Overleaf-ready)
```

## Key Design Principles

1. **Analyze-then-confirm**: First present findings, then execute after user approval.
2. **Preserve template integrity**: Keep all .sty/.cls files unchanged — only clean up .tex content.
3. **Section separation**: Split monolithic main.tex into modular text/ files.
4. **Conference-aware**: Detect document class and apply conference-specific configurations.

## Interactive Preference Collection

Before dispatching to any phase, collect these preferences:

```
Questions to ask the user:

1. Template Source
   "Where is the template .zip file? (path)"
   → templatePath

2. Conference Info
   "Conference name or submission page URL (for extracting requirements)"
   → conferenceInfo

3. Output Directory
   "Where should the organized template go? (default: ./output/)"
   → outputDir

4. Section Structure
   Options: Standard (intro/related/method/experiments/conclusion) | Custom
   → sectionStructure
```

Store responses as `organizerPreferences` context for all phases.

## Auto Mode Defaults

When `workflowPreferences.autoYes === true`:
- Use .zip file from cwd or recent downloads
- Standard section structure
- Output to ./output/
- Auto-detect conference from template
- Skip confirmation prompts

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase — preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### TodoWrite Setup

```
LaTeX Template Organization:
- [ ] Phase 1: Extract & Analyze — extract zip, identify files, diagnose issues
- [ ] Phase 2: Cleanup & Organize — create structure, clean main.tex, copy assets
- [ ] Phase 3: README & Finalize — generate README, verify compilation
```

### Phase Sequence

```
Phase 1: Extract & Analyze
   └─ Ref: phases/01-extract-analyze.md
      ├─ Input: templatePath, conferenceInfo
      └─ Output: analysisResult (file inventory, main file, issues, conference type)

Phase 2: Cleanup & Organize
   └─ Ref: phases/02-cleanup-organize.md
      ├─ Input: analysisResult, sectionStructure, outputDir
      └─ Output: organized template in outputDir/

Phase 3: README & Finalize
   └─ Ref: phases/03-readme-finalize.md
      ├─ Input: analysisResult, conferenceInfo, outputDir
      └─ Output: README.md + final verification
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-extract-analyze.md](phases/01-extract-analyze.md) | Extract and analyze template | TodoWrite driven |
| 2 | [phases/02-cleanup-organize.md](phases/02-cleanup-organize.md) | Clean up and restructure | TodoWrite driven + sentinel |
| 3 | [phases/03-readme-finalize.md](phases/03-readme-finalize.md) | Generate README, finalize | TodoWrite driven |

**Compact Rules**:
1. **TodoWrite `in_progress`** → preserve full content, do not compress
2. **TodoWrite `completed`** → may compress to summary
3. **sentinel fallback** → phases marked with sentinel contain compact sentinel; if only sentinel remains, **must immediately `Read()` to recover**

## Core Rules

1. **Never modify .sty/.cls files**: Style files are sacred — copy as-is.
2. **Present plan before executing**: Show cleanup plan and wait for user confirmation.
3. **Keep Overleaf-compatible**: Empty directories need placeholder files (Overleaf auto-deletes empty dirs).
4. **Preserve compilation**: The output must compile without errors using the detected compiler.
5. **Conference-specific configs**: Apply correct anonymous/review mode settings per conference.

## Common Conference Templates

| Conference | Document Class | Key Config |
|------------|---------------|------------|
| KDD (ACM) | `acmart` | `nonacm` option for anonymous submission |
| ACM Conferences | `acmart` | `anonymous,review` options |
| CVPR/ICCV | `cvpr` | Two-column, strict page limits |
| NeurIPS | `neurips_20XX` | Anonymous review |
| ICLR | `iclr20XX_conference` | Two-column |
| AAAI | `aaaiXX` | Two-column, 8 pages + refs |

## Data Flow

```
Phase 1 ──analysisResult──→ Phase 2
Phase 1 ──analysisResult──→ Phase 3

Output structure:
  outputDir/
  ├── main.tex              (cleaned main file)
  ├── text/                 (section files)
  │   ├── 01-introduction.tex
  │   ├── 02-related-work.tex
  │   ├── 03-method.tex
  │   ├── 04-experiments.tex
  │   └── 05-conclusion.tex
  ├── figures/              (image files)
  ├── tables/               (table files + example)
  ├── styles/               (.sty/.cls files)
  ├── references.bib        (bibliography)
  └── README.md             (usage guide)
```

## Error Handling

| Error | Action |
|-------|--------|
| Zip extraction fails | Check file integrity, ask user to re-download |
| Main file not identifiable | List all .tex files, ask user to choose |
| Missing dependency (.sty/.cls) | Warn user, suggest CTAN download |
| Conference info unavailable | Fall back to template comments + documentclass detection |
| Compilation fails after cleanup | Revert to minimal cleanup, report what needs manual fix |

## Related Skills

- **scholar-writing**: Phase 6 (Conference Formatting) uses organized templates
- **scholar-publish**: Uses templates for camera-ready preparation
