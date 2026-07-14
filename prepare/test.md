---
name: test
description: Run conversational UAT, coverage, and optional browser acceptance on verified deliverables, inferring severity per scenario and closing gaps
argument-hint: "[scope] [--smoke] [--auto-fix] [--frontend-verify]"
contract:
  consumes:
    - { kind: verification, alias: latest-verification, required: true }
    - { kind: review-findings, alias: latest-review, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
  produces:
    - { path: outputs/test-plan.json, kind: test-plan, role: attachment }
    - { path: outputs/test-results.json, kind: test-results, alias: latest-test, role: primary }
    - { path: outputs/acceptance.json, kind: acceptance, role: evidence }
    - { path: outputs/coverage.json, kind: coverage, role: evidence }
    - { path: outputs/e2e-results.json, kind: e2e-results, role: evidence, optional: true }
refs:
  - { path: ref/frontend-verify.md, when: --frontend-verify is passed, taking the deterministic browser acceptance path }
  - { path: ref/severity-inference.md, when: Inferring issue severity from the user's natural language }
gates: []
---

## Preparation

Testing is behavioral observation of a verified deliverable. Before starting, clarify the target scope, mode choice, and reusable test knowledge.

### Mode choice

- **Default**: conversational UAT — present expected behavior scenario by scenario and ask the user whether reality matches.
- **`--frontend-verify`**: deterministic browser smoke — use chrome-devtools to assert UI entry points / write requests / DOM results one by one; this is **not** conversational UAT. See `ref/frontend-verify.md` for details.
- **`--smoke`**: run a cold-start smoke (startup, routing, build, dependencies) before UAT.
- **`--auto-fix`**: automatically orchestrate a gap-fix loop on failure.

### Context injection (optional, may continue if missing)

- Wiki: `maestro search "<scope/feature keywords>" --json` → existing test strategy, recipes, decisions
- Role knowledge: `maestro search --category test` → pick relevant items → `maestro load --type knowhow --id <id>`
- specs + tools: `maestro load --type spec --category test` → testing conventions + discoverable knowhow tools

### Scenario source mapping

Map multi-source inputs into UAT scenarios, each tagged with its `source`:

| Source | Tag | Notes |
|--------|-----|-------|
| requirements / acceptance criteria | — | user-observable delivery criteria |
| registered test tools (knowhow) | `source: "tool"` | each numbered tool step → one UAT, assertion as expected |
| critical/high finding from `latest-review` | `source: "review_finding"` | when review verdict=BLOCK and such a scenario fails, automatically enter the gap-fix loop |
| root cause confirmed by `latest-debug` | `source: "debug_root_cause"` | generate a regression test scenario |

### Boundaries

- UAT is observational — test execution observes behavior and records results, not modifying source by default; source fixes belong to the debug→plan→execute loop.
- Present only one scenario at a time; batch presentation or guessing results is forbidden.
- Severity is **inferred** from the user's natural language, never explicitly asking for a level. See `ref/severity-inference.md` for the inference table.
- timeout, no response, or a missing UI entry point may not be judged as pass.
- `--frontend-verify` uses deterministic assertions; "nobody answered = all pass" is forbidden.
- The `--auto-fix` gap-fix loop is at most 2 rounds; persistent failure escalates to debug — do not retry indefinitely.
- When existing UAT progress exists, offer resume; do not silently overwrite.
- Write structured truth to `acceptance.json`/`test-results.json`, and process to `report.md`.
