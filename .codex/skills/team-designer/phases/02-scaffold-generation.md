
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 2: Scaffold Generation

## Objective

- Create directory structure (roles/, specs/, templates/)
- Generate SKILL.md as universal router following v4 pattern
- SKILL.md must NOT contain beat model, pipeline details, or role Phase 2-4 logic

## Step 2.1: Create Directory Structure

```bash
skillDir=".claude/skills/${teamConfig.skillName}"
mkdir -p "${skillDir}"

# Create role directories
for role in teamConfig.roles:
  mkdir -p "${skillDir}/roles/${role.name}"
  if role.hasCommands:
    mkdir -p "${skillDir}/roles/${role.name}/commands"

# Create specs directory
mkdir -p "${skillDir}/specs"

# Create templates directory (if needed)
if teamConfig.templates.length > 0:
  mkdir -p "${skillDir}/templates"
```

## Step 2.2: Generate SKILL.md

The SKILL.md follows a strict template. Every generated SKILL.md contains these sections in order:

### Section 1: Frontmatter

```yaml
---
name: ${teamConfig.skillName}
description: "${teamConfig.domain}. Triggers on ${teamConfig.skillName}."
allowed-tools: TeamCreate(*), TeamDelete(*), send_message(*), update_plan(*), update_plan(*), list_agents(*), wait_agent(*), spawn_agent(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*)
---
```

### Section 2: Title + Architecture Diagram

```markdown
# ${Title}

${One-line description}

## Architecture

\```
spawn_agent({ task_name: "${teamconfig.skillname}", message: "Execute skill ${teamConfig.skillName}, args: "task description"" })
                    |
         SKILL.md (this file) = Router
                    |
     +--------------+--------------+
     |                             |
  no --role flag              --role <name>
     |                             |
  Coordinator                  Worker
  roles/coordinator/role.md    roles/<name>/role.md
     |
     +-- analyze → dispatch → spawn workers → STOP
                                    |
                    +-------+-------+-------+
                    v       v       v       v
                 [team-worker agents, each loads roles/<role>/role.md]
\```
```

### Section 3: Role Registry

```markdown
## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | roles/coordinator/role.md | — | — |
${teamConfig.roles.filter(r => r.name !== 'coordinator').map(r =>
  `| ${r.name} | ${r.path} | ${r.prefix}-* | ${r.inner_loop} |`
).join('\n')}
```

### Section 4: Role Router

```markdown
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → Read `roles/coordinator/role.md`, execute entry router
```

### Section 5: Shared Constants

```markdown
## Shared Constants

- **Session prefix**: `${teamConfig.sessionPrefix}`
- **Session path**: `{run_dir}/work/team/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`
```

### Section 6: Worker Spawn Template

```markdown
## Worker Spawn Template

Coordinator spawns workers using this template:

\```
spawn_agent({
  task_name: "<role>",
  message: `## Role Assignment
role: <role>
role_spec: .claude/skills/${teamConfig.skillName}/roles/<role>/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: <team-name>
requirement: <task-description>
inner_loop: <true|false>

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`,
  fork_turns: "none",
  agent_type: "team_worker"
})
\```
```

### Section 7: User Commands

```markdown
## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |
| `revise <TASK-ID> [feedback]` | Revise specific task |
| `feedback <text>` | Inject feedback for revision |
| `recheck` | Re-run quality check |
| `improve [dimension]` | Auto-improve weakest dimension |
```

### Section 8: Completion Action

```markdown
## Completion Action

When pipeline completes, coordinator presents:

\```
request_user_input({
  questions: [{
    question: "Pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory" }
    ]
  }]
})
\```
```

### Section 9: Specs Reference

```markdown
## Specs Reference

${teamConfig.specs.map(s =>
  `- [specs/${s}.md](specs/${s}.md) — ${specDescription(s)}`
).join('\n')}
```

### Section 10: Session Directory

```markdown
## Session Directory

\```
{run_dir}/work/team/
├── team-session.json           # Session state + role registry
├── {run_dir}/outputs/spec/                       # Spec phase outputs
├── {run_dir}/outputs/plan/                       # Implementation plan + TASK-*.json
├── artifacts/                  # All deliverables
├── wisdom/                     # Cross-task knowledge
├── explorations/               # Shared explore cache
├── {run_dir}/evidence/discussions/                # Discuss round records
└── .msg/                       # Team message bus
\```
```

### Section 11: Error Handling

```markdown
## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| CLI tool fails | Worker fallback to direct implementation |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
```

## Step 2.3: Assemble and Write

Assemble all sections into a single SKILL.md file and write to `${skillDir}/SKILL.md`.

**Quality Rules**:
1. SKILL.md must NOT contain beat model (ONE_STEP_PER_INVOCATION, spawn-and-stop)
2. SKILL.md must NOT contain pipeline task details (task IDs, dependencies)
3. SKILL.md must NOT contain role Phase 2-4 logic
4. SKILL.md MUST contain role registry table with correct paths
5. SKILL.md MUST contain worker spawn template with correct `role_spec` paths

## Output

- **File**: `.claude/skills/${teamConfig.skillName}/SKILL.md`
- **Variable**: `skillDir` (path to skill root directory)
- **Next**: Phase 3 - Content Generation

## Next Phase

Return to orchestrator, then auto-continue to [Phase 3: Content Generation](03-content-generation.md).
