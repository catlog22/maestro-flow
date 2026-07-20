
> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。
# Phase 3: Promotion Content Creation

Generate platform-specific promotional content for the accepted paper across Twitter/X, LinkedIn, and blog post formats.

## Objective

- Create a Twitter/X thread with hook, content, and call-to-action
- Write a LinkedIn post with professional tone and practical implications
- Draft a blog post for broader audience accessibility
- Provide multi-platform scheduling strategy

## Input

- `paperContext`: title, venue, contributions, authors
- `promotionPlatforms`: twitter | linkedin | blog | all

## Execution

### Step 3.1: Extract Promotion Angles

From the paper, identify angles optimized for social engagement:

```
PROMOTION_ANGLES:
  hook: [attention-grabbing one-liner about the result]
  problem_framing: [why this matters to a broad audience]
  key_result: [most impressive number or finding]
  practical_impact: [real-world application or implication]
  novelty: [what makes this different from prior work]
  visual_highlight: [best figure for social sharing]
```

### Step 3.2: Twitter/X Thread (if platforms includes twitter)

Create a thread of 5-8 tweets following this structure:

**Tweet 1 - Hook** (max 280 chars):
- Attention-grabbing summary of the result
- Use 1-2 relevant emoji sparingly
- Include a compelling figure if possible
- Example format: "Our new paper at [Venue]: [Key finding]! [Brief why it matters]"

**Tweet 2 - Problem** (max 280 chars):
- What problem does the paper solve?
- Why existing solutions fall short
- Frame as something the audience has experienced

**Tweet 3 - Method** (max 280 chars):
- High-level approach in simple terms
- Avoid jargon - explain as if to a smart non-expert
- Include architecture figure if helpful

**Tweet 4-5 - Key Results** (max 280 chars each):
- One major result per tweet
- Lead with the number or comparison
- Include result figure or table screenshot
- Example: "Result: X% improvement over [baseline] on [benchmark]"

**Tweet 6 - Broader Impact** (max 280 chars):
- Practical implications
- Who benefits and how
- Future possibilities

**Tweet 7 - Call to Action** (max 280 chars):
- Link to paper (arXiv, conference proceedings)
- Link to code repository (if available)
- Link to demo (if available)
- Relevant hashtags (3-5 max): #MachineLearning #NeurIPS2026 etc.
- Tag co-authors: @author1 @author2

**Thread Guidelines**:
- Number each tweet (1/N format) for readability
- Each tweet should make sense standalone
- First tweet is most important (it appears in timeline)
- Include 1-2 figures across the thread
- Post thread at peak engagement times (9-11 AM or 1-3 PM in target timezone)

### Step 3.3: LinkedIn Post (if platforms includes linkedin)

Write a professional post of 3-5 paragraphs:

**Structure**:

**Paragraph 1 - Announcement** (2-3 sentences):
- Paper accepted announcement
- Conference name and significance
- One-line summary of contribution

**Paragraph 2 - Problem and Motivation** (3-4 sentences):
- The challenge being addressed
- Why it matters in industry/practice
- Connect to current trends or real-world scenarios

**Paragraph 3 - Approach and Results** (3-4 sentences):
- Method overview in accessible terms
- Key results with metrics
- Comparison to prior state-of-the-art

**Paragraph 4 - Implications** (2-3 sentences):
- Practical applications
- Who can benefit from this work
- Open-source availability (if applicable)

**Paragraph 5 - Acknowledgments and Links** (2-3 sentences):
- Thank co-authors and advisors
- Thank funding sources (if appropriate)
- Links to paper, code, demo

**Formatting**:
- Add a key figure or diagram as the post image
- Use line breaks between paragraphs for readability
- Add 3-5 relevant hashtags at the end
- Tag co-authors and institutions
- Professional but approachable tone

### Step 3.4: Blog Post (if platforms includes blog)

Draft a blog post of 800-1500 words:

**Structure**:

**Title**: Engaging, non-jargon title that captures the key finding
- Good: "Teaching AI to Understand Complex Tables: Our NeurIPS 2026 Paper"
- Avoid: "A Novel Multi-Modal Transformer for Semi-Structured Data Parsing"

**Introduction** (150-200 words):
- Hook the reader with a relatable scenario
- State the problem in everyday terms
- Preview the solution and its impact

**The Problem** (150-200 words):
- Explain the challenge for a general technical audience
- Use analogies or real-world examples
- Why existing approaches are insufficient

**Our Approach** (200-300 words):
- Method overview with intuitive explanations
- Key innovation described simply
- Include the main architecture figure with detailed caption
- Use analogies: "Think of it like..."

**Results** (200-300 words):
- Key findings with context
- Include 1-2 figures with explanations
- Compare to baselines in plain language
- Highlight practical implications of numbers

**What This Means** (100-150 words):
- Real-world applications
- Limitations honestly acknowledged
- Future research directions

**Try It Yourself** (50-100 words):
- Links to paper, code, demo
- How to get started with the code
- Contact information for collaboration

**Blog Post Guidelines**:
- Write for a technical but non-specialist audience
- Avoid unexplained acronyms
- Include alt text descriptions for all figures
- Link to related blog posts or resources
- Add a TL;DR summary at the top or bottom

### Step 3.5: Multi-Platform Scheduling Strategy

Provide timing recommendations:

**Posting Schedule**:
| Platform | Timing | Rationale |
|----------|--------|-----------|
| Twitter/X | 1 week before conference | Build anticipation |
| LinkedIn | Day of / day after acceptance | Professional announcement |
| Blog | 1-2 weeks after acceptance | Allows time for polished content |

**Cross-Platform Coordination**:
- Coordinate posting times with co-authors
- Share each other's posts for amplification
- Engage with comments within first 2 hours (algorithm boost)
- Re-share during the conference week with "presenting today/tomorrow" update
- Pin the thread/post during conference dates

**Engagement Best Practices**:
- Respond to all substantive comments
- Thank people who share your work
- Follow back researchers who engage
- Include accessible figure descriptions for screen readers
- Consider posting in multiple languages if audience is international

### Step 3.6: Generate Output File

Write `promotion-content.md` with the following structure:

```markdown
# Promotion Content: [Paper Title]
## Conference: [Venue] | Platforms: [selected platforms]

## Twitter/X Thread
### Tweet 1/N (Hook)
[content]

### Tweet 2/N (Problem)
[content]

[... remaining tweets]

### Thread Figures
- Figure 1: [description, source from paper]
- Figure 2: [description, source from paper]

---

## LinkedIn Post
[full post content]

### Post Image
- Recommended: [figure description]

### Hashtags
[hashtag list]

---

## Blog Post

### Title: [blog title]

### TL;DR
[2-3 sentence summary]

[Full blog post content]

---

## Scheduling Strategy
[From Step 3.5]

## Engagement Checklist
- [ ] Co-authors tagged and notified
- [ ] Figures exported in high resolution for social sharing
- [ ] All links verified (paper, code, demo)
- [ ] QR codes generated (if using for conference)
- [ ] Hashtags researched for current relevance
- [ ] Accessible descriptions added for figures
- [ ] Cross-platform posting schedule agreed with co-authors
```

## Output

- **File**: `promotion-content.md` in working directory
- **update_plan**: Mark Phase 3 completed with platforms summary

## Next Phase

Return to orchestrator. This is the final phase - workflow complete after execution.
