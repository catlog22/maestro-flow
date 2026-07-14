# Frontend Verify — Deterministic Browser Acceptance

The `--frontend-verify` path for test. This is **not** conversational UAT — it makes deterministic assertions in a real browser (chrome-devtools) and produces `e2e-results.json`. Silence is never a pass.

## When this replaces conversational UAT

`--frontend-verify` is passed and the deliverable has a frontend. Instead of asking the user "does reality match?", the agent drives the browser and asserts each check itself. The rule "nobody answered = all pass" is forbidden here — an unasserted check is a fail, not a pass.

## Assertion targets

For each user-visible feature in scope, assert three layers deterministically:

| Layer | Assertion | Tool |
|-------|-----------|------|
| Entry point | The UI control that triggers the feature exists and is reachable | chrome-devtools: locate the element |
| Write request | The expected network write (POST/PUT/PATCH/DELETE) fires with the right payload | chrome-devtools: observe network |
| DOM result | The observable DOM/state change happens after the action | chrome-devtools: read the resulting DOM |

Every write endpoint in scope must have a UI entry point that reaches it. A write endpoint with **no** UI entry point is a defect, not an untested item.

## Result classification

Tag each assertion:

- `[UI-observable]` — the user can see the effect; a failure here blocks acceptance.
- Any `[UI-observable]` failure, OR any write endpoint with no reachable UI entry point → overall verdict `NEEDS_RETRY` (does **not** pass).

## Output

Produce `outputs/e2e-results.json` (schema `e2e-results/1.0`) recording, per check: the target feature, the three-layer assertions, pass/fail, and the observed evidence (selector, request, DOM snippet). The overall verdict is `PASS` only when every `[UI-observable]` assertion passed and every write endpoint had a reachable entry point; otherwise `NEEDS_RETRY`.

## Constraints

- Deterministic assertions only — no "looks fine", no reliance on the user answering.
- Every claim is backed by observed browser evidence (element found, request captured, DOM read).
- A check the agent could not run is `NEEDS_RETRY`, never an implicit pass.
