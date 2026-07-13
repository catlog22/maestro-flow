
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# SKILL.md Template

Template for generating new Skill entry files.

## Purpose

Generate the entry file (SKILL.md) for new Skills, serving as the main documentation and execution entry point for the Skill.

## Usage Context

| Phase | Usage |
|-------|-------|
| Phase 2 (Structure Generation) | Create SKILL.md entry file |
| Generation Trigger | `config.execution_mode` determines architecture diagram style |
| Output Location | `.claude/skills/{skill-name}/SKILL.md` |

---

## Important: YAML Front Matter Specification

> **CRITICAL**: The SKILL.md file MUST begin with YAML front matter, meaning `---` must be the first line of the file.
>
> **Do NOT use** the following formats:
> - `# Title` followed by `## Metadata` + yaml code block
> - Any content before `---`
>
> **Correct format**: The first line MUST be `---`

## Ready-to-use Template

The following is a complete SKILL.md template. When generating, **directly copy and apply** it, replacing `{{variables}}` with actual values:

---
name: {{skill_name}}
description: {{description}}. Triggers on {{triggers}}.
allowed-tools: {{allowed_tools}}
session-mode: {{session_mode}}
---

# {{display_name}}

{{description}}

## Architecture Overview

\`\`\`
{{architecture_diagram}}
\`\`\`

## Key Design Principles

{{design_principles}}

---

## Mandatory Prerequisites

> **Do NOT skip**: Before performing any operations, you **must** completely read the following documents. Proceeding without reading the specifications will result in outputs that do not meet quality standards.

{{mandatory_prerequisites}}

---

## Execution Flow

{{execution_flow}}

## Directory Setup

\`\`\`javascript
const workDir = runStart.run_dir;
{{additional_dirs}}
\`\`\`

## Output Structure

\`\`\`
{{output_structure}}
\`\`\`

## Completion Protocol

Follow [Completion Status Protocol](./../_shared/SKILL-DESIGN-SPEC.md#13) and [Escalation Protocol](./../_shared/SKILL-DESIGN-SPEC.md#14).

## Reference Documents by Phase

> **Important**: Reference documents should be organized by execution phase, clearly marking when and in what scenarios they are used. Avoid listing documents in a flat manner.

{{reference_table}}

---

## Variable Descriptions

| Variable | Type | Source |
|----------|------|--------|
| `{{skill_name}}` | string | config.skill_name |
| `{{display_name}}` | string | config.display_name |
| `{{description}}` | string | config.description |
| `{{triggers}}` | string | config.triggers.join(", ") |
| `{{allowed_tools}}` | string | config.allowed_tools.join(", ") |
| `{{architecture_diagram}}` | string | Generated based on execution_mode (includes Phase 0) |
| `{{design_principles}}` | string | Generated based on execution_mode |
| `{{mandatory_prerequisites}}` | string | List of mandatory prerequisite reading documents (specs + templates) |
| `{{execution_flow}}` | string | Generated from phases/actions (Phase 0 first) |
| `{{output_location}}` | string | config.output.location |
| `{{additional_dirs}}` | string | Generated based on execution_mode |
| `{{output_structure}}` | string | Generated based on configuration |
| `{{reference_table}}` | string | Generated from file list |

## Generation Function

```javascript
function generateSkillMd(config) {
  const template = Read('templates/skill-md.md');

  return template
    .replace(/\{\{skill_name\}\}/g, config.skill_name)
    .replace(/\{\{display_name\}\}/g, config.display_name)
    .replace(/\{\{description\}\}/g, config.description)
    .replace(/\{\{triggers\}\}/g, config.triggers.map(t => `"${t}"`).join(", "))
    .replace(/\{\{allowed_tools\}\}/g, config.allowed_tools.join(", "))
    .replace(/\{\{architecture_diagram\}\}/g, generateArchitecture(config))  // Includes Phase 0
    .replace(/\{\{design_principles\}\}/g, generatePrinciples(config))
    .replace(/\{\{mandatory_prerequisites\}\}/g, generatePrerequisites(config))  // Mandatory prerequisites
    .replace(/\{\{execution_flow\}\}/g, generateFlow(config))  // Phase 0 first
    .replace(/\{\{output_location\}\}/g, config.output.location)
    .replace(/\{\{additional_dirs\}\}/g, generateAdditionalDirs(config))
    .replace(/\{\{output_structure\}\}/g, generateOutputStructure(config))
    .replace(/\{\{reference_table\}\}/g, generateReferenceTable(config));
}

// Generate mandatory prerequisites table
function generatePrerequisites(config) {
  const specs = config.specs || [];
  const templates = config.templates || [];

  let result = '### Specification Documents (Required Reading)\n\n';
  result += '| Document | Purpose | When |\n';
  result += '|----------|---------|------|\n';

  specs.forEach((spec, index) => {
    const when = index === 0 ? '**Must read before execution**' : 'Recommended before execution';
    result += `| [${spec.path}](${spec.path}) | ${spec.purpose} | ${when} |\n`;
  });

  if (templates.length > 0) {
    result += '\n### Template Files (Must read before generation)\n\n';
    result += '| Document | Purpose |\n';
    result += '|----------|---------|\n';
    templates.forEach(tmpl => {
      result += `| [${tmpl.path}](${tmpl.path}) | ${tmpl.purpose} |\n`;
    });
  }

  return result;
}

// Generate phase-by-phase reference document guide
function generateReferenceTable(config) {
  const phases = config.phases || config.actions || [];
  const specs = config.specs || [];
  const templates = config.templates || [];

  let result = '';

  // Generate document navigation for each execution phase
  phases.forEach((phase, index) => {
    const phaseNum = index + 1;
    const phaseTitle = phase.display_name || phase.name;

    result += `### Phase ${phaseNum}: ${phaseTitle}\n`;
    result += `Documents to reference when executing Phase ${phaseNum}\n\n`;

    // List documents related to this phase
    const relatedDocs = filterDocsByPhase(specs, phase, index);
    if (relatedDocs.length > 0) {
      result += '| Document | Purpose | When to Use |\n';
      result += '|----------|---------|-------------|\n';
      relatedDocs.forEach(doc => {
        result += `| [${doc.path}](${doc.path}) | ${doc.purpose} | ${doc.context || 'Reference content'} |\n`;
      });
      result += '\n';
    }
  });

  // Troubleshooting section
  result += '### Debugging & Troubleshooting\n';
  result += 'Documents to reference when encountering issues\n\n';
  result += '| Issue | Solution Document |\n';
  result += '|-------|-------------------|\n';
  result += `| Phase execution failed | Refer to the relevant Phase documentation |\n`;
  result += `| Output does not meet expectations | [specs/quality-standards.md](specs/quality-standards.md) - Verify quality standards |\n`;
  result += '\n';

  // In-depth learning reference
  result += '### Reference & Background\n';
  result += 'For understanding the original implementation and design decisions\n\n';
  result += '| Document | Purpose | Notes |\n';
  result += '|----------|---------|-------|\n';
  templates.forEach(tmpl => {
    result += `| [${tmpl.path}](${tmpl.path}) | ${tmpl.purpose} | Reference during generation |\n`;
  });

  return result;
}

// Helper function: Get Phase emoji (removed)
// Note: Emoji support has been removed. Consider using Phase numbers instead.

// Helper function: Filter documents by Phase
function filterDocsByPhase(specs, phase, phaseIndex) {
  // Simple filtering logic: match phase name keywords
  const keywords = phase.name.toLowerCase().split('-');
  return specs.filter(spec => {
    const specName = spec.path.toLowerCase();
    return keywords.some(kw => specName.includes(kw));
  });
}
```

## Sequential Mode Example

```markdown
---
name: api-docs-generator
description: Generate API documentation from source code. Triggers on "generate api docs", "api documentation".
allowed-tools: Agent, Read, Write, Glob, Grep, Bash
---

# API Docs Generator

Generate API documentation from source code.

## Architecture Overview

\`\`\`
Phase 0: Specification Study (Mandatory prerequisite - Read and understand design specifications)
          ↓
Phase 1: Scanning        → endpoints.json
         ↓
Phase 2: Parsing         → schemas.json
         ↓
Phase 3: Generation      → api-docs.md
\`\`\`

## Mandatory Prerequisites

> **Do NOT skip**: Before performing any operations, you **must** completely read the following documents.

### Specification Documents (Required Reading)

| Document | Purpose | Priority |
|----------|---------|----------|
| [specs/api-standards.md](specs/api-standards.md) | API documentation standards specification | **P0 - Highest** |

### Template Files (Must read before generation)

| Document | Purpose |
|----------|---------|
| [templates/endpoint-doc.md](templates/endpoint-doc.md) | Endpoint documentation template |
```

## Autonomous Mode Example

```markdown
---
name: task-manager
description: Interactive task management with CRUD operations. Triggers on "manage tasks", "task list".
allowed-tools: Agent, AskUserQuestion, Read, Write
---

# Task Manager

Interactive task management with CRUD operations.

## Architecture Overview

\`\`\`
Phase 0: Specification Study (Mandatory prerequisite)
         ↓
┌────────────────────────────────────────┐
│  Orchestrator (State-driven decision)  │
└────────────┬───────────────────────────┘
             │
    ┌────────┼────────┬────────┐
    ↓        ↓        ↓        ↓
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ List   │ │ Create │ │ Edit   │ │ Delete │
└────────┘ └────────┘ └────────┘ └────────┘
\`\`\`

## Mandatory Prerequisites

> **Do NOT skip**: Before performing any operations, you **must** completely read the following documents.

### Specification Documents (Required Reading)

| Document | Purpose | Priority |
|----------|---------|----------|
| [specs/task-schema.md](specs/task-schema.md) | Task data structure specification | **P0 - Highest** |
| [specs/action-catalog.md](specs/action-catalog.md) | Action catalog | P1 |

### Template Files (Must read before generation)

| Document | Purpose |
|----------|---------|
| [templates/orchestrator-base.md](templates/orchestrator-base.md) | Orchestrator template |
| [templates/action-base.md](templates/action-base.md) | Action template |
```
