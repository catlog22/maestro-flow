---
name: maestro
description: Intelligent coordinator for maestro skills. Analyze intent + read project state → select optimal skill → execute. Routes to CSV wave pipeline skills for parallel execution.
argument-hint: "\"intent text\" [-y] [--chain <name>] [--dry-run]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Skip clarification, skip confirmation, auto-skip on errors. Propagates to downstream skills.

# Maestro Coordinator

Orchestrate all maestro skills based on user intent and current project state.

## Usage

```bash
$maestro "build authentication system"
$maestro -y "continue"
$maestro --chain full-lifecycle "e-commerce platform"
$maestro --dry-run "refactor auth module"
```

## Routing

### Intent → Skill Mapping

| Intent Pattern | Target Skill | Notes |
|---------------|-------------|-------|
| init, setup, start project | `skills/init/` | Project initialization |
| brainstorm, ideate, explore ideas | `skills/brainstorm/` | CSV Wave: multi-role parallel |
| analyze, discuss, evaluate | `skills/analyze/` | CSV Wave: multi-dimension parallel |
| plan, decompose, break down | `skills/plan/` | Light CSV: explore → plan |
| execute, implement, build, code | `skills/execute/` | CSV Wave: task waves from plan |
| verify, check, validate | `skills/verify/` | CSV Wave: 3-layer parallel |
| review, code review | `skills/review/` | CSV Wave: 6-dimension parallel |
| test, UAT, acceptance | `skills/test/` | Interactive UAT session |
| test-gen, generate tests | `skills/test-gen/` | CSV Wave: per-module parallel |
| debug, fix bug, diagnose | `skills/debug/` | Light CSV: hypothesis parallel |
| integration test | `skills/integration-test/` | CSV Wave: L0→L1→L2→L3 |
| refactor, tech debt | `skills/refactor/` | Iterative refactoring |
| status, dashboard | `skills/status/` | Display dashboard |
| issue, create issue | `skills/issue/` | Issue CRUD |
| discover issues, scan | `skills/issue-discover/` | CSV Wave: 8-perspective parallel |
| map codebase | `skills/spec-map/` | CSV Wave: 4-mapper parallel |
| spec generate | `skills/spec-generate/` | Light CSV: research → docs |
| roadmap | `skills/roadmap/` | Light CSV: analyze → compose |
| ui design | `skills/ui-design/` | Interactive design flow |
| memory | `skills/memory/` | Memory management |
| sync | `skills/sync/` | Git diff → doc update |
| quick, fast task | `skills/quick/` | Fast-track scratch execution |
| rebuild codebase docs | `skills/codebase-rebuild/` | CSV Wave: parallel doc rebuild |
| refresh codebase docs | `skills/codebase-refresh/` | Incremental doc update |
| capture memory, compact | `skills/memory-capture/` | Session memory capture |
| milestone audit | `skills/milestone-audit/` | Cross-phase integration audit |
| milestone complete, close milestone | `skills/milestone-complete/` | Archive milestone |
| add phase, insert phase | `skills/phase-add/` | Add phase to roadmap |
| phase transition, complete phase, next phase | `skills/phase-transition/` | Mark phase complete |
| add spec, spec entry | `skills/spec-add/` | Add spec entry |
| load spec, spec context | `skills/spec-load/` | Load relevant specs |
| setup specs, init specs | `skills/spec-setup/` | Initialize project specs |
| continue, next, go | (state-based) | Read state.json → next step |

### Unmatched Intent Fallback

When intent does not match any pattern in the routing table:

1. **Fuzzy match**: Compare intent against all pattern keywords using substring/edit-distance matching
2. **If close match found** (1-2 edits away): Suggest the closest skill — "Did you mean `{skill}`? (y/n)"
3. **If no close match**: Display available skills list and ask for clarification — "Intent not recognized. Available skills: init, brainstorm, analyze, plan, execute, verify, review, test, debug, status, ..."
4. **With `-y` flag**: If close match exists, auto-select it. If no close match, abort with error: "Unrecognized intent: {intent}"

### State-Based Routing

When intent is `continue`/`next`/`go`:
1. Read `.workflow/state.json`
2. Determine current phase and status
3. Select next logical skill based on state machine

### Chain Definitions

| Chain | Steps | Use When |
|-------|-------|----------|
| `full-lifecycle` | init → spec-generate → plan → execute → verify → review | Complete project from scratch |
| `spec-driven` | init → spec-generate → plan → execute | Spec-first development |
| `roadmap-driven` | init → roadmap → plan → execute | Quick roadmap approach |
| `brainstorm-driven` | brainstorm → init → spec-generate → plan → execute | Exploration-first |
| `execute-verify` | execute → verify → review | After planning is complete |
| `quality-loop` | review → test-gen → test → debug | Quality assurance cycle |
| `milestone-close` | verify → review → milestone-complete | Close a milestone |

## Execution

1. Parse intent from `$ARGUMENTS`
2. Read project state (`.workflow/state.json` if exists)
3. Match intent → skill (or chain)
4. If `--dry-run`: display planned execution and stop
5. If chain: execute skills sequentially, propagating artifacts
6. Track progress in `.workflow/.maestro/{session_id}/status.json`

## Session Tracking

```
.workflow/.maestro/{session_id}/
├── status.json    # Chain progress: steps, statuses, timing
└── artifacts/     # Cross-step artifact references
```
