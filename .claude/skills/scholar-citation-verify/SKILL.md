---
name: scholar-citation-verify
description: Four-layer citation verification for academic papers. Scans LaTeX/BibTeX files, verifies every citation via WebSearch and Google Scholar, generates verification report with fix suggestions. Triggers on "verify citations", "check references", "citation verification", "prevent fake citations", "引用验证".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, TodoWrite
---

# Scholar Citation Verify

Four-layer citation verification workflow for academic papers. Scans paper files, verifies every citation through WebSearch/Google Scholar/APIs, and produces a verification report with actionable fixes.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
User: "Verify citations in my paper"
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
│ Scan ││ Verify   ││ Report       │
│ &    ││ 4-Layer  ││ & Fix        │
│Extract││          ││              │
└──┬───┘└────┬─────┘└──────┬───────┘
   │         │             │
   v         v             v
 citation   verified     report.md
 entries    results      + fixed .bib
```

## Key Design Principles

1. **Never trust AI-generated citations**: AI citations have ~40% error rate. Every single citation must be verified via external search.
2. **Verify during writing, not after**: Proactive verification integrated into the writing process.
3. **Four-layer verification**: Format → Existence → Information Matching → Content Validation.
4. **Clear failure marking**: Unverifiable citations marked as `[CITATION NEEDED]`, never silently skipped.

## Interactive Preference Collection

Before dispatching to any phase, collect these preferences:

```
Questions to ask the user:

1. Paper Location
   "Where are the paper files? (directory path)"
   → paperDir

2. Verification Mode
   Options: Full (all citations) | Incremental (new/changed only) | Spot Check (random sample)
   → verificationMode

3. Strictness Level
   Options: Strict (for submission) | Normal (for draft) | Lenient (quick check)
   → strictness

4. Auto-fix
   Options: Yes (auto-fix format issues) | No (report only)
   → autoFix
```

Store responses as `verifyPreferences` context for all phases.

## Auto Mode Defaults

When `workflowPreferences.autoYes === true`:
- Detect paper directory from cwd
- Full verification mode, Normal strictness
- Auto-fix enabled
- Skip confirmation prompts

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase — preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### TodoWrite Setup

```
Citation Verification:
- [ ] Phase 1: Scan & Extract — find .tex/.bib files, extract all citations
- [ ] Phase 2: 4-Layer Verify — format, existence, matching, content checks
- [ ] Phase 3: Report & Fix — generate report, apply fixes
```

### Phase Sequence

```
Phase 1: Scan & Extract
   └─ Ref: phases/01-scan-extract.md
      ├─ Input: paperDir, verificationMode
      └─ Output: citationEntries (list of all citations with metadata)

Phase 2: 4-Layer Verify
   └─ Ref: phases/02-verify.md
      ├─ Input: citationEntries, strictness
      └─ Output: verificationResults (per-citation status + details)

Phase 3: Report & Fix
   └─ Ref: phases/03-report-fix.md
      ├─ Input: verificationResults, autoFix
      └─ Output: report.md + optionally fixed .bib file
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-scan-extract.md](phases/01-scan-extract.md) | Scan files, extract citations | TodoWrite driven |
| 2 | [phases/02-verify.md](phases/02-verify.md) | 4-layer verification | TodoWrite driven + sentinel |
| 3 | [phases/03-report-fix.md](phases/03-report-fix.md) | Generate report, apply fixes | TodoWrite driven |

**Compact Rules**:
1. **TodoWrite `in_progress`** → preserve full content, do not compress
2. **TodoWrite `completed`** → may compress to summary
3. **sentinel fallback** → phases marked with sentinel contain compact sentinel; if only sentinel remains, **must immediately `Read()` to recover**

## Core Rules

1. **Every citation must be checked**: No citation passes without at least existence verification.
2. **Use real APIs**: Verify via WebSearch, Google Scholar, Semantic Scholar, CrossRef, arXiv — never trust memory.
3. **Mark failures clearly**: Use `[CITATION NEEDED]` for unverifiable references.
4. **Preserve user's formatting choices**: When auto-fixing, only fix errors, don't restyle.
5. **Report honestly**: Show verification confidence levels, don't hide partial matches.

## Data Flow

```
Phase 1 ──citationEntries──→ Phase 2
Phase 2 ──verificationResults──→ Phase 3

Data persistence: Results written to paperDir/.verify/
  paperDir/.verify/
  ├── citations-extracted.json    (Phase 1 output)
  ├── verification-results.json   (Phase 2 output)
  ├── verification-report.md      (Phase 3 output)
  └── references-fixed.bib        (Phase 3 output, if autoFix)
```

## Error Handling

| Error | Action |
|-------|--------|
| No .tex/.bib files found | Ask user for correct directory |
| API rate limit hit | Wait and retry with exponential backoff |
| Citation not found in any API | Mark as `[CITATION NEEDED]`, continue |
| BibTeX parse error | Report unparseable entry, skip and continue |
| Network unavailable | Fall back to format-only verification |

## Related Skills

- **scholar-writing**: Phase 4 (Citation Management) uses these verification principles
- **scholar-review**: References verification as part of paper quality check
