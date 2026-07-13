

# Frontend Pipeline Definitions

## Pipeline Modes

### Page Mode (4 beats, linear)

```
ANALYZE-001 --> ARCH-001 --> DEV-001 --> QA-001
[analyst]       [architect]  [developer]  [qa]
```

### Feature Mode (5 beats, with architecture review gate)

```
ANALYZE-001 --> ARCH-001 --> QA-001 --> DEV-001 --> QA-002
[analyst]       [architect]  [qa:arch]   [developer]  [qa:code]
```

### System Mode (7 beats, dual-track parallel)

```
ANALYZE-001 --> ARCH-001 --> QA-001 --> ARCH-002 ─┐
[analyst]       [architect]  [qa:arch]  [architect] |
                                        DEV-001   ──┘ --> QA-002 --> DEV-002 --> QA-003
                                        [developer:tokens]  [qa]    [developer]  [qa:final]
```

### Generator-Critic Loop (developer <-> qa)

```
developer (Generator) -> QA artifact -> qa (Critic)
                      <- QA feedback <-
                         (max 2 rounds)

Convergence: qa.score >= 8 && qa.critical_count === 0
```

## Task Metadata Registry

| Task ID | Role | Pipeline | Dependencies | Description |
|---------|------|----------|-------------|-------------|
| ANALYZE-001 | analyst | all | (none) | Requirement analysis + design intelligence |
| ARCH-001 | architect | all | ANALYZE-001 | Design token system + component architecture |
| ARCH-002 | architect | system | QA-001 | Component specs refinement |
| DEV-001 | developer | all | ARCH-001 or QA-001 | Frontend implementation |
| DEV-002 | developer | system | QA-002 | Component implementation |
| DEV-fix-N | developer | all | QA-N (GC loop trigger) | Fix issues from QA |
| QA-001 | qa | all | ARCH-001 or DEV-001 | Architecture or code review |
| QA-002 | qa | feature/system | DEV-001 | Code review |
| QA-003 | qa | system | DEV-002 | Final quality check |
| QA-recheck-N | qa | all | DEV-fix-N | Re-audit after developer fixes |

## Pipeline Selection Logic

| Score | Pipeline |
|-------|----------|
| 1-2 | page |
| 3-4 | feature |
| 5+ | system |

Default: feature.

## ui-ux-pro-max Integration

Analyst role invokes ui-ux-pro-max via Skill to obtain industry design intelligence:

| Action | Invocation |
|--------|------------|
| Full design system | `Skill(skill="ui-ux-pro-max", args="<industry> <keywords> --design-system")` |
| Domain search | `Skill(skill="ui-ux-pro-max", args="<query> --domain <domain>")` |
| Tech stack guidance | `Skill(skill="ui-ux-pro-max", args="<query> --stack <stack>")` |

**Supported Domains**: product, style, typography, color, landing, chart, ux, web
**Supported Stacks**: html-tailwind, react, nextjs, vue, svelte, shadcn, swiftui, react-native, flutter

**Fallback**: If ui-ux-pro-max skill not installed, degrade to LLM general design knowledge.
