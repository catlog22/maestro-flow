---
name: grill
description: Socratic pressure-test a plan/idea/requirement against codebase reality to surface holes and terminology conflicts
argument-hint: "<topic|plan> [-y] [-c] [--from <source>] [--depth shallow|standard|deep]"
contract:
  consumes:
    - { kind: context-package, alias: upstream-context, required: false }
  produces:
    - { path: outputs/grill-report.md, kind: grill-report, alias: current-grill, role: primary }
    - { path: outputs/terminology.md, kind: terminology, role: attachment }
    - { path: outputs/context-package.json, kind: context-package, alias: grill-context, role: attachment }
  gates:
    exit: [terminology-aligned, branches-walked]
refs:
  - { path: ref/interview-mechanics.md, when: Entering the Q&A loop of branch walking }
  - { path: ref/finish-work.md, when: The wrap-up phase }
---

# Pre-task Thinking: grill

## Purpose

Grill's goal is to adversarially pressure-test a plan/idea/requirement before brainstorm, checking every assumption of the proposal against codebase reality, producing `grill-report.md` (decisions + evidence + risk), `terminology.md` (terminology lattice), and `context-package.json` (downstream consumption).

Pipeline position: **grill first (pressure test) → then brainstorm (refinement)**.

## Input Interpretation

$ARGUMENTS determines the execution mode, by priority:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Resume | `-c` / `--continue` / `--session ID` | continue from the last grill session, resuming from the last branch |
| Auto | `-y` / `--yes` | code exploration replaces human answers |
| Interactive (default) | topic text provided | full Socratic grilling + user Q&A |

No arguments and no `--from`/`--continue` → error (missing topic).

## Required Context

Pre-load (all optional, continue if missing):

1. **Specs**: `maestro load --type spec --category arch` — load architecture constraints
2. **Wiki search**: `maestro search "{topic keywords}"` → load relevant entries before grilling

## Boundaries and Invariants

- All output is written to `{run_dir}/outputs/`.
- **Output boundary**: all file writes must land in `{output_dir}/` or `.workflow/state.json`; modifying source code or files outside this is forbidden.
- Interaction style: **adversarial Socratic**, not menu-driven.
- Questions must cite concrete code evidence (file:line anchors), not abstract claims.
- Challenge contradictions: the moment an answer conflicts with code evidence or a prior answer, challenge it on the spot with evidence.
- Progress branch by branch: basic → specific → adversarial.

## Risk Checklist

- Is every challenge grounded in concrete code evidence? An assumption challenged without a `file:line` anchor is opinion, not pressure-testing.
- Are terminology collisions surfaced? A proposal term that clashes with an existing code name must be flagged for arbitration, not silently accepted.
- Did contradictions get challenged on the spot? An answer conflicting with code or a prior answer must be re-grilled immediately, not deferred.
- Is branch coverage adequate for the depth? shallow/standard/deep set 3/5/8 branches — under-walking leaves holes unprobed.

## Gate Intent

- `terminology-aligned`: candidate terms are collision-checked against code names, vague terms are challenged, and `terminology.md` (the terminology lattice) is written before synthesis.
- `branches-walked`: the branch-walking loop covered the depth's branch count (shallow/standard/deep = 3/5/8) through basic → specific → adversarial, reaching consensus or an explicit user stop, and `grill-report.md` + `context-package.json` exist before wrap-up.
