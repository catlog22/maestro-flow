# Scientific Debug — Investigation Discipline

The full root-cause investigation discipline used by debug agents. Applies to every hypothesis loop, whether standalone, from-test, or parallel-cluster.

## Iron Law

**NO FIX WITHOUT A CONFIRMED ROOT CAUSE.**

A root cause is confirmed only when you can point to the exact `file:line` where the defect originates AND explain the mechanism that produces the observed symptom. A plausible-sounding theory is not a root cause. If you cannot name the line and the mechanism, keep investigating.

- Don't patch a symptom you don't understand.
- Don't stop at "this looks suspicious" — prove it drives the symptom.
- "Fixed" without a confirmed cause = the bug is still there, now hidden.

## Hypothesis Loop

Every investigation is a sequence of falsifiable hypotheses:

```
FORM: state one hypothesis — "X causes the symptom because Y"
TEST: find code evidence that confirms or refutes it (Read, Grep, run, trace)
RECORD: append an NDJSON evidence line — { hypothesis, prediction, observation, verdict }
DECIDE: confirmed → root cause | refuted → next hypothesis | inconclusive → refine
```

Each hypothesis must make a prediction you can check against reality before you look. A hypothesis that "explains" everything explains nothing.

## Red Flags — These Thoughts Mean STOP

- "It's probably just X" — probably is not confirmed. Test it.
- "Let me just try changing this and see" — that's guessing, not diagnosing.
- "The error message says X so it must be X" — messages point at symptoms, not causes.
- "It works on my machine" — the difference IS the evidence. Find it.
- "This is too obvious to check" — obvious assumptions are where bugs hide.

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I'm pretty sure it's this" | Sure enough to write it as evidence? If not, test it. |
| "No time to trace it fully" | An unconfirmed fix costs more time when it fails in prod. |
| "The stack trace is enough" | The trace shows where it crashed, not why the bad state arose. |
| "I'll fix it and see if the symptom goes away" | Symptom disappearing ≠ cause fixed — it may be masked. |
| "Too many moving parts to isolate" | Bisect. Change one variable at a time until the surface shrinks. |

## Backward Tracing

When the failure point is known but the origin is not, trace backward from the symptom:

1. Start at the observable failure (`file:line` where wrong behavior is visible).
2. Ask: what value / state made this line behave wrongly? Find where it was set.
3. Repeat upstream — follow the data, not the control flow — until you reach the line that first produced the bad state.
4. That origin line, with its mechanism, is the confirmed root cause.

## 3-Strike Architecture Check

After **3 refuted hypotheses on the same surface**, stop narrow probing and step up a level:

- Re-read the module boundary / data-flow contract (`ARCHITECTURE.md` if present).
- Question an assumption you've been treating as fixed (input shape, invariant, call order).
- Consider that the bug is in the interaction between components, not inside one.

Three strikes means the mental model is wrong, not that the next probe needs to be deeper. Reframe before continuing.

## Confidence

Score the diagnosis multi-factor, not as a single guess: reproduction reliability, directness of the evidence chain, and whether the predicted fix is validated. Report `confidence` per gap; low confidence means the loop is not finished, not that the answer is uncertain-but-final.
