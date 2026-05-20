# Requirements PRD Template (Directory Structure)

Template for generating Product Requirements Document as a directory of individual requirement files in Phase 3.

## Usage Context

| Phase | Usage |
|-------|-------|
| Phase 3 (Requirements) | Generate `requirements/` directory from product brief expansion |
| Output Location | `{workDir}/requirements/` |

## Output Structure

```
{workDir}/requirements/
├── _index.md                      # Summary + MoSCoW table + traceability matrix + links
├── REQ-001-{slug}.md              # Individual functional requirement
├── REQ-002-{slug}.md
├── NFR-P-001-{slug}.md            # Non-functional: Performance
├── NFR-S-001-{slug}.md            # Non-functional: Security
├── NFR-SC-001-{slug}.md           # Non-functional: Scalability
├── NFR-U-001-{slug}.md            # Non-functional: Usability
└── ...
```

---

## Template: _index.md

```markdown
---
session_id: {session_id}
phase: 3
document_type: requirements-index
status: draft
generated_at: {timestamp}
version: 1
dependencies:
  - ../spec-config.json
  - ../product-brief.md
---

# Requirements: {product_name}

{executive_summary - brief overview of what this PRD covers and key decisions}

## Requirement Summary

| Priority | Count | Coverage |
|----------|-------|----------|
| Must Have | {n} | {description of must-have scope} |
| Should Have | {n} | {description of should-have scope} |
| Could Have | {n} | {description of could-have scope} |
| Won't Have | {n} | {description of explicitly excluded} |

## Functional Requirements

| ID | Title | Priority | Traces To |
|----|-------|----------|-----------|
| [REQ-001](REQ-001-{slug}.md) | {title} | Must | [G-001](../product-brief.md#goals--success-metrics) |
| [REQ-002](REQ-002-{slug}.md) | {title} | Must | [G-001](../product-brief.md#goals--success-metrics) |
| [REQ-003](REQ-003-{slug}.md) | {title} | Should | [G-002](../product-brief.md#goals--success-metrics) |

## Non-Functional Requirements

### Performance

| ID | Title | Target |
|----|-------|--------|
| [NFR-P-001](NFR-P-001-{slug}.md) | {title} | {target value} |

### Security

| ID | Title | Standard |
|----|-------|----------|
| [NFR-S-001](NFR-S-001-{slug}.md) | {title} | {standard/framework} |

### Scalability

| ID | Title | Target |
|----|-------|--------|
| [NFR-SC-001](NFR-SC-001-{slug}.md) | {title} | {target value} |

### Usability

| ID | Title | Target |
|----|-------|--------|
| [NFR-U-001](NFR-U-001-{slug}.md) | {title} | {target value} |

## Data Requirements

### Data Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| {entity_name} | {description} | {attr1, attr2, attr3} |

### Data Flows

{description of key data flows, optionally with Mermaid diagram}

## Integration Requirements

| System | Direction | Protocol | Data Format | Notes |
|--------|-----------|----------|-------------|-------|
| {system_name} | Inbound/Outbound/Both | {REST/gRPC/etc} | {JSON/XML/etc} | {notes} |

## Constraints & Assumptions

### Constraints
- {technical or business constraint 1}
- {technical or business constraint 2}

### Assumptions
- {assumption 1 - must be validated}
- {assumption 2 - must be validated}

## Priority Rationale

{explanation of MoSCoW prioritization decisions, especially for Should/Could boundaries}

## Traceability Matrix

| Goal | Requirements |
|------|-------------|
| G-001 | [REQ-001](REQ-001-{slug}.md), [REQ-002](REQ-002-{slug}.md), [NFR-P-001](NFR-P-001-{slug}.md) |
| G-002 | [REQ-003](REQ-003-{slug}.md), [NFR-S-001](NFR-S-001-{slug}.md) |

## Open Questions

- [ ] {unresolved question 1}
- [ ] {unresolved question 2}

## References

- Derived from: [Product Brief](../product-brief.md)
- Next: [Architecture](../architecture/_index.md)
```

---

## Template: REQ-NNN-{slug}.md (Individual Functional Requirement)

```markdown
---
id: REQ-{NNN}
type: functional
priority: {Must|Should|Could|Won't}
traces_to: [G-{NNN}]
status: draft
---

# REQ-{NNN}: {requirement_title}

**Priority**: {Must|Should|Could|Won't}

## Description

{detailed requirement description}

## User Story

As a {persona}, I want to {action} so that {benefit}.

## Acceptance Criteria

- [ ] {specific, testable criterion 1}
- [ ] {specific, testable criterion 2}
- [ ] {specific, testable criterion 3}

## Traces

- **Goal**: [G-{NNN}](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-{NNN}](../architecture/ADR-{NNN}-{slug}.md) (if applicable)
- **Implemented by**: [EPIC-{NNN}](../epics/EPIC-{NNN}-{slug}.md) (added in Phase 5)
```

---

## Template: NFR-{type}-NNN-{slug}.md (Individual Non-Functional Requirement)

```markdown
---
id: NFR-{type}-{NNN}
type: non-functional
category: {Performance|Security|Scalability|Usability}
priority: {Must|Should|Could}
status: draft
---

# NFR-{type}-{NNN}: {requirement_title}

**Category**: {Performance|Security|Scalability|Usability}
**Priority**: {Must|Should|Could}

## Requirement

{detailed requirement description}

## Metric & Target

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| {metric} | {target value} | {how measured} |

## Traces

- **Goal**: [G-{NNN}](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-{NNN}](../architecture/ADR-{NNN}-{slug}.md) (if applicable)
```

---

## Variable Descriptions

| Variable | Source | Description |
|----------|--------|-------------|
| `{session_id}` | spec-config.json | Session identifier |
| `{timestamp}` | Runtime | ISO8601 generation timestamp |
| `{product_name}` | product-brief.md | Product/feature name |
| `{NNN}` | Auto-increment | Requirement number (zero-padded 3 digits) |
| `{slug}` | Auto-generated | Kebab-case from requirement title |
| `{type}` | Category | P (Performance), S (Security), SC (Scalability), U (Usability) |
| `{Must\|Should\|Could\|Won't}` | User input / auto | MoSCoW priority tag |
