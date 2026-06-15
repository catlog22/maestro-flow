---
name: odyssey-review
description: Deep review cycle — archaeology, exploration, multi-dimensional review, generalization, discovery, and detailed knowledge persistence
argument-hint: "<target> [--scope <path>] [--dimensions <list>] [--skip-generalize] [--auto] [-y] [-c]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Deep code review with generalization: understand what changed (archaeology) → explore structure
(CLI-assisted) → multi-dimensional review → generalize patterns (举一反三) → discover similar
issues → persist detailed findings and learnings.

Unlike `quality-review` (phase-scoped verdict for pipeline gates), this command does NOT fix code.
It produces exhaustive documentation of findings, generalizes patterns across the codebase, and
records every decision point. Designed for thorough understanding, not quick pass/fail.

Core philosophy:
- **Review to learn, not to gate** — depth over speed
- **Find one, find all** — every finding triggers a codebase-wide pattern scan
- **Record everything** — ambiguous items become decision journal entries, not silent skips
- **CLI-assisted** — delegate to external tools for multi-angle analysis
</purpose>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | Resolve via state.json → changed files |
| PR number | `git diff main...HEAD` |

**Flags:**
- `--scope <path>`: Restrict generalization scan
- `--dimensions <list>`: Comma-separated (default: correctness,security,performance,architecture)
- `--skip-generalize`: Skip generalization and discovery
- `--auto`: CLI delegates without confirmation
- `-y`: Auto-confirm — decisions recorded as `deferred`
- `-c`: Resume most recent session

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-review-odyssey-{slug}/`

**Output — 4 files:**
```
SESSION_DIR/
  ├── session.json       # state + review_result + pattern + phase_goals
  ├── evidence.ndjson    # ALL evidence (phase field distinguishes)
  ├── explore.json       # CLI exploration snapshot
  └── understanding.md   # 7-section evolving narrative
```

**evidence.ndjson phases:** `archaeology`, `explore`, `review`, `discovery`, `decision`

**phase_goals[]:**
| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Review completed | S_REVIEW | — |
| G2 | Explore context | S_EXPLORE | no CLI tools |
| G3 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G4 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G5 | Learnings persisted | S_RECORD | — |
</context>

<csv_schema>

### Shared Output Schema

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "evidence":      { "type": "string" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Shared Termination Contract:**
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
Read-only. Do NOT modify source files.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv.
```

### tasks.csv

```csv
id,title,description,task_type,dimension,deps,wave,status,findings,evidence,error
```

**Waves:**
- Wave 1: Archaeology (git-timeline, git-blame) — parallel
- Wave 2: Review dimensions (correctness, security, performance, architecture) — parallel
- Wave 3: Generalization (pattern-grep, structural-search) — parallel
</csv_schema>

<invariants>
1. **No code modifications** — this command NEVER modifies source files
2. **Evidence append-only** — evidence.ndjson is append-only
3. **Session is source of truth** — session.json holds all state
4. **Phase goal tracking** — each stage MUST mark its goal on completion
5. **`-y` defers, never drops** — auto-confirm records `deferred`, never silently skips
6. **CLI delegate is background** — all `maestro delegate` calls use run_in_background
7. **Goal is outcome-oriented** — `/goal` user-bound, odyssey outputs prompt then continues
8. **Invariant violation = BLOCK**
</invariants>

<execution>

### Stage 1: Intake (S_INTAKE)

1. Parse target + flags, resolve to file list
2. Create `SESSION_DIR`, derive `phase_goals[]`
3. Search prior knowledge: `maestro search`, prior sessions, ARCHITECTURE.md
4. Write `session.json` + `understanding.md` §1
5. Display **Goal Prompt block** (Appendix)

### Stage 2: Archaeology (S_ARCHAEOLOGY)

**Step 1 — Git archaeology (spawn_agents_on_csv, Wave 1):**

```csv
"arch-timeline","Git Timeline","git log --oneline -20 -- {target_files}","archaeology","","","1","pending","","",""
"arch-blame","Git Blame","git blame on key regions of target files","archaeology","","","1","pending","","",""
```

```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: ARCHAEOLOGY_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 2, max_runtime_seconds: 300,
  output_csv_path: "wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Merge → evidence.ndjson (phase: "archaeology").

**Step 2 — CLI change review:** `maestro delegate --role analyze --mode analysis`. Run_in_background, STOP.

**Step 3:** Update `understanding.md` §2. Save `current_state = "S_EXPLORE"`.

### Stage 3: Exploration (S_EXPLORE)

CLI delegate `--role explore --mode analysis` → `explore.json` + evidence.ndjson (phase: "explore").
Update `understanding.md` §3. Mark `phase_goals[G2]` done. Save `current_state = "S_REVIEW"`.

### Stage 4: Review (S_REVIEW)

Multi-dimensional review via `spawn_agents_on_csv` (Wave 2).

Append Wave 2 rows to `tasks.csv`:
```csv
"rev-correct","Correctness","Logic errors, boundary conditions, null/undefined, race conditions","review","correctness","","2","pending","","",""
"rev-security","Security","Injection, XSS, CSRF, data exposure, auth bypass","review","security","","2","pending","","",""
"rev-perf","Performance","Hot paths, N+1, memory leaks, unnecessary recomputation","review","performance","","2","pending","","",""
"rev-arch","Architecture","Layer violations, circular deps, interface contracts, SoC","review","architecture","","2","pending","","",""
```

```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: REVIEW_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 600,
  output_csv_path: "wave-2-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Merge → evidence.ndjson (phase: "review"). Write `session.json.review_result` (severity matrix).
Update `understanding.md` §4. Mark `phase_goals[G1]` done.

### Stage 5: Generalization (S_GENERALIZE)

Skip if `--skip-generalize`. From top findings → extract pattern → scan codebase.

Append Wave 3 rows to `tasks.csv`:
```csv
"gen-pattern","Pattern Grep","Grep for pattern signature across project","generalization","","","3","pending","","",""
"gen-structural","Structural Search","Find files with same anti-pattern","generalization","","","3","pending","","",""
```

```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: GENERALIZATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 2, max_runtime_seconds: 300,
  output_csv_path: "wave-3-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Write `understanding.md` §5. Mark `phase_goals[G3]` done.

### Stage 6: Discovery (S_DISCOVER)

Triage hits → classify (safe/risk/bug) → route:
- **Normal**: `request_user_input` for bug routing
- **`-y`**: auto create issue, `deferred`

Append evidence.ndjson (phase: discovery + decision).
Update `understanding.md` §6. Mark `phase_goals[G4]` done. Save `current_state = "S_RECORD"`.

### Stage 7: Record (S_RECORD)

1. Finalize `understanding.md` §7: detailed findings report, severity matrix, pattern results
2. Persist learnings: `$spec-add` for actionable patterns
3. Pending decisions: **Normal** → `request_user_input`. **`-y`** → skip, display count.
4. Goal audit: check `phase_goals[*].completion_confirmed`
5. Completion summary:
   ```
   --- REVIEW ODYSSEY COMPLETE ---
   Target:     {target}
   Dimensions: {reviewed}
   Findings:   {C}C {H}H {M}M {L}L
   Pattern:    {name} ({N} hits)
   Issues:     {N} created
   Decisions:  {N} resolved, {M} pending, {K} deferred
   Goals:      {done}/{total} ({skipped} skipped)
   ---
   ```

**Next steps:** `$quality-debug-odyssey "<finding>"`, `$manage-issue list --source review-odyssey`,
`$learn-decompose <module>`, `$maestro-plan --gaps`
</execution>

<appendix>

### Goal Prompt Template

```
📋 Review Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 直到 {SESSION_DIR}/session.json 的 phase_goals[*] 全部 completion_confirmed=true
且 phase_goals_all_done=true 才停。按状态机推进阶段，不修改源代码。
遇到 phase=decision 的 pending 条目必须 request_user_input，不得自行 resolve。
```

### `-y` Auto-Confirm Behavior

| 决策点 | Normal | `-y` |
|--------|--------|------|
| S_DISCOVER bug 路由 | request_user_input | auto issue, `deferred` |
| S_DISCOVER 模糊项 | request_user_input | all `deferred` |
| S_RECORD 决策清单 | request_user_input | skip |
| S_RECORD 目标审计 | request_user_input | auto accept |

### Phase Goal Lifecycle

```
pending → done | skipped | failed
```

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target | Provide target |
| E002 | error | Target not found | Check path |
| E003 | error | Resume no session | Start new |
| W001 | warning | No git history | Proceed |
| W002 | warning | Dimension agent failed | Partial coverage |
| W003 | warning | Generalization 0 hits | Skip discovery |
</error_codes>

<success_criteria>
- [ ] Target resolved, session created
- [ ] Archaeology via spawn_agents_on_csv Wave 1
- [ ] CLI exploration, explore.json written
- [ ] All dimensions reviewed via spawn_agents_on_csv Wave 2
- [ ] Severity matrix produced
- [ ] Generalization via spawn_agents_on_csv Wave 3 (unless --skip-generalize)
- [ ] Discoveries classified and routed
- [ ] Detailed findings in understanding.md §7
- [ ] Goal Prompt displayed, phase_goals tracked and audited
- [ ] `-y`: no blocking, deferred counted
- [ ] NO source code modifications
</success_criteria>
