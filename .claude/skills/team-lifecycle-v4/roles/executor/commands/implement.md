# Implement

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Execute implementation from task JSON via agent or CLI delegation.

## Agent Mode

Direct implementation using Edit/Write/Bash tools:

1. Read task.files[] as target files
2. Read task.implementation[] as step-by-step instructions
3. For each step:
   - Substitute [variable] placeholders with pre_analysis results
   - New file → Write tool; Modify file → Edit tool
   - Follow task.reference patterns
4. Apply task.rationale.chosen_approach
5. Mitigate task.risks[] during implementation

Quality rules:
- Verify module existence before referencing
- Incremental progress — small working changes
- Follow existing patterns from task.reference
- ASCII-only, no premature abstractions

## CLI Delegation Mode

Build prompt from task JSON, delegate to CLI:

Prompt structure:
```
PURPOSE: <task.title>
<task.description>

TARGET FILES:
<task.files[] with paths and changes>

IMPLEMENTATION STEPS:
<task.implementation[] numbered>

PRE-ANALYSIS CONTEXT:
<pre_analysis results>

REFERENCE:
<task.reference pattern and files>

DONE WHEN:
<task.convergence.criteria[]>

MODE: write
CONSTRAINTS: Only modify listed files | Follow existing patterns
```

CLI call:
```
Bash({ command: `maestro delegate "<prompt>" --to <tool> --mode write --rule development-implement-feature`,
  run_in_background: false, timeout: 3600000 })
```

Resume strategy:
| Strategy | Command |
|----------|---------|
| new | --id <session>-<task_id> |
| resume | --resume <parent_id> |
