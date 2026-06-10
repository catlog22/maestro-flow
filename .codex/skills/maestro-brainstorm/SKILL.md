---
name: maestro-brainstorm
description: Use when exploring ideas, evaluating approaches, or needing multi-perspective analysis before implementation
argument-hint: "[topic] [-y|--yes] [-c|--concurrency N] [--continue] [--count N] [--skip-questions] [--review-only]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-role brainstorming via `spawn_agents_on_csv`. Diamond topology:
Wave 1 (guidance spec) → Wave 2 (parallel role analysis, 3-9 agents) → Wave 3 (cross-role review + resolution writeback).
Wave 2 agents produce multi-file analysis per role under `{role}/` (analysis.md index + per-feature files + findings).
Wave 3 compares Decision Digests from each role's `analysis.md` §2 and patches the role files. Audit trail appended to `guidance-specification.md` §12.
</purpose>

<context>
$ARGUMENTS — topic text and optional flags.

**Flags**: `-y` (auto), `-c N` (concurrency, default 6), `--continue` (resume), `--count N` (roles, default 3 max 9), `--skip-questions`, `--review-only` (skip Wave 1/2; run Wave 3 only against existing */analysis.md)

**9 valid roles**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert

### Pre-load specs
1. **Architecture specs**: `maestro spec load --category arch` — load architecture constraints as context for multi-role design (roles respect documented decisions).
2. **Role Knowledge**: `maestro search --category arch` → identify relevant entries → `maestro wiki load <id1> [id2...]`
3. Both optional — proceed without if unavailable.

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-brainstorm-{slug}/`

**Output** (per session):
- `guidance-specification.md` — machine contract (Wave 1; consumed by downstream roadmap/analyze/blueprint). §11 Decision Tracking, §12 Cross-Role Resolutions.
- `design-research.md` — optional, external research from Wave 1
- `{role}/analysis.md` — index + Decision Digest + cross-cutting foundations per selected role (Wave 2)
- `{role}/analysis-F-{id}-{slug}.md` — per-feature analysis files (Wave 2)
- `{role}/findings-{slug}.md` — additional discoveries (Wave 2, optional)
- `context-package.json` — standardized context contract (context-package/1.0 schema) for downstream commands
- `tasks.csv`, `results.csv`, `discoveries.ndjson`, `context.md` — wave-engine bookkeeping
</context>

<interview_protocol>
Interview the user relentlessly until shared understanding is reached. Active only in interactive mode; skip when `-y/--yes`, `--skip-questions`, `--continue` (existing session), or input is already specific.

- One decision per turn via request_user_input with 2–4 options + a (Recommended) default. The user controls termination — keep interviewing until convergence; they can interrupt naturally at any time.
- Search-first when uncertain: before asking, resolve via `state.json`, the session directory, `maestro spec load`, `maestro search`, Glob/Grep/Read, or — for open-ended multi-file scans — `maestro delegate ... --role explore`. Never ask what code or memory can verify; never bounce your own ambiguity back to the user — search first, then ask only what truly needs human judgment.
- Writeback cadence: each time a decision settles, immediately append/update its row in `guidance-specification.md` §11 (create the section if absent). Do NOT batch writeback to the end — partial decisions must already be on disk before the next question.
- Branch jumps allowed: the user may switch freely between mode / role / upstream / sub-pipeline branches; sequence is not enforced, but every decision point must end with a definite answer.
- Scope guard: only ask about decisions owned by `brainstorm`. Do not pre-resolve roadmap/plan choices.

Decision points: mode (auto / single-role / review-only) / role selection and `--count` / `--from` upstream source / whether to enable design-research and the DESIGN.md sub-pipeline.

Exit: on consensus or explicit user signal to proceed, finalize session metadata. The §11 table (already populated incrementally) uses this schema:
`| # | Decision | Choice | Source (user / code / default) |`
</interview_protocol>

<csv_schema>
```csv
id,title,description,role,topic,guidance_spec,deps,context_from,wave,status,findings,output_file,error
"1","Guidance Spec","<W1 prompt — see <agent_prompt_template>>","guidance-generator","<topic>","","","","1","","","",""
"2","System Architect","<W2 prompt — see <agent_prompt_template>>","system-architect","<topic>","","1","1","2","","","<ABS_SESSION>/system-architect/analysis.md",""
"3","UI Designer","<W2 prompt — see <agent_prompt_template>>","ui-designer","<topic>","","1","1","2","","","<ABS_SESSION>/ui-designer/analysis.md",""
"4","Cross-Role Review","<W3 prompt — see <agent_prompt_template>>","cross-role-reviewer","<topic>","","2;3","2;3","3","","","",""
```

**Column semantics (orchestrator MUST honor when generating tasks.csv)**:
- `description`: full agent prompt — orchestrator MUST inflate `<W1/W2/W3 prompt>` placeholders using the templates in `<agent_prompt_template>` below. Never leave it as `"..."` — the spawned agent reads ONLY this field as its task brief.
- `output_file`: **index file only** (single primary deliverable used by Wave 3 reviewer to locate the role). Wave 2 role agents write multiple files (`analysis.md` + per-feature + findings) under the same `{role}/` directory; the CSV only tracks the index path for dependency wiring.
- **All paths in CSV (`output_file`, any path referenced in `description`) MUST be absolute.** Orchestrator MUST resolve `<ABS_SESSION>` to the absolute session dir (e.g. `D:/proj/.workflow/.csv-wave/20260521-brainstorm-foo/`) before writing tasks.csv. Relative paths break agent Write calls.

Wave 1: 1 guidance row. Wave 2: N role rows (parallel) — each writes `{role}/analysis.md` + `{role}/analysis-F-*.md` + `{role}/findings-*.md`. Wave 3: 1 reviewer row (reads analysis.md §2 Decision Digests; emits structured findings consumed by orchestrator).
</csv_schema>

<agent_prompt_template>
The orchestrator MUST inflate the CSV `description` field per row using these templates before invoking `spawn_agents_on_csv`. Without inflation, spawned agents have no contract and will not write files.

### W1 prompt (role: guidance-generator)

```
You are the guidance generator for a brainstorm session on: <topic>.

OUTPUT: Write `<ABS_SESSION>/guidance-specification.md` using the Write tool. MUST be on disk; do NOT return as chat text.

CONTRACT — guidance-specification.md sections:
  §1 Project Positioning & Goals
  §2 Concepts & Terminology (5–10 core terms table)
  §3 Non-Goals (Out of Scope) with rationale
  §4–N Role Decisions with RFC 2119 keywords (MUST / SHOULD / MAY / MUST NOT / SHOULD NOT)
  Cross-Role Integration
  Risks & Constraints
  §10 Feature Decomposition (max 8 features, F-{3-digit} id + slug, independently implementable)
  §11 Decision Tracking appendix (incrementally populated during interview)
  §12 Cross-Role Resolutions (initially empty — populated by Wave 3)

CONSTRAINTS:
- All behavioural statements MUST use RFC 2119 keywords.
- No interrogative sentences in the deliverable (all declarative).
- After write, verify with Glob; emit `TASK COMPLETE` only after file exists on disk.
```

### W2 prompt (role: one of the 9 valid roles)

```
You are the <role> for a brainstorm session on: <topic>.

INPUTS:
- Read guidance-specification.md at: <ABS_SESSION>/guidance-specification.md
- Extract decisions belonging to your role (by ID prefix) and the §10 feature list.
- If <ABS_SESSION>/design-research.md exists, integrate it as evidence (cite by project name + section).

OUTPUT: Write multiple files under `<ABS_SESSION>/<role>/` using the Write tool. Files on disk are the ONLY valid deliverable — do NOT return analysis as chat text.

FILE LAYOUT (all under <ABS_SESSION>/<role>/):
  analysis.md                          — INDEX (see structure below)
  analysis-F-{id}-{slug}.md            — one per feature in guidance §10 (< 2000 words each)
  findings-{slug}.md                   — additional discoveries (0 or more, < 1000 words each)

analysis.md structure (MUST contain):
  §1 Role Mandate (≤ 200 words: what you decide, what you defer, why you are here)
  §2 Decision Digest — four tables:
       Decisions      | ID | Feature | Stance | Constraints (RFC 2119) |
       Interfaces     | Name | Contract | Consumers |
       Cross-Cutting Positions | Topic | Stance |
       Findings Summary | Slug | Title | Impact |
     MUST have ≥ 1 Decisions row per feature in §10.
  §3 Cross-Cutting Foundations — role-specific subsections (see role-specific addendum below).
  §4 File Index — list every written file with its top-level headings.
  §5 Outstanding TODOs

REFERENCE, DON'T DUPLICATE:
- Reference guidance decisions by ID (e.g., SA-03) — do NOT copy decision text.
- Cross-link sub-files with relative links: `see [F-002](analysis-F-002-skill-engine.md)`.

CONSTRAINTS:
- Aim for ≥ 5 RFC 2119 keyword occurrences across analysis.md.
- No interrogative sentences.
- After all writes, verify with Glob that analysis.md and every analysis-F-*.md exist. Only then emit `TASK COMPLETE`.

ROLE-SPECIFIC §3 ADDENDUM (use these as §3 subsection headings):
- system-architect:       Data Model · State Machine · Error Handling · Observability · Configuration · Boundary Scenarios
- data-architect:         Filesystem Layout · YAML Schemas · Indexer Algorithm · Ref Bridge · Lifecycle · Migration
- ux-expert:              Information Architecture · Sigil/Input · Visual Choreography · Streaming · Confirmation · Interrupt · Accessibility
- subject-matter-expert:  Pitfall Taxonomy · Pattern Fingerprints · Domain-Silence Decisions · Differentiation Thesis · Crosswalk
- test-strategist:        Test Layers · Coverage Targets · Risk-Based Prioritization · Tooling
- product-manager:        Personas · Success Metrics · Roadmap Shape · Prioritization Rationale
- product-owner:          Backlog Decomposition · Acceptance Criteria · Done Definition
- scrum-master:           Cadence · Ceremonies · Impediments · Flow Metrics
- ui-designer:            Design Tokens · Component States · Visual Language · Animation

(Orchestrator inflates only the addendum line matching the current row's role.)
```

### W3 prompt (role: cross-role-reviewer)

```
You are the cross-role reviewer for a brainstorm session on: <topic>.

INPUTS — read these files (do NOT modify):
- <ABS_SESSION>/guidance-specification.md
- <ABS_SESSION>/<role_1>/analysis.md
- <ABS_SESSION>/<role_2>/analysis.md
- ... (one per role from Wave 2)

(Orchestrator MUST inject the actual absolute paths for all completed Wave 2 rows.)

TASK: Compare §2 Decision Digests across role analysis.md index files. Identify:
- Conflicts: contradictory stances between roles on the same feature/topic
- Gaps: §2 Interfaces consumers referencing definitions that no role owns
- Synergies: §2 Findings Summary items that align across roles and should cross-reference

OUTPUT — return this structured markdown report as your final message (do NOT write files; the orchestrator parses your output and applies patches):

  ## Conflicts (need user decision)
  ### C-001: <one-line summary>
    patch_targets:
      - target_file: <ABS_SESSION>/<role-A>/analysis-F-{id}-{slug}.md  (or <role-A>/analysis.md for cross-cutting)
        target_heading: ## <exact heading text from §4 File Index>
        edit_type: annotate_and_strikeout
        edit_content: > **Cross-Role Resolution (C-001)**: <1-line resolution>
      - target_file: <ABS_SESSION>/<role-B>/analysis-F-{id}-{slug}.md
        target_heading: ## <exact heading text>
        edit_type: annotate_and_strikeout

  ## Gaps
  ### G-001: ...
    patch_targets:
      - target_file: <ABS_SESSION>/<ref-role>/analysis.md   edit_type: annotate_after_heading
        target_heading: ### Interfaces
      - target_file: <ABS_SESSION>/<owner-role>/analysis.md edit_type: append_to_section
        target_heading: ### Decisions

  ## Synergy Opportunities
  ### S-001: ...
    patch_targets:
      - target_file: <ABS_SESSION>/<role-A>/analysis-F-{id}-{slug}.md edit_type: annotate_after_heading
      - target_file: <ABS_SESSION>/<role-B>/analysis-F-{id}-{slug}.md edit_type: annotate_after_heading

  ## Summary
  conflicts_count / gaps_count / synergies_count / review_confidence (0–1)

CONSTRAINTS:
- `edit_type` is a CLOSED vocabulary: only `annotate_after_heading` / `annotate_and_strikeout` / `append_to_section`.
- `target_heading` MUST match the heading text verbatim as it appears in the target file's §4 File Index (case + punctuation). Never invent.
- If zero conflicts/gaps/synergies detected, return a `## Summary` block with all counts = 0 and a one-line explanation. Do not fabricate findings.
```
</agent_prompt_template>

<invariants>
1. **Wave order sacred**: Guidance (W1) MUST complete before role design (W2); review (W3) MUST run only after all W2 rows complete.
2. **CSV source of truth**: Master tasks.csv holds all state.
3. **Discovery board append-only**: Never modify/delete discoveries.ndjson.
4. **Skip on failure**: Guidance fails → abort. All W2 roles fail → skip review.
5. **9 valid roles only**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert
6. **Wave 3 is read-only at the agent boundary**: the reviewer emits structured findings (conflicts / gaps / synergies with `patch_targets[]`). The orchestrator (not the agent) applies the patches via Edit.
7. **DO NOT STOP**: Continuous until all waves complete; only pause at [CHECKPOINT] (skipped with -y).
8. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation. Do NOT bypass for "efficiency" or "clear intent" reasons.
9. **Evidence required** — role analysis findings in {role}/analysis.md §2 Decision Digest MUST cite concrete evidence: code references (file:line), API endpoints, data models from codebase exploration. Decisions without evidence are flagged LOW CONFIDENCE.
10. **Artifact verification before completion** — before reporting completion, verify ALL expected artifacts exist: guidance-specification.md, {role}/analysis.md (per selected role), {role}/analysis-F-*.md (per feature). If any missing: DO NOT report completion.
</invariants>

<spawn_contract>

All three waves invoke `spawn_agents_on_csv` with the same shape — only `instruction` (inflated from `<agent_prompt_template>`) and `max_concurrency` differ. The orchestrator MUST:

1. Filter master tasks.csv to `wave==N AND status=="pending"` before writing `wave-{N}.csv`.
2. Use the strict JSON Schema below for `output_schema`.
3. Append the shared termination contract to every inflated `description`.
4. Merge: map `result_status` → master `status`; copy `findings`, `output_path`, `error`.

**output_schema** (all waves):

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "output_path":   { "type": "string", "description": "Primary deliverable absolute path (W1: guidance-specification.md; W2: {role}/analysis.md; W3: review-findings.json)" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Shared termination contract** (append to every inflated W1/W2/W3 description):

```
TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Success path → all required files written AND verified via Glob → result_status=completed, output_path set
  - Failure path → unrecoverable error (write fail, missing input file) → result_status=failed
  - Blocked path → upstream missing (W2 cannot read guidance-spec; W3 cannot read analysis.md) → result_status=blocked
  - Timeout path → near max_runtime_seconds → finalize current write if safe → otherwise report blocked with error="timeout"
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
  - NEVER return analysis as chat text — files on disk are the ONLY valid deliverable.
  - Do NOT write to tasks.csv, wave-*.csv, results.csv.
  - Do NOT call spawn_agents_on_csv (no recursion).
```

</spawn_contract>

<state_machine>

<states>
S_PARSE      — 解析 topic、flags、mode                    PERSIST: —
S_ROLES      — 选择 roles（-y auto / interactive）        PERSIST: —
S_CSV_GEN    — 生成 tasks.csv                              PERSIST: tasks.csv
S_WAVE_1     — Guidance Spec (single agent)                PERSIST: guidance-specification.md
S_CHECK_1    — Checkpoint: 用户审阅 guidance（-y 跳过）    PERSIST: —
S_DESIGN     — 视觉风格确定 (impeccable teach + explore)   PERSIST: DESIGN.md
S_WAVE_2     — Role Analysis (parallel spawn)               PERSIST: {role}/ multi-file × N
S_CHECK_2    — Checkpoint: 用户审阅分析结果（-y 跳过）     PERSIST: —
S_WAVE_3     — Cross-Role Review (single agent, read-only) PERSIST: review_findings (in-memory)
S_RESOLVE    — Apply Resolutions (orchestrator-side)       PERSIST: */analysis.md edits + guidance §12
S_AGGREGATE  — 生成报告、注册 artifact                     PERSIST: context.md + results.csv
</states>

<transitions>
S_PARSE → S_ROLES      DO: parse args, detect mode (phase/scratch/review-only), load specs
S_ROLES → S_CSV_GEN    DO: select roles (-y: auto top N; interactive: request_user_input)
S_CSV_GEN → S_WAVE_1   DO: generate tasks.csv (1 guidance + N roles + 1 reviewer)

# --review-only path: skip W1/W2, jump straight to W3
S_PARSE → S_WAVE_3     WHEN: --review-only AND existing session has guidance-specification.md AND */analysis.md
S_PARSE → END          WHEN: --review-only AND missing prerequisites (E006/E007)

S_WAVE_1 → S_CHECK_1   WHEN: completed    DO: spawn wave-1, merge results, read guidance-spec
S_WAVE_1 → END         WHEN: failed       DO: abort pipeline

S_CHECK_1 → S_DESIGN   WHEN: (-y OR user "Proceed") AND ui-designer in selected_roles
S_CHECK_1 → S_WAVE_2   WHEN: (-y OR user "Proceed") AND ui-designer NOT in selected_roles
S_CHECK_1 → S_CHECK_1  WHEN: user "Revise"    DO: edit guidance-spec, re-display
S_CHECK_1 → END        WHEN: user "Abort"

S_DESIGN → S_WAVE_2    WHEN: DESIGN.md exists OR explore completed    DO: A_DESIGN_EXPLORE
S_DESIGN → S_WAVE_2    WHEN: DESIGN.md already exists (skip explore)
S_DESIGN → S_WAVE_2    WHEN: explore failed → W004 → retry once. If still fails: flag downstream outputs as LOW CONFIDENCE, continue without

S_WAVE_2 → S_CHECK_2   DO: spawn wave-2 (parallel), merge results — each agent writes {role}/analysis.md + sub-files
S_WAVE_2 → S_AGGREGATE WHEN: all failed       DO: skip review

S_CHECK_2 → S_WAVE_3   WHEN: -y OR user "Proceed"
S_CHECK_2 → S_WAVE_2   WHEN: user "Add Roles"  DO: add new role rows, spawn only new

S_WAVE_3 → S_RESOLVE   DO: spawn wave-3, capture review_findings (conflicts/gaps/synergies with patch_targets)
S_WAVE_3 → S_AGGREGATE WHEN: zero findings    DO: log "No cross-role issues detected", skip resolve

S_RESOLVE → S_AGGREGATE  DO: A_APPLY_RESOLUTIONS (orchestrator iterates patch_targets and applies Edits)

S_AGGREGATE → END      DO: A_AGGREGATE
</transitions>

<actions>

### Wave agent responsibilities

**Guidance (W1, agent role `guidance-generator`)**: Analyze topic → extract 5-10 terms → define non-goals → decompose features (max 8, F-{3digit}) → RFC 2119 keywords → write `guidance-specification.md` with §1-§12 (§11 Decision Tracking, §12 Cross-Role Resolutions initially empty — populated later by S_RESOLVE).

**Role Analysis (W2, agent role = the role name itself)**: Read guidance-spec → produce multi-file analysis under `{role}/`:
- `analysis.md` — INDEX with §1 Role Mandate (≤ 200 words), §2 Decision Digest (4 tables: Decisions, Interfaces, Cross-Cutting Positions, Findings Summary), §3 Cross-Cutting Foundations, §4 File Index, §5 Outstanding TODOs
- `analysis-F-{id}-{slug}.md` — one per feature (< 2000 words each)
- `findings-{slug}.md` — additional discoveries (0 or more, < 1000 words)

system-architect MUST include in §3: Data Model, State Machine, Error Handling, Observability, Configuration, Boundary Scenarios.

The agent MUST write files. The agent MUST NOT return analysis as text.

**Cross-Role Review (W3, agent role `cross-role-reviewer`)**: Read ALL `{role}/analysis.md` files (§2 Decision Digests) + guidance-specification.md → emit structured report (NOT files):

```
## Conflicts (need user decision)
### C-001: ...
  patch_targets:
    - target_file: {role-A}/analysis-F-{id}-{slug}.md   # or {role-A}/analysis.md for cross-cutting
      target_heading: ## {exact heading text}
      edit_type: annotate_and_strikeout
      edit_content: > **Cross-Role Resolution (C-001)**: {1-line resolution}
    - target_file: {role-B}/analysis-F-{id}-{slug}.md
      target_heading: ## {exact heading text}
      edit_type: annotate_and_strikeout

## Gaps
### G-001: ...
  patch_targets:
    - target_file: {ref-role}/analysis.md   edit_type: annotate_after_heading   # §2 Interfaces table
    - target_file: {owner-role}/analysis.md edit_type: append_to_section        # §2 Decisions table

## Synergy Opportunities
### S-001: ...
  patch_targets:
    - target_file: {role-A}/analysis-F-{id}-{slug}.md edit_type: annotate_after_heading
    - target_file: {role-B}/analysis-F-{id}-{slug}.md edit_type: annotate_after_heading

## Summary
conflicts_count / gaps_count / synergies_count / review_confidence
```

`edit_type` vocabulary is closed: `annotate_after_heading` / `annotate_and_strikeout` / `append_to_section`. The orchestrator MUST refuse any patch outside this set.

### A_DESIGN_EXPLORE

When ui-designer is among selected roles, establish visual direction before Wave 2:

1. If `.workflow/impeccable/PRODUCT.md` missing → run `$maestro-impeccable teach`
2. If `.workflow/impeccable/DESIGN.md` missing → run `$maestro-impeccable explore`
3. If both already exist → skip (visual direction already locked)

explore generates multi-style HTML prototypes, visual comparison, user selection/mix, and produces DESIGN.md.
ui-designer agents in Wave 2 then focus on UX/visual design referencing DESIGN.md.

### A_APPLY_RESOLUTIONS

For each finding in `review_findings`:

1. **Confirm with user** (skip if -y): present finding + suggested resolution; user picks `Accept` / `Pick A` / `Pick B` (conflict only) / `Skip` / `Defer to TODO`.
2. **Iterate `patch_targets[]`**: for each target, locate `target_heading` verbatim in `target_file`; apply the edit per `edit_type`.
3. **Heading drift fallback**: if `target_heading` not found verbatim, log W006 and skip that target. Never invent or fuzzy-match headings.
4. **Append audit row** to `guidance-specification.md` §12 "Cross-Role Resolutions":
   ```
   | C-001 | conflict | system-architect/analysis-F-*.md "<heading>" / subject-matter-expert/analysis-F-*.md "<heading>" | {resolution} | both annotated+superseded |
   ```

If zero findings, S_RESOLVE is bypassed and `guidance §12` is unchanged.

### A_AGGREGATE

1. Export results.csv
1.5. Generate context-package.json (extract from guidance-specification.md + {role}/analysis.md §2 Digests → standardized schema per context-package/1.0)
2. Generate context.md (summary, guidance, per-role analyses, review_findings_count, resolutions_applied, patches_skipped, next steps)
3. Confidence scoring: 5 dimensions (role_coverage, cross_role_consistency, feature_completeness, spec_quality, design_feasibility). Quality gate: cross_role_consistency < 0.4 → warn.
4. Copy artifacts to target session directory (preserve `{role}/` subdirs).
5. Next-step routing: DESIGN.md established → `maestro-impeccable build <feature>`; else UI features detected → `maestro-impeccable build <feature>`; else → maestro-analyze / maestro-plan / maestro-roadmap

</actions>
</state_machine>

<discovery_board>
| Type | Dedup Key | Data |
|------|-----------|------|
| terminology | term | {term, definition, aliases[], category} |
| non_goal | title | {title, rationale} |
| feature_candidate | id | {id, slug, description, roles[], priority} |
| role_insight | role+topic | {role, topic, insight, confidence} |
| cross_role_finding | finding_id | {kind: conflict\|gap\|synergy, finding_id: C-/G-/S-XXX, patch_targets[]} |
| resolution_applied | finding_id | {finding_id, decision, patched_files[], skipped_targets[]} |

Protocol: read before analysis, append-only, dedup by type+key.
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| Guidance agent failed | Abort pipeline (W2 depends on guidance) |
| All role agents failed | Skip review, report partial. Retry once. If still fails: flag downstream outputs as LOW CONFIDENCE |
| Review agent failed | Use analysis files directly, no resolution writeback. Retry once. If still fails: flag downstream outputs as LOW CONFIDENCE |
| Role count > 9 | Cap at 9 with warning |
| E006 --review-only but no */analysis.md | Run auto mode or single roles first |
| E007 --review-only but missing guidance-specification.md | Run auto mode first |
| W006 patch heading drift (no verbatim match) | Skip that patch, surface in final report |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decision table written to `guidance-specification.md` §11 and session metadata
- [ ] guidance-specification.md with RFC 2119 keywords, terminology, non-goals, feature decomposition (§10), decision tracking (§11)
- [ ] If ui-designer selected: DESIGN.md established via impeccable explore
- [ ] {role}/analysis.md written for each selected role with §1 Role Mandate / §2 Decision Digest (4 tables) / §3 Cross-Cutting Foundations / §4 File Index / §5 Outstanding TODOs
- [ ] {role}/analysis-F-{id}-{slug}.md written per feature (< 2000 words)
- [ ] system-architect/analysis.md §3 includes Data Model + State Machine when system-architect selected
- [ ] Each {role}/analysis.md §2 Decisions table has ≥ 1 row per feature
- [ ] Cross-role review (W3) executed; reviewer output includes `patch_targets[]` for every finding
- [ ] If findings: resolutions applied via Edit AND logged in guidance §12 "Cross-Role Resolutions"
- [ ] If zero findings: final report explicitly notes "No cross-role issues detected"; guidance §12 unchanged
- [ ] Heading-drift patch failures surfaced (not silently dropped)
- [ ] context-package.json generated with per-item `ref` traceability
- [ ] discoveries.ndjson append-only throughout
- [ ] context.md aggregates session results with next-step routing
- [ ] Session sealed via finish-work (auto mode only)
</success_criteria>

<on_complete>
@~/.maestro/workflows/finish-work.md — SESSION_DIR={output_dir}, SESSION_TYPE=brainstorm, SESSION_ID={artifact_id}, LINKED_MILESTONE=null
</on_complete>
