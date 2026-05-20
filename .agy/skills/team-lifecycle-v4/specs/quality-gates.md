# Quality Gates

## 1. Quality Thresholds

| Result | Score | Action |
|--------|-------|--------|
| Pass | >= 80% | Proceed to next phase |
| Review | 60-79% | Revise flagged items, re-evaluate |
| Fail | < 60% | Return to producer for rework |

## 2. Scoring Dimensions

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Completeness | 25% | All required sections present with substantive content |
| Consistency | 25% | Terminology, formatting, cross-references are uniform |
| Traceability | 25% | Clear chain: Goals -> Requirements -> Architecture -> Stories |
| Depth | 25% | ACs are testable, ADRs justified, stories estimable |

**Score** = weighted average of all dimensions (0-100 per dimension).

## 3. Per-Phase Quality Gates

### Phase 2: Product Brief

| Check | Pass Criteria |
|-------|---------------|
| Vision statement | Clear, one-paragraph, measurable outcome |
| Problem definition | Specific pain points with evidence |
| Target users | Defined personas or segments |
| Success goals | Quantifiable metrics (KPIs) |
| Success metrics | Measurement method specified |

### Phase 3: Requirements PRD

| Check | Pass Criteria |
|-------|---------------|
| Functional requirements | Each has unique ID (FR-NNN) |
| Acceptance criteria | Testable given/when/then format |
| Prioritization | MoSCoW applied to all requirements |
| User stories | Format: As a [role], I want [goal], so that [benefit] |
| Non-functional reqs | Performance, security, scalability addressed |

### Phase 4: Architecture

| Check | Pass Criteria |
|-------|---------------|
| Component diagram | All major components identified with boundaries |
| Tech stack | Each choice justified against alternatives |
| ADRs | At least 1 ADR per major decision, with status |
| Data model | Entities, relationships, key fields defined |
| Integration points | APIs, protocols, data formats specified |

### Phase 5: Epics & Stories

| Check | Pass Criteria |
|-------|---------------|
| Epic count | 2-8 epics (too few = too broad, too many = too granular) |
| MVP subset | Clearly marked MVP epics/stories |
| Stories per epic | 3-12 stories each |
| Story format | Title, description, ACs, estimate present |

### Phase 6: Readiness Gate

| Check | Pass Criteria |
|-------|---------------|
| All docs exist | Brief, PRD, Architecture, Epics all present |
| Cross-refs valid | All document references resolve correctly |
| Overall score | >= 60% across all dimensions |
| No P0 issues | Zero Error-class issues outstanding |

## 4. Cross-Document Validation

| Source | Target | Validation |
|--------|--------|------------|
| Brief goals | PRD requirements | Every goal has >= 1 requirement |
| PRD requirements | Architecture components | Every requirement maps to a component |
| PRD requirements | Epic stories | Every requirement covered by >= 1 story |
| Architecture components | Epic stories | Every component has implementation stories |
| Brief success metrics | Epic ACs | Metrics traceable to acceptance criteria |

## 5. Code Review Dimensions

For REVIEW-* tasks during implementation phases.

### Quality

| Check | Severity |
|-------|----------|
| Empty catch blocks | Error |
| `as any` type casts | Warning |
| `@ts-ignore` / `@ts-expect-error` | Warning |
| `console.log` in production code | Warning |
| Unused imports/variables | Info |

### Security

| Check | Severity |
|-------|----------|
| Hardcoded secrets/credentials | Error |
| SQL injection vectors | Error |
| `eval()` or `Function()` usage | Error |
| `innerHTML` assignment | Warning |
| Missing input validation | Warning |

### Architecture

| Check | Severity |
|-------|----------|
| Circular dependencies | Error |
| Deep cross-boundary imports (3+ levels) | Warning |
| Files > 500 lines | Warning |
| Functions > 50 lines | Info |

### Requirements Coverage

| Check | Severity |
|-------|----------|
| Core functionality implemented | Error if missing |
| Acceptance criteria covered | Error if missing |
| Edge cases handled | Warning |
| Error states handled | Warning |

## 6. Issue Classification

| Class | Label | Action |
|-------|-------|--------|
| Error | Must fix | Blocks progression, must resolve before proceeding |
| Warning | Should fix | Should resolve, can proceed with justification |
| Info | Nice to have | Optional improvement, log for future |
