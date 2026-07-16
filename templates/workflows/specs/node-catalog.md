# Node Catalog — Available Executors for `/maestro --compose`

All executors available for node resolution in Phase 2 (Resolve).
First-tier steps live in `~/.maestro/workflows/`; commands (`/prefix`) live in `~/.claude/commands/`; dispatcher executors (`manage`, `spec`) take the subcommand in args.

## Step Nodes (first-tier steps)

| Executor | Input Ports | Output Ports | Typical Args Template |
|----------|-------------|--------------|----------------------|
| `plan` | requirement | plan | `"{goal}"` |
| `execute` | plan | code | `{phase}` |
| `analyze` | requirement | analysis | `"{goal}"` |
| `brainstorm` | topic | brainstorm-analysis | `"{goal}"` |
| `spec-generate` | requirement | specification | `"{goal}"` |
| `roadmap` | requirement | roadmap | `"{goal}"` |
| `quick` | requirement | code | `"{goal}"` |
| `maestro-impeccable` | requirement | ui-design | `"{phase}" --chain build` |

## Quality Steps (as step nodes)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `review` | code | review-findings | `{phase}` |
| `test` | code | test-passed | `{phase}` |
| `auto-test` | code, requirement | auto-test-report | `{phase}` |
| `debug` | bug-report | diagnosis | `"{goal}"` |
| `quality-refactor` | codebase | refactored-code | `"{goal}"` |
| `sync` | code | synced-docs | `{phase}` |
| `retrospective` | phase | retrospective | `{phase}` |

## Management Nodes (dispatcher: `manage`)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `manage` | — | dashboard | `status` |
| `manage` | — | issue-status | `issue "{goal}"` |
| `manage` | codebase | pending-issues | `issue discover "{goal}"` |
| `manage` | — | docs | `sync rebuild` |
| `manage` | — | docs | `sync codebase` |
| `manage` | artifacts | knowledge | `knowledge harvest` |

## Session Close Commands (as skill nodes)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `maestro-session-seal` | — | sealed | (no args) |

> Milestone audit is not a catalog node — run it via `/maestro-ralph "{goal}" --engine swarm --script wf-milestone-audit`.

## Spec Nodes (dispatcher: `spec`)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `spec` | knowledge | spec-entry | `add "{goal}"` |
| `spec` | — | specs | `load "{goal}"` |
| `spec` | — | specs | `setup` |

## CLI Nodes (via `maestro delegate`)

CLI nodes use `maestro delegate` with `--to <tool> --mode <mode> --rule <rule>`.

| Use Case | cli_tool | cli_mode | cli_rule |
|----------|----------|----------|----------|
| Architecture analysis | gemini | analysis | analysis-review-architecture |
| Code quality review | gemini | analysis | analysis-review-code-quality |
| Bug root cause | gemini | analysis | analysis-diagnose-bug-root-cause |
| Security assessment | gemini | analysis | analysis-assess-security-risks |
| Performance analysis | gemini | analysis | analysis-analyze-performance |
| Code patterns | gemini | analysis | analysis-analyze-code-patterns |
| Task breakdown | gemini | analysis | planning-breakdown-task-steps |
| Architecture design | gemini | analysis | planning-plan-architecture-design |
| Feature implementation | gemini | write | development-implement-feature |
| Refactoring | gemini | write | development-refactor-codebase |
| Test generation | gemini | write | development-generate-tests |

**CLI node args_template format**:
```
PURPOSE: {goal}
TASK: [derived from step description]
MODE: analysis
CONTEXT: @**/* | Memory: {memory_context}
EXPECTED: [derived from step output_ports]
CONSTRAINTS: {scope}
```

## Agent Nodes

| subagent_type | Use Case | run_in_background |
|---------------|----------|-------------------|
| `general-purpose` | Freeform analysis or implementation | false |
| `workflow-executor` | Code implementation | false |

**Agent node args_template format**:
```
Task: {goal}

Context from previous step:
{prev_output}

Deliver: [specify expected output format]
```

## Team Skill Nodes

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `team-lifecycle-v4` | requirement | code | `"{goal}"` |
| `team-coordinate` | requirement | coordinated-output | `"{goal}"` |
| `team-review` | code | review-findings | `"{goal}"` |
| `team-testing` | code | test-passed | `"{goal}"` |
| `team-quality-assurance` | code | qa-report | `"{goal}"` |
| `team-tech-debt` | codebase | refactored-code | `"{goal}"` |

## Resolution Algorithm

1. Match step `type_hint` to executor candidates in catalog
2. If multiple candidates, select by semantic fit to step description
3. If no catalog match, emit `cli` node with inferred `--rule` and `--mode`

| type_hint | Default executor type | Default executor |
|-----------|----------------------|------------------|
| `planning` | skill | `plan` |
| `execution` | skill | `execute` |
| `testing` | skill | `test` |
| `review` | skill | `review` |
| `brainstorm` | skill | `brainstorm` |
| `analysis` | cli | `maestro delegate --role analyze --mode analysis` |
| `spec` | skill | `spec-generate` |
| `refactor` | skill | `quality-refactor` |
| `integration-test` | skill | `auto-test` |
| `debug` | skill | `debug` |
| `agent` | agent | (infer subagent_type from description) |
| `checkpoint` | checkpoint | — |

## Context Injection Rules

- Planning nodes after analysis: inject `--context {prev_output_path}`
- Execution nodes after planning: inherit phase from prior plan output
- Testing/review nodes after execution: inherit phase from prior execution

## Runtime Reference Syntax (resolved by the `--play` runtime)

| Reference | Resolves To |
|-----------|-------------|
| `{variable}` | Value from context binding |
| `{N-001.session_id}` | `steps[0].session_id` |
| `{N-001.output_path}` | `steps[0].output_path` |
| `{prev_session_id}` | session_id of preceding work node |
| `{prev_output_path}` | output_path of preceding work node |

Fallback: if referenced field is null, substitution results in empty string.

## Checkpoint Nodes

Checkpoints are auto-generated, not selected from catalog.

| auto_continue | When to Use |
|---------------|-------------|
| `true` | Background save, execution continues automatically |
| `false` | Pause for user review before proceeding |

Set `auto_continue: false` when:
- The next node is user-facing (plan display, spec review)
- The user requested an explicit pause
- The next node spawns a background agent
