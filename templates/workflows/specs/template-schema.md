# Workflow Template Schema — for maestro-composer Phase 5

## Template JSON

File location: `~/.maestro/templates/workflows/<slug>.json`

```json
{
  "template_id": "wft-<slug>-<YYYYMMDD>",
  "name": "Human readable template name",
  "description": "Brief description of what this workflow achieves",
  "version": "1.0",
  "created_at": "2026-04-26T10:00:00Z",
  "source_session": "WFD-<slug>-<date>",
  "tags": ["feature", "medium"],

  "context_schema": {
    "goal": {
      "type": "string",
      "required": true,
      "description": "Main task goal or feature to implement"
    },
    "scope": {
      "type": "string",
      "required": false,
      "description": "Target file or module scope",
      "default": "src/**/*"
    }
  },

  "nodes": [
    { /* see Node Type Definitions below */ }
  ],

  "edges": [
    { "from": "N-001", "to": "CP-01" },
    { "from": "CP-01", "to": "N-002" }
  ],

  "checkpoints": ["CP-01", "CP-02"],

  "execution_mode": "serial",

  "metadata": {
    "node_count": 3,
    "checkpoint_count": 2
  }
}
```

## Node Type Definitions

### skill node
```json
{
  "id": "N-001",
  "name": "Plan Feature",
  "type": "skill",
  "executor": "maestro-plan",
  "args_template": "{goal}",
  "input_ports": ["requirement"],
  "output_ports": ["plan"],
  "parallel_group": null,
  "on_fail": "abort"
}
```

### cli node
```json
{
  "id": "N-002",
  "name": "Analyze Architecture",
  "type": "cli",
  "executor": "maestro delegate",
  "cli_tool": "gemini",
  "cli_mode": "analysis",
  "cli_rule": "analysis-review-architecture",
  "args_template": "PURPOSE: {goal}\nTASK: ...\nMODE: analysis\nCONTEXT: @**/*\nEXPECTED: ...\nCONSTRAINTS: ...",
  "input_ports": ["analysis-topic"],
  "output_ports": ["analysis"],
  "parallel_group": null,
  "on_fail": "abort"
}
```

### command node

> Note: maestro2 currently has no namespace commands. This type is reserved for future use.
> All commands are top-level skill nodes (e.g. `quality-refactor` instead of `workflow:refactor-cycle`).

```json
{
  "id": "N-003",
  "name": "Refactor Module",
  "type": "skill",
  "executor": "quality-refactor",
  "args_template": "{goal}",
  "input_ports": ["codebase"],
  "output_ports": ["refactored-code"],
  "parallel_group": null,
  "on_fail": "abort"
}
```

### agent node
```json
{
  "id": "N-004",
  "name": "Deep Analysis",
  "type": "agent",
  "executor": "general-purpose",
  "args_template": "Task: {goal}\n\nContext from previous step:\n{prev_output}",
  "input_ports": ["requirement"],
  "output_ports": ["analysis"],
  "parallel_group": null,
  "run_in_background": false,
  "on_fail": "abort"
}
```

### checkpoint node
```json
{
  "id": "CP-01",
  "name": "Checkpoint: After Plan",
  "type": "checkpoint",
  "description": "Plan artifact saved before execution proceeds",
  "auto_continue": true,
  "save_fields": ["session_id", "artifacts", "output_path"]
}
```

## Template Index

File location: `~/.maestro/templates/workflows/index.json`

```json
{
  "templates": [
    {
      "template_id": "wft-feature-tdd-review-20260426",
      "name": "Feature TDD with Review",
      "path": "~/.maestro/templates/workflows/feature-tdd-review.json",
      "tags": ["feature", "complex"],
      "created_at": "2026-04-26T10:00:00Z",
      "node_count": 5
    }
  ]
}
```

## Naming Conventions

- **Template name**: Human readable, e.g. "Feature TDD with Review"
- **Slug**: kebab-case from name, e.g. `feature-tdd-review`
- **Template ID**: `wft-<slug>-<YYYYMMDD>`, e.g. `wft-feature-tdd-review-20260426`
- **Versioning**: If slug already exists with different content, append `-v2`, `-v3`
