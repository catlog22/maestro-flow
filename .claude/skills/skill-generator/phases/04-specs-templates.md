
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 4: Specifications & Templates Generation

## Objective

Generate comprehensive specifications and templates:
- Domain requirements document with validation function
- Quality standards with automated check system
- Agent base template with prompt structure
- Action catalog for autonomous mode (conditional)

## Input

**File Dependencies**:
- `skill-config.json` (from Phase 1)
- `.claude/skills/{skill-name}/` directory (from Phase 2)
- Generated phase/action files (from Phase 3)

**Required Information**:
- Skill name, display name, description
- Execution mode (determines if action-catalog.md is generated)
- Output format and location
- Phase/action definitions

## Output

**Generated Files**:

| File | Purpose | Generation Condition |
|------|---------|---------------------|
| `specs/{skill-name}-requirements.md` | Domain requirements with validation | Always |
| `specs/quality-standards.md` | Quality evaluation criteria | Always |
| `templates/agent-base.md` | Agent prompt template | Always |
| `specs/action-catalog.md` | Action dependency graph and selection priority | Autonomous/Hybrid mode only |

**File Structure**:

**Domain Requirements** (`specs/{skill-name}-requirements.md`):
```markdown
# {display_name} Requirements
- When to Use (phase/action reference table)
- Domain Requirements (Functional requirements, Output requirements, Quality requirements)
- Validation Function (JavaScript code)
- Error Handling (recovery strategies)
```

**Quality Standards** (`specs/quality-standards.md`):
```markdown
# Quality Standards
- Quality Dimensions (Completeness 25%, Consistency 25%, Accuracy 25%, Usability 25%)
- Quality Gates (Pass ≥80%, Review 60-79%, Fail <60%)
- Issue Classification (Errors, Warnings, Info)
- Automated Checks (runQualityChecks function)
```

**Agent Base** (`templates/agent-base.md`):
```markdown
# Agent Base Template
- Universal Prompt Structure (ROLE, PROJECT CONTEXT, TASK, CONSTRAINTS, OUTPUT_FORMAT, QUALITY_CHECKLIST)
- Variable Description (workDir, output_path)
- Return Format (AgentReturn interface)
- Role Definition Reference (phase/action specific agents)
```

**Action Catalog** (`specs/action-catalog.md`, Autonomous/Hybrid only):
```markdown
# Action Catalog
- Available Actions (table with Purpose, Preconditions, Effects)
- Action Dependencies (Mermaid diagram)
- State Transitions (state machine table)
- Selection Priority (ordered action list)
```

## Decision Logic

```
Decision (execution_mode check):
   ├─ mode === 'sequential' → Generate 3 files only
   │  └─ Files: requirements.md, quality-standards.md, agent-base.md
   │
   ├─ mode === 'autonomous' → Generate 4 files
   │  ├─ Files: requirements.md, quality-standards.md, agent-base.md
   │  └─ Additional: action-catalog.md (with action dependencies)
   │
   └─ mode === 'hybrid' → Generate 4 files
      ├─ Files: requirements.md, quality-standards.md, agent-base.md
      └─ Additional: action-catalog.md (with hybrid logic)
```

## Execution Protocol

```javascript
// Phase 4: Generate Specifications & Templates
// Reference: phases/04-specs-templates.md

// Load config and setup
const config = JSON.parse(Read(`${workDir}/skill-config.json`));
const skillDir = `.claude/skills/${config.skill_name}`;

// Ensure specs and templates directories exist (created in Phase 2)
// skillDir structure: phases/, specs/, templates/

// Step 1: Generate domain requirements
const domainRequirements = `# ${config.display_name} Requirements

${config.description}

## When to Use

| Phase | Usage | Reference |
|-------|-------|-----------|
${config.execution_mode === 'sequential' ?
  config.sequential_config.phases.map((p, i) =>
    `| Phase ${i+1} | ${p.name} | ${p.id}.md |`
  ).join('\n') :
  `| Orchestrator | Action selection | orchestrator.md |
| Actions | Action execution | actions/*.md |`}

---

## Domain Requirements

### Functional Requirements

- [ ] Requirement 1: TODO
- [ ] Requirement 2: TODO
- [ ] Requirement 3: TODO

### Output Requirements

- [ ] Format: ${config.output.format}
- [ ] Location: ${config.output.location}
- [ ] Naming: ${config.output.filename_pattern}

### Quality Requirements

- [ ] Completeness: All necessary content exists
- [ ] Consistency: Terminology and format unified
- [ ] Accuracy: Content based on actual analysis

## Validation Function

\`\`\`javascript
function validate${toPascalCase(config.skill_name)}(output) {
  const checks = [
    // TODO: Add validation rules
    { name: "Format correct", pass: output.format === "${config.output.format}" },
    { name: "Content complete", pass: output.content?.length > 0 }
  ];

  return {
    passed: checks.filter(c => c.pass).length,
    total: checks.length,
    details: checks
  };
}
\`\`\`

## Error Handling

| Error | Recovery |
|-------|----------|
| Missing input data | Return clear error message |
| Processing timeout | Reduce scope, retry |
| Output validation failure | Log issue, manual review |
`;

Write(`${skillDir}/specs/${config.skill_name}-requirements.md`, domainRequirements);

// Step 2: Generate quality standards
const qualityStandards = `# Quality Standards

Quality assessment standards for ${config.display_name}.

## Quality Dimensions

### 1. Completeness (Completeness) - 25%

| Requirement | Weight | Validation Method |
|------------|--------|-----------------|
| All necessary outputs exist | 10 | File check |
| Content coverage complete | 10 | Content analysis |
| No placeholder remnants | 5 | Text search |

### 2. Consistency (Consistency) - 25%

| Aspect | Check |
|--------|-------|
| Terminology | Use same term for same concept |
| Format | Title levels, code block format consistent |
| Style | Tone and expression unified |

### 3. Accuracy (Accuracy) - 25%

| Requirement | Description |
|-------------|------------|
| Data correct | References and data error-free |
| Logic correct | Process and relationship descriptions accurate |
| Code correct | Code examples runnable |

### 4. Usability (Usability) - 25%

| Metric | Goal |
|--------|------|
| Readability | Clear structure, easy to understand |
| Navigability | Table of contents and links correct |
| Operability | Steps clear, executable |

## Quality Gates

| Gate | Threshold | Action |
|------|-----------|--------|
| Pass | >= 80% | Output final deliverables |
| Review | 60-79% | Process warnings then continue |
| Fail | < 60% | Must fix |

## Issue Classification

### Errors (Must Fix)

- Necessary output missing
- Data error
- Code not runnable

### Warnings (Should Fix)

- Format inconsistency
- Content depth insufficient
- Missing examples

### Info (Nice to Have)

- Optimization suggestions
- Enhancement opportunities

## Automated Checks

\`\`\`javascript
function runQualityChecks(workDir) {
  const results = {
    completeness: checkCompleteness(workDir),
    consistency: checkConsistency(workDir),
    accuracy: checkAccuracy(workDir),
    usability: checkUsability(workDir)
  };

  results.overall = (
    results.completeness * 0.25 +
    results.consistency * 0.25 +
    results.accuracy * 0.25 +
    results.usability * 0.25
  );

  return {
    score: results.overall,
    gate: results.overall >= 80 ? 'pass' :
          results.overall >= 60 ? 'review' : 'fail',
    details: results
  };
}
\`\`\`
`;

Write(`${skillDir}/specs/quality-standards.md`, qualityStandards);

// Step 3: Generate agent base template
const agentBase = `# Agent Base Template

Agent base template for ${config.display_name}.

## Universal Prompt Structure

\`\`\`
[ROLE] You are {role}, focused on {responsibility}.

[PROJECT CONTEXT]
Skill: ${config.skill_name}
Objective: ${config.description}

[TASK]
{task description}
- Output: {output_path}
- Format: ${config.output.format}

[CONSTRAINTS]
- Constraint 1
- Constraint 2

[OUTPUT_FORMAT]
1. Execute task
2. Return JSON summary information

[QUALITY_CHECKLIST]
- [ ] Output format correct
- [ ] Content complete without omission
- [ ] No placeholder remnants
\`\`\`

## Variable Description

| Variable | Source | Example |
|----------|--------|---------|
| {workDir} | Runtime | {run_dir}/outputs |
| {output_path} | Configuration | ${config.output.location}/${config.output.filename_pattern} |

## Return Format

\`\`\`typescript
interface AgentReturn {
  status: "completed" | "partial" | "failed";
  output_file: string;
  summary: string;  // Max 50 chars
  stats?: {
    items_processed?: number;
    errors?: number;
  };
}
\`\`\`

## Role Definition Reference

${config.execution_mode === 'sequential' ?
  config.sequential_config.phases.map((p, i) =>
    `- **Phase ${i+1} Agent**: ${p.name} Expert`
  ).join('\n') :
  config.autonomous_config.actions.map(a =>
    `- **${a.name} Agent**: ${a.description || a.name + ' Executor'}`
  ).join('\n')}
`;

Write(`${skillDir}/templates/agent-base.md`, agentBase);

// Step 4: Conditional - Generate action catalog for autonomous/hybrid mode
if (config.execution_mode === 'autonomous' || config.execution_mode === 'hybrid') {
  const actionCatalog = `# Action Catalog

Available action catalog for ${config.display_name}.

## Available Actions

| Action | Purpose | Preconditions | Effects |
|--------|---------|---------------|---------|
${config.autonomous_config.actions.map(a =>
  `| [${a.id}](../phases/actions/${a.id}.md) | ${a.description || a.name} | ${a.preconditions?.join(', ') || '-'} | ${a.effects?.join(', ') || '-'} |`
).join('\n')}

## Action Dependencies

\`\`\`mermaid
graph TD
${config.autonomous_config.actions.map((a, i, arr) => {
  if (i === 0) return \`    ${a.id.replace(/-/g, '_')}[${a.name}]\`;
  const prev = arr[i-1];
  return \`    ${prev.id.replace(/-/g, '_')} --> ${a.id.replace(/-/g, '_')}[${a.name}]\`;
}).join('\n')}
\`\`\`

## State Transitions

| From State | Action | To State |
|------------|--------|----------|
| pending | action-init | running |
${config.autonomous_config.actions.slice(1).map(a =>
  `| running | ${a.id} | running |`
).join('\n')}
| running | action-complete | completed |
| running | action-abort | failed |

## Selection Priority

When multiple actions' preconditions are met, select based on the following priority:

${config.autonomous_config.actions.map((a, i) =>
  \`${i + 1}. \\\`${a.id}\\\` - ${a.name}\`
).join('\n')}
`;

  Write(`${skillDir}/specs/action-catalog.md`, actionCatalog);
}

// Helper function
function toPascalCase(str) {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

// Phase output summary
console.log('Phase 4 complete: Generated specs and templates');
```

## Next Phase

→ [Phase 5: Validation](05-validation.md)

**Data Flow to Phase 5**:
- All generated files in `specs/` and `templates/`
- skill-config.json for validation reference
- Complete skill directory structure ready for final validation
