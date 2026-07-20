
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 1: Presentation Slide Creation

Create a structured presentation outline with slide-by-slide content plan, timing guidance, visual design principles, and Q&A preparation.

## Objective

- Extract key messages from the accepted paper
- Create slide-by-slide outline with content and speaker notes
- Provide timing plan matched to talk duration
- Include visual design guidance and presentation tips
- Prepare backup slides for anticipated Q&A

## Input

- `paperContext`: title, venue, contributions, authors
- `talkDuration`: 15 | 20 | 30 (minutes)

## Execution

### Step 1.1: Extract Key Messages

Read the paper and identify:
- **Core problem**: What gap or challenge does this address?
- **Key insight**: What is the novel approach or finding?
- **Main results**: 2-3 most impactful results with supporting data
- **Impact statement**: Why should the audience care?

Structure as:
```
KEY_MESSAGES:
  problem: [1-2 sentences]
  insight: [1-2 sentences]
  results:
    - [result 1 with metric]
    - [result 2 with metric]
    - [result 3 with metric]
  impact: [1-2 sentences]
```

### Step 1.2: Determine Slide Count and Timing

Apply timing guidelines based on `talkDuration`:

| Duration | Slide Count | Avg Time/Slide | Notes |
|----------|-------------|----------------|-------|
| 5 min (lightning) | 5-7 | 0.7-1.0 min | Focus on 1 key result only |
| 10 min (short) | 8-12 | 0.8-1.2 min | Problem + method + 1-2 results |
| 15 min (standard) | 10-15 | 1.0-1.5 min | Full story with 2-3 results |
| 20 min (extended) | 15-20 | 1.0-1.3 min | Detailed method + full results |
| 30 min (invited) | 20-30 | 1.0-1.5 min | Context + method + results + future |
| 45 min (seminar) | 30-40 | 1.1-1.5 min | Deep dive + related work + discussion |
| 60 min (tutorial) | 40-50 | 1.2-1.5 min | Comprehensive + examples + Q&A |

**Dynamic Adjustment Guidelines**:

For **non-standard durations**, use this formula:
```
slide_count = floor(duration_minutes * 0.7) to ceil(duration_minutes * 1.0)
avg_time_per_slide = duration_minutes / slide_count
```

Examples:
- 7 min talk: 5-7 slides (1.0-1.4 min/slide)
- 12 min talk: 8-12 slides (1.0-1.5 min/slide)
- 25 min talk: 17-25 slides (1.0-1.5 min/slide)

**Content Density Adjustment**:

| Duration | Content Strategy |
|----------|------------------|
| ≤ 10 min | **Ultra-focused**: 1 problem, 1 method, 1 key result. Skip related work, skip ablations. |
| 10-20 min | **Core story**: Problem, method overview, 2-3 main results. Brief related work (1 slide). |
| 20-30 min | **Full paper**: Complete story with method details, full results, ablations, related work. |
| ≥ 30 min | **Extended**: Add motivation, broader context, future work, detailed Q&A prep. |

**Slide Allocation by Duration**:

```
5-10 min:  Opening (1) + Problem (1) + Method (2) + Results (1-2) + Conclusion (1) = 6-8 slides
15 min:    Opening (2) + Problem (1) + Method (3) + Results (3) + Related (1) + Conclusion (1) = 11-13 slides
20 min:    Opening (2) + Problem (2) + Method (4) + Results (4) + Related (1) + Conclusion (1) = 14-16 slides
30 min:    Opening (3) + Problem (2) + Method (5) + Results (6) + Related (2) + Conclusion (2) = 20-25 slides
```

General rule: 1-1.5 minutes per slide. Never exceed the upper bound.

### Step 1.3: Create Slide Structure

Generate the outline following this standard structure:

**Opening Block** (2-3 slides):
1. **Title Slide** (30 sec)
   - Paper title, authors, affiliations, venue logo
   - Contact information or QR code to paper

2. **Motivation / Problem** (1-2 slides, 2-3 min)
   - Why this problem matters
   - Real-world example or compelling statistic
   - Gap in existing approaches

**Core Content Block** (60-70% of slides):
3. **Related Work / Background** (1-2 slides, 2-3 min)
   - Position within the field (brief)
   - Key limitations of prior work
   - Use comparison table if appropriate

4. **Method Overview** (3-5 slides, 5-8 min)
   - High-level architecture or approach diagram
   - Key components explained step-by-step
   - One slide per major component
   - Use figures from the paper where possible

5. **Key Results** (3-5 slides, 4-6 min)
   - One slide per major result
   - Show figures/tables from paper
   - Highlight key numbers with large font
   - Include comparison with baselines

**Closing Block** (2-3 slides):
6. **Discussion / Limitations** (1 slide, 1-2 min)
   - Honest limitations
   - Future work directions

7. **Conclusion** (1 slide, 1-2 min)
   - 3-4 bullet point takeaways
   - Repeat the impact statement

8. **Thank You / Q&A** (1 slide)
   - Contact information
   - Links to paper, code, demo
   - QR code

### Step 1.4: Add Visual Design Guidance

For each slide, note visual elements:

**Typography**:
- Title font: 32pt minimum
- Body font: 24pt minimum
- Never go below 20pt for any text
- Use sans-serif fonts (Arial, Helvetica, Calibri)

**Color and Layout**:
- Consistent color scheme throughout (2-3 primary colors)
- High contrast: dark text on light background or vice versa
- One key message per slide
- Use whitespace generously - avoid crowded slides
- Figures and diagrams preferred over text blocks

**Animations**:
- Use sparingly and purposefully
- Build complex diagrams step-by-step
- Never use decorative transitions

### Step 1.5: Prepare Q&A Backup Slides

Create 3-5 backup slides for anticipated questions:

Common question categories:
- **Technical details**: Implementation specifics not in main talk
- **Comparison**: "How does this compare to [method X]?"
- **Scalability**: Performance on larger datasets or different domains
- **Limitations**: Deeper discussion of failure cases
- **Future work**: Concrete next steps

For each backup slide:
```
BACKUP SLIDE: [Topic]
  Anticipated question: [likely question]
  Key answer points: [2-3 bullets]
  Supporting data: [figure or table reference]
```

### Step 1.6: Write Presentation Tips

Include practical advice section:

**Before the talk**:
- Practice with a stopwatch at least 3 times
- Practice in front of colleagues for feedback
- Arrive early to test projector, laptop connection, microphone
- Have slides on USB backup and accessible online
- Check slide rendering on different screen ratios (16:9 vs 4:3)

**During the talk**:
- Start with energy - first 30 seconds set the tone
- Make eye contact with audience, not the screen
- Use a laser pointer sparingly
- Speak clearly and at moderate pace
- Pause after key points for emphasis
- Include slide numbers for Q&A reference

**During Q&A**:
- Repeat the question for the audience
- Keep answers concise (30-60 seconds)
- Say "good question" but do not overuse
- Reference backup slides when relevant
- It is fine to say "I don't know, but I'd be happy to follow up"

### Step 1.7: Generate Output File

Write `presentation-outline.md` with the following structure:

```markdown
# Presentation Outline: [Paper Title]
## Conference: [Venue] | Duration: [X] minutes | Slides: [N]

## Key Messages
[From Step 1.1]

## Timing Plan
| Block | Slides | Duration | Content |
|-------|--------|----------|---------|
[Timing breakdown from Step 1.2/1.3]

## Slide-by-Slide Outline
### Slide 1: Title
- Content: [details]
- Visual: [design notes]
- Duration: [timing]
- Speaker notes: [what to say]

### Slide 2: Motivation
[repeat pattern for each slide]

## Visual Design Guide
[From Step 1.4]

## Backup Slides for Q&A
[From Step 1.5]

## Presentation Tips
[From Step 1.6]
```

## Output

- **File**: `presentation-outline.md` in working directory
- **update_plan**: Mark Phase 1 completed with slide count and duration summary

## Next Phase

Return to orchestrator. If poster or promotion phases are selected, continue to next enabled phase.
