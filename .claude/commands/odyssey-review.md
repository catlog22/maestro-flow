---
name: odyssey-review
description: Deep review cycle — archaeology, exploration, multi-dimensional review, generalization, discovery, and detailed knowledge persistence
argument-hint: "<target> [--scope <path>] [--dimensions <list>] [--skip-generalize] [--auto] [-y] [-c]"
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
- `--scope <path>`: Restrict generalization scan (default: entire project)
- `--dimensions <list>`: Comma-separated subset (default: correctness,security,performance,architecture)
- `--skip-generalize`: Skip generalization and discovery
- `--auto`: CLI delegate calls without confirmation
- `-y`: Auto-confirm — decisions recorded as `deferred`, no blocking prompts
- `-c`: Resume most recent session

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-review-odyssey-{slug}/`

**Output — 4 files:**
```
SESSION_DIR/
  ├── session.json       # session state + review_result + pattern
  ├── evidence.ndjson    # ALL evidence (phase field distinguishes origin)
  ├── explore.json       # structured CLI exploration snapshot
  └── understanding.md   # evolving narrative across all 7 sections
```

**session.json schema:**
```json
{
  "session_id": "review-odyssey-{YYYYMMDD-HHmmss}",
  "target": "", "scope": null, "dimensions": [],
  "flags": { "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE", "review_result": null, "pattern": null,
  "phase_goals": [], "phase_goals_all_done": false,
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson phases:** `archaeology`, `explore`, `review`, `discovery`, `decision`

**understanding.md sections:**
1. Target & Scope ← S_INTAKE
2. Archaeology Summary ← S_ARCHAEOLOGY
3. Exploration — Call Chains & Structure ← S_EXPLORE
4. Review Findings ← S_REVIEW
5. Generalization — Pattern & Scan Results ← S_GENERALIZE
6. Discoveries & Decisions ← S_DISCOVER
7. Learnings ← S_RECORD

**phase_goals[]:**
```json
[
  {"id":"G1","goal":"Review completed","done_when":"all dimensions reviewed with findings","phase":"S_REVIEW","status":"pending","completion_confirmed":false},
  {"id":"G2","goal":"Explore context gathered","done_when":"explore.json populated","phase":"S_EXPLORE","status":"pending","completion_confirmed":false},
  {"id":"G3","goal":"Pattern generalized","done_when":"session.json.pattern populated","phase":"S_GENERALIZE","skip_when":"skip_generalize","status":"pending","completion_confirmed":false},
  {"id":"G4","goal":"Discoveries triaged","done_when":"all hits classified","phase":"S_DISCOVER","skip_when":"skip_generalize","status":"pending","completion_confirmed":false},
  {"id":"G5","goal":"Learnings persisted","done_when":"spec entries created OR no actionable","phase":"S_RECORD","status":"pending","completion_confirmed":false}
]
```
</context>

<state_machine>

<states>
S_INTAKE       — 解析 target、加载上下文、恢复 session       PERSIST: session.json + understanding.md §1
S_ARCHAEOLOGY  — 考古：target 文件的 git history              PERSIST: evidence.ndjson (phase=archaeology) + understanding.md §2
S_EXPLORE      — CLI 辅助探索：结构、调用链、错误间隙          PERSIST: explore.json + evidence.ndjson (phase=explore) + understanding.md §3
S_REVIEW       — 多维度审查：并行 Agent 逐维度分析             PERSIST: evidence.ndjson (phase=review) + understanding.md §4
S_GENERALIZE   — 举一反三：从 findings 提取 pattern 扫全项目   PERSIST: session.json.pattern + understanding.md §5
S_DISCOVER     — 分类发现的相似问题，创建 issue / 记录决策      PERSIST: evidence.ndjson (phase=discovery|decision) + understanding.md §6
S_RECORD       — 知识沉淀：细节记录 + spec-entry + 终稿        PERSIST: understanding.md §7 + spec entries
</states>

<transitions>

S_INTAKE:
  → S_INTAKE       WHEN: -c + session found               DO: A_RESUME
  → S_ARCHAEOLOGY  WHEN: target resolved                  DO: A_INTAKE
  → S_INTAKE       WHEN: no target                        DO: AskUserQuestion "指定审查目标"

S_ARCHAEOLOGY:
  → S_EXPLORE      DO: A_ARCHAEOLOGY

S_EXPLORE:
  → S_REVIEW       DO: A_EXPLORE

S_REVIEW:
  → S_GENERALIZE   WHEN: not skip_generalize              DO: A_REVIEW
  → S_RECORD       WHEN: skip_generalize                  DO: A_REVIEW

S_GENERALIZE:
  → S_DISCOVER     WHEN: similar code found               DO: A_GENERALIZE
  → S_RECORD       WHEN: no hits                          DO: A_GENERALIZE

S_DISCOVER:
  → S_RECORD       DO: A_DISCOVER

S_RECORD:
  → END            DO: A_RECORD

</transitions>

<actions>

### A_INTAKE
1. Parse target + flags, resolve to file list
2. Create `SESSION_DIR`, derive `phase_goals[]` from flags
3. Search prior knowledge: `maestro search`, prior sessions, ARCHITECTURE.md
4. Write `session.json` + `understanding.md` §1
5. Display Goal Prompt (Appendix)

### A_ARCHAEOLOGY
1. `git log --oneline -20 -- {target_files}` + `git blame` on key regions
2. CLI delegate `--role analyze --mode analysis` review past changes
3. Append `evidence.ndjson` (phase: "archaeology"), update `understanding.md` §2
4. Save `current_state = "S_EXPLORE"`

### A_EXPLORE
1. CLI delegate `--role explore --mode analysis` — call chains, error gaps, similar patterns
2. Write `explore.json`, append `evidence.ndjson` (phase: "explore")
3. Update `understanding.md` §3, mark `phase_goals[G2]` done
4. Save `current_state = "S_REVIEW"`

### A_REVIEW

Multi-dimensional review — spawn parallel Agents (one per dimension).

Spawn N Agents in single message (N = dimensions count, default 4):

| Agent | Dimension | Focus |
|-------|-----------|-------|
| Correctness | 逻辑错误、边界条件、null/undefined、竞态 | 正确性 |
| Security | 注入、XSS、CSRF、敏感数据泄露、权限绕过 | 安全性 |
| Performance | 热路径、N+1 查询、内存泄漏、不必要的重计算 | 性能 |
| Architecture | 层违反、循环依赖、接口契约、关注点分离 | 架构 |

Each agent returns:
```json
[{"title":"","severity":"critical|high|medium|low","file":"","line":0,"description":"","suggestion":"","cwe":""}]
```

Append each finding → `evidence.ndjson` (phase: "review"):
```json
{"ts":"","phase":"review","type":"dimension-finding","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":""}
```

Write `session.json.review_result`:
```json
{"dimensions_reviewed":[],"finding_count":0,"severity_distribution":{"critical":0,"high":0,"medium":0,"low":0},"timestamp":""}
```

Update `understanding.md` §4 with findings by dimension + severity matrix.
Mark `phase_goals[G1]` done. Save next state.

### A_GENERALIZE

From review findings, extract generalizable patterns and scan codebase.

**Step 1 — Pattern extraction:** Pick highest-severity findings → derive pattern signature.
Write to `session.json.pattern`.

**Step 2 — Codebase scan:** Spawn 2 Agents (pattern grep + structural search).

**Step 3 — Write understanding.md §5.** Mark `phase_goals[G3]` done.

### A_DISCOVER

Evaluate hits and route (same as debug-odyssey):

| Classification | Normal | `-y` mode |
|---------------|--------|-----------|
| `bug` | AskUserQuestion: create issue / record decision | auto create issue, `deferred` |
| `risk` | Record + optionally issue | Record only |
| `safe` | Skip | Skip |

Append `evidence.ndjson` (phase: discovery + decision).
Update `understanding.md` §6. Mark `phase_goals[G4]` done. Save `current_state = "S_RECORD"`.

### A_RECORD

**Step 1 — Detailed findings report (`understanding.md` §7):**
- Per-dimension summary with severity counts
- Top findings with file:line + suggestion
- Generalization results
- Open decisions list

**Step 2 — Persist learnings:** `Skill("spec-add")` for actionable patterns.

**Step 3 — Pending decisions:**
- **Normal**: display checklist, AskUserQuestion to resolve.
- **`-y`**: skip, display deferred count.

**Step 4 — Goal audit:** check `phase_goals[*].completion_confirmed` (same as debug-odyssey).

**Step 5 — Completion:**
```
--- REVIEW ODYSSEY COMPLETE ---
Target:     {target}
Dimensions: {dimensions_reviewed}
Findings:   {critical}C {high}H {medium}M {low}L
Pattern:    {pattern_name} ({N} similar hits)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} spec entries
Goals:      {done}/{total} confirmed ({skipped} skipped)
---
```

</actions>

<appendix>

### Goal Prompt Template

```
📋 Review Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 直到 {SESSION_DIR}/session.json 的 phase_goals[*] 全部 completion_confirmed=true
且 phase_goals_all_done=true 才停。按状态机推进阶段，不修改源代码。
遇到 phase=decision 的 pending 条目必须 AskUserQuestion，不得自行 resolve。
```

### `-y` Auto-Confirm Behavior

| 决策点 | Normal | `-y` |
|--------|--------|------|
| S_DISCOVER bug 路由 | AskUserQuestion | auto create issue, `deferred` |
| S_DISCOVER 模糊项 | AskUserQuestion | all `deferred` |
| S_RECORD 决策清单 | AskUserQuestion | skip |
| S_RECORD 目标审计 | AskUserQuestion | auto accept |

### Phase Goal Lifecycle

```
pending → done (completion_confirmed=true)
pending → skipped (completion_confirmed=true)
pending → failed (completion_confirmed=false)
```

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target |
| E002 | error | Target path not found | Check path |
| E003 | error | Resume but no session | Start new |
| W001 | warning | No git history for target | Proceed |
| W002 | warning | Some dimension agents failed | Partial coverage |
| W003 | warning | Generalization 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Raw output |
</error_codes>

<success_criteria>
- [ ] Target resolved and session created
- [ ] Git archaeology on target files
- [ ] CLI exploration executed, explore.json written
- [ ] All dimensions reviewed with structured findings
- [ ] Severity matrix produced (critical/high/medium/low counts)
- [ ] Pattern generalized from top findings (unless --skip-generalize)
- [ ] Discoveries classified and routed
- [ ] Detailed findings report in understanding.md §7
- [ ] phase_goals tracked and audited
- [ ] Goal Prompt displayed
- [ ] `-y` mode: no blocking prompts, deferred counted
- [ ] Session resumable via -c
- [ ] NO source code modifications
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Critical findings need fix | `/quality-debug-odyssey "<finding>"` |
| Issues created | `/manage-issue list --source review-odyssey` |
| Pattern to document | `/learn-decompose <module>` |
| Want to fix findings | `/maestro-plan --gaps` |
</next_step_routing>
