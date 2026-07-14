# Phase 1: Detect & Score

## Objective

Scan the input text for AI writing patterns across four categories and generate an initial quality score on five dimensions. This phase produces a pattern report that drives Phase 2 rewrites.

## Execution

### Step 1.1: Load Input

1. Accept input as file path (.tex, .md) or pasted text
2. Read full content into working memory
3. Detect primary language:
   - **English**: ASCII-dominant, Latin script
   - **Chinese**: CJK character majority
   - **Mixed**: Both scripts present -- note ratio and mark bilingual sections
4. If LaTeX (.tex): parse preamble separately, focus scanning on body content only (between `\begin{document}` and `\end{document}`)

### Step 1.2: Pattern Scan

Scan text against reference pattern files. For each match, record: passage text, line/paragraph location, pattern ID, category, and severity (high/medium/low).

#### Category A: Content Patterns

Reference: `references/patterns-english.md` sections 1-6, `references/patterns-chinese.md` sections 1-6

| ID | Pattern | Severity |
|----|---------|----------|
| C1 | Undue emphasis on significance | High |
| C2 | Undue emphasis on notability | Medium |
| C3 | Superficial -ing analyses | High |
| C4 | Promotional language | High |
| C5 | Vague attributions | Medium |
| C6 | Formulaic challenges sections | Medium |

#### Category B: Language Patterns

Reference: `references/patterns-english.md` sections 7-12, `references/patterns-chinese.md` sections 7-12

| ID | Pattern | Severity |
|----|---------|----------|
| L1 | AI vocabulary (Additionally, crucial, delve, enhance, landscape, etc.) | High |
| L2 | Copula avoidance (serves as, stands as) | Medium |
| L3 | Negative parallelisms | Medium |
| L4 | Rule of three | Low |
| L5 | Elegant variation (synonym cycling) | Medium |
| L6 | False ranges | Low |

#### Category C: Style Patterns

Reference: `references/patterns-english.md` sections 13-15, `references/patterns-chinese.md` sections 13-15

| ID | Pattern | Severity |
|----|---------|----------|
| S1 | Em dash overuse | Medium |
| S2 | Boldface overuse | Low |
| S3 | Inline-header vertical lists | Medium |

#### Category D: Communication & Filler Patterns

Reference: `references/patterns-english.md` sections 16-20, `references/patterns-chinese.md` sections 16-20

| ID | Pattern | Severity |
|----|---------|----------|
| F1 | Collaborative artifacts (I hope this helps, Let me know) | High |
| F2 | Knowledge cutoff disclaimers | High |
| F3 | Filler phrases | Medium |
| F4 | Excessive hedging | Medium |
| F5 | Generic positive conclusions | Medium |

### Step 1.3: Score

Rate the text on a 1-10 scale for each dimension (10 = best). Score per section if the text has clear sections, then compute overall scores.

| Dimension | 1 (worst) | 10 (best) |
|-----------|-----------|-----------|
| **Directness** | Every point announced before stated; throat-clearing openers everywhere | Claims made directly without pre-announcement or softening |
| **Rhythm** | Every sentence same length and structure; metronomic cadence | Varied sentence lengths; short punchy lines mixed with longer ones |
| **Trust** | Reader hand-held through every inference; over-explained | Facts stated; reader trusted to draw conclusions |
| **Authenticity** | Reads like template-generated content; no human voice | Sounds like a specific person wrote it; has opinions and texture |
| **Density** | Significant cuttable filler; redundant phrases throughout | Every word earns its place; nothing cuttable without losing meaning |

**Scoring rules**:
- Score each section independently first
- Weight section scores by word count for overall score
- Total possible = 50 (5 dimensions x 10 max)
- Record specific passages that caused low scores as evidence

## Output

```
patternReport:
  language: <detected language>
  sections:
    - name: <section identifier>
      wordCount: <n>
      flaggedPassages:
        - text: "<flagged passage>"
          location: <line or paragraph ref>
          patternId: <C1-C6, L1-L6, S1-S3, F1-F5>
          category: <content|language|style|filler>
          severity: <high|medium|low>
          suggestion: "<brief fix direction>"
      scores:
        directness: <1-10>
        rhythm: <1-10>
        trust: <1-10>
        authenticity: <1-10>
        density: <1-10>
        total: <5-50>
  overall:
    totalPatterns: <count>
    bySeverity: { high: <n>, medium: <n>, low: <n> }
    byCategory: { content: <n>, language: <n>, style: <n>, filler: <n> }
    scores:
      directness: <weighted avg>
      rhythm: <weighted avg>
      trust: <weighted avg>
      authenticity: <weighted avg>
      density: <weighted avg>
      total: <weighted avg>
```

## Next Phase

Pass `patternReport` to **Phase 2: Rewrite & Polish** for targeted corrections.
