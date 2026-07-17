---
name: collab
description: Fan out a requirement to multiple CLI tools in parallel, cross-verify findings for consensus and conflicts, and synthesize a unified conclusion consumable by plan
argument-hint: "<requirement> [--tools agy,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]"
contract:
  consumes: []
  produces:
    - { path: outputs/collab-report.md, kind: collab-report, alias: current-collab, role: primary }
    - { path: outputs/context.md, kind: context, role: attachment }
    - { path: outputs/conclusions.json, kind: conclusions, alias: collab-conclusions, role: attachment }
  gates:
    exit: [cross-verified, outputs-complete]
refs:
  - { path: ref/boundary-grill.md, when: CONFLICT findings include a boundary/responsibility dispute }
---

# Pre-task Thinking: collab

## Purpose

Collab's goal is a cross-verified judgment, not a pile of tool outputs. Multiple CLI tools answer the same requirement independently; the value lies in classifying where they agree (consensus), disagree (conflict), and see alone (unique) — then resolving conflicts with evidence rather than authority.

Produces `collab-report.md` (merged findings), `context.md` (Locked/Free/Deferred decisions, plan compatible), and `conclusions.json` (structured verdict for downstream automation).

## Input Interpretation

$ARGUMENTS — requirement text plus optional flags:

| Flag | Effect | Default |
|------|--------|---------|
| `--tools <list>` | Comma-separated CLI tools to fan out to | first 3 enabled |
| `--mode analysis\|write` | Delegate mode | `analysis` |
| `--rule <template>` | Shared rule template for all delegates | — |
| `-y` / `--yes` | Skip plan confirmation | `false` |

Empty requirement → ask the user for it before anything else.

## Required Context

Pre-load (all optional, continue if missing):

1. **Specs**: `maestro load --type spec --category arch` — include architecture constraints in delegate prompts
2. **Wiki search**: `maestro search "{requirement keywords}" --category arch` → fold relevant hits into delegate prompts

## Boundaries and Invariants

- All formal artifacts land in `{run_dir}/outputs/`; raw per-tool outputs are working evidence and land in `{run_dir}/evidence/per-tool/`.
- Delegates launch in parallel via `Bash(run_in_background: true)` in ONE message, then STOP — never poll, wait for callbacks.
- `--mode` is authoritative for all delegates; `write` mode excludes api-endpoint tools.
- Fewer than 2 eligible tools is a hard error — cross-verification needs at least two independent perspectives.
- Partial degradation over abort: 1+ successful tool → continue with what arrived; only all-failed aborts.

## Risk Checklist

- Are the perspectives actually independent? The same prompt goes to every tool — do not leak one tool's findings into another's prompt.
- Is consensus real or coincidental phrasing? Two tools "agreeing" without shared evidence (file:line) is weak consensus — mark confidence accordingly.
- Are conflicts resolved by evidence weight, not by tool preference? Higher confidence + more specific evidence wins; a tie stays SUGGESTED, never silently picked.
- Is consensus_level below 40%? That signals the requirement was ambiguous or the tools diverged structurally — flag for manual review instead of forcing a synthesis.
- Do boundary conflicts hide in the CONFLICT pile? Responsibility/ownership disputes need the boundary-grill treatment, not evidence voting.

## Gate Intent

- `cross-verified`: every finding is classified CONSENSUS / CONFLICT / UNIQUE with a computed consensus_level, and CONFLICT items carry a resolution (or an explicit UNRESOLVED tag) before synthesis.
- `outputs-complete`: `collab-report.md`, `context.md`, and `conclusions.json` all exist under `outputs/` before wrap-up — a missing file means the step is not done, regardless of how good the report is.
