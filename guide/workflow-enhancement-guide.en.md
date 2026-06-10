# Workflow Enhancement Guide

> This document introduces Maestro's advanced workflow enhancement features, including dynamic adversarial workflow generation and parallel workflow acceleration.

## Overview

Maestro provides two powerful workflow enhancement commands:

| Command | Purpose | Features |
|---------|---------|----------|
| `maestro-universal-workflow` | Dynamically generate task-specific workflow scripts | Adversarial decision patterns, reusable library accumulation |
| `maestro-swarm-workflow` | Execute pre-built workflow scripts in parallel | Multi-agent concurrency, 8 fixed scripts |

## maestro-universal-workflow

### Purpose

Dynamic workflow generator that automatically creates Workflow scripts with adversarial decision patterns based on task requirements.

### Core Features

- **Dynamic Generation**: Automatically designs workflow structure based on task description
- **Adversarial Decisions**: Injects adversarial agent patterns at every decision point
- **Library Accumulation**: Generated scripts are saved to `~/.maestro/workflows/dynamic/` for reuse
- **Three Depth Levels**: shallow (single skeptic), standard (3-vote), deep (cross-verify + meta-skeptic)

### Use Cases

- Non-standard tasks with no existing script match
- Custom multi-step analysis workflows
- Comparison and evaluation scenarios (e.g., technology selection, architecture decisions)
- Deep investigation of complex problems

### Usage Examples

```bash
# Auto-match or generate
/maestro-universal-workflow "Evaluate database migration feasibility and risks"

# Specify depth
/maestro-universal-workflow "Audit auth module security" --depth deep

# Generate only, don't execute
/maestro-universal-workflow "Compare 3 caching strategies" --dry-run --name cache-eval

# Modify existing script
/maestro-universal-workflow "Like analyze but add cost dimension" --from wf-analyze
```

### Adversarial Depth Levels

| Level | Decision Pattern | Agent Cost |
|-------|-----------------|------------|
| `shallow` | 1 skeptic per decision point | +1 per decision |
| `standard` | 3-vote majority per decision (default) | +4 per decision |
| `deep` | Cross-verify + 3-way advocacy + meta-skeptic | +8 per decision |

### Generated Script Structure Example

User intent: "Evaluate 3 API authentication methods (JWT/OAuth2/API Key), select the best"

```
Phase 1: Explore — Explore existing authentication implementation in codebase
Phase 2: Evaluate — 3 agents deeply evaluate each method
Phase 3: CrossVerify — Skeptic challenges each evaluation result
Phase 4: Compete — 3 advocates debate for each method
Phase 5: Arbitrate — Referee selects the best method based on debate results
```

Estimated agent count: 1(explore) + 3(evaluate) + 3(cross-verify) + 3(advocates) + 1(referee) = 11

---

## maestro-swarm-workflow

### Purpose

Parallel workflow acceleration layer that routes intent to pre-built Workflow scripts, leveraging `parallel()` / `pipeline()` for multi-agent concurrent execution.

### Core Features

- **8 Fixed Scripts**: Covering analyze/brainstorm/review/verify/grill/plan/execute/milestone-audit
- **Parallel Execution**: Utilizes Workflow tool's parallel/pipeline capabilities
- **Adversarial Patterns**: Each script embeds adversarial decision patterns
- **Ralph Integration**: Can serve as acceleration executor in ralph chains

### Use Cases

- Parallel acceleration versions of standard maestro commands
- Scenarios requiring multi-agent concurrent analysis
- Steps in Ralph chains that need parallel computation

### Usage Examples

```bash
# Direct invocation
/maestro-swarm-workflow "analyze auth module"

# Specify script
/maestro-swarm-workflow "Review code quality" --script wf-review

# Limit analysis dimensions
/maestro-swarm-workflow "Analyze performance bottlenecks" --dims architecture,performance

# Limit roles
/maestro-swarm-workflow "Design new feature" --roles system-architect,product-manager
```

### Available Scripts

| Script | Accelerates | Adversarial Pattern |
|--------|-------------|---------------------|
| `wf-analyze` | maestro-analyze | explore → 6-dim scoring → skeptic cross-verify → 3-way advocacy + referee |
| `wf-brainstorm` | maestro-brainstorm | multi-role analysis → 3-specialist cross-review → 3-proposal competition → arbitrator |
| `wf-review` | quality-review | 6-dim scan → 3-vote adversarial verify → 3-perspective report + arbitrated verdict |
| `wf-verify` | maestro-execute (E2.7) | 3-layer + antipattern + convergence → prosecutor vs defender debate → judge verdict |
| `wf-grill` | maestro-grill | explore → parallel branch stress → meta-skeptic challenge → 3-vote verdict |
| `wf-plan` | maestro-plan | parallel context → 3-strategy competing proposals → judge panel scoring → 3-critic adversarial check |
| `wf-execute` | maestro-execute | wave-based parallel execution → adversarial convergence spot-check → 3-vote status determination |
| `wf-milestone-audit` | maestro-milestone-audit | parallel 3-dim audit → adversarial dimension challenge → 3-vote verdict |

---

## Relationship with Existing Commands

| Dimension | swarm-workflow | universal-workflow | composer/player |
|-----------|---------------|-------------------|-----------------|
| Script Source | 8 fixed pre-written scripts | Dynamic generation + library | User-defined JSON templates |
| Scope | 8 corresponding maestro commands | Any task | Any DAG workflow |
| Decision Patterns | Hardcoded in scripts | Dynamic by depth | User-defined |
| Persistence | No new scripts | Saved to dynamic/ for reuse | Saved to templates/ |
| Recommended | Standard commands with matches | Non-standard tasks, new domains | Precise control needed |

### Selection Guide

1. **Standard tasks** → Use `maestro-swarm-workflow` (existing script matches)
2. **Non-standard tasks** → Use `maestro-universal-workflow` (dynamic generation)
3. **Precise control** → Use `maestro-composer` + `maestro-player` (JSON templates)
4. **Sequential execution** → Use `maestro-ralph` (adaptive chain)

---

## Ralph Integration

`maestro-swarm-workflow` can serve as an acceleration executor in ralph chains:

```json
{
  "steps": [
    {
      "index": 0,
      "skill": "maestro-swarm-workflow",
      "args": "\"analyze auth module\" --script wf-analyze",
      "stage": "analyze"
    }
  ]
}
```

Ralph will automatically recognize swarm-workflow and use parallel execution mode.

---

## Best Practices

1. **Start with standard**: Try `maestro-swarm-workflow` first, use `universal-workflow` if no match
2. **Control depth**: `shallow` for quick checks, `standard` for routine tasks, `deep` for critical decisions
3. **Reuse scripts**: Generated scripts are saved in `~/.maestro/workflows/dynamic/`, reusable via `--from`
4. **Combine with ralph**: Use swarm-workflow as parallel acceleration layer in ralph chains

---

## Related Documentation

- [Command Reference](../COMMANDS-CARD-REFERENCE.md) — Quick reference for all commands
- [Ralph Guide](./maestro-ralph-guide.en.md) — Detailed guide for Ralph closed-loop engine
- [Team Collaboration Guide](./team-lite-guide.en.md) — Multi-agent collaboration guide
