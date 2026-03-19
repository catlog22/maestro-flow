# Quality Review Report

**Date**: 2026-03-18
**Reviewer**: Automated Quality Review (csv-wave-skill-designer standards)
**Scope**: All files in `.codex/skills/maestro/` package

## Overall Score: 87%

**Verdict: PASS** (threshold: >= 80%)

---

## Per-File Scores

| File | Wave (35%) | Schema (25%) | Execution (25%) | Content (15%) | Overall | Verdict |
|------|------------|--------------|-----------------|---------------|---------|---------|
| `skills/review/SKILL.md` | 95% | 95% | 95% | 90% | 94% | PASS |
| `skills/spec-map/SKILL.md` | 85% | 85% | 85% | 85% | 85% | PASS |
| `schemas/review-tasks.md` | 95% | 100% | N/A | 95% | 97% | PASS |
| `instructions/review-agent.md` | 90% | N/A | 90% | 90% | 90% | PASS |
| `shared/wave-engine.md` | 100% | N/A | 90% | 80% | 93% | PASS |
| `shared/discovery-protocol.md` | N/A | N/A | 85% | 80% | 83% | PASS |
| `SKILL.md` (router) | N/A | N/A | 80% | 85% | 83% | PASS |
| `DESIGN.md` | N/A | N/A | N/A | 80% | 80% | PASS |

**Aggregate**: 87% — weighted average across applicable dimensions per file.

---

## Detailed File Reviews

### 1. `skills/review/SKILL.md` — Tier A Exemplar (Score: 94%)

**Wave Correctness (95%)**:
- Wave computation is correct: 2-wave topology (6 dimension agents wave 1, aggregation wave 2)
- deps and context_from properly distinguished in CSV example (aggregation row has both `1;2;3;4;5;6`)
- prev_context building explicitly described from master CSV findings (Phase 2, Wave 2 step 4)
- Skip-on-failure cascade present: "if all wave 1 tasks failed, skip aggregation"
- Wave blocking explicitly stated in Core Rules: "Never execute wave 2 before wave 1 completes and results are merged"
- Results merged into master CSV after each wave
- spawn_agents_on_csv call correct with proper parameters
- Minor gap: No explicit circular dependency detection (though 2-wave static topology makes this moot)
- Minor gap: No wave-level retry mechanism mentioned

**Schema Completeness (95%)**:
- All 9 required columns present: id, title, description, deps, context_from, wave, status, findings, error
- Domain columns: dimension, changed_files, project_specs, review_level, severity_counts, top_issues (6 domain columns)
- Total columns: 15 (at the limit, acceptable)
- output_schema JSON valid with required fields (id, status, findings)
- Description column is self-contained in example CSV
- Semicolon separator documented for multi-value columns

**Execution Logic (95%)**:
- Phase 1 (Decomposition): Present with domain-specific rules (level detection, dimension selection, file collection)
- Phase 2 (Wave Engine): spawn_agents_on_csv with proper parameters for each wave
- Phase 3 (Aggregation): results.csv export, context.md, review.json generation
- Instruction template referenced (buildReviewInstruction)
- Discovery board protocol included with domain-specific types
- Session init present with proper folder structure
- User validation checkpoint present (skip if -y)
- --continue mode supported
- Concurrency flag (-c N) supported
- Minor gap: No explicit wave-level retry (only error handling table)

**Content Quality (90%)**:
- Highly domain-specific: review dimensions, severity classification, verdict logic
- Realistic example CSV data with actual file paths and findings
- No {{handlebars}} or TODO remaining
- Usage examples are domain-appropriate
- Domain-specific error handling (phase not found, no changed files, agent timeout)
- Minor gap: Could include more varied example data (only auth files shown)

---

### 2. `skills/spec-map/SKILL.md` — Tier A Exemplar (Score: 85%)

**Wave Correctness (85%)**:
- Single-wave topology correctly implemented (all tasks wave 1, no deps)
- No circular dependency concern (no deps between tasks)
- No prev_context needed (single wave, no predecessors) — correctly noted
- Discovery board enables cross-mapper knowledge sharing
- Results merged from wave-1-results.csv
- spawn_agents_on_csv call correct
- Minor gap: No skip-on-failure cascade documented (though "Partial Results OK" rule covers intent)
- Minor gap: No wave-level retry mechanism
- Minor gap: No explicit Kahn's BFS reference (unnecessary for single wave, but consistency with shared/wave-engine.md would be good)

**Schema Completeness (85%)**:
- All 9 required columns present: id, title, description, deps, context_from, wave, status, findings, error
- Domain columns: focus_area, output_file (2 domain columns)
- Total columns: 11 (well within limit)
- output_schema JSON valid
- Description column is self-contained
- Gap: No separate schema doc file (review has `schemas/review-tasks.md`, spec-map does not)
- Gap: output_schema lacks domain-specific output columns (only base fields)

**Execution Logic (85%)**:
- Phase 1: Generate tasks.csv (less detailed decomposition rules than review)
- Phase 2: spawn_agents_on_csv with proper parameters
- Phase 3: Write output files to .workflow/codebase/, generate context.md
- Session init present
- --continue mode mentioned in usage
- Concurrency flag supported
- Gap: No explicit instruction template shown (review has a separate instruction file)
- Gap: No user validation checkpoint detail (just "Auto-confirm mapper assignment" in Auto Mode)
- Gap: Phase 1 decomposition rules are thin — just "Generate 4 mapper rows"

**Content Quality (85%)**:
- Domain-specific: 4 mapper dimensions (tech-stack, architecture, features, concerns)
- Realistic example CSV data
- No unresolved placeholders
- Usage examples domain-appropriate
- Gap: Less detailed than review — could benefit from more specific mapper instructions
- Gap: Error handling is minimal (4 entries vs review's 8)

---

### 3. `schemas/review-tasks.md` (Score: 97%)

**Wave Correctness (95%)**:
- Column lifecycle diagram clearly shows decomposer → wave engine → agent flow
- prev_context correctly noted as "per-wave CSV only" (not in master)
- Wave column properly documented as computed

**Schema Completeness (100%)**:
- All 9 required columns present and fully documented
- Input/Computed/Output phases clearly separated
- Column types, required status, examples all present
- Validation rules comprehensive (6 rules covering uniqueness, deps validity, self-deps, enum values)
- output_schema JSON valid and matches SKILL.md

**Content Quality (95%)**:
- Example data is realistic with actual findings
- Discovery types well-documented with NDJSON examples
- Domain-specific validation rules
- Minor: Could include example of a "failed" or "skipped" task row

---

### 4. `instructions/review-agent.md` (Score: 90%)

**Wave Correctness (90%)**:
- prev_context placeholder present (`{prev_context}`)
- Discovery board read-first protocol correct
- Context flow from previous tasks properly handled
- Gap: No explicit mention of report_agent_job_result function name (says "Return JSON via report_agent_job_result" but no explicit function call syntax)

**Execution Logic (90%)**:
- Uses {column_name} placeholders correctly: {id}, {title}, {dimension}, {review_level}, {description}, {changed_files}, {project_specs}, {prev_context}, {session_folder}
- Discovery board protocol included with all 6 domain types
- Severity classification guide is excellent (domain-specific examples)
- Output JSON structure matches output_schema
- Gap: No explicit handling for aggregation dimension's unique behavior (mentioned in step 3 as a bullet, but could be more detailed)

**Content Quality (90%)**:
- Highly domain-specific severity classification
- Clear execution protocol steps
- Discovery types with proper data schemas
- No unresolved placeholders (all use {column} format correctly)

---

### 5. `shared/wave-engine.md` (Score: 93%)

**Wave Correctness (100%)**:
- Kahn's BFS algorithm fully specified (4-step pseudocode)
- Circular dependency detection: "Any task without wave assignment = circular dependency error"
- prev_context building from master CSV explicitly documented
- Skip-on-failure cascade fully specified
- Wave execution loop with proper merge-before-next-wave blocking
- Temp CSV cleanup included

**Execution Logic (90%)**:
- Complete wave execution loop (9 steps)
- Master CSV merge procedure documented
- prev_context building rules clear
- Gap: No spawn_agents_on_csv call syntax shown (referenced conceptually)
- Gap: No wave-level retry mechanism (only skip-on-failure)

**Content Quality (80%)**:
- Generic by design (shared utility, not domain-specific)
- Clear algorithms and procedures
- Good session initialization template
- Gap: No example showing full wave execution flow
- Gap: Could include error recovery patterns

---

### 6. `shared/discovery-protocol.md` (Score: 83%)

**Execution Logic (85%)**:
- 5-step agent protocol clearly defined
- NDJSON format well-documented
- Dedup key system for each type
- Append command template included
- Gap: No protocol for reading/parsing NDJSON (only write)
- Gap: No size limits or rotation policy

**Content Quality (80%)**:
- 6 standard discovery types (good baseline)
- Generic by design (shared across skills)
- Realistic NDJSON examples
- Gap: No guidance on when to use each type
- Gap: No error handling for write failures (concurrent appends)

---

### 7. `SKILL.md` — Router (Score: 83%)

**Execution Logic (80%)**:
- Routing table comprehensive (23 intent patterns)
- Chain definitions cover major workflows (7 chains)
- State-based routing for continue/next
- Session tracking structure defined
- Gap: No explicit fallback for unmatched intents
- Gap: No chain execution logic detail (just "execute skills sequentially, propagating artifacts")
- Gap: --dry-run mentioned but no implementation detail

**Content Quality (85%)**:
- Domain-specific routing table
- Realistic usage examples
- Chain definitions match DESIGN.md
- Flag documentation complete (-y, --chain, --dry-run)

---

### 8. `DESIGN.md` (Score: 80%)

**Content Quality (80%)**:
- Comprehensive migration design with 4 tiers
- All 10 Tier A schemas documented
- Architecture diagram clear
- Migration priority phased
- Generation plan with meta-bootstrapping
- Gap: Only 2 of 10 Tier A skills actually implemented (review, spec-map)
- Gap: Directory structure shows `schemas/` under `skills/` but actual structure places `schemas/` at package root
- Gap: Some Tier A schema designs (A3-A10) are design-only, not yet validated against implementation

---

## Critical Issues (Must Fix)

1. **Directory structure mismatch in DESIGN.md**: The design shows `skills/{name}/schemas/` nested under each skill, but actual implementation has `schemas/` at the package root level (`schemas/review-tasks.md`). The `instructions/` directory is also at root level, not under individual skills. DESIGN.md architecture diagram should be updated to match reality.

2. **spec-map missing schema doc**: Review has `schemas/review-tasks.md` but spec-map has no equivalent `schemas/spec-map-tasks.md`. For consistency and completeness, a schema doc should be created.

3. **spec-map missing instruction file**: Review has `instructions/review-agent.md` but spec-map has no equivalent `instructions/spec-map-agent.md`. The instruction template is embedded in SKILL.md conceptually but not materialized as a separate file.

---

## Warnings (Should Fix)

1. **No wave-level retry in any skill**: The quality standards checklist includes "Wave-level retry mechanism present" but neither review nor spec-map implements retry. Both only handle failure via skip-on-failure cascade. Consider adding a retry-once mechanism for transient agent failures.

2. **spec-map Phase 1 decomposition rules are thin**: Review has detailed decomposition rules (level detection, dimension selection, file collection). Spec-map's Phase 1 just says "Generate 4 mapper rows. If focus_area is specified, scope descriptions to that area." Should include explicit rules for how focus_area modifies each mapper's description.

3. **No explicit circular dependency detection in skill files**: The shared wave-engine.md covers this, but neither SKILL.md references the shared file explicitly. Skills should reference `shared/wave-engine.md` for wave computation.

4. **review SKILL.md column count at limit (15)**: The review schema has exactly 15 columns, which is the maximum allowed. Any future additions would require removing or merging columns.

5. **discovery-protocol.md lacks read/parse guidance**: The protocol focuses on writing but doesn't specify how agents should parse and filter NDJSON on read. Consider adding a read template.

6. **Router SKILL.md lacks unmatched intent handling**: No fallback behavior defined for intents that don't match any pattern. Should include a "suggest closest match" or "ask for clarification" fallback.

---

## Recommendations

1. **Create spec-map supporting files**: Add `schemas/spec-map-tasks.md` and `instructions/spec-map-agent.md` to match the review skill's completeness. This would raise spec-map's score from 85% to ~92%.

2. **Add cross-references to shared files**: Each SKILL.md should explicitly reference `shared/wave-engine.md` and `shared/discovery-protocol.md` to avoid duplicating logic and ensure consistency.

3. **Add wave retry mechanism**: Even a simple "retry failed agents once" would satisfy the quality standards checklist item. Could be added to `shared/wave-engine.md` and inherited by all skills.

4. **Expand spec-map decomposition rules**: Add explicit logic for:
   - How focus_area narrows each mapper's scope
   - What happens when .workflow/codebase/ already has content (merge vs overwrite)
   - File discovery patterns for each mapper dimension

5. **Update DESIGN.md architecture diagram**: Reflect actual directory structure where `schemas/` and `instructions/` are at the package root, not nested under `skills/`.

6. **Add a shared CSV utilities file**: `shared/csv-utils.md` is listed in DESIGN.md but not yet created. This would house CSV read/write/merge patterns referenced by all skills.

7. **Consider adding session-init.md**: Also listed in DESIGN.md but not created. Would standardize session initialization across skills.

---

## Consistency Check

### Cross-Skill Structural Consistency

| Aspect | review | spec-map | Consistent? |
|--------|--------|----------|-------------|
| SKILL.md frontmatter | Yes (name, description, argument-hint, allowed-tools) | Yes (same format) | YES |
| Auto Mode section | Yes | Yes | YES |
| Usage section with flags | Yes (-y, -c, --continue) | Yes (same flags) | YES |
| Overview with ASCII diagram | Yes | Yes | YES |
| CSV Schema section | Yes (detailed) | Yes (detailed) | YES |
| Implementation section | Yes (session init + 3 phases) | Yes (session init + 3 phases) | YES |
| Discovery Board section | Yes (domain + standard types) | Yes (standard types only) | YES |
| Error Handling table | Yes (8 entries) | Yes (4 entries) | PARTIAL |
| Core Rules section | Yes (8 rules) | Yes (6 rules) | PARTIAL |
| Separate schema doc | Yes (schemas/review-tasks.md) | No | NO |
| Separate instruction file | Yes (instructions/review-agent.md) | No | NO |

### Shared File References

| Shared File | Referenced by review? | Referenced by spec-map? | Consistent? |
|-------------|----------------------|------------------------|-------------|
| wave-engine.md | Implicitly (follows pattern) | Implicitly (follows pattern) | YES (but should be explicit) |
| discovery-protocol.md | Yes (protocol section) | Yes (protocol section) | YES |

### DESIGN.md vs Implementation Accuracy

| Claim in DESIGN.md | Actual State | Match? |
|---------------------|-------------|--------|
| Router SKILL.md routing table | 23 entries vs 11 in design | EXPANDED (good) |
| Review schema: 14 columns | Actual: 15 columns (added review_level) | MINOR DRIFT |
| Spec-map schema: 11 columns | Actual: 11 columns | MATCH |
| Session structure path pattern | Matches in both skills | MATCH |
| Discovery types for review | Matches (4 domain + 2 standard) | MATCH |
| Instruction template pattern | Followed by review-agent.md | MATCH |
| Tier A: 10 commands listed | Only 2 implemented (review, spec-map) | PARTIAL (expected — phased rollout) |

### Router Consistency

| Router Entry | Skill Exists? | Match? |
|--------------|--------------|--------|
| review → skills/review/ | Yes | YES |
| spec-map → skills/spec-map/ | Yes | YES |
| execute → skills/execute/ | No (not yet) | EXPECTED |
| brainstorm → skills/brainstorm/ | No (not yet) | EXPECTED |
| (other 19 entries) | Not yet | EXPECTED |

---

## Summary

The maestro Codex skills package demonstrates strong quality in its two Tier A exemplars (review and spec-map). The review skill is particularly well-crafted at 94%, serving as an excellent reference for future skill generation. The shared utilities (wave-engine, discovery-protocol) provide a solid foundation.

The primary gaps are:
1. Structural inconsistency between review (has schema doc + instruction file) and spec-map (lacks both)
2. DESIGN.md directory structure doesn't match actual layout
3. Missing shared utility files listed in design (csv-utils.md, session-init.md)
4. No wave-level retry mechanism in any file

These are all addressable issues that don't undermine the core architecture. The package is ready for continued Tier A skill generation using review as the exemplar template.
