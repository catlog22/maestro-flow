---
name: maestro-grill
description: Use when stress-testing a plan, idea, or requirement against codebase reality before brainstorming
argument-hint: <topic|plan> [-y] [-c] [--from <source>] [--depth shallow|standard|deep]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - replace_file_content
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
Socratic stress-testing of a plan, idea, or requirement against codebase reality. Walks every branch of the decision tree one question at a time — challenging vague terminology against existing code, probing edge cases with concrete scenarios, and verifying assumptions with code evidence. Produces a verified context package (grill-report.md + terminology.md + context-package.json) for downstream brainstorm/analyze/roadmap consumption.

Positioned BEFORE brainstorm in the pipeline: grill stress-tests and sharpens; brainstorm generates and elaborates.
</purpose>

<required_reading>
@~/.maestro/workflows/grill.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
</deferred_reading>

<context>
$ARGUMENTS -- topic/plan text for interactive mode, or --from source for upstream input.

**Mode selection:**
- **Interactive mode** (default): Topic text triggers full Socratic grilling with user Q&A
- **Auto mode** (`-y`): Code exploration answers questions instead of the user
- **Resume mode** (`-c` or `--session ID`): Continue from a previous grill session

**Flags:**

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — CLI exploration replaces human answers | `false` |
| `-c` / `--continue` | Resume from last grill session | — |
| `--session ID` | Resume specific session | — |
| `--depth shallow\|standard\|deep` | Branch count 3/5/8 | `standard` |
| `--from <source>` | Load upstream material (`blueprint:ID`, `@file`, or path) | — |

**Output directory**: `.workflow/scratch/{YYYYMMDD}-grill-{slug}/`
**Produced files**: `grill-report.md`, `terminology.md`, `context-package.json`

### Pre-load

1. **Specs**: `maestro spec load --category arch` — load architecture constraints
2. **Wiki search**: `maestro wiki search "{topic keywords}"` → load relevant entries before grilling
3. All optional — proceed without if unavailable
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode override**: adversarial Socratic — NOT menu-driven
**Question style**:
  - Reference specific code: "The codebase uses `{symbol}` at `{file:line}` — your proposal calls it `{term}`. Which wins?"
  - Concrete scenarios: "What happens when {action} while {condition}?"
  - Challenge contradictions: immediately surface conflicts with code evidence or prior answers
  - Escalating depth: per branch basic → specific → adversarial
**Branch traversal** (depth-gated, --depth controls count): Scope & Boundaries → Data Model & State → Edge Cases & Failure Modes → Integration & Dependencies → Scale & Performance → Security & Access Control → Observability & Operations → Migration & Rollback
**Writeback target**: grill-report.md (Q&A append per question) + terminology.md (term crystallization)
**Additional skip conditions**: none beyond standard (-y, -c)
**Exit condition**: all depth-selected branches fully walked → finalize report + context-package.json
</interview_protocol>

<execution>
Follow '~/.maestro/workflows/grill.md' completely.
</execution>

<completion>
### Standalone report

```
=== GRILL READY ===
Topic: {topic}
Branches walked: {count}/{depth_target}
Decisions locked: {locked_count}
Open risks: {risk_count}
Output: {output_dir}
Artifact: GRL-{id}
=== END GRILL ===
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Need multi-role elaboration | `view_file(AbsolutePath="<agy-skills-dir>/maestro-brainstorm/SKILL.md") + execute inline (args: "{topic} --from grill:{artifact_id}")` |
| Need deep technical analysis | `view_file(AbsolutePath="<agy-skills-dir>/maestro-analyze/SKILL.md") + execute inline (args: "{topic} --from grill:{artifact_id}")` |
| Scope is clear, ready for roadmap | `view_file(AbsolutePath="<agy-skills-dir>/maestro-roadmap/SKILL.md") + execute inline (args: "--from grill:{artifact_id}")` |
| Need formal spec package | `view_file(AbsolutePath="<agy-skills-dir>/maestro-blueprint/SKILL.md") + execute inline (args: "--from grill:{artifact_id}")` |
| More branches to walk | `view_file(AbsolutePath="<agy-skills-dir>/maestro-grill/SKILL.md") + execute inline (args: "{topic} -c")` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No topic/plan and no --from/--continue flag | Prompt user for topic text |
| E002 | error | --session ID not found | Show available sessions |
| W001 | warning | Codebase scan failed or returned empty | Continue without code grounding, note limitation |
| W002 | warning | CLI exploration timeout in auto mode | Skip question, mark as open |
| W003 | warning | Max branch depth reached without resolution | Force synthesis, offer continuation |
</error_codes>

<success_criteria>
- [ ] Interactive mode: all depth-selected branches walked (shallow=3, standard=5, deep=8)
- [ ] Each branch has >= 2 question-answer pairs with evidence or explicit user input
- [ ] `grill-report.md` written with Branch Log table, all Q&A entries, synthesis section
- [ ] `terminology.md` written with >= 5 terms, code references where applicable
- [ ] Every locked decision has evidence (code reference or explicit user confirmation)
- [ ] Contradictions between answers and code surfaced and resolved (or logged as risks)
- [ ] Risk register captures all unresolved tensions
- [ ] `context-package.json` generated with schema "context-package/1.0"
- [ ] Artifact registered in state.json (type=grill, id=GRL-xxx)
- [ ] Session sealed via finish-work
</success_criteria>

<on_complete>
@~/.maestro/workflows/finish-work.md — SESSION_DIR={output_dir}, SESSION_TYPE=grill, SESSION_ID={artifact_id}, LINKED_MILESTONE=null
</on_complete>
