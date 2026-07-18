
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 2: Structure Generation

Create Skill directory structure and entry file based on configuration.

## Objective

- Create standard directory structure
- Generate SKILL.md entry file
- Create corresponding subdirectories based on execution mode


## Execution Steps

### Step 1: Read Configuration

```javascript
const config = JSON.parse(Read(`${workDir}/skill-config.json`));
const skillDir = `.claude/skills/${config.skill_name}`;
```

### Step 2: Create Directory Structure

#### Base Directories (All Modes)

```javascript
// Base infrastructure
Bash(`mkdir -p "${skillDir}/{phases,specs,templates,scripts}"`);
```

#### Execution Mode-Specific Directories

```
config.execution_mode
    ↓
    ├─ "sequential"
    │   ↓ Creates:
    │   └─ phases/ (base directory already included)
    │      ├─ _orchestrator.md
    │      └─ workflow.json
    │
    └─ "autonomous" | "hybrid"
        ↓ Creates:
        └─ phases/actions/
           ├─ state-schema.md
           └─ *.md (action files)
```

```javascript
// Additional directories for Autonomous/Hybrid mode
if (config.execution_mode === 'autonomous' || config.execution_mode === 'hybrid') {
  Bash(`mkdir -p "${skillDir}/phases/actions"`);
}
```

#### Context Strategy-Specific Directories (P0 Enhancement)

```javascript
// ========== P0: Create directories based on context strategy ==========
const contextStrategy = config.context_strategy || 'file';

if (contextStrategy === 'file') {
  // File strategy: Create persistent context directory
  Bash(`mkdir -p "${skillDir}/run-template/context"`);

  // Create context template file
  Write(
    `${skillDir}/run-template/context/.gitkeep`,
    "# Runtime context storage for file-based strategy"
  );
}
// Memory strategy does not require directory creation (in-memory only)
```

**Directory Tree View**:

```
Sequential + File Strategy:
  .claude/skills/{skill-name}/
  ├── phases/
  │   ├── _orchestrator.md
  │   ├── workflow.json
  │   ├── 01-*.md
  │   └── 02-*.md
  ├── run-template/
  │   └── context/           <- File strategy persistent storage
  └── specs/

Autonomous + Memory Strategy:
  .claude/skills/{skill-name}/
  ├── phases/
  │   ├── orchestrator.md
  │   ├── state-schema.md
  │   └── actions/
  │       └── *.md
  └── specs/
```

### Step 3: Generate SKILL.md

```javascript
// session_mode drives Session/Run lifecycle mounting. Default 'run' for stateful
// generators (dir + artifacts); 'none' for stateless skills.
const sessionMode = config.session_mode || 'run';
const requiredReading = sessionMode === 'run'
  ? `<required_reading>\n@~/.maestro/workflows/run-mode.md\n</required_reading>\n\n`
  : '';

const skillMdTemplate = `---
name: ${config.skill_name}
description: ${config.description}. Triggers on ${config.triggers.map(t => `"${t}"`).join(", ")}.
allowed-tools: ${config.allowed_tools.join(", ")}
session-mode: ${sessionMode}
---

${requiredReading}# ${config.display_name}

${config.description}

## Architecture Overview

\`\`\`
${generateArchitectureDiagram(config)}
\`\`\`

## Key Design Principles

${generateDesignPrinciples(config)}

## Execution Flow

${generateExecutionFlow(config)}

## Directory Setup

${sessionMode === 'run' ? `> **Run lifecycle** (see \`~/.maestro/workflows/run-mode.md\`): if an orchestrator injected \`run_id\` / \`run_dir\` in the birth packet, use them and do NOT call \`maestro run create\`. Otherwise self-start: \`maestro run create ${config.skill_name} --session <YYYYMMDD-${config.skill_name}-{topic}> --intent "..."\` (session slug ASCII-only, ≤64 chars). Write formal artifacts under \`{run_dir}/outputs/\`. Close with \`maestro run check {run_id}\` → repair gates → \`maestro run complete {run_id}\`.\n\n` : ''}\`\`\`javascript
const workDir = \`\${run_dir}/outputs\`;

Bash(\`mkdir -p "\${workDir}"\`);
${config.execution_mode === 'sequential' ?
  `Bash(\`mkdir -p "\${workDir}/sections"\`);` :
  `Bash(\`mkdir -p "\${workDir}/state"\`);`}
\`\`\`

## Output Structure

\`\`\`
${generateOutputStructure(config)}
\`\`\`

## Reference Documents

${generateReferenceTable(config)}
`;

Write(`${skillDir}/SKILL.md`, skillMdTemplate);
```

### Step 4: Architecture Diagram Generation Functions

```javascript
function generateArchitectureDiagram(config) {
  if (config.execution_mode === 'sequential') {
    return config.sequential_config.phases.map((p, i) =>
      `│  Phase ${i+1}: ${p.name.padEnd(15)} → ${p.output || 'output-' + (i+1) + '.json'}${' '.repeat(10)}│`
    ).join('\n│           ↓' + ' '.repeat(45) + '│\n');
  } else {
    return `
┌─────────────────────────────────────────────────────────────────┐
│           Orchestrator (State-driven decision-making)             │
└───────────────┬─────────────────────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    ↓           ↓           ↓
${config.autonomous_config.actions.slice(0, 3).map(a =>
  `┌─────────┐  `).join('')}
${config.autonomous_config.actions.slice(0, 3).map(a =>
  `│${a.name.slice(0, 7).padEnd(7)}│  `).join('')}
${config.autonomous_config.actions.slice(0, 3).map(a =>
  `└─────────┘  `).join('')}`;
  }
}

function generateDesignPrinciples(config) {
  const common = [
    "1. **Specification Compliance**: Strictly follow `_shared/SKILL-DESIGN-SPEC.md`",
    "2. **Brief Return**: Agent returns path+summary, avoiding context overflow"
  ];

  if (config.execution_mode === 'sequential') {
    return [...common,
      "3. **Phase Isolation**: Each phase is independently testable",
      "4. **Chained Output**: Phase output becomes next phase input"
    ].join('\n');
  } else {
    return [...common,
      "3. **State-driven**: Explicit state management, dynamic decision-making",
      "4. **Action Independence**: Each action has no side-effect dependencies"
    ].join('\n');
  }
}

function generateExecutionFlow(config) {
  if (config.execution_mode === 'sequential') {
    return '```\n' + config.sequential_config.phases.map((p, i) =>
      `├─ Phase ${i+1}: ${p.name}\n│  → Output: ${p.output || 'output.json'}`
    ).join('\n') + '\n```';
  } else {
    return `\`\`\`
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator Loop                                               │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                 │
│  │ Read     │────▶│ Select   │────▶│ Execute  │                 │
│  │ State    │     │ Action   │     │ Action   │                 │
│  └──────────┘     └──────────┘     └──────────┘                 │
│       ▲                                  │                       │
│       └──────────── Update State ◀───────┘                       │
└─────────────────────────────────────────────────────────────────┘
\`\`\``;
  }
}

function generateOutputStructure(config) {
  const base = `${config.output.location}/
├── ${config.execution_mode === 'sequential' ? 'sections/' : 'state.json'}`;

  if (config.execution_mode === 'sequential') {
    return base + '\n' + config.sequential_config.phases.map(p =>
      `│   └── ${p.output || 'section-' + p.id + '.md'}`
    ).join('\n') + `\n└── ${config.output.filename_pattern}`;
  } else {
    return base + `
├── actions-log.json
└── ${config.output.filename_pattern}`;
  }
}

function generateReferenceTable(config) {
  const rows = [];

  if (config.execution_mode === 'sequential') {
    config.sequential_config.phases.forEach(p => {
      rows.push(`| [phases/${p.id}.md](phases/${p.id}.md) | ${p.name} |`);
    });
  } else {
    rows.push(`| [phases/orchestrator.md](phases/orchestrator.md) | Orchestrator |`);
    rows.push(`| [phases/state-schema.md](phases/state-schema.md) | State Definition |`);
    config.autonomous_config.actions.forEach(a => {
      rows.push(`| [phases/actions/${a.id}.md](phases/actions/${a.id}.md) | ${a.name} |`);
    });
  }

  rows.push(`| [specs/${config.skill_name}-requirements.md](specs/${config.skill_name}-requirements.md) | Domain Requirements |`);
  rows.push(`| [specs/quality-standards.md](specs/quality-standards.md) | Quality Standards |`);

  return `| Document | Purpose |\n|----------|---------||\n` + rows.join('\n');
}
```



## Next Phase

→ [Phase 3: Phase Generation](03-phase-generation.md)

**Data Flow to Phase 3**:
- Complete directory structure in .claude/skills/{skill-name}/
- SKILL.md entry file ready for phase/action generation
- skill-config.json for template population
