
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 1: Requirements Discovery

## Objective

- Collect skill basic information (name, description, trigger words)
- Determine execution mode (Sequential/Autonomous/Hybrid)
- Define phases or actions
- Generate initial configuration file

## Execution Steps

### Step 1: Basic Information Collection

```javascript
const basicInfo = await AskUserQuestion({
  questions: [
    {
      question: "What is the name of the new Skill? (English, lowercase with hyphens, e.g., 'api-docs')",
      header: "Skill Name",
      multiSelect: false,
      options: [
        { label: "Auto-generate", description: "Generate name automatically based on description" },
        { label: "Manual Input", description: "Enter custom name now" }
      ]
    },
    {
      question: "What is the primary purpose of the Skill?",
      header: "Purpose Type",
      multiSelect: false,
      options: [
        { label: "Document Generation", description: "Generate Markdown/HTML documents (manuals, reports)" },
        { label: "Code Analysis", description: "Analyze code structure, quality, security" },
        { label: "Interactive Management", description: "Manage Issues, tasks, workflows (CRUD operations)" },
        { label: "Data Processing", description: "ETL, format conversion, report generation" }
      ]
    }
  ]
});

// If manual input is selected, prompt further
if (basicInfo["Skill Name"] === "Manual Input") {
  // User will input in "Other"
}

// Infer description template based on purpose type
const purposeTemplates = {
  "Document Generation": "Generate {type} documents from {source}",
  "Code Analysis": "Analyze {target} for {purpose}",
  "Interactive Management": "Manage {entity} with interactive operations",
  "Data Processing": "Process {data} and generate {output}"
};
```

### Step 2: Execution Mode Selection

```javascript
const modeInfo = await AskUserQuestion({
  questions: [
    {
      question: "Select execution mode:",
      header: "Execution Mode",
      multiSelect: false,
      options: [
        {
          label: "Sequential (Sequential Mode)",
          description: "Phases execute in fixed order (collect→analyze→generate), suitable for pipeline tasks (recommended)"
        },
        {
          label: "Autonomous (Autonomous Mode)",
          description: "Dynamically select execution path, suitable for interactive tasks (e.g., Issue management)"
        },
        {
          label: "Hybrid (Hybrid Mode)",
          description: "Fixed initialization and finalization, flexible interaction in the middle"
        }
      ]
    }
  ]
});

const executionMode = modeInfo["Execution Mode"].includes("Sequential") ? "sequential" :
                      modeInfo["Execution Mode"].includes("Autonomous") ? "autonomous" : "hybrid";
```

### Step 3: Phase/Action Definition

#### Sequential Mode

```javascript
if (executionMode === "sequential") {
  const phaseInfo = await AskUserQuestion({
    questions: [
      {
        question: "How many execution phases are needed?",
        header: "Phase Count",
        multiSelect: false,
        options: [
          { label: "3 Phases (Simple)", description: "Collection → Processing → Output" },
          { label: "5 Phases (Standard)", description: "Collection → Exploration → Analysis → Assembly → Validation" },
          { label: "7 Phases (Complete)", description: "Includes parallel processing, consolidation, iterative optimization" }
        ]
      }
    ]
  });

  // Generate phase definitions based on selection
  const phaseTemplates = {
    "3 Phases": [
      { id: "01-collection", name: "Data Collection" },
      { id: "02-processing", name: "Processing" },
      { id: "03-output", name: "Output Generation" }
    ],
    "5 Phases": [
      { id: "01-collection", name: "Requirements Collection" },
      { id: "02-exploration", name: "Project Exploration" },
      { id: "03-analysis", name: "Deep Analysis" },
      { id: "04-assembly", name: "Document Assembly" },
      { id: "05-validation", name: "Validation" }
    ],
    "7 Phases": [
      { id: "01-collection", name: "Requirements Collection" },
      { id: "02-exploration", name: "Project Exploration" },
      { id: "03-parallel", name: "Parallel Analysis" },
      { id: "03.5-consolidation", name: "Consolidation" },
      { id: "04-assembly", name: "Document Assembly" },
      { id: "05-refinement", name: "Iterative Refinement" },
      { id: "06-output", name: "Final Output" }
    ]
  };
}
```

#### Autonomous Mode

```javascript
if (executionMode === "autonomous") {
  const actionInfo = await AskUserQuestion({
    questions: [
      {
        question: "What are the core actions? (Multiple selection allowed)",
        header: "Action Definition",
        multiSelect: true,
        options: [
          { label: "Initialize (init)", description: "Set initial state" },
          { label: "List (list)", description: "Display current item list" },
          { label: "Create (create)", description: "Create new item" },
          { label: "Edit (edit)", description: "Modify existing item" },
          { label: "Delete (delete)", description: "Delete item" },
          { label: "Search (search)", description: "Search/filter items" }
        ]
      }
    ]
  });
}
```

### Step 4: Tool and Output Configuration

```javascript
const toolsInfo = await AskUserQuestion({
  questions: [
    {
      question: "Which special tools are needed? (Basic tools are included by default)",
      header: "Tool Selection",
      multiSelect: true,
      options: [
        { label: "User Interaction (AskUserQuestion)", description: "Need to dialog with user" },
        { label: "Chrome Screenshot (mcp__chrome__*)", description: "Need web page screenshots" },
        { label: "External Search (mcp__exa__search)", description: "Need to search external information" },
        { label: "No Special Requirements", description: "Use basic tools only" }
      ]
    },
    {
      question: "What is the output format?",
      header: "Output Format",
      multiSelect: false,
      options: [
        { label: "Markdown", description: "Suitable for documents and reports" },
        { label: "HTML", description: "Suitable for interactive documents" },
        { label: "JSON", description: "Suitable for data and configuration" }
      ]
    }
  ]
});
```

### Step 5: Generate Configuration File

```javascript
const config = {
  skill_name: skillName,
  display_name: displayName,
  description: description,
  triggers: triggers,
  execution_mode: executionMode,

  // Mode-specific configuration
  ...(executionMode === "sequential" ? {
    sequential_config: { phases: phases }
  } : {
    autonomous_config: {
      state_schema: stateSchema,
      actions: actions,
      termination_conditions: ["user_exit", "error_limit", "task_completed"]
    }
  }),

  allowed_tools: [
    "Task", "Read", "Write", "Glob", "Grep", "Bash",
    ...selectedTools
  ],

  output: {
    format: outputFormat.toLowerCase(),
    location: `{run_dir}/outputs`,
    filename_pattern: `{name}-output.${outputFormat === "HTML" ? "html" : outputFormat === "JSON" ? "json" : "md"}`
  },

  created_at: new Date().toISOString(),
  version: "1.0.0"
};

// Write configuration file
const workDir = `{run_dir}/outputs/skill-gen-${timestamp}`;
Bash(`mkdir -p "${workDir}"`);
Write(`${workDir}/skill-config.json`, JSON.stringify(config, null, 2));
```


## Next Phase

→ [Phase 2: Structure Generation](02-structure-generation.md)

**Data Flow to Phase 2**:
- skill-config.json with all configuration parameters
- Execution mode decision drives directory structure creation
