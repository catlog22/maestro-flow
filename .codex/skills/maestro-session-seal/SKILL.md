---
name: maestro-session-seal
description: Seal current session with knowledge extraction and DAG progression
argument-hint: "[--session <session_id>] [-y] [--skip-knowledge]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
version: 0.6.0
---

<purpose>
Seal a completed session: verify all runs are done, extract knowledge (specs/knowhow promotion), mark session as sealed, and recommend the next dep-ready session from the DAG.

Replaces the deprecated `maestro-milestone-complete` with session-level semantics and integrated knowledge capture.
</purpose>

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<context>
$ARGUMENTS -- optional session ID and flags.

**Flags:**
- `--session <id>`: Target session (slug or full ID). Default: `active_session_id`
- `-y, --yes`: Skip confirmations
- `--skip-knowledge`: Skip knowledge extraction step
</context>

<execution>

### Step 1: Session Readiness Check

1. Resolve target session from `--session` flag or `active_session_id`
2. Read `session.json` — verify status is `running` or `paused`
3. Verify no active runs (all runs completed or sealed)
4. Verify critical gates passed (entry/exit gates from last verify/review run)
5. If not ready → display blockers, suggest next action

### Step 2: Knowledge Extraction

Skip if `--skip-knowledge`. Otherwise (`-y` auto-confirms the save prompt, does NOT skip extraction):

1. **Scan session artifacts** — read all sealed run outputs across the session
2. **Extract candidates**:
   - Decisions with `status: accepted` from `evidence.json` → spec candidates
   - Patterns/recipes discovered during execution → knowhow candidates
   - Risks that materialized or were mitigated → learning candidates
3. **Present to user** via `request_user_input`:
   - "全部保存" — save all candidates
   - "逐个选择" — review each
   - "跳过" — no extraction
4. **Persist** selected items:
   - Specs → `maestro spec add ...`
   - Knowhow → `maestro knowhow capture ...`
   - Record promoted IDs in `session.json.lifecycle.promoted_spec_ids` / `promoted_knowhow_ids`

### Step 3: Seal Session

1. Call `maestro run seal-session {session_id}`
2. CLI writes `session.json.lifecycle.sealed_at` and `seal_summary`
3. CLI updates `state.json.sessions[].status` to `sealed`

### Step 4: DAG Progression

1. Read `state.json.sessions[]` — find sessions that became dep-ready
2. If dep-ready sessions exist, recommend next session via `request_user_input`
3. If confirmed → set `active_session_id`

</execution>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| Session not found | Check `state.json.sessions[]` |
| Session already sealed | Nothing to do |
| Active runs exist | Complete or seal pending runs first |
| Critical gates failed | Run verify/review to resolve |
</error_codes>

<success_criteria>
- [ ] Target session resolved and verified as ready for seal
- [ ] Knowledge candidates extracted (unless skipped)
- [ ] Selected knowledge promoted to project-level specs/knowhow
- [ ] Session sealed via CLI
- [ ] `state.json.sessions[].status` updated to `sealed`
- [ ] Dep-ready sessions identified and activation offered
</success_criteria>
