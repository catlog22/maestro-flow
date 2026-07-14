# Severity Inference

How test infers issue severity from the user's natural-language report during conversational UAT. Severity is **inferred**, never asked — the workflow never prompts "how severe is this?".

## Principle

When a UAT response is anything other than pass / skip, it is recorded as an issue and its severity is derived from the *words the user used* plus the *nature of what failed*. The user describes what they saw; the inference maps that description to a level.

## Inference table

| Inferred severity | Signals in the report | Examples |
|-------------------|-----------------------|----------|
| `blocker` | Feature is unusable, app crashes, data loss, cannot proceed, security exposure | "it crashes", "nothing happens at all", "I lost my work", "anyone can see X" |
| `major` | Core behavior wrong, wrong result, broken flow with no workaround | "it saved the wrong value", "the button does nothing", "the total is incorrect" |
| `minor` | Feature works but with a noticeable defect, or an awkward workaround exists | "it's slow but works", "I had to refresh", "the count is off by one after reload" |
| `trivial` | Cosmetic / copy / polish; behavior is correct | "the text is misaligned", "wrong shade of blue", "typo in the label" |

## Applying the inference

- Take the user's verbatim words as `reason` in the gap record; do not paraphrase.
- Map to a level using the strongest signal present (a crash outranks a cosmetic mention in the same sentence).
- When signals are ambiguous between two levels, choose the **higher** severity — under-reporting a real defect is worse than over-flagging.
- Record the inferred value on the gap (`severity: {inferred}`) and carry it into the issue candidate's `severity` / `priority`.

## Downstream effect

Severity gates the Readiness Gate: a `blocker` gap that is not diagnosed blocks test completion. It also drives issue-candidate priority (blocker/major → higher priority) for the downstream consumer that registers formal issues.
