# Phase 1: Requirements Analysis

Analyze workflow requirements from various sources (commands, descriptions, requirements docs) to build a structured workflow configuration.

## Objective

- Identify all phases/steps in the workflow
- Map data flow between phases
- Identify agents, tools, and conditional logic
- Detect source type and extract content accordingly
- Produce `workflowConfig` object for subsequent phases

## Step 1.1: Identify Input Source

```javascript
// Determine what the user provided
const inputType = detectInputType(userInput);
// Returns: 'command_set' | 'text_description' | 'requirements_doc' | 'existing_skill'
```

### Source Type Detection

| Indicator | Type | Action |
|-----------|------|--------|
| Path to `.claude/commands/**/*.md` | `command_set` | Read orchestrator + discover sub-commands |
| Free text describing workflow | `text_description` | Interactive requirements gathering |
| Path to `.md` or `.json` requirements | `requirements_doc` | Parse structured requirements |
| Path to `.claude/skills/**/*.md` | `existing_skill` | Analyze and restructure |

## Step 1.2: Source-Specific Analysis

### Mode A: Command Set Analysis

When source is an existing orchestrator command + sub-commands:

```javascript
// Step A.1: Read orchestrator command
const orchestratorPath = userInput; // e.g., ".claude/commands/workflow/plan.md"
const orchestratorContent = Read(orchestratorPath);

// Step A.2: Extract frontmatter
const frontmatter = extractYAMLFrontmatter(orchestratorContent);
// Fields: name, description, argument-hint, examples, allowed-tools, group

// Step A.3: Discover sub-commands by scanning Skill() calls
const skillCalls = orchestratorContent.match(/Skill\(skill="([^"]+)"/g);
// e.g., ["workflow:session:start", "workflow:tools:context-gather", ...]

// Step A.4: Map Skill() calls to file paths
// Pattern: "workflow:session:start" → ".claude/commands/workflow/session/start.md"
//          "workflow:tools:context-gather" → ".claude/commands/workflow/tools/context-gather.md"
const subCommandPaths = skillCalls.map(call => {
  const parts = call.replace('Skill(skill="', '').replace('"', '').split(':');
  return `.claude/commands/${parts.join('/')}.md`;
});

// Step A.5: Read all sub-commands
const subCommands = [];
for (const path of subCommandPaths) {
  const content = Read(path);
  const fm = extractYAMLFrontmatter(content);
  subCommands.push({
    path: path,
    content: content,
    frontmatter: fm,
    skillCallName: extractSkillCallName(path),
    bodyContent: removeYAMLFrontmatter(content)
  });
}

// Step A.6: Identify phase ordering from orchestrator execution flow
// Look for patterns like:
//   "Phase 1: ..." → first Skill() call
//   "Phase 2: ..." → second Skill() call
//   Conditional logic (if/else) → conditional phases
const phaseOrder = extractPhaseOrder(orchestratorContent, skillCalls);
```

**Key Extraction Points from Orchestrator**:

| Section | What to Extract | Maps to |
|---------|-----------------|---------|
| Coordinator Role / Overview | Workflow description, execution model | SKILL.md description + Architecture |
| Core Rules | Orchestration constraints | SKILL.md Core Rules |
| Execution Process | Phase sequence + conditions | SKILL.md Execution Flow |
| Data Flow | Inter-phase variables | SKILL.md Data Flow |
| TodoWrite Pattern | Attachment/collapse examples | SKILL.md TodoWrite Pattern |
| Input Processing | Structured format rules | SKILL.md Input Processing |
| Error Handling | Recovery strategies | SKILL.md Error Handling |
| Coordinator Checklist | Pre/post actions | SKILL.md Coordinator Checklist |
| Related Commands | Prerequisites/follow-ups | SKILL.md Related Commands |
| Phase N sections | Phase-specific orchestrator instructions | SKILL.md inline (brief), Phase files (detail) |

**Key Extraction Points from Sub-Commands**:

| Section | What to Extract | Maps to |
|---------|-----------------|---------|
| Full body content | Complete execution detail | Phase file (preserved verbatim) |
| Agent prompts (Task calls) | Agent delegation logic | Phase file agent sections |
| Bash command blocks | Shell execution steps | Phase file step sections |
| Validation/Output sections | Phase outputs | Phase file Output section |
| Frontmatter | Tools, description | Phase file header context |

### Mode B: Text Description Analysis

When source is a natural language workflow description:

```javascript
// Interactive requirements gathering
const basicInfo = AskUserQuestion({
  questions: [
    {
      question: "What is this workflow skill's name? (kebab-case)",
      header: "Name",
      multiSelect: false,
      options: [
        { label: "Custom name", description: "Enter a custom skill name" },
        { label: "Auto-generate", description: "Generate from workflow description" }
      ]
    },
    {
      question: "How many main phases does this workflow have?",
      header: "Phases",
      multiSelect: false,
      options: [
        { label: "3 phases", description: "Simple linear workflow" },
        { label: "4 phases", description: "Standard workflow with validation" },
        { label: "5+ phases", description: "Complex workflow with conditions" }
      ]
    }
  ]
});

// For each phase, gather details
const phases = [];
for (let i = 0; i < phaseCount; i++) {
  const phaseInfo = AskUserQuestion({
    questions: [
      {
        question: `Phase ${i+1}: What does this phase do?`,
        header: `Phase ${i+1}`,
        multiSelect: false,
        options: [
          { label: "Session/Init", description: "Initialize session or state" },
          { label: "Context/Gather", description: "Collect information or analyze" },
          { label: "Process/Transform", description: "Process data or generate artifacts" },
          { label: "Validate/Review", description: "Quality check or user review" }
        ]
      },
      {
        question: `Phase ${i+1}: Does it use agents?`,
        header: "Agents",
        multiSelect: false,
        options: [
          { label: "No agents", description: "Direct execution only" },
          { label: "Single agent", description: "Delegates to one agent" },
          { label: "Multiple agents", description: "Parallel or sequential agents" }
        ]
      }
    ]
  });
  phases.push(phaseInfo);
}

// Gather conditional logic
const conditions = AskUserQuestion({
  questions: [{
    question: "Are any phases conditional (skipped based on previous results)?",
    header: "Conditions",
    multiSelect: false,
    options: [
      { label: "No conditions", description: "All phases always execute" },
      { label: "Has conditions", description: "Some phases execute conditionally" }
    ]
  }]
});
```

### Mode C: Requirements Document

When source is a structured requirements document:

```javascript
// Read and parse requirements
const reqContent = Read(requirementsPath);

// Extract structured fields
// Expected format: Markdown with ## sections for each phase
// Or JSON with phases array
const requirements = parseRequirements(reqContent);
```

### Mode D: Existing Skill Restructure

When source is an existing skill to refactor:

```javascript
// Read existing SKILL.md
const existingSkill = Read(skillPath);

// Scan for phase files
const existingPhases = Glob(`${skillDir}/phases/*.md`);

// Analyze current structure for improvement
const analysis = analyzeExistingStructure(existingSkill, existingPhases);
```

## Step 1.3: Build Workflow Configuration

Regardless of source type, produce a unified `workflowConfig`:

```javascript
const workflowConfig = {
  // Metadata
  skillName: "workflow-plan",           // kebab-case
  title: "Workflow Plan",               // Human-readable
  description: "5-phase planning...",   // One-line description
  triggers: ["workflow-plan"],          // Trigger phrases
  allowedTools: ["Agent", "AskUserQuestion", "TodoWrite", "Read", "Write", "Edit", "Bash", "Glob", "Grep", "Skill"],

  // Source information
  source: {
    type: "command_set",                // input source type
    orchestratorPath: "...",            // original orchestrator file
    subCommandPaths: ["..."]            // original sub-command files
  },

  // Phase definitions
  phases: [
    {
      number: 1,
      name: "Session Discovery",
      slug: "session-discovery",        // for filename: 01-session-discovery.md
      description: "Create or discover workflow session",
      sourcePath: ".claude/commands/workflow/session/start.md",
      isConditional: false,
      condition: null,
      usesAgents: false,
      agentTypes: [],
      todoWriteSubTasks: [],            // no sub-tasks (atomic phase)
      outputVariables: ["sessionId"],
      outputFiles: ["planning-notes.md"]
    },
    {
      number: 2,
      name: "Context Gathering",
      slug: "context-gathering",
      description: "Gather project context via agents",
      sourcePath: ".claude/commands/workflow/tools/context-gather.md",
      isConditional: false,
      condition: null,
      usesAgents: true,
      agentTypes: ["cli-explore-agent", "context-search-agent"],
      todoWriteSubTasks: [
        "Analyze codebase structure",
        "Identify integration points",
        "Generate context package"
      ],
      outputVariables: ["contextPath", "conflictRisk"],
      outputFiles: ["context-package.json"]
    },
    {
      number: 3,
      name: "Conflict Resolution",
      slug: "conflict-resolution",
      description: "Detect and resolve conflicts",
      sourcePath: ".claude/commands/workflow/tools/conflict-resolution.md",
      isConditional: true,
      condition: "conflictRisk >= 'medium'",
      usesAgents: true,
      agentTypes: ["cli-execution-agent"],
      todoWriteSubTasks: [
        "Detect conflicts with CLI analysis",
        "Present conflicts to user",
        "Apply resolution strategies"
      ],
      outputVariables: [],
      outputFiles: ["conflict-resolution.json"]
    },
    {
      number: 4,
      name: "Task Generation",
      slug: "task-generation",
      description: "Generate implementation plan and task JSONs",
      sourcePath: ".claude/commands/workflow/tools/task-generate-agent.md",
      isConditional: false,
      condition: null,
      usesAgents: true,
      agentTypes: ["action-planning-agent"],
      todoWriteSubTasks: [],            // single agent task
      outputVariables: [],
      outputFiles: ["IMPL_PLAN.md", "IMPL-*.json", "TODO_LIST.md"]
    }
  ],

  // Data flow
  dataFlow: [
    { from: "input", to: "phase1", variables: ["structuredDescription"] },
    { from: "phase1", to: "phase2", variables: ["sessionId"] },
    { from: "phase2", to: "phase3", variables: ["contextPath", "conflictRisk"] },
    { from: "phase2", to: "phase4", variables: ["contextPath"] },
    { from: "phase3", to: "phase4", variables: ["resolvedArtifacts"] }
  ],

  // Features
  features: {
    hasAutoMode: true,                  // Interactive preference collection (AskUserQuestion)
    hasConditionalPhases: true,         // some phases may be skipped
    hasTodoWriteSubTasks: true,         // phases expand into sub-tasks
    hasPlanningNotes: true,             // accumulated state document
    hasPostPhaseUpdates: true,          // state updates between phases
    hasMemoryCompaction: true,          // compact after heavy phases
    hasUserDecisionGate: true           // user choice after final phase
  }
};
```

## Step 1.4: User Confirmation

Present the analyzed structure to the user for confirmation:

```javascript
// Display summary
console.log(`
Workflow Analysis Complete:
  Name: ${workflowConfig.skillName}
  Phases: ${workflowConfig.phases.length}
  ${workflowConfig.phases.map(p =>
    `  ${p.number}. ${p.name}${p.isConditional ? ' (conditional)' : ''}${p.usesAgents ? ` [${p.agentTypes.join(', ')}]` : ''}`
  ).join('\n')}
  Data Flow: ${workflowConfig.dataFlow.length} connections
  Features: ${Object.entries(workflowConfig.features).filter(([,v]) => v).map(([k]) => k).join(', ')}
`);

const confirm = AskUserQuestion({
  questions: [{
    question: "Proceed with this workflow structure?",
    header: "Confirm",
    multiSelect: false,
    options: [
      { label: "Yes, proceed", description: "Generate skill with this structure" },
      { label: "Modify phases", description: "Adjust phase count or ordering" },
      { label: "Add features", description: "Enable additional patterns (auto mode, conditions, etc.)" }
    ]
  }]
});
```

## Output

- **Variable**: `workflowConfig` (structured configuration object)
- **TodoWrite**: Mark Phase 1 completed, Phase 2 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 2: Orchestrator Design](02-orchestrator-design.md).
