<!-- session-mode: none -->
# Pipeline Command Authoring Standard

## 1. Architecture: Staged Pipeline

Pipeline commands are **staged linear pipelines**: entry routing → sequential phases → produce artifact → report completion.

Core characteristics:
- Mode is fixed at entry (create/revise/check), no runtime reshaping
- Each phase has explicit input/output contracts
- Implementation details delegated to workflow files (`Follow 'workflow/X.md' completely`)
- Self-contained — unaware of orchestrators (ralph, etc.)

### File Structure

```
---
frontmatter (name, description, argument-hint, allowed-tools, session-mode)
---

<required_reading>     <!-- session-mode: run MUST reference @~/.maestro/workflows/run-mode.md -->
<purpose>              <!-- Required -->
<required_reading>     <!-- Conditionally required: when command delegates to a workflow file -->
<deferred_reading>     <!-- Conditionally required: when command has lazily loaded templates -->
<context>              <!-- Required -->
  ### Pre-load          <!-- Standard subsection -->
  ### Role Knowledge    <!-- Standard subsection -->
<interview_protocol>   <!-- Conditionally required: when command has multi-round interactive decisions -->
<execution>            <!-- Required -->
<completion>           <!-- Required -->
<error_codes>          <!-- Required -->
<success_criteria>     <!-- Required -->
</output>              <!-- Closing tag -->
```

### Section Requirement Classification

| Level | Sections | Rule |
|-------|----------|------|
| **Required** | purpose, context, execution, completion, error_codes, success_criteria | Every pipeline command must have these |
| **Conditionally Required** | required_reading, deferred_reading, interview_protocol | Include when the trigger condition is met; omit when not applicable |

Every command MUST classify `session-mode` as one of:

- `run`: creates formal Session/Run artifacts and must use `maestro run create/check/complete`;
- `none`: stateless/project-level operation with no formal run artifacts;
- `bootstrap`: pre-Session bootstrap such as `maestro-init`;
- `deprecated`: retained only as an explicit migration route.

**Trigger conditions for conditionally required sections:**

| Section | Include when | Omit when |
|---------|-------------|-----------|
| `<required_reading>` | `session-mode: run` or command delegates to another workflow | Only stateless self-contained commands may omit it |
| `<deferred_reading>` | Command loads templates or references on-demand during execution | No lazy-loaded dependencies exist |
| `<interview_protocol>` | Command has **multi-round interactive decision trees** (scope → depth → dimensions, etc.) | Command only uses AskUserQuestion for simple one-shot confirmations (proceed/cancel, yes/no) |

**Interview protocol classification guide:**

| Usage pattern | Needs interview_protocol? | Example |
|---------------|--------------------------|---------|
| Multi-round decision tree with traversal order | **Yes** — full protocol with 6 strategy elements | analyze, brainstorm, grill, roadmap, blueprint, init |
| Version/option selection (1-2 questions, no tree) | **Lightweight** — declare decision points only, no traversal rules | milestone-release |
| Simple confirmation (proceed/cancel) | **No** — handled inline in `<execution>` | plan, execute, verify, milestone-audit, milestone-complete |

Section authoring rules are defined in § 2 below.

---

## 2. Section Specifications

### `<purpose>` — Goal and Positioning

State three things: **what it does**, **what it produces**, **where it sits in the pipeline**.

```markdown
<purpose>
Create, revise, or verify an execution plan through a 5-stage pipeline:
Exploration, Clarification, Planning, Plan Checking, and Confirmation.
Produces plan.json with waves, task definitions, and user-confirmed execution strategy.

Supports three modes:
- **Create** (default): Build plan from analysis context
- **Revise** (`--revise`): Incrementally modify existing plan
- **Check** (`--check`): Standalone plan verification

Formal output goes to the active Run returned by `maestro run create`: typed artifacts under `{run_dir}/outputs/`, evidence under `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`.
</purpose>
```

**Rules**:
- First paragraph: one-sentence summary + pipeline phase names
- Mode list: one line per mode, include trigger flag
- Output boundary: describe artifact kinds and their location inside the active Run; never invent a command-private Session directory
- Pipeline position: what is upstream, what is downstream (ASCII diagram or one sentence)
- No more than 15 lines

### `<required_reading>` — Startup Dependencies (Conditionally Required)

Include when the command delegates execution to a workflow file. Omit when the command is self-contained with all logic inline in `<execution>`.

Workflow files loaded immediately when the command starts. Use `@` prefix for absolute paths.

```markdown
<required_reading>
@~/.maestro/workflows/plan.md
</required_reading>
```

**Rules**:
- Only list files that must be read before command execution begins
- Keep to 1-3 files
- Use `@~/.maestro/workflows/` prefix for paths
- Omit this section entirely if the command has no external workflow dependency

### `<deferred_reading>` — Lazy Loading (Conditionally Required)

Include when the command loads templates or references on-demand during execution. Omit when no lazy-loaded dependencies exist.

```markdown
<deferred_reading>
- [plan.json](~/.maestro/templates/plan.json) — read when generating plan output
- [task.json](~/.maestro/templates/task.json) — read when generating task files
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
</deferred_reading>
```

**Rules**:
- Each entry annotates when it is triggered (`read when ...`)
- Link format: `[display name](path) — trigger condition`
- Omit this section entirely when there is nothing to defer

### `<context>` — Arguments and Environment

Input arguments, flags, and scope routing logic.

```markdown
<context>
$ARGUMENTS — phase number, or no args for milestone-wide, with optional flags.

**Flags:**
| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — skip interactive questions | false |
| `--from <source>` | Load upstream context (analyze:ANL-xxx, blueprint:BLP-xxx) | — |
| `--gaps` | Plan from verification gaps | — |

**Scope routing:**
| Input | Scope | Resolution |
|-------|-------|------------|
| numeric arg | phase | Resolve from roadmap |
| `--from analyze:ANL-xxx` | standalone | Direct artifact path |
| no args + roadmap | milestone | Current milestone |

### Pre-load

1. **Codebase docs**: IF `.workflow/codebase/doc-index.json` exists → Read ARCHITECTURE.md, FEATURES.md
2. **Specs**: `maestro spec load --category {category}` — load coding/arch/review constraints
3. **Wiki search**: `maestro wiki search "{phase keywords}" --json` → top 5-10 entries as context
4. All optional — proceed without if unavailable (log warning)

### Role Knowledge

1. Browse: `maestro wiki list --category {category}`
2. Select task-relevant entries from index
3. Load: `maestro wiki load <id1> [id2...]`
</context>
```

**Rules**:
- `$ARGUMENTS` on the first line describes positional arguments
- Flags use tables, not prose
- Scope routing uses tables or pseudocode with explicit priority order
- `### Pre-load` subsection: numbered steps, each with condition check + command + degradation handling
- `### Role Knowledge` subsection: standard three steps (browse → select → load)
- Pre-load category selection by command domain:
  | Command domain | spec category | wiki category |
  |----------------|---------------|---------------|
  | Analysis | arch | debug |
  | Planning | arch, coding | arch |
  | Execution | coding, ui (conditional) | coding |
  | Verification | review | review |
  | Brainstorming | arch | arch |

### `<interview_protocol>` — Interactive Decisions (Conditionally Required)

**When required**: Include when the command has **multi-round interactive decision trees** (e.g., scope → depth → dimensions). Omit when the command only uses AskUserQuestion for simple one-shot confirmations (proceed/cancel).

| Usage pattern | Section needed? | Format |
|---------------|-----------------|--------|
| Multi-round decision tree | **Full protocol** — 6 strategy elements | Reference standard + all elements |
| 1-2 option selections, no traversal | **Lightweight** — decision points only | Decision points + scope guard |
| Simple confirmation (yes/no) | **Not needed** — handle inline in `<execution>` | — |

Interview protocol has two layers: **interaction mechanics** (shared across commands) and **decision strategy** (unique per command).

#### Interaction Mechanics (Shared Standard)

The following rules apply to all commands with an interview_protocol. Commands reference this standard directly — no need to rewrite each rule inline:

**Format**: One decision per turn via AskUserQuestion, 2-4 options, first option marked `(Recommended)`. User can terminate or redirect at any time via `Other`.

**Search-first**: Before asking, attempt self-resolution (priority high to low):
1. Project state files: state.json, roadmap.md, project.md
2. Current session artifacts already produced
3. Knowledge base: `maestro spec load` / `maestro wiki search`
4. Codebase: Glob / Grep / Read
5. Open-ended exploration: `Agent(subagent_type: Explore)` / `maestro delegate --role explore`

Principle: **never ask what code or memory can answer**; never bounce your own ambiguity back to the user.

**Writeback cadence**: After each decision settles, **write to disk immediately** (target file specified by the command). Do not batch. Partial decisions must be on disk before the next question.

**Skip conditions**: Skip the entire interview in auto mode (`-y`/`--yes`), resume mode (`-c`/`--continue`), or when input is already unambiguous. Commands may append additional skip conditions.

**Decision table schema**: `| # | Decision | Choice | Source (user / code / default) |`

#### Decision Strategy (Command-Specific)

Each command only needs to declare the following elements in its `<interview_protocol>`:

| Element | Description | Example |
|---------|-------------|---------|
| **Interaction mode** | Convergent menu / adversarial Socratic / hybrid | `convergent menu-driven` |
| **Decision tree** | Decision points and traversal order | `scope → depth → dimensions → threshold` |
| **Traversal rules** | Strict order / allow jumps | `strict: do not open next branch until current settles` |
| **Scope guard** | What to decide, what NOT to prejudge | `only analyze; do not prejudge plan/execute` |
| **Writeback target** | Which file and section to write decisions to | `discussion.md top table + context.md` |
| **Additional search sources** | Data sources beyond the shared list | `issues.jsonl (for --gaps mode)` |
| **Additional skip conditions** | Skip conditions beyond the shared list | `--revise, --review` |
| **Exit condition** | When to end the interview | `all decision points settled` |

**Example usage in a command (convergent menu)**:

```markdown
<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (strict order): scope → depth → dimensions → Go/No-Go threshold
**Scope guard**: only analyze decisions; do not prejudge plan/execute concerns
**Writeback target**: discussion.md (top table) + context.md "Interview Decisions"
**Additional search sources**: issues.jsonl (--gaps mode), roadmap.md
**Additional skip conditions**: input is already specific (explicit phase number or unambiguous topic)
**Exit condition**: all decision points settled → finalize session metadata
</interview_protocol>
```

**Example usage in a command (adversarial mode, grill-specific)**:

```markdown
<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard,
but **overrides interaction mode to adversarial Socratic**.

**Interaction mode**: adversarial Socratic — NOT menu-driven
**Question style**:
  - Reference specific code: "The codebase uses `{symbol}` at `{file:line}` — your proposal calls it `{term}`. Which wins?"
  - Concrete scenarios: "What happens when {action} while {condition}?"
  - Challenge contradictions: immediately surface conflicts with code evidence or prior answers
  - Escalating depth: per branch basic → specific → adversarial
**Branch traversal** (depth-gated): Scope → Data Model → Edge Cases → Integration → Scale → Security → Observability → Migration
**Writeback target**: grill-report.md (Q&A append) + terminology.md (term crystallization)
**Exit condition**: all depth-selected branches fully walked → finalize report + context-package.json
</interview_protocol>
```

### `<execution>` — Execution Logic

Core structure: workflow reference + command-specific extensions.

```markdown
<execution>
### Pre-flight
{Checks before entering the pipeline}

Follow '~/.maestro/workflows/{name}.md' completely.

### {Command-specific extension 1}
{Only write logic not covered by the workflow file}

### {Command-specific extension 2}
{Same}
</execution>
```

**Rules**:
- `Follow 'workflow/X.md' completely` is the core delegation — the workflow file contains phase details
- Only write command-layer logic that the workflow file does not cover
- Extensions use `###` subsections with clear titles
- Do not repeat content already in the workflow file
- Pre-flight checks (e.g., `maestro collab preflight`) go before the workflow reference

**Typical extension types**:

| Type | Description | Example |
|------|-------------|---------|
| Agent constraint | Specific phases must/must not use Agent | P3 planning MUST spawn planner agent |
| Post-task inquiry | Knowledge capture after task completion | "Record as arch constraint?" |
| Issue sync | Bidirectional sync with issues.jsonl | task completion → issue status update |
| Mode routing | Entry points for special modes | `--gaps` → follow alternative workflow |

### `<completion>` — Completion Report

Separate from `<execution>`. Defines the command's output protocol after completion.

```markdown
<completion>
### Standalone report

```
=== {COMMAND_NAME} READY ===
{Key}: {value}
{Key}: {value}

Output:
  {artifact paths}

Next steps:
  /{next-command}     -- {description}
  /{alt-command}      -- {description}
```

### Ralph-invoked completion

Report completion via CLI (do not output text blocks):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}] [--concerns "..."]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| {condition_1} | `/{command_1}` |
| {condition_2} | `/{command_2}` |
</completion>
```

**Rules**:
- Standalone reports are wrapped with `=== X READY ===` or `=== X COMPLETE ===`
- Report template must include: artifact paths + next-step suggestions
- Ralph-invoked completion uses CLI calls only, no `--- COMPLETION STATUS ---` text blocks
- Next-step routing uses condition tables, covering all terminal states (success/partial/failure)
- Do not mix completion logic into `<execution>`

### `<error_codes>` — Error Code Table

Enumerate all foreseeable errors and warnings.

```markdown
<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No args and no roadmap | Provide phase number or create roadmap |
| E002 | error | Upstream artifact not found | Check artifact ID, verify state.json |
| W001 | warning | Wiki search unavailable | Continue without prior knowledge |
| W002 | warning | Collision detected with existing plan | Review and confirm scope |
</error_codes>
```

**Rules**:
- At least 2 errors + 1 warning
- Every error must have a Recovery (resolution advice)
- Error codes use `E0xx`, warning codes use `W0xx`
- Severity has only two levels: `error` and `warning`
- Cover the following scenarios:
  | Scenario | Example |
  |----------|---------|
  | Missing prerequisite | No roadmap, no plan, no artifacts |
  | Invalid input | Invalid phase number, unknown flag |
  | External dependency failure | CLI tool unavailable, delegate failed |
  | Quality gate failure | Checker found issues, coverage below threshold |
  | Degraded operation | Wiki/spec unavailable, partial context |

### `<success_criteria>` — Acceptance Checklist

Line-by-line verifiable completion standards.

```markdown
<success_criteria>
- [ ] `outputs/plan.json` written in the active Run with summary, approach, task_ids, and waves
- [ ] .task/TASK-*.json files created for each task
- [ ] Every task has `read_first[]` with at least the file being modified
- [ ] Every task has `convergence.criteria[]` with grep-verifiable conditions
- [ ] Plan-checker passed (or minor issues acknowledged)
- [ ] User confirmation captured (execute/modify/cancel)
- [ ] Artifact declared by contract and registered by `maestro run complete`
</success_criteria>
```

**Rules**:
- At least 5 items
- Each item must be **objectively verifiable** — determinable via file existence check, field non-empty check, or command exit code
- No subjective descriptions ("good code quality", "user is satisfied")
- Cover three categories:
  | Category | Verification method | Example |
  |----------|-------------------|---------|
  | Artifact existence | Glob / Read | plan.json, TASK-*.json exist |
  | Artifact quality | Field check | Every task has convergence.criteria[] |
  | State update | state.json check | Artifact registered |

---

## 3. Pre-load Context Pattern

Plan, Execute, and Verify share a similar pre-load pattern. Unified standard below:

### Standard Pre-load Steps

```
1. Codebase docs (structural context):
   IF .workflow/codebase/doc-index.json exists:
     Read ARCHITECTURE.md → module boundaries, integration points
     Read FEATURES.md → component mapping (if relevant)
   ELSE: log "W0xx: Codebase docs unavailable, continuing with code exploration only"

2. Knowledge specs (conventions + constraints):
   Bash("maestro spec load --category {category}")
   Category mapping: analyze→arch, plan→arch, execute→coding, verify→review
   Pass as constraints context to downstream agents

3. Wiki search (prior knowledge):
   keywords = extract 2-5 key terms from phase goal/title
   Bash("maestro wiki search '{keywords}' --json 2>/dev/null")
   IF exit code != 0 OR empty: log "W0xx: Wiki search unavailable"
   ELSE: extract top 5-10 entries as prior knowledge context

4. UI specs (conditional — only when task involves frontend):
   IF task scope contains UI keywords (component, page, style, layout, CSS, frontend):
     Bash("maestro spec load --category ui")
   ELSE: skip
```

### Per-command Tailoring

| Command | Step 1 | Step 2 | Step 3 | Step 4 |
|---------|--------|--------|--------|--------|
| analyze | ARCHITECTURE.md | arch | debug keywords | — |
| plan | ARCHITECTURE.md + FEATURES.md | arch, coding | phase goal | UI conditional |
| execute | ARCHITECTURE.md | coding | phase keywords | UI conditional |
| verify | ARCHITECTURE.md + FEATURES.md | review | "architecture constraint" | — |
| brainstorm | — | arch | topic keywords | — |
| roadmap | — | arch | requirement keywords | — |

Commands reference this standard in `<context> ### Pre-load` and annotate their tailoring — no need to rewrite the full procedure.

---

## 4. Depth Standard

Using `maestro-plan.md` (188 lines) as the depth benchmark. Every pipeline command should meet the following minimum depth:

### Minimum Requirements

**Required sections** (every pipeline command):

| Section | Min lines | Min entries | Must cover |
|---------|-----------|-------------|------------|
| `<purpose>` | 5 | — | Goal + modes + output path |
| `<context>` | 15 | Flags table + scope routing | Arguments, flags, Pre-load, Role Knowledge |
| `<execution>` | 5 | Workflow ref or inline logic + ≥1 extension | Core logic + command-specific extensions |
| `<completion>` | 10 | 2 modes | Standalone report + ralph CLI + next-step routing |
| `<error_codes>` | 4 | ≥2 error + ≥1 warning | Prerequisite + degradation |
| `<success_criteria>` | 5 | ≥5 items | Artifact existence + quality + state update |

**Conditionally required sections** (when trigger condition is met):

| Section | Min lines | Min entries | Must cover |
|---------|-----------|-------------|------------|
| `<required_reading>` | 1 | 1 file | Primary workflow file |
| `<deferred_reading>` | 2 | 1 entry with trigger | Template/reference + "read when ..." |
| `<interview_protocol>` (full) | 8 | 6 strategy elements | Interaction mode + decision tree + scope guard + writeback target + exit condition |
| `<interview_protocol>` (lightweight) | 4 | Decision points list | Decision points + scope guard |

### Signs of Insufficient Depth

| Signal | Problem | Fix |
|--------|---------|-----|
| `<execution>` only has "Follow workflow X" | Missing command-specific constraints | Add Pre-flight / Agent constraints / Post-task |
| No `<error_codes>` | Error scenarios not enumerated | Cover at least missing prerequisites + dependency failures |
| No `<success_criteria>` | Ralph cannot judge completion quality | List grep/file-check verifiable acceptance items |
| No `<completion>` | Completion protocol unclear | Add standalone report + ralph CLI |
| `<context>` has no Pre-load | Missing knowledge context | Follow § 3 standard |

---

## 5. Anti-Patterns

| Anti-Pattern | Correct |
|---|---|
| `<execution>` only says "Follow workflow X" with nothing else | Add at least Pre-flight + command-specific extensions + separate completion |
| interview_protocol copies 50-line boilerplate | Reference this standard, write only 6 strategy elements (or lightweight variant) |
| Adding interview_protocol for simple yes/no confirmations | Only add for multi-round decision trees; simple confirmations go inline in `<execution>` |
| Omitting canonical Run reference | Every `session-mode: run` command includes `@~/.maestro/workflows/run-mode.md`; add other workflow refs as needed |
| Pre-load rewritten step-by-step in every command | Reference § 3 standard, annotate tailoring |
| Completion logic mixed into `<execution>` | Separate into `<completion>` section |
| error_codes / success_criteria missing | Every command must have them, even at minimum |
| `<purpose>` is a single sentence | Cover at least goal + modes + output path |
| Command repeats workflow file phase details | Command only writes extensions not in the workflow |
| Scope routing described in prose with implicit priority | Use tables or pseudocode with explicit priority order |
| Interview decision tree buried in prose | List decision points independently, state traversal order |
| success_criteria contains subjective descriptions | Every item must be objectively verifiable |

---

## 6. Pipeline vs FSM Decision Guide

| Choose Pipeline | Choose FSM |
|-----------------|------------|
| Linear phases (N phases executed sequentially) | 10+ states with multi-path branching |
| 1-3 modes, routed at entry then each runs independently | Runtime decisions reshape subsequent path |
| Self-contained, no cross-command handoff | Bidirectional handoff (A ↔ B loop) |
| Artifact written once | Per-step precise PERSIST, 20+ fields with cross-references |
| Simple re-entry (`-c` resume session) | Arbitrary step resumption, steps[] grow/shrink at runtime |

The two styles are complementary: FSM orchestrators invoke pipeline commands; pipeline commands are unaware of orchestrators.

### Current Command Classification

| Style | Commands |
|-------|----------|
| **Pipeline** | init, analyze, plan, execute, verify, brainstorm, grill, blueprint, roadmap, milestone-audit, milestone-complete, milestone-release |
| **FSM** | ralph, ralph-execute |
| **Needs evaluation** | coordinate (multi-role handoff may need FSM) |

---

## 7. Workflow File Authoring

Workflow files (`workflows/*.md`) are the **implementation** behind pipeline commands. A command file says `Follow 'workflow/X.md' completely` — the workflow file contains the actual phase-by-phase procedure, pseudocode, agent prompts, and internal logic.

### Content Boundary: Command vs Workflow

**Scope note**: this matrix applies when a dedicated command file exists for the workflow. First-tier steps (paired `prepare/<step>.md` + `workflows/<step>.md` with no dedicated command file) place error codes, success criteria, and completion content in the workflow file instead — see the prepare/workflow authoring spec.

| Content | Owned by | Rationale |
|---------|----------|-----------|
| Error code registry (`<error_codes>`) | **Command** | Command is the contract surface |
| Success criteria checklist | **Command** | Completion validation owned by caller |
| Completion report format | **Command** | `<completion>` section owns output protocol |
| Interview decision strategy | **Command** | `<interview_protocol>` owns the decision tree |
| Pre-load context pattern | **Command** | `<context> ### Pre-load` references § 3 |
| Phase-by-phase procedures | **Workflow** | Detailed execution steps with pseudocode |
| Agent spawn prompts | **Workflow** | Full prompt templates for sub-agents |
| Scope resolution logic | **Workflow** | Pseudocode priority cascade |
| Behavioral guards (Iron Law, Red Flags) | **Workflow** | Runtime constraints for agents |
| Output schemas (JSON) | **Workflow** | jsonc blocks for artifact formats |
| Internal quality gates | **Workflow** | Execution-time checks beyond success_criteria |
| State field writes | **Workflow** | Detailed index.json/state.json updates |
| Flag definitions | **Both** | Command = table; Workflow = implementation |
| Next-step routing | **Both** | Command = condition table; Workflow = implementation |
| Pipeline position diagram | **Both** | Command = brief in `<purpose>`; Workflow = full ASCII diagram |

**Principle**: The command file is the **contract** (what, when, error codes, success criteria); the workflow file is the **implementation** (how, step-by-step, pseudocode, agent prompts).

### File Structure

```
# Workflow: {Name}
{1-3 line summary: purpose + output + key constraint}

---

## Behavioral Guards              ← Iron Law, Red Flags, Forbidden Wording (if applicable)
## Prerequisites                  ← Required upstream artifacts (if applicable)
## Architecture                   ← ASCII pipeline diagram (if multi-mode)
## Parameters                     ← Flags/arguments table
## Scope Resolution               ← Input routing pseudocode
## Output Artifacts               ← Directory tree / file list (if 3+ output files)

---

## {Phase 1}: {Title}             ← Core pipeline phases (sequential)
## {Phase 2}: {Title}
## ...
## {Phase N}: {Title}

---

## Mode: {Name} ({--flag})        ← Alternate modes as trailing sections (if applicable)
## ...

---

## Quality Gates                  ← Internal quality checks (if applicable)
## Error Handling                 ← Error table OR reference to command file
## State Updates                  ← State field writes (if applicable)
```

### Section Rules

#### H1 Title + Opening Summary

```markdown
# Workflow: {Name}

5-phase pipeline: Context Collection → Clarification → Planning → Plan Checking → Confirmation.
Produces `outputs/plan.json` + `outputs/tasks/TASK-{NNN}.json` in the active Run.
```

- H1 format: `# Workflow: {Name}` (standardized across all workflow files)
- Opening summary: exactly 1-3 lines — purpose, output, key constraint
- `---` horizontal rule after summary, and between every H2 section

#### Behavioral Guards (conditionally required)

For high-stakes workflows (execute, verify) that need anti-hallucination or anti-shortcut enforcement:

```markdown
## Iron Law
Never mark a task as complete unless the convergence criteria are met.

## Red Flags
- Empty catch blocks, @ts-ignore, `as any` → stop, fix the root cause
- Test file has 0 assertions → invalid, rewrite
- "Aligned X with Y" without concrete change → reject
```

Required when: workflow agents can hallucinate success, skip verification, or hide errors.

#### Prerequisites

```markdown
## Prerequisites
- None for standalone operation (state.json auto-bootstraps)
- For milestone/phase scope: init + roadmap required
```

Required when: workflow depends on upstream artifacts or commands.

#### Parameters

Always use table format. Title: `## Parameters` (not "Flag Processing", "Arguments", or "Input").

```markdown
## Parameters

| Flag | Effect | Default |
|------|--------|---------|
| `--collab` | Use collaborative multi-planner mode in P3 | false |
| `--gaps` | Plan from verification gaps, skip P1 exploration | false |
| `--tdd` | Generate RED-GREEN-REFACTOR triplet tasks | false |
```

#### Scope Resolution

Always use pseudocode in fenced code blocks with explicit priority numbering:

```markdown
## Scope Resolution

```
Resolution priority (highest to lowest):
  1. --from analyze:ANL-xxx → CONTEXT_DIR = artifact path, scope = "standalone"
  2. --dir <path> → CONTEXT_DIR = path, scope from state.json
  3. numeric arg → scope = "phase", resolve from roadmap
  4. no args + roadmap → scope = "milestone"
  5. no args + no roadmap → ERROR E001
```
```

Never use prose paragraphs for scope resolution — pseudocode makes priority order unambiguous.

#### Output Artifacts (conditionally required)

When the workflow produces 3+ output files, document the directory structure:

```markdown
## Output Artifacts

```
{run_dir}/
  report.md                    ← Human narrative + handoff frontmatter
  outputs/
    plan.json                  ← Plan overview with _meta + task_ids[], waves[]
    tasks/
      TASK-001.json            ← Individual task definition
      TASK-002.json
  evidence/
    exploration-arch.json      ← Agent exploration results
```
```

#### Phase Sections (core content)

**Phase naming convention**:

| Pattern | When to use | Example |
|---------|-------------|---------|
| `{Letter}{N}: {Title}` | Core pipeline trio (plan/execute/verify) — they cross-reference each other | `P1: Context Collection`, `E2: Wave Parallel Execution`, `V1: Goal-Backward Verification` |
| `Step {N}: {Title}` | All other workflows | `Step 1: Parse & Route`, `Step 4: Branch Walking` |
| Fractional numbering | Interstitial phases in any workflow | `P4.5: Collision Detection`, `Step 2.5: Terminology Alignment` |

**Phase internal structure**:
- Use numbered steps within each phase
- Sub-steps use decimal notation: `4.1`, `4.2`, `5b`
- Pseudocode in fenced code blocks for conditional logic and loops
- Agent spawn blocks use `Agent()` pseudocode with full prompt templates
- Data mappings use tables, not prose

#### Alternate Modes (conditionally required)

When a workflow supports `--revise`, `--review`, `--check`, or similar alternate modes:

```markdown
## Mode: Revise (--revise)

### Plan Discovery
Resolve which existing plan to revise via --dir or latest artifact lookup.

### Execution Flow
1. Load existing plan.json
2. Obtain revision instructions (user or --revise arg)
3. Spawn planner agent with existing plan + instructions
4. Re-run P4 checker
5. Update artifact in state.json
```

- Place alternate modes as trailing H2 sections **after** the main pipeline phases
- Heading format: `## Mode: {Name} ({--flag})`
- Do not embed alternate mode logic inline within main pipeline phases

#### Error Handling

```markdown
## Error Handling

| Error | Condition | Recovery |
|-------|-----------|----------|
| E001 | No roadmap and no --dir | Provide phase number or create roadmap |
| E004 | Planner agent returned empty plan | Retry with expanded context |
| Runtime | Agent timeout | Retry once, then mark task failed |
```

- Use table format matching the command file's `<error_codes>` schema
- At minimum, reference the command file's error codes
- Add workflow-specific runtime errors not covered by the command

#### Quality Gates (conditionally required)

Workflow-internal quality checks that run during execution (distinct from command's `<success_criteria>` which validates after completion):

```markdown
## Quality Gates

- [ ] Every task has `convergence.criteria[]` with grep-verifiable conditions
- [ ] No task `action` contains vague language ("align", "ensure", "improve")
- [ ] Plan confidence score ≥ 70 before proceeding to confirmation
```

Use "Quality Gates" naming to avoid confusion with command's "success_criteria".

#### State Updates (conditionally required)

When the workflow writes to index.json or state.json:

```markdown
## State Updates

| When | Field | Value |
|------|-------|-------|
| P5 completion | Run `outputs/plan.json` | Runtime registers the sealed plan artifact |
| P5 completion | index.json.status | "confirmed" |
| Collision detected | index.json.collisions[] | Colliding file paths |
```

### Formatting Rules

| Element | Format | Example |
|---------|--------|---------|
| Section separators | `---` between every H2 section | Universal |
| Flags/parameters | Table with Flag / Effect / Default columns | `## Parameters` |
| Scope resolution | Pseudocode in fenced code block | Numbered priority cascade |
| Agent spawn prompts | `Agent()` pseudocode with structured prompt | Full template inline |
| Output schemas | `jsonc` code blocks with annotation comments | verification.json, context-package.json |
| Report templates | Plain code blocks with `{placeholder}` variables | Completion report format |
| Anti-patterns / traps | Bullet list | Red Flags section |
| Next-step routing | Condition → suggestion table | Post-pipeline routing |

### Depth Calibration

Workflow depth correlates with interactivity, multi-agent orchestration, and mode count:

| Workflow type | Expected lines | Characteristics |
|---------------|---------------|-----------------|
| Interactive (discussion loops, feedback rounds) | 400-800 | analyze, brainstorm, grill |
| Multi-agent (parallel spawning, cross-agent synthesis) | 400-700 | execute, brainstorm |
| Multi-mode (3+ execution paths) | 400-600 | plan (create/revise/check/tdd) |
| Standard (single linear pipeline) | 200-400 | blueprint, roadmap |
| Procedural/operational (archive, audit, release) | 100-200 | milestone-audit, milestone-complete |

A workflow under 100 lines likely belongs inline in the command file rather than as a separate file.

### Shared Logic Extraction

When 2+ workflow files share procedural logic, extract to a `{name}-common.md` companion:

```
roadmap.md         → imports shared logic from roadmap-common.md
roadmap-common.md  → shared scope routing, milestone resolution, state updates
```

- Primary workflow delegates with `Follow '{name}-common.md' § {Section}` pattern
- Common file uses the same H2 section structure as regular workflows
- Only extract when duplication is ≥30 lines across 2+ files

### Workflow Anti-Patterns

| Anti-Pattern | Correct |
|---|---|
| Duplicating command's error_codes or success_criteria | Workflow adds runtime errors only; command owns the registry |
| Embedding completion report format | Completion format belongs in command's `<completion>` |
| Defining interview decision strategy | Decision tree belongs in command's `<interview_protocol>` |
| Omitting Parameters / Scope Resolution sections | Always include — readers should not need the command file for basic routing |
| Prose paragraphs for scope resolution | Use pseudocode with numbered priority levels |
| Inline alternate modes within main pipeline phases | Place as trailing `## Mode: {Name}` sections |
| "Quality Criteria" naming | Use "Quality Gates" to avoid collision with command's success_criteria |
| No `---` separators between H2 sections | Always separate for visual parsing |
| H1 title inconsistency ("X Workflow" vs "Workflow: X") | Standardize on `# Workflow: {Name}` |
| Workflow under 100 lines as separate file | Inline into the command file instead |
