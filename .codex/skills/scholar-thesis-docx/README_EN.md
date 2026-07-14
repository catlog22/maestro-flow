# thesis-docx

[![License](https://img.shields.io/badge/license-MIT-16a34a)](./LICENSE)
[![Word](https://img.shields.io/badge/Microsoft_Word-Recommended-185ABD)](#runtime-requirements)
[![Mermaid](https://img.shields.io/badge/Mermaid-Supported-0ea5e9)](#features)

**Language**: [中文](./README.md) | **English**

`thesis-docx` is a skill for thesis and dissertation Word workflows.

Its purpose is not merely bulk formatting. The intended workflow is:

1. check Word automation first  
2. audit before editing  
3. strictly enforce school-defined rules  
4. preserve formatting that the school guide does not define  
5. export to PDF and review page by page

## Features

- revise thesis / dissertation Word documents
- normalize body text, headings, figure captions, table captions, and references
- fix TOC, page numbers, sections, cross-references, and caption numbering
- generate Mermaid figures from real source material
- prepare thesis-friendly code excerpts or pseudocode
- audit hidden OOXML issues such as:
  - `styleId`
  - `firstLineChars`
  - `titlePg`
  - REF field display text
  - section-level header/footer references

## Runtime Requirements

- desktop Microsoft Word is strongly recommended on Windows
- Python scripts typically expect:
  - `python-docx`
  - `lxml`
- Mermaid rendering typically expects:
  - Node.js
  - `mmdc` or a usable `npx`

## Quick Start

```powershell
# 1) Check Word COM/DOM availability
powershell -ExecutionPolicy Bypass -File scripts/check_word_com.ps1 -Json

# 2) Audit DOCX / OOXML first
python scripts/audit_docx_ooxml.py .\draft.docx --output_json .\draft.audit.json --output_txt .\draft.audit.txt

# 3) Dry-run style normalization first
powershell -ExecutionPolicy Bypass -File scripts/normalize_word_styles.ps1 -InputPath .\draft.docx -AuditOnly

# 4) Export to PDF for page-by-page review
powershell -ExecutionPolicy Bypass -File scripts/export_word_pdf.ps1 -DocPath .\draft.docx -PdfPath .\draft.audit.pdf
```

## Working Rules

- audit first, fix second
- prioritize school rules over local preferences
- do not globally normalize unspecified formatting
- keep figures, architecture, and code grounded in real materials
- do not claim completion before PDF-level review

## Repository Layout

```text
.
├── agents/
├── SKILL.md
├── scripts/
├── references/
├── examples/
├── README.md
├── README_EN.md
└── LICENSE
```

## Key Files

- `SKILL.md`: main instructions
- `agents/openai.yaml`: UI-facing metadata
- `scripts/check_word_com.ps1`: check Word COM/DOM availability
- `scripts/audit_docx_ooxml.py`: audit hidden DOCX / OOXML issues
- `scripts/normalize_word_styles.ps1`: batch style normalization
- `scripts/export_word_pdf.ps1`: export PDF for page review
- `scripts/render_mermaid_figure.ps1`: render Mermaid figures
- `references/paper-format-workflow.md`: thesis formatting workflow
- `references/failure-patterns-and-quality-gates.md`: common failure modes and quality gates
- `references/script-usage.md`: script examples and usage notes

## Installation

```powershell
git clone https://github.com/the-shy123456/thesis-docx.git
```

Keep the repository structure intact.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=the-shy123456/thesis-docx&type=Date)](https://www.star-history.com/#the-shy123456/thesis-docx&Date)

## License

MIT
