
> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。
# GSD Content Separation Rules

Rules for validating the boundary between **command delegation prompts** (spawn_agent() calls) and **agent role definitions** (agent `.md` files). Derived from analysis of GSD's `plan-phase.md`, `execute-phase.md`, `research-phase.md` and their corresponding agents (`gsd-planner`, `gsd-plan-checker`, `gsd-executor`, `gsd-phase-researcher`, `gsd-verifier`).

## Core Principle

**Commands own WHEN and WHERE. Agents own WHO and HOW.**

A delegation prompt tells the agent what to do *this time*. The agent definition tells the agent who it *always* is.

## Ownership Matrix

### Command Delegation Prompt Owns

| Concern | XML Block | Example |
|---------|-----------|---------|
| What to accomplish | `<objective>` | "Execute plan 3 of phase 2" |
| Input file paths | `<files_to_read>` | "- {state_path} (Project State)" |
| Runtime parameters | `<additional_context>` | "Phase: 5, Mode: revision" |
| Output location | `<output>` | "Write to: {phase_dir}/RESEARCH.md" |
| Expected return format | `<expected_output>` | "## VERIFICATION PASSED or ## ISSUES FOUND" |
| Who consumes output | `<downstream_consumer>` | "Output consumed by /gsd:execute-phase" |
| Revision context | `<instructions>` | "Make targeted updates to address checker issues" |
| Cross-cutting policy | `<deep_work_rules>` | Anti-shallow execution rules (applies to all agents) |
| Per-invocation quality | `<quality_gate>` (in prompt) | Invocation-specific checks (e.g., "every task has `<read_first>`") |
| Flow control | Revision loops, return routing | "If TASK COMPLETE → step 13. If BLOCKED → offer options" |
| User interaction | `request_user_input` | "Provide context / Skip / Abort" |
| Banners | Status display | "━━━ GSD ► PLANNING PHASE {X} ━━━" |

### Agent Role Definition Owns

| Concern | XML Section | Example |
|---------|-------------|---------|
| Identity | `<role>` | "You are a GSD planner" |
| Spawner list | `<role>` → Spawned by | "/gsd:plan-phase orchestrator" |
| Responsibilities | `<role>` → Core responsibilities | "Decompose phases into parallel-optimized plans" |
| Mandatory read protocol | `<role>` → Mandatory Initial Read | "MUST use Read tool to load every file in `<files_to_read>`" |
| Project discovery | `<project_context>` | "Read CLAUDE.md, check .claude/skills/" |
| Guiding principles | `<philosophy>` | Quality degradation curve by context usage |
| Input interpretation | `<upstream_input>` | "Decisions → LOCKED, Discretion → freedom" |
| Decision honoring | `<context_fidelity>` | "Locked decisions are NON-NEGOTIABLE" |
| Core insight | `<core_principle>` | "Plan completeness ≠ Goal achievement" |
| Domain expertise | Named domain sections | `<verification_dimensions>`, `<task_breakdown>`, `<dependency_graph>` |
| Return protocol | `<output_contract>` | TASK COMPLETE / TASK BLOCKED / CHECKPOINT REACHED |
| Self-check | `<quality_gate>` (in agent) | Permanent checks for every invocation |
| Anti-patterns | `<anti_patterns>` | "DO NOT check code existence" |
| Examples | `<examples>` | Scope exceeded analysis example |

## Conflict Patterns

### Pattern 1: Role Re-definition

**Symptom:** Delegation prompt contains identity language.

```
# BAD — prompt redefines role
spawn_agent({ task_name: "<task_name>", message: "You are a code quality expert. Your job is to review plans...
    <objective>Verify phase 5 plans</objective>" })

# GOOD — prompt states objective only
spawn_agent({ task_name: "<task_name>", message: "<verification_context>
    <files_to_read>...</files_to_read>
  </verification_context>
  <expected_output>## VERIFICATION PASSED or ## ISSUES FOUND</expected_output>" })
```

**Why it's wrong:** The agent's `<role>` section already defines identity. Re-definition in prompt can contradict, confuse, or override the agent's self-understanding.

**Detection:** Regex for `You are a|Your role is|Your job is to|Your responsibility is|Core responsibilities:` in prompt content.

### Pattern 2: Domain Expertise Leak

**Symptom:** Delegation prompt contains decision tables, heuristics, or examples.

```
# BAD — prompt embeds domain knowledge
spawn_agent({ task_name: "<task_name>", message: "<objective>Create plans for phase 3</objective>
    Remember: tasks should have 2-3 items max.
    | TOO VAGUE | JUST RIGHT |
    | " })

# GOOD — agent's own <task_breakdown> section owns this knowledge
spawn_agent({ task_name: "<task_name>", message: "<planning_context>
    <files_to_read>...</files_to_read>
  </planning_context>" })
```

**Why it's wrong:** Domain knowledge in prompts duplicates agent content. When agent evolves, prompt doesn't update — they diverge. Agent's domain sections are the single source of truth.

**Exception — `<deep_work_rules>`:** GSD uses this as a cross-cutting policy block (not domain expertise per se) that applies anti-shallow-execution rules across all agents. This is acceptable because:
1. It's structural policy, not domain knowledge
2. It applies uniformly to all planning agents
3. It supplements (not duplicates) agent's own quality gate

**Detection:**
- Tables with `|` in prompt content (excluding `<files_to_read>` path tables)
- "Good:" / "Bad:" / "Example:" comparison pairs
- "Always..." / "Never..." / "Prefer..." heuristic statements
- Numbered rules lists (>3 items) that aren't revision instructions

### Pattern 3: Quality Gate Duplication

**Symptom:** Same quality check appears in both prompt and agent definition.

```
# PROMPT quality_gate
- [ ] Every task has `<read_first>`
- [ ] Every task has `<acceptance_criteria>`
- [ ] Dependencies correctly identified

# AGENT quality_gate
- [ ] Every task has `<read_first>` with at least the file being modified
- [ ] Every task has `<acceptance_criteria>` with grep-verifiable conditions
- [ ] Dependencies correctly identified
```

**Analysis:**
- "Dependencies correctly identified" → **duplicate** (exact match)
- "`<read_first>`" in both → **overlap** (prompt is less specific than agent)
- "`<acceptance_criteria>`" → **overlap** (same check, different specificity)

**When duplication is OK:** Prompt's `<quality_gate>` adds *invocation-specific* checks not in agent's permanent gate (e.g., "Phase requirement IDs all covered" is specific to this phase, not general).

**Detection:** Fuzzy match quality gate items between prompt and agent (>60% token overlap).

### Pattern 4: Output Format Conflict

**Symptom:** Command expects return markers the agent doesn't define.

```
# COMMAND handles:
- "## VERIFICATION PASSED" → continue
- "## ISSUES FOUND" → revision loop

# AGENT <output_contract> defines:
- "## TASK COMPLETE"
- "## TASK BLOCKED"
```

**Why it's wrong:** Command routes on markers. If markers don't match, routing breaks silently — command may hang or misinterpret results.

**Detection:** Extract return marker strings from both sides, compare sets.

### Pattern 5: Process Override

**Symptom:** Prompt dictates step-by-step process.

```
# BAD — prompt overrides agent's process
spawn_agent({ task_name: "<task_name>", message: "Step 1: Read the roadmap. Step 2: Extract requirements.
    Step 3: Create task breakdown. Step 4: Assign waves..." })

# GOOD — prompt states objective, agent decides process
spawn_agent({ task_name: "<task_name>", message: "<objective>Create plans for phase 5</objective>
    <files_to_read>...</files_to_read>" })
```

**Exception — Revision instructions:** `<instructions>` block in revision prompts is acceptable because it tells the agent *what changed* (checker issues), not *how to work*.

```
# OK — revision context, not process override
<instructions>
Make targeted updates to address checker issues.
Do NOT replan from scratch unless issues are fundamental.
Return what changed.
</instructions>
```

**Detection:** "Step N:" / "First..." / "Then..." / "Finally..." patterns in prompt content outside `<instructions>` blocks.

### Pattern 6: Scope Authority Conflict

**Symptom:** Prompt makes domain decisions the agent should own.

```
# BAD — prompt decides implementation details
spawn_agent({ task_name: "<task_name>", message: "Use React Query for data fetching. Use Zustand for state management.
    <objective>Plan the frontend architecture</objective>" })

# GOOD — user decisions passed through from CONTEXT.md
spawn_agent({
  subagent_type: "gsd-planner",
  prompt: "<planning_context>
    <files_to_read>
    - {context_path} (USER DECISIONS - locked: React Query, Zustand)
    </files_to_read>
  </planning_context>"
})
```

**Key distinction:**
- **Prompt making decisions** = conflict (command shouldn't have domain opinion)
- **Prompt passing through user decisions** = correct (user decisions flow through command to agent)
- **Agent interpreting user decisions** = correct (agent's `<context_fidelity>` handles locked/deferred/discretion)

**Detection:** Technical nouns (library names, architecture patterns) in prompt free text (not inside `<files_to_read>` path descriptions).

### Pattern 7: Missing Contracts

**Symptom:** Handoff points between command and agent are incomplete.

| Missing Element | Impact |
|-----------------|--------|
| Agent has no `<output_contract>` | Command can't route on return markers |
| Command doesn't handle all agent return markers | BLOCKED/CHECKPOINT silently ignored |
| Agent expects `<files_to_read>` but prompt doesn't provide it | Agent starts without context |
| Agent's "Spawned by:" doesn't list this command | Agent may not expect this invocation pattern |
| Agent has `<upstream_input>` but prompt doesn't match structure | Agent misinterprets input |

**Detection:** Cross-reference both sides for completeness.

## The `<deep_work_rules>` Exception

GSD's plan-phase uses `<deep_work_rules>` in delegation prompts. This is a deliberate design choice, not a violation:

1. **It's cross-cutting policy**: applies to ALL planning agents equally
2. **It's structural**: defines required fields (`<read_first>`, `<acceptance_criteria>`, `<action>` concreteness) — not domain expertise
3. **It supplements agent quality**: agent's own `<quality_gate>` is self-check; deep_work_rules is command-imposed minimum standard
4. **It's invocation-specific context**: different commands might impose different work rules

**Rule:** `<deep_work_rules>` in a delegation prompt is `info` level, not error. Flag only if its content duplicates agent's domain sections verbatim.

## Severity Classification

| Severity | When | Action Required |
|----------|------|-----------------|
| `error` | Actual conflict: contradictory content between prompt and agent | Must fix — move content to correct owner |
| `warning` | Duplication or boundary blur without contradiction | Should fix — consolidate to single source of truth |
| `info` | Acceptable pattern that looks like violation but isn't | No action — document why it's OK |

## Quick Reference: Is This Content in the Right Place?

| Content | In Prompt? | In Agent? |
|---------|-----------|-----------|
| "You are a..." | ❌ Never | ✅ Always |
| File paths for this invocation | ✅ Yes | ❌ No |
| Phase number, mode | ✅ Yes | ❌ No |
| Decision tables | ❌ Never | ✅ Always |
| Good/bad examples | ❌ Never | ✅ Always |
| "Write to: {path}" | ✅ Yes | ❌ No |
| Return markers handling | ✅ Yes (routing) | ✅ Yes (definition) |
| Quality gate | ✅ Per-invocation | ✅ Permanent self-check |
| "MUST read files first" | ❌ Agent's `<role>` owns this | ✅ Always |
| Anti-shallow rules | ⚠️ OK as cross-cutting policy | ✅ Preferred |
| Revision instructions | ✅ Yes (what changed) | ❌ No |
| Heuristics / philosophy | ❌ Never | ✅ Always |
| Banner display | ✅ Yes | ❌ Never |
| request_user_input | ✅ Yes | ❌ Never |
