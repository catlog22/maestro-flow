<!-- session-mode: inherited -->
# Canonical Orchestrator Run Loop

Canonical lifecycle reference: `@~/.maestro/workflows/run-mode.md`.

Maestro and Ralph share this loop. Session (`session/3.0`) is durable topic identity owning the chain, decisions, artifact registry, and the `orchestration_revision` CAS fence; each Run is an immutable step attempt; Runtime alone writes protocol records. There is no Execution, no lease, and no paused state.

## Public flags

- `-y`: auto-confirm bounded low-risk choices; never bypass high risk, low confidence, ambiguity, failed gates, recovery, or drift halt.
- `-c`: continue the unique compatible Session's exact chain. Multiple candidates require selection; a Session with an open decision gate enters audited recovery.
- `--amend`: amend the current Session objective/definition-of-done through the audited proposal flow.

All other text is intent. Roadmap, quality, executor, platform, reuse, parallelism, and adversarial strategy derive from intent, Session identity, current chain state, Skill contract, and host Runtime.

## Capability and Authority Gate

1. Before any mutation, call `maestro capabilities --json`. Canonical mutation requires the exact v3 capability contract: `features.session_run_minimal_v3=true`, `features.entity_revision_cas=true`, `features.participant_identity=true`, `features.request_receipts_v2=true`, `features.execution_lease=false`, `features.operation_registry=false`; `session_schema_writes` containing `session/3.0`; `execution_schema_writes` empty; `run_response_writes` containing `run-response/1.2`.
2. If negotiation is absent, malformed, or incomplete, fail closed. Never downgrade to a host-only lock or a Session lifecycle alias. The explicit legacy branch is the only old-schema fallback.
3. Keep one private authority record for the loop:

   `session_id + orchestration_revision + run_id? + actor_id`

   `--actor {actor_id}` carries the authorized identity; `--participant` defaults to it and explicit differing values are rejected.
4. Every new-runtime mutation uses a stable request ID unique to that payload, the exact locator, and the current `--expected-orchestration-revision` (run-target mutations also use `--expected-run-revision` where required). Parse exactly one `run-response/1.2` envelope, verify the locator is unchanged, and replace cached revisions from its fence before the next mutation.
5. Never persist actor identity or request IDs as mutation authority outside coordinator memory. If a write result is uncertain, discard unverified authority and recover from canonical `session status` / `run check` instead of guessing or replaying with changed inputs.

## Authority

- Session identity, chain, decisions, and Session-global artifact lineage are durable. A `session/3.0` Session has no running/paused/sealed authority — its statuses are `open|completed|archived|failed`; the chain step drives progress.
- The Session chain is the only authority for step order, gates, and goal references; `orchestration_revision` is the only mutation fence.
- Run owns its immutable input/output/handoff and is sealed exactly once by `run complete --advance`; retry creates a new Run (or re-dispatch of the same pending step) in the same Session.
- Skill produces domain results; the orchestrator owns chain disposition through fenced `session chain insert|replace|update|skip` and decision gates through `run decide`; Runtime applies allowed mutations atomically.
- Historical similarity is read-only. Same-Session sealed outputs enter only through the canonical `upstream` map.

## Continuation Router

For new-runtime responses, the `run-response/1.2` locator/fence, resolved `task`, and structured executable `continuation` are authoritative. `task` supplies the exact command, positional args, goal, and input Artifact refs. Rebuild the continuation mutation with the freshly returned locator/revision and its required caller fields; `result.next` is only a passive hint. Never reconstruct task text or execute a stale command copied from an older receipt. Legacy `run-response/1.0`/`1.1` routing applies only in the compatibility branch.

`suggest_only` means the CLI is passive, not that confirmed chain work needs another user prompt:

- `authority=automatic`: if preconditions match the current Session and revision, execute one action, parse its receipt, and loop.
- `authority=auto_mode_only`: execute only when current Session policy enables auto mode and the action is in the `-y` whitelist.
- `authority=user_required`: stop and report the exact blocker, hashes/revisions, reason code, and evidence needed.

**Turn 终止不变量**: while the current Session is `open`, its chain has a satisfiable pending step, and an `automatic` action exists, do not end the turn or report overall completion. Re-read authority after every action; never predict multiple transitions from one receipt.

| continuation.action | Canonical prompt behavior |
|---|---|
| `load_run` | Load the same exact `run_id` with `run brief`; never create a duplicate Run |
| `execute_run` | Execute its birth/Resume Packet, then check; executor never completes |
| `repair_run` | Reattach the same Run, repair gates, then check again |
| `dispatch_next` | Invoke fenced `maestro run next ... --json` once |
| `evaluate_decision` | Read one decision card, dispatch a read-only evaluator, then invoke fenced `maestro run decide` |
| `accept_reuse` | Apply REVIEW rules below without changing the chain anchor |
| `recover_session` | Read `session status` / `run check`, transition or cancel the stuck Run, then re-dispatch with `run next` |
| `seal_session` | Revalidate Session terminal gates, then use fenced `maestro session complete ... --json` |
| `offer_recommendations` | Show chain-external suggestions only; never allocate a Run implicitly |
| `repair_chain` / `stop` | Stop and report structured reasons; never bypass authority |

### REVIEW Reuse

`REUSE` consumes canonical upstream directly; `REJECT` and `CONFLICT` are never accepted. `REVIEW` opens a required consume gate only after an exact acceptance receipt. The current Runtime must supply a chain-aware acceptance mutation or the orchestrator fails closed; it must not use a Session-status shortcut inside the canonical branch. After acceptance, reload the same exact Run. Treat `assessment.acceptance_status=accepted` as processed even if `assessment.decision=REVIEW` remains the original assessment.

### `-y` Policy

Normal confirmed-chain continuation does not depend on `-y`. It only expands low-risk discretion:

- May automate: validated pending-tail chain mutation (`session chain insert|replace|update|skip`); same-Session `QUALITY_MEDIUM` REVIEW with sealed producer/artifact, exact chain anchor, current revision/fence, and evidence.
- Must stop: `QUALITY_LOW`, `REJECT`, `CONFLICT`, hash/freshness/supersession uncertainty, boundary change, high risk, low confidence, retry exhaustion, an escalated decision gate, or external blocker.
- handoff `next[]` remains chain-external recommendation. Automatic same-Session continuation requires an accepted typed proposal or gate resolution.

### `complete` / `decide` 闭环

- After successful fenced `maestro run complete ... --advance --json` or `maestro run decide ... --json`, consume the fresh fence and immediately execute a satisfiable automatic next action.
- A decision node does not create a Run. A declared `decision_ref` is a post-step gate: the Run completes first, its receipt routes to `run decide`, and `run next` cannot advance past that completed step until the gate resolves.
- A birth packet with `run_already_created=true` is strict: use that exact `run_id`/locator and never call `run create` again.
- `proceed` may route to another Run, another decision, or Session completion. `escalate` blocks the gate (the Session stays `open`); `fix` requires new repair evidence before another decision.

## Lifecycle

### 1. Resolve or Open Session

1. Negotiate capabilities first. For `-c` / `--amend`, use read-only recall to identify the Session, then call `maestro session status --session {session_id} --json`.
2. For new intent, classify and validate a chain definition. Each chain step declares `command/args/stage/goal_ref/decision_ref`. Prevalidate names with `maestro skills --steps --json --platform {target_platform}` where platform is `claude|codex|agent|agy|pi`.
3. Open only the durable Session with `maestro session open "<objective>" --id {slug} [--definition-of-done "<text>"] [--chain <argument-free commands...>] --actor {actor_id} [--evidence <ref> ...] --json`. Chain/engine/quality/auto belong to the Session chain and its policy, never to a separate Execution. Add a step and its positional args with `maestro session chain insert --session {session_id} --step-id <id> --command <name> [--arg <value> ...] [--after-step <id>] [--goal-ref <id>] [--stage <name>] [--decision-ref <id>] --actor {actor_id} --expected-orchestration-revision {open_orchestration_revision} --json`. Every later insert/replace/skip uses another request ID and the exact revision returned by the preceding receipt.
4. Retain the exact returned locator and `orchestration_revision`. A completed/archived Session cannot host new Runs until unarchived; never mutate sealed prior Runs.

### 2. Allocate and Execute One Run

1. Read canonical Session status. For an execution step invoke:

   `maestro run next --session {session_id} --actor {actor_id} [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --json`

2. Parse the `run-response/1.2` birth packet (`run_dir`/`upstream`/`guidance`/`knowledge_context`/`brief.command`, resolved `task`, structured executable `continuation`, `run_already_created=true`) and refreshed fence. For normal forward flow use its task and guidance; otherwise load exact `maestro run brief {run_id} --session {session_id}`.
3. Dispatch one unnamed `run-executor`. It writes formal artifacts to `{run_dir}/outputs/`, handoff to `{run_dir}/report.md`, and calls `maestro run check {run_id} --session {session_id} --json`. It never completes the Run and never mutates Session state.

### 3. Analyze, Gate, and Complete

Extract `summary`, evidence paths, non-obvious decisions, and concerns. Map drift to verdict:

| Result | Verdict |
|---|---|
| aligned | `done` |
| minor drift | `done_with_concerns` |
| major drift with retry left | complete `done_with_concerns` + re-dispatch the pending step with `run next` |
| major drift exhausted | `done_with_concerns` with explicit concern |
| external blocker | `run transition {run_id} blocked ... --json` |

Complete with the exact locator/fence:

`maestro run complete {run_id} --session {session_id} --actor {actor_id} [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict {done|done_with_concerns} [--summary "<summary>"] --advance --json`

A blocking result repairs the same Run. A sealed Run is immutable. A failed/cancelled Run leaves the step pending; the next Run is allocated only after Runtime returns the step to pending via `run next`.

### 4. Decision Step

1. Dispatch a read-only evaluator over canonical artifacts and goal evidence.
2. Parse `proceed|fix|escalate`; parse failure becomes `fix` with low confidence.
3. Submit through the current Session:

   `maestro run decide {point_id} --session {session_id} --actor {actor_id} [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --verdict {proceed|fix|escalate} [--confidence {high|medium|low}] [--summary "..."] [--after-step <id>] --json`

4. Parse the new fence and remain in the same loop. Pending-tail changes come from fenced `session chain insert|replace|update|skip`, never direct prompt mutation.

### 5. Recovery and Amend

Recovery is explicit and pauseless:

1. Read `maestro session status` for exact blockers, locator, and revisions.
2. Transition the stuck Run with `maestro run transition {run_id} {running|blocked|failed} --session {session_id} --actor {actor_id} --expected-run-revision {run_revision} [--expected-orchestration-revision {orchestration_revision} when status=failed] --json`, or cancel it with `maestro run cancel {run_id} --session {session_id} --actor {actor_id} --expected-run-revision {run_revision} --expected-orchestration-revision {orchestration_revision} --json`; resolve open decision gates with the fully fenced `run decide` form above.
3. Re-dispatch the pending step with fenced `maestro run next` after the revision is refreshed. There is no Execution resume; every new Run still requires fenced `run next`.

Goal amendment snapshots the current Session, performs impact analysis and confirmation, then uses a chain-aware typed proposal. The old `session meta update` flow is compatibility-only for `session/1.x`/`2.0`.

### 6. Complete

After all Runs are sealed, the chain is terminal (every step completed or skipped with evidence), and no open decision gate remains:

`maestro session complete --session {session_id} --actor {actor_id} [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --json`

Verify the transition receipt, then stop. The completed Session identity stays durable; `session unarchive` may reopen it later. `run seal` is recovery-only for terminal pre-upgrade records; it is never the normal completion path.

## Failure Rules

- Blocking `run check`: repair the same Run; do not report success or allocate another.
- Null/failed executor: complete the attempt honestly; retry only through Runtime transition.
- Revision conflict or uncertain write: stop, discard unverified authority, reread `session status`, and recover explicitly. Never force.
- A completed Session is terminal until unarchived; an archived Session cannot start a Run.

## Legacy `session/1.x/2.x` Compatibility Branch

Use this branch only for an explicitly selected old CLI/schema lacking the negotiated `session/3.0` contract. Old Runtime may use `maestro session create --chain-file`, `session next --inline-brief`, `session done`, `session decide --json`, `session resolve/resume`, and `session seal`, or the Execution-era surface (`execution start/resolve/resume/seal` with `--expected-identity-revision`/`--expected-activity-revision`/`--expected-execution-revision` and the core lease claim `--owner-id/--owner-kind/--lease-epoch/--lease-id`), with Session running/paused/sealed state, Execution generations, and `run-response/1.0`/`1.1`. Those aliases are not canonical authority for `session/3.0`, must not be used to recover a lost revision, and must remain visibly labeled as legacy compatibility.
