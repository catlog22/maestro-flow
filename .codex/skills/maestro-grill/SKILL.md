---
name: maestro-grill
description: Use when stress-testing a plan, idea, or requirement against codebase reality before brainstorming
argument-hint: "<topic|plan> [-y] [-c] [--from <source>] [--depth shallow|standard|deep]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<purpose>
Socratic stress-testing of a plan, idea, or requirement against codebase reality. Walks every branch of the decision tree one question at a time — challenging vague terminology against existing code, probing edge cases with concrete scenarios, and verifying assumptions with code evidence. Produces a verified context package (grill-report.md + terminology.md + context-package.json) for downstream brainstorm/analyze/roadmap consumption.

Positioned BEFORE brainstorm in the pipeline: grill stress-tests and sharpens; brainstorm generates and elaborates.

Codex specifics:
- **No agent spawning** — codebase exploration runs directly via Glob/Grep/Read in coordinator context.
- **request_user_input** replaces request_user_input for Socratic Q&A.
- **CLI delegation** for auto mode: `exec_command("maestro delegate ... --role analyze --mode analysis")`.
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
- `-y` / `--yes`: Auto mode — CLI exploration replaces human answers
- `-c` / `--continue`: Resume from last grill session
- `--session ID`: Resume specific session
- `--depth shallow|standard|deep`: Branch count 3/5/8 (default: standard)
- `--from <source>`: Load upstream material (`blueprint:ID`, `@file`, or path)

**Output directory**: `.workflow/scratch/{YYYYMMDD}-grill-{slug}/`
**Produced files**: `grill-report.md`, `terminology.md`, `context-package.json`

### Role Knowledge
`maestro search "{topic keywords}"` → load relevant entries before grilling.
`maestro spec load --category arch` → load architecture constraints.
</context>

<interview_protocol>
Grill the user relentlessly until every branch of the decision tree is walked. This is NOT a menu-driven interview — it is adversarial Socratic questioning. Active only in interactive mode; skip when `-y/--yes` or `-c/--continue`.

Core protocol:
- **One question per turn**. Each question probes ONE specific aspect. Never ask compound questions.
- **Code-grounded**: Before asking, search the codebase for evidence. Use findings to sharpen the question or challenge the user's answer. Never ask what code can verify — search first, then confront.
- **Escalating depth**: Start with scope boundaries, progress to data model, edge cases, failure modes. Each branch goes basic → specific → adversarial.
- **Immediate writeback**: After each answered question, immediately append the Q&A + decision to `grill-report.md`. Do NOT batch — partial progress must be on disk before the next question.
- **Challenge contradictions**: If an answer conflicts with code evidence or a prior answer, immediately surface the contradiction and demand resolution.
- **Terminology enforcement**: When the user uses a term that conflicts with codebase naming, challenge it immediately. Propose the code-consistent alternative. Update `terminology.md` as terms crystallize.

Question framing rules:
- Reference specific code findings: "The codebase uses `{symbol}` at `{file:line}` — your proposal calls it `{term}`. Which wins?"
- Use concrete scenarios: "What happens when a user does {action} while {condition} is true?"
- Probe boundaries: "You said {X} is in scope — does that include {edge_case}, or is that separate?"
- Challenge scale: "This touches `{table}` — at 10x current data volume, which query breaks first?"

Branch walking order: Scope & Boundaries → Data Model & State → Edge Cases & Failure Modes → Integration & Dependencies → Scale & Performance → Security & Access Control → Observability & Operations → Migration & Rollback. Number of branches determined by `--depth`.

Exit: When all depth-selected branches are fully walked (every question answered or explicitly deferred), finalize the report and generate context-package.json.
</interview_protocol>

<execution>
Follow '~/.maestro/workflows/grill.md' completely.

**Next-step routing on completion:**

Standard routing:
- Need multi-role elaboration → `$maestro-brainstorm "{topic}" --from grill:{artifact_id}`
- Need deep technical analysis → `$maestro-analyze "{topic}" --from grill:{artifact_id}`
- Scope is clear, ready for roadmap → `$maestro-roadmap --from grill:{artifact_id}`
- Need formal spec package → `$maestro-blueprint --from grill:{artifact_id}`

Resume routing:
- More branches to walk → `$maestro-grill "{topic}" -c`
</execution>

<invariants>
1. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation.
2. **Code-grounded questions required** — grill questions MUST reference specific code (file:line) when challenging the user's proposal. Generic questions without code grounding are INVALID. If codebase scan failed, flag ALL locked decisions as LOW CONFIDENCE.
3. **Artifact verification before completion** — verify grill-report.md (with Branch Log + Q&A + synthesis), terminology.md (≥5 terms), and context-package.json all exist before reporting completion. If any missing: DO NOT report completion.
</invariants>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No topic/plan and no --from/--continue flag | Prompt user for topic text |
| E002 | error | --session ID not found | Show available sessions |
| W001 | warning | Codebase scan failed or returned empty | Retry once. If still fails: flag ALL subsequent locked decisions as LOW CONFIDENCE |
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
