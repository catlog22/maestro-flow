---
name: learn-investigate
description: Investigate questions with hypothesis testing and evidence logging
argument-hint: "<question> [--scope <path>] [--max-hypotheses N] [-y]"
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
Systematic investigation for understanding questions (not bug-fixing).
4-phase scientific method with scope lock, 3-strike escalation, and evidence persistence.
</purpose>

<context>
$ARGUMENTS — question text and optional flags.

**Flags**:
- `--scope <path>`: Restrict to files under this dir (default: entire project)
- `--max-hypotheses N`: Max hypotheses before escalation (default: 3)
- `-y`: Skip confirmation prompts for report/spec writes

**Storage write**:
- `.workflow/knowhow/KNW-investigate-{slug}/evidence.ndjson` — structured evidence (one JSON line per item)
- `.workflow/knowhow/KNW-investigate-{slug}/understanding.md` — evolving understanding
- `.workflow/knowhow/KNW-investigate-{slug}/report.md` — final report
- `.workflow/specs/learnings.md` — appended `<spec-entry>` blocks

**Storage read**: source files in scope + `maestro search` + `.workflow/specs/learnings.md` + `debug-notes.md` + `codebase/architecture.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-investigate-{slug}/` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only investigation** — NEVER modify source code files; all writes go to `.workflow/` only
2. **Evidence append-only** — `evidence.ndjson` MUST be appended line-by-line; NEVER overwrite or truncate existing evidence entries
3. **Scope lock** — once `--scope` is resolved in S_FRAME, NEVER expand search scope without explicit user confirmation via S_ESCALATE
4. **Hypothesis cap** — MUST NOT generate more than `--max-hypotheses` (default 3) before triggering escalation; NEVER silently exceed the cap
5. **Structured evidence format** — every evidence entry MUST include `{ts, type, source, relevance, content, note}`; incomplete entries SHALL NOT be appended
6. **3-strike escalation** — after all hypotheses fail, MUST escalate to user via AskUserQuestion; NEVER silently conclude as INCONCLUSIVE without user interaction
7. **Confirmation gate** — unless `-y` is set, MUST present report.md path and spec-entries via AskUserQuestion before final writes
</invariants>

<state_machine>

<states>
S_FRAME          — 解析问题、确定 scope、搜索先验知识          PERSIST: understanding.md (initial)
S_EVIDENCE       — 系统收集证据                                PERSIST: evidence.ndjson
S_PATTERN        — 比对已知模式                                PERSIST: understanding.md (patterns)
S_HYPOTHESIZE    — 生成假设列表                                PERSIST: understanding.md (hypotheses)
S_CLI_EXPLORE    — CLI 辅助探索（可选）                         PERSIST: evidence.ndjson (append)
S_TEST           — 逐假设测试                                  PERSIST: evidence.ndjson + understanding.md
S_ESCALATE       — 3-strike 升级                               PERSIST: —
S_REPORT         — 综合报告 + persist                          PERSIST: report.md + .workflow/specs/learnings.md
</states>

<transitions>

S_FRAME:
  → S_EVIDENCE    DO: A_FRAME_QUESTION

S_EVIDENCE:
  → S_PATTERN     DO: A_COLLECT_EVIDENCE

S_PATTERN:
  → S_HYPOTHESIZE DO: match evidence against debug-notes.md + .workflow/specs/learnings.md patterns

S_HYPOTHESIZE:
  → S_CLI_EXPLORE WHEN: CLI tools enabled (at least one tool in cli-tools.json enabled) AND hypotheses non-trivial (require cross-file tracing or data-flow analysis)    DO: A_FORM_HYPOTHESES
  → S_TEST        WHEN: no CLI tools OR trivial hypotheses (answerable by local Grep/Read)    DO: A_FORM_HYPOTHESES

S_CLI_EXPLORE:
  → S_TEST        DO: A_CLI_SUPPLEMENT (maestro delegate --to <first-enabled-tool> --mode analysis, run_in_background, STOP)

S_TEST:
  → S_REPORT      WHEN: hypothesis confirmed                  DO: A_TEST_HYPOTHESIS
  → S_REPORT      WHEN: all hypotheses tested (some confirmed) DO: A_TEST_HYPOTHESIS
  → S_ESCALATE    WHEN: max_hypotheses all failed              DO: A_TEST_HYPOTHESIS

S_ESCALATE:
  → S_HYPOTHESIZE WHEN: user broadens scope or provides new hypothesis   DO: AskUserQuestion
  → S_REPORT      WHEN: user selects "Escalate" or still stuck          DO: mark INCONCLUSIVE

S_REPORT:
  → END           GATE: unless -y, AskUserQuestion showing report.md path and spec-entries to append — proceed only on confirm
                  DO: A_SYNTHESIZE_REPORT

</transitions>

<actions>

### A_FRAME_QUESTION

1. Parse question, generate slug, create KNW-investigate-{slug}/
2. Search prior knowledge: `maestro search "<question>"` + search .workflow/specs/learnings.md + read debug-notes.md
3. Write initial understanding.md (question, prior knowledge summary, scope, timestamp)

### A_COLLECT_EVIDENCE

Parallel evidence gathering:
1. Code search: Grep keywords from question
2. File inspection: Read most relevant files
3. Import tracing: follow dependency chain
4. Git history: `git log --oneline -10 -- <relevant-files>`

Each item → append evidence.ndjson: `{ts, type (code|git|search|doc), source (file:line), relevance (high|medium|low), content, note}`

### A_FORM_HYPOTHESES

Generate ranked hypotheses: each is specific, testable claim about "how/why".
Rank by plausibility (evidence strength). Write to understanding.md:
- `[HIGH]` hypothesis — Evidence: {refs}
- `[MEDIUM]` hypothesis — Evidence: {refs}

### A_CLI_SUPPLEMENT

```
maestro delegate "PURPOSE: Gather evidence for hypotheses
TASK: Trace call chains and data flows per hypothesis | Find corroborating/contradicting patterns
EXPECTED: JSON [{hypothesis_rank, evidence: [{file, line, supports: bool, explanation}]}]
" --to <first-enabled-tool> --mode analysis
```
Run_in_background, STOP, wait. On callback: append to evidence.ndjson.

### A_TEST_HYPOTHESIS

For each hypothesis (rank order):
1. Design test: what evidence would confirm/disprove?
2. Execute: code trace, targeted search, data inspection
3. Record: append evidence.ndjson with type: "test"
4. Update: mark hypothesis confirmed / disproved / inconclusive

### A_SYNTHESIZE_REPORT

Write report.md: Answer (or INCONCLUSIVE), Evidence Trail table, Hypotheses Tested table, Key Learnings, Open Questions.
Append to .workflow/specs/learnings.md: confirmed → roles="implement", disproved → roles="analyze" (gotcha).

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No question text provided | Prompt user for investigation question |
| E002 | --scope path not found | Check path |
| W001 | Prior knowledge search returned no results | Proceed without prior context; note cold-start |
| W002 | Very few evidence matches (<3) | Broaden search terms or expand scope |
| W003 | All hypotheses inconclusive | Investigation marked INCONCLUSIVE |
</error_codes>

<success_criteria>
- [ ] Evidence collected and logged to evidence.ndjson (structured NDJSON)
- [ ] At least 1 hypothesis formed and tested
- [ ] 3-strike escalation triggered if all fail
- [ ] Report + spec-entry blocks written
</success_criteria>

<next_step_routing>
- Save to specs → `/spec-add debug <finding>`
- Follow code → `/learn-follow <path>`
- Decompose patterns → `/learn-decompose <module>`
</next_step_routing>
