---
name: maestro-ralph
disable-model-invocation: false
description: Closed-loop policy over the canonical Session/Run chain
argument-hint: <intent> [-y] [-c] [--amend]
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
  - update_plan
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
@~/.maestro/workflows/orchestrator-run-loop.md
@~/.maestro/prepare/ralph.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

If any required file above was not expanded into context by the host, or its content is no longer in context, Read it explicitly before executing the state machine.

<deferred_reading>
- [ralph-amend-goal.md](~/.maestro/workflows/ralph-amend-goal.md) — read only for `--amend`
</deferred_reading>

<purpose>
Apply retry, confidence, drift, goal-audit and stopping policy over the exact current Session chain of a durable topic Session. Ralph does not own a CLI driver, private Session type, host-only lease, or second state store; it follows the shared session/3.0 Run loop. Primary path: locate and drive an existing Session. Opening a Session is a fallback when no compatible identity exists.
</purpose>

<interface>
Only these user flags are accepted:

- `-y` — skip all confirmation/clarification interactions, use default choices. Does NOT change data semantics (no auto-deferred decisions). Never bypasses: high-risk classification, confidence <60, ambiguity requiring user input, failed gates, or drift escalation.
- `-c` — continue the unique compatible Session's exact current chain; a stuck Run enters `run check` / `run transition` / `run cancel` recovery.
- `--amend` — amend the exact current Session objective/definition-of-done; remaining text is the change request.

All remaining text is intent. No engine, roadmap, script, depth, role, tier, platform, resume or dry-run flags are parsed. Those choices belong to Skill contracts and Runtime.
</interface>

<invariants>
1. **Ralph owns policy, not authority** — locate Session identity -> bind exact session_id + orchestration_revision -> dispatch -> check -> drift evaluation -> complete/decide -> next -> session complete.
2. **One executor per Run** — dispatch one unnamed `run-executor`; nested execution strategy belongs to the Skill.
3. **Thin executor** — executor executes and checks one Run but never receives the private claim or completes it.
4. **Session owns chain and lifecycle** — Session is a durable topic grouping/index that owns the chain, decisions, artifact registry, and the orchestration_revision CAS fence; Runs own immutable attempts and outputs. There is no Execution, no lease, no pause/resume/seal.
5. **Canonical upstream map** — same-Session sealed outputs enter only through birth/brief; no manual context reconstruction.
6. **Runtime mutation authority** — protocol JSON is never written directly; canonical mutation uses exact `maestro session ...` / `maestro run ...` commands and `run-response/1.2` envelopes.
7. **Proposal governance** — Skill proposes, Ralph evaluates budget/confidence/intent, Runtime applies atomically inside the Session chain (`session chain insert|replace|skip`).
8. **No prompt fix templates** — fix/review/goal gaps dispatch a Skill that may emit a proposal.
9. **Decision receipts are single-source** — decisions land through fenced `maestro run decide`, never direct append.
10. **Auto is bounded** — `-y` cannot bypass high risk, confidence <60, ambiguity, escalation, failed gates or reground halt.
11. **Legacy compatibility is out of band** — Session lifecycle aliases are allowed only by the labeled `session/1.x` branch in the shared loop.
12. **Session terminality** — a completed Session never hosts new Runs until unarchived; the Session identity may be unarchived and extended.
13. **Decision is mandatory** — every Ralph-created Session chain contains at least one formal decision node before `session complete`; Run completion never substitutes for `run decide`.
14. **Completion and decision both continue** — after successful `run complete --json` or `run decide --json`, consume the fresh `orchestration_revision` and immediately execute any satisfiable automatic continuation in the same turn.
15. **Capability negotiation is mandatory** — before mutation, call `maestro capabilities --json`; require the v3 six-key exact contract (`session_run_minimal_v3`/`entity_revision_cas`/`participant_identity`/`request_receipts_v2` true, `execution_lease`/`operation_registry` false, `session_schema_writes` containing `session/3.0`, `execution_schema_writes` empty, `run_response_writes` containing `run-response/1.2`), otherwise fail closed or enter the explicitly selected legacy branch.
</invariants>

<state_machine>

<states>
S_PARSE — parse intent and the three public flags
S_RESOLVE — locate or create a compatible Session
S_INFER — infer lifecycle position and roadmap need
S_DECOMPOSE — derive boundary and observable goals for a new Session
S_ASSESS — classify creation risk and evidence confidence
S_BUILD — build initial Skill chain
S_CREATE — open/resolve Session identity, bootstrap its chain
S_CONFIRM — confirm unless `-y`
S_RUN_LOOP — shared v3 Run lifecycle (`run next` → execute → check → complete/decide)
S_EVALUATE — quality/goal/scope/reground decision
S_AMEND — audited goal amendment
S_RECOVER — audited recovery for an open decision gate or stuck Run
S_FAIL — retry or stop; retry exhaustion leaves the chain step pending (no paused Execution)
S_DONE — complete the current Session
</states>

<transitions>
S_PARSE:
  → S_AMEND WHEN: `--amend`
  → S_RESOLVE WHEN: `-c` or intent present
  → S_FAIL OTHERWISE

S_RESOLVE:
  -> S_RECOVER WHEN: exact current Session has an open decision gate or a stuck Run and `-c`
  -> S_RUN_LOOP WHEN: exact current Session is `open` with a chain and a valid orchestration_revision fence
  -> S_INFER WHEN: only a gated/stuck Session exists and no `-c` (treat as new intent; do not mutate it)
  -> S_INFER WHEN: no current Session and intent present
  -> S_FAIL WHEN: multiple identities/Sessions or archived identity

S_INFER → S_DECOMPOSE → S_ASSESS → S_BUILD → S_CREATE
S_CREATE → S_RUN_LOOP WHEN: `-y` AND risk ≠ high AND confidence_score ≥ 60
S_CREATE → S_CONFIRM WHEN: `-y` AND (risk == high OR confidence_score < 60)
S_CREATE → S_CONFIRM OTHERWISE
S_CREATE → S_FAIL WHEN: creation fails (delete temp file, report error)
S_CONFIRM → S_RUN_LOOP WHEN: confirmed
S_CONFIRM → S_BUILD WHEN: revised
S_CONFIRM → END WHEN: cancelled

S_RUN_LOOP:
  → S_EVALUATE WHEN: next node is a decision
  → S_FAIL WHEN: executor/check/drift reports retry or blocker
  → S_DONE WHEN: `CHAIN_COMPLETE`
  → S_DONE WHEN: no pending steps and no `CHAIN_COMPLETE` (implicit completion)
  → S_RUN_LOOP WHEN: Run sealed and another pending step exists

S_EVALUATE:
  -> S_RUN_LOOP WHEN: proceed or accepted fix proposal
  -> S_RECOVER WHEN: escalate blocks the decision gate (Session stays open until re-decided)
  -> S_FAIL WHEN: escalation cannot be committed
  -> S_RUN_LOOP WHEN: post-goal-audit AND has_unmet (fix loop; insert repair step at `target_stage`)
  -> S_DONE WHEN: post-goal-audit AND all_met AND INTENT_ALIGNED
  -> END WHEN: post-goal-audit AND all_met AND NOT INTENT_ALIGNED (REGROUND_HALT)
  -> S_RUN_LOOP WHEN: post-analyze-scope (apply `scope_verdict` to the Session chain path)
  -> S_DONE WHEN: post-execution AND preflight passed (decide then Session completion)
  -> S_RUN_LOOP WHEN: post-execution AND preflight failed (fix loop)
  -> END WHEN: post-debug-escalate (gate stays escalated)
  -> END WHEN: post-reground AND drifted AND confidence >= 60 (REGROUND_HALT; `-y` does not bypass)
  -> S_RUN_LOOP WHEN: post-reground AND aligned
  -> S_RUN_LOOP WHEN: post-reground AND drifted AND confidence < 60 (proceed, mark LOW CONFIDENCE)

S_FAIL:
  -> S_RUN_LOOP WHEN: retry budget remains
  -> END WHEN: retry budget exhausted (chain step stays pending for a later fenced `run next`)
  -> END WHEN: gate escalated or user aborts

S_AMEND → S_RUN_LOOP WHEN: shared amend protocol committed
S_RECOVER → S_RUN_LOOP WHEN: blockers resolved and re-dispatch committed
S_RECOVER → S_FAIL WHEN: blockers unresolvable
S_RECOVER → END WHEN: user aborts recovery
S_DONE → S_RUN_LOOP WHEN: Session completion fails due to unmet gates
S_DONE → END
</transitions>

<actions>

All command syntax and lifecycle mechanics follow `orchestrator-run-loop.md` and `run-mode.md`. The actions below define only Ralph-specific policy decisions.

### A_RESOLVE

Read-only lookup via `run recall`. Explicit birth `session_id + run_id` wins. Multiple candidates require user selection; historical similarity never grants authority.

### A_INFER

Classify `lifecycle_position` from evidence in this order:

1. An explicit request for grill, brainstorm or blueprint selects that entry.
2. Outside those three pre-project entries, a missing Maestro project structure selects init.
3. Reusable sealed outputs from the same Session may skip only the stages they satisfy: verified analysis without a plan selects plan; a verified plan without implementation selects execute; verified implementation selects the first applicable review/test stage.
4. Without reusable same-Session evidence, bounded work starts at analyze. Work whose scope is itself unresolved starts at analyze-macro.

Code presence, historical similarity from another Session, or a stage name mentioned only as an example never proves lifecycle completion. Set `wants_roadmap=true` only for an explicit roadmap request or evidence of at least 2 independently releasable milestones; file count alone is insufficient.

Record `lifecycle_position`, `wants_roadmap`, supporting evidence and every skipped stage with its reason. Ambiguous evidence is carried into A_ASSESS rather than silently choosing a later stage.

### A_DECOMPOSE

Derive one boundary contract and outcome-oriented goal set before building the chain:

```json
{
  "boundary_contract": {
    "in_scope": [],
    "out_of_scope": [],
    "constraints": [],
    "definition_of_done": ""
  },
  "decomposition": {
    "execution_criteria": [],
    "goals": [
      {
        "id": "G1",
        "goal": "",
        "boundary": "",
        "done_when": "",
        "evidence": "",
        "lifecycle": [],
        "status": "pending"
      }
    ],
    "changelog": []
  }
}
```

Work is broad when it affects at least 3 modules, changes a cross-package interface, or leaves at least 2 of scope/constraints/done criteria unresolved. Ask at most 3 boundary questions; `-y` cannot invent answers for broad ambiguity. Narrow work may use the intent as its single `in_scope` item, but still requires an observable `definition_of_done`.

Every goal must describe a user-visible or verifiable outcome, map to at least one `in_scope` item, name concrete evidence in `done_when`/`evidence`, and list only lifecycle stages that can produce that evidence. Reject empty goals, stage-named goals, duplicate IDs and goals with no evidence path.

### A_ASSESS

Produce a creation assessment with `risk`, `risk_reasons`, `confidence_score`, `confidence_reasons` and `unresolved_questions`.

- `high` risk: destructive or irreversible operations; production/release mutation; authentication, authorization or sensitive-data changes; data/schema migration without a proven rollback; or backward-incompatible public contract changes.
- `medium` risk: multi-module behavior, compatible API/schema changes, new dependencies, concurrency/state-machine changes, or migrations with a verified rollback.
- `low` risk: isolated reversible work with existing patterns and a known verification path.

Compute confidence from 100 and clamp to 0–100. Apply each applicable penalty once: −30 unresolved scope/constraint/done criterion; −20 ambiguous lifecycle position; −20 missing or stale required upstream evidence; −15 unverified cross-module integration assumption; −15 unknown test or verification path. Cite evidence for every deduction.

Confidence maps to low `<60`, medium `60–79`, high `≥80`. High risk always requires confirmation. Confidence below 60 cannot enter S_RUN_LOOP until the missing evidence or ambiguity is resolved; `-y` never bypasses either gate.

### A_BUILD

Consume the outputs of A_INFER, A_DECOMPOSE and A_ASSESS; do not re-infer them while assembling the chain. Quality is quick/standard/full based on specs and observable risk, not a user flag. Quality criteria: quick = single-file + existing tests; standard = multi-file + new logic; full = cross-module + no existing coverage.

Build the chain from `prepare/ralph.md` Stage Mapping. If the Stage Mapping or Build Rules are not in context, Read `prepare/ralph.md` directly (it is in required_reading) — in v3 the same prepare guidance is injected into the `run next` / `run create` birth packet (`guidance-snapshot/1.0`); prepare is embedded in the Run, not a standalone `run prepare` step. Propagate goal references, map the current host to the Skill scanner's `target_platform` (`claude|codex|agent|agy|pi`), and prevalidate every command with `maestro skills --steps --json --platform {target_platform}`. Never default a non-Claude host to `claude`; `pi` resolves Skills from the installed `pi-maestro-flow` npm package's `package.json#pi.skills` directories. Every chain includes at least one final quality/goal/scope decision node before `session complete`; long chains also include periodic reground decision nodes. Step execution strategy is defined by each Skill, never by Ralph flags.

### A_EXECUTE

Follow `orchestrator-run-loop.md` exactly. Display identity may use stage prefixes, but no private agent name or Ralph progress file is persisted. Task/Goal UI is projection only.

### A_EVALUATE

Follow `orchestrator-run-loop.md` "4. Decision Step"; the VERDICT format is defined in `prepare/ralph.md`. Ralph policy thresholds:

- Confidence mapping: low = <60, medium = 60-79, high = ≥80.
- Confidence below 60 → cannot proceed.
- Retry budget exhaustion → escalate.
- Goal audit: compare every pending goal's `done_when` against evidence; missing evidence means unmet.
- Reground: compare cumulative handoffs against intent and boundary; confident drift halts even under `-y`. drift = cumulative handoffs deviate from ≥2 boundary_contract.in_scope items or introduce ≥1 out_of_scope item; confident drift = drift detected with confidence ≥80%.

### A_FAIL

- Repairable failure → verdict `needs-retry`; re-dispatch only after Runtime returns the step to pending (via `run transition`/`run cancel`).
- External or exhausted blocker → apply the receipt's structured `continuation` with the fully fenced `run transition ... blocked` or `run cancel` form from `orchestrator-run-loop.md`; the chain step stays pending for a later fenced `run next`. There is no Execution lease to release.
- Never allocate a new Run while the previous Run is running or gate-blocked.

### A_RECOVER

Only explicit `-c` enters recovery. Follow `orchestrator-run-loop.md` "5. Recovery and Amend" exactly.

### A_AMEND

Read `ralph-amend-goal.md`. High risk always asks. Pending-tail changes come from a planning Skill proposal, not direct edit.

### A_DONE

When every Run is sealed, every decision is terminal, every goal is done, no request is claimed, and the chain is complete -> `maestro session complete` with the exact `session_id + orchestration_revision`. Session identity remains reusable.

</actions>

</state_machine>

<success_criteria>
- Public flags are exactly `-y`, `-c`, `--amend`.
- No legacy Ralph driver, private Session type, or independent Skills CLI appears in normal flow.
- Each Run (`run/3.0`) follows `run next` -> execute -> `run check` -> fenced `maestro run complete --verdict --advance`; backtracking uses `run brief`. Every decision uses fenced `run decide`.
- Final completion uses `maestro session complete`; Session identity is never permanently sealed in the canonical branch.
- Proposal acceptance is pathless from Ralph's perspective and atomic with Run completion.
- Retry, confidence, drift, goal audit, recovery and terminal semantics remain explicit.
</success_criteria>
