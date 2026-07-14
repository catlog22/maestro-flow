---
name: grill
description: Socratic pressure-test a plan/idea/requirement against codebase reality to surface holes and terminology conflicts
argument-hint: "<topic|plan> [-y] [-c] [--from <source>] [--depth shallow|standard|deep]"
contract:
  consumes: []
  produces:
    - grill-report.md
    - terminology.md
    - context-package.json
refs:
  - { path: ref/interview-mechanics.md, when: Entering the Q&A loop of branch walking }
  - { path: ref/finish-work.md, when: The wrap-up phase }
gates: []
---

# Pre-task thinking

Grill's goal is to adversarially pressure-test a plan/idea/requirement before brainstorm, checking every assumption of the proposal against codebase reality, producing `grill-report.md` (decisions + evidence + risk), `terminology.md` (terminology lattice), and `context-package.json` (downstream consumption).

Pipeline position: **grill first (pressure test) → then brainstorm (refinement)**.

## Mode determination

$ARGUMENTS determines the execution mode, by priority:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Resume | `-c` / `--continue` / `--session ID` | continue from the last grill session, resuming from the last branch |
| Auto | `-y` / `--yes` | code exploration replaces human answers |
| Interactive (default) | topic text provided | full Socratic grilling + user Q&A |

No arguments and no `--from`/`--continue` → error (missing topic).

## Flags

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — CLI exploration replaces human answers | false |
| `-c` / `--continue` | continue from the last grill session | — |
| `--session ID` | continue the specified session | — |
| `--depth shallow\|standard\|deep` | branch count 3/5/8 | standard |
| `--from <source>` | load upstream material (`blueprint:ID`, `@file`, path) | — |

## Input and boundaries

- All output is written to `{run_dir}/outputs/`
- **Output boundary**: all file writes must land in `{output_dir}/` or `.workflow/state.json`; modifying source code or files outside this is forbidden

## Pre-load (all optional, continue if missing)

1. **Specs**: `maestro load --type spec --category arch` — load architecture constraints
2. **Wiki search**: `maestro search "{topic keywords}"` → load relevant entries before grilling

## Interaction essentials

- Interaction style: **adversarial Socratic**, not menu-driven
- Questions cite concrete code: `The code at {file:line} uses {symbol}, your proposal calls it {term}, which wins?`
- Concrete scenarios: `What happens to {action} when {condition}?`
- Challenge contradictions: the moment an answer conflicts with code evidence or a prior answer, challenge it on the spot with evidence
- Progress branch by branch: basic → specific → adversarial
