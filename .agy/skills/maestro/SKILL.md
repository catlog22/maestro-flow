---
name: maestro
description: Auto-route intent to optimal command chain
argument-hint: <intent> [-y] [-c] [--dry-run] [--exec auto|cli|internal] [--tool <name>] [--super]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - replace_file_content
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
Orchestrate all maestro commands based on user intent and project state.
Classify intent → select chain → create session → dispatch to `maestro-ralph-execute`.

Entry points:
- **`/maestro "intent"`** — Intent-based: classify → chain → execute
- **`/maestro -c`** — Resume previous session
- **`/maestro --dry-run "intent"`** — Show chain, no execution
- **`/maestro --super "intent"`** — Production-ready mode (read maestro-super.md)

Session: `.workflow/.maestro/{session_id}/status.json`
</purpose>

<deferred_reading>
- [maestro.md](~/.maestro/workflows/maestro.md) — read at execution start for intent analysis + chain selection
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag active
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special keywords.

**Keywords:** `continue`/`next`/`go` → state-based routing; `status` → `Skill("manage-status")`

**Flags:**
- `-y` / `--yes` — Auto mode: skip clarification, skip confirmation, auto-skip on errors
- `-c` / `--continue` — Resume previous session
- `--dry-run` — Show chain without executing
- `--exec <mode>` — `auto` (default), `cli`, `internal`
- `--tool <name>` — CLI tool for delegates (default: claude)
- `--super` — Read and follow `maestro-super.md`
</context>

<invariants>
1. **All chains dispatch via maestro-ralph-execute** — maestro never executes steps directly
2. **Session before execution** — status.json created before any step runs
3. **Auto flags only to supporting commands** — unlisted commands execute as-is
4. **Decomposition contract shared with maestro-ralph** — broad/lifecycle intents run S_DECOMPOSE producing the SAME additive block (`boundary_contract`, `execution_criteria`, `task_decomposition`, `goal_checklist_path`) + `goal-checklist.md`, then EMIT the `/goal` bind prompt. Reference maestro-ralph `A_DECOMPOSE_TASKS` for the full spec; do not duplicate logic
5. **Status JSON: schema-additive + step-dynamic** — decomposition fields OPTIONAL (absent → old flat-chain behavior); `steps[]` is a living array grown at runtime by ralph-execute's `post-goal-audit`. Never remove/rename existing fields
</invariants>

<state_machine>

<states>
S_PARSE         — 解析参数、检测 flags                PERSIST: —
S_RESUME        — 扫描已有 session、恢复执行           PERSIST: —
S_CLASSIFY      — 意图分类、chain 选择                 PERSIST: —
S_DECOMPOSE     — 边界澄清、写执行准则+子目标清单       PERSIST: session.boundary_contract, .execution_criteria, .task_decomposition
S_CREATE        — 创建 session + status.json           PERSIST: session (全量)
S_DRY_RUN       — 显示 chain 后结束                    PERSIST: —
S_CONFIRM       — 用户确认（auto_mode 跳过）            PERSIST: —
S_DISPATCH      — 移交 maestro-ralph-execute           PERSIST: —
S_FALLBACK      — 意图无法分类、请求输入                PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_RESUME      WHEN: -c / --continue flag
  → S_CLASSIFY    WHEN: intent text present
  → S_CLASSIFY    WHEN: keyword "continue"/"next"/"go"    DO: A_STATE_BASED_ROUTE
  → S_FALLBACK    WHEN: no intent AND no flags

S_RESUME:
  → S_DISPATCH    WHEN: session found                     DO: A_LOCATE_SESSION
  → S_FALLBACK    WHEN: no session found

S_CLASSIFY:
  → S_DECOMPOSE   WHEN: chain resolved                    DO: A_CLASSIFY_INTENT
  → S_FALLBACK    WHEN: no match AND auto_mode
  → S_CLASSIFY    WHEN: no match AND not auto_mode        DO: A_CLARIFY
                   GUARD: max 2 clarification rounds → S_FALLBACK

S_DECOMPOSE:
  → S_CREATE      DO: A_DECOMPOSE_TASKS
                   GUARD: broad intent (重构/全面/重写/迁移/overhaul/migrate/rewrite) on a multi-step lifecycle chain → MUST clarify even if auto_mode
                   GUARD: single-step chain OR narrow intent OR chain ∈ {status,init,quick} → skip decomposition (pass through)

S_CREATE:
  → S_DRY_RUN     WHEN: --dry-run flag                    DO: A_CREATE_SESSION
  → S_CONFIRM     WHEN: not auto_mode                     DO: A_CREATE_SESSION
  → S_DISPATCH    WHEN: auto_mode                         DO: A_CREATE_SESSION

S_DRY_RUN:
  → END           DO: display chain with step types

S_CONFIRM:
  → S_DISPATCH    WHEN: user confirms
  → S_PARSE       WHEN: user wants to modify
  → END           WHEN: user cancels

S_DISPATCH:
  → END           DO: view_file(AbsolutePath="<agy-skills-dir>/maestro-ralph-execute/SKILL.md") + execute inline

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent           DO: ask_question
  → END           WHEN: user cancels

</transitions>

<actions>

### A_STATE_BASED_ROUTE

1. Read `.workflow/state.json` → determine next logical step
2. Convert to equivalent intent for chain classification

### A_LOCATE_SESSION

1. Scan `.workflow/.maestro/*/status.json`, filter `status == "running"`, sort DESC
2. Take most recent; if not found → S_FALLBACK

### A_CLASSIFY_INTENT

1. Read `~/.maestro/workflows/maestro.md` from deferred_reading
2. Match intent to best task_type via chain catalog (semantic, AI-driven)
3. Select chain from chainMap
4. Determine per-step type: `internal` (Skill) or `external` (delegate)

### A_CLARIFY

1. `ask_question` with parsed intent + available chain options
2. Re-classify with user response

### A_DECOMPOSE_TASKS

Shares the decomposition contract with maestro-ralph `A_DECOMPOSE_TASKS` — **reference that spec; do not duplicate the table logic here.** Condensed:

1. Classify intent breadth (broad: 重构/全面/重写/迁移/overhaul/migrate/rewrite; narrow: single file/function/bug). Skip entirely for narrow / single-step / {status,init,quick} chains
2. Broad/medium → `ask_question` ≤3 rounds: Scope (in/out) | Constraints (compat/API/perf/test bar) | Definition of Done
3. Derive `execution_criteria` (3-6 imperative rules) + `task_decomposition` (outcome sub-goals, each `done_when` objectively verifiable and mapped to a ralph evidence artifact: verification.json / review.json / uat.md / test path)
4. Write `{session_dir}/goal-checklist.md` (same template as maestro-ralph) with `ALL_GOALS_DONE` sentinel; set `goal_checklist_path`
5. Append a `{ type: "decision", decision: "post-goal-audit", retry_count: 0, max_retries: 2 }` node as the FINAL node — after the last evidence-producing step (verify/review/test), before a milestone-complete/close-out step if the chain ends with one. (Audit needs evidence artifacts to exist.) ralph-execute then dynamically grows `steps[]` for unmet sub-goals
6. **Emit the `/goal` bind prompt:**
   ```
   📋 任务分解完成。复制下面一行设定目标(推荐)：
   /goal 当 {session_dir}/goal-checklist.md 中子目标全 [x] 且含 ALL_GOALS_DONE 时达成；否则按执行准则继续推进且不越边界契约
   ```

### A_CREATE_SESSION

1. Read `.workflow/state.json` for project context (phase, milestone)
2. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`:
   ```json
   { "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "phase", "milestone", "auto_mode", "exec_mode", "cli_tool",
     "context": { ... }, "steps": [{ "index", "skill", "args", "type", "status": "pending", "goal_ref": null }],
     "waves": [], "current_step": 0, "status": "running",
     "_comment": "↓ OPTIONAL additive block — present only if S_DECOMPOSE ran; absent → old flat-chain behavior",
     "boundary_contract": {}, "execution_criteria": [], "task_decomposition": [], "goal_checklist_path": "" }
   ```
   Decomposition fields written ONLY if A_DECOMPOSE_TASKS produced them (additive; never break flat-chain readers)
3. Initialize tracking via `TodoWrite`. The decomposition goal is bound by the user via the emitted `/goal` prompt
4. If `--super`: read `maestro-super.md`, follow it completely

</actions>

</state_machine>

<appendix>

### Auto-Yes Flag Map

| Command | Auto Flag | Effect |
|---------|-----------|--------|
| maestro-init | `-y` | Skip interactive questioning |
| maestro-analyze | `-y` | Skip scoping, auto-deepen |
| maestro-brainstorm | `-y` | Skip questions, use defaults |
| maestro-roadmap | `-y` | Skip questions (create/revise/review) |
| maestro-impeccable | `-y` | Auto-select design variant + skip confirmations |
| maestro-plan | `-y` | Skip confirmations and clarification |
| maestro-execute | `-y` | Skip confirmations, blocked auto-continue |
| quality-auto-test | `-y` | Skip plan confirmation |
| quality-test | `-y --auto-fix` | Auto-trigger gap-fix loop |
| quality-retrospective | `-y` | Accept all routing recommendations |
| maestro-milestone-complete | `-y` | Skip knowledge promotion |

Unlisted commands have no auto flags.

### Error Codes

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and project not initialized | Prompt or suggest maestro-init |
| E002 | error | Clarity too low after 2 rounds | Show parsed intent, ask rephrase |
| E003 | error | Chain step failed + user abort | Record partial, suggest -c resume |
| E004 | error | Resume session not found | Show available sessions |
| W001 | warning | Ambiguous intent, multiple chains | Present options |
| W002 | warning | Step completed with warnings | Log and continue |
| W003 | warning | State suggests different chain | Show discrepancy |

### Success Criteria

- [ ] Intent classified with task_type, complexity, clarity_score
- [ ] Broad lifecycle intents decomposed (S_DECOMPOSE, ≤3 boundary questions) sharing maestro-ralph contract; narrow/single-step skip
- [ ] Decomposition writes additive block + goal-checklist.md + post-goal-audit node; emits /goal bind prompt (no self-call, no phantom create_goal)
- [ ] Chain selected and confirmed (or auto-confirmed)
- [ ] Session dir created with status.json before execution; decomposition fields additive-only
- [ ] Tracking via TodoWrite (Claude); status.json steps[] grown dynamically by ralph-execute post-goal-audit
- [ ] Auto flags propagated to supporting commands only
- [ ] All chains dispatched via maestro-ralph-execute
- [ ] Low-complexity intents routed to maestro-quick
- [ ] (super) Requirements validated before roadmap
- [ ] (super) Each milestone scored >= 80%

</appendix>
