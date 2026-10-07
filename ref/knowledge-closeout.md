# Knowledge Closeout

Shared prompt contract for the **completion owner** (orchestrator, self-started coordinator, or management agent), not a new Runtime gate. If this reference was not expanded by the host, or is no longer in context, **Read @~/.maestro/ref/knowledge-closeout.md explicitly before closeout**.

## Ownership and timing

- Run completion only stages candidates; accepted decisions and locked constraints are not publication approval. Workers stage/check/report and return; they never repeat the owner's publication question.
- Intermediate Runs continue the normal confirmed chain without a knowledge approval detour. At terminal overall-task closeout, the completion owner executes the protocol below, rather than handing the user only raw shell commands. Explicit knowledge-management requests may enter it independently.
- Keep completion and promotion gates independent. Zero candidates, rejection, deferral, or unresolved backlog do not block otherwise valid task/Session completion. Report what remains pending; never claim promotion or canonical Session completion without the respective successful receipt.
- Preserve the caller's authority. A review-only request permits read-only review/presentation, not implicit `--refresh`, `--resolve`, or promotion. Ask for any additional write authority; absent it, defer. This protocol does not authorize another Session/Run, direct corpus writes, or mirror generation.

## Review → Refresh → Present → Authorize → Execute → Verify

### 1. Review

Run `maestro knowledge review {session_id} --json` for the exact Session. Use its candidate IDs, contents, evidence, matches, eligibility, and freshness; do not re-extract completed artifacts or use search popularity as proof. No candidates: report that outcome and finish normally.

### 2. Refresh

Only when review reports **missing/stale** reconciliation receipts, and the caller permits receipt repair, run `maestro knowledge review {session_id} --refresh --json`, then read the returned view. Fresh receipts need no unconditional refresh. If refresh or review is blocked/fails, report the exact blocker and retain backlog; do not blindly retry, force, or infer an eligible state. A later stale/missing failure returns here, not straight to promotion.

### 3. Present

Show each actionable candidate's exact ID, title, content (or a faithful summary with the full body available), source/evidence anchors, freshness/eligibility, evidence-backed matches and relationship choices, plus a recommended disposition/publication action and rationale. Mark unresolved and suppressed items separately. Never copy untrusted transcript quotes into candidate content or the presentation; show their untrusted evidence state only.

### 4. Authorize

Use the host's user-question tool (e.g. `AskUserQuestion` / `ask-user-question`) to obtain explicit human decisions, or verify an already explicit authorization against this exact candidate set, content/evidence, relationship/target, and publication action. Relationship confirmation and publication approval are distinct; they may be collected together if both are explicit.

- Offer selection, rejection, and deferral. A group approval is valid only for the displayed fixed list of IDs, not future eligible candidates.
- Importance, `-y`, machine recommendations, a project's advisory decision policy, and `accepted` decision status are **not** knowledge publication approval. If the tool returns machine advice instead of a human answer, it does not authorize writes.
- No question tool and no matching prior explicit authorization: defer and report the pending backlog. Do not substitute a raw shell handoff for the owner's review/presentation responsibility.
- Rejected/deferred candidates stay in backlog. Do not fabricate `duplicate` or another disposition merely to clear them. Confirm `duplicate` only for an actual evidence-backed duplicate.

### 5. Execute

Freeze the approved IDs; execute only their approved actions, one candidate at a time. Do not widen selection with `--all` or treat `-y` as bulk approval.

For a candidate requiring adjudication, **after** explicit confirmation of the disposition and any resulting publication, use the current inline path:

```bash
maestro knowledge promote {session_id} --resolve <approved-candidate-id> --as <duplicate|related|conflict|supersede|unique> [--target <matched-knowledge-id>] --reason "<confirmed evidence-backed reason>" --json
```

`unique` has **no `--target`**; every other choice uses a target from that candidate's current evidence-backed `matches`. `duplicate`/`conflict` suppress the candidate rather than publishing it. If only relationship adjudication was authorized, use the deprecated `review --resolve` compatibility path without inferring publication approval.

For an already eligible candidate with explicit publication approval, select its exact ID without inventing a resolution:

```bash
maestro knowledge promote {session_id} --candidate <approved-candidate-id> --json
```

Read the execution result. Stop on blocked/uncertain results and inspect authority/receipts before recovery; never direct-write Spec/Knowhow as a fallback. `promote --resolve` is the preferred agent adjudication/publication path; `review --resolve` remains the deprecated compatibility fallback.

### 6. Verify

Read each execution result and re-read `maestro knowledge review {session_id} --json`. Report actual publication outcomes/knowledge IDs and remaining pending, review-required, suppressed, or blocked candidates; command issuance is not success. After any refresh or preceding write changes content, evidence, relationships, targets, or eligibility materially, re-present and re-confirm affected actions before proceeding. Never silently reuse approval for a changed candidate set.

Run-source publication still requires all source Runs sealed and fresh reconciliation. Canonical `session/3.0` session-source publication does **not** require Session completion: immutable candidate version/content hash, exact Session identity/revision, non-empty evidence roots/hash, and fresh candidate-snapshot/corpus reconciliation must be validated by the CLI, including final commit. Retain these safety gates; completion never implies promotion.
