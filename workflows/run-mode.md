<!-- session-mode: inherited -->
# Canonical Run Mode

This file is the single Session/Run contract for every command, workflow, and stateful skill that declares `session-mode: run`.

Canonical lifecycle: **negotiate -> open/attach Session identity (`session/3.0`) -> dispatch/attach chain Run (`run next` / `run create`) -> brief/check/complete `--advance` -> decide / `session chain insert|replace|update|skip` as needed -> `session complete`**.

All new-runtime mutation runs through the `session/3.0 + run/3.0` minimal protocol: the Session owns the chain and the `orchestration_revision` CAS fence; each step is driven by a Run. The Execution-era machinery (`execution start/resolve/resume/seal`, core leases, `session next/done/decide`, identity/activity revisions, paused/sealed Execution state) is retained only in the clearly labeled `Legacy session/1.x/2.x Compatibility Branch` at the end of this file.

## Authority and Reuse

- A Session (schema `session/3.0`) is a durable **topic grouping/index** that owns the ordered **chain**, the decisions array, the artifact registry, and the durable `objective` / `definition_of_done`. It has no Execution, no lease, no running/paused/sealed lifecycle, and no identity revisions; the only mutation fence is the Session `orchestration_revision` (CAS via `entity_revision_cas`). Completing one unit of work never destroys the Session identity — it may later be unarchived and extended.
- A Run (schema `run/3.0`) is one immutable execution attempt bound to the exact `session_id + run_id`. Its sealed outputs remain immutable and may be consumed by later Runs in the **same Session** through the canonical `upstream`/Artifact Registry map.
- Reuse references eligible sealed outputs in place. Normal routing does not fork, import, copy, resume, or resolve Sessions to obtain prior work.
- Historical similarity is read-only evidence. It may explain potentially related work, but it never selects a Session, binds an output, creates a Run, or becomes a next action.
- Machine callers MUST pass the exact Session locator returned by Runtime. Never rely on an active-session fallback, a unique-directory scan, topic similarity, or a Session-wide status to choose mutation authority.

## New Runtime Capability Gate

1. Before the first lifecycle mutation, run `maestro capabilities --json` and parse the exact `maestro-capabilities/1.0` response.
2. The canonical v3 branch requires the exact capability contract:
   - `features.session_run_minimal_v3 = true`, `features.entity_revision_cas = true`, `features.participant_identity = true`, `features.request_receipts_v2 = true`;
   - `features.execution_lease = false` and `features.operation_registry = false` (the Execution/lease surface is retired);
   - `session_schema_writes` containing `session/3.0`;
   - `execution_schema_writes` empty;
   - `run_response_writes` containing `run-response/1.2` (1.0/1.1 remain readable for historical data only).
   Callers must separately retain `features.artifact_compatibility_v1=true` before relying on artifact compatibility recovery, `features.request_receipts_v2=true` before relying on idempotent request replay, `features.atomic_run_complete_seal=true` before relying on the atomic complete-and-advance transition, and `features.generation_scoped_seal_receipts=true` before relying on generation-scoped seal receipts. Missing additive flags disable only those mutations; structured capability, status, brief, check, and artifact-inspect reads remain available.
3. If any required capability is absent or malformed, fail closed for new-runtime mutation. Do not silently fall back to a host-only lock or a Session lifecycle alias. Enter the labeled legacy branch only when the caller explicitly selected an old CLI/schema compatibility workflow.
4. Every successful new-runtime mutation emits exactly one `run-response/1.2` envelope. Retain its exact `locator.session_id` and `locator.run_id`, plus the returned `fence` — the Session `orchestration_revision` for orchestration-target mutations, or the Run `revision` for run-target mutations.
5. Participant identity is mandatory on every mutation: pass the same authorized identity to `--participant <actor-id>` and `--actor <actor-id>`; Runtime rejects differing values. Record the mutation with `--reason "<reason>"` and repeatable `--evidence <ref>`. This is the `participant_identity` capability contract.
6. Use a stable unique `--request-id` per transition; the request-receipt log makes a repeated `--request-id` replay-safe (identical payload replays the original receipt). After every mutation, replace the cached revision with the returned fence before issuing another command. A partial locator, stale orchestration revision, changed run revision, or uncertain write result requires canonical status/recovery; never guess missing fields or retry under a new request ID.

## Prepare (optional, read-only)

- prepare/workflow/run-mode guidance is resolved by Runtime and embedded in the `run next`/`run create` birth packet as `guidance` (a `guidance-snapshot/1.0` carrying `prepare_hash` / `workflow_hash` / `run_mode_hash`). There is no standalone `run prepare` step in the v3 surface; the executor consumes the injected guidance.
- `maestro run recall <command> [args...]` is the read-only topic search across `session/3.0` Sessions. Recall is exposure only — it never allocates a Session, binds an output, or creates a Run.
- `maestro session list` enumerates `session/3.0` Sessions and `maestro session resume-view` projects the project ResumeMap (both read-only).
- `maestro run brief <run_id> --session <id>` re-attaches a Run read-only (Resume Packet) for executor crash recovery, context overflow, or manual inspection.
- Read-only and idempotent — none of these allocate a Session or create directories.

## Start or Continue a Run

> **Dispatched by an orchestrator?** When `maestro run next` invokes you, the Run is already created and its exact `session_id` / `run_id` / `run_dir` / `step_id` / `upstream` / `guidance` / `knowledge_context` / `brief.command`, resolved `task` (`command`, positional `args`, `goal`, `input_refs`), and structured executable `continuation` are injected in the birth packet (`run_already_created: true`). Use them directly and do **NOT** call `maestro run create` (a second create mints an empty duplicate Run). The dispatching coordinator retains mutation authority; an executor without mutation authority writes outputs and runs read-only checks but does not complete or advance the Run.
>
> **Resume Packet**: use birth-packet guidance directly in normal forward flow. `maestro run brief <run_id> --session <session_id>` remains available for read-only **re-attach/backtracking** (executor crash recovery, context overflow, or manual inspection).

1. Read the caller frontmatter `name` as `<command-name>`.
2. **Compose a session slug** - `YYYYMMDD-{command}-{topic}` where `{topic}` is a 1-3 word ASCII-only slug derived from the intent (for example, `20260715-odyssey-jwt-auth`). NEVER let the runtime auto-generate from a Chinese or long intent string.
3. Negotiate capabilities. Resolve an existing compatible Session identity explicitly, or open a new empty Session. For a self-started task use a distinct stable request ID:

   `maestro session open "<objective>" --id <slug> [--definition-of-done "<text>"] --participant {actor_id} --actor {actor_id} --request-id {open_request_id} --reason "<reason>" [--evidence <ref> ...] --json`

   - `<slug>` is explicit, ASCII-only, and <=64 chars.
   - Objective text is **Session metadata only** — a short human-readable phrase describing the goal. It may contain Chinese, is NOT used as the Session ID, does not enter Run task args, and does not satisfy the command contract or `argument-hint`.
   - An argument-free chain may still be seeded with `session open --chain <commands...>`. When a step needs domain text, open the Session without that step and insert it explicitly so the positional arguments are durable.
4. Insert a self-started step with its positional domain text, using the exact revision returned by open and a new request ID:

   `maestro session chain insert --session {session_id} --step-id {step_id} --command <command-name> [--arg "<task text>" ...] --participant {actor_id} --actor {actor_id} --request-id {insert_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {open_orchestration_revision} --json`
5. Dispatch the pending chain step with the exact revision returned by insert and another new request ID:

   `maestro run next --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {next_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {insert_orchestration_revision} --json`

   Direct `run create` is a machine-protocol alternative only when the exact Session step already exists. It must carry full identity/CAS fields, `--run`, and `--step`; domain text is positional and `--input` is reserved for sealed same-Session Artifact IDs:

   `maestro run create <command> "<task text>" --session {session_id} --run {run_id} --step {step_id} [--parent-run <id>] [--retry-of-run <id>] [--goal "<text>"] [--input <ART-id> ...] --participant {actor_id} --actor {actor_id} --request-id {create_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {step_orchestration_revision} --json`
6. Retain the returned exact locator, refreshed `orchestration_revision`, `run_id`, `run_dir`, and `upstream`. Do not locate Sessions, Runs, or artifacts with glob, mtime, directory ordering, or hidden command folders.
7. The `run next`/`run create` birth packet exposes the resolved `task` (`command`, positional `args`, `goal`, `input_refs`) plus a structured executable `continuation` with its operation, locator, revision requirements, and required caller fields. Consume that contract instead of reconstructing task text or copying a stale command. `maestro run brief <run_id> --session <session_id>` returns the same task/birth context in the `brief-result/3.0` Resume Packet for read-only re-attachment. Protocol readers retain `brief-result/1.1`/`1.2` compatibility for historical data only; new-runtime mutations never downgrade from `run-response/1.2`.

**Session slug examples:**
```text
# Preferred self-start: use the complete session open -> chain insert --arg -> run next
# receipt chain above, with a fresh request ID and the returned revision at each mutation.

# Direct machine-protocol alternative: full identity, locators, CAS, and positional task text.
maestro run create odyssey-planex "complete the integration plan" --session 20260715-odyssey-planex-auth --run run-planex-1 --step step-planex-1 --goal "complete the integration plan" --participant actor-7 --actor actor-7 --request-id req-create-planex-1 --reason "create self-started planex Run" --expected-orchestration-revision 4 --json
```

Never pass raw task prose through `--input`; `--input <ART-id>` is validated as a sealed Artifact from the same Session. A direct `run create` missing `--session`, `--run`, `--step`, participant/actor identity, request audit fields, or the exact orchestration revision is invalid.

## Artifact Boundary

- Every formal artifact (including evidence-role artifacts declared in the prepare contract) MUST be written under `{run_dir}/outputs/`.
- A Run may validly produce no formal artifact. Only contract v2/v2.1 outputs declared with `required: true`, or an explicit required+blocking exit gate, make an artifact mandatory. Legacy v1 `produces` entries and `required: false` outputs are descriptive/optional and MUST NOT block completion when absent.
- Every new formal JSON artifact MUST contain a complete top-level `_meta` object: `{"_meta":{"kind":"<stable-kind>","schema":"<stable-kind>/1.0"},...}`. `kind` and `schema` are required together; `role` and `alias` are optional.
- A legacy JSON artifact with no `_meta` remains readable through contract/filename inference. Never write a partial, null, or non-object `_meta`; strict validation rejects the artifact and blocks Run completion.
- `maestro run complete` with `--advance` validates and publishes `outputs/` into the Session artifact registry (`artifacts/1.0`, Runtime-owned) atomically with chain-step completion and Run sealing. Do not hand-edit the registry.
- Human-readable synthesis and handoff MUST be written to `{run_dir}/report.md`.
- report.md frontmatter keys are a fixed whitelist (`verdict`, `summary`, `constraints`, `decisions`, `concerns`, `next`, `details`); every risk, caveat, or open question MUST go into `concerns`. Keys outside the whitelist are silently dropped and never reach the handoff, the next brief's signals, or a `done_with_concerns` verdict.
- report.md frontmatter `verdict` uses the report-layer vocabulary `ready|ready_with_concerns|blocked|failed` (default `ready`) - write these canonical tokens. `maestro run complete --verdict` takes only `done|done_with_concerns` on the v3 surface; `needs-retry`/`blocked` are handled by `run transition` or `run cancel`.
- `constraints`/`decisions` items are `{ text, status }` objects — `id` is optional and auto-derived by the runtime (`C-001`/`D-001`…), never write it yourself. `next` items are `{ command, reason, needs }` (reason/needs optional). Block-style YAML is preferred; quote text values containing commas:

```yaml
---
verdict: ready
summary: "one-line outcome"
constraints:
  - text: "adopted constraint"
    status: locked
decisions:
  - text: "accepted decision"
    status: accepted
concerns:
  - "risk or caveat"
next:
  - command: <next-command>
    reason: "why next"
    needs: [<artifact-ref>]
details: {}
---
```
- Informal worker traces and intermediate logs may use `{run_dir}/evidence/` (lazily created, not gate-checked).
- Temporary computation may use `{run_dir}/work/`; it is never an artifact and is never indexed.
- `.workflow/sessions/{session_id}/` is the only durable Session identity and lineage authority. Session/Run records beneath it are Runtime-owned; do not create private command Session directories or a second status/manifest truth source. Team message buses may exist only as transient coordination and never contain formal artifacts.
- Protocol files (`sessions/<sid>/session.json`, `artifacts.json`, `evidence.json`, Run records) are Runtime-owned and MUST NOT be edited directly. Do not confuse protocol `session.json` with a workflow artifact named `outputs/session.json`; the latter is a workflow-owned formal artifact registered by Run completion.
- Consume upstream only from the canonical `upstream` map returned by `maestro run next`, `maestro run create`, or `maestro run brief`.

### Artifact Compatibility Recovery

The exact recovery order is **blocked consumer attempt -> needs-retry/cancel -> artifact inspect -> semantic republish -> explicit retry/next**.

1. Stop after the consumer attempt reports an incompatible sealed Artifact. Do not allocate another consumer Run while the blocked attempt remains active.
2. Return the consumer step to pending: complete the attempt with the fully fenced `maestro run complete {consumer_run_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {compat_complete_request_id} --reason "<reason>" --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict done_with_concerns --advance --json` and a blocking concern, or cancel it with `maestro run cancel {consumer_run_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {compat_cancel_request_id} --reason "<reason>" --expected-run-revision {run_revision} --json`. Confirm the consumer step is pending with no allocated or active Run.
3. Run `maestro artifact inspect {artifact_id} --session {session_id} --consumer {consumer_command} --alias {consumer_alias} --json`. This is read-only. Continue only when its exact assessment reports `classification=semantic_republish_required`.
4. Run `maestro artifact republish {artifact_id} --session {session_id} --consumer {consumer_command} --alias {consumer_alias} --assessment-hash {assessment_hash} --request-id {republish_request_id} --expected-artifact-revision {artifact_revision} --expected-orchestration-revision {session_revision} --participant {actor_id} --actor {actor_id} --reason "{reason}" [--evidence {evidence_ref}] --json`. Use the inspect result unchanged; `--consumer`/`--alias` mirror the preceding inspect call. A conflict requires a fresh inspect and a new request ID. Republish creates a sealed compatibility Run, a derived Artifact, and an immutable receipt without mutating the source Artifact.
5. Re-read the republish receipt, then execute its structured `continuation` with a fresh request ID and exact returned revision to allocate the retry through fenced `maestro run next`. Completion and republish never allocate the consumer retry implicitly.

Migration preserves sealed source bytes and their raw registry role/alias semantics. Recovery MUST NOT use chain skip, Run rebind, a direct Artifact Registry edit/rewrite, or any source Artifact mutation; those actions destroy the compatibility evidence instead of repairing it.

## Knowledge Reconciliation

- Search results and automatic prompt injection are **exposure only**. They may increase global impression statistics, but they never prove that a Run read, cited, validated, or contradicted an entry.
- Explicit `maestro load` / wiki loads are recorded as `consumed` through tiered routing: the unique active Run, then an unambiguous Session identity (host lease / single live hook channel), else the global usage ledger with a warning — attribution never blocks loading. Attribute search hits explicitly with `maestro knowledge record <knowledge-ids...> --signal consumed|cited|validated|contradicted --source search|load|manual [--run {run_id} | --session <session-id> | --channel <name>]` — pure ledger attribution that never stages a candidate (use `stage --signal` only when a candidate is intended). Record stronger relations by stable ID with `maestro knowledge stage <target> "<title>" --content-file <path|-> --run {run_id} --signal cited|validated|contradicted --signal-ids <comma-separated ids>`. Knowledge IDs are validated against the wiki index; unknown IDs are rejected unless `--allow-unknown`.
- Put accepted decisions and locked constraints in `report.md` frontmatter. Only reusable, prescriptive content belongs there - rules future work must follow. NEVER write execution-state narration as decisions/constraints (read-only declarations, worktree or audit-process observations, missing-file notes, or routing memos); Run completion auto-stages every accepted decision / locked constraint as a pending corpus candidate, so state narration pollutes the knowledge base. Session-origin candidates staged with `--session` live in the Session-level `knowledge-delta.json` and are governed by their immutable source snapshot, not Session lifecycle. Cross-origin candidates sharing one ID are represented by the run-source copy in the promotion plan, with completion written back to both ledgers.
- **Staging Quality Bar** — stage content only if future work can directly reuse it and at least one holds: (a) a pitfall warning ("when doing X, watch out for Y because Z" — non-obvious failure mode plus prevention); (b) a failure lesson (what failed, root cause, what worked instead); (c) a non-trivial trade-off (why A over B, with the constraints/context); (d) a newly established prescriptive constraint (spec). NEVER stage: process notes ("did X", "produced document Y"); re-descriptions of existing project patterns that code/config already documents; trivial or obvious operations; raw traces (tool outputs, log or error fragments) — distill traces into a lesson first, discard when nothing reusable can be distilled. **Zero candidates is a legitimate outcome** — never manufacture candidates to justify the pipeline.
- Stage reusable recipes, pitfalls, or other explicit candidates before completion with `maestro knowledge stage spec|knowhow "<title>" --content-file <path|-> --run {run_id} [--category <category>]`; write content to a temp file (or stdin `-`) — never inline as a positional argument: special sequences misparse and shift later arguments. Inside a Run always pass `--run {run_id}` explicitly (identity tiers — channel/lease/narrowed scan/synthetic Session — are for callers without a Run). Routine Run completion MUST NOT call `maestro spec add` or `maestro knowhow add` directly.
- Window transcripts can back staged candidates: pass `--transcript-quote <descriptor.json>` (`{host_kind, host_session_id, entry_id, quote}`) to snapshot the quoted fragment as untrusted evidence (K13). Transcript-only candidates are auto-gated to `review_required` (K17): `--all` never promotes them — resolve explicitly with `maestro knowledge promote {session_id} --resolve <candidate-id> --as unique --reason "<human review>"`. Snapshot contents never enter candidate content, review output, corpus, or search (iron rule 10): review renders only a `[untrusted]` state; never copy quote text into prompts or knowledge content.
- `maestro run check` reconciles every staged/report-derived candidate against active Spec and Knowhow through three bounded lanes: exact identity, diversified semantic neighborhood, and recorded/KG association. The receipt classifies `unique`, duplicates, extension/relation, conflict, and supersession; search exposure/popularity never changes its relevance or canonical choice.
- Completion requires a fresh `knowledge-reconciliation/1.0` fence for both the candidate snapshot and project corpus. Exact same-store duplicates are automatically suppressed. Semantic duplicates, extensions, conflicts, and supersession candidates remain reviewable and may be sealed, but cannot be promoted until explicitly resolved with `maestro knowledge review {session_id} --resolve <candidate-id> --as <choice> [--target <knowledge-id>] --reason "<reason>"`.
- Completion returns a `knowledge-candidate-receipt/1.0` with the exact staged candidate IDs and reconciliation summary. Use `maestro knowledge review {session_id}` for evidence-backed matches and copyable next commands; add `--refresh` for missing/stale receipts. Before promotion, refresh receipts with `maestro knowledge review {session_id} --refresh` as the TOCTOU fence. Promotion has two source-specific gates:
  - Run-source candidates require every source Run sealed and a fresh reconciliation receipt.
  - A `session/3.0` session-source candidate does **not** require Session completion. At stage time it must bind immutable `candidate_version` + `content_hash`, the exact `session_id` + `orchestration_revision`, and non-empty immutable `evidence_roots` + `evidence_root_hash`. Review/promotion must revalidate those candidate/evidence roots, the `candidate_snapshot_hash`, and a fresh session-level reconciliation receipt for the current `corpus_fingerprint`; final commit repeats the reconciliation/corpus check. Later unrelated Session activity does not invalidate the candidate unless its bound candidate content or evidence roots changed.
  Promote selected IDs with repeatable `maestro knowledge promote {session_id} --candidate <candidate-id>`. `--all` promotes all eligible pending candidates (observed-only emits a warning); it skips unresolved and suppressed candidates. A confirmed `supersede` resolution lets promotion create the successor and link the evolution chain atomically. Neither Run completion nor Session completion implicitly promotes or discards a backlog.
- Knowledge audit is separate read-only maintenance: `maestro knowledge audit --prune` emits a deterministic soft-action report only. Audit has no apply, mutation, or physical-delete path; usage frequency alone never produces a prune suggestion. Any later lifecycle change requires a separately authorized explicit Spec/Knowhow command.

## Chain Effects and Proposals

- Every Session uses one ordered chain (`session/3.0`). There is no static/dynamic Session type and no strategy promotion; whether a step leaves the remaining chain unchanged or proposes adaptation is decided by that step's Skill contract and output.
- The chain is Session-owned. The complete mutation capability set is the `session chain insert|replace|update|skip` surface, plus decision gates recorded by `run decide`:
  - `maestro session chain insert --session {session_id} --step-id <id> --command <name> [--arg <value> ...] [--after-step <id>] [--goal-ref <id>] [--stage <name>] [--decision-ref <id>] --participant {actor_id} --actor {actor_id} --request-id {insert_request_id} --reason "<reason>" --expected-orchestration-revision {orchestration_revision} --json`
  - `maestro session chain replace --session {session_id} --step-id <id> --command <name> [--arg <value> ...] --participant {actor_id} --actor {actor_id} --request-id {replace_request_id} --reason "<reason>" --expected-orchestration-revision {orchestration_revision} --json`
  - `maestro session chain update --session {session_id} --step-id <id> [--command <name>] [--arg <value> ...] [--goal-ref <id>] [--stage <name>] [--decision-ref <id>] --participant {actor_id} --actor {actor_id} --request-id {update_request_id} --reason "<reason>" --expected-orchestration-revision {orchestration_revision} --json` (omitted fields are preserved; clearing and decision-gate retargeting are unsupported)
  - `maestro session chain skip --session {session_id} --step-id <id> --participant {actor_id} --actor {actor_id} --request-id {skip_request_id} --reason "<reason>" --evidence <ref> --expected-orchestration-revision {orchestration_revision} --json` (skip requires evidence via `--evidence`)
- The orchestrator owns chain disposition. The executor writes its outputs, runs `run check`, and returns; it never edits Session chain state or invokes chain mutation commands.
- Interactive mode asks before chain mutation. Under an explicit user-provided `-y`, an orchestrator may auto-apply only validated `insert`/`replace`/`skip` operations that stay in the pending tail, remain within its declared budget, and align with the Session objective. Decision escalation, ambiguous intent/boundary changes, or low-confidence proposals are rejected; `-y` never invents authority.
- A step that declares `decision_ref` has a post-step gate: the Run may complete and seal, but its continuation is `run decide`, and `maestro run next` cannot advance past the completed step until `proceed`/`fix` resolves the gate. `escalate` marks the gate `escalated` (the Session stays open; advancement stays blocked until re-decided) — there is no paused Execution state.
- `maestro run complete` with `--advance` seals the immutable Run, publishes its artifacts, and completes the chain step in one atomic transition. Its next action remains `suggest_only`; only an explicit fenced `maestro run next` allocates the following chain-bound Run. `maestro run seal` is recovery-only for terminal pre-upgrade records; it is never the normal second half of completion.

## Completion

1. Run `maestro run check {run_id} --session {session_id} --json` and repair any blocking artifact or exit gate it reports. This read does not mutate state.
2. When every gate is clean, `run check` emits the Run status, available transitions, and any knowledge reconciliation receipt. Work through the workflow's declared finish norms before completing; they are prompt-layer guidance, never a blocking gate. Unresolved reconciliation is visible in the receipt and blocks later promotion, not Run sealing.
3. Complete inside the current Session with the exact cached authority:

   `maestro run complete {run_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {complete_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict {done|done_with_concerns} [--summary "<summary>"] --advance --json`

   `--advance` is required: completion atomically validates and publishes `outputs/` into the artifact registry, seals the Run, completes the chain step, and stages handoff-derived knowledge candidates. It never promotes project knowledge, executes the suggested next action, creates another Run, or changes permanent Session lifecycle.
   - **Evidence path base**: `--evidence <path>` / `--artifact <path>` resolve relative paths against `{run_dir}`, not shell CWD, and must stay inside the Run directory.
   - `done` / `done_with_concerns` are the only completion verdicts on the v3 surface.
4. Parse the `run-response/1.2` result, verify the exact locator did not change, and replace cached revisions with its returned fence. If the chain has another pending step and no open gate, invoke:

   `maestro run next --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {next_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --json`

   `suggest_only` describes Runtime passivity; it is not an implicit user-confirmation gate. Re-read each receipt before the next mutation. Never copy an old command carrying stale revisions. When the chain has no pending step, terminate with `maestro session complete ... --json` (below).
5. For a decision node, submit the evaluator result through the current Session:

   `maestro run decide {point_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {decide_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --verdict {proceed|fix|escalate} [--confidence {high|medium|low}] [--summary "..."] [--after-step <id>] --json`

6. Read the Run completion receipt. If it contains candidate IDs or reconciliation warnings, apply the **Review Presentation Protocol**: present each candidate needing a disposition with title, content summary, evidence anchors, evidence-backed matches, and recommended disposition plus rationale; collect the user's decisions, then execute the resolution.
   - Happy path: `maestro knowledge promote {session_id} --resolve <candidate-id> --as <choice> [--target <knowledge-id>] --reason "<reason>"`.
   - Compatibility fallback for missing/stale receipt repair, batch triage, or re-presentation: `maestro knowledge review {session_id} --resolve <candidate-id> --as <choice> [--target <knowledge-id>] --reason "<reason>"`.
7. Report Run success only after completion succeeds. A sealed Run and its artifacts are immutable; later Runs reuse eligible sealed outputs through `upstream` rather than copying or reopening them.

## Session Lifecycle End and Recovery

- On an orchestration-revision conflict or uncertain mutation, stop publishing, discard any unverified cached authority, and run `maestro session status --session {session_id} --json` (or `maestro run check {run_id} ...`). Do not force, infer a run, or replay with changed inputs.
- A Run that must stop early is transitioned, not paused: `maestro run transition {run_id} {running|blocked|failed} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {transition_request_id} --reason "<reason>" --expected-run-revision {run_revision} [--expected-orchestration-revision {orchestration_revision} when status=failed] --json`, or `maestro run cancel {run_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {cancel_request_id} --reason "<reason>" --expected-run-revision {run_revision} --expected-orchestration-revision {orchestration_revision} --json`. Cancellation returns the running chain step to pending for a later fenced `maestro run next`; failure leaves the step failed for inspection. There is no Execution lease to release.
- An `escalate` decision blocks chain advancement until the gate is re-decided (`run decide ... --verdict proceed|fix`). There is no paused Session state and no `execution resolve/resume` surface.
- When every Run is sealed, every chain step terminal (completed or skipped with evidence), and no open decision gate remains, finish the Session with:

  `maestro session complete --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {session_complete_request_id} --reason "<reason>" [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --json`

  Verify the returned transition receipt, then stop. The completed Session identity remains durable and may be **unarchived** (`maestro session unarchive ... --json`) for a later extension; archived Sessions cannot host new Runs. `maestro session archive` / `maestro session unarchive` are the only archive-state mutations. Legacy migration is audited and revision-fenced. Select the `session/3.0` writer first; the source Session files remain legacy until the migration commits:

  - Single Session: `maestro session migrate --session {legacy_session_id} --to-v3 --participant {actor_id} --actor {actor_id} --request-id {migrate_request_id} --reason "migrate legacy Session to v3" --expected-identity-revision {legacyIdentityRevision} --expected-activity-revision {legacyActivityRevision} --json`
  - Batch: `maestro session migrate --all --to-v3 --participant {actor_id} --actor {actor_id} --request-id {migrate_all_request_id} --reason "migrate legacy Sessions to v3" --expected-revisions '<session revision manifest JSON>' --json`

  Every migration request ID is stable and unique to its payload, and the expected revisions come from the immediately preceding read. `maestro run seal {run_id}` is a deprecated recovery-only seal for already-terminal pre-upgrade Run records.

## Legacy `session/1.x/2.x` Compatibility Branch

This branch exists only for an explicitly selected old CLI/schema that lacks the negotiated `session/3.0 + run/3.0` minimal protocol (or its pre-v3 `session/2.0 + execution/1.0 + core_execution_lease + run-response/1.1` contract). It is not canonical authority for new runtimes.

- Old runtimes may use `maestro execution start/resolve/resume/seal`, `maestro session start`, `maestro session next --inline-brief`, `maestro session done`, `maestro session decide`, `maestro session resolve`, `maestro session resume`, and `maestro session seal`, or their `maestro run ...` aliases, with `run-response/1.0`/`1.1`, Session identity/activity revisions, Execution generations, and the private core Execution lease claim. `maestro run create`/`maestro run complete` in that era carried `--execution {execution_id} --generation {generation} --expected-identity-revision/--expected-activity-revision/--expected-execution-revision --owner-id/--owner-kind/--lease-epoch/--lease-id`, and completion atomically applied a `chain-proposal/1.0` via `--apply-proposal` inside the current Execution.
- A legacy Execution may have running/paused/sealed state and own the chain/gates/decisions/active Run/revision and the core lease; at most one Execution per Session was non-sealed. Do not project those states onto `session/3.0`, and do not use this branch merely because a run was lost.
- `maestro execution seal` (verifying `execution-seal-receipt/1.0`), `maestro session seal`, and `maestro run seal-session` are deprecated bridges; new-runtime completion uses `run complete --advance` + `session complete`.
- Historical `session/1.x`/`session/2.0` session-source promotion may retain its old sealed-Session rule; the canonical `session/3.0` promotion always uses the immutable candidate/evidence/corpus receipt gate above.

## Legacy/Admin Compatibility

`maestro run recall-confirm`, `run fork`, `run import`, `run new`, `run rebind`, `run prepare <step>`, and `session create --chain-file` are deprecated admin-only compatibility commands. They may remain callable while legacy records exist, but normal topic resolution, output reuse, recall recommendations, and next-action routing MUST NOT invoke or recommend them. They provide no force bypass; durability and recovery internals remain Runtime-owned.

**Workflow-specific finish norms**: declare a `finish:` list in the workflow file's YAML frontmatter; each entry is one norm line appended to the `run check` finish checklist.

```yaml
---
name: my-workflow
prepare: my-workflow
commands: [my-command]
finish:
  - Confirm every fix commit references its finding ID.
---
```

## Team Skills and FSM Chains

`team-*` skills are independent user entry points invoked directly by the user with `/team-*`; Maestro/Ralph never select them from the shared chain catalog or dispatch them as orchestration stages. A self-started team coordinator still owns one explicit single-step `session/3.0` chain and allocates that step through its fenced `run next` receipt chain.

The coordinator owns that Run lifecycle under `run-mode-lite.md`. The broader FSM chain contract above governs Maestro/Ralph-dispatched lifecycle steps, while the same v3 identity, audit, CAS, task, and continuation contracts remain mandatory for the team's private single-step chain.
