
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Initialize Tuning Session

Initialize the skill-tuning session by collecting target skill information, creating work directories, and setting up initial state.

## Purpose

- Identify target skill to tune
- Collect user's problem description
- Create work directory structure
- Backup original skill files
- Initialize state for orchestrator

## Preconditions

- [ ] state.status === 'pending'

## Execution

```javascript
async function execute(state, workDir) {
  // 1. Ask user for target skill
  const skillInput = await AskUserQuestion({
    questions: [{
      question: "Which skill do you want to tune?",
      header: "Target Skill",
      multiSelect: false,
      options: [
        { label: "Specify path", description: "Enter skill directory path" }
      ]
    }]
  });

  const skillPath = skillInput["Target Skill"];

  // 2. Validate skill exists and read structure
  const skillMdPath = `${skillPath}/SKILL.md`;
  if (!Glob(`${skillPath}/SKILL.md`).length) {
    throw new Error(`Invalid skill path: ${skillPath} - SKILL.md not found`);
  }

  // 3. Read skill metadata
  const skillMd = Read(skillMdPath);
  const frontMatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
  const skillName = frontMatterMatch
    ? frontMatterMatch[1].match(/name:\s*(.+)/)?.[1]?.trim()
    : skillPath.split('/').pop();

  // 4. Detect execution mode
  const hasOrchestrator = Glob(`${skillPath}/phases/orchestrator.md`).length > 0;
  const executionMode = hasOrchestrator ? 'autonomous' : 'sequential';

  // 5. Scan skill structure
  const phases = Glob(`${skillPath}/phases/**/*.md`).map(f => f.replace(skillPath + '/', ''));
  const specs = Glob(`${skillPath}/specs/**/*.md`).map(f => f.replace(skillPath + '/', ''));

  // 6. Ask for problem description
  const issueInput = await AskUserQuestion({
    questions: [{
      question: "Describe the issue or what you want to optimize:",
      header: "Issue",
      multiSelect: false,
      options: [
        { label: "Context grows too large", description: "Token explosion over multiple turns" },
        { label: "Instructions forgotten", description: "Early constraints lost in long execution" },
        { label: "Data inconsistency", description: "State format changes between phases" },
        { label: "Agent failures", description: "Sub-agent calls fail or return unexpected results" }
      ]
    }]
  });

  // 7. Ask for focus areas
  const focusInput = await AskUserQuestion({
    questions: [{
      question: "Which areas should be diagnosed? (Select all that apply)",
      header: "Focus",
      multiSelect: true,
      options: [
        { label: "context", description: "Context explosion analysis" },
        { label: "memory", description: "Long-tail forgetting analysis" },
        { label: "dataflow", description: "Data flow analysis" },
        { label: "agent", description: "Agent coordination analysis" }
      ]
    }]
  });

  const focusAreas = focusInput["Focus"] || ['context', 'memory', 'dataflow', 'agent'];

  // 8. Create backup
  const backupDir = `${workDir}/backups/${skillName}-backup`;
  Bash(`mkdir -p "${backupDir}"`);
  Bash(`cp -r "${skillPath}"/* "${backupDir}/"`);

  // 9. Return state updates
  return {
    stateUpdates: {
      status: 'running',
      started_at: new Date().toISOString(),
      target_skill: {
        name: skillName,
        path: skillPath,
        execution_mode: executionMode,
        phases: phases,
        specs: specs
      },
      user_issue_description: issueInput["Issue"],
      focus_areas: Array.isArray(focusAreas) ? focusAreas : [focusAreas],
      work_dir: workDir,
      backup_dir: backupDir
    },
    outputFiles: [],
    summary: `Initialized tuning for "${skillName}" (${executionMode} mode), focus: ${focusAreas.join(', ')}`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    status: 'running',
    started_at: '<timestamp>',
    target_skill: {
      name: '<skill-name>',
      path: '<skill-path>',
      execution_mode: '<sequential|autonomous>',
      phases: ['...'],
      specs: ['...']
    },
    user_issue_description: '<user description>',
    focus_areas: ['context', 'memory', ...],
    work_dir: '<work-dir>',
    backup_dir: '<backup-dir>'
  }
};
```

## Error Handling

| Error Type | Recovery |
|------------|----------|
| Skill path not found | Ask user to re-enter valid path |
| SKILL.md missing | Suggest path correction |
| Backup creation failed | Retry with alternative location |

## Next Actions

- Success: Continue to first diagnosis action based on focus_areas
- Failure: action-abort
