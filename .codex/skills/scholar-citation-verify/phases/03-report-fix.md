# Phase 3: Report & Fix

## Objective

Generate a comprehensive verification report summarizing all results, and optionally apply auto-fixes to correct BibTeX format errors, update incorrect fields from API data, and produce a cleaned references file.

## Execution

### Step 1: Generate verification-report.md

Create a Markdown report in the output directory with the following structure:

**1.1 Summary Statistics**

```markdown
# Citation Verification Report

## Summary

| Metric | Count |
|--------|-------|
| Total Citations | N |
| Verified (high confidence) | N |
| Partial Match (medium confidence) | N |
| Low Match | N |
| Failed | N |
| Not Found | N |

**Verification Rate**: X% of citations fully verified
**Mode**: strict | normal | lenient
**Date**: YYYY-MM-DD
```

**1.2 Per-Citation Results Table**

```markdown
## Detailed Results

| # | Citation Key | Type | Title (truncated) | Score | Confidence | Issues |
|---|-------------|------|-------------------|-------|------------|--------|
| 1 | vaswani2017 | article | Attention is All... | 0.95 | high | 0 |
| 2 | smith2020 | inproceedings | Deep Learning... | 0.72 | medium | 2 |
| 3 | fake2021 | article | Nonexistent... | 0.00 | failed | 1 |
```

For each citation with issues, include an expandable details section:
```markdown
### vaswani2017 - Attention is All You Need
- **Score**: 0.95 (high confidence)
- **Format**: PASSED
- **Existence**: Found via CrossRef
- **Title Match**: 0.98
- **Author Match**: 0.92
- **Year Match**: exact
- **Issues**: None
```

**1.3 Issues Grouped by Severity**

```markdown
## Issues

### Critical Issues
Citations that may be fabricated or fundamentally incorrect.

- **fake2021**: Paper not found in any database. No matching results on Google Scholar.
  - Action required: Verify this citation manually or remove it.

### High Severity Issues
Citations with significant information errors.

- **smith2020**: First author mismatch. BibTeX: "Smith, John" / API: "Johnson, Mark"
  - Suggested fix: Update author field to match published record.

### Medium Severity Issues
BibTeX format and metadata quality issues.

- **doe2019**: Missing DOI field. DOI found via CrossRef: 10.1234/example
  - Suggested fix: Add doi={10.1234/example}
- **lee2021**: Year format error: "20201" (5 digits)
  - Suggested fix: Correct to year={2021}

### Low Severity Issues
Style and consistency issues.

- **brown2020**: Author name format inconsistent with other entries.
  - Suggestion: Standardize to "Last, First" format.
```

### Step 2: Auto-Fix (When Enabled)

Auto-fix is activated when the user passes `autoFix: true` or requests corrections. Apply fixes conservatively -- only fix issues where the correction is unambiguous.

**2.1 Fix BibTeX Format Errors**

- Add missing required fields if data is available from API
- Correct year format (strip non-digits, truncate/pad to 4 digits)
- Fix DOI format: remove `doi:` prefix, remove `https://doi.org/` prefix, remove trailing punctuation
- Fix unbalanced braces
- Normalize page ranges to `N--M` format

**2.2 Update Incorrect Fields from API Data**

Only update when confidence is high (API data is clearly more accurate):

- **Title**: Update if API title similarity is > 0.7 but < 0.85 (minor differences suggest BibTeX has a typo)
- **Year**: Update if API year differs by 1 and API source is CrossRef (authoritative)
- **DOI**: Add DOI from API if missing in BibTeX
- **Authors**: Do NOT auto-fix author names (too risky for false corrections)

**2.3 Standardize Author Name Format**

When `standardizeAuthors: true`:
- Convert all author names to a consistent format: `Last, First and Last, First`
- Handle multi-part last names carefully (e.g., "van der Berg" stays together)
- Preserve original names if parsing is ambiguous

**2.4 Add Missing DOIs**

For entries without DOI where the API returned one:
- Add `doi = {10.xxxx/yyyy}` field
- This improves citation quality and enables future verification

**2.5 Remove Duplicate Entries**

When duplicate citations are detected (title similarity > 0.9, same year, overlapping authors):
- Keep the more complete entry (more fields filled)
- Keep the entry with DOI if only one has it
- Update all .tex references to use the retained key
- Record removals in the report

### Step 3: Generate Fixed References File

If auto-fix was applied, generate `references-fixed.bib`:

- Preserve original entry ordering
- Preserve comments and formatting where possible
- Add a header comment documenting what was changed:

```bibtex
% Citation Verification - Auto-fixed references
% Generated: YYYY-MM-DD
% Fixes applied: N format fixes, M field updates, K DOIs added, J duplicates removed
% Original file: references.bib

@article{vaswani2017attention,
  author    = {Vaswani, Ashish and Shazeer, Noam and ...},
  title     = {Attention is All You Need},
  ...
}
```

Also generate a `fix-changelog.md` documenting every change:
```markdown
# Fix Changelog

## Format Fixes
- **doe2019**: Fixed year format "20201" -> "2021"
- **lee2021**: Fixed DOI format "doi:10.1234/x" -> "10.1234/x"

## Field Updates
- **smith2020**: Updated title from API (CrossRef)
- **brown2020**: Added missing DOI: 10.5678/y

## Duplicates Removed
- Removed **vaswani2017** (duplicate of **vaswani2017attention**)
  - Updated \cite{vaswani2017} -> \cite{vaswani2017attention} in main.tex:42
```

### Step 4: Output File Placement

Place all output files in the designated output directory:

```
{outputDir}/
  verification-report.md      -- Full verification report
  references-fixed.bib        -- Corrected references (if autoFix enabled)
  fix-changelog.md            -- Change log (if autoFix enabled)
  verification-data.json      -- Machine-readable verification results (optional)
```

## Output

- `verification-report.md` -- Human-readable report with summary, per-citation details, and issues by severity
- `references-fixed.bib` -- Corrected BibTeX file (only if autoFix enabled)
- `fix-changelog.md` -- Detailed log of all changes applied (only if autoFix enabled)

## Next Phase

This is the final phase. Verification workflow is complete. Present the report to the user and highlight any Critical or High severity issues that require manual attention.
