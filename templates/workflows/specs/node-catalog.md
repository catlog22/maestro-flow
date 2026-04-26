# Node Catalog — Available Executors for maestro-composer

All executors available for node resolution in Phase 2 (Resolve).
Only commands that exist in `~/.claude/commands/` are listed.

## Skill Nodes (maestro commands)

| Executor | Input Ports | Output Ports | Typical Args Template |
|----------|-------------|--------------|----------------------|
| `maestro-plan` | requirement | plan | `"{goal}"` |
| `maestro-execute` | plan | code | `{phase}` |
| `maestro-verify` | code | verification | `{phase}` |
| `maestro-analyze` | requirement | analysis | `"{goal}"` |
| `maestro-brainstorm` | topic | brainstorm-analysis | `"{goal}"` |
| `maestro-spec-generate` | requirement | specification | `"{goal}"` |
| `maestro-roadmap` | requirement | roadmap | `"{goal}"` |
| `maestro-quick` | requirement | code | `"{goal}"` |
| `maestro-ui-design` | requirement | ui-design | `{phase}` |

## Quality Commands (as skill nodes)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `quality-review` | code | review-findings | `{phase}` |
| `quality-test` | code | test-passed | `{phase}` |
| `quality-test-gen` | code | test-generated | `{phase}` |
| `quality-debug` | bug-report | diagnosis | `"{goal}"` |
| `quality-refactor` | codebase | refactored-code | `"{goal}"` |
| `quality-integration-test` | requirement | test-passed | `{phase}` |
| `quality-sync` | code | synced-docs | `{phase}` |
| `quality-retrospective` | phase | retrospective | `{phase}` |
| `quality-business-test` | requirement | test-passed | `{phase}` |

## Management Commands (as skill nodes)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `manage-status` | — | dashboard | (no args) |
| `manage-issue` | — | issue-status | `"{goal}"` |
| `manage-issue-discover` | codebase | pending-issues | `"{goal}"` |
| `manage-codebase-rebuild` | — | docs | (no args) |
| `manage-codebase-refresh` | — | docs | (no args) |
| `manage-harvest` | artifacts | knowledge | (no args) |
| `manage-learn` | — | learning | `"{goal}"` |

## Milestone Commands (as skill nodes)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `maestro-milestone-audit` | — | audit-report | (no args) |
| `maestro-milestone-complete` | — | archived | (no args) |
| `maestro-milestone-release` | — | release | (no args) |

## Spec Commands (as skill nodes)

| Executor | Input Ports | Output Ports | Typical Args |
|----------|-------------|--------------|--------------|
| `spec-add` | knowledge | spec-entry | `"{goal}"` |
| `spec-load` | — | specs | `"{goal}"` |
| `spec-setup` | — | specs | (no args) |

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
| `code-developer` | Code implementation | false |

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
| `planning` | skill | `maestro-plan` |
| `execution` | skill | `maestro-execute` |
| `testing` | skill | `quality-test` |
| `review` | skill | `quality-review` |
| `brainstorm` | skill | `maestro-brainstorm` |
| `analysis` | cli | `maestro delegate --to gemini --mode analysis` |
| `spec` | skill | `maestro-spec-generate` |
| `refactor` | skill | `quality-refactor` |
| `integration-test` | skill | `quality-integration-test` |
| `debug` | skill | `quality-debug` |
| `verify` | skill | `maestro-verify` |
| `agent` | agent | (infer subagent_type from description) |
| `checkpoint` | checkpoint | — |

## Context Injection Rules

- Planning nodes after analysis: inject `--context {prev_output_path}`
- Execution nodes after planning: inherit phase from prior plan output
- Testing/review nodes after execution: inherit phase from prior execution

## Runtime Reference Syntax (resolved by maestro-player)

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
