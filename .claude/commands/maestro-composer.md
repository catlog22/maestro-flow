---
name: maestro-composer
description: Semantic workflow composer — parse natural language into DAG of skill/CLI/agent nodes, auto-inject checkpoints, persist as reusable JSON template
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
---
<purpose>
Interactive workflow template composer. Parses natural language into a reusable DAG template
via 5 phases with user confirmation at each boundary. Templates saved globally at
`~/.maestro/templates/workflows/`. Progressive disclosure — specs loaded only when phase needs them.

Three entry modes:
1. **New design**: Parse → [confirm] → Resolve → [confirm] → Enrich → Confirm pipeline → Persist
2. **Resume design**: Load in-progress draft from `.workflow/templates/design-drafts/`
3. **Edit template**: Load existing template, modify, re-save
</purpose>

<deferred_reading>
- [node-catalog](~/.maestro/templates/workflows/specs/node-catalog.md) — read at Phase 2 (Resolve) when mapping steps to executors
- [template-schema](~/.maestro/templates/workflows/specs/template-schema.md) — read at Phase 5 (Persist) when assembling final JSON
</deferred_reading>

<context>
$ARGUMENTS — natural language workflow description, or flags.

**Flags:**
- `--resume` — Resume in-progress design session
- `--edit <template-path>` — Edit an existing template

**Shared constants:**

| Constant | Value |
|----------|-------|
| Session prefix | `WFD` |
| Template dir (global) | `~/.maestro/templates/workflows/` |
| Template index (global) | `~/.maestro/templates/workflows/index.json` |
| Design drafts dir (local) | `.workflow/templates/design-drafts/` |
| Template ID format | `wft-<slug>-<YYYYMMDD>` |
| Node ID format | `N-<seq>` (e.g. N-001), `CP-<seq>` for checkpoints |
| Max nodes | 20 |

**Entry routing:**

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Resume design | `--resume` flag or existing WFD session | Phase 0: Resume |
| Edit template | `--edit <template-path>` | Phase 0: Load + Edit |
| New design | Default | Phase 1: Parse |
</context>

<execution>

### Phase 0: Resume / Edit (conditional)

**Resume design session** (if `--resume`):
1. Scan `.workflow/templates/design-drafts/WFD-*/` for in-progress designs
2. Multiple found → AskUserQuestion for selection
3. Load draft → skip to last incomplete phase

**Edit existing template** (if `--edit <path>`):
1. Load template from `--edit` path
2. Show current pipeline visualization (Phase 4 format)
3. AskUserQuestion: which nodes to modify/add/remove
4. Re-enter at Phase 3 with edits applied

---

### Phase 1: Parse — Semantic Intent Extraction

**Step 1.1** — Parse `$ARGUMENTS` as description. If empty, AskUserQuestion:
```
"Describe the workflow you want to automate.
Include: what steps to run, in what order, and what varies each time (inputs).
Example: 'analyze the code, then plan, implement, and test the feature'"
```

**Step 1.2** — Extract sequential actions as candidate nodes using semantic understanding:

| Signal | Candidate Type |
|--------|---------------|
| "analyze", "review", "explore" | analysis (cli) |
| "plan", "design", "spec" | planning (skill) |
| "implement", "build", "code", "fix" | execution (skill) |
| "test", "validate", "verify" | testing (skill) |
| "brainstorm", "ideate" | brainstorm (skill) |
| "review code" | review (skill) |
| "then", "next", "after" | sequential edge |
| "parallel", "simultaneously" | parallel edge |

**Step 1.3** — Extract variables (inputs that vary per run). Detect from: direct mentions, `{var}` patterns, implicit from task type.

**Step 1.4** — Classify task type: `bugfix | feature | tdd | review | brainstorm | spec-driven | roadmap | refactor | integration-test | quick-task | custom`

**Step 1.5** — Assess complexity: `simple` (1-3 nodes), `medium` (4-7), `complex` (8+)

**Step 1.6** — Write `intent.json` to `.workflow/templates/design-drafts/WFD-<slug>-<date>/`.

**Step 1.7 — Interactive confirmation**:

Display parsed intent summary:
```
============================================================
  COMPOSER — Intent Parsed
============================================================
  Description: "<original input>"
  Task type:   <type>
  Complexity:  <level>

  Detected steps:
    1. <description>  →  <type_hint>
    2. <description>  →  <type_hint>
    3. <description>  →  <type_hint>

  Variables:
    - goal (required): <inferred description>

  Draft: .workflow/templates/design-drafts/WFD-<slug>-<date>/
============================================================
```

AskUserQuestion:
```
options:
  - "Looks good, continue to resolution"  → Phase 2
  - "Edit steps"                           → re-describe, re-parse
  - "Add a step"                           → append, re-parse
  - "Cancel"                               → save draft, exit
```

---

### Phase 2: Resolve — Map Steps to Executor Nodes

**Read deferred**: `~/.maestro/templates/workflows/specs/node-catalog.md` — load node catalog for executor mapping.

If the spec file does not exist, use the built-in fallback mapping:

| type_hint | Default executor type | Default executor |
|-----------|----------------------|------------------|
| `planning` | skill | `maestro-plan` |
| `execution` | skill | `maestro-execute` |
| `testing` | skill | `quality-test` |
| `review` | skill | `quality-review` |
| `brainstorm` | skill | `maestro-brainstorm` |
| `analysis` | cli | `maestro delegate --role analyze --mode analysis` |
| `verify` | skill | `maestro-verify` |
| `refactor` | skill | `quality-refactor` |
| `debug` | skill | `quality-debug` |
| `spec` | skill | `maestro-roadmap --mode full` |
| `checkpoint` | checkpoint | — |

**Step 2.1** — Load `intent.json`.

**Step 2.2** — Map each step to executor. Resolution: match `type_hint` → catalog → semantic fit → fallback `cli`.

**Step 2.3** — Build `args_template` with variable placeholders. Context injection:
- Planning after analysis → `--context {prev_output_path}`
- Execution after planning → `--resume-session {prev_session_id}`
- Testing after execution → `--session {prev_session_id}`

**Step 2.4** — Assign `parallel_group` for steps with `parallel_with` set.

**Step 2.5** — Write `nodes.json`.

**Step 2.6 — Interactive confirmation**:

Display resolved nodes:
```
============================================================
  COMPOSER — Nodes Resolved
============================================================
  N-001  [skill]    maestro-plan          "{goal}"
  N-002  [skill]    maestro-execute       {phase}
  N-003  [skill]    quality-test          {phase}

  Parallel groups: none
============================================================
```

AskUserQuestion:
```
options:
  - "Continue to checkpoint injection"  → Phase 3
  - "Change executor for a node"        → select node, pick new executor
  - "Change node type"                  → skill/cli/agent/command
  - "Back to intent"                    → Phase 1
  - "Cancel"                            → save draft, exit
```

---

### Phase 3: Enrich — Inject Checkpoints + Build DAG

**Step 3.1** — Load `nodes.json`.

**Step 3.2** — Build sequential edges (N-001 → N-002 → ...). For parallel groups: fan-out/fan-in.

**Step 3.3** — Auto-inject checkpoint nodes. Inject if ANY rule triggers:

| Rule | Condition |
|------|-----------|
| Artifact boundary | Source output_ports: plan, spec, analysis, review-findings |
| Execution gate | Target executor contains `execute` |
| Agent spawn | Target type is `agent` |
| Long-running | Target is maestro-plan, maestro-roadmap --mode full |
| User-defined | Step had `type_hint: checkpoint` |
| Post-testing | Source executor contains `test` or `integration-test` |

Set `auto_continue: false` for checkpoints before user-facing deliverables.

**Step 3.4** — Insert checkpoint edges (A → B becomes A → CP-X → B).

**Step 3.5** — Finalize `context_schema` from all `{variable}` references.

**Step 3.6** — Validate: no cycles, no orphans, all nodes reachable.

**Step 3.7** — Write `dag.json`.

→ Proceed directly to Phase 4 (confirm is the pipeline visualization).

---

### Phase 4: Confirm — Visualize + User Approval

**Step 4.1** — Render ASCII pipeline from `dag.json`:
```
============================================================
  COMPOSER — Pipeline Review
============================================================
Pipeline: <template-name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 N-001  [skill]       maestro-plan              "{goal}"
   |
 CP-01  [checkpoint]  After Plan                auto-continue
   |
 N-002  [skill]       maestro-execute           {phase}
   |
 CP-02  [checkpoint]  Before Tests              pause-for-user
   |
 N-003  [skill]       quality-test              {phase}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Variables (required):  goal
Checkpoints:           2  (1 auto, 1 pause)
Nodes:                 3 work + 2 checkpoints
============================================================
```

For parallel groups show fan-out/fan-in:
```
 N-003a [skill]  quality-review  ─┐
                                   ├─ N-004 [skill] quality-test
 N-003b [cli]    gemini analysis  ─┘
```

**Step 4.2** — AskUserQuestion:
```
options:
  - "Confirm & Save"                    → Phase 5
  - "Edit a node"                       → select node ID, modify executor/args, re-render
  - "Add a node"                        → insert position + description, re-resolve + re-enrich, re-render
  - "Remove a node"                     → select node, re-wire edges, re-render
  - "Rename template"                   → new name
  - "Re-run checkpoint injection"       → back to Phase 3.3
  - "Cancel"                            → save draft, output resume command
```

**Step 4.3** — On edit: apply change, re-render, re-ask. Loop until Confirm or Cancel.

**Step 4.4** — On Confirm: freeze dag.json, proceed to Phase 5. On Cancel: save draft, output `/maestro-composer --resume`.

---

### Phase 5: Persist — Assemble + Save Template

**Read deferred**: `~/.maestro/templates/workflows/specs/template-schema.md` — load full JSON schema for template assembly.

If the spec file does not exist, use the built-in template structure:
```json
{
  "template_id": "wft-<slug>-<YYYYMMDD>",
  "name": "<name>", "description": "<desc>", "version": "1.0",
  "created_at": "<ISO>", "source_session": "WFD-<slug>-<date>",
  "tags": [], "context_schema": {},
  "nodes": [], "edges": [], "checkpoints": [],
  "execution_mode": "serial",
  "metadata": { "node_count": 0, "checkpoint_count": 0 }
}
```

**Step 5.1** — Load `intent.json` + `dag.json`.

**Step 5.2** — Determine template name (from Phase 4 or derive from task_type + description). Slug = kebab-case. If file exists with different content, append `-v2`, `-v3`.

**Step 5.3** — Assemble template JSON.

**Step 5.4** — Ensure `~/.maestro/templates/workflows/` exists. Write `<slug>.json`.

**Step 5.5** — Update `~/.maestro/templates/workflows/index.json`.

**Step 5.6** — Output summary:
```
============================================================
  COMPOSER — Template Saved
============================================================
  Path:      ~/.maestro/templates/workflows/<slug>.json
  ID:        wft-<slug>-<date>
  Nodes:     <n> work + <n> checkpoints
  Variables: <required vars>

  To execute:
    /maestro-player <slug> --context goal="<your goal>"

  To edit later:
    /maestro-composer --edit ~/.maestro/templates/workflows/<slug>.json

  To list all templates:
    /maestro-player --list
============================================================
```

**Step 5.7** — Clean up design draft directory.
</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Empty description and no flags | AskUserQuestion for workflow description |
| E002 | error | Step extraction found 0 steps | Ask user to rephrase with action verbs |
| E003 | error | Node count exceeds max (20) | Suggest splitting into sub-workflows |
| E004 | error | DAG cycle detected | Show cycle, ask user to resolve |
| E005 | error | Resume session not found | Show available design drafts |
| E006 | error | Edit template not found | Show available templates |
| W001 | warning | Ambiguous step-to-executor mapping | Show candidates, let user choose |
| W002 | warning | No checkpoint injection rules triggered | Warn user, offer to add manually |
| W003 | warning | Deferred spec file not found | Use built-in fallback, continue |
</error_codes>

<success_criteria>
- [ ] Intent parsed and confirmed by user (Phase 1 interactive gate)
- [ ] Nodes resolved and confirmed by user (Phase 2 interactive gate)
- [ ] DAG built with auto-injected checkpoints
- [ ] Pipeline visualized and confirmed by user (Phase 4 interactive gate)
- [ ] Template JSON written to `~/.maestro/templates/workflows/<slug>.json`
- [ ] Template index updated at `~/.maestro/templates/workflows/index.json`
- [ ] Deferred specs loaded only when phase needs them (not upfront)
</success_criteria>
