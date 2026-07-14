# Phase 2: 4-Layer Verification

<!-- COMPACT SENTINEL: This phase contains dense verification logic. Process all 4 layers sequentially. Do not skip or summarize any layer. -->

## Objective

Verify every citation entry through a 4-layer verification pipeline: Format Validation, Existence Verification, Information Matching, and Content Validation. Produce a verificationResults list with per-citation scores and confidence levels.

## Verification Thresholds Configuration

Before starting verification, load threshold configuration based on the requested mode:

```
thresholds:
  strict:    # For final submission / camera-ready
    title_similarity: 0.90
    author_similarity: 0.80
    year_tolerance: 0
    high_confidence: 0.95
    medium_confidence: 0.75
    low_confidence: 0.55
  normal:    # Default mode
    title_similarity: 0.85
    author_similarity: 0.70
    year_tolerance: 1
    high_confidence: 0.90
    medium_confidence: 0.70
    low_confidence: 0.50
  lenient:   # For early drafts / exploratory
    title_similarity: 0.80
    author_similarity: 0.60
    year_tolerance: 2
    high_confidence: 0.85
    medium_confidence: 0.65
    low_confidence: 0.45

weights:
  title: 0.4
  authors: 0.3
  year: 0.2
  venue: 0.1
```

## Execution

### Layer 1: Format Validation

Check BibTeX structure and field formats for each citation entry.

**Step 1.1: Required Fields Check**

Validate that each entry type has its required fields:

| Entry Type | Required Fields |
|---|---|
| `@article` | `author`, `title`, `journal`, `year` |
| `@inproceedings` | `author`, `title`, `booktitle`, `year` |
| `@book` | `author` OR `editor`, `title`, `publisher`, `year` |
| `@incollection` | `author`, `title`, `booktitle`, `publisher`, `year` |
| `@phdthesis` | `author`, `title`, `school`, `year` |
| `@mastersthesis` | `author`, `title`, `school`, `year` |
| `@techreport` | `author`, `title`, `institution`, `year` |
| `@misc` | `title` |

For each missing required field, record a format error with severity "high".

**Step 1.2: Field Format Checks**

Validate field value formats:

- **year**: Must be exactly 4 digits, in range 1900-2030. Flag non-numeric or out-of-range values.
- **doi**: Must start with `10.`. Flag values with `doi:` prefix, full URL prefix (`https://doi.org/`), or trailing punctuation.
- **author**: Check for consistent format (`Last, First and Last, First` or `First Last and First Last`). Flag mixed formats.
- **pages**: Should follow `N--M` or `N-M` format. Flag malformed ranges.
- **url**: Must be a valid URL format if present.
- **title**: Flag if entirely lowercase (likely missing capitalization protection).

**Step 1.3: Entry Structure Check**

- Verify entry has a valid `ENTRYTYPE`
- Verify entry has a non-empty citation key (`ID`)
- Check for unbalanced braces in field values
- Check for encoding issues in field values

Record all Layer 1 results:
```
layer1Result = {
  passed: boolean,
  errors: [{ field, message, severity }],
  warnings: [{ field, message }]
}
```

<!-- CHECKPOINT: Layer 1 complete. Proceed to Layer 2 for each entry that has sufficient data for API lookup. -->

### Layer 2: Existence Verification

Verify that each cited paper actually exists using external APIs and web search.

**Step 2.1: API Selection and Priority**

For each citation, choose verification API based on available identifiers:

```
Priority 1: DOI present     -> CrossRef API
Priority 2: arXiv ID present -> arXiv API
Priority 3: Title present    -> Semantic Scholar API
Priority 4: Title present    -> WebSearch (Google Scholar fallback)
```

**Step 2.2: CrossRef Verification (DOI)**

If DOI is available:
```
GET https://api.crossref.org/works/{doi}
```
- Status 200 = paper exists, extract metadata from response
- Status 404 = DOI not found, try next API
- Other status = API error, try next API

Also attempt BibTeX retrieval:
```
GET https://doi.org/{doi}
Accept: application/x-bibtex
```

**Step 2.3: arXiv Verification (arXiv ID)**

If arXiv ID is available (format: `YYMM.NNNNN` or `archive/YYMMNNN`):
```
GET http://export.arxiv.org/api/query?id_list={arxiv_id}
```
- Parse XML response for paper metadata
- Extract title, authors, published date, categories

**Step 2.4: Semantic Scholar Verification (Title)**

If no DOI or arXiv ID, search by title:
```
GET https://api.semanticscholar.org/graph/v1/paper/search?query={title}&limit=5&fields=title,authors,year,venue,externalIds
```
- Compare top results against citation metadata
- Select best match based on title similarity

**Step 2.5: WebSearch Fallback (Google Scholar)**

If all APIs fail, use WebSearch tool with targeted Google Scholar queries:

```
# Primary: exact title search on Google Scholar
WebSearch(query: 'site:scholar.google.com "{title}"')

# If no results: broaden with author + year
WebSearch(query: 'site:scholar.google.com "{title}" {first_author_last_name} {year}')

# If still no results: try publisher sites directly
WebSearch(query: '"{title}" site:arxiv.org OR site:aclanthology.org OR site:openreview.net OR site:ieee.org OR site:springer.com')
```

**Parsing Google Scholar results**:
- Look for a result whose title fuzzy-matches the citation (threshold 0.80)
- Extract metadata from the result snippet: author names, year, venue/journal
- If the result contains a "Cited by N" indicator, the paper is confirmed to exist
- If a BibTeX export link is available, fetch it for authoritative metadata
- Record the source URL for provenance tracking

**Step 2.6: Existence Result**

```
layer2Result = {
  exists: boolean,
  source: "crossref" | "arxiv" | "semantic_scholar" | "web_search" | null,
  apiData: { title, authors[], year, venue, doi, ... } | null,
  status: "found" | "not_found" | "api_error"
}
```

If `not_found` after all APIs fail, mark citation and skip to final scoring (score = 0).

**Rate limiting**: Respect API rate limits. Pause between requests:
- CrossRef: polite pool (include mailto in User-Agent)
- Semantic Scholar: 100 requests / 5 minutes
- arXiv: 1 request / 3 seconds

### Layer 3: Information Matching

For citations that were found (Layer 2 exists=true), compare BibTeX fields against API-retrieved data.

**Step 3.1: Title Matching**

Fuzzy string match between BibTeX title and API title:
- Normalize both: lowercase, remove punctuation, collapse whitespace
- Compute similarity using sequence matching (SequenceMatcher or Levenshtein ratio)
- Threshold: `thresholds.title_similarity` (default 0.85)
- Record: `{ match: boolean, similarity: float }`

**Step 3.2: Author Matching**

Compare author lists with tolerance for format differences:
- Normalize names: handle "Last, First" vs "First Last" formats
- First author MUST match (first author mismatch = high severity issue)
- Compute set overlap for remaining authors
- Threshold: `thresholds.author_similarity` (default 0.70)
- Record: `{ match: boolean, similarity: float, firstAuthorMatch: boolean }`

**Step 3.3: Year Matching**

Compare publication years with tolerance:
- Allow +/- `thresholds.year_tolerance` years (default 1)
- Tolerance accounts for preprint vs published version date differences
- Record: `{ match: boolean, difference: int }`

**Step 3.4: Venue Matching**

Compare journal/conference names:
- Handle abbreviations vs full names (e.g., "NeurIPS" vs "Advances in Neural Information Processing Systems")
- Handle slight variations in conference naming across years
- Use substring matching and known abbreviation mappings
- Record: `{ match: boolean, similarity: float }`

Record all Layer 3 results:
```
layer3Result = {
  title: { match, similarity },
  authors: { match, similarity, firstAuthorMatch },
  year: { match, difference },
  venue: { match, similarity }
}
```

### Layer 4: Content Validation

Calculate a weighted composite match score and determine confidence level.

**Step 4.1: Weighted Score Calculation**

```
matchScore = (
  title_similarity   * weights.title    +   // 0.4
  authors_similarity  * weights.authors  +   // 0.3
  year_score          * weights.year     +   // 0.2
  venue_similarity    * weights.venue        // 0.1
)
```

Where:
- `title_similarity` = float from Layer 3 title match (0.0 to 1.0)
- `authors_similarity` = float from Layer 3 author match (0.0 to 1.0)
- `year_score` = 1.0 if year matches within tolerance, 0.0 otherwise
- `venue_similarity` = float from Layer 3 venue match (0.0 to 1.0)

If a field is missing from either BibTeX or API data, exclude it from calculation and re-normalize weights over available fields.

**Step 4.2: Confidence Level Assignment**

Based on the computed `matchScore`:

| Score Range | Confidence | Status | Meaning |
|---|---|---|---|
| >= `high_confidence` (0.90) | `high` | `verified` | Information fully matches |
| >= `medium_confidence` (0.70) | `medium` | `partial_match` | Minor discrepancies, suggest manual review |
| >= `low_confidence` (0.50) | `low` | `low_match` | Significant discrepancies, needs manual verification |
| < `low_confidence` (0.50) | `failed` | `failed` | Severe mismatch or paper does not exist |

**Step 4.3: Issue Classification**

Based on verification results, classify issues by severity:

| Severity | Condition | Examples |
|---|---|---|
| **Critical** | Paper not found by any API; matchScore < 0.3 | Fake/fabricated citation |
| **High** | First author mismatch; title similarity < 0.7; wrong entry type | Incorrect citation data |
| **Medium** | Format errors; year off by > 1; missing DOI | BibTeX quality issues |
| **Low** | Style inconsistencies; author name format varies; abbreviation differences | Cosmetic issues |

**Step 4.4: Build Verification Result**

```
verificationResult = {
  citationKey: string,
  layers: {
    format: layer1Result,
    existence: layer2Result,
    matching: layer3Result,
    content: {
      matchScore: float,
      confidence: "high" | "medium" | "low" | "failed",
      status: "verified" | "partial_match" | "low_match" | "failed" | "not_found"
    }
  },
  issues: [{ severity, category, message, field, suggestion }],
  apiData: { ... }   // retrieved data for potential auto-fix
}
```

## Output

- `verificationResults[]` -- per-citation verification result with all 4 layers
- `verificationSummary` -- aggregate statistics:
  - total citations processed
  - verified (high confidence) count
  - partial match (medium confidence) count
  - low match count
  - failed count
  - not found count
  - issues by severity breakdown

## Next Phase

Pass `verificationResults` to **Phase 3: Report & Fix** for report generation and optional auto-correction.
