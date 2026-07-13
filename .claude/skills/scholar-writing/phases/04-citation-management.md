
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 4: Citation Management

> **COMPACT SENTINEL [Phase 4: Citation Management]**
> This phase contains 7 execution steps (Step 4.1 -- 4.7).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/04-citation-management.md")`

Find, verify, and format all citations. Replace placeholders with verified references. Build a clean bibliography.

## Objective

- Resolve all `[CITE: ...]` and `[CITATION NEEDED]` placeholders in the draft
- Verify every citation via WebSearch and Google Scholar
- Build a verified `references.bib` file
- Ensure no hallucinated citations remain

## Critical Rule

**NEVER generate BibTeX entries from memory. ALWAYS fetch programmatically.**

AI-generated citations have a ~40% error rate. Hallucinated references are a serious form of academic misconduct that can result in desk rejection or retraction.

| Action | Correct | Wrong |
|--------|---------|-------|
| Adding a citation | Search API -> verify -> fetch BibTeX | Write BibTeX from memory |
| Uncertain about a paper | Mark as `[CITATION NEEDED]` | Guess the reference |
| Cannot find exact paper | Note: "placeholder - verify" | Invent similar-sounding paper |

## Execution

### Step 4.1: Inventory Citation Needs

Scan all draft files for citation placeholders:

```bash
# Find all citation placeholders
grep -rn "CITE:\|CITATION NEEDED\|PLACEHOLDER\|cite{.*TODO" $OUTPUT_DIR/.writing/drafts/
```

Create a citation inventory:

```markdown
## Citation Inventory
| # | Placeholder | Context | Section | Status |
|---|-------------|---------|---------|--------|
| 1 | [CITE: transformer paper] | "attention mechanism [CITE]" | methods | pending |
| 2 | [CITE: RLHF survey] | "alignment techniques [CITE]" | related | pending |
| ... | ... | ... | ... | ... |
```

### Step 4.2: Collect Existing Citations

Load citations already found in Phase 1 (from `repoContext.existingCitations`):

- Read any `.bib` files found in the repo
- Extract citation keys and paper metadata
- These are pre-verified (researcher already used them)
- Add directly to `references.bib`

### Step 4.3: Search and Verify Each Citation

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is TodoWrite `in_progress` (active phase protection)
> 2. Full protocol (Step 4.1 -- 4.7) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/04-citation-management.md")` now.

For each pending citation in the inventory, follow this mandatory 7-step process:

**Step A: WebSearch to Find the Paper**

Execute WebSearch with specific query patterns:

```javascript
// Example 1: Classic paper with known authors and year
WebSearch({
  query: "Attention is All You Need Vaswani 2017",
  allowed_domains: ["arxiv.org", "scholar.google.com", "aclanthology.org"]
})

// Example 2: Recent paper with topic and year
WebSearch({
  query: "RLHF language model alignment 2023",
  allowed_domains: ["arxiv.org", "scholar.google.com"]
})

// Example 3: Paper from specific organization
WebSearch({
  query: "sparse autoencoders interpretability Anthropic",
  allowed_domains: ["arxiv.org", "scholar.google.com", "anthropic.com"]
})

// Example 4: Conference paper with venue
WebSearch({
  query: "BERT NLP pretraining NeurIPS 2018",
  allowed_domains: ["papers.nips.cc", "scholar.google.com"]
})
```

What to look for in results:
- Paper title matches intended citation
- Authors are correct
- Publication year is correct
- Venue (conference/journal) is identified

**Step B: Verify on Google Scholar**

Execute targeted Google Scholar search:

```javascript
// Direct Google Scholar search
WebSearch({
  query: "site:scholar.google.com Attention is All You Need Vaswani",
  allowed_domains: ["scholar.google.com"]
})

// Alternative: Use paper title + first author
WebSearch({
  query: "site:scholar.google.com \"BERT: Pre-training of Deep Bidirectional Transformers\" Devlin",
  allowed_domains: ["scholar.google.com"]
})
```

Verification checklist:
- Paper appears in Google Scholar results
- Title matches exactly (or very close)
- Authors match
- Year matches
- Venue is listed
- Citation count is reasonable (not 0 for papers older than 1 year)

**If paper NOT found on Google Scholar**: STOP. Do not cite. Mark as `[CITATION NEEDED - not found on Google Scholar]`.

**Step C: Confirm Paper Details**

Double-check all metadata:
- Title: exact title from Google Scholar
- Authors: all authors, in order
- Year: publication year
- Venue: conference/journal name
- DOI: if available

**Step D: Retrieve BibTeX**

Priority order:
1. **Google Scholar** (click "Cite" -> "BibTeX")
2. **DOI content negotiation**: fetch from `https://doi.org/{DOI}` with `Accept: application/x-bibtex`
3. **arXiv**: "Export BibTeX Citation" on sidebar

NEVER write BibTeX from memory. Always copy from a verified source.

**Step E: Verify the Claim**

If citing for a specific claim (not just general reference):
- Access the paper via WebSearch (PDF or HTML)
- Search for keywords related to the claim
- Confirm the claim is explicitly stated or clearly implied
- Note the section/page where claim appears

If you cannot access the paper:
- Only cite for general contributions (if verified on Google Scholar)
- Mark as `[CLAIM NOT VERIFIED - no access to paper]`

**Step F: Generate Citation Key**

Use consistent format: `author_year_firstword`

```
vaswani_2017_attention
devlin_2019_bert
brown_2020_language
```

**Step G: Add to Bibliography**

Add verified BibTeX entry to `references.bib`.

### Step 4.4: Handle Verification Failures

For citations that cannot be verified:

```latex
% Option 1: Explicit placeholder
\cite{PLACEHOLDER_smith2023_verify}  % TODO: Could not verify - scientist must confirm

% Option 2: Note in text
... as shown in prior work [CITATION NEEDED - could not verify Smith et al. 2023].
```

Track all failures:

```markdown
## Unverified Citations
| # | Description | Reason | Action Needed |
|---|-------------|--------|---------------|
| 1 | Smith 2023 on reward hacking | Not found on Google Scholar | Scientist must verify |
| 2 | Jones 2022 on scaling laws | Different authors found | Confirm correct paper |
```

### Step 4.5: Search for Additional Citations

Beyond resolving placeholders, proactively search for:

- Recent papers in the same area (last 2 years)
- Key baselines that should be cited
- Seminal works in the field
- Papers by likely reviewers

Search strategies:
- `[main technique] + [application domain]`
- `[baseline method] comparison`
- `[problem name] state-of-the-art`
- Author names from existing citations

Verify each additional citation through the same 7-step process.

### Step 4.6: Update Draft with Citations

Replace all placeholders in draft files with verified `\cite{}` commands:

```
Before: "The transformer architecture [CITE: transformer paper] introduced..."
After:  "The transformer architecture \cite{vaswani_2017_attention} introduced..."
```

Copy updated drafts to maintain history:
```bash
cp -r $OUTPUT_DIR/.writing/drafts/ $OUTPUT_DIR/.writing/drafts-pre-citation/
```

Then update the draft files in-place.

### Step 4.7: Citation Report

Generate a citation status report:

```markdown
## Citation Report

### Summary
- Total citations: [N]
- Verified: [M]
- Placeholders remaining: [K]
- From existing repo: [J]

### Verified Citations
[List of all verified citations with key, title, venue, year]

### Remaining Placeholders
[List of unresolved citations with reasons]

### Recommendation
[Any suggestions for the scientist regarding citations]
```

Report to user:
> "I've resolved [M] of [N] citations. [K] remain as placeholders that need your verification:
> - [list of unverified citations with reasons]
> Please verify these before submission."

## BibTeX Format Reference

### Conference Paper
```bibtex
@inproceedings{vaswani_2017_attention,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and
            Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and
            Kaiser, Lukasz and Polosukhin, Illia},
  booktitle = {Advances in Neural Information Processing Systems},
  volume = {30},
  year = {2017}
}
```

### Journal Article
```bibtex
@article{hochreiter_1997_long,
  title = {Long Short-Term Memory},
  author = {Hochreiter, Sepp and Schmidhuber, J{\"u}rgen},
  journal = {Neural Computation},
  volume = {9},
  number = {8},
  pages = {1735--1780},
  year = {1997}
}
```

### arXiv Preprint
```bibtex
@misc{brown_2020_language,
  title = {Language Models are Few-Shot Learners},
  author = {Brown, Tom and Mann, Benjamin and Ryder, Nick and others},
  year = {2020},
  eprint = {2005.14165},
  archiveprefix = {arXiv},
  primaryclass = {cs.CL}
}
```

## Output

- **File**: `outputDir/.writing/references.bib` (verified bibliography)
- **File**: Updated draft files in `outputDir/.writing/drafts/` (citations resolved)
- **File**: `outputDir/.writing/citation-report.md` (status report)
- **Variable**: `verifiedBib` (path to references.bib), `updatedDraft` (path to drafts/)
- **TodoWrite**: Mark Phase 4 completed, Phase 5 in_progress

## Next Phase

Return to orchestrator, then continue to [Phase 5: Anti-AI Polish](05-anti-ai-polish.md).
