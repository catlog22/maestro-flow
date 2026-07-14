
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 5: Anti-AI Polish

> **COMPACT SENTINEL [Phase 5: Anti-AI Polish]**
> This phase contains 6 execution steps (Step 5.1 -- 5.6).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/05-anti-ai-polish.md")`

Remove AI-generated writing patterns from all prose to make the paper sound natural and human-written. Based on Wikipedia's "Signs of AI writing" guide.

## Objective

- Identify and eliminate AI writing patterns from all paper sections
- Humanize prose while preserving technical accuracy
- Add voice and personality appropriate for academic writing
- Score each section and ensure minimum quality threshold

## Core Insight

LLMs use statistical algorithms to predict what comes next. The result tends toward the most statistically likely outcome that applies to the widest variety of cases, creating detectable patterns. Academic reviewers are increasingly trained to spot these patterns.

## Execution

### Step 5.1: Score Each Section (Pre-Polish)

Rate each draft section on 5 dimensions (1-10 each, total 50):

| Dimension | Question |
|-----------|----------|
| Directness | Direct statements or announcements? |
| Rhythm | Varied sentence lengths or metronomic? |
| Trust | Respects reader intelligence? |
| Authenticity | Sounds human-written? |
| Density | Anything cuttable? |

Thresholds:
- 45-50: Excellent, minimal polish needed
- 35-44: Good, targeted fixes
- Below 35: Needs significant revision

Record pre-polish scores for each section.

### Step 5.2: Detect Content Patterns

Scan for these content-level AI patterns in each section:

**Undue emphasis on significance**:
- "stands as a testament", "crucial role", "pivotal moment"
- "underscores/highlights its importance", "setting the stage for"
- Fix: State facts directly. Replace with specific claims.

**Promotional language**:
- "vibrant", "rich heritage", "groundbreaking", "breathtaking"
- Fix: Use neutral, precise language.

**Superficial -ing analyses**:
- "highlighting the importance", "ensuring that", "showcasing"
- Fix: Use active verbs with specific subjects.

**Vague attributions**:
- "Experts believe", "Observers note", "Industry reports suggest"
- Fix: Cite specific sources or remove attribution.

**Formulaic "challenges" sections**:
- "Despite X, faces challenges", "Despite these challenges"
- Fix: State specific problems with evidence.

### Step 5.3: Detect Language Patterns

Scan for these language-level AI patterns:

**AI vocabulary** -- replace or remove:
- Additionally -> Also / [delete]
- Crucial -> Important / [be specific about why]
- Delve -> Examine / Analyze
- Enhance -> Improve / [be specific]
- Landscape (abstract) -> Field / Area / Domain
- Furthermore -> [delete, just start the sentence]
- Leverage -> Use
- Pivotal -> Important / Key
- Showcasing -> Showing
- Testament -> Evidence / Proof
- Underscore -> Show / Demonstrate

**Copula avoidance**:
- "serves as" -> "is"
- "stands as" -> "is"
- "represents" -> "is"
- "boasts" -> "has"
- "features" -> "has" / "includes"

**Negative parallelisms**:
- "It's not just X, it's Y" -> "X does Y"
- "not merely A, but B" -> "A and B"

**Rule of three**:
- Forced groups of three items -> prefer two or four

**Em dash overuse**:
- Excessive use of -- for parenthetical -> use commas or parentheses

**Elegant variation**:
- Excessive synonym substitution for the same concept -> pick one term, use consistently

### Step 5.4: Rewrite Sections

> **CHECKPOINT**: Before proceeding, verify:
> 1. This phase is update_plan `in_progress` (active phase protection)
> 2. Full protocol (Step 5.1 -- 5.6) is in active memory, not just sentinel
> If only sentinel remains -> `Read("phases/05-anti-ai-polish.md")` now.

For each section, apply fixes:

1. **Cut filler phrases**:
   - "In order to achieve" -> "To achieve"
   - "Due to the fact that" -> "Because"
   - "It is important to note that" -> [delete]
   - "It is worth mentioning that" -> [delete]

2. **Break formulaic structures**:
   - Vary sentence lengths. Mix short and long.
   - End paragraphs differently (not always with a punchy one-liner).
   - Avoid three consecutive sentences of the same length.

3. **Trust readers**:
   - State facts directly. Skip softening and hand-holding.
   - "It could potentially be argued that X might have some effect" -> "X affects Y"

4. **Cut quotables**:
   - If it sounds like a pull-quote or inspirational statement, rewrite it.
   - "This represents a major step in the right direction" -> [replace with specific fact]

5. **Preserve technical precision**:
   - Do NOT change technical terms, mathematical notation, or method names
   - Do NOT alter the meaning of claims or weaken evidence statements
   - Do NOT remove necessary hedging for genuinely uncertain claims

Write polished sections to: `outputDir/.writing/polished/`

### Step 5.5: Score Each Section (Post-Polish)

Re-score each section on the same 5 dimensions.

Requirements:
- All sections must score >= 35
- If any section scores below 35, re-polish that section
- Maximum 2 re-polish rounds per section

Record comparison:

```markdown
## Anti-AI Polish Report

| Section | Pre-Score | Post-Score | Change |
|---------|-----------|------------|--------|
| Abstract | 28 | 42 | +14 |
| Introduction | 32 | 45 | +13 |
| Methods | 38 | 44 | +6 |
| Experiments | 35 | 43 | +8 |
| Related Work | 25 | 40 | +15 |
| Conclusion | 30 | 41 | +11 |
```

### Step 5.6: Academic Voice Calibration

Academic writing has different anti-AI considerations than general prose:

**Appropriate for academic papers**:
- Measured hedging for genuinely uncertain claims ("Our results suggest...")
- Passive voice for methodology ("The model was trained...")
- Formal register without being stiff
- First-person plural ("We propose...", "We observe...")

**NOT appropriate for academic papers**:
- Casual asides or humor (unlike blog posts)
- Strong first-person opinions ("I genuinely feel...")
- Colloquialisms

The goal is natural academic prose, not casual blog writing. The anti-AI patterns to remove are the formulaic, promotional, and vague patterns -- not the formal register itself.

## Common Fixes Quick Reference

| Before | After |
|--------|-------|
| "serves as a testament to" | "shows" |
| "Moreover, it provides" | "It adds" / "It also provides" |
| "It's not just X, it's Y" | "X does Y" |
| "Industry experts believe" | "According to [specific source]" |
| "plays a crucial role in" | "is important for" / [be specific] |
| "In recent years" | [state the specific timeframe] |
| "A growing body of research" | "[N] recent studies [refs]" |
| "has garnered significant attention" | "is widely studied [refs]" |

## Output

- **Files**: Polished sections in `outputDir/.writing/polished/` (same structure as drafts/)
- **File**: `outputDir/.writing/anti-ai-report.md` (scoring report)
- **Variable**: `polishedDraft` (path to polished/ directory)
- **update_plan**: Mark Phase 5 completed, Phase 6 in_progress

## Next Phase

Return to orchestrator, then continue to [Phase 6: Conference Formatting](06-conference-formatting.md).
