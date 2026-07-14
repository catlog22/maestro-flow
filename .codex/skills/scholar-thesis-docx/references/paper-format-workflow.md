# Thesis Word Formatting Workflow

## 1. Environment Gate

1. 先运行 `scripts/check_word_com.ps1 -Json`。
2. 若 `wordInstalled=false` 或 `comAvailable=false` 或 `domAvailable=false`：
   - Stop the automation-heavy plan.
   - Tell the user to install desktop Microsoft Word.
   - Explain that WPS and similar tools often distort styles, pagination,
     captions, tables of contents, and cross-references.
3. 只有在 Word COM/DOM 可用时，才进入自动化文档编辑流程。

## 2. Formatting Rules

1. If the user provides a school template, style guide, screenshots, or page
   header/footer rules, follow them strictly.
2. If the user does not provide rules, do not invent school-specific standards.
3. Control formatting through styles, not scattered manual formatting.
4. Reuse and repair existing styles before creating new ones.

## 3. Suggested Style Groups

- `Body Text`
- `Heading 1` / `Heading 2` / `Heading 3`
- `Figure Caption`
- `Table Caption`
- `Code Listing`
- `References`
- `Abstract`, `Keywords`, and `Appendix Title`

## 4. Editing Order

1. Read the user requirements and current document structure.
2. Separate formatting scope into:
   - school-explicit requirements
   - user-explicit house rules
   - unspecified regions that must be preserved
3. Inspect style names, style IDs, fonts, spacing, indentation, numbering,
   section settings, and page-break behavior.
4. Map target styles to document styles.
5. Normalize only the parts that are justified by the rules.
6. Then fix page numbers, table of contents, sections, references, and figure
   numbering.
7. Export to PDF from Word and review every page.
8. Only after the PDF review passes, describe the task as complete.

## 4.1 Hidden Word Checks

When the visual result contradicts the style readout, inspect:

- `firstLine`
- `firstLineChars`
- direct paragraph `w:ind`
- numbering indentation
- `titlePg`
- `differentFirstPageHeaderFooter`
- REF field display text
- direct run formatting

Do not assume `python-docx` style inspection is enough for thesis work.

## 5. Do Not Do This

- Do not mix heavy direct formatting with style-driven formatting.
- Do not invent school rules when the template evidence is missing.
- Do not treat WPS rendering as the final Word result.
- Do not globally normalize the entire document before finishing a full audit.
- Do not claim the thesis is fully checked before page-level PDF review.
