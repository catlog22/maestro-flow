
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 2: Structure Planning

Plan the paper structure, define the narrative arc, allocate page budgets, and create a detailed section outline.

## Objective

- Define the paper's narrative arc around the central contribution
- Plan section structure appropriate for target conference
- Allocate page budgets per section
- Create a detailed outline with key points per section

## Execution

### Step 2.1: Conference Constraints

Load constraints for `paperPreferences.targetConference`:

| Conference | Page Limit | Extra Camera-Ready | Required Sections |
|------------|------------|-------------------|-------------------|
| NeurIPS 2025 | 9 pages | +0 | Checklist, Limitations |
| ICML 2026 | 8 pages | +1 | Broader Impact |
| ICLR 2026 | 9 pages | +1 | LLM Disclosure |
| ACL 2025 | 8 pages (long) | varies | Limitations (mandatory), Ethics |
| AAAI 2026 | 7 pages | +1 | Strict style adherence |
| COLM 2025 | 9 pages | +1 | Language model focus |

Universal requirements:
- Double-blind review (anonymize submissions)
- References do not count toward page limit
- Appendices unlimited but reviewers are not required to read them
- LaTeX required for all venues

### Step 2.2: Define Narrative Arc

Using `repoContext`, define the narrative following the three pillars:

**The What** (crystal clear by end of introduction):
- 1-3 specific novel claims within a cohesive theme

**The Why** (evidence):
- Which experiments support which claims?
- What baselines establish the comparison?

**The So What** (reader motivation):
- What recognized community problem does this address?
- What does this enable that was not possible before?

Write a one-paragraph narrative summary that threads What/Why/So What into a coherent story.

### Step 2.3: Page Budget Allocation

Allocate pages based on conference limit and paper type:

**Full Paper (9 pages, e.g., NeurIPS)**:
| Section | Pages | Notes |
|---------|-------|-------|
| Abstract | 0.25 | 5-sentence formula |
| Introduction | 1.0-1.5 | Contribution bullets, must end by page 2 |
| Methods | 2.0-2.5 | Enough for reimplementation |
| Experiments | 2.5-3.0 | Main results, ablations |
| Related Work | 1.0-1.5 | Methodological grouping |
| Conclusion | 0.5 | Summary + future work |
| Limitations | 0.25-0.5 | Required at most venues |

**Short Paper (4 pages)**:
- Cut related work to 0.5 page
- Combine methods + experiments
- Move details to appendix

Adjust for the specific conference page limit. Document the allocation.

### Step 2.4: Section Outline

Create a detailed outline for each section. For each section, specify:
- Key points to make (bullet list)
- Figures/tables planned
- Which claims/evidence from repoContext map here
- Approximate word count target

**Outline Template**:

```markdown
## Abstract (150-250 words)
- Sentence 1: What you achieved
- Sentence 2: Why this is hard and important
- Sentence 3: How you do it (with specialist keywords)
- Sentence 4: What evidence you have
- Sentence 5: Your most remarkable result

## 1. Introduction (1-1.5 pages)
- Opening: problem statement (2-3 sentences)
- Gap: what's missing in current approaches
- Contribution: 2-4 bullet list (max 1-2 lines each)
- Approach overview: brief description of method
- Figure 1: [description of key figure]

## 2. Related Work (1-1.5 pages)
- Group A: [methodological grouping, not paper-by-paper]
- Group B: [...]
- Positioning: how our work differs

## 3. Method (2-2.5 pages)
- 3.1 Problem Setup / Preliminaries
- 3.2 [Core method component]
- 3.3 [Second component if any]
- 3.4 Implementation Details
- Figure 2: [method diagram]

## 4. Experiments (2.5-3 pages)
- 4.1 Setup (datasets, baselines, metrics)
- 4.2 Main Results — Table 1: [description]
- 4.3 Ablation Studies — Table 2: [description]
- 4.4 Analysis / Qualitative Results — Figure 3: [description]

## 5. Conclusion (0.5 pages)
- Summary of contribution
- Key takeaway
- Future directions (brief)

## 6. Limitations (0.25-0.5 pages)
- Known limitations
- Why they don't undermine core claims

## Appendix
- Detailed proofs (if any)
- Additional experiments
- Hyperparameter details
- Compute budget
```

### Step 2.5: Figure Planning

Plan all figures and tables:

| Figure/Table | Section | Content | Purpose |
|--------------|---------|---------|---------|
| Figure 1 | Intro | [Core idea visualization] | Hook readers |
| Table 1 | Experiments | [Main comparison] | Support main claim |
| Figure 2 | Method | [Architecture/pipeline] | Explain approach |
| Table 2 | Experiments | [Ablations] | Justify design |
| Figure 3 | Experiments | [Qualitative/analysis] | Provide insight |

Rules for figures:
- Vector graphics (PDF/EPS) for all plots and diagrams
- Raster (PNG 600 DPI) only for photographs
- Colorblind-safe palettes (Okabe-Ito or Paul Tol)
- Verify grayscale readability
- No title inside figure (caption serves this function)
- Self-contained captions

### Step 2.6: User Confirmation

Present the outline to the user for feedback:

> "Here is the proposed paper structure for [conference]. The narrative centers on [contribution].
> Key sections: [list]. Total page budget: [N] pages.
> Should I proceed with drafting, or adjust the outline?"

If user provides feedback, revise outline before proceeding.

## Output

Write `outputDir/.writing/paper-outline.md`:

```markdown
# Paper Outline

## Narrative Summary
[One paragraph threading What/Why/So What]

## Conference: [name]
Page limit: [N] pages

## Page Budget
[Table of section -> page allocation]

## Detailed Outline
[Full section outline with key points, figures, tables]

## Figure Plan
[Table of planned figures and tables]

## Writing Order
1. Abstract (anchor the narrative)
2. Introduction (establish contribution)
3. Methods (technical detail)
4. Experiments (evidence)
5. Related Work (positioning)
6. Conclusion + Limitations
```

- **Variable**: `paperOutline` (path to paper-outline.md)
- **update_plan**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then continue to [Phase 3: Section Drafting](03-section-drafting.md).
