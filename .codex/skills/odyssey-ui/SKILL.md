---
name: odyssey-ui
description: Long-running UI optimization cycle — visual survey,
  multi-dimensional audit, divergent exploration, fix, verify, generalize,
  discover, and design knowledge persistence
argument-hint: '"<target>" [--dimensions <list>] [--skip-fix]
  [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]'
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.50
---

<base>@~/.maestro/workflows/odyssey-base-codex.md</base>

<required_reading>
Required reading: base (`odyssey-base-codex.md`) before any actions. Load and apply base invariants, execution discipline, and shared actions before proceeding.
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
survey -> 6-dimension audit -> divergent creative exploration ->
fix -> verify -> generalize -> discover -> persist.
Exhaustive iteration until all findings addressed or deferred.
</purpose>

<boundary>
**In scope:** Target component/page visual experience optimization -- audit 6 dimensions -> divergent exploration -> fix -> generalize to sibling components.
**Out of scope:** Backend logic / data model / API design -> `$odyssey-planex` | Deep bug investigation -> `$odyssey-debug` | Code quality review -> `$odyssey-review-test-fix`

**Exploration freedom:** Maximum freedom within boundary -- S_DIVERGE encourages divergent thinking with no creative ceiling. Audit + diverge may discover any visual/interaction/accessibility detail.
**Zero-residual:** Every finding/idea MUST have a concrete action (fix / issue / decision). "Pre-existing design debt" is not a valid skip reason.

**Decision gate** -- ONLY these qualify as decisions (not fixes):
- Brand/style direction requiring human creative judgment
- Layout restructuring that changes user flow significantly
- Requires new design tokens or breaking component API
</boundary>

<context>
$ARGUMENTS

**Target resolution:** Component path -> audit component | Page/route -> audit page | `staged`/`HEAD` -> diff UI changes | Feature area -> resolve to components/pages

**Flags:** `--dimensions <list>` subset of 6 dims | `--fix-threshold <severity>` | `--skip-fix` audit+diverge only | `--skip-generalize` skip S_GENERALIZE+S_DISCOVER | `--auto` no delegate confirmation | `-y` auto-confirm | `-c` resume | `--heartbeat` /loop heartbeat

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md`

**Output boundary**: ALL session artifacts MUST target the session directory (`{run_dir}/outputs/`) or `.workflow/state.json` only. Source code modifications during S_FIX are in-scope but MUST be committed per action. NEVER write session artifacts outside these paths.

**session.json -- ui-specific fields:**
```json
{ "target": "", "dimensions": [], "audit_result": null, "diverge_result": null,
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

**evidence.ndjson phases:** `survey|audit|diverge|fix|discovery|decision|self-iteration`

**phase_goals[]:**

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | -- |
| G2 | Audit completed | S_AUDIT | -- |
| G3 | Divergent exploration done | S_DIVERGE | -- |
| G4 | Zero remaining: all findings/ideas fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | -- |

**understanding.md -- 8 sections:**
1. Target & Design Context <- S_INTAKE | 2. Survey <- S_SURVEY | 3. Audit <- S_AUDIT | 4. Diverge <- S_DIVERGE
5. Verify <- S_VERIFY | 6. Generalize <- S_GENERALIZE | 7. Discover <- S_DISCOVER | 8. Learnings <- S_RECORD

**Knowledge Persistence (S_RECORD writes understanding.md section 8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Design pattern | Component pattern + applicable scenarios + token references | `/spec-add ui "..."` |
| Interaction spec | State definitions + transition rules + feedback patterns | `/spec-add ui "..."` |
| Accessibility rules | WCAG requirements + implementation approach | `/spec-add ui "..."` |
| Reusable generalization pattern | Pattern signature + application scope | `/spec-add coding "..."` |
</context>

<csv_schema>

### Shared Output Schema (all waves)
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings": { "type": "string", "maxLength": 500 },
    "evidence": { "type": "string" },
    "error": { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination contract:** Call `report_agent_job_result` EXACTLY ONCE. Read-only. Do NOT modify source files, tasks.csv, wave-*.csv, results.csv, or call spawn_agents_on_csv.

### tasks.csv
```csv
id,title,description,task_type,dimension,deps,wave,status,findings,evidence,error
```

**Waves:**
| Wave | Tasks | Parallelism |
|------|-------|-------------|
| 1 | Survey (design-tokens-audit, pattern-inventory) | 2 agents |
| 2 | Audit (visual-hierarchy, interaction-states, accessibility, responsiveness, micro-interactions, edge-cases) | 6 agents |
| 3 | Diverge (polish-agent, delight-agent) | 2 agents |
| 4 | Generalization (syntax-grep, semantic-scan, structural-match, historical-grep) | 4 agents |
</csv_schema>

<invariants>
1-5: See base (evidence append-only, session is state, phase goal tracking, auto-commit, zero silent drops).
6. **Browser is truth** -- verify in real rendering, not just code review
7. **Diverge before converge** -- explore creatively first, then implement methodically
</invariants>

<self_iteration>
Applies to: **S_SURVEY, S_AUDIT, S_DIVERGE, S_GENERALIZE**. Logic in base.
</self_iteration>

<execution>
Follow base execution discipline completely. Actions defined in state_machine below.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: INTAKE → SURVEY**
- REQUIRED: Target resolved, SESSION_DIR created, session.json initialized.
- REQUIRED: phase_goals[] derived from flags, understanding.md §1 written.
- BLOCKED if: no target specified (E001) or target path not found (E002).

**GATE 2: SURVEY → AUDIT**
- REQUIRED: Design system inventory + current state analysis completed.
- REQUIRED: Evidence phase=survey logged, understanding.md §2 updated, G1 marked done.
- BLOCKED if: survey incomplete — token scan and styling analysis must both be attempted.

**GATE 3: AUDIT → DIVERGE**
- REQUIRED: All 6 dimension agents completed (or --dimensions subset), findings merged with severity classification.
- REQUIRED: audit_result written to session.json, understanding.md §3 with severity matrix, G2 marked done.
- BLOCKED if: zero dimensions reviewed (W002 partial is allowed, zero is not).

**GATE 4: DIVERGE → FIX**
- REQUIRED: Both parallel agents (Polish + Delight) completed, ideas consolidated with audit findings.
- REQUIRED: diverge_result written, understanding.md §4 updated, G3 marked done.
- BLOCKED if: divergent exploration not attempted.

**GATE 5: FIX → VERIFY**
- REQUIRED: ALL findings/ideas within fix_threshold fixed by priority tier.
- REQUIRED: Per-fix evidence phase=fix logged.
- BLOCKED if: tier incomplete — each tier must be fully addressed before advancing.

**GATE 6: VERIFY → GENERALIZE**
- REQUIRED: Tests pass (lint, unit, visual regression), delegate verification completed.
- REQUIRED: confirmation written, understanding.md §5 updated, G4 marked done.
- BLOCKED if: needs_rework → route back to S_FIX.

**GATE 7: GENERALIZE → DISCOVER**
- REQUIRED: ALL 3 layers (syntax/semantic/structural) attempted with evidence logged.
- REQUIRED: generalization_stats written with by_layer entries for all 3 layers, G5 marked done.
- BLOCKED if: any layer not attempted (thoroughness floor violation).

**GATE 8: DISCOVER → RECORD**
- REQUIRED: All hits triaged with per-item classification and reason.
- REQUIRED: remaining_actionable == 0 OR loops >= max_loops with per-item reasons logged, G6 marked done.
- BLOCKED if: unclassified hits remain.

</execution>

<state_machine>

<states>
S_INTAKE -> S_SURVEY -> S_AUDIT -> S_DIVERGE -> S_FIX -> S_VERIFY -> S_GENERALIZE -> S_DISCOVER -> S_RECORD -> END
</states>

<transitions>
S_INTAKE -> S_INTAKE       : -c + session found -> A_RESUME
S_INTAKE -> S_SURVEY       : target resolved -> A_INTAKE
S_INTAKE -> S_INTAKE       : no target -> request_user_input

S_SURVEY  -> S_AUDIT       : complete
S_AUDIT   -> S_DIVERGE     : complete

S_DIVERGE -> S_FIX          : !skip_fix AND actionable findings/ideas
S_DIVERGE -> S_GENERALIZE   : (skip_fix OR no actionable) AND !skip_gen
S_DIVERGE -> S_RECORD       : (skip_fix OR no actionable) AND skip_gen

S_FIX     -> S_VERIFY       : fix implemented
S_VERIFY  -> S_GENERALIZE   : verified AND !skip_gen
S_VERIFY  -> S_RECORD       : verified AND skip_gen
S_VERIFY  -> S_FIX          : needs_rework

S_GENERALIZE -> S_DISCOVER  : hits found
S_GENERALIZE -> S_RECORD    : no hits

S_DISCOVER -> S_AUDIT       : new component to audit -> cross_phase_loops++
S_DISCOVER -> S_FIX         : fixable sibling, !skip_fix -> cross_phase_loops++
S_DISCOVER -> S_RECORD      : remaining_actionable == 0 OR loops >= max_loops (log per-item reasons)

S_RECORD   -> END           : complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: target, flags, `--dimensions` subset
2. Generate slug, create SESSION_DIR
3. `maestro search` + Glob prior sessions + ARCHITECTURE.md + spec load ui/coding
4. Derive `phase_goals[]` from flags (apply `skip_when`)
5. Write `session.json` + `understanding.md` section 1, call `create_goal` with phase_goals as success_criteria

Commit: `"odyssey-ui({slug}): INTAKE -- target parsed"`

### A_RESUME
Glob latest session -> read `session.json` -> jump to `current_state`.

### A_SURVEY
**spawn_agents_on_csv (Wave 1):**

Write `tasks.csv` with Wave 1 rows:
```csv
"survey-tokens","Design Token Audit","Scan {target_files} for CSS variables, design tokens, theme values. Return [{token,usage_count,consistency,file,line}].","survey","","","1","pending","","",""
"survey-patterns","Pattern Inventory","Catalog component patterns, layout, spacing, typography in {target_files}. Return [{pattern,files,consistency}].","survey","","","1","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-1-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge -> evidence (phase: "survey"). Update section 2. Mark G1 done.
Commit: `"odyssey-ui({slug}): SURVEY -- visual landscape"`

### A_AUDIT
**spawn_agents_on_csv (Wave 2)** -- 6 agents (one per dimension, or `--dimensions` subset):

Append Wave 2 rows to `tasks.csv`:
```csv
"audit-hierarchy","Visual Hierarchy","Spacing, typography scale, contrast, alignment, whitespace, visual weight","audit","visual-hierarchy","","2","pending","","",""
"audit-interaction","Interaction States","hover/focus/active/disabled/loading/error/empty/selected states","audit","interaction-states","","2","pending","","",""
"audit-a11y","Accessibility","WCAG AA contrast, focus mgmt, aria, keyboard nav, screen reader","audit","accessibility","","2","pending","","",""
"audit-responsive","Responsiveness","Breakpoints, overflow, touch targets >=44px, fluid typography","audit","responsiveness","","2","pending","","",""
"audit-motion","Micro-interactions","Transitions, animations, feedback, loading states, scroll behavior","audit","micro-interactions","","2","pending","","",""
"audit-edge","Edge Cases","Long text, empty data, error states, extreme values, i18n, RTL","audit","edge-cases","","2","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:6, max_runtime_seconds:600, output_csv_path:"wave-2-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Each returns `[{title, severity, file, line, description, suggestion, dimension}]`.
Merge -> evidence (phase: "audit"). Write `audit_result` with dimensions, finding count, severity distribution. Update section 3 (severity matrix). Mark G2 done.
Commit: `"odyssey-ui({slug}): AUDIT -- 6-dimension review"`

### A_DIVERGE
**spawn_agents_on_csv (Wave 3)** -- 2 agents:

Append Wave 3 rows to `tasks.csv`:
```csv
"diverge-polish","Polish Agent","Missing subtle details: shadows, borders, transitions, hover feedback, empty states, skeleton loading, scroll behavior. Return [{idea,category:'polish',impact,effort,description}].","diverge","","","3","pending","","",""
"diverge-delight","Delight Agent","What makes this memorable: motion design, progressive disclosure, smart defaults, celebratory feedback, personality. Return [{idea,category:'delight',impact,effort,description}].","diverge","","","3","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-3-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

**Optional CLI delegate** for creative review:
```bash
maestro delegate "PURPOSE: Creative UI review for: {target}
TASK: Identify polish opportunities | Suggest delight moments | Evaluate visual rhythm
MODE: analysis  CONTEXT: @{target_files} | Survey: {token_summary} | Audit: {top_findings}
EXPECTED: JSON [{idea, category, impact, effort, description}]
CONSTRAINTS: User-perceptible improvements only
" --to claude --mode analysis
```
Execute with `run_in_background: true`, then wait for callback.

Consolidate: audit findings + divergent ideas -> prioritized improvement list (impact/effort matrix). Write `diverge_result`. Append evidence (phase: "diverge"). Update section 4. Mark G3 done.
Commit: `"odyssey-ui({slug}): DIVERGE -- creative exploration"`

### A_FIX
Skip if `--skip-fix`.
1. **Exhaustive fix**: ALL findings/ideas by priority tier (critical->high->medium->low + high-impact ideas). After each tier, re-review -- new findings append.
2. Each fix -> evidence (phase: "fix")
3. Normal: request_user_input per-fix. `-y`: auto-proceed, record `deferred`.

Commit: `"odyssey-ui({slug}): FIX -- improvements applied"`

### A_VERIFY
1. Run tests (lint, unit, visual regression)
2. CLI-assisted: `maestro delegate --to claude --mode analysis` -- visual correctness, interaction states, accessibility, responsive
3. `needs_rework` -> S_FIX. `verified` -> mark G4 done. Update section 5, write `confirmation`.

Commit: `"odyssey-ui({slug}): VERIFY -- visual verification"`

### A_GENERALIZE
Skip if `--skip-generalize`. Pattern source: audit findings + diverge ideas (severity >= medium OR impact = high).

**Wave 4 -- 4-agent scan (spawn_agents_on_csv):**

Append Wave 4 rows to `tasks.csv`:
```csv
"gen-syntax","Syntax Grep","Grep CSS/style patterns matching '${signatures}' across project","generalization","syntax","","4","pending","","",""
"gen-semantic","Semantic Scan","Find components with same interaction pattern but missing states","generalization","semantic","","4","pending","","",""
"gen-structural","Structural Match","Find structurally similar components, check for same issues","generalization","structural","","4","pending","","",""
"gen-historical","Historical Grep","git log -S '${signature}' for UI pattern history","generalization","historical","","4","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:4, max_runtime_seconds:600, output_csv_path:"wave-4-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Cross-layer dedup + iterative deepening per base. Update section 6. Mark G5 done.
Commit: `"odyssey-ui({slug}): GENERALIZE -- pattern scan"`

### A_DISCOVER, A_RECORD
Base shared_actions. UI overrides:
- **A_DISCOVER** routing per base triage logic
- **A_RECORD** learnings per Knowledge Persistence table. **Confirmation gate**: Before writing spec entries, present proposed entries to user via `request_user_input` for confirmation. Skip confirmation only if `-y` flag is set.

**Completion summary:**
```
--- UI ODYSSEY COMPLETE ---
Target:     {target} | Dimensions: {dimensions_audited}
Findings:   {C}C {H}H {M}M {L}L | Diverge: {improvements} polish + {creative} delight
Fix:        {fixed_count} applied, verified={yes|skipped}
Patterns:   {extracted} ({by_layer})
Scan hits:  {total} ({cross_layer} cross-layer)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} entries
Self-iter:  {N} rounds
Goals:      {done}/{total} ({skipped} skipped)
---
```

</actions>

<appendix>

### `-y` ui-specific points

| Decision Point | Normal | `-y` |
|----------------|--------|------|
| A_FIX improvement confirmation | request_user_input | auto-proceed, `deferred` |

### Goal convergence rules

```
Exhaustive iteration: process all audit + diverge findings (fix/issue/decision)
until phase_goals_all_done=true. Fix by impact x severity per tier.
Re-review modified areas after each fix round -- new findings appended.
phase=decision pending items MUST request_user_input. No report-only items.
```

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target |
| E002 | error | Target path not found | Check path |
| W001 | warning | No design system detected | Proceed with defaults |
| W002 | warning | Some dimension agents failed | Partial coverage |
</error_codes>

<success_criteria>
- [ ] 6-dimension audit with severity matrix + divergent exploration (polish + delight)
- [ ] Improvements implemented and verified (unless --skip-fix)
- [ ] Multi-layer generalization + discoveries classified (unless --skip-generalize)
- [ ] Every unfixed finding has individual classification and reason
- [ ] understanding.md section 8 finalized; phase_goals G1-G7 tracked; `-y` no blocking prompts
</success_criteria>

<next_step_routing>
<!-- suggest-only — do NOT auto-execute. Present these as suggestions to the user. -->
| Condition | Next |
|-----------|------|
| Finding needs deeper debug | `$odyssey-debug "<finding>"` |
| Issues created from discoveries | `/manage-issue list --source ui-odyssey` |
| Design pattern worth documenting | `/spec-add ui "..."` |
| Full review of changes | `$odyssey-review-test-fix <changed-files>` |
| Sibling components to polish | `$odyssey-ui "<sibling>"` |
</next_step_routing>
