---
name: maestro-session-manage
disable-model-invocation: true
description: Manage a v3 Session — inspect status/resume-view, review knowledge
  candidates, complete, archive/unarchive
argument-hint: "[--session <session_id>]
  [--complete|--archive|--unarchive|--knowledge] [-y] [--skip-knowledge]"
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.86
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

If any required file above was not expanded into context by the host, or its content is no longer in context, Read it explicitly before executing any step.

<purpose>
Manage the lifecycle of a v3 Session (`session/3.0`) through its read-only projections, knowledge governance, and explicit lifecycle transitions.

Session completion (`maestro session complete`) is part of the default Run loop — Ralph S_DONE, the orchestrator run loop, and Companion all execute it when the chain turns terminal. This command is the **management surface**: inspection, knowledge candidate review/promotion, and the explicit transitions the default loop does not perform (`--complete` for manual pipelines, `--archive`/`--unarchive` for optional freezing).

Run completion already stages accepted decisions, locked constraints, and explicit `maestro knowledge stage` entries. This command reviews those receipts; it does not re-extract the same artifacts or write project knowledge through a second path.
</purpose>

<context>
$ARGUMENTS -- optional session ID and action flags.

**Actions (first match wins; default = inspect):**
| Flag | Effect |
|------|--------|
| *(none)* | Inspect: `session status` + `session resume-view` projection |
| `--complete` | Readiness check → knowledge reconciliation → fenced `maestro session complete` → DAG progression |
| `--archive` | Fenced `maestro session archive` (only from `completed`/`failed`; optional freeze) |
| `--unarchive` | Fenced `maestro session unarchive` (only from `archived`; returns to `open`) |
| `--knowledge` | Knowledge review/promotion only — no lifecycle mutation |

**Shared flags:**
| Flag | Effect | Default |
|------|--------|---------|
| `--session <id>` | Target session (slug or full ID) | `active_session_id` |
| `-y` / `--yes` | Auto mode — skip confirmations | false |
| `--skip-knowledge` | With `--complete`: leave candidate backlog pending | false |
</context>

<v3_lifecycle_reference>
```
open ──complete──> completed ──archive──> archived ──unarchive──> open
  │                                             
  └──fail──> failed ──archive──> archived

Permissions: open = all mutations; completed/failed/archived = none.
```
- `--complete` requires: no running Run, every chain step completed/skipped with evidence, no open decision gate (escalated gates pass as recorded concerns).
- `--archive` is optional: a completed Session identity stays durable either way; archived Sessions cannot host new Runs until `--unarchive`.
- Every mutation returns a `run-response/1.2` envelope with an immutable transition receipt; never edit runtime-owned protocol JSON.
</v3_lifecycle_reference>

<execution>

### Step 0: Resolve Target

1. Resolve target session from `--session` flag or `active_session_id`
2. Read `maestro session status --session {session_id} --json` — capture `status`, `orchestration_revision`, `activity_revision`, `active_run_ids`
3. Route to the selected action below; default (no action flag) → Step 1 (Inspect)

### Step 1: Inspect (default)

1. Run `maestro session status --session {session_id} --json` and `maestro session resume-view --session {session_id} --json`
2. Report: status, orchestration/activity revision, active runs, open decisions (`openDecisions` from the ResumeMap), pending publications, and `nextActions`
3. Suggest the matching action: open decision gates → `maestro run decide`; active runs → let the Run loop finish; `completed` → offer `--archive`; `archived` → offer `--unarchive`; `open` with terminal chain → offer `--complete`

### Step 2: Complete (`--complete`) — manual-pipeline terminal step

Note: maestro-next suggests `--complete` when 'Tests green + active session'. Orchestrated flows (Ralph/orchestrator/Companion) complete the Session themselves; use this action only when driving the pipeline manually.

**2a. Readiness check**

1. Verify status is `open` (a completed/archived Session needs no completion; `archived` requires `--unarchive` first)
2. Verify no active runs (`active_run_ids` empty; all runs sealed)
3. Verify critical gates passed (entry/exit gates from last verify/review run). If no verify/review run exists in this session, treat gate check as not applicable (pass) but emit W002
4. Verify no open decision gates (`session status` → `decisions[]`; open gates block `session complete` with `DECISION_GATE_BLOCKED`). If open gates exist → run `maestro run decide <point> --verdict proceed|fix` first
5. If not ready → display blockers, suggest next action (e.g., "run the `review` step first")

**2b. Knowledge reconciliation** (skip to 2c with `--skip-knowledge`)

1. Run `maestro knowledge review {session_id} --json`. Treat its Run ledgers, reconciliation policies, diversified matches, and candidate IDs as authoritative; do not rescan outputs to recreate candidates. Use `--refresh` only when the review reports missing or stale source receipts
2. Explain signal semantics when relevant: search/injection is exposure only; explicit loads are consumed; `cited`, `validated`, and `contradicted` are explicit Run relations
3. Report exact/semantic duplicates, related/extends candidates, potential conflicts, supersession candidates, missing receipts, and promotion eligibility separately. Exact duplicates are suppressed automatically; unresolved `review_required` candidates cannot be promoted
4. If `--skip-knowledge`, report the pending/promoting/review-required/suppressed counts and continue. The backlog and reconciliation receipts remain durable after completion
5. Otherwise resolve review-required candidates before promotion with `maestro knowledge review {session_id} --resolve <candidate-id> --as duplicate|related|conflict|supersede|unique [--target <knowledge-id>] --reason "<reason>"`. A target must come from that candidate's evidence-backed matches
6. Present eligible pending candidates via `request_user_input`:
   ```
   question: "以下知识候选项值得晋升到项目知识库吗？"
   options:
     - "晋升全部合格项" (promote all eligible candidates)
     - "逐个选择" (review each candidate)
     - "暂不晋升" (leave backlog pending)
   ```
7. Promote only through the receipt-aware CLI:
   - Bulk selection → `maestro knowledge promote {session_id} --all`
   - Explicit selection → repeat `maestro knowledge promote {session_id} --candidate <candidate-id>` for each selection (comma-separated compatibility remains supported)
   - `-y` may run `--all`, which promotes all eligible candidates (observed-only emits a warning) and skips review-required and suppressed candidates. It MUST NOT auto-resolve a candidate without explicit user selection
8. For a replacement candidate, confirm `--as supersede` and then promote it; promotion creates the successor and links the evolution chain. For coexisting valid rules, confirm `related` or `conflict` as appropriate. Never direct-write a candidate that was already promoted successfully

**2c. Complete the Session**

1. Use the `orchestration_revision` captured in Step 0 (re-read if any mutation happened since)
2. When the chain is terminal (every Run sealed, every decision terminal), call the complete `maestro session complete` command from `run-mode.md`, supplying the exact `session_id`, `--participant`, `--actor`, `--request-id`, `--reason`, `--expected-orchestration-revision`, and `--json`
3. Verify the transition receipt; never mutate Session lifecycle state or edit runtime-owned protocol JSON. The completed Session identity remains durable and may be archived/unarchived later

**2d. DAG progression**

1. Read `state.json.sessions[]` — find sessions that became dep-ready (all `depends_on` sealed)
2. If dep-ready sessions exist:
   ```
   question: "Session {slug} 已完成。推荐激活下一个 session: {next-slug}，是否确认？"
   options:
     - "激活推荐 session"
     - "选择其他 session"
     - "暂不激活"
   ```
3. If confirmed → set `active_session_id` to selected session

### Step 3: Archive (`--archive`) — optional freeze

1. Verify status is `completed` or `failed` (an `open` Session must `--complete` or fail first; `archived` is already archived)
2. Call the fenced transition with the current `orchestration_revision`:
   `maestro session archive --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {archive_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --json`
3. Verify the `run-response/1.2` receipt (`status: archived`, revision incremented). Archived Sessions reject all mutations (`create_run`/`advance_chain`/`transition_run`/`add_evidence`/`decide`) until `--unarchive`

### Step 4: Unarchive (`--unarchive`) — return to open

1. Verify status is `archived`
2. Call the fenced transition:
   `maestro session unarchive --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {unarchive_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --json`
3. Verify the receipt (`status: open`). The Session accepts Runs and chain mutations again; extend it with `maestro session chain insert ...` and `maestro run next`

### Step 5: Knowledge only (`--knowledge`)

Run Step 2b (Knowledge reconciliation) without any lifecycle mutation. Leave the Session status unchanged.

</execution>

<completion>
```
=== SESSION {ACTION RESULT} ===
Session: {session_id}
Action: {inspect|complete|archive|unarchive|knowledge}
Status: {open|completed|archived|failed} (orchestration_revision {n})
Knowledge: {promoted_count} promoted, {pending_count} pending, {review_required_count} review required, {suppressed_count} suppressed
Next dep-ready: {next_slug or "none (DAG complete)" or "n/a"}
--- STATUS ---
Status: DONE
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Next session activated | route step `analyze` through `/maestro-next` or the canonical receipt-chained `session open` -> `session chain insert --command analyze --arg "<goal>"` -> `run next` flow |
| Session archived, later extension needed | `maestro-session-manage --session {session_id} --unarchive` |
| Knowledge candidates pending | `maestro knowledge review {session_id}` |
| Knowledge health review needed | `/maestro-knowledge audit` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Session not found | Check `state.json.sessions[]` / `maestro session list --json` |
| E002 | error | Session already completed / archived | Nothing to do; use inspect or `--unarchive` |
| E003 | error | Active runs exist | Complete or seal pending runs first |
| E004 | error | Critical gates failed | Run verify/review to resolve |
| E005 | error | `ORCHESTRATION_REVISION_CONFLICT` on archive/unarchive | Re-read `session status`, retry with fresh revision and new request-id |
| E006 | error | Open decision gate blocks `session complete` | `maestro run decide <point> --verdict proceed\|fix` |
| W001 | warning | No knowledge candidates found | Proceed |
| W002 | warning | No verify/review run in session — gate check skipped | Consider running verify before completing |
| W003 | warning | Candidate backlog left pending | Review later with `maestro knowledge review {session_id}` |
| W004 | warning | Reconciliation review remains unresolved | Completion may continue; promotion stays blocked until `maestro knowledge review --resolve` |
</error_codes>

<success_criteria>
- [ ] Target session resolved; status/orchestration_revision read from `session status` before any mutation
- [ ] Action matched the current status (complete only from `open`; archive only from `completed`/`failed`; unarchive only from `archived`)
- [ ] Knowledge candidate receipt/backlog and evidence loaded via `maestro knowledge review` (or deliberately skipped)
- [ ] Reconciliation dispositions reviewed; unresolved items were explicitly retained or resolved
- [ ] User reviewed candidates, or pending backlog was reported and deliberately retained
- [ ] Selected knowledge promoted only through `maestro knowledge promote`
- [ ] Lifecycle mutations used the fenced v3 command set (`--participant/--actor/--request-id/--reason/--expected-orchestration-revision/--json`) and the transition receipt was verified
- [ ] Dep-ready sessions identified and activation offered (on `--complete`)
</success_criteria>
