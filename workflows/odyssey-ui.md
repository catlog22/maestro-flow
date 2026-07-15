---
name: odyssey-ui
prepare: odyssey-ui
session-mode: inherited
---

# Workflow: Odyssey UI

6-dimension visual experience audit — survey design context → audit dimensions → divergent exploration → fix → verify → generalize.

---

## State Chain

```
S_INTAKE → S_SURVEY → S_AUDIT → S_DIVERGE → S_FIX → S_VERIFY → [back-half]
```

Back-half: `S_GENERALIZE → S_DISCOVER → S_RECORD → END` (see odyssey-base.md §Shared Back-Half).

---

## Boundary

**In scope:** Target component/page visual experience optimization — audit 6 dimensions, divergent exploration, fix, generalize to sibling components.
**Out of scope:** Backend/data/API → `--mode planex` | Deep bug investigation → `--mode debug` | Code quality review → `--mode review`.

---

## Decision Gate

ONLY these qualify as decisions: brand/style direction requiring human creative judgment | layout restructuring that significantly changes user flow | requires new design tokens or breaking component API.

---

## Context

### Target Resolution

| Input | Resolution |
|-------|-----------|
| Component path | Audit component |
| Page/route | Audit page |
| `staged` / `HEAD` | Diff UI changes |
| Feature area | Resolve to components/pages |

### Dimensions (6)

| Dimension | Focus |
|-----------|-------|
| visual_hierarchy | Spacing, typography scale, color contrast, alignment, whitespace, visual weight |
| interaction_states | Hover, focus, active, disabled, loading, error, empty, selected states |
| accessibility | WCAG AA contrast, focus management, aria labels, keyboard nav, screen reader |
| responsiveness | Breakpoints, overflow, touch targets, fluid typography, container queries |
| micro_interactions | Transitions, animations, feedback indicators, loading states, progress |
| edge_cases | Long text truncation, empty data, error states, extreme values, i18n, RTL |

### Session Fields

```json
{ "target": "", "dimensions": [],
  "audit_result": { "dimensions_audited": 0, "finding_count": 0, "severity_distribution": {} },
  "diverge_result": { "improvements_proposed": 0, "creative_ideas": 0 },
  "patterns": [], "confirmation": null, "generalization_stats": null }
```

### evidence.ndjson Phases

`survey|audit|diverge|fix|discovery|decision|self-iteration`

### phase_goals[]

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Divergent exploration done | S_DIVERGE | — |
| G4 | Zero remaining: all findings/ideas fixed and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

### understanding.md — 8 Sections

1. Target & Design Context
2. Survey
3. Audit
4. Diverge
5. Verify
6. Generalize
7. Discover
8. Learnings

---

## State Machine

### Transitions

```
S_SURVEY  → S_AUDIT       : complete
S_AUDIT   → S_DIVERGE     : complete
S_DIVERGE → S_FIX         : !skip_fix AND actionable findings/ideas
S_DIVERGE → S_GENERALIZE  : (skip_fix OR no actionable) AND !skip_generalize
S_DIVERGE → S_RECORD      : (skip_fix OR no actionable) AND skip_generalize
S_FIX     → S_VERIFY      : fix implemented
S_VERIFY  → S_GENERALIZE  : verified, !skip_generalize
S_VERIFY  → S_RECORD      : verified, skip_generalize
S_VERIFY  → S_FIX         : needs_rework
```

Discover routes: new component to audit → S_AUDIT; fixable sibling → S_FIX.

### Actions

**A_SURVEY** — (1) Design system inventory: scan for design tokens, CSS variables, theme imports. (2) Current state analysis: styling patterns, layout strategy, component hierarchy. (3) CLI-assisted: `maestro delegate --role analyze --mode analysis` (`run_in_background: true`) — survey tokens, spacing, typography, hierarchy, consistency. (4) Evidence phase=survey. Update §2. Mark G1.

Commit: `"odyssey-ui({slug}): SURVEY — design context survey complete"`

**A_AUDIT** — Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset; see Dimensions table). Each returns `[{title, severity, file, line, description, suggestion, dimension}]`. Merge → evidence phase=audit. Write `audit_result`. Update §3 severity matrix. Mark G2.

**GATE: all-dimensions-audited** — all 6 dimensions (or `--dimensions` subset) completed with structured findings, merged into severity matrix, evidence phase=audit logged per dimension. Zero dimensions reviewed is BLOCKED (W002 partial from agent failure is a warning).

Commit: `"odyssey-ui({slug}): AUDIT — dimension audit complete"`

**A_DIVERGE** — Goes beyond defect fixing — "what would make this delightful?"

**Step 1 — 2 parallel Agents:**
- **Polish Agent**: shadows, borders, transitions, hover, feedback, empty states, skeleton loading, scroll behavior.
- **Delight Agent**: motion design, progressive disclosure, smart defaults, contextual hints, celebratory feedback, personality in copy.

Each returns `[{idea, category (polish|delight), impact, effort, description, inspiration}]`.

**Step 2 — CLI-assisted:** `maestro delegate --role analyze --mode analysis` (`run_in_background: true`) — polish opportunities, micro-interactions, visual rhythm, delight moments.

**Step 3 — Consolidate:** merge audit findings + divergent ideas → prioritized list (severity × impact × effort). Evidence phase=diverge. Update §4. Mark G3.

**GATE: diverge-explored** — both Polish and Delight agents completed, returning distinct `[{idea, category, impact, effort, description, inspiration}]` entries; CLI-assisted analysis completed; all outputs consolidated with audit findings into a prioritized list (severity × impact × effort); evidence phase=diverge logged; understanding.md §4 written.

Commit: `"odyssey-ui({slug}): DIVERGE — divergent exploration complete"`

**A_FIX** — Skip if `--skip-fix`. (1) Exhaustive fix: ALL findings/ideas by priority tier (critical → high → medium → low + high-impact ideas). After each tier, re-review — new findings append. (2) Each fix → evidence phase=fix. (3) Normal: [@ask] AskUserQuestion per-fix | `-y`: auto-proceed, record `deferred`.

Commit: `"odyssey-ui({slug}): FIX — {tier} tier addressed"`

**A_VERIFY** — (1) Run tests (lint, unit, visual regression). (2) `maestro delegate --role review --mode analysis` (`run_in_background: true`) — visual correctness, interaction states, accessibility, responsive. (3) `needs_rework` → S_FIX; `verified` → mark G4. Update §5, write `confirmation`.

**GATE: zero-remaining-verified** — every prioritized finding and idea is fixed and verified, individually classified (issue / decision), or skipped via `--skip-fix`; tests pass (lint, unit, visual regression); confirmation written; no unaddressed actionable findings; understanding.md §5 updated. `needs_rework` routes back to FIX.

Commit: `"odyssey-ui({slug}): VERIFY — fix verification complete"`

---

## Generalize Source

Audit findings + diverge ideas (severity >= medium OR impact = high).

**Discover routing:** new component → S_AUDIT; fixable sibling → S_FIX.

---

## Knowledge Persistence (§8)

| Category | Content | Follow-up |
|----------|---------|-----------|
| Design pattern | Component pattern + applicable scenarios + token references | `/spec add ui` |
| Interaction spec | State definitions + transition rules + feedback patterns | `/spec add ui` |
| Accessibility rule | WCAG requirement + implementation approach | `/spec add ui` |
| Reusable generalization pattern | Pattern signature + application scope | `/spec add coding` |

---

## Completion Summary

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

---

## Mode `-y` Points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_FIX confirmation | [@ask] AskUserQuestion | auto-proceed `deferred` |
| A_DISCOVER routing | [@ask] AskUserQuestion | auto-fix w/ template, issue for rest |

---

## Phase Gates

- **Discovery gate** (SURVEY): evidence logged, understanding.md updated. Survey requires all scan types attempted.
- **Audit gate** (AUDIT+DIVERGE): all dimension agents completed, findings merged. Diverge agents completed, ideas consolidated. Zero dimensions reviewed is BLOCKED (W002 partial allowed).
- **FIX gate:** current priority tier fully addressed. Per-fix evidence logged. Auto-commit per tier.
- **VERIFY gate:** tests pass; confirmation written, understanding.md updated, verify goal marked. needs_rework → route back to FIX.

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target provided | Provide target or -c |
| E002 | error | Target path not found | Check path |
| W002 | warning | Some dimension agents failed | Partial coverage accepted |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD |
| W005 | warning | Pending decisions | Filter evidence phase=decision |

---

## Success Criteria

- [ ] Target resolved; session + output files created
- [ ] Survey completed with design system inventory + current state analysis
- [ ] 6-dimension audit completed with structured findings + severity matrix
- [ ] Divergent exploration: polish + delight ideas consolidated with audit findings
- [ ] understanding.md 8 sections written progressively (§1–§8)
- [ ] Fix + verify (unless --skip-fix); all findings/ideas addressed by priority
- [ ] Multi-layer generalization + discovery triage (unless --skip-generalize)
- [ ] phase_goals derived, tracked, and hardened-audited; Goal Prompt once
- [ ] Session resumable via -c; completion summary emitted

---

## Next Step Routing

| Condition | Next |
|-----------|------|
| Discovery issues created | `/manage issue list --source ui-odyssey` |
| Backend/data issue found | `/odyssey <target> --mode planex` |
| Deep bug investigation | `/odyssey <target> --mode debug` |
| Code quality review | `/odyssey <changed-files> --mode review` |
| Document pattern | `/learn decompose <component>` |
| Second opinion | `/learn consult <understanding.md>` |
| Design/interaction pattern to persist | `/spec add ui "..."` |
| Pending decisions | Filter evidence phase=decision status=pending |
