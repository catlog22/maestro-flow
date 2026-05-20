# Pipeline Definitions

## 1. Pipeline Selection Criteria

| Keywords | Pipeline |
|----------|----------|
| spec, design, document, requirements | `spec-only` |
| implement, build, fix, code | `impl-only` |
| full, lifecycle, end-to-end | `full-lifecycle` |
| frontend, UI, react, vue | `fe-only` or `fullstack` |
| Ambiguous / unclear | ask_question |

## 2. Spec-Only Pipeline

**6 tasks + 2 optional checkpoints, 3 discussion rounds**

```
RESEARCH-001(+D1) -> DRAFT-001 -> DRAFT-002(+D2) -> [CHECKPOINT-001] -> DRAFT-003 -> DRAFT-004 -> [CHECKPOINT-002] -> QUALITY-001(+D3)
```

| Task | Role | Description | Discuss |
|------|------|-------------|---------|
| RESEARCH-001 | analyst | Research domain, competitors, constraints | D1: scope alignment |
| DRAFT-001 | writer | Product brief, self-validate | - |
| DRAFT-002 | writer | Requirements PRD | D2: requirements review |
| CHECKPOINT-001 | supervisor | Brief↔PRD consistency, terminology alignment | - |
| DRAFT-003 | writer | Architecture design, self-validate | - |
| DRAFT-004 | writer | Epics & stories, self-validate | - |
| CHECKPOINT-002 | supervisor | Full spec consistency (4 docs), quality trend | - |
| QUALITY-001 | reviewer | Quality gate scoring | D3: readiness decision |

**Checkpoint**: After QUALITY-001 -- pause for user approval before any implementation.

**Supervision opt-out**: Set `supervision: false` in team-session.json to skip CHECKPOINT tasks.

## 3. Impl-Only Pipeline

**4 tasks + 1 optional checkpoint, 0 discussion rounds**

```
PLAN-001 -> [CHECKPOINT-003] -> IMPL-001 -> TEST-001 + REVIEW-001
```

| Task | Role | Description |
|------|------|-------------|
| PLAN-001 | planner | Break down into implementation steps, assess complexity |
| CHECKPOINT-003 | supervisor | Plan↔input alignment, complexity sanity check |
| IMPL-001 | implementer | Execute implementation plan |
| TEST-001 | tester | Validate against acceptance criteria |
| REVIEW-001 | reviewer | Code review |

TEST-001 and REVIEW-001 run in parallel after IMPL-001 completes.

**Supervision opt-out**: Set `supervision: false` in team-session.json to skip CHECKPOINT tasks.

## 4. Full-Lifecycle Pipeline

**10 tasks + 3 optional checkpoints = spec-only (6+2) + impl (4+1)**

```
[Spec pipeline with CHECKPOINT-001/002] -> PLAN-001(blockedBy: QUALITY-001) -> [CHECKPOINT-003] -> IMPL-001 -> TEST-001 + REVIEW-001
```

PLAN-001 is blocked until QUALITY-001 passes and user approves the checkpoint.

**Supervision opt-out**: Set `supervision: false` in team-session.json to skip all CHECKPOINT tasks.

## 5. Frontend Pipelines

| Pipeline | Description |
|----------|-------------|
| `fe-only` | Frontend implementation only: PLAN-001 -> IMPL-001 (fe-implementer) -> TEST-001 + REVIEW-001 |
| `fullstack` | Backend + frontend: PLAN-001 -> IMPL-001 (backend) + IMPL-002 (frontend) -> TEST-001 + REVIEW-001 |
| `full-lifecycle-fe` | Full spec pipeline -> fullstack impl pipeline |

## 6. Conditional Routing

PLAN-001 outputs a complexity assessment that determines the impl topology.

| Complexity | Modules | Route |
|------------|---------|-------|
| Low | 1-2 | PLAN-001 -> IMPL-001 -> TEST + REVIEW |
| Medium | 3-4 | PLAN-001 -> ORCH-001 -> IMPL-{1..N} (parallel) -> TEST + REVIEW |
| High | 5+ | PLAN-001 -> ARCH-001 -> ORCH-001 -> IMPL-{1..N} -> TEST + REVIEW |

- **ORCH-001** (orchestrator): Coordinates parallel IMPL tasks, manages dependencies
- **ARCH-001** (architect): Detailed architecture decisions before orchestration

## 7. Task Metadata Registry

| Task ID | Role | Phase | Depends On | Discuss | Priority |
|---------|------|-------|------------|---------|----------|
| RESEARCH-001 | analyst | research | - | D1 | P0 |
| DRAFT-001 | writer | product-brief | RESEARCH-001 | - | P0 |
| DRAFT-002 | writer | requirements | DRAFT-001 | D2 | P0 |
| DRAFT-003 | writer | architecture | DRAFT-002 | - | P0 |
| DRAFT-004 | writer | epics | DRAFT-003 | - | P0 |
| QUALITY-001 | reviewer | readiness | CHECKPOINT-002 (or DRAFT-004) | D3 | P0 |
| CHECKPOINT-001 | supervisor | checkpoint | DRAFT-002 | - | P1 |
| CHECKPOINT-002 | supervisor | checkpoint | DRAFT-004 | - | P1 |
| CHECKPOINT-003 | supervisor | checkpoint | PLAN-001 | - | P1 |
| PLAN-001 | planner | planning | QUALITY-001 (or user input) | - | P0 |
| ARCH-001 | architect | arch-detail | PLAN-001 | - | P1 |
| ORCH-001 | orchestrator | orchestration | PLAN-001 or ARCH-001 | - | P1 |
| IMPL-001 | implementer | implementation | PLAN-001 or ORCH-001 | - | P0 |
| IMPL-{N} | implementer | implementation | ORCH-001 | - | P0 |
| TEST-001 | tester | validation | IMPL-* | - | P0 |
| REVIEW-001 | reviewer | review | IMPL-* | - | P0 |

## 8. Context-Aware Specialist Injection

Specialists are injected based on **codebase signals** detected by explorer/analyst/planner workers, not keyword matching. The coordinator evaluates signals emitted in worker state updates against a trigger matrix to determine when specialist roles are needed.

### Signal Flow

```
analyst (RESEARCH-001) emits tech_profile in state_update
  → coordinator evaluateSpecialistInjection (in handleCallback)
  → signal combination matches trigger matrix
  → P0: TaskCreate blocking downstream | P1: TaskCreate parallel with REVIEW/TEST
```

### Common Trigger Examples

| Signal Combination | Specialist | Priority |
|-------------------|-----------|----------|
| `sql_detected` + `auth_detected` | security-expert (SECURITY-*) | P0 |
| `perf_sensitive` + `scaling_concern` | performance-optimizer (PERF-*) | P0 |
| `ml_detected` | ml-engineer (ML-*) | P0 |
| `data_migration` | data-engineer (DATA-*) | P0 |
| `devops_detected` + CI config changes | devops-engineer (DEVOPS-*) | P1 |



### Injection Rules

- Specialist tasks inherit session context and wisdom
- They publish state_update on completion like any other task
- P0 specialists block downstream tasks; P1 run in parallel
- Same specialist is only injected once per session (dedup)
