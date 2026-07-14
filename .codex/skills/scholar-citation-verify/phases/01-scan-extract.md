# Phase 1: Scan & Extract

## Objective

Scan the paper directory for .tex and .bib files, parse all BibTeX entries, extract \cite{} commands from LaTeX sources, and cross-reference citation usage to produce a complete citationEntries list with full metadata.

## Execution

### Step 1: Discover Paper Files

Scan `{{paperDir}}` recursively for all relevant files:

- **BibTeX files**: `*.bib` -- contain reference definitions
- **LaTeX files**: `*.tex` -- contain citation commands
- **Auxiliary files**: `*.aux` -- may contain resolved citation keys (optional)

Use Glob or filesystem traversal. Exclude common non-paper directories (e.g., `node_modules`, `.git`, `build`).

### Step 2: Parse BibTeX Entries

For each `.bib` file found, parse all entries and extract every field:

**Entry types to handle:**
- `@article` -- journal papers
- `@inproceedings` / `@conference` -- conference papers
- `@book` -- books
- `@incollection` -- book chapters
- `@phdthesis` / `@mastersthesis` -- theses
- `@techreport` -- technical reports
- `@misc` -- preprints, websites, other

**Fields to extract per entry:**
- `ID` (citation key)
- `ENTRYTYPE`
- `author`, `title`, `year`
- `journal`, `booktitle`, `publisher`
- `volume`, `number`, `pages`
- `doi`, `url`, `arxiv_id` (extract from `eprint`, `url`, or `note` fields)
- `abstract`, `keywords`
- All other fields present

**Parsing rules:**
- Handle LaTeX special characters in field values (`{\"o}`, `\'{e}`, etc.)
- Preserve braces in titles (e.g., `{BERT}` to maintain capitalization)
- Normalize author names to a consistent format
- Handle `and` as author separator
- Handle string concatenation with `#`

### Step 3: Extract \cite{} Commands from .tex Files

Scan all `.tex` files for citation commands using regex patterns:

**Citation command patterns:**
```
\cite{key}
\cite{key1,key2,key3}
\cite[prefix][suffix]{key}
\citep{key}
\citet{key}
\citep{key1,key2}
\citeauthor{key}
\citeyear{key}
\citealt{key}
\citealp{key}
\nocite{key}
\nocite{*}
```

**Regex pattern (comprehensive):**
```
\\(?:cite[tp]?|citeauthor|citeyear|citealt|citealp|nocite)(?:\[[^\]]*\])*\{([^}]+)\}
```

**Handle multi-citation commands:**
- Split comma-separated keys: `\cite{a,b,c}` produces keys `[a, b, c]`
- Trim whitespace from each key
- Record the source file and line number for each usage

### Step 4: Cross-Reference Citations

Build a mapping of which citations are used where:

```
citationKey -> {
  bibFile: "references.bib",
  texUsages: [
    { file: "main.tex", line: 42, command: "\\cite{key}" },
    { file: "related.tex", line: 15, command: "\\citep{key}" }
  ],
  usageCount: 2
}
```

Identify:
- **Undefined citations**: keys referenced in .tex but missing from .bib
- **Unused entries**: keys defined in .bib but never referenced in .tex
- **Duplicate keys**: same key defined in multiple .bib files

### Step 5: Build citationEntries List

Assemble the final output combining BibTeX metadata with usage data:

```
citationEntries = [
  {
    key: "vaswani2017attention",
    entryType: "inproceedings",
    fields: {
      author: "Vaswani, Ashish and Shazeer, Noam and ...",
      title: "Attention is All You Need",
      booktitle: "Advances in Neural Information Processing Systems",
      year: "2017",
      doi: "...",
      ...allOtherFields
    },
    source: {
      bibFile: "references.bib",
      texUsages: [...],
      usageCount: N
    },
    identifiers: {
      doi: "10.xxxx/yyyy" | null,
      arxiv_id: "1706.03762" | null,
      semantic_scholar_id: null
    },
    status: "pending_verification"
  },
  ...
]
```

## Output

- `citationEntries[]` -- complete list of all citations with metadata, usage info, and extracted identifiers
- `scanSummary` -- statistics: total .bib entries, total .tex citations, undefined count, unused count, duplicate count
- `undefinedCitations[]` -- keys used in .tex but missing from .bib
- `unusedEntries[]` -- keys defined in .bib but never used in .tex

## Next Phase

Pass `citationEntries` to **Phase 2: 4-Layer Verification** for format validation, existence checks, information matching, and content validation.
