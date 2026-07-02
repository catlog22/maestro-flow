---
name: learn-second-opinion
description: Get alternative perspectives — review, challenge, or consult
argument-hint: "<target> [--mode review|challenge|consult] [-y]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Structured second-opinion on code, decisions, or plans via three modes: review (3 parallel agents),
challenge (adversarial), or consult (interactive Q&A). Findings persist to learnings.md.
</purpose>

<context>
$ARGUMENTS — target and optional mode flag.

**Target resolution** (auto-detected):
| Input | Resolution |
|-------|-----------|
| File path | Read file content |
| Wiki ID (`<type>-<slug>`) | `maestro wiki get <id>` |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | Resolve via state.json.artifacts[] → plan.json |

**Flags**:
- `--mode review|challenge|consult` (default: review)
- `-y`: Skip confirmation prompts for knowhow/spec writes

**Pre-load** (optional): `Skill("spec-load")` for conventions + `maestro search "<target topic>"` for related entries.

**Output**: `.workflow/knowhow/KNW-opinion-{slug}-{YYYY-MM-DD}.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-opinion-{slug}-{YYYY-MM-DD}.md` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — NEVER modify source code, wiki entries, or plan files under review; all writes go to `.workflow/` only
2. **Agent independence** — in review mode, each of the 3 agents (Pragmatist/Purist/Strategist) MUST operate independently without shared state; NEVER pass one agent's findings to another
3. **Evidence-backed verdicts** — every finding MUST include a `location` reference (file:line or section); ungrounded opinions SHALL NOT appear in the report
4. **Mode contract** — MUST execute exactly the mode specified (review/challenge/consult); NEVER mix mode behaviors within a single execution
5. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
6. **Confirmation gate** — unless `-y` is set, MUST present findings and target files via AskUserQuestion before any writes
</invariants>

<state_machine>

<states>
S_RESOLVE    — 解析 target                          PERSIST: —
S_CONTEXT    — 加载 specs/wiki 上下文                PERSIST: —
S_EXECUTE    — 按 mode 执行分析                      PERSIST: —
S_SYNTHESIZE — 综合观点、生成报告                     PERSIST: outputs
S_PERSIST    — 写文件、append .workflow/specs/learnings.md      PERSIST: knowhow files
</states>

<transitions>

S_RESOLVE:
  → S_CONTEXT     WHEN: target resolved                DO: read target content
  → S_RESOLVE     WHEN: unresolvable                   DO: AskUserQuestion for clarification

S_CONTEXT:
  → S_EXECUTE     DO: load specs + wiki search (optional, proceed without)

S_EXECUTE:
  → S_SYNTHESIZE  WHEN: mode == review                 DO: A_REVIEW
  → S_SYNTHESIZE  WHEN: mode == challenge              DO: A_CHALLENGE
  → S_SYNTHESIZE  WHEN: mode == consult                DO: A_CONSULT

S_SYNTHESIZE:
  → S_PERSIST     DO: merge perspectives → agreements, disagreements, verdict, top 3 recommendations

S_PERSIST:
  → END           GATE: unless -y, AskUserQuestion showing files to write and spec-entries to append — proceed only on confirm
                  DO: write KNW-opinion + append <spec-entry> blocks to .workflow/specs/learnings.md

</transitions>

<actions>

### A_REVIEW
Spawn 3 Agents in single message:

| Agent | Focus | Question |
|-------|-------|----------|
| Pragmatist | simplicity, YAGNI, maintenance | "Simplest thing that works? Maintenance burden?" |
| Purist | correctness, edge cases, type safety | "What assumptions can be violated?" |
| Strategist | scalability, architecture alignment | "Supports future growth? Fits architecture?" |

Each returns: persona, verdict (approve/concern/reject), confidence, findings[{severity, description, location, suggestion}], summary.

### A_CHALLENGE
Spawn 1 adversarial Agent:
- Find weakest assumption
- Propose concrete breaking scenario
- Identify single biggest risk
- Suggest alternative approach
- Apply forcing questions: "What invalidates this?", "Simplest thing that breaks this?", "What would you regret in 6 months?", "What implicit contract isn't enforced?"

### A_CONSULT
Interactive loop:
1. Agent studies target
2. Display "Target loaded. What would you like to know?"
3. AskUserQuestion → Agent answers with code refs → repeat until "done"
4. Compile Q&A into report

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No target provided | Prompt user for target (path, wiki ID, HEAD, staged, or phase) |
| E002 | Unknown --mode value | Use: review, challenge, or consult |
| E003 | Target resolution failed — path not found, wiki ID invalid, or no staged changes | Check target exists |
| W001 | One review agent failed | Proceed with available perspectives |
| W002 | Specs/wiki pre-load unavailable | Proceed without convention context; note reduced coverage |
</error_codes>

<success_criteria>
- [ ] Mode executed: review (3 parallel agents) / challenge (adversarial) / consult (interactive Q&A)
- [ ] Synthesis with agreements, disagreements, verdict
- [ ] Report written + findings appended to .workflow/specs/learnings.md
</success_criteria>

<next_step_routing>
- Create issue → `/manage-issue create <description>`
- Decompose patterns → `/learn-decompose <path>`
- Follow code → `/learn-follow <path>`
</next_step_routing>
