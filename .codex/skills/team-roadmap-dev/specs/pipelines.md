

# Pipeline Definitions — Team Roadmap Dev

## Pipeline Mode

### Single Phase Pipeline

```
PLAN-101 --> EXEC-101 --> VERIFY-101
[planner]    [executor]   [verifier]
                              |
                         gap found?
                         YES (< 3x)
                              |
                         PLAN-102 --> EXEC-102 --> VERIFY-102
                              |
                         gap found?
                         YES (>= 3x) -> AskUser: continue/retry/stop
                         NO -> Complete
```

### Multi-Phase Pipeline

```
Phase 1: PLAN-101 --> EXEC-101 --> VERIFY-101
                                      |
                               [gap closure loop]
                                      |
                               Phase 1 passed
                                      |
Phase 2: PLAN-201 --> EXEC-201 --> VERIFY-201
                                      |
                               [gap closure loop]
                                      |
                               Phase 2 passed
                                      |
Phase N: PLAN-N01 --> EXEC-N01 --> VERIFY-N01
                                      |
                               [gap closure loop]
                                      |
                               All phases done -> Complete
```

## Task Metadata Registry

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| PLAN-N01 | planner | phase N | (none or previous VERIFY) | Context research + IMPL-*.json task generation |
| EXEC-N01 | executor | phase N | PLAN-N01 | Wave-based code implementation following IMPL-*.json plans |
| VERIFY-N01 | verifier | phase N | EXEC-N01 | Convergence criteria check + gap detection |
| PLAN-N02 | planner | phase N (gap closure 1) | VERIFY-N01 | Gap-targeted re-plan |
| EXEC-N02 | executor | phase N (gap closure 1) | PLAN-N02 | Gap fix execution |
| VERIFY-N02 | verifier | phase N (gap closure 1) | EXEC-N02 | Re-verify after gap fixes |

## Task Naming Rules

| Type | Pattern | Example |
|------|---------|---------|
| Plan | `PLAN-{phase}01` | PLAN-101, PLAN-201 |
| Execute | `EXEC-{phase}01` | EXEC-101, EXEC-201 |
| Verify | `VERIFY-{phase}01` | VERIFY-101 |
| Gap Plan | `PLAN-{phase}{iteration+1}` | PLAN-102 (gap 1), PLAN-103 (gap 2) |
| Gap Execute | `EXEC-{phase}{iteration+1}` | EXEC-102, EXEC-103 |
| Gap Verify | `VERIFY-{phase}{iteration+1}` | VERIFY-102, VERIFY-103 |

## Checkpoints

| Checkpoint | Trigger | Behavior |
|------------|---------|----------|
| Plan gate (optional) | PLAN-N01 complete | If `config.gates.plan_check=true`: AskUser to approve/revise/skip |
| Phase transition | VERIFY-N01 complete, no gaps | If `config.mode=interactive`: AskUser to proceed/review/stop |
| Gap closure | VERIFY-N01 complete, gaps found | Auto-create PLAN-N02/EXEC-N02/VERIFY-N02 (max 3 iterations) |
| Gap limit | gap_iteration >= 3 | AskUser: continue anyway / retry once more / stop |
| Pipeline complete | All phases passed | AskUser: archive & clean / keep active / export results |

## State Machine Coordinates

```json
{
  "current_phase": 1,
  "total_phases": 3,
  "gap_iteration": 0,
  "step": "plan | exec | verify | gap_closure | transition",
  "status": "running | paused | complete"
}
```

## Role-Worker Map

| Prefix | Role | Role Spec | Inner Loop |
|--------|------|-----------|------------|
| PLAN | planner | `~  or <project>/.claude/skills/team-roadmap-dev/roles/planner/role.md` | true |
| EXEC | executor | `~  or <project>/.claude/skills/team-roadmap-dev/roles/executor/role.md` | true |
| VERIFY | verifier | `~  or <project>/.claude/skills/team-roadmap-dev/roles/verifier/role.md` | true |
