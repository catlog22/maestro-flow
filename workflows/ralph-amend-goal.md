<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/orchestrator-run-loop.md
</required_reading>
# Session Chain Goal Amendment Flow

The filename is retained for compatibility. Under `session/3.0`, goal/boundary/decomposition and pending-tail changes belong to the Session chain and its policy, never to a separate Execution or durable Session metadata command. Runs use the `run/3.0` schema driven by fenced `maestro run next`/`maestro run complete`.

## 1. Capability and Snapshot

1. Run `maestro capabilities --json`; require the v3 six-key exact contract (`features.session_run_minimal_v3/entity_revision_cas/participant_identity/request_receipts_v2 = true`, `execution_lease/operation_registry = false`, `session_schema_writes` containing `session/3.0`, `execution_schema_writes` empty, `run_response_writes` containing `run-response/1.2`) or fail closed.
2. Resolve exactly one compatible Session through read-only recall, then read `maestro session status --session {session_id} --json`.
3. Retain exact `session_id + orchestration_revision` (plus `run_revision` for run-target mutations) and one authorized `actor_id`; pass it to `--actor` (`--participant` defaults to it). Never infer current authority from Session status.
4. Snapshot current Session objective, boundary contract, sealed Run handoffs, pending chain, decisions, and revision. A completed/archived Session cannot host new Runs until unarchived.

## 2. Parse and Assess

Use remaining `--amend` text as `change_request`; ask when empty. Classify `modify|add|remove|boundary` and derive affected goals, invalidated steps, new gaps, boundary additions, risk, reason, and evidence.

Assessment is read-only. Completed Run evidence remains immutable. High risk always requires explicit confirmation; `-y` cannot bypass it.

## 3. Build the Pending-Tail Chain Change

Construct the pending-tail chain change in memory:

- Append one `CHG-NNN` entry with before/after goals, reason, risk, and evidence.
- Supersede only unfinished affected goals; completed goals remain immutable evidence.
- Give modified goals versioned IDs and added goals the next `G{n}` ID.
- Add boundaries without deleting historical constraints.
- Preserve the chain step shape: `command/args?/stage?/goal_ref?/decision_ref?`.

Do not edit protocol JSON or issue direct chain mutations from a Skill. The orchestrator applies the pending-tail change through the fenced chain surface after Skill assessment:

`maestro session chain replace --session {session_id} --step-id <id> --command <name> --actor {actor_id} --expected-orchestration-revision {orchestration_revision} --json`

or `maestro session chain insert --session {session_id} --step-id <id> --command <name> [--arg <value> ...] [--after-step <id>] [--goal-ref <id>] [--stage <name>] [--decision-ref <id>] --actor {actor_id} --expected-orchestration-revision {orchestration_revision} --json` for added steps. Skipping a non-running step uses the fully fenced `session chain skip` form with evidence.

## 4. Commit the Amendment

After confirmation, dispatch the amended step through the exact fenced call:

`maestro run next --session {session_id} --actor {actor_id} --expected-orchestration-revision {orchestration_revision} --json`

and complete it with:

`maestro run complete {run_id} --session {session_id} --actor {actor_id} --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict {done|done_with_concerns} --advance --json`

Runtime must atomically validate and seal the Run plus advance the chain step and return `run-response/1.2`. Consume its fresh `orchestration_revision` before continuing. Reject by recording a blocking concern; revise by re-reading `maestro session status` and applying another fenced chain mutation.

If the installed Runtime cannot express the complete goal/decomposition replacement as a Session-chain pending-tail change, stop with a capability blocker. Do not silently call a Session metadata command in the canonical branch.

## 5. Continue

Display amendment ID, risk, superseded/added goal counts, and chain disposition. Re-read exact `maestro session status`, then continue through fenced `maestro run next`. Recovery reads `maestro run check {run_id} --session {session_id} --json` and transitions/cancels the stuck Run; final completion remains `maestro session complete`.

## Legacy `session/1.x/2.x` Compatibility Branch

Only an explicitly selected old CLI/schema (`session/2.0 + execution/1.0 + core_execution_lease + run-response/1.1`) may use `maestro execution status/resolve/resume/seal`, `maestro session meta update --decomposition-file`, `maestro session next --inline-brief`, ad-hoc legacy `maestro run create`, and `maestro session done --apply-proposal`. These Session lifecycle/revision commands are compatibility authority only and must never replace a lost or stale new-runtime `orchestration_revision` claim.
