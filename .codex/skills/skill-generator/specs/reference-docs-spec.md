

# Reference Documents Generation Specification

> **IMPORTANT**: This specification defines how to organize and present reference documents in generated skills to avoid duplication issues.

## Core Principles

### 1. Phase-Based Organization

Reference documents must be organized by skill execution phases, not as a flat list.

**Wrong Approach** (Flat List):
```markdown
## Reference Documents

| Document | Purpose |
|----------|---------|
| doc1.md | ... |
| doc2.md | ... |
| doc3.md | ... |
```

**Correct Approach** (Phase-Based Navigation):
```markdown
## Reference Documents by Phase

### Phase 1: Analysis
Documents to refer to when executing Phase 1

| Document | Purpose | When to Use |
|----------|---------|-------------|
| doc1.md | ... | Understand concept x |

### Phase 2: Implementation
Documents to refer to when executing Phase 2

| Document | Purpose | When to Use |
|----------|---------|-------------|
| doc2.md | ... | Implement feature y |
```

### 2. Four Standard Groupings

Reference documents must be divided into the following four groupings:

| Grouping | When to Use | Content |
|----------|------------|---------|
| **Phase N: [Name]** | When executing this phase | All documents related to this phase |
| **Debugging** | When encountering problems | Issue to documentation mapping table |
| **Reference** | When learning in depth | Templates, original implementations, best practices |
| (Optional) **Quick Links** | Quick navigation | Most frequently consulted 5-7 documents |

### 3. Each Document Entry Must Include

```
| [path](path) | Purpose | When to Use |
```

**When to Use Column Requirements**:
- Clear explanation of usage scenarios
- Describe what problem is solved
- Do not simply say "refer to" or "learn about"

**Good Examples**:
- "Understand issue data structure"
- "Learn about the Planning Agent role"
- "Check if implementation meets quality standards"
- "Quickly locate the reason for status anomalies"

**Poor Examples**:
- "Reference document"
- "More information"
- "Background knowledge"

### 4. Embedding Document Guidance in Execution Flow

In the "Execution Flow" section, each Phase description should include "Refer to" hints:

```markdown
### Phase 2: Planning Pipeline
→ **Refer to**: action-plan.md, subagent-roles.md
→ Detailed flow description...
```

### 5. Quick Troubleshooting Reference Table

Should contain common issue to documentation mapping:

```markdown
### Debugging & Troubleshooting

| Issue | Solution Document |
|-------|------------------|
| Phase execution failed | Refer to corresponding phase documentation |
| Output format incorrect | specs/quality-standards.md |
| Data validation failed | specs/schema-validation.md |
```

---

## Generation Rules

### Rule 1: Document Classification Recognition

Automatically generate groupings based on skill phases:

```javascript
const phaseEmojis = {
  'discovery': '📋',      // Collection, exploration
  'generation': '🔧',     // Generation, creation
  'analysis': '🔍',       // Analysis, review
  'implementation': '⚙️', // Implementation, execution
  'validation': '✅',     // Validation, testing
  'completion': '🏁',     // Completion, wrap-up
};

// Generate a section for each phase
phases.forEach((phase, index) => {
  const emoji = phaseEmojis[phase.type] || '📌';
  const title = `### ${emoji} Phase ${index + 1}: ${phase.name}`;
  // List all documents related to this phase
});
```

### Rule 2: Document to Phase Mapping

In config, specs and templates should be annotated with their belonging phases:

```json
{
  "specs": [
    {
      "path": "specs/issue-handling.md",
      "purpose": "Issue data specification",
      "phases": ["phase-2", "phase-3"],  // Which phases this spec is related to
      "context": "Understand issue structure and validation rules"
    }
  ]
}
```

### Rule 3: Priority and Mandatory Reading

Use visual symbols to distinguish document importance:

```markdown
| Document | When | Notes |
|----------|------|-------|
| spec.md | **Must Read Before Execution** | Mandatory prerequisite |
| action.md | Refer to during execution | Operation guide |
| template.md | Reference for learning | Optional in-depth |
```

### Rule 4: Avoid Duplication

- **Mandatory Prerequisites** section: List mandatory P0 specifications
- **Reference Documents by Phase** section: List all documents (including mandatory prerequisites)
- Documents in both sections can overlap, but their purposes differ:
  - Prerequisites: Emphasize "must read first"
  - Reference: Provide "complete navigation"

---

## Implementation Example

### Sequential Skill Example

```markdown
## Mandatory Prerequisites

| Document | Purpose | When |
|----------|---------|------|
| [specs/issue-handling.md](specs/issue-handling.md) | Issue data specification | **Must Read Before Execution** |
| [specs/solution-schema.md](specs/solution-schema.md) | Solution structure | **Must Read Before Execution** |

---

## Reference Documents by Phase

### Phase 1: Issue Collection
Documents to refer to when executing Phase 1

| Document | Purpose | When to Use |
|----------|---------|-------------|
| [phases/actions/action-list.md](phases/actions/action-list.md) | Issue loading logic | Understand how to collect issues |
| [specs/issue-handling.md](specs/issue-handling.md) | Issue data specification | Verify issue format **Required Reading** |

### Phase 2: Planning
Documents to refer to when executing Phase 2

| Document | Purpose | When to Use |
|----------|---------|-------------|
| [phases/actions/action-plan.md](phases/actions/action-plan.md) | Planning process | Understand issue to solution transformation |
| [specs/solution-schema.md](specs/solution-schema.md) | Solution structure | Verify solution JSON format **Required Reading** |

### Debugging & Troubleshooting

| Issue | Solution Document |
|-------|------------------|
| Phase 1 failed | [phases/actions/action-list.md](phases/actions/action-list.md) |
| Planning output incorrect | [phases/actions/action-plan.md](phases/actions/action-plan.md) + [specs/solution-schema.md](specs/solution-schema.md) |
| Data validation failed | [specs/issue-handling.md](specs/issue-handling.md) |

### Reference & Background

| Document | Purpose | Notes |
|----------|---------|-------|
| [../issue-plan.md](../../.codex/prompts/issue-plan.md) | Original implementation | Planning Agent system prompt |
```

---

## Generation Algorithm

```javascript
function generateReferenceDocuments(config) {
  let result = '## Reference Documents by Phase\n\n';

  // Generate a section for each phase
  const phases = config.phases || config.actions || [];

  phases.forEach((phase, index) => {
    const phaseNum = index + 1;
    const emoji = getPhaseEmoji(phase.type);
    const title = phase.display_name || phase.name;

    result += `### ${emoji} Phase ${phaseNum}: ${title}\n`;
    result += `Documents to refer to when executing Phase ${phaseNum}\n\n`;

    // Find all documents related to this phase
    const docs = config.specs.filter(spec =>
      (spec.phases || []).includes(`phase-${phaseNum}`) ||
      matchesByName(spec.path, phase.name)
    );

    if (docs.length > 0) {
      result += '| Document | Purpose | When to Use |\n';
      result += '|----------|---------|-------------|\n';
      docs.forEach(doc => {
        const required = doc.phases && doc.phases[0] === `phase-${phaseNum}` ? ' **Required Reading**' : '';
        result += `| [${doc.path}](${doc.path}) | ${doc.purpose} | ${doc.context}${required} |\n`;
      });
      result += '\n';
    }
  });

  // Troubleshooting section
  result += '### Debugging & Troubleshooting\n\n';
  result += generateDebuggingTable(config);

  // In-depth reference learning
  result += '### Reference & Background\n\n';
  result += generateReferenceTable(config);

  return result;
}
```

---

## Checklist

When generating skill's SKILL.md, the reference documents section should satisfy:

- [ ] Has clear "## Reference Documents by Phase" heading
- [ ] Each phase has a corresponding section (identified with symbols)
- [ ] Each document entry includes "When to Use" column
- [ ] Includes "Debugging & Troubleshooting" section
- [ ] Includes "Reference & Background" section
- [ ] Mandatory reading documents are marked with **bold** text
- [ ] Execution Flow section includes "→ **Refer to**: ..." guidance
- [ ] Avoid overly long document lists (maximum 5-8 documents per phase)
