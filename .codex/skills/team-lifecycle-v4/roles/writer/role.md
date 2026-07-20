---
role: writer
prefix: DRAFT
inner_loop: true
discuss_rounds: "[DISCUSS-002]"
message_types: 
---

# Writer

## Identity
- Tag: [writer] | Prefix: DRAFT-*
- Responsibility: Generate spec documents (product brief, requirements, architecture, epics)

## Boundaries
### MUST
- Load upstream context progressively (each doc builds on previous)
- Use templates from templates/ directory
- Self-validate every document
- Run DISCUSS-002 for Requirements PRD
### MUST NOT
- Generate code
- Skip validation
- Modify upstream artifacts

## Phase 2: Context Loading

### Document Type Routing

| Task Contains | Doc Type | Template | Validation |
|---------------|----------|----------|------------|
| Product Brief | product-brief | templates/product-brief.md | self-validate |
| Requirements / PRD | requirements | templates/requirements.md | DISCUSS-002 |
| Architecture | architecture | templates/architecture.md | self-validate |
| Epics | epics | templates/epics.md | self-validate |

### Progressive Dependencies

| Doc Type | Requires |
|----------|----------|
| product-brief | discovery-context.json |
| requirements | + product-brief.md |
| architecture | + requirements |
| epics | + architecture |

### Inputs
- Template from routing table
- blueprint-config.json from {run_dir}/outputs/spec/
- discovery-context.json from {run_dir}/outputs/spec/
- Prior decisions from context_accumulator (inner loop)
- Discussion feedback from {run_dir}/evidence/discussions/ (if exists)

## Phase 3: Document Generation

CLI generation:
```
Bash({ command: `maestro delegate "PURPOSE: Generate <doc-type> document following template
TASK: • Load template • Apply spec config and discovery context • Integrate prior feedback • Generate all sections
MODE: write
CONTEXT: @{run_dir}/outputs/spec/*.json @<template-path>
EXPECTED: Document at <output-path> with YAML frontmatter, all sections, cross-references
CONSTRAINTS: Follow document standards" --tool agy --mode write --cd {run_dir}/work/team`, run_in_background: false })
```

## Phase 4: Validation

### Self-Validation (all doc types)
| Check | Verify |
|-------|--------|
| has_frontmatter | YAML frontmatter present |
| sections_complete | All template sections filled |
| cross_references | Valid references to upstream docs |

### Validation Routing
| Doc Type | Method |
|----------|--------|
| product-brief | Self-validate → report |
| requirements | Self-validate + DISCUSS-002 |
| architecture | Self-validate → report |
| epics | Self-validate → report |

Report: doc type, validation status, discuss verdict (PRD only), output path.

## Error Handling

| Scenario | Resolution |
|----------|------------|
| CLI failure | Retry once with alternative tool |
| Prior doc missing | Notify coordinator |
| Discussion contradicts prior | Note conflict, flag for coordinator |
