# Product Brief Template

Template for generating product brief documents in Phase 2.

## Usage Context

| Phase | Usage |
|-------|-------|
| Phase 2 (Product Brief) | Generate product-brief.md from multi-CLI analysis |
| Output Location | `{workDir}/product-brief.md` |

---

## Template

```markdown
---
session_id: {session_id}
phase: 2
document_type: product-brief
status: draft
generated_at: {timestamp}
stepsCompleted: []
version: 1
dependencies:
  - spec-config.json
---

# Product Brief: {product_name}

{executive_summary - 2-3 sentences capturing the essence of the product/feature}

## Vision

{vision_statement - clear, aspirational 1-3 sentence statement of what success looks like}

## Problem Statement

### Current Situation
{description of the current state and pain points}

### Impact
{quantified impact of the problem - who is affected, how much, how often}

## Target Users

{for each user persona:}

### {Persona Name}
- **Role**: {user's role/context}
- **Needs**: {primary needs related to this product}
- **Pain Points**: {current frustrations}
- **Success Criteria**: {what success looks like for this user}

## Goals & Success Metrics

| Goal ID | Goal | Success Metric | Target |
|---------|------|----------------|--------|
| G-001 | {goal description} | {measurable metric} | {specific target} |
| G-002 | {goal description} | {measurable metric} | {specific target} |

## Scope

### In Scope
- {feature/capability 1}
- {feature/capability 2}
- {feature/capability 3}

### Out of Scope
- {explicitly excluded item 1}
- {explicitly excluded item 2}

### Assumptions
- {key assumption 1}
- {key assumption 2}

## Competitive Landscape

| Aspect | Current State | Proposed Solution | Advantage |
|--------|--------------|-------------------|-----------|
| {aspect} | {how it's done now} | {our approach} | {differentiator} |

## Constraints & Dependencies

### Technical Constraints
- {constraint 1}
- {constraint 2}

### Business Constraints
- {constraint 1}

### Dependencies
- {external dependency 1}
- {external dependency 2}

## Multi-Perspective Synthesis

### Product Perspective
{summary of product/market analysis findings}

### Technical Perspective
{summary of technical feasibility and constraints}

### User Perspective
{summary of user journey and UX considerations}

### Convergent Themes
{themes where all perspectives agree}

### Conflicting Views
{areas where perspectives differ, with notes on resolution approach}

## Open Questions

- [ ] {unresolved question 1}
- [ ] {unresolved question 2}

## References

- Derived from: [spec-config.json](spec-config.json)
- Next: [Requirements PRD](requirements.md)
```

## Variable Descriptions

| Variable | Source | Description |
|----------|--------|-------------|
| `{session_id}` | spec-config.json | Session identifier |
| `{timestamp}` | Runtime | ISO8601 generation timestamp |
| `{product_name}` | Seed analysis | Product/feature name |
| `{executive_summary}` | CLI synthesis | 2-3 sentence summary |
| `{vision_statement}` | CLI product perspective | Aspirational vision |
| All `{...}` fields | CLI analysis outputs | Filled from multi-perspective analysis |
