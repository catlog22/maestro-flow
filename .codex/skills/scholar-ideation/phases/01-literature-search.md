# Phase 1: Literature Search

Systematically search, discover, and organize relevant literature for the research topic.

## Objective

- Build effective search keywords from the research topic using synonym expansion and Boolean operators
- Search across academic databases (arXiv, Google Scholar, Semantic Scholar) via WebSearch
- Screen and evaluate paper quality using inclusion/exclusion criteria
- Identify research trends and key findings
- Organize papers into Zotero collections (if enabled)
- Produce a structured literature review document

## Input

- **workflowPreferences.topic**: Research topic or interest area
- **workflowPreferences.scope**: broad | focused | applied
- **workflowPreferences.useZotero**: Whether to use Zotero integration

## Execution

### Step 1.1: Keyword Construction

Extract core concepts from the research topic and build search queries.

**Core concept identification**:
1. Parse the research topic into 2-4 core concepts
2. For each concept, generate synonyms and variants:

| Core Concept | Synonyms / Variants |
|-------------|---------------------|
| Concept A | synonym1, synonym2, variant1 |
| Concept B | synonym1, synonym2, variant1 |

3. Add domain-specific terms (method terms, application domains, evaluation metrics)

**Boolean query construction**:
```
(ConceptA OR "synonym A1" OR "variant A1")
AND
(ConceptB OR "synonym B1" OR "variant B1")
```

**Present keywords to user for confirmation** (unless autoYes):
```
request_user_input:
  question: "Here are the proposed search keywords. Would you like to modify them?"
  → If modifications requested, update keywords
```

### Step 1.2: Academic Database Search

Execute searches across multiple databases using WebSearch.

**Search strategy by database**:

**arXiv search**:
```
WebSearch: "{core keywords} site:arxiv.org"
WebSearch: "{expanded keywords} arXiv {year range}"
```

**Semantic Scholar / Google Scholar**:
```
WebSearch: "{core keywords} site:scholar.google.com"
WebSearch: "{core keywords} research paper {year}"
```

**Venue-specific search** (for focused scope):
```
WebSearch: "{keywords} {venue name} {year}"
```
Where venue = NeurIPS, ICML, ICLR, ACL, AAAI, CVPR, etc. based on domain.

**Search parameters**:
- Default time range: Last 3 years (configurable)
- Target: 20-50 papers for initial discovery
- Focus on high-citation and recent papers

**Iterative search**:
1. Initial search with core keywords
2. Analyze results — extract new terms from high-citation paper titles/abstracts
3. Refine query with newly discovered terms
4. Repeat until coverage is sufficient (diminishing new results)

### Step 1.3: Citation Tracking

For the most relevant papers found, perform citation tracking:

**Forward citation** (who cites this paper):
```
WebSearch: "cites:{paper title}" OR "{paper title} cited by"
```
Purpose: Discover subsequent developments and extensions.

**Backward citation** (what this paper cites):
Review the references section of key papers to find foundational work.

**Author tracking**:
Identify prolific authors in the field and search for their recent work:
```
WebSearch: "{author name} {topic} {recent year}"
```

### Step 1.4: Paper Screening

Apply inclusion/exclusion criteria to filter papers.

**Inclusion criteria**:
- Directly relevant to the research topic
- Published in recognized venues (top conferences/journals)
- Relatively high citation count (adjusted for publication date)
- Authors from established research groups
- Recent (within time scope)

**Exclusion criteria**:
- Tangential or unrelated to core topic
- Published in low-quality venues
- Clearly outdated methods (unless foundational/classic)
- Duplicate or near-duplicate work

**Quality assessment dimensions**:
1. **Method innovation** — Does it propose new methods or perspectives?
2. **Experimental rigor** — Is the experimental design sound and results credible?
3. **Writing quality** — Is the paper clear and well-organized?
4. **Reproducibility** — Does it provide code and data?

**Relevance categorization**:
- **Core**: Directly addresses the same problem/method (5-15 papers)
- **Methods**: Related techniques that could be adapted (10-20 papers)
- **Applications**: Application-domain references (5-10 papers)
- **Baselines**: Work needed for experimental comparison (3-8 papers)
- **Background**: Foundational context (5-10 papers)

### Step 1.5: Zotero Integration (if useZotero)

**Implementation Note**: This step requires Zotero MCP server to be configured. If not available, skip to Step 1.6 and organize papers manually using local markdown files.

**Check Zotero MCP availability**:
```javascript
// Attempt to call Zotero MCP tool
try {
  // If Zotero MCP is available, proceed with automated organization
  mcp__zotero__create_collection(name: "Research-{topic_keyword}-{YYYY}")
} catch (error) {
  // If Zotero MCP not available, guide user to manual organization
  request_user_input: "Zotero MCP not detected. Would you like to:
    1. Organize papers manually (create local markdown index)
    2. Skip organization (proceed to synthesis)"
}
```

**Automated Organization** (if Zotero MCP available):

**Create collection**:
```javascript
mcp__zotero__create_collection(name: "Research-{topic_keyword}-{YYYY}")
// Create sub-collections
mcp__zotero__create_collection(name: "Core Papers", parent: main_collection_id)
mcp__zotero__create_collection(name: "Methods", parent: main_collection_id)
mcp__zotero__create_collection(name: "Applications", parent: main_collection_id)
mcp__zotero__create_collection(name: "Baselines", parent: main_collection_id)
mcp__zotero__create_collection(name: "To-Read", parent: main_collection_id)
```

**DOI extraction and import**:
For each discovered paper:
1. Extract DOI from URL:
   - `https://doi.org/10.xxxx/xxxxx` — direct DOI link
   - `https://arxiv.org/abs/xxxx.xxxxx` — convert to `10.48550/arXiv.xxxx.xxxxx`
   - `https://dl.acm.org/doi/10.xxxx/xxxxx` — extract from URL path
2. Batch import: `mcp__zotero__add_items_by_doi(dois: [doi1, doi2, ...], max: 10)` (max 10 per batch to respect API limits)
3. Attach PDFs: `mcp__zotero__find_and_attach_pdfs(item_ids: [...])` for open-access papers
4. Assign to sub-collection based on relevance category

**Full-text reading** (for core papers):
```javascript
fulltext = mcp__zotero__get_item_fulltext(item_id: paper_id)
// Analyze content → generate structured notes
```

**Manual Organization** (if Zotero MCP not available):

Create local paper index file:
```javascript
Write("literature-index.md", content: `
# Literature Index: {topic}

## Core Papers
- [Paper Title](URL) - Authors, Year - Brief summary
- ...

## Methods
- [Paper Title](URL) - Authors, Year - Brief summary
- ...

## Applications
- [Paper Title](URL) - Authors, Year - Brief summary
- ...

## Baselines
- [Paper Title](URL) - Authors, Year - Brief summary
- ...

## To-Read
- [Paper Title](URL) - Authors, Year - Brief summary
- ...
`)
```

**Note template per paper**:
```markdown
## [Paper Title]

**Basic Info**: Authors, Venue, Year, DOI
**Research Problem**: What problem does it solve? Why important?
**Core Method**: Main technical approach, key innovations
**Key Findings**: Main results, important conclusions
**Limitations**: Method and experimental limitations
**Relevance**: How it connects to our research, what we can learn/improve
```

### Step 1.6: Literature Review Synthesis

Compile findings into a structured literature review document.

**literature-review.md structure**:

```markdown
# Literature Review: {Topic}

## 1. Introduction
### 1.1 Research Background
### 1.2 Research Importance
### 1.3 Review Scope

## 2. Main Research Directions
### 2.1 Direction A
- Representative works with key findings
### 2.2 Direction B
- Representative works with key findings

## 3. Research Trends
### 3.1 Trend analysis (emerging topics, declining areas)
### 3.2 Methodology evolution
### 3.3 Application expansion

## 4. Key Findings Summary
- Consensus findings across papers
- Contradictory findings requiring resolution
- Open questions identified

## 5. Paper Inventory
| # | Title | Authors | Venue | Year | Category | Key Contribution |
|---|-------|---------|-------|------|----------|-----------------|
| 1 | ...   | ...     | ...   | ...  | Core     | ...             |
```

**Generate the literature review document**:
```javascript
Write("literature-review.md", content: `
# Literature Review: {Topic}

## 1. Introduction
### 1.1 Research Background
{background_text}

### 1.2 Research Importance
{importance_text}

### 1.3 Review Scope
{scope_text}

## 2. Main Research Directions
### 2.1 {Direction A}
{direction_a_summary}
- {Representative works with key findings}

### 2.2 {Direction B}
{direction_b_summary}
- {Representative works with key findings}

## 3. Research Trends
### 3.1 Trend analysis
{trend_analysis}

### 3.2 Methodology evolution
{methodology_evolution}

### 3.3 Application expansion
{application_expansion}

## 4. Key Findings Summary
- {Consensus findings across papers}
- {Contradictory findings requiring resolution}
- {Open questions identified}

## 5. Paper Inventory
| # | Title | Authors | Venue | Year | Category | Key Contribution |
|---|-------|---------|-------|------|----------|-----------------|
${papers.map((p, i) => `| ${i+1} | ${p.title} | ${p.authors} | ${p.venue} | ${p.year} | ${p.category} | ${p.contribution} |`).join('\n')}
`)
```

## Output

- **Variable**: `literatureResults` containing:
  - `papers[]` — List of discovered papers with metadata and categories
  - `trends[]` — Identified research trends
  - `keyFindings[]` — Major findings from the literature
  - `zoteroCollection` — Zotero collection name (if applicable)
- **File**: `literature-review.md`
- **update_plan**: Mark Phase 1 completed, Phase 2 in_progress

## Next Phase

Return to orchestrator, then proceed to [Phase 2: Gap Analysis](02-gap-analysis.md).
