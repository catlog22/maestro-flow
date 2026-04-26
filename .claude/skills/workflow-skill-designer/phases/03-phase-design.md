# Phase 3: Phase Files Design

Generate phase files in `phases/` directory, preserving full execution detail from source content. Each phase file is a complete execution instruction.

## Objective

- Create `phases/0N-{slug}.md` for each phase in workflowConfig
- Preserve full source content (agent prompts, bash commands, code, validation)
- Add standard phase structure (header, objective, output, next phase)
- Handle different source types (command extraction vs new generation)

## Critical Rule

**Content Fidelity**: Phase files must be **content-faithful** to their source. Do NOT summarize, abbreviate, or simplify execution detail. The phase file IS the execution instruction.

| Content Type | Rule |
|-------------|------|
| Agent prompts (Task calls) | Preserve **verbatim** including all prompt text, variables, constraints |
| Bash command blocks | Preserve **verbatim** including all flags, paths, error handling |
| Code implementations | Preserve **verbatim** including all functions, validation logic |
| Validation checklists | Preserve **verbatim** including all check items |
| Error handling details | Preserve **verbatim** including recovery strategies |
| Tables and specifications | Preserve **verbatim** including all rows and columns |
| Comments and notes | Preserve **verbatim** including inline documentation |

**Anti-Pattern**: Creating a phase file that says "See original command for details" or "Execute the agent with appropriate parameters" - this defeats the purpose of the skill structure. The phase file must be self-contained.

## Phase File Content Restrictions

Phase files are internal execution documents. They MUST NOT contain the following prohibited content:

| Prohibited Pattern | Detection | Correct Location |
|-------------------|-----------|-----------------|
| Flag parsing (`$ARGUMENTS.includes(...)`) | Grep: `\$ARGUMENTS\.includes` | SKILL.md via AskUserQuestion → `workflowPreferences` |
| Invocation syntax (`/skill-name "..."`) | Grep: `\/\w+[\-:]\w+\s+"` | Removed entirely (phase files are not user-facing) |
| Conversion provenance (`Source: Converted from...`) | Grep: `Source:.*Converted from` | Removed entirely (implementation detail) |
| Skill routing for inter-phase (`Skill(skill="...")`) | Grep: `Skill\(skill=` | Direct `Read("phases/0N-xxx.md")` |

### Preference Reference Pattern

Phase files may **reference** workflow preferences but must NOT **parse** them from arguments:

```javascript
// CORRECT: Reference workflowPreferences (set by SKILL.md)
const autoYes = workflowPreferences.autoYes
const forceExplore = workflowPreferences.forceExplore

// WRONG: Parse from $ARGUMENTS
const autoYes = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const forceExplore = $ARGUMENTS.includes('--explore') || $ARGUMENTS.includes('-e')
```

### Inter-Phase Handoff Pattern

When phase N needs to invoke phase M, use direct phase reading:

```javascript
// CORRECT: Direct handoff (executionContext already set)
Read("phases/02-lite-execute.md")
// Execute with executionContext (Mode 1)

// WRONG: Skill routing (unnecessary round-trip)
Skill(skill="workflow-lite-plan", args="--in-memory")
```

### Content Restriction Enforcement

When extracting from commands (Step 3.2), apply content sanitization after verbatim extraction:

```javascript
function sanitizePhaseContent(content) {
  let sanitized = content;

  // Remove flag parsing blocks
  sanitized = sanitized.replace(
    /\/\/.*flag.*parsing[\s\S]*?\n(?=\n)/gi, ''
  );

  // Remove invocation syntax examples
  sanitized = sanitized.replace(
    /^.*\/\w+[\-:]\w+\s+"[^"]*".*$/gm, ''
  );

  // Remove conversion provenance notes
  sanitized = sanitized.replace(
    /^\*\*Source\*\*:.*Converted from.*$/gm, ''
  );

  // Replace all $ARGUMENTS.includes patterns with workflowPreferences reference
  // Handles any flag name, not just --yes/-y
  sanitized = sanitized.replace(
    /\$ARGUMENTS\.includes\(['"]--?([^"']+)['"]\)/g,
    (match, flagName) => {
      // Map common flag names to workflowPreferences keys
      const flagMap = {
        'yes': 'workflowPreferences.autoYes',
        'y': 'workflowPreferences.autoYes',
        'explore': 'workflowPreferences.forceExplore',
        'e': 'workflowPreferences.forceExplore'
      };
      return flagMap[flagName] || `workflowPreferences.${flagName}`;
    }
  );
  // Also clean up residual || chains from multi-flag expressions
  sanitized = sanitized.replace(
    /workflowPreferences\.(\w+)\s*\|\|\s*workflowPreferences\.\1/g,
    'workflowPreferences.$1'
  );

  // Replace Skill() inter-phase routing with direct Read (with or without args)
  sanitized = sanitized.replace(
    /Skill\(skill=["']([^"']+)["'](?:,\s*args=["']([^"']+)["'])?\)/g,
    (match, skillName) => `Read("phases/0N-xxx.md")\n// Execute with context`
  );

  return sanitized;
}
```

## Step 3.1: Phase File Generation Strategy

```javascript
function selectGenerationStrategy(phase, config) {
  if (config.source.type === 'command_set' && phase.sourcePath) {
    return 'extract';    // Extract from existing command file
  } else if (config.source.type === 'text_description') {
    return 'generate';   // Generate from requirements
  } else if (config.source.type === 'existing_skill') {
    return 'restructure'; // Restructure existing content
  }
  return 'generate';
}
```

## Step 3.2: Mode A - Extract from Command

When source is an existing command file, transform its content into phase file format:

```javascript
function extractPhaseFromCommand(phase, config) {
  const sourceContent = Read(phase.sourcePath);
  const sourceFrontmatter = extractYAMLFrontmatter(sourceContent);
  const sourceBody = removeYAMLFrontmatter(sourceContent);

  // Phase file structure:
  // 1. Phase header (new)
  // 2. Source body content (preserved verbatim)
  // 3. Output section (extracted or added)
  // 4. Next Phase link (new)

  let phaseContent = '';

  // 1. Phase header
  phaseContent += `# Phase ${phase.number}: ${phase.name}\n\n`;
  phaseContent += `${phase.description}.\n\n`;

  // 2. Source body content - PRESERVED VERBATIM
  // Only modifications:
  //   a. Remove original H1 title (replaced by phase header)
  //   b. Remove command-specific frontmatter references
  //   c. Preserve everything else as-is

  // Remove original H1 title line(s)
  let bodyContent = sourceBody;
  bodyContent = bodyContent.replace(/^# .+\n+/, '');

  // Remove command-specific overview if it just restates what the phase header says
  // But KEEP any overview content that adds execution detail

  phaseContent += bodyContent;

  // 2.5. Ensure Objective section exists
  if (!bodyContent.includes('## Objective')) {
    // Insert Objective after phase header, before main content
    const objectiveSection = `## Objective\n\n- ${phase.description}\n`;
    phaseContent = phaseContent.replace(
      `${phase.description}.\n\n${bodyContent}`,
      `${phase.description}.\n\n${objectiveSection}\n${bodyContent}`
    );
  }

  // 3. Ensure Output section exists
  if (!bodyContent.includes('## Output')) {
    phaseContent += '\n## Output\n\n';
    if (phase.outputVariables.length > 0) {
      phaseContent += phase.outputVariables.map(v => `- **Variable**: \`${v}\``).join('\n') + '\n';
    }
    if (phase.outputFiles.length > 0) {
      phaseContent += phase.outputFiles.map(f => `- **File**: \`${f}\``).join('\n') + '\n';
    }
    phaseContent += `- **TodoWrite**: Mark Phase ${phase.number} completed, Phase ${phase.number + 1} in_progress\n`;
  }

  // 4. Ensure Next Phase link exists
  if (!bodyContent.includes('## Next Phase')) {
    const nextPhase = config.phases.find(p => p.number === phase.number + 1);
    if (nextPhase) {
      const nextFilename = `${String(nextPhase.number).padStart(2, '0')}-${nextPhase.slug}.md`;
      phaseContent += `\n## Next Phase\n\n`;
      phaseContent += `Return to orchestrator, then auto-continue to [Phase ${nextPhase.number}: ${nextPhase.name}](${nextFilename}).\n`;
    }
  }

  return phaseContent;
}
```

### Content Preservation Checklist

When extracting from commands, verify these content types are preserved:

```javascript
function verifyContentPreservation(sourceContent, phaseContent) {
  const checks = {
    // Count code blocks
    sourceCodeBlocks: (sourceContent.match(/```/g) || []).length / 2,
    phaseCodeBlocks: (phaseContent.match(/```/g) || []).length / 2,

    // Count Task/Agent calls
    sourceAgentCalls: (sourceContent.match(/Task\(/g) || []).length,
    phaseAgentCalls: (phaseContent.match(/Task\(/g) || []).length,

    // Count bash commands
    sourceBashBlocks: (sourceContent.match(/```bash/g) || []).length,
    phaseBashBlocks: (phaseContent.match(/```bash/g) || []).length,

    // Count tables
    sourceTables: (sourceContent.match(/\|.*\|.*\|/g) || []).length,
    phaseTables: (phaseContent.match(/\|.*\|.*\|/g) || []).length,

    // Count AskUserQuestion calls
    sourceAUQ: (sourceContent.match(/AskUserQuestion/g) || []).length,
    phaseAUQ: (phaseContent.match(/AskUserQuestion/g) || []).length,

    // Line count comparison (phase should be >= source minus frontmatter)
    sourceLines: sourceContent.split('\n').length,
    phaseLines: phaseContent.split('\n').length
  };

  const issues = [];
  if (checks.phaseCodeBlocks < checks.sourceCodeBlocks) {
    issues.push(`Missing code blocks: source=${checks.sourceCodeBlocks}, phase=${checks.phaseCodeBlocks}`);
  }
  if (checks.phaseAgentCalls < checks.sourceAgentCalls) {
    issues.push(`Missing agent calls: source=${checks.sourceAgentCalls}, phase=${checks.phaseAgentCalls}`);
  }
  if (checks.phaseBashBlocks < checks.sourceBashBlocks) {
    issues.push(`Missing bash blocks: source=${checks.sourceBashBlocks}, phase=${checks.phaseBashBlocks}`);
  }
  if (checks.phaseTables < checks.sourceTables * 0.8) {
    issues.push(`Missing tables: source=${checks.sourceTables}, phase=${checks.phaseTables}`);
  }
  if (checks.phaseAUQ < checks.sourceAUQ) {
    issues.push(`Missing AskUserQuestion: source=${checks.sourceAUQ}, phase=${checks.phaseAUQ}`);
  }

  return { checks, issues, passed: issues.length === 0 };
}
```

### Handling Orchestrator-Level Content in Source Commands

Some commands mix orchestrator-level instructions (coordination, TodoWrite) with execution detail. Separation rules:

| Content in Source Command | Goes To | Rule |
|---------------------------|---------|------|
| Phase execution steps, agent prompts, bash commands | **Phase file** | Preserve verbatim |
| TodoWrite update examples specific to this phase | **Phase file** (optional) | Keep if useful for context |
| Inter-phase data passing code | **SKILL.md** Post-Phase Updates | Extract to orchestrator |
| Coordinator instructions ("after this phase, auto-continue") | **SKILL.md** Core Rules | Extract to orchestrator |
| Conditional logic ("if conflict_risk >= medium") | **SKILL.md** Execution Flow | Extract to orchestrator |

When in doubt, **keep content in the phase file**. It's better to have slight overlap than to lose execution detail.

## Step 3.3: Mode B - Generate from Requirements

When source is a text description, generate phase files interactively:

```javascript
function generatePhaseFromRequirements(phase, config) {
  let phaseContent = '';

  // Phase header
  phaseContent += `# Phase ${phase.number}: ${phase.name}\n\n`;
  phaseContent += `${phase.description}.\n\n`;

  // Objective
  phaseContent += `## Objective\n\n`;
  phaseContent += `- ${phase.description}\n`;
  if (phase.outputVariables.length > 0) {
    phaseContent += `- Produce: ${phase.outputVariables.join(', ')}\n`;
  }
  if (phase.outputFiles.length > 0) {
    phaseContent += `- Generate: ${phase.outputFiles.join(', ')}\n`;
  }
  phaseContent += '\n';

  // Execution steps
  phaseContent += `## Execution\n\n`;

  if (phase.usesAgents) {
    // Generate agent delegation skeleton
    for (const agentType of phase.agentTypes) {
      phaseContent += `### Step: ${agentType} Delegation\n\n`;
      phaseContent += '```javascript\n';
      phaseContent += `const result = Agent({\n`;
      phaseContent += `  subagent_type: "${mapAgentType(agentType)}",\n`;
      phaseContent += `  prompt: \`\n`;
      phaseContent += `    [ROLE] ${agentType}\n`;
      phaseContent += `    [TASK] ${phase.description}\n`;
      phaseContent += `    [INPUT] \${inputData}\n`;
      phaseContent += `    [OUTPUT] \${outputPath}\n`;
      phaseContent += `  \`,\n`;
      phaseContent += `  run_in_background: false\n`;
      phaseContent += `});\n`;
      phaseContent += '```\n\n';
    }
  } else {
    // Generate direct execution skeleton
    phaseContent += `### Step ${phase.number}.1: Execute\n\n`;
    phaseContent += `TODO: Add execution detail for ${phase.name}\n\n`;
  }

  // Output
  phaseContent += `## Output\n\n`;
  phase.outputVariables.forEach(v => {
    phaseContent += `- **Variable**: \`${v}\`\n`;
  });
  phase.outputFiles.forEach(f => {
    phaseContent += `- **File**: \`${f}\`\n`;
  });
  phaseContent += `- **TodoWrite**: Mark Phase ${phase.number} completed\n\n`;

  // Next Phase
  const nextPhase = config.phases.find(p => p.number === phase.number + 1);
  if (nextPhase) {
    const nextFilename = `${String(nextPhase.number).padStart(2, '0')}-${nextPhase.slug}.md`;
    phaseContent += `## Next Phase\n\n`;
    phaseContent += `Return to orchestrator, then auto-continue to [Phase ${nextPhase.number}: ${nextPhase.name}](${nextFilename}).\n`;
  }

  return phaseContent;
}

// Map custom agent type names to Task subagent_types
function mapAgentType(agentType) {
  const mapping = {
    'cli-explore-agent': 'cli-explore-agent',
    'context-search-agent': 'context-search-agent',
    'cli-execution-agent': 'cli-execution-agent',
    'action-planning-agent': 'action-planning-agent',
    'code-developer': 'code-developer',
    'test-fix-agent': 'test-fix-agent',
    'general-purpose': 'general-purpose',
    'Explore': 'Explore'
  };
  return mapping[agentType] || 'general-purpose';
}
```

## Step 3.4: Write Phase Files

```javascript
function writePhaseFiles(config) {
  const skillDir = `.claude/skills/${config.skillName}`;

  for (const phase of config.phases) {
    const filename = `${String(phase.number).padStart(2, '0')}-${phase.slug}.md`;
    const filepath = `${skillDir}/phases/${filename}`;

    const strategy = selectGenerationStrategy(phase, config);
    let content;

    switch (strategy) {
      case 'extract':
        content = extractPhaseFromCommand(phase, config);
        // Verify content preservation
        const sourceContent = Read(phase.sourcePath);
        const verification = verifyContentPreservation(sourceContent, content);
        if (!verification.passed) {
          console.warn(`⚠️ Content preservation issues for Phase ${phase.number}:`);
          verification.issues.forEach(issue => console.warn(`  - ${issue}`));
          // Re-extract with more aggressive preservation
          content = extractPhaseFromCommand(phase, config, { aggressive: true });
        }
        break;

      case 'generate':
        content = generatePhaseFromRequirements(phase, config);
        break;

      case 'restructure':
        content = restructureExistingPhase(phase, config);
        break;
    }

    Write(filepath, content);
    console.log(`✓ Generated: ${filepath} (${content.split('\n').length} lines)`);
  }
}
```

## Step 3.5: Cross-Phase Consistency Check

After generating all phase files, verify cross-phase consistency:

```javascript
function checkCrossPhaseConsistency(config) {
  const skillDir = `.claude/skills/${config.skillName}`;
  const issues = [];

  for (const phase of config.phases) {
    const filename = `${String(phase.number).padStart(2, '0')}-${phase.slug}.md`;
    const content = Read(`${skillDir}/phases/${filename}`);

    // Check: Next Phase links point to correct file
    const nextPhaseMatch = content.match(/\[Phase (\d+): (.+?)\]\((.+?)\)/);
    if (nextPhaseMatch) {
      const nextNum = parseInt(nextPhaseMatch[1]);
      const nextPhase = config.phases.find(p => p.number === nextNum);
      if (!nextPhase) {
        issues.push(`Phase ${phase.number}: Next Phase link points to non-existent Phase ${nextNum}`);
      }
    }

    // Check: Output variables match config
    for (const varName of phase.outputVariables) {
      if (!content.includes(varName)) {
        issues.push(`Phase ${phase.number}: Output variable '${varName}' not mentioned in content`);
      }
    }
  }

  return issues;
}
```

## Size Comparison Reference

Expected phase file sizes relative to their source commands:

| Scenario | Phase File Size vs Source | Reason |
|----------|--------------------------|--------|
| Command extraction | ≥ 90% of source | Minor removals (H1 title, frontmatter) |
| New generation (with agents) | 50-200 lines | Agent prompt skeletons |
| New generation (direct) | 30-80 lines | Step skeletons |
| Restructure | ~100% of source | Content reorganization only |

**Red Flag**: If a phase file is significantly smaller than its source (< 70%), content was likely lost during extraction. Re-check with `verifyContentPreservation()`.

## Output

- **Files**: `.claude/skills/{skillName}/phases/0N-{slug}.md` for each phase
- **TodoWrite**: Mark Phase 3 completed, Phase 4 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 4: Validation & Integration](04-validation.md).
