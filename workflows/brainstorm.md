<!-- session-mode: inherited -->
# Workflow: Brainstorm

## Run Mode Contract

This workflow executes inside the Run created by its command. The command-provided `run_id`, `run_dir`, and resolved `upstream` are authoritative. Formal outputs belong in `{run_dir}/outputs/`, evidence in `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`. Protocol JSON is CLI-owned.

### Legacy Compatibility Mapping

Legacy references to `scratch/`, hidden command directories, milestone/phase artifact folders, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with `maestro run check` plus `maestro run complete`.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  /maestro-brainstorm                    │
│           Unified Entry Point + Interactive Routing      │
└───────────────────────┬─────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              ↓                   ↓
    ┌─────────────────┐  ┌──────────────────┐
    │   Auto Mode     │  │ Single Role Mode │
    └────────┬────────┘  └────────┬─────────┘
             │                    │
    ┌────────┬──────────┬───────┐    │
    ↓        ↓          ↓       ↓    ↓
 Phase 2  Phase 3    Phase 4 Phase 5 Phase 3
Artifacts N×Role     Cross-  Apply  1×Role
          Analysis   Role    Resol. Analysis
          (multi-    Review
           file)     (digest)
```

## Dual-Mode Routing

**Auto Mode** (`--yes`/`-y`): Phase 1 → 1.5 → 2 → 3 → 4 → 5 (full pipeline)
**Single Role Mode** (first arg = role name): Phase 1 → 3 (single role)

## Input

- `$ARGUMENTS`: topic text (auto mode) or role name (single role mode)
- All output goes to `.workflow/scratch/{YYYYMMDD}-brainstorm-{slug}/`
- Registers artifact (type=brainstorm) in state.json on completion

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--yes`, `-y` | Auto mode, skip all questions | - |
| `--count N` | Number of roles to select | 3 |
| `--session ID` | Use existing session | - |
| `--update` | Update existing analysis | - |
| `--include-questions` | Interactive context gathering | - |
| `--skip-questions` | Use default answers | - |
| `--style-skill PKG` | Style package for ui-designer | - |
| `--review-only` | Skip Phase 3 (role analysis); run only Step 4.5 + Step 5 on existing role analyses | - |

### Available Roles

| Role ID | Title | Focus Area |
|---------|-------|------------|
| `data-architect` | 数据架构师 | Data models, storage strategies, data flow |
| `product-manager` | 产品经理 | Product strategy, roadmap, prioritization |
| `product-owner` | 产品负责人 | Backlog management, user stories, acceptance criteria |
| `scrum-master` | 敏捷教练 | Process facilitation, impediment removal |
| `subject-matter-expert` | 领域专家 | Domain knowledge, business rules, compliance |
| `system-architect` | 系统架构师 | Technical architecture, scalability, integration |
| `test-strategist` | 测试策略师 | Test strategy, quality assurance |
| `ui-designer` | UI设计师 | Visual design, mockups, design systems |
| `ux-expert` | UX专家 | User research, information architecture, journey |

## Output

### Directory Structure

All brainstorm output goes to scratch:
```
.workflow/scratch/{YYYYMMDD}-brainstorm-{slug}/
├── guidance-specification.md          # Phase 2 output — machine contract (downstream consumes this)
├── design-research.md                 # Optional Step 1.7 output
├── system-architect/                  # Phase 3 per-role analysis (one folder per selected role)
│   ├── analysis.md                    # INDEX — digest + cross-cutting foundations + file index
│   ├── analysis-F-001-agent-loop.md   # per-feature analysis
│   ├── analysis-F-002-skill-engine.md
│   └── findings-perf-risk.md          # additional discoveries
├── ux-expert/
│   ├── analysis.md
│   ├── analysis-F-001-agent-loop.md
│   └── analysis-F-003-tui-frontend.md
└── {role}/
    └── ...
```

---

## Process

### Step 1: Parse & Route (Mode Detection)

**Mode Detection (priority order)**:
1. `--review-only` flag → **Review-Only Mode** (requires `--session ID`; runs Step 4.5 + Step 5 only)
2. `--yes` or `-y` flag → **Auto Mode** (no question asked)
3. First non-flag arg matches valid role name → **Single Role Mode**
4. First non-flag arg is a number → **Phase Mode** (resolve phase dir, then auto)
5. Text provided without flags → Ask user via AskUserQuestion:
   - "自动模式 (推荐)" — 完整流程：框架生成 → 多角色并行分析 → 跨角色复审 → 决议回流
   - "单角色分析" — 为单个角色生成 {role}/ 分析文件
   - "跨角色复审" — 已有多个角色分析，仅运行复审与决议回流

**Parameter Parsing**:
- `--count N`: cap at 9, default 3
- `--session ID`: target specific session
- `--from <source>`: load upstream context package (grill:ID, blueprint:ID, @file, or path)
- `--style-skill PKG`: validate `.claude/skills/style-{PKG}/SKILL.md` exists
- Missing/empty args without flags = error E001

**Session Detection**:
- Check `.workflow/scratch/*-brainstorm-*/` for existing sessions
- Multiple → AskUserQuestion to select | Single → use it
- None + auto mode → will create new session
- None + single role mode → error E002

**Output Directory Resolution**:
- Phase mode (number): resolve `state.json.artifacts[phase == phaseNum].path` → `.workflow/{path}/.brainstorming/` (ERROR if phase not found)
- All output: `.workflow/scratch/{YYYYMMDD}-brainstorm-{slug}/`
- Existing session: use existing session directory

---

### Step 1.3: Load Upstream Context (if `--from`)

Resolve to `context-package.json` (`grill:ID` / `blueprint:ID` / `@file` / `path/`).

Pre-seed from context-package:
- `domain.terminology[]` → Step 2 (skip locked terms)
- `constraints[locked]` → guidance §4-N
- `non_goals[]` → Step 2
- `open_questions[]` → Step 3 Phase 1
- `insights[]` → Step 4 role agents
- `requirements[]` → Step 3 Phase 4.5

W007 if source not found: continue without upstream; flag guidance-specification.md as [LOW CONFIDENCE] (no upstream context).

---

### Step 1.5: Load Project Specs

```
specs_content = maestro spec load --category arch
```

---

### Step 1.7: External Research — Design Routes (Auto Mode, Optional)

**Trigger**: Always in auto mode. Skip if `--skip-questions` and no tech keywords.

```
// Step 1.7.1: Spawn external researcher for design routes — MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
Agent(
  subagent_type="workflow-external-researcher",
  prompt="""
<objective>
Research design alternatives and architecture patterns for: {topic}
Mode: Design Research
</objective>

<context>
Project specs: {specs_content or "none"}
Topic keywords: {extracted_keywords}
</context>

<task>
Search for:
1. Reference projects — how 2-3 similar projects/products solve this problem (architecture, key decisions, what worked)
2. Extractable patterns — reusable design patterns distilled from those projects, with applicability notes
3. Architecture approaches (at least 2-3 alternatives with trade-offs)
4. UX/UI patterns if applicable (interaction models, layout strategies)
5. Common design pitfalls and anti-patterns to avoid

IMPORTANT: Output MUST include "Reference Projects / Implementations" and "Extractable Patterns" sections.
Focus on design ROUTES — alternative approaches the brainstorm roles can evaluate.
Be prescriptive where evidence is strong, present alternatives where trade-offs exist.
Return structured markdown only — do NOT write files.
</task>
  """,
  run_in_background=false
)

// Step 1.7.2: Store as designResearchContext (in-memory)
designResearchContext = agent_output
```

`designResearchContext` → Steps 2, 3, 4. Persisted to `{output_dir}/design-research.md`.

W005 on failure: continue without external context; flag role analyses as [LOW CONFIDENCE] (no design research).

---

### Step 1.8: Load Project Context (if `.workflow/` exists)

- `project.md`: Validated → already_shipped, Active → current_scope
- `state.json.accumulated_context`: `deferred[]` → brainstorming seeds, `key_decisions[]` → constraints

Pass into Steps 2 and 3.

---

### Step 2: Terminology & Boundary Definition (Auto Mode)

1. Load existing domain terms: read `.workflow/domain/glossary.yaml` 中已注册术语，避免重复定义
2. Extract 5-10 core domain terms (merge upstream locked terms + existing glossary terms)
3. AskUserQuestion for Non-Goals (multiSelect, include "其他" option)
4. Store terminology + non_goals to session

新候选术语仅存入 `context-package.json#domain.terminology[]`，不直接写 glossary.yaml。由 chain 末尾 `manage-harvest --auto` 触发 finish-work Step 3.5 统一提升为正式术语。

**Skip if**: `--yes` (auto-generate terms, empty non-goals)

### Step 3: Interactive Framework Generation (Auto Mode)

Seven sub-phases producing guidance-specification.md:

**Phase 0: Context Collection**
- Read init outputs directly: `.workflow/project.md` (tech stack, requirements, decisions), `.workflow/state.json` (project state), `.workflow/specs/` (conventions)
- If `.workflow/` does not exist: continue without project context

**Phase 1: Topic Analysis**
- Load Phase 0 context (tech_stack, modules, conflict_risk)
- Deep topic analysis (entities, challenges, constraints, metrics)
- Generate 2-4 context-aware probing questions via AskUserQuestion
- Questions MUST reference topic keywords (no generic questions)
- Store to `session.intent_context`

**Phase 2: Role Selection**
- Analyze Phase 1 keywords → recommend count+2 roles with rationale
- AskUserQuestion (multiSelect=true) for user to select `count` roles
- If `--yes`: auto-select recommended roles
- Store to `session.selected_roles`

**Phase 3: Role-Specific Questions**
- FOR each selected role, generate 3-4 deep questions mapping role expertise to Phase 1 challenges
- AskUserQuestion per role (sequential, one role at a time)
- Questions must include: implementation depth, trade-offs, edge cases
- Store to `session.role_decisions[role]`
- If `--yes`: skip all role questions

**Phase 4: Conflict Resolution**
- Analyze Phase 3 answers for contradictions, missing integrations, implicit dependencies
- Generate clarification questions referencing SPECIFIC Phase 3 choices
- AskUserQuestion (max 4 per round)
- If NO conflicts detected: skip with notification
- Store to `session.cross_role_decisions`

**Phase 4.5: Final Clarification + Feature Decomposition**
- Ask: "是否有前面未澄清的重点需要补充？" (无需补充 / 需要补充)
- If "需要补充": progressive questions until resolved
- Extract candidate features from all Phase 1-4 decisions (max 8)
- Each feature: F-{3-digit} ID, kebab-case slug, description, related roles, priority
- Validate: independence, completeness, granularity balance, boundary clarity
- AskUserQuestion for user to confirm or adjust feature list
- Store to `session.feature_list`

**Phase 5: Generate Specification**
- Load all decisions + terminology + non_goals + feature_list
- Transform Q&A to declarative statements (CONFIRMED/SELECTED)
- Apply RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT)
- Write `guidance-specification.md` with sections:
  1. Project Positioning & Goals
  2. Concepts & Terminology (table)
  3. Non-Goals (Out of Scope)
  4-N. [Role] Decisions (with RFC 2119)
  Cross-Role Integration
  Risks & Constraints
  §10. Feature Decomposition (table)
  §11. Appendix: Decision Tracking
  §12. Cross-Role Resolutions (initially empty — populated by Step 5)
- Validate: no interrogative sentences, all decisions traceable, RFC keywords applied

**Output**: `{output_dir}/guidance-specification.md`, session metadata (workflow-session.json)

**GATE Step 3→4**: REQUIRED `guidance-specification.md` written with §10 Feature Decomposition list; BLOCKED if `guidance-specification.md` missing or §10 feature list absent.

### Step 3.5: Visual Style Foundation (Auto Mode, conditional)

**Condition**: `ui-designer` selected AND `.workflow/impeccable/DESIGN.md` does not exist. Skip with `--skip-design`.

1. If PRODUCT.md missing: `Skill({ skill: "maestro-impeccable", args: "teach" })`
2. `Skill({ skill: "maestro-impeccable", args: "explore" })` → produces DESIGN.md
3. Record `design_system_established: true` in session metadata

`--yes`: auto-selects variant 1.

### Step 4: Parallel Role Analysis (Auto Mode)

Spawn `role-design-author` per role in parallel. ALWAYS use absolute paths. Pass `null` (literal string) for absent optional fields.

```
// MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
Agent({
  subagent_type: "role-design-author",
  prompt: """
    role_name: {role}
    role_template_path: <ABSOLUTE path to planning-roles/{role}.md>
    guidance_path: <ABSOLUTE {output_dir}>/guidance-specification.md
    output_dir: <ABSOLUTE {output_dir}>/{role}/
    feature_list: <F-id + slug + title rows from guidance §10>
    design_research: <ABSOLUTE path>/design-research.md  OR  null
    project_specs: <specs_content text>  OR  null
    user_context: <session.role_decisions[role] text>  OR  null
    style_skill: <ABSOLUTE style-skill SKILL.md path>  OR  null

    Follow the Output Contract in `.claude/agents/role-design-author.md` (§1 Role Mandate,
    §2 Decision Digest with 4 tables, §3 Cross-Cutting Foundations, §4 File Index, §5 TODOs)
    — this is authoritative. The role template's "Brainstorming Analysis Structure" section
    is legacy single-file scaffolding; ignore it for file layout. Use the role template ONLY
    for §3 subsection headings (via the "MUST-Have Sections (Brainstorming)" block when present).

    Reference guidance decisions by ID (e.g., SA-03) — do NOT copy decision text.
    All behavioural statements MUST use RFC 2119 keywords.

    MUST use the Write tool to persist every file under output_dir/. After all writes, verify
    with Glob that `analysis.md` and each `analysis-F-*.md` exist on disk, then emit the
    `TASK COMPLETE` return protocol. Returning analysis as text without files is failure.
  """,
  run_in_background: false
})
```

**Output per role**: `analysis.md` (index), `analysis-F-{id}-{slug}.md` (per feature, <2000 words), `findings-{slug}.md` (optional, <1000 words).

**Validation** (read only `analysis.md`):
- §2: ≥1 decision per feature, RFC 2119 keywords present
- §4: listed files exist on disk, feature coverage matches
- system-architect: §3 has "Data Model" and "State Machine" headings

**GATE Step 4→4.5**: REQUIRED all `{role}/analysis.md` verified on disk via Glob (per role in selected_roles); BLOCKED if any `analysis.md` missing.

### Step 4.5: Cross-Role Review (Auto Mode)

Spawn ONE `cross-role-reviewer` to compare Decision Digests across roles.

```
// MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
Agent({
  subagent_type: "cross-role-reviewer",
  prompt: """
    analysis_indexes:
      - {output_dir}/{role_1}/analysis.md
      - {output_dir}/{role_2}/analysis.md
      - ...
    guidance_path: {output_dir}/guidance-specification.md
    feature_list: <F-id + slug + title rows from guidance §10>

    Compare Decision Digests (§2) across these role analysis index files.
    Identify conflicts, gaps, and synergy opportunities.
    Use §4 File Index for accurate patch target file paths and headings.
    Return the structured report — do NOT write files.
  """,
  run_in_background: false
})
```

**Output**: `conflicts[]`, `gaps[]`, `synergies[]`, `need_deeper_context[]` (optional).

If `need_deeper_context`: read specific files, re-invoke reviewer. Skip Step 5 if all arrays empty.

`--yes`: auto-apply resolutions (still proceed to Step 5 writeback).

### Step 5: Apply Cross-Role Resolutions (Auto Mode)

**5.1: Interactive Confirmation (skip if `--yes`)**

AskUserQuestion per finding (max 4 per round). MUST cite exact role folder + `target_heading`.

**5.2: Apply Patches to Role Files**

Consume `patch_targets[]` per finding. Edit types: `annotate_after_heading` / `annotate_and_strikeout` / `append_to_section`.

| Type | Action |
|------|--------|
| Conflict (`annotate_and_strikeout`) | Insert resolution blockquote after heading, wrap original in `<!-- superseded -->` |
| Gap (`annotate_after_heading` + `append_to_section`) | Breadcrumb at reference site, definition at owner site. Both MUST succeed. |
| Synergy (`annotate_after_heading` × 2) | Cross-reference in BOTH files. Original untouched. |

**On heading mismatch**: skip patch, log finding ID, surface in Step 7 report. NEVER invent headings.

**5.3: Append to guidance §12**
```markdown
### Cross-Role Resolutions (added {date})
| ID | Type | Source(s) | Resolution | Applied to |
|---|---|---|---|---|
| C-001 | conflict | system-architect/analysis-F-002-skill-engine.md "## Architecture" / sme/analysis-F-002-skill-engine.md "## Constraints" | {answer} | both files patched |
| G-001 | gap | ux-expert/analysis.md "### Interfaces" | {answer} | data-architect/analysis.md "### Decisions" |
| S-001 | synergy | ux-expert/analysis-F-005-tui.md "## Interface Contract" / sme/findings-ndjson.md "## Recommendation" | applied | both annotated |
```

**5.4: Finalization** — Update session metadata, emit completion report (Step 7).

---

### Step 6: Single Role Analysis

**Step 6.1: Detection & Validation**
- Validate role_name against VALID_ROLES list
- Detect session (--session or find existing)
- Check for guidance-specification.md → framework_mode
- Extract feature list from guidance §10 → feature_mode
- Check existing `{role}/analysis.md` → update_mode (ask: update/regenerate/cancel)

**Step 6.2: Interactive Context Gathering**
- Skip if `--skip-questions`
- Force if `--include-questions`
- Generate 3-5 role-specific questions (Chinese, with business context)
- AskUserQuestion per batch (max 4 per round)
- Pass collected answers as `user_context` to the agent (in-memory; not persisted to a separate file)

**Step 6.3: Agent Execution**
- Spawn role-design-author with full Inputs block (see Step 4 schema)
- Agent writes files under `{output_dir}/{role}/`

**Step 6.4: Validation**
- Read `{role}/analysis.md` — verify exists and non-empty
- Check §2 Decision Digest tables present
- Check §4 File Index matches files on disk
- Check framework reference if framework_mode
- Update session metadata with completion status
- Report results with next step suggestions

---

### Step 6.5: Review-Only Mode (`--review-only --session ID`)

**Step 6.5.1: Validation**
- Require `--session ID`. Error E002 if missing.
- Glob `{output_dir}/*/analysis.md`. Error E006 if zero files found (no role analyses to review).
- Require `guidance-specification.md` to exist (for decision-ID context). Error E007 if missing.

**Step 6.5.2**: Run Step 4.5 + Step 5. Skip 5.1 if `--yes`.

**Step 6.5.3**: Report (same as review-only report in Step 7).

---

### Step 7: Final Report

**Auto mode report:**
- Session ID and output directory
- Roles analyzed (N) — list each `{role}/analysis.md` path
- Files written per role (from agent return protocol)
- Features in scope (N, from guidance §10)
- Cross-role review: conflicts / gaps / synergies counts
- Resolutions applied: count + a breakdown by type (C/G/S)
- Next:
  Skill({ skill: "maestro-roadmap", args: "--mode full --from brainstorm:{artifactId}" })  — Generate full spec package
  Skill({ skill: "maestro-analyze", args: "{topic}" })   — Evaluate feasibility + lock decisions
  Skill({ skill: "maestro-analyze", args: "{phase} -q" })   — Quick decision extraction only
  Skill({ skill: "maestro-plan", args: "{phase}" })       — Plan directly (if scope is clear)

**Single role mode report:**
- Role analyzed
- Framework alignment status (does analysis reference guidance decisions?)
- Context questions answered (count)
- Files written: list from §4 File Index
- Next:
  - Run more roles: `Skill({ skill: "maestro-brainstorm", args: "{another-role} --session {sessionId}" })`
  - When 2+ roles are done, trigger review: `Skill({ skill: "maestro-brainstorm", args: "--review-only --session {sessionId}" })`

**Review-only mode report:**
- Session ID and existing roles found (N)
- Cross-role review: conflicts / gaps / synergies counts
- Resolutions applied: count + breakdown by type (C/G/S)
- Patches skipped due to heading drift: count (if any)
- Same Next-step routing as auto mode

---

### Step 7.5: Generate Context Package

Write `{output_dir}/context-package.json` by extracting from session artifacts:

```jsonc
{
  "$schema": "context-package/1.0",
  "source": {
    "type": "brainstorm",
    "artifact_id": "{artifact_id}",
    "session_path": "{output_dir relative to .workflow/}",
    "generated_at": "{ISO-8601}"
  },
  "requirements": [],      // From guidance-specification.md §10 Feature Decomposition
  "constraints": [],        // From guidance-specification.md §4-N MUST/MUST NOT + {role}/analysis.md §2 Decisions[locked]
  "domain": {},             // From guidance-specification.md §1-3 (problem, terminology, audience)
  "non_goals": [],          // From guidance-specification.md Non-Goals section
  "insights": [],           // From {role}/analysis.md §3 Cross-Cutting subsections
  "open_questions": [],     // From guidance-specification.md §4-N SHOULD/MAY items
  "references": []          // List all key files: guidance-specification.md + {role}/analysis.md per role
}
```

**Extraction mapping**:
- `requirements[]`: each row from §10 Feature Decomposition → `{ id: "F-{id}", title, description, priority: "must|should|may" (from RFC 2119 keywords), acceptance, ref: "guidance-specification.md#§10" }`
- `constraints[]`: each MUST/MUST NOT from §4-N role decisions → `{ id: "C-{NNN}", area, constraint, rationale, status: "locked", ref: "{source}#§{N}" }`; append locked decisions from each `{role}/analysis.md` §2 Decisions table where status=locked
- `domain.problem_statement`: from §1-3
- `domain.terminology[]`: from Concepts & Terminology section → `{ term, definition, ref: "guidance-specification.md#§5" }`
- `domain.audience`, `domain.industry`: from §1-3
- `non_goals[]`: each Non-Goal → `{ title, rationale, ref: "guidance-specification.md#§6" }`
- `insights[]`: from each `{role}/analysis.md` §3 Cross-Cutting subsections → `{ role, area, summary, ref: "{role}/analysis.md#§3-{heading}" }`
- `open_questions[]`: from §4-N SHOULD/MAY items → `{ area, question, options[], ref }`
- `references[]`: `{ type: "guidance", path: "guidance-specification.md" }` + `{ type: "role-analysis", path: "{role}/analysis.md" }` per role

Register artifact in state.json with additional field:
  `context_package: "{output_dir}/context-package.json"`   (relative to .workflow/)

**GATE Step 7.5→complete**: Glob `{output_dir}/context-package.json` MUST exist before workflow report; BLOCKED if missing.

