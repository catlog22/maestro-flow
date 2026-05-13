---
name: maestro-composer
description: Compose reusable workflow templates from natural language
argument-hint: "\"workflow description\" [--resume] [--edit <template-path>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - Skill
---
<purpose>
Interactive workflow template composer. Parse natural language → resolve executors → inject checkpoints → build DAG → persist to `~/.maestro/templates/workflows/`. Progressive disclosure — specs loaded only when phase needs them.

Three entry modes: **New design** (default), **Resume** (`--resume`), **Edit** (`--edit <path>`).
</purpose>

<deferred_reading>
- [node-catalog](~/.maestro/templates/workflows/specs/node-catalog.md) — read at Phase 2 (Resolve)
- [template-schema](~/.maestro/templates/workflows/specs/template-schema.md) — read at Phase 5 (Persist)
</deferred_reading>

<context>
$ARGUMENTS — natural language description, or flags.

**Flags**: `--resume` (resume in-progress design), `--edit <path>` (edit existing template)

**Constants**:
- Template dir: `~/.maestro/templates/workflows/`
- Template index: `~/.maestro/templates/workflows/index.json`
- Design drafts: `.workflow/templates/design-drafts/`
- Template ID: `wft-<slug>-<YYYYMMDD>`, Node ID: `N-<seq>`, Checkpoint: `CP-<seq>`
- Max nodes: 20
</context>

<state_machine>

<states>
S_ROUTE        — 入口路由（new/resume/edit）               PERSIST: —
S_PARSE        — 语义意图提取                               PERSIST: intent.json
S_CONFIRM_1    — 确认解析结果                               PERSIST: —
S_RESOLVE      — 映射步骤到 executor 节点                   PERSIST: nodes.json
S_CONFIRM_2    — 确认节点映射                               PERSIST: —
S_ENRICH       — 注入 checkpoint + 构建 DAG                 PERSIST: dag.json
S_CONFIRM_3    — 可视化 pipeline + 用户审批                  PERSIST: —
S_PERSIST      — 组装 JSON + 保存模板                       PERSIST: template file + index
</states>

<transitions>

S_ROUTE:
  → S_PARSE       WHEN: no flags (new design)
  → S_RESOLVE     WHEN: --resume                           DO: load draft, skip to last incomplete phase
  → S_CONFIRM_3   WHEN: --edit <path>                      DO: load template, show pipeline, ask edits

S_PARSE:
  → S_CONFIRM_1   DO: A_PARSE_INTENT

S_CONFIRM_1:
  → S_RESOLVE     WHEN: user confirms "Looks good"
  → S_PARSE       WHEN: user selects "Edit steps" or "Add step"
  → END           WHEN: user cancels                       DO: save draft

S_RESOLVE:
  → S_CONFIRM_2   DO: A_RESOLVE_NODES (read deferred: node-catalog)

S_CONFIRM_2:
  → S_ENRICH      WHEN: user confirms "Continue"
  → S_RESOLVE     WHEN: user changes executor or node type
  → S_PARSE       WHEN: user selects "Back to intent"
  → END           WHEN: user cancels                       DO: save draft

S_ENRICH:
  → S_CONFIRM_3   DO: A_BUILD_DAG

S_CONFIRM_3:
  → S_PERSIST     WHEN: user confirms "Confirm & Save"
  → S_CONFIRM_3   WHEN: user edits/adds/removes node       DO: apply change, re-render
  → S_ENRICH      WHEN: user selects "Re-run checkpoints"
  → END           WHEN: user cancels                       DO: save draft

S_PERSIST:
  → END           DO: A_SAVE_TEMPLATE (read deferred: template-schema)

</transitions>

<actions>

### A_PARSE_INTENT

1. Parse description (if empty: AskUserQuestion for workflow description)
2. Extract candidate nodes via semantic signals:

| Signal | Type hint |
|--------|-----------|
| "analyze", "review", "explore" | analysis (cli) |
| "plan", "design", "spec" | planning (skill) |
| "implement", "build", "code", "fix" | execution (skill) |
| "test", "validate", "verify" | testing (skill) |
| "then", "next", "after" | sequential edge |
| "parallel", "simultaneously" | parallel edge |

3. Extract variables (inputs that vary per run)
4. Classify: task type + complexity (simple 1-3 / medium 4-7 / complex 8+)
5. Write `intent.json` to design drafts dir
6. Display: parsed steps, variables, task type, complexity

### A_RESOLVE_NODES

Read deferred `node-catalog.md` (fallback to built-in mapping):

| Type hint | Default executor |
|-----------|-----------------|
| planning | `maestro-plan` |
| execution | `maestro-execute` |
| testing | `quality-test` |
| review | `quality-review` |
| brainstorm | `maestro-brainstorm` |
| analysis | `maestro delegate --role analyze` |
| verify | `maestro-verify` |
| refactor | `quality-refactor` |
| debug | `quality-debug` |

Build `args_template` with variable placeholders. Context injection: planning-after-analysis → `--context {prev_output_path}`, execution-after-planning → `--resume-session {prev_session_id}`.
Write `nodes.json`. Display resolved node list.

### A_BUILD_DAG

1. Build sequential edges (fan-out/fan-in for parallel groups)
2. Auto-inject checkpoints:

| Rule | Condition |
|------|-----------|
| Artifact boundary | Source outputs plan/spec/analysis/review |
| Execution gate | Target contains `execute` |
| Long-running | Target is maestro-plan, maestro-roadmap --mode full |
| Post-testing | Source contains `test` or `auto-test` |
| User-defined | type_hint == checkpoint |

3. Finalize context_schema from {variable} references
4. Validate: no cycles, no orphans, all reachable
5. Write `dag.json`
6. Display ASCII pipeline visualization

### A_SAVE_TEMPLATE

Read deferred `template-schema.md` (fallback to built-in structure).
Assemble template JSON: template_id, name, nodes, edges, checkpoints, context_schema, execution_mode.
Write to `~/.maestro/templates/workflows/<slug>.json`. Update index.json.
Display: path, ID, node count, variables, execute/edit commands. Clean up draft dir.

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E002 | 0 steps extracted | Ask user to rephrase with action verbs |
| E003 | Node count > 20 | Suggest splitting into sub-workflows |
| E005 | DAG cycle detected | Show cycle, ask user to resolve |
| E006 | Edit template not found (--edit) | Show available templates |
| W001 | Ambiguous step→executor mapping | Show candidates, let user choose |
</error_codes>

<success_criteria>
- [ ] Each phase has interactive confirmation gate
- [ ] Template JSON written with nodes, edges, checkpoints, context_schema
- [ ] Index updated; deferred specs loaded only when phase needs them
</success_criteria>
