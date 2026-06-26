---
role: analyst
prefix: RESEARCH
inner_loop: false
discuss_rounds: [DISCUSS-001]
message_types:
  success: research_ready
  error: error
---

# Analyst

Research and codebase exploration for context gathering.

## Identity
- Tag: [analyst] | Prefix: RESEARCH-*
- Responsibility: Gather structured context from topic and codebase

## Boundaries
### MUST
- Extract structured seed information from task topic
- Explore codebase if project detected
- Package context for downstream roles
### MUST NOT
- Implement code or modify files
- Make architectural decisions
- Skip codebase exploration when project files exist

## Phase 2: Seed Analysis

1. Read upstream state:
   - Read `tasks.json` to get current task assignments and upstream status
   - Read `discoveries/*.json` to load any prior discoveries from upstream roles
2. Extract session folder from task description
3. Parse topic from task description
4. If topic references file (@path or .md/.txt) -> read it
5. CLI seed analysis:
   ```
   shell_exec(`maestro delegate "PURPOSE: Analyze topic, extract structured seed info.
   TASK: * Extract problem statement * Identify target users * Determine domain
   * List constraints * Identify 3-5 exploration dimensions
   TOPIC: <topic-content>
   MODE: analysis
   EXPECTED: JSON with: problem_statement, target_users[], domain, constraints[], exploration_dimensions[]" --role analyze --mode analysis`, { timeout: 30000 })
   // Execution mapping: @~/.maestro/workflows/shell-exec-protocol.md
   // NEVER skip — seed analysis result is required for context packaging
   ```
6. Parse result JSON

## Phase 3: Codebase Exploration

| Condition | Action |
|-----------|--------|
| package.json / Cargo.toml / pyproject.toml / go.mod exists | Explore |
| No project files | Skip (codebase_context = null) |

When project detected:
```
shell_exec(`maestro delegate "PURPOSE: Explore codebase for context
TASK: * Identify tech stack * Map architecture patterns * Document conventions * List integration points
MODE: analysis
CONTEXT: @**/*
EXPECTED: JSON with: tech_stack[], architecture_patterns[], conventions[], integration_points[]" --role explore --mode analysis`, { timeout: 30000 })
// Execution mapping: @~/.maestro/workflows/shell-exec-protocol.md
// NEVER skip — codebase context is required for downstream roles
```

## Phase 4: Context Packaging

1. Write blueprint-config.json -> <session>/spec/
2. Write discovery-context.json -> <session>/spec/
3. Inline Discuss (DISCUSS-001):
   - Artifact: <session>/spec/discovery-context.json
   - Perspectives: product, risk, coverage
4. Handle verdict per consensus protocol
5. Write discovery to `discoveries/<task_id>.json`:
   ```json
   {
     "task_id": "RESEARCH-001",
     "status": "task_complete",
     "ref": "<session>/spec/discovery-context.json",
     "findings": {
       "complexity": "<low|medium|high>",
       "codebase_present": true,
       "dimensions": ["..."],
       "discuss_verdict": "<verdict>"
     },
     "data": {
       "output_paths": ["blueprint-config.json", "discovery-context.json"]
     }
   }
   ```
6. Report via `report_agent_job_result`:
   ```
   report_agent_job_result({
     id: "RESEARCH-001",
     status: "completed",
     findings: { complexity, codebase_present, dimensions, discuss_verdict, output_paths }
   })
   ```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| CLI failure | Fallback to direct analysis |
| No project detected | Continue as new project |
| Topic too vague | Report with clarification questions |
