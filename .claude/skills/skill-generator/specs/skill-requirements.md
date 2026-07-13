

# Skill Requirements Specification

Requirements collection specification for new Skill creation.

---

## Required Information

### 1. Basic Information

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_name` | string | Yes | Skill identifier (lowercase with hyphens) |
| `display_name` | string | Yes | Display name |
| `description` | string | Yes | One-sentence description |
| `triggers` | string[] | Yes | List of trigger keywords |

### 2. Execution Mode

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `execution_mode` | enum | Yes | `sequential` \| `autonomous` \| `hybrid` |
| `phase_count` | number | Conditional | Number of phases in Sequential mode |
| `action_count` | number | Conditional | Number of actions in Autonomous mode |

### 2.5 Context Strategy (P0 Enhancement)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `context_strategy` | enum | Yes | `file` \| `memory` |

**Strategy Comparison**:

| Strategy | Persistence | Debuggable | Recoverable | Applicable Scenarios |
|----------|-------------|-----------|------------|----------------------|
| `file` | Yes | Yes | Yes | Complex multi-phase tasks (recommended) |
| `memory` | No | No | No | Simple linear tasks |

### 2.6 LLM Integration Configuration (P1 Enhancement)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `llm_integration` | object | Optional | LLM invocation configuration |
| `llm_integration.enabled` | boolean | - | Enable LLM invocation |
| `llm_integration.default_tool` | enum | - | `agy` \| `qwen` \| `codex` |
| `llm_integration.fallback_chain` | string[] | - | Fallback tool chain on failure |

### 3. Tool Dependencies

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `allowed_tools` | string[] | Yes | List of allowed tools |
| `mcp_tools` | string[] | Optional | Required MCP tools |

### 4. Output Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `output_format` | enum | Yes | `markdown` \| `html` \| `json` |
| `output_location` | string | Yes | Output directory pattern |

---

## Configuration File Structure

```typescript
interface SkillConfig {
  // Basic information
  skill_name: string;           // "my-skill"
  display_name: string;         // "My Skill"
  description: string;          // "One-sentence description"
  triggers: string[];           // ["keyword1", "keyword2"]

  // Execution mode
  execution_mode: 'sequential' | 'autonomous' | 'hybrid';

  // Context strategy (P0 Enhancement)
  context_strategy: 'file' | 'memory';  // Default: 'file'

  // LLM Integration Configuration (P1 Enhancement)
  llm_integration?: {
    enabled: boolean;                    // Enable LLM invocation
    default_tool: 'agy' | 'qwen' | 'codex';
    fallback_chain: string[];            // ['agy', 'qwen', 'codex']
    mode: 'analysis' | 'write';          // Default mode
  };

  // Sequential mode configuration
  sequential_config?: {
    phases: Array<{
      id: string;               // "01-init"
      name: string;             // "Initialization"
      description: string;      // "Collect initial configuration"
      input: string[];          // Input dependencies
      output: string;           // Output file
    }>;
  };

  // Autonomous mode configuration
  autonomous_config?: {
    state_schema: {
      fields: Array<{
        name: string;
        type: string;
        description: string;
      }>;
    };
    actions: Array<{
      id: string;               // "action-init"
      name: string;             // "Initialize"
      description: string;      // "Initialize state"
      preconditions: string[];  // Preconditions
      effects: string[];        // Execution effects
    }>;
    termination_conditions: string[];
  };

  // Tool dependencies
  allowed_tools: string[];      // ["Task", "Read", "Write", ...]
  mcp_tools?: string[];         // ["mcp__chrome__*"]

  // Output configuration
  output: {
    format: 'markdown' | 'html' | 'json';
    location: string;           // "{run_dir}/outputs" for formal deliverables
    filename_pattern: string;   // "{name}-output.{ext}"
  };

  // Quality configuration
  quality?: {
    dimensions: string[];       // ["completeness", "consistency", ...]
    pass_threshold: number;     // 80
  };

  // Metadata
  created_at: string;
  version: string;
}
```

---

## Requirements Collection Questions

### Phase 1: Basic Information

```javascript
AskUserQuestion({
  questions: [
    {
      question: "What is the Skill name? (English, lowercase with hyphens)",
      header: "Skill Name",
      multiSelect: false,
      options: [
        { label: "Auto-generate", description: "Auto-generate name from description" },
        { label: "Manual input", description: "Enter custom name" }
      ]
    },
    {
      question: "What is the primary purpose of this Skill?",
      header: "Purpose Type",
      multiSelect: false,
      options: [
        { label: "Document Generation", description: "Generate Markdown/HTML documents" },
        { label: "Code Analysis", description: "Analyze code structure, quality, security" },
        { label: "Interactive Management", description: "Manage Issues, tasks, workflows" },
        { label: "Data Processing", description: "ETL, transformation, report generation" },
        { label: "Custom", description: "Other purposes" }
      ]
    }
  ]
});
```

### Phase 2: Execution Mode

```javascript
AskUserQuestion({
  questions: [
    {
      question: "Select execution mode:",
      header: "Execution Mode",
      multiSelect: false,
      options: [
        {
          label: "Sequential (Fixed Order)",
          description: "Phases execute in fixed order, suitable for pipeline tasks (recommended)"
        },
        {
          label: "Autonomous (Dynamic)",
          description: "Dynamically select execution path, suitable for interactive tasks"
        },
        {
          label: "Hybrid (Mixed)",
          description: "Fixed initialization and finalization, flexible middle interaction"
        }
      ]
    }
  ]
});
```

### Phase 3: Phase/Action Definition

#### Sequential Mode

```javascript
AskUserQuestion({
  questions: [
    {
      question: "How many execution phases do you need?",
      header: "Phase Count",
      multiSelect: false,
      options: [
        { label: "3 phases", description: "Simple: Collect → Process → Output" },
        { label: "5 phases", description: "Standard: Collect → Explore → Analyze → Assemble → Validate" },
        { label: "7 phases", description: "Complete: Include parallel processing and iterative optimization" },
        { label: "Custom", description: "Manually specify phases" }
      ]
    }
  ]
});
```

#### Autonomous Mode

```javascript
AskUserQuestion({
  questions: [
    {
      question: "What are the core actions?",
      header: "Action Definition",
      multiSelect: true,
      options: [
        { label: "Initialize (init)", description: "Set initial state" },
        { label: "List (list)", description: "Display current items" },
        { label: "Create (create)", description: "Create new item" },
        { label: "Edit (edit)", description: "Modify existing item" },
        { label: "Delete (delete)", description: "Delete item" },
        { label: "Complete (complete)", description: "Complete task" }
      ]
    }
  ]
});
```

### Phase 4: Context Strategy (P0 Enhancement)

```javascript
AskUserQuestion({
  questions: [
    {
      question: "Select context management strategy:",
      header: "Context Strategy",
      multiSelect: false,
      options: [
        {
          label: "File Strategy (file)",
          description: "Persist through the active Session/Run, supports debugging and recovery (recommended)"
        },
        {
          label: "Memory Strategy (memory)",
          description: "Keep only at runtime, fast but no recovery"
        }
      ]
    }
  ]
});
```

### Phase 5: LLM Integration (P1 Enhancement)

```javascript
AskUserQuestion({
  questions: [
    {
      question: "Do you need LLM invocation capability?",
      header: "LLM Integration",
      multiSelect: false,
      options: [
        {
          label: "Enable LLM Invocation",
          description: "Use agy/qwen/codex for analysis or generation"
        },
        {
          label: "Not needed",
          description: "Only use local tools"
        }
      ]
    }
  ]
});

// If LLM enabled
if (llmEnabled) {
  AskUserQuestion({
    questions: [
      {
        question: "Select default LLM tool:",
        header: "LLM Tool",
        multiSelect: false,
        options: [
          { label: "Agy", description: "Large context, suitable for analysis tasks (recommended)" },
          { label: "Qwen", description: "Strong code generation capability" },
          { label: "Codex", description: "Strong autonomous execution, suitable for implementation tasks" }
        ]
      }
    ]
  });
}
```

### Phase 6: Tool Dependencies

```javascript
AskUserQuestion({
  questions: [
    {
      question: "What tools do you need?",
      header: "Tool Selection",
      multiSelect: true,
      options: [
        { label: "Basic tools", description: "Task, Read, Write, Glob, Grep, Bash" },
        { label: "User interaction", description: "AskUserQuestion" },
        { label: "Chrome screenshot", description: "mcp__chrome__*" },
        { label: "External search", description: "mcp__exa__search" },
        { label: "maestro delegate invocation", description: "maestro delegate (agy/qwen/codex)" }
      ]
    }
  ]
});
```

---

## Validation Rules

### Name Validation

```javascript
function validateSkillName(name) {
  const rules = [
    { test: /^[a-z][a-z0-9-]*$/, msg: "Must start with lowercase letter, only contain lowercase letters, digits, hyphens" },
    { test: /^.{3,30}$/, msg: "Length 3-30 characters" },
    { test: /^(?!.*--)/, msg: "Cannot have consecutive hyphens" },
    { test: /[^-]$/, msg: "Cannot end with hyphen" }
  ];

  for (const rule of rules) {
    if (!rule.test.test(name)) {
      return { valid: false, error: rule.msg };
    }
  }
  return { valid: true };
}
```

### Configuration Validation

```javascript
function validateSkillConfig(config) {
  const errors = [];

  // Required fields
  if (!config.skill_name) errors.push("Missing skill_name");
  if (!config.description) errors.push("Missing description");
  if (!config.execution_mode) errors.push("Missing execution_mode");

  // Mode-specific validation
  if (config.execution_mode === 'sequential') {
    if (!config.sequential_config?.phases?.length) {
      errors.push("Sequential mode requires phases definition");
    }
  } else if (config.execution_mode === 'autonomous') {
    if (!config.autonomous_config?.actions?.length) {
      errors.push("Autonomous mode requires actions definition");
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

## Example Configurations

### Sequential Mode Example (Enhanced)

```json
{
  "skill_name": "api-docs-generator",
  "display_name": "API Docs Generator",
  "description": "Generate API documentation from source code",
  "triggers": ["generate api docs", "api documentation"],
  "execution_mode": "sequential",
  "context_strategy": "file",
  "llm_integration": {
    "enabled": true,
    "default_tool": "agy",
    "fallback_chain": ["agy", "qwen"],
    "mode": "analysis"
  },
  "sequential_config": {
    "phases": [
      {
        "id": "01-scan",
        "name": "Code Scanning",
        "output": "endpoints.json",
        "agent": { "type": "universal-executor", "run_in_background": false }
      },
      {
        "id": "02-analyze",
        "name": "LLM Analysis",
        "output": "analysis.json",
        "agent": { "type": "llm", "tool": "agy", "mode": "analysis" }
      },
      {
        "id": "03-generate",
        "name": "Doc Generation",
        "output": "api-docs.md",
        "agent": { "type": "universal-executor", "run_in_background": false }
      }
    ]
  },
  "allowed_tools": ["Task", "Read", "Write", "Glob", "Grep", "Bash"],
  "output": {
    "format": "markdown",
    "location": "{run_dir}/outputs/api-docs",
    "filename_pattern": "{name}-api-docs.md"
  }
}
```

### Autonomous Mode Example

```json
{
  "skill_name": "task-manager",
  "display_name": "Task Manager",
  "description": "Interactive task management with CRUD operations",
  "triggers": ["manage tasks", "task list", "create task"],
  "execution_mode": "autonomous",
  "autonomous_config": {
    "state_schema": {
      "fields": [
        { "name": "tasks", "type": "Task[]", "description": "Task list" },
        { "name": "current_view", "type": "string", "description": "Current view" }
      ]
    },
    "actions": [
      { "id": "action-list", "name": "List Tasks", "preconditions": [], "effects": ["Display task list"] },
      { "id": "action-create", "name": "Create Task", "preconditions": [], "effects": ["Add new task"] },
      { "id": "action-edit", "name": "Edit Task", "preconditions": ["task_selected"], "effects": ["Update task"] },
      { "id": "action-delete", "name": "Delete Task", "preconditions": ["task_selected"], "effects": ["Delete task"] }
    ],
    "termination_conditions": ["user_exit", "error_limit"]
  },
  "allowed_tools": ["Task", "AskUserQuestion", "Read", "Write"],
  "output": {
    "format": "json",
    "location": "{run_dir}/outputs/tasks",
    "filename_pattern": "tasks.json"
  }
}
```
