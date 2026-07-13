
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 4: Validation

Validate the generated team skill package for structural completeness, reference integrity, role consistency, and team-worker compatibility.

## Objective

- Verify all required files exist
- Validate SKILL.md role registry matches actual role files
- Check role.md frontmatter format for team-worker compatibility
- Verify pipeline task references match existing roles
- Report validation results

## Step 4.1: Structural Validation

```javascript
function validateStructure(teamConfig) {
  const skillDir = `.claude/skills/${teamConfig.skillName}`;
  const results = { errors: [], warnings: [], info: [] };

  // Check SKILL.md exists
  if (!fileExists(`${skillDir}/SKILL.md`)) {
    results.errors.push('SKILL.md not found');
  }

  // Check coordinator structure
  if (!fileExists(`${skillDir}/roles/coordinator/role.md`)) {
    results.errors.push('Coordinator role.md not found');
  }
  for (const cmd of ['analyze', 'dispatch', 'monitor']) {
    if (!fileExists(`${skillDir}/roles/coordinator/commands/${cmd}.md`)) {
      results.errors.push(`Coordinator command ${cmd}.md not found`);
    }
  }

  // Check worker roles
  for (const role of teamConfig.roles.filter(r => r.name !== 'coordinator')) {
    if (!fileExists(`${skillDir}/roles/${role.name}/role.md`)) {
      results.errors.push(`Worker role.md not found: ${role.name}`);
    }
    if (role.hasCommands) {
      for (const cmd of role.commands) {
        if (!fileExists(`${skillDir}/roles/${role.name}/commands/${cmd}.md`)) {
          results.errors.push(`Worker command not found: ${role.name}/commands/${cmd}.md`);
        }
      }
    }
  }

  // Check specs
  if (!fileExists(`${skillDir}/specs/pipelines.md`)) {
    results.errors.push('specs/pipelines.md not found');
  }

  return results;
}
```

## Step 4.2: SKILL.md Content Validation

```javascript
function validateSkillMd(teamConfig) {
  const skillDir = `.claude/skills/${teamConfig.skillName}`;
  const results = { errors: [], warnings: [], info: [] };
  const skillMd = Read(`${skillDir}/SKILL.md`);

  // Required sections
  const requiredSections = [
    'Role Registry', 'Role Router', 'Shared Constants',
    'Worker Spawn Template', 'User Commands', 'Session Directory'
  ];
  for (const section of requiredSections) {
    if (!skillMd.includes(section)) {
      results.errors.push(`SKILL.md missing section: ${section}`);
    }
  }

  // Verify role registry completeness
  for (const role of teamConfig.roles) {
    if (!skillMd.includes(role.path || `roles/${role.name}/role.md`)) {
      results.errors.push(`Role registry missing path for: ${role.name}`);
    }
  }

  // Verify session prefix
  if (!skillMd.includes(teamConfig.sessionPrefix)) {
    results.warnings.push(`Session prefix ${teamConfig.sessionPrefix} not found in SKILL.md`);
  }

  // Verify NO beat model content in SKILL.md
  const beatModelPatterns = [
    'ONE_STEP_PER_INVOCATION',
    'spawn-and-stop',
    'SPAWN_MODE',
    'handleCallback',
    'handleSpawnNext'
  ];
  for (const pattern of beatModelPatterns) {
    if (skillMd.includes(pattern)) {
      results.errors.push(`SKILL.md contains beat model content: ${pattern} (should be in coordinator only)`);
    }
  }

  return results;
}
```

## Step 4.3: Role Frontmatter Validation

Verify role.md files have correct YAML frontmatter for team-worker agent compatibility:

```javascript
function validateRoleFrontmatter(teamConfig) {
  const skillDir = `.claude/skills/${teamConfig.skillName}`;
  const results = { errors: [], warnings: [], info: [] };

  for (const role of teamConfig.roles.filter(r => r.name !== 'coordinator')) {
    const roleMd = Read(`${skillDir}/roles/${role.name}/role.md`);

    // Check frontmatter exists
    if (!roleMd.startsWith('---')) {
      results.errors.push(`${role.name}/role.md missing YAML frontmatter`);
      continue;
    }

    // Extract frontmatter
    const fmMatch = roleMd.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      results.errors.push(`${role.name}/role.md malformed frontmatter`);
      continue;
    }

    const fm = fmMatch[1];

    // Required fields
    if (!fm.includes(`role: ${role.name}`)) {
      results.errors.push(`${role.name}/role.md frontmatter missing 'role: ${role.name}'`);
    }
    if (!fm.includes(`prefix: ${role.prefix}`)) {
      results.errors.push(`${role.name}/role.md frontmatter missing 'prefix: ${role.prefix}'`);
    }
    if (!fm.includes(`inner_loop: ${role.inner_loop}`)) {
      results.warnings.push(`${role.name}/role.md frontmatter missing 'inner_loop: ${role.inner_loop}'`);
    }
    if (!fm.includes('message_types:')) {
      results.warnings.push(`${role.name}/role.md frontmatter missing 'message_types'`);
    }
  }

  return results;
}
```

## Step 4.4: Pipeline Consistency

```javascript
function validatePipelines(teamConfig) {
  const skillDir = `.claude/skills/${teamConfig.skillName}`;
  const results = { errors: [], warnings: [], info: [] };

  // Check every role referenced in pipelines exists
  const definedRoles = new Set(teamConfig.roles.map(r => r.name));

  for (const pipeline of teamConfig.pipelines) {
    for (const task of pipeline.tasks) {
      if (!definedRoles.has(task.role)) {
        results.errors.push(
          `Pipeline '${pipeline.name}' task ${task.id} references undefined role: ${task.role}`
        );
      }
    }

    // Check for circular dependencies
    const visited = new Set();
    const stack = new Set();
    for (const task of pipeline.tasks) {
      if (hasCycle(task, pipeline.tasks, visited, stack)) {
        results.errors.push(`Pipeline '${pipeline.name}' has circular dependency involving ${task.id}`);
      }
    }
  }

  // Verify specs/pipelines.md contains all pipelines
  const pipelinesMd = Read(`${skillDir}/specs/pipelines.md`);
  for (const pipeline of teamConfig.pipelines) {
    if (!pipelinesMd.includes(pipeline.name)) {
      results.warnings.push(`specs/pipelines.md missing pipeline: ${pipeline.name}`);
    }
  }

  return results;
}
```

## Step 4.5: Commands Distribution Validation

```javascript
function validateCommandsDistribution(teamConfig) {
  const skillDir = `.claude/skills/${teamConfig.skillName}`;
  const results = { errors: [], warnings: [], info: [] };

  for (const role of teamConfig.roles.filter(r => r.name !== 'coordinator')) {
    if (role.hasCommands) {
      // Verify commands/ directory exists and has files
      const cmdDir = `${skillDir}/roles/${role.name}/commands`;
      if (role.commands.length < 2) {
        results.warnings.push(
          `${role.name} has commands/ but only ${role.commands.length} command(s) — consider inline`
        );
      }
      // Verify role.md references commands
      const roleMd = Read(`${skillDir}/roles/${role.name}/role.md`);
      for (const cmd of role.commands) {
        if (!roleMd.includes(`commands/${cmd}.md`)) {
          results.warnings.push(
            `${role.name}/role.md doesn't reference commands/${cmd}.md`
          );
        }
      }
    } else {
      // Verify no commands/ directory exists
      const cmdDir = `${skillDir}/roles/${role.name}/commands`;
      if (directoryExists(cmdDir)) {
        results.warnings.push(
          `${role.name} is inline but has commands/ directory`
        );
      }
    }
  }

  return results;
}
```

## Step 4.6: Aggregate Results and Report

```javascript
function generateValidationReport(teamConfig) {
  const structural = validateStructure(teamConfig);
  const skillMd = validateSkillMd(teamConfig);
  const frontmatter = validateRoleFrontmatter(teamConfig);
  const pipelines = validatePipelines(teamConfig);
  const commands = validateCommandsDistribution(teamConfig);

  const allErrors = [
    ...structural.errors, ...skillMd.errors,
    ...frontmatter.errors, ...pipelines.errors, ...commands.errors
  ];
  const allWarnings = [
    ...structural.warnings, ...skillMd.warnings,
    ...frontmatter.warnings, ...pipelines.warnings, ...commands.warnings
  ];

  const gate = allErrors.length === 0 ? 'PASS' :
               allErrors.length <= 2 ? 'REVIEW' : 'FAIL';

  const skillDir = `.claude/skills/${teamConfig.skillName}`;

  console.log(`
╔══════════════════════════════════════╗
║   Team Skill Validation Report       ║
╠══════════════════════════════════════╣
║  Skill: ${teamConfig.skillName.padEnd(28)}║
║  Gate:  ${gate.padEnd(28)}║
╚══════════════════════════════════════╝

Structure:
  ${skillDir}/
  ├── SKILL.md                                    ✓
  ├── roles/
  │   ├── coordinator/
  │   │   ├── role.md                             ✓
  │   │   └── commands/ (analyze, dispatch, monitor)
${teamConfig.roles.filter(r => r.name !== 'coordinator').map(r => {
  const structure = r.hasCommands
    ? `  │   ├── ${r.name}/ (role.md + commands/)`
    : `  │   ├── ${r.name}/role.md`;
  return `${structure.padEnd(50)}✓`;
}).join('\n')}
  ├── specs/
  │   └── pipelines.md                            ✓
  └── templates/                                  ${teamConfig.templates.length > 0 ? '✓' : '(empty)'}

${allErrors.length > 0 ? `Errors (${allErrors.length}):\n${allErrors.map(e => `  ✗ ${e}`).join('\n')}` : 'Errors: None ✓'}

${allWarnings.length > 0 ? `Warnings (${allWarnings.length}):\n${allWarnings.map(w => `  ⚠ ${w}`).join('\n')}` : 'Warnings: None ✓'}

Usage:
  Skill(skill="${teamConfig.skillName}", args="<task description>")
  `);

  return { gate, errors: allErrors, warnings: allWarnings };
}
```

## Step 4.7: Error Recovery

```javascript
if (report.gate === 'FAIL') {
  const recovery = AskUserQuestion({
    questions: [{
      question: `Validation found ${report.errors.length} errors. How to proceed?`,
      header: "Recovery",
      multiSelect: false,
      options: [
        { label: "Auto-fix", description: "Attempt automatic fixes (missing files, frontmatter)" },
        { label: "Regenerate", description: "Re-run Phase 3 with fixes" },
        { label: "Accept as-is", description: "Manual fix later" }
      ]
    }]
  });
}
```

## Output

- **Report**: Validation results with quality gate (PASS/REVIEW/FAIL)
- **Completion**: Team skill package ready at `.claude/skills/${teamConfig.skillName}/`

## Completion

Team Skill Designer has completed. The generated team skill is ready for use.

```
Next Steps:
  1. Review SKILL.md router for correctness
  2. Review each role.md for domain accuracy
  3. Test: Skill(skill="${teamConfig.skillName}", args="<test task>")
  4. Iterate based on execution results
```
