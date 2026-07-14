# Failure Patterns and Quality Gates

Use this reference before bulk thesis formatting and before claiming the
document is fully checked.

## 1. Common Failure Patterns

### A. Global Over-Normalization

Symptoms:

- the user asked for headings, but page headers/footers changed too
- code boxes or table internals changed even though the school guide did not
  regulate them
- the assistant says "done" after a style pass, but the user immediately finds
  obvious visual regressions

Rule:

- If the school guide does not define a format, preserve the current state
  unless the user explicitly asks for redesign.

### B. Style Name Looks Right, Effective Formatting Is Wrong

Symptoms:

- a paragraph uses the expected style name but still looks wrong
- Word and WPS render the same paragraph differently

Likely causes:

- direct paragraph formatting overrides the style
- direct run formatting overrides the style
- the visual style name is mapped to an unexpected style ID
- the style inherits hidden indentation or spacing from `Normal`

Check:

- style ID
- paragraph direct formatting
- run direct formatting
- basedOn chain

### C. Hidden Indentation

Symptoms:

- headings appear indented even after `firstLineIndent = 0`
- the user can manually delete what looks like "two leading spaces"

Likely causes:

- `firstLineChars`
- numbering indentation
- direct `w:ind` on the paragraph

Check both:

- `w:firstLine`
- `w:firstLineChars`

### D. First-Page Section Drift

Symptoms:

- some pages have page headers, some do not
- some pages have page numbers, some do not
- abstract, TOC, or chapter-first pages behave inconsistently

Likely causes:

- `differentFirstPageHeaderFooter`
- `titlePg`
- broken section references to header/footer parts

### E. Cross-Reference Drift

Symptoms:

- the caption says `图6-1`, but the body still shows `图5-43`
- the cross-reference field exists, but the rendered text is stale
- the field result contains extra leftover text such as `图6-15-43`

Likely causes:

- REF fields not refreshed in Word
- stale display text run not removed
- caption renumbered without updating field result text

### F. Code Box Header Row Clipping

Symptoms:

- WPS shows the title row correctly, Word shows only the top half
- title rows look left-aligned even though the table looks centered

Likely causes:

- title paragraph has direct `jc=left`
- row height uses `EXACT` and is too small for Word
- cell margins differ across tables
- `keepNext` / `keepLines` remain on title paragraphs

Preferred fix:

- center the paragraph itself
- clear keep flags
- use `AT_LEAST` instead of `EXACT` when Word clips glyphs

### G. Punctuation Over-Correction

Symptoms:

- DOI, URL, code, or English references get rewritten with Chinese punctuation

Rule:

- Chinese prose, captions, abstracts, acknowledgements: full-width Chinese
  punctuation
- code, variables, URL, DOI, English references: half-width English punctuation
- do not mass-rewrite formulas, citations, or technical identifiers without an
  explicit rule

## 2. Required Quality Gates

Do not say the thesis is complete until these gates pass.

### Gate 1: Requirements Boundary

You must know:

- which items are explicitly regulated by the school guide
- which items are user-specific house rules
- which items are unspecified and must be preserved

### Gate 2: Structure Audit

Check:

- page size and margins
- heading hierarchy
- abstracts and keywords
- TOC title and TOC levels
- figure/table captions
- references
- acknowledgements
- section breaks and page number scheme

### Gate 3: OOXML Audit for Hidden Overrides

Check at least when something still looks wrong:

- `styleId`
- `firstLine`
- `firstLineChars`
- direct `w:ind`
- `titlePg`
- section header/footer references
- REF field display text

### Gate 4: Word PDF Review

Export the Word document to PDF and inspect all pages, not just selected pages.

At minimum verify:

- cover
- abstract pages
- TOC
- first page of body
- pages with dense figures or tables
- references
- acknowledgements

### Gate 5: Delivery Honesty

If any page was not visually reviewed, or if Word automation/PDF export was not
available, say so explicitly. Do not imply full completion.
