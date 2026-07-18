# Swarm Result — Unified Session-Context Layer for `.claude/commands/`

> **Objective:** Analyze command chaining and context discovery in `.claude/commands/*.md`; find duplication where commands independently re-discover the same context; propose a unified session-context layer that commands consume rather than rebuild.
>
> **Status:** CONVERGED — iteration 1 of 3 max, target_score (0.93 > 0.85) triggered early termination.

---

## Best Solution

**Path:** `maestro-collab` → `maestro-plan` → `maestro-execute` → `spec-load` → `maestro-init`
**Verified Score:** 0.93
**Iteration:** 1 of 3
**Ant:** ANT-1-1
**Self-score:** 0.84 (under-confident by 0.09 — largest delta in batch, but no hallucination)

### Summary

The best ant traced the real `next_step_routing` chain that drives the maestro lifecycle (`collab → plan → execute`), then stepped to the spec-loading primitive that every link in that chain re-invokes (`spec-load`), then to the session origin that creates the `state.json` + `.workflow/specs/` layer every other command re-reads (`maestro-init`). Walking that arc surfaced the same duplication from three complementary angles: the **consumer** commands (collab/plan/execute) each rebuild spec/knowledge/state discovery; the **primitive** (spec-load) already centralizes spec loading but is bypassed/inlined by its consumers; and the **origin** (init) creates the very files whose re-discovery is the waste. The proposal: a single `.workflow/session-context.json` produced once per session/phase by a lightweight `maestro context resolve` step, consumed via a consume-or-fallback contract at every command's existing Pre-load / Role-Knowledge / Phase-Gate-P1 point.

### Evidence Chain

All anchors below were re-verified by the analyst against source files:

- `maestro-collab.md:28` — `**Pre-load** (optional): maestro load --type spec --category arch + maestro search --category arch` → the duplicated spec+knowledge discovery block, rebuilt per command. *(verified)*
- `maestro-execute.md:53-59` — `### Pre-load context` runs 4 Bash calls (codebase docs → wiki search → spec coding → conditional spec ui); `:61-62` `### Role Knowledge` runs `maestro search --category coding` → `maestro load --type knowhow --id`. → The same two-step discovery as collab, only `<category>` differs. *(verified)*
- `maestro-execute.md:70` — `Bash("maestro collab preflight --phase <phase-number>")`; `maestro-plan.md:66` — identical preflight Bash. → GAP-2: shared preflight re-invoked per command. *(verified)*
- `maestro-plan.md:51` — `search state.json for latest analyze artifact, fallback standalone`; `:57-58` Role Knowledge block. → GAP-3 + GAP-1 in the same command. *(verified)*
- `spec-load.md:63` — `Scope layering — global scope MUST merge both ~/.maestro/specs/ and .workflow/specs/; ...`; `:61-62,66` read-only / output-to-context-only invariants. → spec-load is *already* a safe, centralized, read-only spec loader — the shared layer exists but is bypassed. *(verified)*
- `maestro-init.md:94-95,154` — creates `.workflow/state.json` (artifacts[]) + `.workflow/specs/` (the layer spec-load reads). → The session origin whose outputs are re-discovered downstream. *(verified)*

### Candidate Artifact

Excerpt from `best.json#candidate_solution.content` (ANT-1-1, full object in `best.json`):

> "Path collab→plan→execute→spec-load→init reveals that ~20 commands independently re-run the same spec-load + Role-Knowledge + state.json discovery; propose a unified session-context layer consumed via --from/context-package.json instead of rebuilt per command."

**Four proposals** (from `best.json`):

1. **session-context.json** — one file per session/phase capturing resolved specs per category, resolved knowhow ids, current milestone/phase, latest upstream artifact refs, codebase doc-index snapshot. Consumed at existing Pre-load/Role-Knowledge/Phase-Gate-P1 points.
2. **shared preflight** — move `maestro collab preflight` into the resolve step; plan/execute read `session-context.json.preflight` (eliminates GAP-2).
3. **parameterize spec discovery** — collapse the duplicated block into one `@~/.maestro/workflows/context-discover.md` taking `<category>` as a parameter; commands declare `needs: [arch, coding]` instead of re-implementing load+search.
4. **generalize the ralph load contract** — `maestro ralph next` already centralizes `<required_reading>/<deferred_reading>` (maestro-ralph-execute.md:40, maestro-ralph.md:50); generalize into a non-ralph `maestro context load` for standalone invocations (eliminates GAP-4).

---

## Why This Path Won

| Decision | Pheromone-guided? | Why it mattered |
|----------|-------------------|-----------------|
| start = `maestro-collab` | assigned (start node) | Gave a real `next_step_routing` chain to follow (collab→plan→execute is wired in the tables), maximizing *chaining* evidence at every step. |
| collab → plan | NO (deviation) | Driven by `maestro-collab.md:185-189` routing + the fact that both duplicate the spec/Role-Knowledge block. Linked two duplication sites, not just two commands. |
| plan → execute | NO (deviation) | `maestro-plan.md:164-168` routing + plan.json consumption handoff + shared preflight. Surfaced GAP-2 (preflight) and the `--from`/context-package.json handoff mechanism. |
| execute → spec-load | NO (deviation) | The pivotal call. execute's Pre-load (`:53-59`) *invokes* `maestro load --type spec` — i.e. re-implements spec-load's function inline. Stepping to spec-load exposed the "primitive exists but is bypassed" theme that 3 of 5 ants independently confirmed. |
| spec-load → init | NO (deviation) | Closed the loop: spec-load *reads* `.workflow/specs/` (which init *creates*) and state.json (which init *creates*). Made the duplication a closed cycle: origin → consumer → primitive → origin. |

**Pivotal insight:** All four transitions were *deviations* from the (uniform 0.01493) pheromone — every step was chosen on chaining + duplication evidence, not trail strength. The path earned the top score because it stacked evidence *at every node* rather than visiting higher-profile but lower-evidence nodes. The scorer's rationale confirms this: "deepest gap identification (18-command spec/knowhow duplication list + GAP-3 state.json re-discovery across 10 cmds) and 4 distinct chaining mechanisms (routing tables, --from handoff, shared preflight, plan.json consumption) + 16 evidence anchors drove dims 1/3/5."

---

## The Unified Finding — Duplication Gaps Across All Ants (GAP-1 … GAP-17)

Five ants explored five *different* command families (maestro core lifecycle, ralph orchestrator, learn-*, odyssey-*, specs+tools) yet independently converged on the same structural finding: **every family independently re-discovers stable project context (specs / knowledge / codebase docs / prior sessions) per invocation, and a centralized read-only loader (spec-load) already exists but is bypassed.** The unified gap inventory below merges every ant's findings; each row cites its source ant so the synthesis is auditable.

### A. Spec + Role-Knowledge discovery (the dominant duplication)

| Gap | Severity | Duplicated logic | Commands (file:line) | Source ant |
|-----|----------|------------------|----------------------|-----------|
| **GAP-1** | HIGH | Each command independently runs `maestro load --type spec --category <cat>` then `maestro search --category <cat>` → `maestro load --type knowhow --id`. Only `<category>` differs (arch / coding / test / review / debug). | 18 commands: maestro-collab:28, maestro-analyze:66,70-71, maestro-blueprint:51, maestro-brainstorm:59,62-64, maestro-plan:57-58, maestro-execute:57-58,61-62, maestro-quick:36-40, maestro-grill:52, maestro-roadmap:53, maestro-composer:39-40, maestro-milestone-audit:40,43-47, maestro-companion:100-106,121, quality-auto-test:49-53, quality-debug:47-48, quality-refactor:33-37, quality-review:52,54, quality-test:89-90, manage-issue-discover:46 | ANT-1-1 |
| **GAP-6** | HIGH | Same Pre-load block across 13 lifecycle skills; the orchestrator's `<execution_context>` injection covers session/artifact context but NOT stable project context (specs/knowledge/codebase docs), so each skill rebuilds it. | 13 skills (analyze, plan, execute, blueprint, brainstorm, grill, roadmap, milestone-audit, composer, quick, collab, impeccable, ui-codify) | ANT-1-2 |
| **GAP-9** | HIGH | `maestro search` for prior knowledge — the single most duplicated operation folder-wide; no result caching, chained commands re-issue overlapping searches. | ~30 commands incl. learn-investigate:99, learn-second-opinion:34, maestro-analyze:67, maestro-execute:56, maestro-plan:58, quality-debug:46, quality-review:51, odyssey-debug:137, odyssey-improve:201 | ANT-1-3 |

> **Convergence signal:** GAP-1 (ANT-1-1, maestro core), GAP-6 (ANT-1-2, ralph-orchestrated skills), and GAP-9 (ANT-1-3, learn-* + folder-wide) are three independent measurements of the *same* underlying duplication from three different family entry points. The 18 / 13 / ~30 command counts differ only in enumeration granularity, not in finding.

### B. State / artifact-registry discovery

| Gap | Severity | Duplicated logic | Commands (file:line) | Source ant |
|-----|----------|------------------|----------------------|-----------|
| **GAP-3** | HIGH | Nearly every command re-opens `.workflow/state.json` to (a) find current_milestone / latest upstream artifact and (b) append its own artifact; each re-implements its own resolution/search logic. | 10 commands: maestro-plan:51, maestro-execute:198,200, maestro-milestone-audit:31,58, maestro-milestone-complete:35, quality-review:35, quality-debug:30, maestro-next:95, maestro:119,171, maestro-ralph-cli:227-290, maestro-ralph-execute:156-159 | ANT-1-1 |
| **GAP-8** | MEDIUM | `learnings.md` known-pattern-set rebuild — each command re-reads the whole file and re-derives the dedup index instead of inheriting a cached set. | learn-follow:34, learn-decompose:62, learn-investigate:33,70,99, learn-second-opinion:57,79, + quality-retrospective | ANT-1-3 |
| **GAP-14** | HIGH | Session isolation at chain boundary — odyssey commands create a fresh `.workflow/scratch/{date}-{type}-odyssey-{slug}/` session and re-discover everything; no context handoff when odyssey-ui chains to /odyssey --mode debug. | odyssey-ui:39, odyssey-debug:42, review:43, improve:50 | ANT-1-5 |

### C. Codebase-docs + prior-session discovery (odyssey A_INTAKE pattern)

| Gap | Severity | Duplicated logic | Commands (file:line) | Source ant |
|-----|----------|------------------|----------------------|-----------|
| **GAP-11** | HIGH | 4 odyssey commands independently run the SAME 4-layer A_INTAKE discovery: (1) `maestro search`, (2) Glob prior sessions, (3) Read `ARCHITECTURE.md`, (4) spec load. Base file *defines* a Pre-load section but marks it optional and never promotes it to `<shared_actions>`. | odyssey-ui:178, odyssey-debug:137, odyssey-review-test-fix:176, odyssey-improve:201; base Pre-load at odyssey-base.md:237-245 | ANT-1-5 |
| **GAP-7** | MEDIUM | `coding-conventions.md` independent read for convention cross-ref; spec-load already maps it → category `coding` centrally, but bypassed. | learn-follow:34,142, learn-decompose:29,62,101, + maestro-milestone-complete:75 | ANT-1-3 |
| **GAP-12** | MEDIUM | A_RESUME session recovery — identical 2-line implementation copy-pasted across 4 odyssey commands; not in `<shared_actions>`. | odyssey-ui:184-185, odyssey-debug:143-144, review:181-182, improve:208-209 | ANT-1-5 |

### D. Pre-flight, gating, and cold-bootstrap duplication

| Gap | Severity | Duplicated logic | Commands (file:line) | Source ant |
|-----|----------|------------------|----------------------|-----------|
| **GAP-2** | MEDIUM | `maestro collab preflight --phase <N>` run identically by both plan and execute. | maestro-plan:66, maestro-execute:70 | ANT-1-1 |
| **GAP-4** | MEDIUM | `<deferred_reading>` independently lists the same `~/.maestro/templates/state.json` (and task.json/plan.json) template per command. | maestro-analyze:24, maestro-execute:26, maestro-plan:27, maestro-init:25, maestro-grill:26, maestro-milestone-complete:25 | ANT-1-1 |
| **GAP-16** | MEDIUM | Specs-directory-existence gate — 4 commands re-probe `.workflow/specs/` existence and independently emit setup-routing errors (E001/E002); no shared `specs_initialized` flag. | maestro-tools-register:178 (E001), spec-load:81-92 (E001), spec-add:71 (E002), spec-setup:44 (GATE 1) | ANT-1-4 |
| **GAP-17** | MEDIUM | Per-command `<required_reading>` cold bootstrap — ~40+ commands each re-read their workflow spec from disk on every invocation, even back-to-back in the same session. | all 5 on ANT-1-4's path + ~40+ folder-wide | ANT-1-4 |
| **GAP-15** | MEDIUM | `tools-spec.md` re-read by both register and execute (`<required_reading>`). | maestro-tools-register:21, maestro-tools-execute:21 | ANT-1-4 |

### E. Orchestrator / shared-action structural duplication

| Gap | Severity | Duplicated logic | Commands (file:line) | Source ant |
|-----|----------|------------------|----------------------|-----------|
| **GAP-5** | MEDIUM | Orchestrator FSM duplicated between maestro-ralph-cli and maestro-ralph — A_RESOLVE_PHASE / A_INFER_POSITION / A_RESOLVE_SCOPE_VERDICT / A_BUILD_STEPS / A_DECOMPOSE_TASKS near-verbatim; both LEGACY (prefer maestro-ralph-v2). | maestro-ralph-cli:219-479 vs maestro-ralph:201-456 | ANT-1-2 |
| **GAP-13** | MEDIUM | Double-duplication: A_GENERALIZE / A_DISCOVER / A_RECORD ARE defined in odyssey-base `<shared_actions>` (142-200), yet each command redefines them in full. | odyssey-ui:244-345, odyssey-debug:190-291, review:240-339, improve:258-365 | ANT-1-5 |
| **GAP-10** | LOW | Target-resolution table (file path / wiki ID / topic) copy-pasted. | learn-follow:22-27 ≈ learn-second-opinion:22-29 | ANT-1-3 |

---

## The Unified Session-Context Layer (Synthesized Proposal)

The five ants proposed four slightly different vehicles for the same layer. They are *compatible* and should be unified:

| Ant | Vehicle | Location |
|-----|---------|----------|
| ANT-1-1 | `session-context.json` + shared `context-discover.md` workflow | `.workflow/session-context.json` |
| ANT-1-2 | `session.project_context` cache + `<project_context>` block in `<execution_context>` | status.json field, injected by orchestrator |
| ANT-1-3 | `spec-load --session-cache` mode + `.workflow/.session/context.json` | extend spec-load; session-scoped snapshot |
| ANT-1-4 | `.workflow/.session/context.json` materialized lazily | `.workflow/.session/` |
| ANT-1-5 | `context.json` in shared scratch session + promote A_INTAKE/A_RESUME to `<shared_actions>` | `.workflow/scratch/{date}-odyssey-session/context.json` |

### Synthesized design

**One layer, two scopes:**

1. **Project-stable context** (specs / knowhow / codebase docs / wiki / specs_init flag) — built once per session, hash-invalidated on spec/knowhow writes. Lives in `.workflow/session-context.json` (ANT-1-1/1-4's path). For ralph-orchestrated sessions it is *also* injected via a new `<project_context>` block in `<execution_context>` (ANT-1-2's channel) so orchestrated skills receive it through the mechanism they already parse. For non-orchestrated commands it is read from disk at the existing Pre-load point.
2. **Session-runtime context** (current milestone/phase, latest upstream artifact refs, preflight verdict, prior-step findings) — already partially handled by `--from`/context-package.json (ANT-1-1) and `<execution_context>` (ANT-1-2); extend to carry the preflight verdict (GAP-2) and artifact-registry snapshot (GAP-3) so commands stop re-searching state.json.

**One consumer contract (all ants agree):** *consume-or-fallback*. When the shared layer is present (orchestrated session, or session-context.json exists & fresh), commands consume it and skip their Pre-load/Role-Knowledge/GATE re-discovery. When absent (standalone direct invocation), they fall back to the current `maestro load`/`maestro search` behavior — zero behavior change for non-session use (ANT-1-2's backward-compatibility guarantee).

**One shared workflow (ANT-1-1 proposal 3, ANT-1-5 A_INTAKE_SHARED):** Parameterize the duplicated discovery into `@~/.maestro/workflows/context-discover.md` taking `<category>` (and for odyssey, the 4-layer intake) as parameters — matching the existing shared-workflow pattern (`roadmap-common.md`, `odyssey-base.md`, `interview-mechanics.md`). Commands declare `needs: [arch, coding]` rather than re-implementing load+search.

### Concrete modifications (file:line → change), synthesized

| File:section | Change | Gaps closed |
|--------------|--------|-------------|
| `maestro-execute.md:53-59` (Pre-load context, 4 Bash calls) | Replace with: read `session-context.json`; if missing/stale (phase mismatch), run `maestro context resolve --phase <N>` once. | GAP-1, GAP-6 |
| `maestro-execute.md:61-62` + `maestro-plan.md:57-58` (Role Knowledge) | Consume `session-context.json.resolved_knowhow` instead of re-running `maestro search`/`maestro load --type knowhow`. | GAP-1, GAP-9 |
| `maestro-plan.md:51` (state.json artifact search) | Read `session-context.json.latest_analyze_artifact` instead of searching state.json. | GAP-3 |
| `maestro-plan.md:66` + `maestro-execute:70` (preflight Bash) | Read `session-context.json.preflight` (resolved once per phase). | GAP-2 |
| `maestro-collab.md:28` (Pre-load) | Inject `session-context.json.resolved_specs.arch` into delegate prompts. | GAP-1 |
| `maestro-ralph-cli.md:488-504` (A_LOAD_STEP_CONTEXT) | Add step 0: build/refresh `project_context` cache (hash-invalidate); skip if fresh. | GAP-6 |
| `maestro-ralph-cli.md:518-542` (`<execution_context>`) | Add `<project_context>` block after `<stage_context>`. | GAP-6 |
| All 13 lifecycle skills' Pre-load sections | Apply consume-or-fallback contract; standardize header to `### Project context (inherited or discovered)`. | GAP-1, GAP-6 |
| `spec-load.md:24-31` (Flags) + new invariant after `:66` | Add `--session-cache` mode: load all relevant categories once, run session-topic `maestro search`, resolve target, write session snapshot; read-only after first population. | GAP-1, GAP-7, GAP-9 |
| `odyssey-base.md:142-200` (`<shared_actions>`) | Promote A_INTAKE → `A_INTAKE_SHARED(slug, type, spec_categories)` and A_RESUME → `A_RESUME_SHARED(type)`; upgrade Pre-load (`:237-245`) from optional to mandatory shared. | GAP-11, GAP-12, GAP-13 |
| `odyssey-ui.md:178`, `odyssey-debug.md:137`, `odyssey-review-test-fix.md:176`, `odyssey-improve.md:201` (A_INTAKE) | Replace 4 copy-pasted intakes with `A_INTAKE_SHARED` + command-specific delta. | GAP-11, GAP-14 |
| `odyssey-ui.md:178` etc. (inlined `spec load`/`maestro load --type spec`) | Chain to `/spec load --category <cat>` instead of inlining the raw CLI. | GAP-11 |
| `learn-follow.md:34,142`, `learn-decompose.md:62`, `learn-investigate.md:99`, `learn-second-opinion.md:34,67` | Consume `session_context.conventions` / `.known_patterns` / `.prior_knowledge`; S_DEDUP/S_PATTERN/S_CONTEXT become cache-checks. | GAP-7, GAP-8, GAP-9 |
| `maestro-tools-register.md:20-22,178` + `maestro-tools-execute.md:20-22` + `spec-load.md:81-92` + `spec-add.md:71` | Replace per-command `tools-spec.md` re-read + specs-existence probes with `$SESSION_CONTEXT.workflow_specs` + `$SESSION_CONTEXT.specs_init.initialized`. | GAP-15, GAP-16, GAP-17 |
| `maestro-ralph.md` + `maestro-ralph-cli.md` (FSM) | Extract shared phase-resolution/scope-verdict/bootstrap into `~/.maestro/workflows/session-bootstrap.md`; long-term retire both LEGACY orchestrators for maestro-ralph-v2. | GAP-5 |

### Existing precedents the layer generalizes (not invents)

- **`--from` / context-package.json handoff** (maestro-plan:37-52, maestro-init:37, maestro-blueprint:38,161, maestro-grill:48, maestro-roadmap:40) — per-session upstream→downstream, but only for explicit chaining, *not* for spec/Role-Knowledge discovery.
- **`maestro ralph next` CLI** centralizes `<required_reading>/<deferred_reading>` for ralph-orchestrated sessions (maestro-ralph-execute.md:40, maestro-ralph.md:50) — the proven template; generalize to non-ralph.
- **odyssey-base `<shared_actions>`** already shares A_GENERALIZE/A_DISCOVER/A_RECORD (142-200) — A_INTAKE/A_RESUME are the conspicuous omission.

---

## Runner-Up Solutions

| Rank | Ant | Path | Score | Diff from best | Why it lost |
|------|-----|------|-------|----------------|-------------|
| 2 | ANT-1-2 | maestro-ralph-cli-execute → maestro-ralph-cli → maestro-ralph → maestro-analyze → maestro-plan | 0.90 | −0.03 | Strongest *context-discovery precision* (CLI/Orchestrator/Skill layer classification; "context RECEIVED not discovered" for cli-execute) + unique FSM-duplication insight (GAP-5) + 7 concrete changes with invalidation + backward-compat. Docked for 3 gaps vs ANT-1-1's 4 and acknowledged unread nodes (ralph-execute/v2). Close on depth, lost on gap-enumeration breadth. |
| 3 | ANT-1-3 | learn-follow → learn-decompose → learn-investigate → learn-second-opinion → spec-load | 0.88 | −0.05 | Most chaining edges (12 explicit next_step_routing + implicit `Skill()` runtime chains + shared-state learnings.md handoff) + the valuable folder-wide `maestro search` scope quantification (~30 commands, GAP-9). Slightly less per-node HOW depth than top 2; 5 gaps but narrower per-gap command lists. |
| 4 | ANT-1-5 | odyssey-ui → odyssey-debug → odyssey-review-test-fix → spec-load → odyssey-improve | 0.86 | −0.07 | Unique double-duplication insight (GAP-13: shared action exists yet commands copy-paste it in full) + session-isolation finding (GAP-14: context lost at every chain boundary) + sharp base-file gap analysis (A_INTAKE/A_RESUME conspicuously absent from `<shared_actions>`). Docked for narrower chaining edge count and single-family scope. |
| 5 | ANT-1-4 | maestro-tools-register → maestro-tools-execute → spec-load → spec-add → spec-setup | 0.82 | −0.11 | Unique CLI-handoff + E0xx error-code chaining mechanisms + strong ralph-CLI contrast case + clean `.session/context.json` design. Docked for fewest evidence anchors (9) and `candidate_solution.content` being a `file_ref` (schema deviation: content not inline object) — though the referenced `ant-1-4-analysis.md` is itself substantive. |

**Stability vs luck:** The 0.11 score range (0.82–0.93) is compressed, and the scorer explicitly re-ranked with finer rubric application to spread the band. The top 3 (0.93/0.90/0.88) are within 0.05 — a genuine near-tie on quality, differentiated by *breadth of gap enumeration* (ANT-1-1's 18-command list) and *evidence anchor count* (16 vs 11 vs 15), not by one being wrong. The ranking is **stable on the finding** (all 5 agree on the core duplication) but **soft on the ordering** within the top 3 — single-iteration, no pheromone validation.

---

## Convergence Story

**Iterations:** 1 of 3 max
**Trigger:** `target_score` — best 0.93 > target 0.85 → early termination (NOT stagnation; stagnation patience=2 was never reached).

**Pheromone / entropy curve:**
- Iteration 1 used **uniform pheromone** (τ = 0.01493 for every edge). Every ant's `path_decisions` record `guided_by: evidence|heuristic` and `deviation_from_hint: true` (except ANT-1-3's pheromone-followed steps, which were still uniform-tied). **No pheromone learning occurred** — the swarm terminated before any trail reinforcement could differentiate edges.
- Entropy curve / final pheromone stats: **unavailable** — `artifacts/swarm-report.json` was not present at the expected path (see Caveats). With uniform pheromone and target-driven termination, entropy was maximal at iter 1 by construction; there is no narrowing curve to report.

**Interpretation:** The swarm converged on a **genuine structural finding**, but via *breadth of independent confirmation* rather than *depth on one validated path*. Five ants entered five different command families with zero pheromone guidance and independently surfaced the same three themes: (1) per-invocation re-discovery of stable project context, (2) spec-load already centralizes spec loading but is bypassed, (3) two partial shared-context mechanisms exist but neither covers stable project context. That 5-of-5 agreement across disjoint families is strong evidence the finding is structural, not a path artifact. **However**, the target-score early termination is aggressive: because no edge was pheromone-reinforced, the "best path" ranking reflects single-iteration evidence-quality scoring only. A 2nd iteration would have begun differentiating edges; the current ranking should not be over-weighted as an exploration-validated optimum. The *proposal* is robust; the *path ranking* is provisional.

---

## Caveats

1. **`swarm-report.json` missing.** The expected `artifacts/swarm-report.json` (containing `convergence_curve`, `final_pheromone_stats`, `top_k`) was not present at the path given in the assignment. Convergence numbers were reconstructed from `scores/iter-1-scores.json` + `swarm-config.json` + `trails/1.jsonl`. Pheromone statistics and a numeric entropy curve are therefore unavailable; the convergence section reports what is derivable, not what a report file would have stated.
2. **Single iteration / no pheromone learning.** Uniform initial pheromone + target-driven termination after iter 1 means zero trail reinforcement. Path ranking is evidence-quality-scored, not exploration-validated. See Convergence Story.
3. **Best ant under-confident.** ANT-1-1 self-scored 0.84 vs verified 0.93 (Δ=0.09, the largest in the batch). All five ants were under-confident (Δ range 0.02–0.09); none approached the 0.4 hallucination threshold. No hallucination warning was appended to `wisdom/issues.md`.
4. **Proposed files do not yet exist.** Several modifications reference `context-discover.md`, `session-context.json`, `session-bootstrap.md`, and `<project_context>` blocks that are *proposed*, not current. They would need design validation against `~/.maestro/workflows/` internals (shared-workflow include mechanics, `<shared_actions>` semantics) not fully read in this pass.
5. **GAP-1's 18-command list was Grep-enumerated.** ANT-1-1 derived the 18-command list from Grep hits for `maestro load --type spec` / `maestro search --category` / `Role Knowledge`, with deep reads of representative commands (collab/plan/execute verified here). The pattern is consistent, but not all 18 individual line numbers were independently re-verified by this analyst. ANT-1-2's 13-command list and ANT-1-3's ~30-command count were derived similarly. Recommend a verification pass before acting on the full enumeration.
6. **ANT-1-4 schema deviation.** Its `candidate_solution.content` was a `file_ref` to `ant-1-4-analysis.md` rather than an inline object. The scorer docked it for this; the referenced analysis is substantive (5 gaps, 4 mods) and is included in the unified gap inventory, but its inlined content was not directly scored.
7. **Unexplored nodes.** ANT-1-2 flagged `maestro-ralph-v2` (the preferred non-LEGACY orchestrator) as unread — it may already consolidate GAP-5. `maestro-universal-workflow` (possibly the shared-layer abstraction) was also flagged unexplored. A future iteration should verify whether v2/universal-workflow already address parts of this proposal.
8. **Score band compression.** Initial weighted scores fell in a 0.90–0.93 band (within ±0.05); the scorer re-ranked with finer rubric application to spread to 0.82–0.93. The top-3 ordering (0.93/0.90/0.88) reflects fine-grained differentiation, not a wide quality gap — treat the ordering as soft.

---

## Reproducibility

- **Config:** `swarm-config.json` (pinned: n_ants=5, max_iterations=3, alpha=1.0, beta=2.0, rho=0.2, tau_init=1.0, target_score=0.85, stagnation patience=2)
- **Best path + candidate solution:** `best.json` (ANT-1-1, score 0.93)
- **Best ant full artifact:** `artifacts/ant-1-1.json` (path decisions, 16 evidence anchors, 4 gaps, 4 proposals)
- **All ant artifacts:** `artifacts/ant-1-1.json`, `ant-1-2.json`, `ant-1-3.json`, `ant-1-4.json` (+ `ant-1-4-analysis.md` file_ref), `ant-1-5.json`
- **Scorer output:** `scores/iter-1-scores.json` (verified scores, rationale, calibration, hallucination_delta)
- **Trails:** `trails/1.jsonl` (3 of 5 ants logged with verified scores — see Caveat: trails appear partial)
- **Wisdom:** `wisdom/learnings.md` (ANT-1-2 ralph/skill findings), `wisdom/decisions.md`, `wisdom/issues.md` (stubs)
- **Random seed:** not recorded in config (pheromone was uniform in iter 1, so seed did not influence path selection — all paths were evidence/heuristic-chosen)
- **Missing:** `artifacts/swarm-report.json` (see Caveat #1)
