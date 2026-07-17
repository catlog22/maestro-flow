
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。
# Agent Design Specification

Guidelines for Claude Code **agent definition files** (role + domain expertise). Agents own identity, knowledge, and quality standards — NOT orchestration flow.

## Content Separation Principle

Agents are spawned by commands via `spawn_agent()`. The agent file defines WHO the agent is and WHAT it knows. It does NOT define WHEN or HOW it gets invoked.

| Concern | Belongs in Agent | Belongs in Command |
|---------|-----------------|-------------------|
| Role identity (`<role>`) | Yes | No |
| Domain expertise | Yes | No |
| Output format/structure | Yes | No |
| Quality heuristics | Yes | No |
| Self-check criteria | Yes | No |
| Philosophy/principles | Yes | No |
| Discovery protocol | Yes | No |
| Specificity examples | Yes | No |
| Argument parsing | No | Yes |
| User interaction | No | Yes |
| Flow control | No | Yes |
| Agent spawning | No | Yes |
| Status banners | No | Yes |
| Revision loop logic | No | Yes |

## YAML Frontmatter

```yaml
---
name: agent-name
description: One-line purpose. Spawned by /command-name orchestrator.
tools: Read, Write, Bash, Glob, Grep    # Tools this agent needs
color: green                             # Optional: terminal color
---
```

**Naming convention:** `{domain}-{role}` or `{project}-{role}` — e.g., `gsd-planner`, `gsd-plan-checker`, `code-reviewer`.

## Content Structure

Agent files use XML semantic tags. `<role>` is ALWAYS first after frontmatter.

### Section Catalog

Derived from GSD agent patterns (`gsd-planner`, `gsd-plan-checker`, `gsd-phase-researcher`):

| Section | Purpose | When to Include |
|---------|---------|-----------------|
| `<role>` | Identity, spawner, responsibilities | **Always** |
| `<project_context>` | How to discover project conventions | Agent reads project files |
| `<philosophy>` | Guiding principles, anti-patterns | Agent has opinionated approach |
| `<context_fidelity>` | Honor upstream decisions (locked/deferred/discretion) | Agent receives user decisions |
| `<upstream_input>` | What the agent receives and how to use it | Agent has structured input |
| `<discovery_levels>` | Research depth protocol (L0-L3) | Agent does research |
| `<task_breakdown>` | Task anatomy, sizing, ordering | Agent produces tasks |
| `<dependency_graph>` | How to build dependency graphs | Agent manages dependencies |
| `<output_format>` | Exact output structure with templates | Agent produces structured output |
| `<core_principle>` | Central verification or design principle | Agent has one key insight |
| `<output_contract>` | Return markers to orchestrator | **Always** |
| `<quality_gate>` | Self-check before returning | **Always** |

### Section Ordering Convention

```
<role>              ← Identity (always first)
<project_context>   ← How to orient in the project
<philosophy>        ← Guiding beliefs
<upstream_input>    ← What agent receives
<context_fidelity>  ← How to honor decisions
<core_principle>    ← Key insight
... domain sections ← Expertise (2-6 sections)
<output_contract>   ← Return protocol
<quality_gate>      ← Self-check (always last content section)
```

## Section Writing Rules

### `<role>` — Identity (ALWAYS FIRST)

Pattern from `gsd-planner.md` and `gsd-plan-checker.md`:

```markdown
<role>
You are a {role name}. You {primary action verb} {what you produce}.

Spawned by:
- `/{command}` orchestrator (standard mode)
- `/{command} --flag` orchestrator (variant mode)
- `/{command}` in revision mode (updating based on checker feedback)

Your job: {One sentence — what downstream consumers get from you.}

**CRITICAL: Mandatory Initial Read**
If the prompt contains a `<files_to_read>` block, you MUST use the `Read` tool
to load every file listed there before performing any other actions. This is your
primary context.

**Core responsibilities:**
- **FIRST: {Most important action}** ({why it's first})
- {Responsibility 2 — verb phrase}
- {Responsibility 3 — verb phrase}
- {Responsibility 4 — verb phrase}
- Return structured results to orchestrator
</role>
```

### `<project_context>` — Project Discovery

Pattern from `gsd-planner.md`:

```markdown
<project_context>
Before {acting}, discover project context:

**Project instructions:** Read `./CLAUDE.md` if it exists. Follow all project-specific
guidelines, security requirements, and coding conventions.

**Project skills:** Check `.claude/skills/` directory if exists:
1. List available skills (subdirectories)
2. Read `SKILL.md` for each skill
3. Load specific files as needed during {action}
4. Ensure {output} accounts for project patterns
</project_context>
```

### `<philosophy>` — Guiding Principles

Pattern from `gsd-planner.md`:

```markdown
<philosophy>
## {Principle Name}

{Core belief about how this agent approaches work.}

| Context Usage | Quality | Agent's State |
|---------------|---------|---------------|
| 0-30% | PEAK | Thorough |
| 50-70% | DEGRADING | Efficiency mode |
| 70%+ | POOR | Rushed |

**Anti-patterns (delete if seen):**
- {Anti-pattern 1 with specific indicator}
- {Anti-pattern 2 with specific indicator}
</philosophy>
```

### `<upstream_input>` — Structured Input Handling

Pattern from `gsd-plan-checker.md`:

```markdown
<upstream_input>
**{Input name}** (if exists) — {Source description}

| Section | How You Use It |
|---------|----------------|
| `## Section A` | LOCKED — {must implement exactly}. Flag if contradicted. |
| `## Section B` | Freedom areas — {can choose approach}, don't flag. |
| `## Section C` | Out of scope — {must NOT include}. Flag if present. |
</upstream_input>
```

### `<context_fidelity>` — Decision Honoring

Pattern from `gsd-planner.md`:

```markdown
<context_fidelity>
## CRITICAL: User Decision Fidelity

**Before creating ANY {output}, verify:**

1. **Locked Decisions** — MUST be implemented exactly as specified
   - If user said "use library X" → {output} MUST use X, not alternative
   - If user said "card layout" → {output} MUST implement cards

2. **Deferred Ideas** — MUST NOT appear in {output}
   - If user deferred "search" → NO search tasks allowed

3. **Discretion Areas** — Use your judgment
   - Make reasonable choices and document in {output}

**Self-check before returning:**
- [ ] Every locked decision has coverage
- [ ] No deferred idea appears
- [ ] Discretion areas handled reasonably

**If conflict exists** (research vs user decision):
- Honor the user's locked decision
- Note: "Using X per user decision (research suggested Y)"
</context_fidelity>
```

### Domain Sections — One Concern Each

Name sections after the domain concept. Include concrete examples in EVERY section.

**Required elements per domain section:**

| Element | Minimum |
|---------|---------|
| Good vs bad comparison table | 1 per section |
| Decision/routing table | 1 per section (if conditional logic exists) |
| Format template | 1 per section (if structured output) |
| Concrete example | 2+ per section |

**Example from gsd-planner.md `<task_breakdown>`:**

```markdown
<task_breakdown>
## Task Anatomy

Every task has four required fields:

**<files>:** Exact paths.
- Good: `src/app/api/auth/login/route.ts`
- Bad: "the auth files"

**<action>:** Specific instructions.
- Good: "Create POST endpoint accepting {email, password}, validates using bcrypt,
  returns JWT in httpOnly cookie with 15-min expiry. Use jose library."
- Bad: "Add authentication"

## Specificity Examples

| TOO VAGUE | JUST RIGHT |
|-----------|------------|
| "Add auth" | "Add JWT auth with refresh rotation, jose library, httpOnly cookie" |
| "Style the dashboard" | "Tailwind: 3-col grid on lg, 1 on mobile, card shadows, hover states" |

**Test:** Could a different agent execute without clarifying questions?
</task_breakdown>
```

### `<output_contract>` — Return Protocol

```markdown
<output_contract>
## Return Protocol

Return ONE of these markers as the LAST section of output:

### Success
```
## TASK COMPLETE

{Summary of what was produced}
{Artifact locations: file paths}
{Key metrics: counts, coverage}
```

### Blocked
```
## TASK BLOCKED

**Blocker:** {What's missing or preventing progress}
**Need:** {Specific action/info that would unblock}
**Attempted:** {What was tried before declaring blocked}
```

### Checkpoint (needs user decision)
```
## CHECKPOINT REACHED

**Question:** {Decision needed from user}
**Context:** {Why this matters}
**Options:**
1. {Option A} — {effect on output}
2. {Option B} — {effect on output}
```
</output_contract>
```

### `<quality_gate>` — Self-Check (ALWAYS LAST)

```markdown
<quality_gate>
Before returning, verify:
- [ ] {Check 1 — concrete, grep-verifiable}
- [ ] {Check 2 — concrete, counts/exists}
- [ ] {Check 3 — concrete, structural}
- [ ] {Check 4 — no prohibited content}
</quality_gate>
```

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|-------------|----------------|------------------|
| Agent contains `request_user_input` | Agents don't interact with users | Return `## CHECKPOINT REACHED` |
| Agent parses `$ARGUMENTS` | Arguments belong to the command | Receive pre-parsed values in prompt |
| Agent displays banners | UI is the command's job | Return structured data |
| `<role>` is not first section | Identity must be established first | Always lead with `<role>` |
| Generic section names | Hard to scan, unclear scope | Name after domain concept |
| No examples in domain sections | Rules without examples are ambiguous | Include comparison tables |
| Agent spawns other agents | Spawning belongs to commands | Request via `## CHECKPOINT REACHED` |
| Agent defines its own invocation syntax | That's the command's responsibility | Document in `Spawned by:` only |
| Domain section covers multiple concerns | Violates single-concern rule | Split into separate sections |
