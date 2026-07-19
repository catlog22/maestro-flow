<!-- session-mode: inherited -->
# Canonical Run Mode

This file is the single Session/Run lifecycle contract for every command, workflow, and stateful skill that declares `session-mode: run`.

Lifecycle verbs: **prepare → create → brief → check → complete**.

## Authority and Reuse

- A Session is a durable **topic grouping/index**. It groups related Runs; it is not an execution result and historical similarity never grants Session mutation authority.
- A Run is one execution attempt. Its sealed outputs remain immutable and may be consumed by later Runs in the **same Session** through the canonical `upstream`/Artifact Registry map.
- Reuse references eligible sealed outputs in place. Normal routing does not fork, import, copy, resume, or resolve Sessions to obtain prior work.
- Historical similarity is read-only evidence. It may explain potentially related work, but it never selects a Session, binds an output, creates a Run, or becomes a next action.

## Prepare (optional, read-only)

- `maestro run prepare <step>` resolves what a step would consume and produce without side effects.
- Read-only and idempotent — it never allocates a Session or creates directories.
- Use it to preview upstream availability and the derived artifact contract before committing to a Run.

## Start or Continue a Run

> **Dispatched by an orchestrator?** When `ralph next` or `maestro run next` invokes you, the Run is already created and its `run_id` / `run_dir` / `upstream` are injected in the birth packet — use them directly and do **NOT** call `maestro run create` (a second create mints an empty duplicate Run). The steps below apply only to a command starting a Run on its own.

1. Read the caller frontmatter `name` as `<command-name>`.
2. **Compose a session slug** — `YYYYMMDD-{command}-{topic}` where `{topic}` is a 1–3 word ASCII-only slug derived from the intent (e.g. `20260715-odyssey-jwt-auth`). NEVER let the runtime auto-generate from a Chinese or long intent string.
3. Run `maestro run create <command-name> --session <slug> --intent "<short intent phrase>" -- $ARGUMENTS` before domain work.
   - `--session`: the slug from step 2 (explicit, ASCII-only, ≤64 chars).
   - `--intent`: a short human-readable phrase (1 sentence) describing the goal. May contain Chinese but is NOT used as the session ID.
   - `$ARGUMENTS`: command-specific flags (e.g. `--template <name>`).
4. The runtime resolves the Session in this order: an explicit compatible `--session`, an unambiguous canonical topic match, otherwise a newly allocated topic Session. Paused or historical similarity is read-only and never authorizes selection, resume, or mutation.
5. Retain the returned `session_id`, `run_id`, `run_dir`, and `upstream`. Do not locate Sessions or artifacts with glob, mtime, directory ordering, or hidden command folders.
6. `maestro run brief <run_id>` returns the Resume Packet — same-Session sealed artifacts, the authoritative upstream map, and open decisions — for continuing an existing Run.

**Session slug examples:**
```
# ✅ correct — mode-qualified command name resolves the mode's own contract
maestro run create odyssey-planex --session 20260715-odyssey-planex-todo-integration --intent "完成 session-run-todo-goal 集成计划"
maestro run create learn --session 20260715-learn-auth-flow --intent "理解认证流程" -- follow src/auth/

# ❌ wrong — no --session, Chinese intent generates unreadable ID
maestro run create odyssey-planex --intent "完成 docs/session-run-todo-goal-integration-plan.md 的 P0-P6"
# ❌ wrong — mode-less command name (empty contract, ambiguous workflow resolution)
maestro run create odyssey --session 20260715-odyssey-planex-todo -- --mode planex
```

## Artifact Boundary

- Every formal artifact (including evidence-role artifacts declared in the prepare contract) MUST be written under `{run_dir}/outputs/`.
- Every new formal JSON artifact MUST contain a complete top-level `_meta` object: `{"_meta":{"kind":"<stable-kind>","schema":"<stable-kind>/1.0"},...}`. `kind` and `schema` are required together; `role` and `alias` are optional.
- A legacy JSON artifact with no `_meta` remains readable through contract/filename inference. Never write a partial, null, or non-object `_meta`; strict validation rejects the artifact and blocks Run completion.
- Human-readable synthesis and handoff MUST be written to `{run_dir}/report.md`.
- Informal worker traces and intermediate logs may use `{run_dir}/evidence/` (lazily created, not gate-checked).
- Temporary computation may use `{run_dir}/work/`; it is never an artifact and is never indexed.
- `.workflow/sessions/{session_id}/` is the only Session authority. Do not create private command Session directories or a second status/manifest truth source. Team message buses may exist only as transient coordination and never contain formal artifacts.
- Protocol files (`session.json`, `run.json`, `artifacts.json`) are runtime-owned and MUST NOT be edited directly.
- Consume upstream only from the `upstream` map returned by `maestro run create`.

## Completion

1. Run `maestro run check {run_id}` and repair any blocking artifact or exit gate it reports.
2. When every gate is clean, `run check` emits a `finish` checklist — handoff frontmatter, knowledge record, conflict marking (supersede / contest stale spec-knowhow entries), verdict choice, plus norms declared by the workflow. Work through it before completing; it is prompt-layer guidance, never a blocking gate.
3. Run `maestro run complete {run_id}`. The artifact gate is derived from the Run contract and evaluated automatically. Completion may return a structured `suggest_only` next action, but it never executes that action or creates another Run.
4. The caller explicitly invokes `maestro run next --session {session_id}` only after accepting the suggestion and its preconditions. `run next` is the sole normal allocator for the next chain-bound Run.
5. Report success only when the Run is completed. Completed artifacts are immutable; later Runs in the same Session reuse eligible sealed outputs through `upstream` rather than copying them.

## Legacy/Admin Compatibility

`maestro run recall-confirm`, `run fork`, `run import`, `run new`, `run rebind`, `maestro session resolve`, and `session resume` are deprecated admin-only compatibility commands. They may remain callable while legacy records exist, but normal topic resolution, output reuse, recall recommendations, and next-action routing MUST NOT invoke or recommend them. They provide no force bypass; durability and recovery internals remain runtime-owned.

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

`team-*` skills are independent user entry points — invoked directly by the user with `/team-*`, never dispatched as a step inside a `ralph next` / `maestro run next` FSM chain. They do not appear in any chain catalog or Stage Mapping.

A team skill owns its own Run lifecycle: its coordinator resolves and completes the Run under the `run-mode-lite.md` contract. The FSM chain contract above governs only lifecycle steps dispatched by the orchestrators.
