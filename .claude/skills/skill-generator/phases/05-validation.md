
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 5: Validation & Documentation

Verify generated skill completeness and generate user documentation.

## Objective

Comprehensive validation and documentation:
- Verify all required files exist
- Check file content quality and completeness
- Generate validation report with issues and recommendations
- Generate README.md usage documentation
- Output final status and next steps

## Input

**File Dependencies**:
- `skill-config.json` (from Phase 1)
- `.claude/skills/{skill-name}/` directory (from Phase 2)
- All generated phase/action files (from Phase 3)
- All generated specs/templates files (from Phase 4)

**Required Information**:
- Skill name, display name, description
- Execution mode
- Trigger words
- Output configuration
- Complete skill directory structure

## Output

**Generated Files**:

| File | Purpose | Content |
|------|---------|---------|
| `validation-report.json` (workDir) | Validation report with detailed checks | File completeness, content quality, issues, recommendations |
| `README.md` (skillDir) | User documentation | Quick Start, Usage, Output, Directory Structure, Customization |

**Validation Report Structure** (`validation-report.json`):
```json
{
  "skill_name": "...",
  "execution_mode": "sequential|autonomous",
  "generated_at": "ISO timestamp",
  "file_checks": {
    "total": N,
    "existing": N,
    "with_content": N,
    "with_todos": N,
    "details": [...]
  },
  "content_checks": {
    "files_checked": N,
    "all_passed": true|false,
    "details": [...]
  },
  "summary": {
    "status": "PASS|REVIEW|FAIL",
    "issues": [...],
    "recommendations": [...]
  }
}
```

**README Structure** (`README.md`):
```markdown
# {display_name}
- Quick Start (Triggers, Execution Mode)
- Usage (Examples)
- Output (Format, Location, Filename)
- Directory Structure (Tree view)
- Customization (How to modify)
- Related Documents (Links)
```

**Validation Status Gates**:

| Status | Condition | Meaning |
|--------|-----------|---------|
| PASS | All files exist + All content checks passed | Ready for use |
| REVIEW | All files exist + Some content checks failed | Needs refinement |
| FAIL | Missing files | Incomplete generation |

## Decision Logic

```
Decision (Validation Flow):
   ├─ File Completeness Check
   │  ├─ All files exist → Continue to content checks
   │  └─ Missing files → Status = FAIL, collect missing file errors
   │
   ├─ Content Quality Check
   │  ├─ Sequential mode → Check phase files for structure
   │  ├─ Autonomous mode → Check orchestrator + action files
   │  └─ Common → Check SKILL.md, specs/, templates/
   │
   ├─ Status Calculation
   │  ├─ All files exist + All checks pass → Status = PASS
   │  ├─ All files exist + Some checks fail → Status = REVIEW
   │  └─ Missing files → Status = FAIL
   │
   └─ Generate Report & README
      ├─ validation-report.json (with issues and recommendations)
      └─ README.md (with usage documentation)
```

## Execution Protocol

```javascript
// Phase 5: Validation & Documentation
// Reference: phases/05-validation.md

// Load config and setup
const config = JSON.parse(Read(`${workDir}/skill-config.json`));
const skillDir = `.claude/skills/${config.skill_name}`;

// Step 1: File completeness check
const requiredFiles = {
  common: [
    'SKILL.md',
    `specs/${config.skill_name}-requirements.md`,
    'specs/quality-standards.md',
    'templates/agent-base.md'
  ],
  sequential: config.sequential_config?.phases?.map(p => `phases/${p.id}.md`) || [],
  autonomous: [
    'phases/orchestrator.md',
    'phases/state-schema.md',
    'specs/action-catalog.md',
    ...(config.autonomous_config?.actions?.map(a => `phases/actions/${a.id}.md`) || [])
  ]
};

const filesToCheck = [
  ...requiredFiles.common,
  ...(config.execution_mode === 'sequential' ? requiredFiles.sequential : requiredFiles.autonomous)
];

const fileCheckResults = filesToCheck.map(file => {
  const fullPath = `${skillDir}/${file}`;
  try {
    const content = Read(fullPath);
    return {
      file: file,
      exists: true,
      size: content.length,
      hasContent: content.length > 100,
      hasTodo: content.includes('TODO')
    };
  } catch (e) {
    return {
      file: file,
      exists: false,
      size: 0,
      hasContent: false,
      hasTodo: false
    };
  }
});

// Step 2: Content quality check
const contentChecks = [];

// Check SKILL.md structure
const skillMd = Read(`${skillDir}/SKILL.md`);
contentChecks.push({
  file: 'SKILL.md',
  checks: [
    { name: 'Front Matter', pass: skillMd.startsWith('---') },
    { name: 'Architecture', pass: skillMd.includes('## Architecture') },
    { name: 'Execution Flow', pass: skillMd.includes('## Execution Flow') },
    { name: 'References', pass: skillMd.includes('## Reference Documents') }
  ]
});

// Check phase files
const phaseFiles = Glob(`${skillDir}/phases/*.md`);
for (const phaseFile of phaseFiles) {
  if (phaseFile.includes('/actions/')) continue; // Check separately

  const content = Read(phaseFile);
  contentChecks.push({
    file: phaseFile.replace(skillDir + '/', ''),
    checks: [
      { name: 'Objective', pass: content.includes('## Objective') },
      { name: 'Execution', pass: content.includes('## Execution') || content.includes('## Execution Steps') },
      { name: 'Output', pass: content.includes('## Output') },
      { name: 'Code Blocks', pass: content.includes('```') }
    ]
  });
}

// Check specs files
const specFiles = Glob(`${skillDir}/specs/*.md`);
for (const specFile of specFiles) {
  const content = Read(specFile);
  contentChecks.push({
    file: specFile.replace(skillDir + '/', ''),
    checks: [
      { name: 'Has Content', pass: content.length > 200 },
      { name: 'Has Structure', pass: content.includes('##') },
      { name: 'No Empty Sections', pass: !content.match(/##[^#]+\n\n##/) }
    ]
  });
}

// Step 3: Generate validation report
const report = {
  skill_name: config.skill_name,
  execution_mode: config.execution_mode,
  generated_at: new Date().toISOString(),

  file_checks: {
    total: fileCheckResults.length,
    existing: fileCheckResults.filter(f => f.exists).length,
    with_content: fileCheckResults.filter(f => f.hasContent).length,
    with_todos: fileCheckResults.filter(f => f.hasTodo).length,
    details: fileCheckResults
  },

  content_checks: {
    files_checked: contentChecks.length,
    all_passed: contentChecks.every(c => c.checks.every(ch => ch.pass)),
    details: contentChecks
  },

  summary: {
    status: calculateOverallStatus(fileCheckResults, contentChecks),
    issues: collectIssues(fileCheckResults, contentChecks),
    recommendations: generateRecommendations(fileCheckResults, contentChecks)
  }
};

Write(`${workDir}/validation-report.json`, JSON.stringify(report, null, 2));

// Helper functions
function calculateOverallStatus(fileResults, contentResults) {
  const allFilesExist = fileResults.every(f => f.exists);
  const allContentPassed = contentResults.every(c => c.checks.every(ch => ch.pass));

  if (allFilesExist && allContentPassed) return 'PASS';
  if (allFilesExist) return 'REVIEW';
  return 'FAIL';
}

function collectIssues(fileResults, contentResults) {
  const issues = [];

  fileResults.filter(f => !f.exists).forEach(f => {
    issues.push({ type: 'ERROR', message: `Missing file: ${f.file}` });
  });

  fileResults.filter(f => f.hasTodo).forEach(f => {
    issues.push({ type: 'WARNING', message: `Contains TODO: ${f.file}` });
  });

  contentResults.forEach(c => {
    c.checks.filter(ch => !ch.pass).forEach(ch => {
      issues.push({ type: 'WARNING', message: `${c.file}: Missing ${ch.name}` });
    });
  });

  return issues;
}

function generateRecommendations(fileResults, contentResults) {
  const recommendations = [];

  if (fileResults.some(f => f.hasTodo)) {
    recommendations.push('Replace all TODO placeholders with actual content');
  }

  contentResults.forEach(c => {
    if (c.checks.some(ch => !ch.pass)) {
      recommendations.push(`Improve structure of ${c.file}`);
    }
  });

  return recommendations;
}

// Step 4: Generate README.md
const readme = `# ${config.display_name}

${config.description}

## Quick Start

### Trigger Words

${config.triggers.map(t => `- "${t}"`).join('\n')}

### Execution Mode

**${config.execution_mode === 'sequential' ? 'Sequential (Sequential)' : 'Autonomous (Autonomous)'}**

${config.execution_mode === 'sequential' ?
  \`Phases execute in fixed order:\n\${config.sequential_config.phases.map((p, i) =>
    \`\${i + 1}. \${p.name}\`
  ).join('\n')}\` :
  \`Actions selected dynamically by orchestrator:\n\${config.autonomous_config.actions.map(a =>
    \`- \${a.name}: \${a.description || ''}\`
  ).join('\n')}\`}

## Usage

\`\`\`
# Direct trigger
User: ${config.triggers[0]}

# Or use Skill name
User: /skill ${config.skill_name}
\`\`\`

## Output

- **Format**: ${config.output.format}
- **Location**: \`${config.output.location}\`
- **Filename**: \`${config.output.filename_pattern}\`

## Directory Structure

\`\`\`
.claude/skills/${config.skill_name}/
├── SKILL.md                    # Entry file
├── phases/                     # Execution phases
${config.execution_mode === 'sequential' ?
  config.sequential_config.phases.map(p => \`│   ├── \${p.id}.md\`).join('\n') :
  \`│   ├── orchestrator.md
│   ├── state-schema.md
│   └── actions/
\${config.autonomous_config.actions.map(a => \`│       ├── \${a.id}.md\`).join('\n')}\`}
├── specs/                      # Specification files
│   ├── ${config.skill_name}-requirements.md
│   ├── quality-standards.md
${config.execution_mode === 'autonomous' ? '│   └── action-catalog.md' : ''}
└── templates/                  # Template files
    └── agent-base.md
\`\`\`

## Customization

### Modify Execution Logic

Edit phase files in the \`phases/\` directory.

### Adjust Quality Standards

Edit \`specs/quality-standards.md\`.

### Add New ${config.execution_mode === 'sequential' ? 'Phase' : 'Action'}

${config.execution_mode === 'sequential' ?
  \`1. Create new phase file in \`phases/\` (e.g., \`03.5-new-step.md\`)
2. Update execution flow in SKILL.md\` :
  \`1. Create new action file in \`phases/actions/\`
2. Update \`specs/action-catalog.md\`
3. Add selection logic in \`phases/orchestrator.md\`\`}

## Related Documents

- [Design Specification](../_shared/SKILL-DESIGN-SPEC.md)
- [Execution Modes Specification](specs/../../../skill-generator/specs/execution-modes.md)

---

*Generated by skill-generator v1.0*
`;

Write(`${skillDir}/README.md`, readme);

// Step 5: Output final result
const finalResult = {
  skill_name: config.skill_name,
  skill_path: skillDir,
  execution_mode: config.execution_mode,

  generated_files: [
    'SKILL.md',
    'README.md',
    ...filesToCheck
  ],

  validation: report.summary,

  next_steps: [
    '1. Review generated file structure',
    '2. Replace TODO placeholders',
    '3. Adjust phase logic based on actual requirements',
    '4. Test Skill execution flow',
    '5. Update trigger words and descriptions'
  ]
};

console.log('=== Skill Generation Complete ===');
console.log(\`Path: \${skillDir}\`);
console.log(\`Mode: \${config.execution_mode}\`);
console.log(\`Status: \${report.summary.status}\`);
console.log('');
console.log('Next Steps:');
finalResult.next_steps.forEach(s => console.log(s));
```

## Workflow Completion

**Final Status**: Skill generation pipeline complete

**Generated Artifacts**:
- Complete skill directory structure in `.claude/skills/{skill-name}/`
- Validation report in `{workDir}/validation-report.json`
- User documentation in `{skillDir}/README.md`

**Next Steps**:
1. Review validation report for any issues or recommendations
2. Replace TODO placeholders with actual implementation
3. Test skill execution with trigger words
4. Customize phase logic based on specific requirements
5. Update triggers and descriptions as needed
