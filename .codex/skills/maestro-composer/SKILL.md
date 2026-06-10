---
name: maestro-composer
description: Compose reusable workflow templates from natural language
argument-hint: "\"workflow description\" [--resume] [--edit <template-path>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Interactive workflow template composer. Parses natural language into a reusable DAG template
via 5 phases with user confirmation at each boundary. Templates saved globally at
`~/.maestro/templates/workflows/`. Progressive disclosure — specs loaded only when phase needs them.

Sequential interactive flow (no spawn_agents_on_csv — this is design, not execution):
```
Parse NL → [confirm] → Resolve to nodes → [confirm] → Inject checkpoints → Confirm pipeline → Persist
```

Three entry modes:
1. **New design**: Phase 1-5
2. **Resume design**: Load draft from `.workflow/templates/design-drafts/`
3. **Edit template**: Load existing, modify, re-save
</purpose>

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
| Resume | `--resume` or existing WFD session | Phase 0: Resume |
| Edit | `--edit <path>` | Phase 0: Load + Edit |
| New | Default | Phase 1: Parse |

**Node catalog**: Read `~/.maestro/templates/workflows/specs/node-catalog.md` at Phase 2 (deferred).
**Template schema**: Read `~/.maestro/templates/workflows/specs/template-schema.md` at Phase 5 (deferred).

### Pre-load specs
1. **Architecture specs**: Run `maestro spec load --category arch` to load architecture constraints. Use as context for node resolution — ensures workflow design respects documented patterns.
2. **Coding specs**: Run `maestro spec load --category coding` to load coding conventions. Informs executor argument defaults and context injection.
3. Optional — proceed without if unavailable.
</context>

<execution>

### Phase 0: Resume / Edit (conditional)

**Resume** (`--resume`):
1. Scan `.workflow/templates/design-drafts/WFD-*/` for in-progress designs
2. Multiple → AskUserQuestion for selection
3. Load draft → skip to last incomplete phase

**Edit** (`--edit <path>`):
1. Load template JSON
2. Show pipeline visualization (Phase 4 format)
3. AskUserQuestion: which nodes to modify/add/remove
4. Re-enter at Phase 3

---

### Phase 1: Parse — Semantic Intent Extraction

**Step 1.1** — Parse `$ARGUMENTS`. If empty, AskUserQuestion:
```
"Describe the workflow you want to automate.
Include: what steps to run, in what order, and what varies each time.
Example: 'analyze the code, then plan, implement, and test the feature'"
```

**Step 1.2** — Extract sequential actions as candidate nodes:

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

**Step 1.3** — Extract variables (inputs that vary per run).

**Step 1.4** — Classify task type: `bugfix | feature | tdd | review | brainstorm | spec-driven | roadmap | refactor | integration-test | quick-task | custom`

**Step 1.5** — Assess complexity: `simple` (1-3 nodes), `medium` (4-7), `complex` (8+)

**Step 1.6** — Write `intent.json` to `.workflow/templates/design-drafts/WFD-<slug>-<date>/`.

**Step 1.7 — Interactive confirmation**: Display description, task type, complexity, detected steps (numbered with type_hint), and variables. AskUserQuestion: `Continue to resolution` / `Edit steps` / `Add a step` / `Cancel`

---

### Phase 2: Resolve — Map Steps to Executor Nodes

**Read deferred**: `~/.maestro/templates/workflows/specs/node-catalog.md`

If spec not found, use built-in fallback:

| type_hint | executor type | executor |
|-----------|--------------|----------|
| `planning` | skill | `maestro-plan` |
| `execution` | skill | `maestro-execute` |
| `testing` | skill | `quality-test` |
| `review` | skill | `quality-review` |
| `brainstorm` | skill | `maestro-brainstorm` |
| `analysis` | cli | `maestro delegate --role analyze --mode analysis` |
| `refactor` | skill | `quality-refactor` |
| `debug` | skill | `quality-debug` |
| `spec` | skill | `maestro-blueprint` |
| `checkpoint` | checkpoint | — |

**Step 2.1** — Load `intent.json`, map each step to executor.

**Step 2.2** — Build `args_template` with variable placeholders and context injection:
- Planning after analysis → `--context {prev_output_path}`
- Execution after planning → inherit phase
- Testing after execution → inherit phase

**Step 2.3** — Assign `parallel_group` for parallel steps.

**Step 2.4** — Write `nodes.json`.

**Step 2.5 — Interactive confirmation**: Display resolved nodes table (ID, type, executor, args) and parallel groups. AskUserQuestion: `Continue to checkpoint injection` / `Change executor` / `Change node type` / `Back to intent` / `Cancel`

---

### Phase 3: Enrich — Inject Checkpoints + Build DAG

**Step 3.1** — Load `nodes.json`. Build sequential edges. For parallel groups: fan-out/fan-in.

**Step 3.2** — Auto-inject checkpoint nodes:

| Rule | Condition |
|------|-----------|
| Artifact boundary | Source output_ports: plan, spec, analysis, review-findings |
| Execution gate | Target executor contains `execute` |
| Agent spawn | Target type is `agent` |
| Long-running | Target is maestro-plan, maestro-roadmap |
| User-defined | Step had `type_hint: checkpoint` |
| Post-testing | Source executor contains `test` or `integration-test` |

Set `auto_continue: false` for checkpoints before user-facing deliverables.

**Step 3.3** — Finalize `context_schema`, validate DAG (no cycles, no orphans).

**Step 3.4** — Write `dag.json`. → Proceed to Phase 4.

---

### Phase 4: Confirm — Visualize + User Approval

**Step 4.1** — Render ASCII pipeline: vertical node chain with `|` connectors showing each node (ID, type, executor, args) and checkpoint nodes (auto-continue vs pause-for-user). Footer: required variables, checkpoint counts, node counts.

**Step 4.2** — AskUserQuestion: `Confirm & Save` / `Edit a node` / `Add a node` / `Remove a node` / `Rename template` / `Re-run checkpoint injection` / `Cancel`

**Step 4.3** — Loop edits until Confirm or Cancel.

---

### Phase 5: Persist — Assemble + Save Template

**Read deferred**: `~/.maestro/templates/workflows/specs/template-schema.md`

**Step 5.1** — Load `intent.json` + `dag.json`. Assemble template JSON.

**Step 5.2** — Determine slug (kebab-case). If exists, append `-v2`.

**Step 5.3** — Write `~/.maestro/templates/workflows/<slug>.json`.

**Step 5.4** — Update `~/.maestro/templates/workflows/index.json`.

**Step 5.5** — Output summary: path, template ID, node/checkpoint counts, required variables. Include usage commands: `$maestro-player <slug> --context goal="..."`, `$maestro-composer --edit <path>`, `$maestro-player --list`.

**Step 5.6** — Clean up design draft directory.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Empty description and no flags | AskUserQuestion for description |
| E002 | error | 0 steps extracted | Ask to rephrase with action verbs |
| E003 | error | Node count exceeds 20 | Suggest splitting into sub-workflows |
| E004 | error | DAG cycle detected | Show cycle, ask to resolve |
| E005 | error | Resume session not found | Show available drafts |
| E006 | error | Edit template not found | Show available templates |
| W001 | warning | Ambiguous executor mapping | Show candidates, let user choose |
| W002 | warning | No checkpoint rules triggered | Warn, offer manual add |
| W003 | warning | Deferred spec not found | Use built-in fallback |
</error_codes>

<success_criteria>
- [ ] Intent parsed and confirmed by user (Phase 1 gate)
- [ ] Nodes resolved and confirmed by user (Phase 2 gate)
- [ ] DAG built with auto-injected checkpoints
- [ ] Pipeline visualized and confirmed by user (Phase 4 gate)
- [ ] Template JSON written to `~/.maestro/templates/workflows/<slug>.json`
- [ ] Template index updated
- [ ] Deferred specs loaded only when phase needs them
</success_criteria>
