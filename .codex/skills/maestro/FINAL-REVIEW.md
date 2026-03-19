# Final Quality Review -- Complete Maestro Codex Skills Migration

## Summary
- Total skills: 32 individual skills + 1 router = 33 total
- Coverage: 32/32 commands migrated (all directories present on disk)
- DESIGN.md directory tree: 32/32 skills listed
- Router routing table: 21/32 skills mapped (11 missing from routing table)
- Overall quality: 87%

## Per-Tier Summary

| Tier | Skills | Sampled | Avg Quality | Key Issues |
|------|--------|---------|-------------|------------|
| A (CSV Wave) | 10 | 4 | 93% | Excellent CSV wave implementation, minor schema doc gap |
| B (Light CSV) | 4 | 2 | 91% | Clean 2-wave pattern, consistent structure |
| C (Single Agent) | 9 | 3 | 88% | No CSV wave (correct), good sequential flow |
| D (Simple) | 9 | 3 | 90% | Concise, no agents (correct), clean utility skills |
| Infrastructure | 4 | 4 | 82% | Router missing 11 skills, 2 shared files missing |

---

## Infrastructure Quality

### SKILL.md (Router) -- Score: 78%

**Strengths**:
- Clear intent-to-skill routing table with 21 entries
- Chain definitions comprehensive (7 chains covering major workflows)
- State-based routing for continue/next/go
- Unmatched intent fallback with fuzzy matching
- Session tracking structure defined
- Frontmatter correct: `spawn_agents_on_csv` in allowed-tools

**Issues**:
- **CRITICAL**: Routing table missing 11 skills: `codebase-rebuild`, `codebase-refresh`, `memory-capture`, `milestone-audit`, `milestone-complete`, `phase-add`, `phase-transition`, `quick`, `spec-add`, `spec-load`, `spec-setup`
- These are all Tier C/D skills that exist on disk but have no route from the coordinator
- Users calling "quick task" or "milestone audit" would trigger the unmatched-intent fallback

### DESIGN.md -- Score: 85%

**Strengths**:
- Comprehensive tier classification with clear rationale
- Detailed CSV schema designs for all 10 Tier A skills
- Context flow strategy table
- Session structure specification
- Workflow file reuse strategy well-documented
- Migration priority phases well-defined
- Directory tree lists all 32 skills

**Issues**:
- Directory tree shows `sync/SKILL.md` positioned between Tier C skills (after `refactor/`) when it is classified as Tier D in the text (line 422) -- minor tree ordering inconsistency
- Tier D table lists 9 commands but the text says "7 commands" in the header (`### Tier D: Simple Utility (7 commands)`) -- actual count on disk is 9 including sync and codebase-refresh. The table body correctly lists 9 entries, so only the header number is wrong

### shared/wave-engine.md -- Score: 88%

**Strengths**:
- Session initialization template with UTC+8 timestamp
- Kahn's BFS wave computation algorithm documented
- Wave execution loop with all required steps
- prev_context building from CSV (not memory) -- explicitly correct
- Master CSV merge protocol
- Wave-level retry with transient vs permanent error classification
- Skip-on-failure cascade

**Issues**:
- No mention of `max_runtime_seconds` parameter for `spawn_agents_on_csv`
- No example of actual `spawn_agents_on_csv` call syntax (individual skills have this, but shared doc could include canonical example)

### shared/discovery-protocol.md -- Score: 92%

**Strengths**:
- 6 standard discovery types with dedup keys and data schemas
- NDJSON format with examples
- Agent protocol: read-first, skip-covered, write-immediately, append-only, deduplicate
- Reading protocol with filtering by type and dedup key
- Read and append command templates
- Handles missing file gracefully (first agent scenario)

**Issues**:
- None significant

### Missing Shared Files

DESIGN.md lists 4 shared files but only 2 exist:
- `shared/csv-utils.md` -- **MISSING** (CSV read/write/merge utilities)
- `shared/session-init.md` -- **MISSING** (Session initialization template)
- `shared/discovery-protocol.md` -- Present
- `shared/wave-engine.md` -- Present

The missing functionality is partially absorbed into `wave-engine.md` (session init template is there) and individual SKILL.md files (CSV handling is inline). However, a centralized `csv-utils.md` would reduce duplication.

---

## Tier A Review (CSV Wave)

### execute/SKILL.md (437 lines) -- Score: 95%

**Wave Correctness**: `spawn_agents_on_csv` present with correct parameters (csv_path, id_column, instruction, max_concurrency, max_runtime_seconds, output_csv_path, output_schema). Wave computation uses plan.json pre-computed waves. prev_context built from master CSV. Skip-on-failure cascade documented. Temp file cleanup specified.

**CSV Schema**: 15 columns (at limit). All 9 required columns present plus 6 domain columns (scope, convergence_criteria, hints, execution_directives, files_modified, tests_passed). output_schema has required fields (id, status, findings).

**Execution Logic**: Full 3-phase implementation (Plan Resolution, Wave Execution, Results Aggregation). Session init, user validation, --continue support, concurrency flag all present.

**Content Quality**: Realistic example CSV with auth module tasks. Domain-specific discovery types. Comprehensive error handling table. 10 core rules.

**Issues**: None significant.

### brainstorm/SKILL.md (463 lines) -- Score: 93%

**Wave Correctness**: Diamond topology correct (3 waves: guidance -> roles -> synthesis). spawn_agents_on_csv called for all 3 waves. Context propagation from guidance to roles to synthesis. Dependencies correctly encode: roles depend on guidance, synthesis depends on all roles.

**CSV Schema**: 13 columns (under limit). All required columns plus domain columns (role, topic, guidance_spec, analysis_file). Realistic example with 5 rows showing the diamond pattern.

**Content Quality**: 9 valid roles enumerated. Role agent responsibilities detailed (feature-point organization, word limits). Synthesis agent responsibilities include Four-Layer Aggregation. Discovery types include domain-specific: terminology, non_goal, feature_candidate, role_insight, cross_role_conflict.

**Issues**: None significant.

### verify/SKILL.md (566 lines) -- Score: 94%

**Wave Correctness**: Staged 3-wave topology correct (truth+existence -> substance+wiring -> antipattern+nyquist). Dependencies properly model the layer chain. Skip flags (--skip-tests, --skip-antipattern) mark tasks as skipped, not removed.

**CSV Schema**: 14 columns. Domain columns (layer, phase_dir, check_type, gaps_found, fix_plan) are well-designed. Example CSV shows realistic 9-task breakdown for a chat phase.

**Execution Logic**: All 3 phases present. Phase 3 is particularly thorough: builds verification.json and validation.json, auto-creates issues, generates fix plans, archives previous artifacts, copies to phase directory. 15-step Phase 3 is the most detailed of any skill.

**Content Quality**: Goal-Backward principle clearly stated. Substance check protocol (stub detection markers). Wiring check protocol (grep patterns). Anti-pattern scan categories. Nyquist audit framework detection.

**Issues**: None significant.

### issue-discover/SKILL.md (503 lines) -- Score: 92%

**Wave Correctness**: Wide funnel topology (8 parallel -> 1 dedup). 2 waves correctly assigned. Dedup agent depends on all 8 perspective agents.

**CSV Schema**: 13 columns. Domain columns (perspective, scope_glob, issues_found, severity_distribution). Dual mode support (multi-perspective + by-prompt).

**Content Quality**: 8 perspectives well-defined with guiding questions. Dedup agent protocol detailed (80% overlap threshold, severity-based dedup). Issue record schema specified (ISS-YYYYMMDD-NNN).

**Issues**: `discovery-state.json` is a custom metadata file alongside the standard CSV session -- slightly different from other skills which rely purely on CSV state. Minor inconsistency but functionally appropriate.

---

## Tier B Review (Light CSV)

### debug/SKILL.md (413 lines) -- Score: 91%

**2-Wave Pattern**: Correct. Wave 1 = hypothesis investigation (parallel), Wave 2 = fix attempts (parallel, confirmed only). This is the cleanest Tier B implementation.

**spawn_agents_on_csv**: Present for both waves with correct parameters. Wave 1 output_schema includes evidence_for/evidence_against. Wave 2 output_schema includes fix_applied/verified.

**Smart Filtering**: Wave 2 tasks are pre-generated but marked `skipped` if their hypothesis was refuted/inconclusive. Only confirmed hypotheses proceed to fix.

**Content Quality**: 3 modes (standalone, from-uat, parallel). Hypothesis generation from symptoms. Domain discovery types (root_cause, hypothesis_evidence, affected_component, reproduction_path).

**Issues**: None significant.

### plan/SKILL.md (458 lines) -- Score: 91%

**2-Wave Pattern**: Correct. Wave 1 = parallel codebase exploration (4 angles), Wave 2 = sequential plan generation (single agent).

**spawn_agents_on_csv**: Present for both waves. Wave 2 uses max_concurrency: 1 (correct for sequential planning).

**Context Flow**: Exploration findings feed into planning agent via prev_context. Upstream analysis shortcut (skip wave 1 if conclusions.json exists). Gap mode shortcut (skip wave 1, generate fix tasks directly).

**Content Quality**: 4 exploration angles (architecture, implementation, integration, risk). Planning agent responsibilities include Deep Work Rules. Plan checking with revision loop (max 3 rounds). 7 validation dimensions.

**Issues**: None significant.

---

## Tier C Review (Single Agent)

### init/SKILL.md (167 lines) -- Score: 90%

**No spawn_agents_on_csv**: Correct -- verified absent. Sequential 10-step implementation.

**Appropriate Use**: No Agent tool needed -- pure file creation and interactive questioning. allowed-tools correctly excludes spawn_agents_on_csv and Agent.

**Content Quality**: Auto state detection (existing/code/empty). Deep questioning flow (5 areas). Template reading before writing. --from-brainstorm integration. Error codes (E001-E003, W001).

**Issues**: None.

### quick/SKILL.md (164 lines) -- Score: 87%

**No spawn_agents_on_csv**: Correct -- verified absent. Sequential 9-step implementation.

**Appropriate Use**: Uses Agent tool in allowed-tools (appropriate for subagent delegation if needed). Sequential pipeline: discuss -> analyze -> plan -> execute -> verify.

**Content Quality**: --discuss adds Locked/Free/Deferred classification. --full adds plan-checking and verification. Scratch isolation. Works without init.

**Issues**: Line count (164) is slightly below typical Tier C range (100-200 expected), but the content is well-scoped. `Agent` is in allowed-tools but no explicit Agent() call is shown in the implementation -- it relies on the skill runner itself. Minor ambiguity.

### test/SKILL.md (198 lines) -- Score: 88%

**No spawn_agents_on_csv**: Correct -- verified absent.

**Appropriate Use**: Uses Agent tool for parallel debug diagnosis (Step 11: spawn one Agent per gap cluster). This is correct -- UAT is interactive/sequential, but diagnosis is a brief parallel step using Agent(), not CSV waves.

**Content Quality**: Interactive one-test-at-a-time presentation. Severity inference from natural language (never asks user). Session persistence via uat.md. Gap-fix closure loop (max 2 iterations). Agent calls correctly specify `run_in_background: false`.

**Issues**: None significant.

---

## Tier D Review (Simple)

### status/SKILL.md (89 lines) -- Score: 92%

**No agents, no CSV waves**: Correct. Pure read operations.

**Conciseness**: 89 lines -- well within 60-120 range.

**Content Quality**: 5-step implementation. Reads state.json, roadmap.md, phase index.json files. Dashboard rendering with milestones, phases, progress bars. Decision table for next-step suggestions (7 states mapped to Skill() references).

**Issues**: None.

### issue/SKILL.md (65 lines) -- Score: 90%

**No agents, no CSV waves**: Correct. Pure CRUD operations.

**Conciseness**: 65 lines -- well within range.

**Content Quality**: 6 subcommands (create, list, status, update, close, link). Issue schema references template. Bidirectional linking (issue <-> task). Auto-create directory. Error codes defined.

**Issues**: None.

### sync/SKILL.md (89 lines) -- Score: 89%

**No agents, no CSV waves**: Correct. Pure read/write with git diff.

**Conciseness**: 89 lines -- well within range.

**Content Quality**: 5-step implementation. Git diff change detection. 4-layer impact tracing (file -> component -> feature -> requirement). --dry-run support. State update with last_synced timestamp.

**Issues**: DESIGN.md tree places sync between Tier C skills (after refactor), but it is classified as Tier D in the text. The actual implementation confirms it is Tier D (no agents, 89 lines, pure utility). Minor tree ordering issue in DESIGN.md.

---

## Supporting Files Review

### schemas/review-tasks.md -- Score: 95%

Complete CSV schema with input/computed/output columns. Column lifecycle diagram showing data flow (Decomposer -> Wave Engine -> Agent). Output schema JSON valid with required fields. Validation rules (6 rules with checks and error messages). Discovery types with NDJSON format examples. Example CSV data is realistic.

### schemas/spec-map-tasks.md -- Score: 93%

Same structure as review-tasks.md. Simpler schema (11 columns, single wave). Validation rules include "No deps" rule (correct for single-wave topology). Discovery types appropriate for codebase mapping. Example data shows a realistic 4-mapper scenario with one failure.

### instructions/review-agent.md -- Score: 94%

Follows the instruction template pattern from DESIGN.md. Mandatory first steps (read discoveries, read project context, read specs). Column placeholders ({id}, {title}, {dimension}, etc.). Execution protocol with 5 steps. Discovery type sharing instructions with bash command template. Output JSON format with severity classification guide.

### instructions/spec-map-agent.md -- Score: 92%

Same template structure as review-agent.md. Focus area scoping guide (full vs specific). Discovery types limited to 4 (appropriate for mapping). Output file writing instruction included. Simpler output schema (no severity_counts or top_issues -- correct for mapping).

### Missing Schema/Instruction Files

DESIGN.md references `execute-tasks.md` and `execute-agent.md` but they do not exist in `schemas/` and `instructions/`. Only 2 of potentially 10 schema files and 2 of potentially 10 instruction files exist. However, the Tier A SKILL.md files embed their schemas and instruction logic directly, so this is a documentation inconsistency rather than a functional gap. The inline approach is actually more self-contained and easier to maintain.

---

## Cross-Cutting Checks

| Check | Status | Details |
|-------|--------|---------|
| Project name "maestro" (never "maestro2") | PASS | Zero occurrences of "maestro2" across all files |
| All 33 commands covered (32 skills + 1 router) | PASS | 32 skill directories + 1 router SKILL.md |
| Router covers all skills | FAIL | 11 of 32 skills missing from routing table |
| DESIGN.md directory matches reality | PASS | 32 skills in tree, 32 on disk |
| Shared files referenced consistently | WARN | 2 of 4 shared files missing (csv-utils.md, session-init.md) |
| No {{handlebars}} or TODO remaining | PASS | All matches are legitimate content (quality doc, verify anti-pattern scan) |
| Frontmatter consistent within tiers | PASS | Tier A: spawn_agents_on_csv in allowed-tools. Tier C/D: no spawn_agents_on_csv |
| Discovery board protocol followed | PASS | All Tier A/B skills include full discovery protocol |
| prev_context from CSV (not memory) | PASS | Explicitly stated in all Tier A/B skills |
| Skip-on-failure cascade | PASS | Present in all Tier A skills |
| Session structure (.workflow/.csv-wave/) | PASS | Consistent across all Tier A/B skills |
| Core rules present | PASS | All Tier A/B skills have 8-10 core rules |

---

## Critical Issues (Must Fix)

### 1. Router Missing 11 Skills (Severity: High)

The router SKILL.md routing table is missing entries for 11 skills:
- `codebase-rebuild`, `codebase-refresh` (Tier A/D)
- `memory-capture` (Tier D)
- `milestone-audit`, `milestone-complete` (Tier C)
- `phase-add`, `phase-transition` (Tier C)
- `quick` (Tier C)
- `spec-add`, `spec-load`, `spec-setup` (Tier D)

**Impact**: Users invoking these via the coordinator will hit the unmatched-intent fallback. The skills exist and work independently, but cannot be routed to from the coordinator.

**Fix**: Add 11 rows to the routing table in `SKILL.md`.

### 2. Missing Shared Files (Severity: Medium)

DESIGN.md declares `shared/csv-utils.md` and `shared/session-init.md` but they do not exist.

**Impact**: Documentation inconsistency. Session init is covered in wave-engine.md. CSV utils are handled inline in each skill. No functional gap, but DESIGN.md is inaccurate.

**Fix**: Either create the missing files or update DESIGN.md to reflect the actual 2-file shared structure.

---

## Recommendations

1. **Add missing routes** to the router SKILL.md -- highest priority, directly affects usability.

2. **Reconcile DESIGN.md** shared directory listing with reality (remove or create missing files).

3. **Fix DESIGN.md Tier D header** -- says "7 commands" but lists 9 in the table body.

4. **Consider extracting schemas/instructions** for more Tier A skills -- currently only review and spec-map have external schema/instruction files. The inline approach works but external files would enable reuse and make the instruction templates easier to update independently.

5. **Add `codebase-rebuild` and `codebase-refresh`** to the router chain definitions where appropriate (e.g., a `docs-rebuild` chain).

6. **sync placement in DESIGN.md tree** -- move after `codebase-refresh` to align with its Tier D classification.

---

## Scoring Breakdown (Weighted)

Using the quality standards formula: `Overall = WaveCorrectness * 0.35 + SchemaCompleteness * 0.25 + ExecutionLogic * 0.25 + ContentQuality * 0.15`

### Tier A Average (4 sampled)
- Wave Correctness: 95% (all 4 have correct topology, spawn_agents_on_csv, prev_context from CSV, skip cascade)
- Schema Completeness: 92% (all under 15 columns, required columns present, realistic examples)
- Execution Logic: 94% (full 3-phase in all, session init, --continue, concurrency)
- Content Quality: 92% (domain-specific decomposition, discovery types, error handling)
- **Weighted: 93.5%** -- PASS

### Tier B Average (2 sampled)
- Wave Correctness: 92% (correct 2-wave pattern, spawn_agents_on_csv for both)
- Schema Completeness: 90% (appropriate domain extensions)
- Execution Logic: 91% (2-phase with smart filtering)
- Content Quality: 90% (domain-specific modes, good error handling)
- **Weighted: 91.1%** -- PASS

### Infrastructure
- Router: 78% (missing routes)
- DESIGN.md: 85%
- Shared files: 82% (2 of 4 present)
- **Average: 82%** -- PASS (barely)

### Overall Project: **87%** -- PASS
