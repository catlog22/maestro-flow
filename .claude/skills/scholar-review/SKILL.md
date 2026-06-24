---
name: scholar-review
description: Systematic academic paper review workflow covering self-review before submission and rebuttal writing after receiving reviewer feedback. Triggers on "review paper", "self-review", "write rebuttal", "respond to reviewers", "analyze review comments", "paper review".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, AskUserQuestion, TodoWrite
---

# Scholar Review

A structured workflow for academic paper review and rebuttal. Covers two modes: (1) pre-submission self-review to identify and fix weaknesses before submitting, and (2) post-review rebuttal writing to respond professionally to reviewer feedback.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
                          scholar-review
                               |
                    [Preference Collection]
                         /            \
              Pre-Submission        Post-Review
                   |              /     |      \
            +-----------+   +--------+--------+---------+
            | Phase 1   |   | Phase 2| Phase 3| Phase 4 |
            | Self-     |   | Review | Response| Rebuttal|
            | Review    |   | Analysis| Strategy| Writing|
            +-----------+   +--------+--------+---------+
                   |              \     |      /
                   v               v    v    v
            self-review-       rebuttal-response.md
            report.md                  |
                                       v
                                 +-----------+
                                 | Phase 5   |
                                 | Revision  |
                                 +-----------+
                                       |
                                       v
                                 revised-paper
```

## Key Design Principles

1. **Mode-driven execution**: Pre-submission triggers Phase 1 only; post-review triggers Phases 2-5 sequentially
2. **Evidence-based review**: Every finding must reference specific sections, pages, or line numbers
3. **Professional tone**: All rebuttal output follows academic tone guidelines (grateful, respectful, evidence-based)
4. **Completeness**: Every reviewer comment must receive a response; no comment is skipped
5. **Actionable output**: Each phase produces concrete artifacts, not abstract advice

## Interactive Preference Collection

Collect workflow preferences before dispatching to phases:

```
Ask the user:

1. Review Stage:
   - "Pre-submission self-review" → Execute Phase 1 only
   - "Post-review rebuttal" → Execute Phases 2-5

2. Paper Location:
   - Path to paper file(s) or directory

3. (If post-review) Reviewer Comments Location:
   - Path to reviewer comments file(s)

4. (If post-review) Target Venue:
   - Conference/journal name (e.g., NeurIPS, ICML, ICLR, CVPR, ACL)
   - "Other" with custom venue name

5. Auto Mode:
   - "Interactive (Recommended)" → Confirm at each phase transition
   - "Auto" → Execute all applicable phases without confirmation

Store as workflowPreferences:
  - mode: "pre-submission" | "post-review"
  - paperPath: string
  - reviewCommentsPath: string (post-review only)
  - targetVenue: string
  - autoYes: boolean
```

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase -- preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### Pre-Submission Mode

```
Phase 1: Self-Review
  Ref: phases/01-self-review.md
  Input: paperPath, targetVenue
  Output: self-review-report.md
  TodoWrite: Mark Phase 1 in_progress → completed
```

### Post-Review Mode

```
Phase 2: Review Analysis
  Ref: phases/02-review-analysis.md
  Input: reviewCommentsPath, paperPath
  Output: review-analysis.md (classified comments with priorities)
  TodoWrite: Mark Phase 2 in_progress → completed

Phase 3: Response Strategy
  Ref: phases/03-response-strategy.md
  Input: review-analysis.md, paperPath
  Output: response-strategy.md (strategy per comment)
  TodoWrite: Mark Phase 3 in_progress → completed

Phase 4: Rebuttal Writing
  Ref: phases/04-rebuttal-writing.md
  Input: response-strategy.md, paperPath, targetVenue
  Output: rebuttal-response.md
  TodoWrite: Mark Phase 4 in_progress → completed

Phase 5: Revision
  Ref: phases/05-revision.md
  Input: rebuttal-response.md, paperPath
  Output: revision-plan.md, tracked changes list
  TodoWrite: Mark Phase 5 in_progress → completed
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-self-review.md](phases/01-self-review.md) | Pre-submission quality check | TodoWrite driven |
| 2 | [phases/02-review-analysis.md](phases/02-review-analysis.md) | Parse and classify reviewer comments | TodoWrite driven |
| 3 | [phases/03-response-strategy.md](phases/03-response-strategy.md) | Plan rebuttal strategy per comment | TodoWrite driven + sentinel |
| 4 | [phases/04-rebuttal-writing.md](phases/04-rebuttal-writing.md) | Write structured rebuttal document | TodoWrite driven + sentinel |
| 5 | [phases/05-revision.md](phases/05-revision.md) | Plan and track paper revisions | TodoWrite driven |

**Compact Rules**:
1. **TodoWrite `in_progress`** -> Preserve full content, do not compress
2. **TodoWrite `completed`** -> May compress to summary
3. **Sentinel fallback** -> Phases marked with sentinel contain compact sentinels; if only sentinel remains without full Step protocol, immediately `Read()` to recover

## Core Rules

1. **Read paper first**: Always read the full paper before any review or analysis
2. **Classify before responding**: Never write rebuttals without completing review analysis and strategy
3. **No skipped comments**: Every reviewer comment must have a response entry
4. **Venue-aware tone**: Adjust strategy and emphasis based on target venue conventions
5. **Preserve reviewer numbering**: Maintain original reviewer IDs and comment numbering throughout

## Input Processing

```
User input → Structured format:

PAPER: [path to paper files]
MODE: [pre-submission | post-review]
REVIEWS: [path to reviewer comments] (post-review only)
VENUE: [target conference/journal]
OUTPUT_DIR: [directory for generated documents]
```

## Data Flow

```
paperPath ──────────────────────────────────────────────────┐
    │                                                        │
    v                                                        │
Phase 1: self-review-report.md                               │
    (Pre-submission mode ends here)                          │
                                                             │
reviewCommentsPath ─── Phase 2: review-analysis.md ──────────┤
                           │                                 │
                           v                                 │
                    Phase 3: response-strategy.md ───────────┤
                           │                                 │
                           v                                 │
                    Phase 4: rebuttal-response.md ───────────┤
                           │                                 │
                           v                                 │
                    Phase 5: revision-plan.md ────── paperPath
```

## TodoWrite Pattern

### Phase Attachment (entering phase)
```
TodoWrite([
  { id: "phase-N", task: "Phase N: [name]", status: "in_progress" },
  { id: "phase-N-step-1", task: "  Step N.1: [name]", status: "pending" },
  { id: "phase-N-step-2", task: "  Step N.2: [name]", status: "pending" }
])
```

### Phase Collapse (exiting phase)
```
TodoWrite([
  { id: "phase-N", task: "Phase N: [name] -- Done", status: "completed" },
  { id: "phase-N+1", task: "Phase N+1: [name]", status: "in_progress" }
])
```

## Error Handling

1. **Paper not found**: Ask user to confirm paper path, retry once
2. **Reviews not parseable**: Ask user to reformat or paste reviews directly
3. **Phase failure**: Log error, ask user whether to retry or skip to next phase
4. **Venue unknown**: Fall back to generic academic review conventions

## Coordinator Checklist

### Before Each Phase
- [ ] Confirm input files exist and are readable
- [ ] TodoWrite updated: current phase `in_progress`
- [ ] Read phase document via `Ref:` marker

### After Each Phase
- [ ] Output file generated and saved
- [ ] TodoWrite updated: current phase `completed`
- [ ] If not autoYes, confirm with user before next phase

### Post-Workflow
- [ ] All output files listed for user
- [ ] Summary of findings/actions presented
