---
name: odyssey-ui
description: Long-running UI optimization cycle — visual survey, multi-dimensional audit, divergent exploration, fix, verify, generalize, and design knowledge persistence
argument-hint: "<target> [--dimensions <list>] [--fix-threshold <severity>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
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
<base>@~/.maestro/workflows/odyssey-base.md</base>

<purpose>
survey → 6-dimension audit → divergent exploration → fix → verify → generalize → discover → persist.
Exhaustive iteration until all findings addressed or deferred.
</purpose>

<boundary>
**In scope:** Target component/page visual experience optimization — audit 6 dimensions, divergent exploration, fix, generalize to sibling components.
**Out of scope:** Backend/data/API → `/odyssey-planex` | Deep bug investigation → `/odyssey-debug` | Code quality review → `/odyssey-review-test-fix`

**Decision gate** — ONLY these qualify as decisions:
  - Brand/style direction requiring human creative judgment
  - Layout restructuring that changes user flow significantly
  - Requires new design tokens or breaking component API
</boundary>

<context>
$ARGUMENTS

**Target resolution:** Component path → audit component | Page/route → audit page | `staged`/`HEAD` → diff UI changes | Feature area → resolve to components/pages

**Flags:** `--dimensions <list>` dimension subset | `--fix-threshold <severity>` | `--skip-fix` audit+diverge only | `--skip-generalize` skip generalize+discover | `--auto` no delegate confirmation | `-y` auto-confirm | `-c` resume | `--heartbeat` /loop heartbeat

**Session**: `.workflow/scratch/{YYYYMMDD}-ui-odyssey-{slug}/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md`

**session.json — ui-specific fields:**
```json
{ "target": "", "dimensions": [],
  "audit_result": { "dimensions_audited": 0, "finding_count": 0, "severity_distribution": {} },
  "diverge_result": { "improvements_proposed": 0, "creative_ideas": 0 },
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

**evidence.ndjson phases:** `survey|audit|diverge|fix|discovery|decision|self-iteration`

**phase_goals[]:**

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Divergent exploration done | S_DIVERGE | — |
| G4 | Zero remaining: all findings/ideas fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

**understanding.md — 8 sections:**
1. Target & Design Context ← S_INTAKE | 2. Survey ← S_SURVEY | 3. Audit ← S_AUDIT
4. Diverge ← S_DIVERGE | 5. Verify ← S_VERIFY | 6. Generalize ← S_GENERALIZE
7. Discover ← S_DISCOVER | 8. Learnings ← S_RECORD

**Knowledge Persistence categories (section 8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Design pattern | Component pattern + applicable scenarios + token references | `/spec-add ui` |
| Interaction spec | State definitions + transition rules + feedback patterns | `/spec-add ui` |
| Accessibility rule | WCAG requirement + implementation approach | `/spec-add ui` |
| Reusable generalization pattern | Pattern signature + application scope | `/spec-add coding` |
</context>

<invariants>
1-5 in base. UI-specific:
6. **Browser is truth** — verify in real rendering, not just code review
7. **Diverge before converge** — explore creatively first, then implement methodically
8. **Generalize is mandatory** — S_GENERALIZE and S_DISCOVER execute unless `skip_generalize == true`. "All verified" or context pressure are NOT valid reasons to skip. The phase itself determines whether patterns exist.
</invariants>

<self_iteration>
Applies to: **S_SURVEY, S_AUDIT, S_DIVERGE, S_GENERALIZE**. Logic in base.
</self_iteration>

<state_machine>

<states>
S_INTAKE → S_SURVEY → S_AUDIT → S_DIVERGE → S_FIX → S_VERIFY → S_GENERALIZE → S_DISCOVER → S_RECORD → END
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → A_RESUME
S_INTAKE → S_SURVEY       : target resolved → A_INTAKE
S_INTAKE → S_INTAKE       : no target → AskUserQuestion

S_SURVEY  → S_AUDIT       : complete
S_AUDIT   → S_DIVERGE     : complete

S_DIVERGE → S_FIX         : !skip_fix AND actionable findings/ideas
S_DIVERGE → S_GENERALIZE  : (skip_fix OR no actionable) AND !skip_generalize
S_DIVERGE → S_RECORD      : (skip_fix OR no actionable) AND skip_generalize

S_FIX     → S_VERIFY      : fix implemented
S_VERIFY  → S_GENERALIZE  : verified, !skip_generalize
S_VERIFY  → S_RECORD      : verified, skip_generalize
S_VERIFY  → S_FIX         : needs_rework

S_GENERALIZE → S_DISCOVER : similar code found
S_GENERALIZE → S_RECORD   : all 3 layers scanned with evidence, total_hits == 0

S_DISCOVER → S_AUDIT      : new component to audit → cross_phase_loops++
S_DISCOVER → S_FIX        : fixable sibling, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD     : remaining_actionable == 0 OR loops >= max_loops → log per-item reasons

S_RECORD   → END          : complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: target, flags, `--dimensions` subset
2. Generate slug, create SESSION_DIR
3. `maestro search` + Glob prior sessions + ARCHITECTURE.md + spec load ui/coding
4. Derive `phase_goals[]` from flags
5. Write `session.json` + `understanding.md` section 1, emit Goal Prompt

Commit: `"odyssey-ui({slug}): INTAKE — parse target and load context"`

### A_RESUME
Glob latest session → read `session.json` → jump to `current_state`.

### A_SURVEY
1. **Design system inventory**: Scan for design tokens, CSS variables, theme imports
2. **Current state analysis**: Styling patterns, layout strategy, component hierarchy
3. **CLI-assisted**: `maestro delegate --role analyze --mode analysis` — survey tokens, spacing, typography, hierarchy, consistency
4. Append evidence phase=survey. Update section 2. Mark G1.

Commit: `"odyssey-ui({slug}): SURVEY — design token inventory"`

### A_AUDIT
Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset):

| Dimension | Focus |
|-----------|-------|
| visual_hierarchy | Spacing, typography scale, color contrast, alignment, whitespace, visual weight |
| interaction_states | Hover, focus, active, disabled, loading, error, empty, selected states |
| accessibility | WCAG AA contrast, focus management, aria labels, keyboard nav, screen reader |
| responsiveness | Breakpoints, overflow, touch targets, fluid typography, container queries |
| micro_interactions | Transitions, animations, feedback indicators, loading states, progress |
| edge_cases | Long text truncation, empty data, error states, extreme values, i18n, RTL |

Each returns `[{title, severity, file, line, description, suggestion, dimension}]`.
Merge → evidence phase=audit. Write `audit_result`. Update section 3 with severity matrix. Mark G2.

Commit: `"odyssey-ui({slug}): AUDIT — 6-dimension review"`

### A_DIVERGE
Goes beyond defect fixing — "what would make this delightful?"

**Step 1 — 2 parallel Agents:**
- **Polish Agent**: Shadows, borders, transitions, hover states, feedback, empty states, skeleton loading, scroll behavior
- **Delight Agent**: Motion design, progressive disclosure, smart defaults, contextual hints, celebratory feedback, personality in copy

Each returns `[{idea, category (polish|delight), impact, effort, description, inspiration}]`

**Step 2 — CLI-assisted**: `maestro delegate --role analyze --mode analysis` — polish opportunities, micro-interactions, visual rhythm, delight moments

**Step 3 — Consolidate**: Merge audit findings + divergent ideas → prioritized list (severity x impact x effort).
Append evidence phase=diverge. Update section 4. Mark G3.

Commit: `"odyssey-ui({slug}): DIVERGE — creative exploration"`

### A_FIX
Skip if `--skip-fix`.
1. **Exhaustive fix**: ALL findings/ideas by priority tier (critical → high → medium → low + high-impact ideas). After each tier, re-review — new findings append.
2. Each fix → evidence phase=fix
3. Normal: AskUserQuestion per-fix | `-y`: auto-proceed, record `deferred`

Commit: `"odyssey-ui({slug}): FIX — implement improvements"`

### A_VERIFY
1. Run tests (lint, unit, visual regression)
2. `maestro delegate --role review --mode analysis` — visual correctness, interaction states, accessibility, responsive
3. `needs_rework` → S_FIX. `verified` → mark G4. Update section 5, write `confirmation`.

Commit: `"odyssey-ui({slug}): VERIFY — visual verification"`

### A_GENERALIZE

**MANDATORY — executes unless `skip_generalize == true`. Prior-phase convergence, "all verified," or context pressure are NOT valid skip reasons.**

Pattern source: audit findings + diverge ideas (severity >= medium OR impact = high).

**Step 1 — 3-layer pattern extraction** from UI findings and creative improvements:

| Layer | Method | Targets |
|-------|--------|---------|
| Syntax | Build regex from fix diffs → Grep | Hardcoded px values, missing aria attributes, inline color values, raw z-index |
| Semantic | Understand UI anti-pattern → Agent scan | Inconsistent spacing scale, missing hover/focus states, keyboard nav gaps, contrast violations |
| Structural | Find components with same layout/state shape | Sibling components with same template, parallel page layouts, shared form patterns |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template, confidence}]`

**Thoroughness floor:** ALL 3 layers must be attempted and logged. Each layer records search method, scope, hit count in evidence phase=generalization. "No hits" requires all 3 layers to return 0 with logged evidence.

**Step 2 — 4-agent concurrent scan** (single message, 4 Agents):

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep regex from pattern signatures | Full project |
| Semantic scan | UI anti-pattern check (states, a11y, spacing) | Related components |
| Structural match | Find structurally similar components/pages | Full project |
| Historical grep | `git log -S` for pattern signatures | Git history |

**Step 3 — Cross-layer dedup:** multi-layer hit → boost | single-layer → `needs_review` | historically fixed → `regression_risk`

**Step 4 — Iterative deepening:** Component with ≥3 hits → targeted deep scan (max 1 round).

**Step 5 — Persist:** Update understanding.md section 6 + write `session.json.generalization_stats`:
```json
{"patterns_extracted": 0, "total_hits": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {"syntax": 0, "semantic": 0, "structural": 0}, "deepening_triggered": false}
```

**Transition guard:** `S_GENERALIZE → S_RECORD` requires `by_layer` has entries for all 3 layers with search evidence logged. Mark G5 done.

Commit: `"odyssey-ui({slug}): GENERALIZE — pattern scan complete"`

### A_DISCOVER

**Executes whenever `total_hits > 0`. Cannot be skipped without `skip_generalize == true`.**

1. **Triage** each hit with ±10 lines context → classify:
   - `bug` — confirmed UI defect in sibling component (missing state, broken a11y, inconsistent token)
   - `risk` — potential visual/UX degradation
   - `safe` — false positive (must log individual reason — blanket "pre-existing" forbidden)

2. **Route:**

   | Classification | Action |
   |---------------|--------|
   | new component needing audit | Route to S_AUDIT, `cross_phase_loops++` |
   | fixable sibling (same pattern) | Immediate fix → back to S_FIX, `cross_phase_loops++` |
   | risk + guard addable | Fix directly |
   | risk + design decision needed | Create issue |
   | safe | Skip with logged per-item reason |

   Normal: AskUserQuestion per hit | `-y`: auto-fix with template, create issue for rest

3. **Cross-phase loops:** `loops >= max_loops` → must log per-item reasons, advance to S_RECORD.

4. Append evidence phase=discovery. Update understanding.md section 7. Mark G6 done.

Commit: `"odyssey-ui({slug}): DISCOVER — sibling triage complete"`

### A_RECORD

1. Finalize understanding.md section 8 — learnings by Knowledge Persistence categories:
   - Design pattern: component pattern + applicable scenarios + token references → `/spec-add ui`
   - Interaction spec: state definitions + transition rules + feedback patterns → `/spec-add ui`
   - Accessibility rule: WCAG requirement + implementation approach → `/spec-add ui`
   - Reusable generalization pattern: signature + application scope → `/spec-add coding`

2. Mark G7 done. Pending decisions: Normal → AskUserQuestion | `-y` → skip (show deferred count).

3. **Goal audit (hardened):**
   - `done` → confirmed
   - `skipped` → confirmed ONLY if corresponding `skip_when` flag is true
   - **Hard rule:** G5 and G6 CANNOT be `skipped` unless `skip_generalize == true`. Pending without flag → `failed` (Normal: AskUserQuestion | `-y`: record `failed`)
   - `phase_goals_all_done = true` only when all goals pass this audit

4. `current_state = "COMPLETED"`, emit completion summary.

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
Learnings:  {N} persisted
Self-iter:  {N} rounds
Goals:      {done}/{total} ({skipped} skipped)
---
```

Commit: `"odyssey-ui({slug}): RECORD — summary and knowledge persistence"`

</actions>

<appendix>

### `-y` ui-specific points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX improvement confirmation | AskUserQuestion | auto-proceed, deferred |
| A_DISCOVER hit routing | AskUserQuestion | auto-fix with template, create issue for rest |

### Goal Prompt convergence rules

```
Stop when audit + diverge findings all addressed (fix/issue/decision),
phase_goals_all_done=true. Fix by impact x severity per tier.
Re-review after each tier — new findings append and continue.
Pending decisions must AskUserQuestion — no self-resolve.
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
| W003 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
</error_codes>

<success_criteria>
- [ ] 6-dimension audit with severity matrix + divergent exploration (polish + delight)
- [ ] Improvements implemented and verified (unless --skip-fix)
- [ ] Multi-layer generalization + discoveries classified (unless --skip-generalize)
- [ ] Every unfixed finding has individual classification and reason
- [ ] understanding.md section 8 finalized; phase_goals G1-G7 tracked; `-y` no blocking prompts
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Finding needs deeper debug | `/odyssey-debug "<finding>"` |
| Issues from discoveries | `/manage-issue list --source ui-odyssey` |
| Design pattern to document | `/spec-add ui "..."` |
| Full review of changes | `/odyssey-review-test-fix <changed-files>` |
| Sibling components to polish | `/odyssey-ui "<sibling>"` |
</next_step_routing>
