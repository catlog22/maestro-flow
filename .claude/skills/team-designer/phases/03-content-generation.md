# Phase 3: Content Generation

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Generate all role files, specs, and templates based on `teamConfig` and the generated SKILL.md.

## Objective

- Generate coordinator role.md + commands/ (analyze, dispatch, monitor)
- Generate each worker role.md (inline or with commands/)
- Generate specs/ files (pipelines.md + domain specs)
- Generate templates/ if needed
- Follow team-lifecycle-v4 golden sample patterns

## Golden Sample Reference

Read the golden sample at `~  or <project>/.claude/skills/team-lifecycle-v4/` for each file type before generating. This ensures pattern fidelity.

## Step 3.1: Generate Coordinator

The coordinator is the most complex role. It always has 3 commands.

### coordinator/role.md

```markdown
---
role: coordinator
---

# Coordinator — ${teamConfig.title}

## Identity

You are the coordinator for ${teamConfig.title}. You orchestrate the ${teamConfig.domain} pipeline by analyzing requirements, dispatching tasks, and monitoring worker progress.

## Boundaries

- **DO**: Analyze, dispatch, monitor, reconcile, report
- **DO NOT**: Implement domain work directly — delegate to workers

## Command Execution Protocol

Read command file → Execute ALL steps sequentially → Return to entry router.
Commands: `commands/analyze.md`, `commands/dispatch.md`, `commands/monitor.md`.

## Entry Router

On each invocation, detect current state and route:

| Condition | Handler |
|-----------|---------|
| First invocation (no session) | → Phase 1: Requirement Clarification |
| Session exists, no team | → Phase 2: Team Setup |
| Team exists, no tasks | → Phase 3: Dispatch (analyze.md → dispatch.md) |
| Tasks exist, none started | → Phase 4: Spawn First (monitor.md → handleSpawnNext) |
| Callback received | → monitor.md → handleCallback |
| User says "check"/"status" | → monitor.md → handleCheck |
| User says "resume"/"continue" | → monitor.md → handleResume |
| All tasks completed | → Phase 5: Report & Completion |

## Phase 0: Session Resume

If `.workflow/.team/${teamConfig.sessionPrefix}-*/team-session.json` exists:
- Load session state, verify team, reconcile task status
- Route to appropriate handler based on current state

## Phase 1: Requirement Clarification

- Parse user's task description at TEXT LEVEL
- Use AskUserQuestion if requirements are ambiguous
- Execute `commands/analyze.md` for signal detection + complexity scoring

## Phase 2: Team Setup

- TeamCreate with session ID: `${teamConfig.sessionPrefix}-<slug>-<date>`
- Initialize team_msg message bus
- Create session directory structure

## Phase 3: Dispatch

- Execute `commands/dispatch.md`
- Creates TaskCreate calls, then sets dependencies via TaskUpdate({ addBlockedBy })

## Phase 4: Spawn & Monitor

- Execute `commands/monitor.md` → handleSpawnNext
- Spawn ready workers as team-worker agents
- **STOP after spawning** — wait for callback

## Phase 5: Report & Completion

- Aggregate all task artifacts
- Present completion action to user
```

### coordinator/commands/analyze.md

Template based on golden sample — includes:
- Signal detection (keywords → capabilities)
- Dependency graph construction (tiers)
- Complexity scoring (1-3 Low, 4-6 Medium, 7+ High)
- Role minimization (cap at 5)
- Output: task-analysis.json

```markdown
# Command: Analyze

## Signal Detection

Scan requirement text for capability signals:
${teamConfig.roles.filter(r => r.name !== 'coordinator').map(r =>
  `- **${r.name}**: [domain-specific keywords]`
).join('\n')}

## Dependency Graph

Build 4-tier dependency graph:
- Tier 0: Independent tasks (can run in parallel)
- Tier 1: Depends on Tier 0
- Tier 2: Depends on Tier 1
- Tier 3: Depends on Tier 2

## Complexity Scoring

| Score | Level | Strategy |
|-------|-------|----------|
| 1-3 | Low | Direct implementation, skip deep planning |
| 4-6 | Medium | Standard pipeline with planning |
| 7+ | High | Full spec → plan → implement cycle |

## Output

Write `task-analysis.json` to session directory:
\```json
{
  "signals": [...],
  "roles_needed": [...],
  "dependency_tiers": [...],
  "complexity": { "score": N, "level": "Low|Medium|High" },
  "pipeline": "${teamConfig.pipelines[0].name}"
}
\```
```

### coordinator/commands/dispatch.md

Template — includes:
- Topological sort from dependency graph
- TaskCreate + TaskUpdate({ addBlockedBy }) for dependencies
- Task description template (PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS)

### coordinator/commands/monitor.md

Template — includes:
- Beat model constants (ONE_STEP_PER_INVOCATION, SPAWN_MODE: spawn-and-stop)
- 6 handlers: handleCallback, handleCheck, handleResume, handleSpawnNext, handleComplete, handleAdapt
- Checkpoint detection for quality gates
- Fast-advance reconciliation

**Critical**: This is the ONLY file that contains beat model logic.

## Step 3.2: Generate Worker Roles

For each worker role in `teamConfig.roles`:

### Inline Role Template (no commands/)

```markdown
---
role: ${role.name}
prefix: ${role.prefix}
inner_loop: ${role.inner_loop}
message_types: [${role.message_types.join(', ')}]
---

# ${capitalize(role.name)} — ${teamConfig.title}

## Identity

You are the ${role.name} for ${teamConfig.title}.
Task prefix: `${role.prefix}-*`

## Phase 2: Context Loading

- Read task description from TaskGet
- Load relevant session artifacts from session directory
- Load specs from `specs/` as needed

## Phase 3: Domain Execution

[Domain-specific execution logic for this role]

### Execution Steps

1. [Step 1 based on role's domain]
2. [Step 2]
3. [Step 3]

### Tools Available

- CLI tools: `maestro delegate --mode analysis|write`
- Direct tools: Read, Write, Edit, Bash, Grep, Glob
- Message bus: `mcp__maestro__team_msg`
- **Cannot use Agent()** — workers must use CLI or direct tools

## Phase 4: Output & Report

- Write artifacts to session directory
- Log state_update via team_msg
- Publish wisdom if cross-task knowledge discovered
```

### Command-Based Role Template (has commands/)

```markdown
---
role: ${role.name}
prefix: ${role.prefix}
inner_loop: ${role.inner_loop}
message_types: [${role.message_types.join(', ')}]
---

# ${capitalize(role.name)} — ${teamConfig.title}

## Identity

You are the ${role.name} for ${teamConfig.title}.
Task prefix: `${role.prefix}-*`

## Phase 2: Context Loading

Load task description, detect mode/command.

## Phase 3: Command Router

| Condition | Command |
|-----------|---------|
${role.commands.map(cmd =>
  `| [condition for ${cmd}] | → commands/${cmd}.md |`
).join('\n')}

Read command file → Execute ALL steps → Return to Phase 4.

## Phase 4: Output & Report

Write artifacts, log state_update.
```

Then generate each `commands/<cmd>.md` with domain-specific logic.

## Step 3.3: Generate Specs

### specs/pipelines.md

```markdown
# Pipeline Definitions

## Available Pipelines

${teamConfig.pipelines.map(p => `
### ${p.name}

| Task ID | Role | Name | Depends On | Checkpoint |
|---------|------|------|------------|------------|
${p.tasks.map(t =>
  `| ${t.id} | ${t.role} | ${t.name} | ${t.dependsOn.join(', ') || '—'} | ${t.isCheckpoint ? '✓' : '—'} |`
).join('\n')}
`).join('\n')}

## Task Metadata Registry

Standard task description template:

\```
PURPOSE: [goal]
TASK: [steps]
CONTEXT: [session artifacts + specs]
EXPECTED: [deliverable format]
CONSTRAINTS: [scope limits]
\```

## Conditional Routing

${teamConfig.conditionalRouting ? `
PLAN-001 complexity assessment routes to:
- Low (1-3): Direct implementation
- Medium (4-6): Standard planning
- High (7+): Full spec → plan → implement
` : 'No conditional routing in this pipeline.'}

## Dynamic Specialist Injection

${teamConfig.dynamicSpecialists.length > 0 ?
  teamConfig.dynamicSpecialists.map(s => `- ${s}: Injected when domain keywords detected`).join('\n') :
  'No dynamic specialists configured.'
}
```

### Additional Specs

For each additional spec in `teamConfig.specs` (beyond pipelines), generate domain-appropriate content:

- **quality-gates.md**: Thresholds (Pass≥80%, Review 60-79%, Fail<60%), scoring dimensions, per-phase gates
- **knowledge-transfer.md**: 5 transfer channels, Phase 2 loading protocol, Phase 4 publishing protocol

## Step 3.4: Generate Templates

For each template in `teamConfig.templates`:

1. Check if golden sample has matching template at `~  or <project>/.claude/skills/team-lifecycle-v4/templates/`
2. If exists: copy and adapt for new domain
3. If not: generate domain-appropriate template structure

## Step 3.5: Generation Order

Execute in this order (respects dependencies):

1. **specs/** — needed by roles for reference
2. **coordinator/** — role.md + commands/ (3 files)
3. **workers/** — each role.md (+ optional commands/)
4. **templates/** — independent, generate last

For each file:
1. Read golden sample equivalent (if exists)
2. Adapt content for current teamConfig
3. Write file
4. Verify file exists

## Output

- **Files**: All role.md, commands/*.md, specs/*.md, templates/*.md
- **Next**: Phase 4 - Validation
