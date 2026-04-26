# Phase 2: Orchestrator Design

Generate the SKILL.md orchestrator file from workflowConfig, applying all coordination patterns (progressive loading, TodoWrite, data flow, conditional execution).

## Objective

- Create `.claude/skills/{skillName}/SKILL.md` as pure coordinator
- Apply frontmatter conversion rules
- Generate architecture diagram from phase structure
- Build execution flow with `Ref:` markers and phase reference table
- Generate data flow diagram
- Build TodoWrite attachment/collapse patterns from phase definitions
- Include all orchestrator-level sections

## Step 2.1: Create Directory Structure

```bash
skillDir=".claude/skills/${workflowConfig.skillName}"
mkdir -p "${skillDir}/phases"

# Optional directories based on features
# mkdir -p "${skillDir}/specs"      # if has domain specifications
# mkdir -p "${skillDir}/templates"  # if has reusable templates
```

## Step 2.2: Generate Frontmatter

```javascript
function generateFrontmatter(config) {
  return `---
name: ${config.skillName}
description: ${config.description}. Triggers on ${config.triggers.map(t => `"${t}"`).join(', ')}.
allowed-tools: ${config.allowedTools.join(', ')}
---`;
}
```

**Conversion from command frontmatter**:

```javascript
// If source is command_set, convert fields:
function convertCommandFrontmatter(commandFm, config) {
  return {
    name: commandFm.group
      ? `${commandFm.group}-${commandFm.name}`  // "workflow" + "plan" → "workflow-plan"
      : commandFm.name,
    description: commandFm.description,
    // argument-hint → removed (handled in Input Processing section)
    // examples → removed (moved to inline docs)
    // group → embedded in name prefix
    allowedTools: expandToolWildcards(commandFm['allowed-tools'])
    // "Skill(*), TodoWrite(*), Read(*)" → "Task, AskUserQuestion, TodoWrite, Read, Write, Edit, Bash, Glob, Grep, Skill"
  };
}

// Expand tool wildcards
function expandToolWildcards(toolsStr) {
  const expanded = toolsStr
    .replace(/Skill\(\*\)/g, 'Skill')
    .replace(/TodoWrite\(\*\)/g, 'TodoWrite')
    .replace(/Read\(\*\)/g, 'Read')
    .replace(/Bash\(\*\)/g, 'Bash')
    .replace(/Glob\(\*\)/g, 'Glob')
    .replace(/Grep\(\*\)/g, 'Grep')
    .replace(/Task\(\*\)/g, 'Task');

  // Add commonly needed tools if not present
  const baseTools = ['Task', 'AskUserQuestion', 'TodoWrite', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
  const current = expanded.split(',').map(t => t.trim());
  const merged = [...new Set([...current, ...baseTools])];
  return merged;
}
```

## Step 2.3: Generate Architecture Diagram

```javascript
function generateArchitectureDiagram(config) {
  const phases = config.phases;
  const maxWidth = 65;

  let diagram = '```\n';
  diagram += '┌' + '─'.repeat(maxWidth) + '┐\n';
  diagram += `│  ${config.title} Orchestrator (SKILL.md)${' '.repeat(maxWidth - config.title.length - 30)}│\n`;
  diagram += `│  → Pure coordinator: Execute phases, parse outputs, pass context${' '.repeat(maxWidth - 64)}│\n`;
  diagram += '└' + '─'.repeat(Math.floor(maxWidth/2)) + '┬' + '─'.repeat(maxWidth - Math.floor(maxWidth/2) - 1) + '┘\n';

  // Phase boxes
  diagram += '                │\n';
  diagram += '    ' + phases.map(() => '┌─────────┐').join(' ') + '\n';
  diagram += '    ' + phases.map((p, i) => {
    const label = `Phase ${p.number}`.padEnd(9);
    return `│${label}│`;
  }).join(' ') + '\n';
  diagram += '    ' + phases.map(p => {
    const name = p.name.substring(0, 9).padEnd(9);
    return `│${name}│`;
  }).join(' ') + '\n';
  diagram += '    ' + phases.map(() => '└─────────┘').join(' ') + '\n';

  // Output labels
  diagram += '    ' + phases.map(p => {
    const vars = p.outputVariables.join(', ').substring(0, 11).padEnd(11);
    return `  ${vars}`;
  }).join('') + '\n';

  diagram += '```';
  return diagram;
}
```

## Step 2.4: Generate Execution Flow

The execution flow uses `Ref:` markers to point to phase documents, with a Phase Reference Documents table inline.

```javascript
function generateExecutionFlow(config) {
  let flow = '## Execution Flow\n\n```\n';
  flow += 'Input Parsing:\n';
  flow += '   └─ Convert user input to structured format (GOAL/SCOPE/CONTEXT)\n\n';

  for (const phase of config.phases) {
    flow += `Phase ${phase.number}: ${phase.name}\n`;

    if (phase.isConditional) {
      flow += `   └─ Decision (${phase.condition}):\n`;
      flow += `      ├─ condition met → Ref: phases/${String(phase.number).padStart(2, '0')}-${phase.slug}.md\n`;
      if (phase.todoWriteSubTasks.length > 0) {
        flow += `      │   ├─ Tasks attached: ${phase.todoWriteSubTasks.join(' → ')}\n`;
      }
      flow += `      │   └─ Output: ${phase.outputFiles.join(', ') || phase.outputVariables.join(', ')}\n`;
      flow += `      └─ condition not met → Skip to Phase ${phase.number + 1}\n`;
    } else {
      flow += `   └─ Ref: phases/${String(phase.number).padStart(2, '0')}-${phase.slug}.md\n`;
      if (phase.todoWriteSubTasks.length > 0) {
        flow += `      ├─ Tasks attached: ${phase.todoWriteSubTasks.join(' → ')}\n`;
      }
      flow += `      └─ Output: ${[...phase.outputVariables, ...phase.outputFiles].join(', ')}\n`;
    }
    flow += '\n';
  }

  flow += 'Return:\n   └─ Summary with recommended next steps\n';
  flow += '```\n\n';

  // Phase Reference Documents table
  flow += '**Phase Reference Documents** (read on-demand when phase executes):\n\n';
  flow += '| Phase | Document | Purpose |\n';
  flow += '|-------|----------|---------|\n';
  for (const phase of config.phases) {
    const filename = `${String(phase.number).padStart(2, '0')}-${phase.slug}.md`;
    flow += `| ${phase.number} | [phases/${filename}](phases/${filename}) | ${phase.description} |\n`;
  }

  return flow;
}
```

## Step 2.5: Generate Data Flow Section

```javascript
function generateDataFlow(config) {
  let section = '## Data Flow\n\n```\n';
  section += 'User Input (task description)\n';
  section += '    ↓\n';
  section += '[Convert to Structured Format]\n';

  for (const phase of config.phases) {
    const inputVars = config.dataFlow
      .filter(d => d.to === `phase${phase.number}`)
      .flatMap(d => d.variables);
    const outputVars = [...phase.outputVariables, ...phase.outputFiles];

    section += '    ↓\n';
    section += `Phase ${phase.number}: ${phase.name}\n`;
    if (inputVars.length > 0) {
      section += `    ↓ Input: ${inputVars.join(' + ')}\n`;
    }
    if (outputVars.length > 0) {
      section += `    ↓ Output: ${outputVars.join(' + ')}\n`;
    }
    if (phase.isConditional) {
      section += `    ↓ Skip if ${phase.condition} is false → proceed to Phase ${phase.number + 1}\n`;
    }
  }

  section += '    ↓\n';
  section += 'Return summary to user\n';
  section += '```\n';
  return section;
}
```

## Step 2.6: Generate TodoWrite Pattern

```javascript
function generateTodoWritePattern(config) {
  let section = '## TodoWrite Pattern\n\n';
  section += '**Core Concept**: Dynamic task attachment and collapse for real-time visibility.\n\n';

  section += '### Key Principles\n\n';
  section += '1. **Task Attachment** (when phase executed):\n';
  section += '   - Sub-tasks are **attached** to orchestrator\'s TodoWrite\n';

  // Identify which phases have sub-tasks
  const phasesWithSubTasks = config.phases.filter(p => p.todoWriteSubTasks.length > 0);
  const phasesWithoutSubTasks = config.phases.filter(p => p.todoWriteSubTasks.length === 0);

  if (phasesWithSubTasks.length > 0) {
    section += `   - **${phasesWithSubTasks.map(p => `Phase ${p.number}`).join(', ')}**: Multiple sub-tasks attached\n`;
  }
  if (phasesWithoutSubTasks.length > 0) {
    section += `   - **${phasesWithoutSubTasks.map(p => `Phase ${p.number}`).join(', ')}**: Single task (atomic)\n`;
  }

  section += '\n2. **Task Collapse** (after sub-tasks complete):\n';
  if (phasesWithSubTasks.length > 0) {
    section += `   - **Applies to ${phasesWithSubTasks.map(p => `Phase ${p.number}`).join(', ')}**: Remove sub-tasks, collapse to summary\n`;
  }
  section += '   - Maintains clean orchestrator-level view\n';

  section += '\n3. **Continuous Execution**: After completion, automatically proceed to next phase\n\n';

  // Generate TodoWrite examples for phases with sub-tasks
  for (const phase of phasesWithSubTasks) {
    section += `### Phase ${phase.number} (Tasks Attached):\n`;
    section += '```json\n[\n';

    // Previous phases completed
    for (const prev of config.phases.filter(p => p.number < phase.number)) {
      section += `  {"content": "Phase ${prev.number}: ${prev.name}", "status": "completed"},\n`;
    }

    // Current phase in_progress with sub-tasks
    section += `  {"content": "Phase ${phase.number}: ${phase.name}", "status": "in_progress"},\n`;
    phase.todoWriteSubTasks.forEach((task, i) => {
      const status = i === 0 ? 'in_progress' : 'pending';
      section += `  {"content": "  → ${task}", "status": "${status}"},\n`;
    });

    // Remaining phases pending
    for (const next of config.phases.filter(p => p.number > phase.number && !p.isConditional)) {
      section += `  {"content": "Phase ${next.number}: ${next.name}", "status": "pending"},\n`;
    }

    section += ']\n```\n\n';

    // Collapsed version
    section += `### Phase ${phase.number} (Collapsed):\n`;
    section += '```json\n[\n';
    for (const p of config.phases.filter(pp => !pp.isConditional || pp.number <= phase.number)) {
      const status = p.number <= phase.number ? 'completed' : 'pending';
      section += `  {"content": "Phase ${p.number}: ${p.name}", "status": "${status}"},\n`;
    }
    section += ']\n```\n\n';
  }

  return section;
}
```

## Step 2.7: Generate Remaining Sections

Extract from source orchestrator or generate from config:

```javascript
function generateOrchestratorSections(config, sourceContent) {
  const sections = [];

  // Interactive Preference Collection + Auto Mode (if feature enabled)
  if (config.features.hasAutoMode) {
    sections.push(generateInteractivePreferenceCollection(config));
    sections.push(extractOrGenerate(sourceContent, 'Auto Mode Defaults',
      '## Auto Mode Defaults\n\nWhen `workflowPreferences.autoYes === true`: Auto-continue all phases, use recommended defaults.\n'));
  }

  // Core Rules
  sections.push(extractOrGenerate(sourceContent, 'Core Rules',
    generateDefaultCoreRules(config)));

  // Input Processing
  sections.push(extractOrGenerate(sourceContent, 'Input Processing',
    generateDefaultInputProcessing(config)));

  // Post-Phase Updates (if feature enabled)
  if (config.features.hasPostPhaseUpdates) {
    sections.push(extractOrGenerate(sourceContent, 'Post-Phase Updates',
      generatePostPhaseUpdates(config)));
  }

  // Error Handling
  sections.push(extractOrGenerate(sourceContent, 'Error Handling',
    generateDefaultErrorHandling()));

  // Coordinator Checklist
  sections.push(extractOrGenerate(sourceContent, 'Coordinator Checklist',
    generateCoordinatorChecklist(config)));

  // Related Commands
  sections.push(extractOrGenerate(sourceContent, 'Related Commands',
    generateRelatedCommands(config)));

  return sections.join('\n\n');
}

// Extract section from source if exists, otherwise generate default
function extractOrGenerate(sourceContent, sectionName, defaultContent) {
  if (sourceContent) {
    const extracted = extractSection(sourceContent, sectionName);
    if (extracted) return extracted;
  }
  return defaultContent;
}

// Default Core Rules template
function generateDefaultCoreRules(config) {
  return `## Core Rules

1. **Start Immediately**: First action is TodoWrite initialization, second action is Phase 1 execution
2. **No Preliminary Analysis**: Do not read files or gather context before Phase 1
3. **Parse Every Output**: Extract required data from each phase for next phase
4. **Auto-Continue**: Check TodoList status to execute next pending phase automatically
5. **Track Progress**: Update TodoWrite dynamically with task attachment/collapse pattern
6. **Progressive Phase Loading**: Read phase docs ONLY when that phase is about to execute
7. **DO NOT STOP**: Continuous multi-phase workflow until all phases complete`;
}

// Default Error Handling template
function generateDefaultErrorHandling() {
  return `## Error Handling

- **Parsing Failure**: If output parsing fails, retry once, then report error
- **Validation Failure**: Report which file/data is missing
- **Command Failure**: Keep phase \`in_progress\`, report error, do not proceed`;
}
```

## Step 2.8: Generate Interactive Preference Collection

When the skill has configurable behaviors (auto mode, force options, etc.), generate the AskUserQuestion-based preference collection section for SKILL.md:

```javascript
function generateInteractivePreferenceCollection(config) {
  if (!config.features.hasAutoMode && !config.preferenceQuestions?.length) {
    return '';
  }

  let section = '## Interactive Preference Collection\n\n';
  section += 'Collect workflow preferences via AskUserQuestion before dispatching to phases:\n\n';
  section += '```javascript\n';
  section += 'const prefResponse = AskUserQuestion({\n';
  section += '  questions: [\n';

  // Always include auto mode question if feature enabled
  if (config.features.hasAutoMode) {
    section += '    {\n';
    section += '      question: "是否跳过所有确认步骤（自动模式）？",\n';
    section += '      header: "Auto Mode",\n';
    section += '      multiSelect: false,\n';
    section += '      options: [\n';
    section += '        { label: "Interactive (Recommended)", description: "交互模式，包含确认步骤" },\n';
    section += '        { label: "Auto", description: "跳过所有确认，自动执行" }\n';
    section += '      ]\n';
    section += '    },\n';
  }

  // Add custom preference questions
  for (const pq of (config.preferenceQuestions || [])) {
    section += `    {\n`;
    section += `      question: "${pq.question}",\n`;
    section += `      header: "${pq.header}",\n`;
    section += `      multiSelect: false,\n`;
    section += `      options: [\n`;
    for (const opt of pq.options) {
      section += `        { label: "${opt.label}", description: "${opt.description}" },\n`;
    }
    section += `      ]\n`;
    section += `    },\n`;
  }

  section += '  ]\n';
  section += '})\n\n';
  section += '// Derive workflowPreferences from user selection\n';
  section += 'workflowPreferences = {\n';
  if (config.features.hasAutoMode) {
    section += '  autoYes: prefResponse.autoMode === "Auto",\n';
  }
  for (const pq of (config.preferenceQuestions || [])) {
    section += `  ${pq.key}: prefResponse.${pq.header.toLowerCase().replace(/\\s+/g, '')} === "${pq.activeValue}",\n`;
  }
  section += '}\n';
  section += '```\n\n';
  section += '**workflowPreferences** is passed to phase execution as context variable.\n';
  section += 'Phases reference as `workflowPreferences.autoYes`, `workflowPreferences.{key}`, etc.\n';

  return section;
}
```

## Step 2.9: Assemble SKILL.md

```javascript
function assembleSkillMd(config, sourceContent) {
  const parts = [
    generateFrontmatter(config),
    '',
    `# ${config.title}`,
    '',
    config.description,
    '',
    generateArchitectureDiagram(config),
    '',
    generateDesignPrinciples(config),
    '',
    generateExecutionFlow(config),
    '',
    generateDataFlow(config),
    '',
    generateTodoWritePattern(config),
    '',
    generateOrchestratorSections(config, sourceContent)
  ];

  const skillMdContent = parts.join('\n');
  Write(`${skillDir}/SKILL.md`, skillMdContent);
}
```

**Critical Quality Rules**:

1. SKILL.md must NOT contain full execution detail (agent prompts, bash commands)
2. SKILL.md MUST contain `Ref:` markers pointing to phase files
3. SKILL.md MUST contain Phase Reference Documents table
4. Every phase mentioned in Execution Flow must have a corresponding phase file
5. Data flow variables must be consistent across sections

## Output

- **File**: `.claude/skills/{skillName}/SKILL.md`
- **TodoWrite**: Mark Phase 2 completed, Phase 3 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 3: Phase Files Design](03-phase-design.md).
