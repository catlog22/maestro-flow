---
name: analyze
description: Perform multi-dimensional analysis of a topic or existing implementation, producing findings and a risk-matrix consumable by plan
argument-hint: "[topic] [-y] [-q] [--from <artifact-alias>] [--gaps [ISS-ID]]"
contract:
  consumes:
    - { kind: guidance, alias: current-guidance, required: false }
    - { kind: blueprint, alias: current-blueprint, required: false }
    - { kind: diagnosis, alias: latest-debug, required: false }
  produces:
    - { path: outputs/findings.json, kind: findings, alias: current-analysis, role: primary }
    - { path: outputs/risk-matrix.json, kind: risk-matrix, role: evidence }
refs:
  - { path: ref/boundary-grill.md, when: A boundary/responsibility conflict is detected during exploration and discussion }
  - { path: ref/issue-gaps-analyze.md, when: --gaps mode triggers, taking the issue root-cause analysis branch }
  - { path: ref/finish-work.md, when: Wrapping up, archiving, and extracting spec/knowhow }
gates: [exploration-done, discussion-round, scoring-complete, intent-covered]
---

# Pre-task Thinking: analyze

## Purpose

The output of analysis is "a trustworthy judgment for downstream plan," not a pretty report. Shape the goal clearly before you start.

- What is the core question this analysis must answer? How does the user's original User Intent break down into decidable sub-items?

## Input Interpretation

- Is the input a **topic text** (macro, exploring impact surface) or **pure numbers** (micro, milestone-level deep dive)? Only pure numbers take the micro path; treat mixed input as text.
- Is there a `--from` upstream artifact? If so, the alias in `consumes` is injected by create — skip locked decisions directly and prioritize analyzing open decisions. Do not overturn already-locked upstream conclusions.
- `-q` quick: only do decision extraction, skip exploration and six-dimensional scoring — but **decision extraction cannot be omitted**.
- `--gaps`: switch to issue root-cause analysis, giving symptom/root-cause evidence/impact surface/fix direction per issue. Root cause cannot be confirmed without evidence.

## Required Context

- With `current-guidance` / `current-blueprint`: read locked constraints as fixed boundaries for the analysis; open questions as discussion seeds.
- With `latest-debug`: treat the diagnosis conclusion as a known symptom; the analysis focuses on impact surface and fix direction rather than re-locating the bug.
- Project specs (arch category) and domain glossary: keep terminology consistent; new term candidates go into the report rather than scattered.

## Boundaries and Invariants

- Analysis produces judgment only — it does not modify source or pre-resolve downstream plan tasks.
- Already-locked upstream conclusions are inviolable; the analysis prioritizes open decisions.
- The scope judgment (small/medium/large) determines whether downstream is roadmap or plan: large = 3+ independent subsystems or hard serial dependencies.

## Risk Checklist

- Are evidence sources independent? Each dimension of the six-dimensional scoring must cite output from cli-explore-agent or CLI delegate; **manual Read/Grep does not count as independent evidence**.
- Has at least 1 pressure pass been run? High-confidence findings must withstand the pressure gradient of evidence demand → assumption probe → boundary/tradeoff → root cause.
- Are there any ❌ uncovered Intent items? Uncovered items must either get another round or be confirmed deferred by the user — do not converge with defects.
- Has the discussion stalled? Two consecutive rounds with delta < 5% should switch angles or converge — don't spin uselessly up to the 5-round limit.
- Is the scope judgment (small/medium/large) grounded? large = 3+ independent subsystems or hard serial dependencies; this directly determines whether downstream is roadmap or plan.

## Gate Intent

- `exploration-done`: the exploration phase produces ≥1 code anchor and ≥1 CLI perspective is complete before entering discussion.
- `discussion-round`: at least 1 round of interaction with user feedback + 1 confidence re-evaluation before entering scoring.
- `scoring-complete`: all six dimensions scored with each dimension cited, before synthesis.
- `intent-covered`: the Intent Coverage Matrix has no unhandled ❌ before wrapping up.
- The quick / gaps branches only keep decision-extraction-related gates; exploration/scoring gates automatically do not apply.
