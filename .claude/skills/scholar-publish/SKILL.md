---
name: scholar-publish
description: Post-acceptance conference preparation workflow covering presentation slides, academic posters, and promotion content. Triggers on "scholar publish", "conference preparation", "prepare presentation", "create poster", "write promotion", "post-acceptance".
allowed-tools: AskUserQuestion(*), TodoWrite(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*)
---

# Scholar Publish

Post-acceptance conference preparation workflow that helps researchers create presentation materials, academic posters, and promotional content for accepted papers.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  /scholar-publish                                              │
│  Orchestrator: Preference Collection + Selective Phase Dispatch │
└──────────────────────┬───────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
   ┌───────────┐ ┌───────────┐ ┌───────────┐
   │  Phase 1  │ │  Phase 2  │ │  Phase 3  │
   │ Presenta- │ │  Poster   │ │ Promotion │
   │   tion    │ │  Design   │ │  Content  │
   └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
         ↓             ↓             ↓
   presentation-  poster-       promotion-
   outline.md     outline.md    content.md
```

**Data Flow**:
```
User Input: accepted paper + preferences (outputs, duration, poster size)
  → Phase 1 (presentation): paper → slide outline + timing plan + Q&A prep
  → Phase 2 (poster): paper → poster layout + design specs + QR code plan
  → Phase 3 (promotion): paper → Twitter thread + LinkedIn post + blog draft
Each phase runs independently based on user selection.
```

## Key Design Principles

1. **Selective Execution**: User chooses which outputs to generate - phases run independently
2. **Paper-Driven Content**: All outputs derive from the accepted paper's key messages
3. **Practical Guidelines**: Concrete specifications (font sizes, timing, layout dimensions)
4. **Platform-Aware**: Each promotion channel has its own tone, format, and best practices

## Interactive Preference Collection

Collect workflow preferences via AskUserQuestion before dispatching to phases:

```
Step 1: Identify paper context
  Ask: "Please provide the accepted paper (file path, summary, or key details):
        - Paper title
        - Conference/venue name
        - Key contributions (2-3 bullet points)
        - Co-authors (for tagging in promotion)"

Step 2: Select outputs to generate
  AskUserQuestion:
    question: "Which outputs would you like to generate?"
    options:
      - "Presentation slides outline" → enablePresentation = true
      - "Academic poster design" → enablePoster = true
      - "Promotion content (Twitter/LinkedIn/blog)" → enablePromotion = true
      - "All of the above" → enableAll = true

Step 3: Conditional preferences (based on selection)
  IF enablePresentation:
    Ask: "Talk duration?" options: ["15 minutes", "20 minutes", "30 minutes", "Other"]
  IF enablePoster:
    Ask: "Poster format?" options: ["Portrait (24x36in / A0)", "Landscape (36x24in / A0)", "Check with conference"]
  IF enablePromotion:
    Ask: "Which platforms?" options: ["Twitter/X thread", "LinkedIn post", "Blog post", "All platforms"]
```

**Preference Variables** (passed to phases):
- `paperContext`: title, venue, contributions, authors
- `enablePresentation`, `enablePoster`, `enablePromotion`
- `talkDuration`: 15 | 20 | 30 (minutes)
- `posterFormat`: portrait | landscape
- `promotionPlatforms`: twitter | linkedin | blog | all

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase - preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### Phase 0: Input Processing & Preference Collection

Parse user input and collect preferences (described above). Convert free-text paper description to structured format:

```
PAPER_TITLE: [title]
VENUE: [conference/journal name]
CONTRIBUTIONS: [key points]
AUTHORS: [author list]
```

Then dispatch to selected phases.

---

### Phase 1: Presentation Slide Creation (if enablePresentation)
   Ref: phases/01-presentation.md

Create a structured presentation outline with slide-by-slide content, timing plan, visual design guidance, and Q&A preparation.

**Output**: `presentation-outline.md`

---

### Phase 2: Academic Poster Design (if enablePoster)
   Ref: phases/02-poster.md

Design a poster layout with section placement, typography specs, visual hierarchy, and print-ready guidelines.

**Output**: `poster-outline.md`

---

### Phase 3: Promotion Content Creation (if enablePromotion)
   Ref: phases/03-promotion.md

Generate platform-specific promotion content: Twitter/X thread, LinkedIn post, and blog draft.

**Output**: `promotion-content.md`

---

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-presentation.md](phases/01-presentation.md) | Slide outline creation | TodoWrite driven |
| 2 | [phases/02-poster.md](phases/02-poster.md) | Poster layout design | TodoWrite driven |
| 3 | [phases/03-promotion.md](phases/03-promotion.md) | Multi-platform promotion | TodoWrite driven |

**Compact Rules**:
1. **TodoWrite `in_progress`** -> preserve full content, do not compress
2. **TodoWrite `completed`** -> can compress to summary
3. Phases are independent - only load the phase being executed

## Core Rules

1. **Paper first**: Read and understand the paper before generating any content
2. **One key message per slide**: Never overload a single slide with multiple ideas
3. **Audience-appropriate**: Adjust technical depth for the target venue
4. **Visual over text**: Prefer figures, diagrams, and bullet points over paragraphs
5. **Platform conventions**: Each social platform has distinct formatting expectations
6. **Conference compliance**: Check specific venue requirements for poster size, talk duration

## Data Flow

```
paperContext (from user input)
  │
  ├─→ Phase 1: paperContext + talkDuration → presentation-outline.md
  │     └─ slide count, timing, structure, visual design, Q&A prep
  │
  ├─→ Phase 2: paperContext + posterFormat → poster-outline.md
  │     └─ layout, typography, sections, QR code, print specs
  │
  └─→ Phase 3: paperContext + promotionPlatforms → promotion-content.md
        └─ Twitter thread, LinkedIn post, blog draft
```

## TodoWrite Pattern

```
Phase starts:
  → Sub-tasks ATTACHED to TodoWrite (in_progress + pending)
  → Execute sub-tasks sequentially within the phase

Phase ends:
  → Sub-tasks COLLAPSED to completed summary
  → Next selected phase begins (or workflow completes)
```

Example TodoWrite lifecycle:
```
[in_progress] Generate presentation outline
  [in_progress] Extract key messages from paper
  [pending] Create slide structure
  [pending] Add timing plan
  [pending] Write Q&A preparation notes
→ After completion:
[completed] Generate presentation outline (12 slides, 20min talk)
```

## Error Handling

1. **Missing paper content**: Ask user to provide paper file path or paste key sections
2. **Unclear venue requirements**: Use standard defaults, note assumptions in output
3. **Platform-specific failures**: Generate available platforms, skip unavailable ones
4. **Content too long/short**: Adjust based on guidelines (slide count for duration, word count for blog)

## Coordinator Checklist

**Before each phase**:
- [ ] Paper context is available and parsed
- [ ] Phase-specific preferences collected (duration/format/platforms)
- [ ] Output file path determined

**After each phase**:
- [ ] Output file written and verified
- [ ] TodoWrite updated (phase marked completed)
- [ ] Next phase dispatched (if selected)

**After all phases**:
- [ ] Summary of generated outputs presented to user
- [ ] File paths listed for easy access
