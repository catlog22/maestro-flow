# Phase 2: Academic Poster Design

Design a complete poster layout with section placement, typography specifications, visual hierarchy, and print-ready guidelines.

## Objective

- Define poster dimensions and layout grid
- Create section-by-section content plan
- Specify typography and color guidelines
- Include QR code and visual element placement
- Provide print preparation checklist

## Input

- `paperContext`: title, venue, contributions, authors
- `posterFormat`: portrait | landscape

## Execution

### Step 2.1: Determine Poster Dimensions

Apply format based on `posterFormat`:

| Format | Dimensions (Imperial) | Dimensions (Metric) | Common Use |
|--------|----------------------|---------------------|------------|
| Portrait | 24 x 36 inches | ~610 x 914 mm | Most common |
| Portrait (A0) | 33.1 x 46.8 inches | 841 x 1189 mm | European venues |
| Landscape | 36 x 24 inches | ~914 x 610 mm | Some venues |
| Landscape (A0) | 46.8 x 33.1 inches | 1189 x 841 mm | European venues |

**Important**: Always check conference-specific size requirements. Note any size constraints in the output.

### Step 2.2: Define Layout Grid

**Portrait Layout** (recommended 3-column):
```
┌──────────────────────────────────────────────────┐
│                  TITLE BAR                        │
│  Title | Authors | Affiliations | Logos           │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │          │  │          │  │          │        │
│  │ INTRO /  │  │ METHOD / │  │ RESULTS  │        │
│  │ PROBLEM  │  │ APPROACH │  │          │        │
│  │          │  │          │  │          │        │
│  │          │  │          │  │          │        │
│  └──────────┘  └──────────┘  └──────────┘        │
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │  CONCLUSION / FUTURE WORK / QR CODE      │     │
│  └──────────────────────────────────────────┘     │
│                                                    │
└──────────────────────────────────────────────────┘
```

**Landscape Layout** (recommended 4-column):
```
┌────────────────────────────────────────────────────────────┐
│                       TITLE BAR                              │
│  Title | Authors | Affiliations | Logos                      │
├────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ INTRO /  │ │  METHOD  │ │ RESULTS  │ │CONCLUSION│       │
│ │ PROBLEM  │ │          │ │          │ │+ QR CODE │       │
│ │          │ │          │ │          │ │          │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
└────────────────────────────────────────────────────────────┘
```

### Step 2.3: Create Section Content Plan

For each poster section, define content and visual elements:

**Title Bar** (top 10-15% of poster):
- Paper title: prominent, 72-96pt font
- Authors with affiliations (numbered superscripts)
- Institution logos (left and right corners)
- Conference logo or session identifier
- Optional: funding acknowledgment

**Introduction / Problem Statement** (15-20% of content area):
- Problem context in 3-5 bullet points
- Motivating figure or example
- Research question clearly stated
- Keep text minimal - poster is for scanning, not reading

**Method / Approach** (25-30% of content area):
- Architecture diagram or method flowchart (central visual element)
- Key equations (if critical, max 2-3)
- Step-by-step process with numbered items
- Use icons or small diagrams to illustrate concepts

**Results** (25-30% of content area):
- 2-3 key figures or tables from the paper
- Highlight best numbers with color or bold
- Brief captions explaining each figure
- Comparison table with baselines if applicable

**Conclusion / Future Work** (10-15% of content area):
- 3-4 key takeaway bullet points
- Future work directions (brief)
- QR code linking to:
  - Paper PDF
  - Code repository
  - Demo or supplementary materials

### Step 2.4: Typography Specifications

**Font Size Guide** (must be readable from 4-6 feet / 1.2-1.8 meters):

| Element | Font Size | Weight |
|---------|-----------|--------|
| Paper title | 72-96 pt | Bold |
| Author names | 36-48 pt | Regular |
| Section headers | 36-48 pt | Bold |
| Body text | 24-32 pt | Regular |
| Captions | 20-24 pt | Italic |
| References | 18-20 pt | Regular |

**Font Recommendations**:
- Headers: Sans-serif (Arial, Helvetica, Open Sans)
- Body: Sans-serif for posters (easier to read at distance)
- Avoid decorative or script fonts entirely
- Maintain consistent font family throughout

### Step 2.5: Color and Visual Design

**Color Scheme**:
- Use 2-3 primary colors maximum
- Match institution or conference branding when possible
- Ensure sufficient contrast (WCAG AA minimum)
- Use color consistently: headers in color A, highlights in color B
- Background: white or very light neutral (avoid dark backgrounds)

**Visual Hierarchy**:
- Title bar should be the first thing noticed
- Section headers clearly differentiate content blocks
- Key results highlighted with color, size, or framing
- Reading flow: left-to-right, top-to-bottom (match column layout)

**Figures and Images**:
- Resolution: minimum 300 DPI for print
- Vector graphics preferred (SVG, PDF) for diagrams
- Consistent styling across all figures
- Border or background to separate figures from text

### Step 2.6: QR Code and Contact Information

**QR Code Placement**:
- Bottom-right corner of poster (standard location)
- Size: minimum 2x2 inches (5x5 cm) for reliable scanning
- Include short URL label below QR code
- Test QR code at print size before final print

**QR Code Links** (create separate codes if needed):
1. Paper PDF (primary)
2. Code repository (if available)
3. Contact/website (optional)

### Step 2.7: Print Preparation Checklist

Include in output:
- [ ] Verify poster dimensions match conference requirements
- [ ] All text readable at arm's length (24pt minimum body)
- [ ] Figures at 300+ DPI resolution
- [ ] Color mode: CMYK for professional printing
- [ ] Export as PDF with fonts embedded
- [ ] Print test at 25% scale on A4/Letter paper
- [ ] Check alignment and margins (minimum 0.5 inch / 1.3 cm)
- [ ] QR code tested and functional
- [ ] Spell check all text
- [ ] Co-author approval obtained

**Poster Presentation Tips**:
- Bring business cards with QR code to paper
- Prepare a 2-minute elevator pitch version
- Prepare a 5-minute detailed walkthrough version
- Stand to the side of the poster, not in front
- Engage visitors by asking "Would you like me to walk you through it?"
- Have a tablet or laptop with demo ready (if applicable)

### Step 2.8: Generate Output File

Write `poster-outline.md` with the following structure:

```markdown
# Poster Design Outline: [Paper Title]
## Conference: [Venue] | Format: [Portrait/Landscape] | Size: [dimensions]

## Layout Grid
[ASCII layout from Step 2.2]

## Section Content Plan

### Title Bar
- Title: [full title]
- Authors: [list with affiliations]
- Logos: [institutions]

### Introduction
- Content: [bullet points]
- Visual: [motivating figure description]

### Method
- Content: [key approach points]
- Visual: [architecture diagram description]

### Results
- Content: [key findings]
- Figures: [list of figures with descriptions]

### Conclusion
- Takeaways: [3-4 points]
- QR codes: [links to include]

## Typography Guide
[From Step 2.4]

## Color Scheme
[From Step 2.5]

## Print Preparation Checklist
[From Step 2.7]

## Presentation Tips
[From Step 2.7]
```

## Output

- **File**: `poster-outline.md` in working directory
- **update_plan**: Mark Phase 2 completed with poster format summary

## Next Phase

Return to orchestrator. If promotion phase is selected, continue to Phase 3.
