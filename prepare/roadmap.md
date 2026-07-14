---
name: roadmap
description: Decompose requirements into a session DAG where each session is an atomic work unit with scope, success criteria, and dependency edges
argument-hint: "<requirement> [-y] [-c] [-m progressive|direct|auto] [--from <source>] [--from-brainstorm SESSION-ID] [--revise [instructions]] [--review]"
contract:
  consumes:
    - { kind: context-package, alias: upstream-context, required: false }
  produces:
    - { path: outputs/roadmap.json, kind: roadmap, role: primary, alias: current-roadmap }
    - { path: outputs/roadmap.md, kind: roadmap-doc, role: attachment }
refs:
  - { path: ref/interview-mechanics.md, when: Entering the interactive interview Q&A loop }
  - { path: ref/roadmap-template.md, when: Generating the roadmap.md artifact }
gates: [dag-valid, sessions-registered]
---

# Pre-task Thinking: roadmap

## Purpose

Roadmap decomposes requirements into a session DAG. Each session is an atomic work unit with scope, success criteria, and dependency edges, each running the full analyze→plan→execute→verify lifecycle. It produces `roadmap.json` (machine-readable DAG, primary) and `roadmap.md` (human-readable summary). Formal spec documents go through `blueprint`.

Pipeline position: brainstorm/blueprint/analyze → **roadmap** → analyze {session} → plan → execute.

## Input Interpretation

$ARGUMENTS determines the execution mode:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Create (default) | requirement text / `@file` / `--from` provided | build a session DAG from the requirement or upstream context |
| Revise | `--revise [instructions]` | read the `current-roadmap` artifact, apply changes, preserve already-completed sessions |
| Review | `--review` | read-only health assessment of the session DAG |
| Resume | `-c` / `--continue` | continue from the last checkpoint |

No arguments and no `--revise`/`--review` → error (missing requirement, E001).

Flags:

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — skip interactive questions, use recommended defaults | false |
| `-c` / `--continue` | continue from the last checkpoint | false |
| `-m progressive\|direct\|auto` | decomposition strategy | auto |
| `--from <source>` | load upstream context package (`brainstorm:ID`, `blueprint:BLP-xxx`, `analyze:ANL-xxx`, `@file`, or path); consumes `context-package.json` | — |
| `--from-brainstorm SESSION-ID` | backward-compatible alias for `--from brainstorm:ID` | — |
| `--revise [instructions]` | revise an existing roadmap, preserving already-completed sessions | — |
| `--review` | roadmap health assessment (read-only) | — |

Input types:

- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` / `--from analyze:ANL-xxx` / `--from blueprint:BLP-xxx`
- No arguments + `--revise` / `--review`: operate on the existing `current-roadmap` artifact

## Required Context

Pre-load (all optional, continue if missing):

1. **Specs**: `maestro load --type spec --category arch` — load architecture constraints needed for session decomposition
2. **Wiki search**: `maestro search "{requirement keywords}" --json` → prior knowledge

## Boundaries and Invariants

- All output is written to `{run_dir}/outputs/`.
- Do not write `.workflow/roadmap.md` — roadmap is a Run artifact, not a project-level file.
- Sessions are registered into `state.json.sessions[]`; do not touch already-completed sessions, and do not write `milestones[]` / `current_milestone` / `accumulated_context` (deprecated fields).
- Scope guard: define only the roadmap shape, do not pre-resolve task splitting or intra-session decomposition (which belongs to plan).
- Interaction style: **convergent menu-driven** (per `ref/interview-mechanics.md`); decision tree (strict order): mode (create/revise/review) → requirement scope (MVP/complete/phased) → decomposition strategy (progressive/direct/auto) → session boundaries → session dependencies. Write-back target: the "Roadmap Decisions" section of `{run_dir}/outputs/roadmap.md` (create if absent). Skip conditions: `--revise`, `--review` jump directly to the corresponding mode. Exit condition: consensus reached or an explicit user signal → finalize the Roadmap Decisions section.

## Risk Checklist

- Is the DAG acyclic and complete? Every session must have scope, success criteria, and valid dependency edges — a cycle or dangling edge breaks the lifecycle.
- Are already-completed sessions preserved? `--revise` must not touch or renumber completed sessions in `state.json.sessions[]`.
- Did decomposition stay at roadmap altitude? Pre-resolving task splitting or intra-session decomposition is plan's job, not roadmap's.
- Are deprecated fields avoided? Writing `milestones[]` / `current_milestone` / `accumulated_context` reintroduces removed concepts.

## Gate Intent

- `dag-valid`: the session DAG is acyclic and complete — every session has scope, success criteria, and valid dependency edges, with no dangling or cyclic edges — before `roadmap.json` is finalized.
- `sessions-registered`: sessions are written into `state.json.sessions[]` without touching already-completed sessions or the deprecated `milestones[]` / `current_milestone` / `accumulated_context` fields.
