# Command Design Specification

Guidelines for Claude Code **command files** (orchestration workflows). Commands own process flow, user interaction, and agent coordination — NOT domain expertise.

## Content Separation Principle

| Concern | Belongs in Command | Belongs in Agent |
|---------|-------------------|-----------------|
| Argument parsing | Yes | No |
| Path resolution | Yes | No |
| User prompts (AskUserQuestion) | Yes | No |
| Status banners | Yes | No |
| Agent spawning (Task) | Yes | No |
| Flow control (if/else routing) | Yes | No |
| Init/context loading (CLI tools) | Yes | No |
| Revision loops | Yes | No |
| Domain knowledge | No | Yes |
| Quality heuristics | No | Yes |
| Output format rules | No | Yes |
| Role identity | No | Yes |

## YAML Frontmatter

```yaml
---
name: command-name           # Required: lowercase with hyphens
description: Description     # Required: brief purpose
argument-hint: "[args]"      # Optional: argument format hint
allowed-tools: Tool1, Tool2  # Optional: restricted tool set
---
```

## Path Structure

```
.claude/commands/deploy.md           # Top-level command
.claude/commands/issue/create.md     # Grouped command
~/.claude/commands/global-status.md  # User-level command
.claude/skills/my-skill/SKILL.md     # Skill file (see Skill Variant below)
```

## Content Structure

Commands use XML semantic tags with process steps inside `<process>`:

| Tag | Required | Purpose |
|-----|----------|---------|
| `<purpose>` | Yes | What + when + what it produces (2-3 sentences) |
| `<required_reading>` | Commands and stateful skills | Shared lifecycle references loaded before execution |
| `<process>` | Yes | Steps — numbered or named (see Step Styles below) |
| `<auto_mode>` | Optional | Behavior when `--auto` flag present |
| `<offer_next>` | Recommended | Formatted completion status + next actions |
| `<success_criteria>` | Yes | Checkbox list of verifiable conditions |

## Skill Variant

Skills (`.claude/skills/*/SKILL.md`) follow command structure with critical differences due to **progressive loading** — skills are loaded inline into the conversation context, NOT via file resolution.

### Key Differences: Skill vs Command

| Aspect | Command | Skill |
|--------|---------|-------|
| Location | `.claude/commands/` | `.claude/skills/*/SKILL.md` |
| Loading | Slash-command invocation, `@` refs resolved | Progressive inline loading into conversation |
| `<required_reading>` | Yes — `@path` refs auto-resolved | Canonical shared lifecycle refs only; phase/domain context stays progressive |
| External file access | `@` references | `Read()` tool calls within `<process>` steps |
| Phase files | N/A | `Read("phases/01-xxx.md")` within process steps |
| Frontmatter | `name`, `description`, `argument-hint` | `name`, `description`, `allowed-tools` |

### Skill-Specific Rules

1. **Minimal `<required_reading>`** — Stateful skills reference the canonical Run workflow. All phase/domain context is loaded via `Read()` calls within `<process>` steps.

2. **Progressive phase loading** — For multi-phase skills with phase files in `phases/` subdirectory, use inline `Read()`:
   ```javascript
   // Within process step: Load phase doc on-demand
   Read("phases/01-session-discovery.md")
   // Execute phase logic...
   ```

3. **Self-contained content** — All instructions, rules, and logic must be directly in the SKILL.md or loaded via `Read()` at runtime. No implicit file dependencies.

4. **Frontmatter uses `allowed-tools:`** instead of `argument-hint:`:
   ```yaml
   ---
   name: my-skill
   description: What this skill does
   allowed-tools: Agent, Read, Write, Bash, Glob, Grep
   ---
   ```

### Skill Content Structure

| Tag | Required | Purpose |
|-----|----------|---------|
| `<purpose>` | Yes | What + when + what it produces (2-3 sentences) |
| `<process>` | Yes | Steps with inline `Read()` for external files |
| `<auto_mode>` | Optional | Behavior when `-y`/`--yes` flag present |
| `<success_criteria>` | Yes | Checkbox list of verifiable conditions |

**Note**: `<offer_next>` is less common in skills since skills often chain to other skills via `Skill()` calls.

## Step Styles

GSD uses two step styles. Choose based on command nature:

### Style A: Numbered Steps (for complex orchestrators)

Used by: `plan-phase.md`, `new-project.md`, `research-phase.md`

Best for: Multi-agent orchestration, long workflows with branching, revision loops.

```markdown
<process>

## 1. Initialize

Load context, parse arguments.

## 2. Validate Phase

Check preconditions.

## 3. Spawn Agent

Display banner, construct prompt, spawn.

## 4. Handle Result

Route on return markers.

## 5. Present Status

Display offer_next.

</process>
```

### Style B: Named `<step>` Blocks (for focused commands)

Used by: `execute-phase.md`, `discuss-phase.md`, `verify-work.md`

Best for: Sequential steps, clear atomic actions, step-level priority.

```markdown
<process>

<step name="initialize" priority="first">
Load context, parse arguments.
</step>

<step name="validate_phase">
Check preconditions.
</step>

<step name="spawn_agent">
Construct prompt, spawn agent.
</step>

<step name="report">
Display results.
</step>

</process>
```

### Which style to use?

| Criteria | Numbered | Named `<step>` |
|----------|----------|----------------|
| Agent spawning with revision loops | Yes | No |
| Multiple conditional branches | Yes | No |
| Sequential with clear boundaries | No | Yes |
| Steps reference each other by number | Yes | No |
| First step needs `priority="first"` | No | Yes |

## Init Pattern

Most GSD commands start by loading context via CLI tools:

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init {command} "${ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

For non-GSD commands, the equivalent is reading config/state files:

```bash
# Read project state
CONFIG=$(cat .claude/config.json 2>/dev/null || echo '{}')
```

## Banner Style

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SKILL ► ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Display banners before major phase transitions (agent spawning, user decisions, completion).

## Agent Spawning Pattern

Commands spawn agents via `Agent()` with structured prompts:

```javascript
Agent({
  subagent_type: "agent-name",
  prompt: filled_prompt,
  description: "Verb Phase {X}",
  run_in_background: false
})
```

### Prompt Structure for Agents

The prompt passed to agents uses XML blocks:

```markdown
<objective>
What to accomplish — specific and measurable.
</objective>

<files_to_read>
- {path1} (description — what this file provides)
- {path2} (description)
</files_to_read>

<additional_context>
**Phase:** {number}
**Mode:** {standard | revision | gap_closure}
Extra info the agent needs.
</additional_context>

<output>
Write to: {output_path}
</output>
```

### Return Handling

Commands route on agent return markers:

```markdown
## Handle Agent Return

- **`## TASK COMPLETE`:** Display confirmation, continue to next step.
- **`## TASK BLOCKED`:** Display blocker, offer user options:
  1) Provide context  2) Skip  3) Abort
- **`## CHECKPOINT REACHED`:** Present question to user, relay response.
```

## Revision Loop Pattern

For commands that iterate between generation and verification:

```markdown
## N. Revision Loop (Max 3 Iterations)

Track `iteration_count` (starts at 1).

**If iteration_count < 3:**
- Display: "Sending back for revision... (iteration {N}/3)"
- Spawn agent with revision prompt + checker issues
- After agent returns → spawn checker again, increment count

**If iteration_count >= 3:**
- Display remaining issues
- Offer: 1) Force proceed  2) Provide guidance  3) Abandon
```

## Auto Mode Pattern

Commands supporting `--auto` flag define behavior in `<auto_mode>`:

```markdown
<auto_mode>
## Auto Mode Detection

Check if `--auto` flag is present in $ARGUMENTS.

**If auto mode:**
- Skip confirmation prompts
- Use smart defaults for optional choices
- Auto-approve intermediate results
- Chain to next command on success

**Document requirement (if applicable):**
- What --auto requires as input
- Error message if requirements not met
</auto_mode>
```

## offer_next Pattern

```markdown
<offer_next>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SKILL ► TASK COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**{Summary line}**

| Key | Value |
|-----|-------|
| ... | ...   |

Status: {metric 1} | {metric 2}

───────────────────────────────────────────────────────

## Next Up

**{Primary next action}**

/{next-command} {args}

<sub>/clear first — fresh context window</sub>

───────────────────────────────────────────────────────

**Also available:**
- /{alt-1} — description
- /{alt-2} — description

───────────────────────────────────────────────────────
</offer_next>
```

## AskUserQuestion Pattern

For user decisions within commands:

```markdown
AskUserQuestion(
  header: "Context",
  question: "Descriptive question?",
  options: [
    { label: "Option A", description: "Effect of choosing A" },
    { label: "Option B", description: "Effect of choosing B" }
  ]
)

If "Option A": {action}
If "Option B": {action}
```

## Shell Correctness Rules

| Rule | Wrong | Correct |
|------|-------|---------|
| Multi-line output | `echo "{ ... }"` | `cat <<'EOF' > file`...`EOF` |
| Variable init | Use `$VAR` after conditional | Initialize BEFORE conditional |
| Error exit | `echo "Error"` (no exit) | `echo "Error" && exit 1` |
| Quoting | `$VAR` bare | `"$VAR"` quoted |
| Prerequisites | Implicit tool usage | Declare in `<prerequisites>` |
| File existence | Assume file exists | `test -f "$FILE" && ...` |

## Step Naming Conventions

| Domain | Typical Steps |
|--------|--------------|
| Multi-Agent Pipeline | Initialize, Validate, Spawn Agent A, Handle A Result, Spawn Agent B, Revision Loop, Present Status |
| Deploy/Release | Initialize, Validate Config, Run Deployment, Verify Health, Present Status |
| CRUD | Initialize, Validate Entity, Persist Changes, Present Status |
| Analysis | Initialize, Gather Context, Spawn Analyzer, Present Findings |
