
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。
# Command Template — Structural Reference

Defines the structural pattern for generated **command files**. The generator uses this as a guide to produce concrete, domain-specific content — NOT as a literal copy target.

## Required Structure

```markdown
---
name: {$NAME}
description: {$DESCRIPTION}
argument-hint: {$ARGUMENT_HINT}  # omit if empty
allowed-tools: {tools}           # omit if unrestricted
---

<purpose>
{2-3 sentences: what it does + when invoked + what it produces}
</purpose>

<required_reading>
{@ references to files needed before execution}
</required_reading>

<process>

## 1. Initialize

{Load context, parse $ARGUMENTS, validate preconditions.}

{Argument table:}
| Flag/Arg | Required | Description |
|----------|----------|-------------|
| `$ARG1`  | Yes      | ...         |
| `--flag` | No       | ...         |

{Validation: missing required → error, invalid → error with usage hint.}

## 2. {Domain Action}

{Display banner:}
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SKILL ► ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

{Core orchestration logic — file checks, state validation, conditional routing.}

## 3. Spawn spawn_agent(if applicable)

{Construct prompt with <files_to_read>, <objective>, <output> blocks.}

```javascript
spawn_agent({
  subagent_type: "{agent-name}",
  prompt: filled_prompt,
  description: "{Verb} {target}",
  run_in_background: false
})
```

## 4. Handle Result

{Route on agent return markers:}
- `## TASK COMPLETE` → continue to next step
- `## TASK BLOCKED` → display blocker, offer options
- `## CHECKPOINT REACHED` → present to user, relay response

## N. Present Status

{Route to <offer_next>.}

</process>

<offer_next>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SKILL ► TASK COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**{Summary line}**

{Status table or key-value pairs}

## Next Up

/{next-command} {args}

**Also available:**
- /{alt-command-1} — description
- /{alt-command-2} — description
</offer_next>

<success_criteria>
- [ ] {Precondition validated}
- [ ] {Core action completed}
- [ ] {Agent spawned and returned (if applicable)}
- [ ] {Output artifact produced / effect applied}
- [ ] {Status displayed to user}
</success_criteria>
```

## Step Naming Conventions

| Domain | Typical Steps |
|--------|--------------|
| Deploy/Release | Initialize, Validate Config, Run Deployment, Verify Health, Present Status |
| CRUD | Initialize, Validate Entity, Persist Changes, Present Status |
| Analysis | Initialize, Gather Context, Spawn Analyzer, Present Findings |
| Multi-Agent | Initialize, Spawn Agent A, Handle A Result, Spawn Agent B, Revision Loop, Present Status |
| Pipeline | Initialize, Stage 1, Handle Stage 1, Stage 2, Handle Stage 2, Present Status |

## Content Quality Rules

| Rule | Bad | Good |
|------|-----|------|
| No placeholders | `[Describe purpose]` | `Deploy to target environment with rollback on failure.` |
| Concrete steps | `Handle the deployment` | `Run kubectl apply, wait for rollout, check health endpoint` |
| Specific errors | `Error: invalid` | `Error: --env must be "prod" or "staging"` |
| Verifiable criteria | `Works correctly` | `Health endpoint returns 200 within 30s` |
