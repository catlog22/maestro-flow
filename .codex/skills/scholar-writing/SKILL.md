---
name: scholar-writing
description: End-to-end academic paper writing workflow. Takes a research
  repository and produces a publication-ready LaTeX manuscript for top ML/AI
  conferences (NeurIPS, ICML, ICLR, ACL, AAAI, COLM). Covers repo understanding,
  structure planning, section drafting, citation management, anti-AI polishing,
  and conference formatting. Triggers on "write paper", "draft paper", "scholar
  writing", "paper writing workflow".
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Task
  - WebFetch
  - WebSearch
  - Write
  - request_user_input
  - update_plan
session-mode: run
version: 0.5.51
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

# Scholar Writing

End-to-end workflow for writing publication-ready ML/AI papers from research repositories. Integrates paper writing craft, citation verification, and anti-AI polishing into a structured 6-phase pipeline.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
User: "Write a paper from this repo"
         |
         v
┌──────────────────────────────────────────────────────────────────────┐
│  SKILL.md (Orchestrator)                                             │
│  Collect preferences → Dispatch phases → Track progress              │
└──────────┬───────────────────────────────────────────────────────────┘
           |
   ┌───────┼───────┬───────────┬──────────┬──────────┬────────────┐
   v       v       v           v          v          v            v
┌──────┐┌──────┐┌──────────┐┌──────────┐┌──────────┐┌──────────────┐
│ P1   ││ P2   ││ P3       ││ P4       ││ P5       ││ P6           │
│ Repo ││Struct││ Section  ││ Citation ││ Anti-AI  ││ Conference   │
│ Under││Plan  ││ Drafting ││ Manage   ││ Polish   ││ Formatting   │
└──┬───┘└──┬───┘└────┬─────┘└────┬─────┘└────┬─────┘└──────┬───────┘
   │       │         │           │           │             │
   v       v         v           v           v             v
 repo    outline   full draft   verified    polished     paper.tex
 context  + plan               .bib file   prose        (camera-ready)
```

## Key Design Principles

1. **Proactive drafting**: Deliver complete drafts, then iterate on feedback. Do not block on every section.
2. **Never hallucinate citations**: Every citation must be verified via WebSearch and Google Scholar. Mark unverifiable references as `[CITATION NEEDED]`.
3. **Narrative-first writing**: A paper is a story with one clear contribution. Define the What/Why/So What before writing.
4. **Anti-AI polish is mandatory**: All prose passes through pattern detection and humanization before final output.
5. **Conference-aware from start**: Target venue influences page limits, required sections, and framing.

## Interactive Preference Collection

Before dispatching to any phase, collect these preferences:

```
Questions to ask the user:

1. Research Repository
   "Where is the research repo? (path or URL)"
   → repoPath

2. Target Conference
   Options: NeurIPS | ICML | ICLR | ACL | AAAI | COLM | Other
   → targetConference

3. Paper Type
   Options: Full Paper | Short Paper | Workshop Paper
   → paperType

4. Output Directory
   "Where should the paper be written? (default: ./paper/)"
   → outputDir

5. Existing Materials
   "Any existing drafts, notes, or outlines to build on? (path or 'none')"
   → existingMaterials

6. Writing Language
   Options: English | Chinese | Bilingual
   → writingLanguage
```

Store responses as `paperPreferences` context for all phases.

## Auto Mode Defaults

When `workflowPreferences.autoYes === true`:
- Use detected repo path from cwd
- Default to NeurIPS format, Full Paper, English
- Output to `./paper/`
- Skip confirmation prompts within phases

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check update_plan phase status.
> The phase currently marked `in_progress` is the active execution phase -- preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### update_plan Setup

```
Paper Writing Workflow:
- [ ] Phase 1: Repo Understanding — explore repo, identify contribution
- [ ] Phase 2: Structure Planning — plan outline, define narrative
- [ ] Phase 3: Section Drafting — write all sections
- [ ] Phase 4: Citation Management — find, verify, format citations
- [ ] Phase 5: Anti-AI Polish — remove AI patterns, humanize prose
- [ ] Phase 6: Conference Formatting — apply template, compile
```

### Phase Sequence

```
Phase 1: Repo Understanding
   └─ Ref: phases/01-repo-understanding.md
      ├─ Input: repoPath, existingMaterials
      └─ Output: repoContext (contribution, results, existing citations)

Phase 2: Structure Planning
   └─ Ref: phases/02-structure-planning.md
      ├─ Input: repoContext, targetConference, paperType
      └─ Output: paperOutline (section plan, narrative arc, page budget)

Phase 3: Section Drafting
   └─ Ref: phases/03-section-drafting.md
      ├─ Input: repoContext, paperOutline, writingLanguage
      └─ Output: draftSections (all sections as LaTeX content)

Phase 4: Citation Management
   └─ Ref: phases/04-citation-management.md
      ├─ Input: draftSections, repoContext.existingCitations
      └─ Output: verifiedBib (references.bib), updatedDraft (citations resolved)

Phase 5: Anti-AI Polish
   └─ Ref: phases/05-anti-ai-polish.md
      ├─ Input: updatedDraft
      └─ Output: polishedDraft (humanized prose, AI patterns removed)

Phase 6: Conference Formatting
   └─ Ref: phases/06-conference-formatting.md
      ├─ Input: polishedDraft, verifiedBib, targetConference
      └─ Output: paper.tex (complete manuscript ready for compilation)
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-repo-understanding.md](phases/01-repo-understanding.md) | Explore repo, identify contribution | update_plan driven |
| 2 | [phases/02-structure-planning.md](phases/02-structure-planning.md) | Plan outline, define narrative | update_plan driven |
| 3 | [phases/03-section-drafting.md](phases/03-section-drafting.md) | Write all paper sections | update_plan driven + sentinel |
| 4 | [phases/04-citation-management.md](phases/04-citation-management.md) | Find, verify, format citations | update_plan driven + sentinel |
| 5 | [phases/05-anti-ai-polish.md](phases/05-anti-ai-polish.md) | Remove AI patterns, humanize | update_plan driven + sentinel |
| 6 | [phases/06-conference-formatting.md](phases/06-conference-formatting.md) | Apply template, compile | update_plan driven |

**Compact Rules**:
1. **update_plan `in_progress`** → preserve full content, do not compress
2. **update_plan `completed`** → may compress to summary
3. **sentinel fallback** → phases marked with sentinel contain compact sentinel; if only sentinel remains after compression, **must immediately `Read()` to recover before continuing**

## Core Rules

1. **Citation integrity**: NEVER generate BibTeX from memory. Always verify via WebSearch + Google Scholar. Mark unverifiable as `[CITATION NEEDED]`.
2. **One contribution**: The paper tells one story. Every section supports the central narrative.
3. **Proactive delivery**: Write full drafts, flag uncertainties. Do not block waiting for per-section approval.
4. **Conference compliance**: Respect page limits, required sections, and anonymization requirements.
5. **Anti-AI mandatory**: All prose must pass anti-AI pattern detection before final output.

## Input Processing

User input is parsed into `paperPreferences`:

```
REPO: [path to research repository]
CONFERENCE: [NeurIPS | ICML | ICLR | ACL | AAAI | COLM]
TYPE: [Full | Short | Workshop]
OUTPUT: [output directory path]
MATERIALS: [path to existing drafts or 'none']
LANGUAGE: [English | Chinese | Bilingual]
```

If user provides free text like "write a paper about my transformer project", extract:
- Repo path from context or ask
- Default conference to NeurIPS
- Default type to Full Paper
- Default language to English

## Data Flow

```
Phase 1 ──repoContext──→ Phase 2
Phase 2 ──paperOutline──→ Phase 3
Phase 1 ──repoContext──→ Phase 3
Phase 3 ──draftSections──→ Phase 4
Phase 4 ──updatedDraft + verifiedBib──→ Phase 5
Phase 5 ──polishedDraft──→ Phase 6
Phase 4 ──verifiedBib──→ Phase 6

Data persistence: All intermediate outputs written to outputDir/
  outputDir/.writing/
  ├── repo-context.md        (Phase 1 output)
  ├── paper-outline.md       (Phase 2 output)
  ├── drafts/                (Phase 3 output)
  │   ├── abstract.tex
  │   ├── introduction.tex
  │   ├── methods.tex
  │   ├── experiments.tex
  │   ├── related-work.tex
  │   ├── conclusion.tex
  │   └── appendix.tex
  ├── references.bib         (Phase 4 output)
  ├── polished/              (Phase 5 output)
  │   └── (same structure as drafts/)
  └── paper.tex              (Phase 6 output)
```

## update_plan Pattern

### Phase Start (Attach)
```
When Phase N begins:
  → Mark Phase N as in_progress in update_plan
  → Add sub-tasks for Phase N steps
  → Execute sub-tasks sequentially
```

### Phase End (Collapse)
```
When Phase N completes:
  → Mark all Phase N sub-tasks as completed
  → Collapse to summary: "Phase N complete: [key output]"
  → Mark Phase N+1 as in_progress
```

## Post-Phase Updates

Between phases, update a running paper-notes document:

```markdown
# Paper Writing Notes (accumulated)

## Contribution (Phase 1)
[One-sentence contribution statement]

## Outline (Phase 2)
[Section structure with page budgets]

## Draft Status (Phase 3)
[Section completion status]

## Citation Status (Phase 4)
[Verified count / placeholder count]

## Polish Status (Phase 5)
[Anti-AI score per section]
```

Written to: `outputDir/.writing/paper-notes.md`

## Error Handling

| Error | Action |
|-------|--------|
| Repo path invalid | Ask user for correct path |
| Cannot identify contribution | Present top 3 candidates, ask user to choose |
| Citation not found | Mark `[CITATION NEEDED]`, continue, report at end |
| LaTeX compilation fails | Fix common errors (missing packages, encoding), retry once |
| Anti-AI score below 35 | Re-polish section, flag for manual review |
| Page limit exceeded | Suggest specific cuts (move proofs to appendix, condense related work) |

## Coordinator Checklist

### Before Each Phase
- [ ] Previous phase output exists and is valid
- [ ] update_plan updated (current phase in_progress)
- [ ] Required inputs available

### After Each Phase
- [ ] Output files written to outputDir/.writing/
- [ ] paper-notes.md updated
- [ ] update_plan collapsed (phase completed)
- [ ] User notified of phase completion and key decisions made

### Final Checklist
- [ ] All 6 phases completed
- [ ] paper.tex compiles without errors
- [ ] All citations verified (no remaining `[CITATION NEEDED]`)
- [ ] Anti-AI score >= 35 for all sections
- [ ] Page limit respected
- [ ] Anonymization applied (for blind review)
- [ ] Conference checklist completed (if required)

## Related Skills

- **scholar-ideation**: Use before this skill to develop research ideas
- **scholar-experiment**: Use before this skill to run experiments
- **scholar-review**: Use after this skill to review/revise the paper
