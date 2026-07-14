# Spec Conflict Handling

Protocol for when review finds a contradiction between the code and a loaded spec entry (code behavior ≠ spec rule). Review records the conflict; it does not silently rewrite the knowledge base.

## Ground rule

**Code is the single source of truth.** A spec entry describes an intended rule; the running code is what actually happens. When they disagree, the code wins for the purpose of *this* review — but the disagreement is recorded so a human (or the knowledge audit) can decide whether the code drifted or the spec went stale.

## Classify the conflict

For each finding that directly contradicts a spec entry, determine which of two relationships holds:

| `conflict_type` | Meaning | `suggested_action` |
|-----------------|---------|--------------------|
| `outdated` | The spec rule was superseded by an evolution; the new code is correct and intended. | `supersede` |
| `disputed` | Both the code and the spec rule are defensible; which is right is genuinely unclear. | `conflict-mark` |

Use `outdated` only when there is evidence the rule was intentionally replaced (a newer decision, a changelog, an obvious evolution). Default to `disputed` when uncertain — never guess `outdated`.

## Record, don't resolve

Write each conflict into `outputs/spec-conflicts.json` (schema `spec-conflicts/1.0`):

```json
{
  "finding_ref": "<finding.id>",
  "spec_id": "<sid>",
  "code_location": "<file>:<line>",
  "conflict_type": "outdated | disputed",
  "suggested_action": "supersede | conflict-mark"
}
```

Review stops here — it emits candidates, it does not mutate the spec store.

## Downstream resolution (informational)

The recorded suggestions map to two distinct spec operations, applied later by a human or the knowledge audit — not by review:

- **supersede** (evolution): the old entry becomes `deprecated` and is excluded from search/load; the evolution chain is preserved.
- **conflict-mark** (dispute): the old entry becomes `contested` — still injected, but down-weighted and labelled — pending human adjudication.

The two axes are orthogonal: `confidence` (who is right, decided by a human/audit) is independent of `status` (the active/deprecated lifecycle). Review only proposes; it never flips either axis itself.
