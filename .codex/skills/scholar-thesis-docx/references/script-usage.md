# Script Usage

## 1. Audit DOCX OOXML before risky edits

Use `scripts/audit_docx_ooxml.py` before batch formatting when the document has
already gone through multiple rounds of editing or when the visible result does
not match the style readout.

Example:

```powershell
python scripts/audit_docx_ooxml.py .\draft.docx `
  --output_json .\draft.audit.json `
  --output_txt .\draft.audit.txt
```

The script reports:

1. style IDs and key style definitions
2. section settings such as `titlePg` and header/footer references
3. heading paragraphs with direct indentation overrides
4. paragraphs using `firstLineChars`
5. suspicious REF fields with multiple result runs

The JSON output is suitable for agents and downstream tooling.
The TXT output is intended for quick human review.

Use this script before you decide whether a problem can be fixed through styles
or requires OOXML-level patching.

## 2. Normalize Word styles

Use `scripts/normalize_word_styles.ps1` after `check_word_com.ps1` confirms
that Word COM automation is available.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/normalize_word_styles.ps1 `
  -InputPath .\draft.docx `
  -OutputPath .\draft.normalized.docx
```

Dry-run audit example:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/normalize_word_styles.ps1 `
  -InputPath .\draft.docx `
  -AuditOnly
```

The script:

1. Opens the Word document through COM automation.
2. Resolves or creates target styles.
3. Applies style definitions for body text, Heading 1-3, figure captions, and
   table captions.
4. Uses existing style hints first, then falls back to text-pattern detection.
5. Saves a new file unless `-InPlace` is provided.

When `-AuditOnly` is used, the script does not save document changes. It only
returns the predicted paragraph-to-style mappings and summary counts.

Use `-ConfigPath` to pass a UTF-8 JSON file with custom style names or school
rules.

Repository example:

```text
examples/word-style-config.sample.json
examples/final-audit-checklist.sample.md
```

Example JSON:

```json
{
  "styles": {
    "Body": {
      "TargetStyleName": "正文",
      "FontName": "Times New Roman",
      "EastAsiaFontName": "宋体",
      "Size": 12,
      "LineSpacingMultiple": 1.5
    },
    "FigureCaption": {
      "TargetStyleName": "图标注"
    },
    "TableCaption": {
      "TargetStyleName": "表标注"
    }
  }
}
```

## 3. Render Mermaid figures

Use `scripts/render_mermaid_figure.ps1` to render Mermaid source into thesis
figure assets.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/render_mermaid_figure.ps1 `
  -InputPath .\architecture.mmd `
  -OutputPath .\figures\architecture.svg `
  -Theme base `
  -Width 1800 `
  -Height 1200 `
  -Scale 2
```

The script:

1. Prefers local `mmdc` when it exists.
2. Falls back to `npx @mermaid-js/mermaid-cli` when needed.
3. Generates a clean academic default theme config if no config is provided.
4. Produces SVG, PNG, or PDF output depending on the output filename and CLI
   behavior.

Repository example:

```text
examples/architecture.sample.mmd
```

For thesis work, prefer SVG first, then convert to PNG only when the target
submission system or Word workflow requires raster images.

## 4. Export Word document to PDF for page audit

Use `scripts/export_word_pdf.ps1` after important formatting changes and before
you claim the thesis is fully checked.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export_word_pdf.ps1 `
  -DocPath .\draft.docx `
  -PdfPath .\draft.audit.pdf
```

The script:

1. Opens the document through Word COM automation.
2. Tries to refresh TOC and field results first.
3. Exports the document to PDF.
4. Produces a stable artifact for page-by-page review.

Use this whenever the task involves:

- headers/footers
- page numbers
- table of contents
- cross-references
- figure/table pagination
- final pre-delivery format review
