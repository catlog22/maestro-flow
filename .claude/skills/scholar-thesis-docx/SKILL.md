---
name: thesis-docx
description: Create, revise, and format thesis or dissertation Word documents with strict academic formatting control. Use when an AI agent needs to generate or revise thesis content, normalize Word styles, follow a school template, fix captions or page numbers or section levels, or produce evidence-based Mermaid figures and LaTeX-formatted code listings for a thesis document.
session-mode: none
---

# Thesis DOCX

## Overview

Use this skill for thesis-oriented `.docx` work where content quality and
format fidelity both matter. Prefer Microsoft Word desktop automation over
WPS-like alternatives whenever the task involves batch formatting, styles,
captions, pagination, tables of contents, or cross-references.

This skill is designed to avoid the most common thesis-editing failure mode:
the agent makes broad formatting changes too early, introduces new layout
problems, and then forces the user to catch them one by one. The default
behavior should therefore be:

1. audit first,
2. separate explicit school requirements from unspecified formatting,
3. fix only what is justified,
4. re-check page by page before claiming completion.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "thesis academic writing docx formatting" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Workflow

1. Check Microsoft Word and COM/DOM automation first.
   - On Windows, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/check_word_com.ps1 -Json
   ```
   - If Word is missing, COM is unavailable, or DOM access fails:
     - Stop the automation-heavy plan.
     - Tell the user to install desktop Microsoft Word.
     - Explain briefly that WPS or similar tools are likely to degrade layout
       fidelity for thesis formatting.
2. Read the user's real constraints before editing.
   - Collect the thesis template, school formatting guide, screenshots,
     existing document, sample pages, and any explicit chapter rules.
   - If the user gave formal requirements, follow them strictly.
   - If the user did not give requirements, do not invent school-specific
     standards. Use conservative academic defaults and say that they are
     defaults.
   - Explicitly classify requirements into two buckets before editing:
     - `must enforce`: school guide, template, user-confirmed style rules
     - `preserve current state`: anything the school guide does not define
3. Audit the DOCX / OOXML before risky bulk edits.
   - Prefer `scripts/audit_docx_ooxml.py` before large-scale formatting.
   - Use it to detect hidden indentation, section drift, stale REF display
     text, and style-ID mismatches before deciding on a repair strategy.
4. Standardize with styles, not scattered direct formatting.
   - Reuse and repair existing styles whenever possible.
   - Create missing styles only when no matching style exists.
   - Keep body text, headings, figure captions, table captions, references,
     abstract, and appendix styles separate and consistent.
   - Before changing any style globally, inspect whether the document contains
     direct paragraph formatting or OOXML overrides that will survive the style
     change.
5. Edit content only from user-provided facts.
   - Expand, polish, or reorganize thesis text only within the user's topic,
     evidence, codebase, notes, or source material.
   - Do not invent experimental data, system structure, entities, or results.
6. Generate figures only when the source material is sufficient.
   - Use Mermaid for architecture diagrams, E-R diagrams, flow charts, state
     diagrams, and similar thesis figures.
   - Base every node, field, relation, and dependency on real materials from
     the user, such as code, SQL schema, API docs, project docs, or the thesis
     draft itself.
   - If the materials are insufficient, refuse to fabricate the figure and ask
     for the missing source information.
7. Typeset code with LaTeX conventions when thesis code excerpts are needed.
   - Keep only the code relevant to the argument.
   - Preserve real identifiers from the user's code or design.
   - Avoid synthetic filler code written only to look complete.
8. Audit before you claim completion.
   - Run a structure audit first: styles, sections, captions, references,
     page number scheme, cross-references, hidden paragraph overrides.
   - Then export the document to PDF from Word and review page by page.
   - Only say the task is complete after the PDF-level audit passes or after
     you clearly state the remaining manual visual checks.

## Style Strategy

- Treat styles as the single source of truth for formatting.
- Prefer these logical style buckets:
  - `Body Text`
  - `Heading 1` / `Heading 2` / `Heading 3`
  - `Figure Caption`
  - `Table Caption`
  - `References`
  - `Abstract`
  - `Keywords`
  - `Appendix Title`
- If the document already has equivalent styles, map to them and normalize
  their font, spacing, indentation, and numbering behavior.
- If direct formatting conflicts with styles, reduce the direct formatting and
  bring the document back under style control.
- Do not globally normalize sections that the school guide does not specify.
  Examples of high-risk overreach:
  - page header/footer redesign when the user only asked for headings
  - changing code box appearance when the task is only about references
  - normalizing table internals when the school guide does not regulate them
- When a visual issue remains after style normalization, inspect hidden OOXML
  state such as `firstLineChars`, numbering indentation, `titlePg`,
  `differentFirstPageHeaderFooter`, REF field display text, and direct run
  formatting.

## Audit-First Discipline

Before bulk editing, produce and internally follow a checklist like this:

1. Which parts are explicitly regulated by the school guide?
2. Which parts are user-defined house rules?
3. Which parts are currently acceptable and must be preserved?
4. Which problems are structural vs. visual-only?
5. Which fixes can be done safely through styles?
6. Which fixes require Word COM or OOXML-level patching?

Do not say "finished" merely because a structural audit looks good. For thesis
work, pagination and page-level rendering are part of correctness.

## High-Risk Pitfalls

Read `references/failure-patterns-and-quality-gates.md` before large-scale
formatting work. In particular, guard against:

- style names that look correct but map to the wrong style IDs
- paragraph-level direct formatting that overrides the intended style
- `firstLineChars` or numbering indentation creating invisible extra indents
- TOC fields or cross-reference fields showing stale display text
- section-level first-page settings causing missing headers or page numbers
- Word vs. WPS differences for table row height, vertical alignment, and code
  box title clipping
- punctuation normalization that accidentally rewrites DOI, URLs, code, or
  English references

## Visual Review Rule

For school-format-sensitive thesis work, final verification should prefer this
order:

1. Word COM/DOM structural checks
2. Word export to PDF
3. page-by-page PDF review
4. only then final delivery language

If page rendering cannot be verified, say so explicitly instead of implying the
 formatting is fully validated.

## Figure Rules

- Use Mermaid when a thesis figure is needed and the structure can be traced to
  real source material.
- Keep the diagram academically neutral and concise.
- Avoid decorative labels, chatty callouts, and speculative entities.
- Match the user's terminology unless it conflicts with the real materials.
- Read `references/figure-and-code-rules.md` before generating diagrams.

## Code Listing Rules

- Prefer LaTeX-oriented code presentation when the thesis includes code
  listings.
- Keep the listing faithful to the actual code.
- Trim non-essential boilerplate when it does not support the thesis argument.
- If the user requests a specific LaTeX package or listing style, follow it.

## Resource Guide

- `scripts/check_word_com.ps1`
  - Detect whether Microsoft Word desktop and COM/DOM automation are available.
- `scripts/audit_docx_ooxml.py`
  - Audit DOCX styles, direct indentation, section settings, numbering, and REF
    field behavior before making risky formatting changes.
- `scripts/normalize_word_styles.ps1`
  - Batch-normalize thesis body text, Heading 1-3, figure captions, and table
    captions through Word COM automation.
- `scripts/export_word_pdf.ps1`
  - Export the current thesis document to PDF through Word COM for page-level
    review.
- `scripts/render_mermaid_figure.ps1`
  - Render Mermaid source into thesis-ready SVG, PNG, or PDF figure assets.
- `references/paper-format-workflow.md`
  - Read for the standard Word thesis formatting workflow.
- `references/figure-and-code-rules.md`
  - Read before generating Mermaid figures or LaTeX code listings.
- `references/failure-patterns-and-quality-gates.md`
  - Read before large-scale formatting or before claiming the thesis is fully
    checked.
- `references/script-usage.md`
  - Read for command examples and config file conventions.

## Final Checks

- Confirm the document is still style-driven after edits.
- Confirm captions, numbering, page breaks, and table of contents are coherent.
- Confirm cross-references display the current target labels, not stale field
  text.
- Confirm section settings do not silently remove page headers or page numbers
  from first pages.
- Confirm references are formatted according to the school rules and that
  punctuation normalization did not damage DOI or English references.
- Confirm every diagram and code block is grounded in user-provided material.
- Export to PDF and inspect every page before saying the format is complete.
- If Word automation or PDF verification was unavailable, explicitly warn that
  layout fidelity was not guaranteed.
