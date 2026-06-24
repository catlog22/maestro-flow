---
name: scholar-anti-ai-writing
description: Remove AI writing patterns from academic prose. Detects and fixes inflated symbolism, promotional language, superficial analyses, vague attributions, AI vocabulary, and formulaic structures. Supports English and Chinese. Triggers on "remove AI patterns", "humanize text", "anti-AI polish", "去除AI写作痕迹", "人性化处理".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, TodoWrite
---

# Scholar Anti-AI Writing

Detect and eliminate AI writing patterns from academic prose. Based on Wikipedia's "Signs of AI writing" guide. Supports both English and Chinese text.

**Core insight**: LLMs predict the most statistically likely outcome — creating detectable patterns. This skill identifies and rewrites those patterns while preserving meaning and adding authentic voice.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
User: "Remove AI patterns from my paper"
         |
         v
┌──────────────────────────────────────────────────────────────┐
│  SKILL.md (Orchestrator)                                      │
│  Collect preferences → Dispatch phases → Track progress       │
└──────────┬───────────────────────────────────────────────────┘
           |
   ┌───────┼───────────┬──────────────┐
   v       v           v              v
┌──────┐┌──────────┐┌──────────────┐
│ P1   ││ P2       ││ P3           │
│Detect││ Rewrite  ││ Validate     │
│ &    ││ & Polish ││ & Score      │
│Score ││          ││              │
└──┬───┘└────┬─────┘└──────┬───────┘
   │         │             │
   v         v             v
 pattern   polished     final score
 report    prose        + diff report
```

## Key Design Principles

1. **Pattern detection + soul injection**: Removing AI patterns is only half the job — add authentic voice.
2. **Preserve meaning**: Core content and technical claims must remain intact.
3. **Language-aware**: English and Chinese have different AI pattern signatures.
4. **Scoring-driven**: Quantitative 5-dimension scoring (50-point scale) guides revision.
5. **Academic tone**: Maintain scholarly register — humanize without becoming informal.

## Interactive Preference Collection

Before dispatching to any phase, collect these preferences:

```
Questions to ask the user:

1. Input Source
   "What text should I process? (file path, directory, or paste text)"
   → inputSource

2. Language
   Options: English | Chinese | Bilingual (auto-detect per section)
   → language

3. Writing Context
   Options: Academic Paper | Technical Report | Blog/Article | General Prose
   → writingContext

4. Aggressiveness
   Options: Conservative (minimal changes) | Balanced (Recommended) | Aggressive (heavy rewrite)
   → aggressiveness
```

Store responses as `antiAiPreferences` context for all phases.

## Auto Mode Defaults

When `workflowPreferences.autoYes === true`:
- Process all .tex files in cwd
- Auto-detect language
- Academic Paper context, Balanced aggressiveness
- Skip confirmation prompts

## Execution Flow

> **COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase — preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

### TodoWrite Setup

```
Anti-AI Writing:
- [ ] Phase 1: Detect & Score — scan for AI patterns, generate initial score
- [ ] Phase 2: Rewrite & Polish — rewrite flagged sections, add voice
- [ ] Phase 3: Validate & Score — re-score, verify quality threshold
```

### Phase Sequence

```
Phase 1: Detect & Score
   └─ Ref: phases/01-detect-score.md
      ├─ Input: inputSource, language
      └─ Output: patternReport (flagged passages + initial scores)

Phase 2: Rewrite & Polish
   └─ Ref: phases/02-rewrite-polish.md
      ├─ Input: patternReport, writingContext, aggressiveness
      └─ Output: polishedText (rewritten content)

Phase 3: Validate & Score
   └─ Ref: phases/03-validate-score.md
      ├─ Input: polishedText, original text
      └─ Output: finalReport (before/after scores, diff)
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-detect-score.md](phases/01-detect-score.md) | Scan patterns, score text | TodoWrite driven |
| 2 | [phases/02-rewrite-polish.md](phases/02-rewrite-polish.md) | Rewrite and humanize | TodoWrite driven + sentinel |
| 3 | [phases/03-validate-score.md](phases/03-validate-score.md) | Re-score, generate report | TodoWrite driven |

**Compact Rules**:
1. **TodoWrite `in_progress`** → preserve full content, do not compress
2. **TodoWrite `completed`** → may compress to summary
3. **sentinel fallback** → phases marked with sentinel contain compact sentinel; if only sentinel remains, **must immediately `Read()` to recover**

## Core Rules

1. **Never lose meaning**: Technical claims, data, and specific facts must survive rewriting.
2. **Score before and after**: Every processed text gets a 5-dimension score (50-point scale).
3. **Flag, don't force**: In Conservative mode, highlight issues but let the user decide.
4. **Academic register**: For papers, maintain formal-but-natural tone. No slang or casual language.
5. **Minimum threshold**: Target score >= 35/50 for academic papers, >= 40/50 for submission-ready.

## Quick Scoring System (5 dimensions, 10 points each)

| Dimension | Question | Target |
|-----------|----------|--------|
| **Directness** | Direct statements or announcements? | >= 7 |
| **Rhythm** | Varied or metronomic? | >= 7 |
| **Trust** | Respects reader intelligence? | >= 7 |
| **Authenticity** | Sounds human? | >= 7 |
| **Density** | Anything cuttable? | >= 7 |

## Data Flow

```
Phase 1 ──patternReport──→ Phase 2
Phase 2 ──polishedText──→ Phase 3
Phase 1 ──originalText──→ Phase 3 (for comparison)
```

## Error Handling

| Error | Action |
|-------|--------|
| File not found | Ask user for correct path |
| Mixed languages in one file | Process each section in detected language |
| Score below threshold after rewrite | Flag for manual review, suggest specific areas |
| LaTeX commands broken during rewrite | Preserve LaTeX structure, only modify prose content |
| User disagrees with changes | Offer side-by-side diff, allow per-section accept/reject |

## Related Skills

- **scholar-writing**: Phase 5 (Anti-AI Polish) uses this skill's patterns
- **scholar-review**: Uses scoring to assess writing quality
