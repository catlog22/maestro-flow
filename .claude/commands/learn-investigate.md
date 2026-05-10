---
name: learn-investigate
description: Investigate questions with hypothesis testing and evidence logging
argument-hint: "<question> [--scope <path>] [--max-hypotheses N]"
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
Systematic investigation workflow for understanding questions (not bug-fixing). Inspired by gstack `/investigate` with its 4-phase approach, scope lock, and 3-strike escalation rule.

Unlike `quality-debug` which is designed for fixing bugs during execution phases, this command is for answering "how does X work?", "why does Y happen?", "what would happen if Z?" questions. It produces structured evidence trails and understanding documents that persist to the learning system.
</purpose>

<context>
Arguments: $ARGUMENTS

**Target:** First argument is the question or topic to investigate (quoted string or keywords).

**Flags:**
- `--scope <path>` — Restrict investigation to files under this directory (default: entire project)
- `--max-hypotheses N` — Maximum hypotheses to test before escalating (default: 3)

**Storage written:**
- `.workflow/knowhow/KNW-investigate-{slug}/evidence.ndjson` — Structured evidence log (one JSON line per evidence)
- `.workflow/knowhow/KNW-investigate-{slug}/understanding.md` — Evolving understanding document
- `.workflow/knowhow/KNW-investigate-{slug}/report.md` — Final investigation report
- `.workflow/knowhow/specs/learnings.md` — Investigation findings as `<spec-entry>` blocks (source: "investigate")

**Storage read:**
- Source files within scope
- `maestro wiki search "<question>"` — Prior knowledge about the topic
- `.workflow/knowhow/specs/learnings.md` — Prior related investigations
- `.workflow/specs/debug-notes.md` — Known gotchas and patterns
- `.workflow/codebase/architecture.md` — Structural context (if exists)
</context>

<execution>

### Stage 1: Frame the Question
- Parse question from arguments
- Determine scope (--scope or full project)
- Generate investigation slug from question keywords
- Create `.workflow/knowhow/KNW-investigate-{slug}/` directory
- Search prior knowledge:
  - `maestro wiki search "<question>"` for related entries
  - Search `specs/learnings.md` for related insights
  - Read `debug-notes.md` for known gotchas

Write initial `understanding.md`:
```markdown
# Investigation: {question}
## Initial Understanding
- Prior knowledge: {summary of wiki/knowhow findings}
- Scope: {path or "full project"}
- Started: {timestamp}
```

### Stage 2: Evidence Collection
Systematically gather evidence related to the question:

1. **Code search**: Grep for keywords from the question across the scoped files
2. **File inspection**: Read the most relevant files identified by search
3. **Import/dependency tracing**: Follow imports to understand the dependency chain
4. **Git history**: `git log --oneline -10 -- <relevant-files>` for recent changes

For each piece of evidence, append to `evidence.ndjson`:
```json
{"ts": "ISO", "type": "code|git|search|doc", "source": "file:line", "relevance": "high|medium|low", "content": "...", "note": "why this matters"}
```

### Stage 3: Pattern Matching
Compare collected evidence against known patterns:
- Check `debug-notes.md` entries for matching situations
- Check `specs/learnings.md` for related technique/pattern/gotcha entries
- Identify: does this match a documented pattern, or is it novel?

Update `understanding.md` with pattern analysis section.

### Stage 4: Hypothesis Formation
From evidence and patterns, generate ranked hypotheses:
- Each hypothesis: a specific, testable claim about "how/why"
- Rank by plausibility (evidence strength)
- Write hypotheses to `understanding.md`

```markdown
## Hypotheses
1. **[HIGH]** {hypothesis 1} — Evidence: {refs}
2. **[MEDIUM]** {hypothesis 2} — Evidence: {refs}
3. **[LOW]** {hypothesis 3} — Evidence: {refs}
```

### Stage 4.5: CLI Supplementary Exploration (optional)

**Skip if** no enabled CLI tools or hypotheses are trivially testable.

```
IF no CLI tools enabled: skip to Stage 5

hypothesis_summary = hypotheses.map(h => "${h.rank}: ${h.claim}").join("\n")

Bash({
  command: 'maestro delegate "PURPOSE: Gather evidence for investigation hypotheses
TASK: For each hypothesis, trace relevant call chains and data flows | Find corroborating or contradicting code patterns
MODE: analysis
CONTEXT: @${scope_path}/**/*
EXPECTED: JSON array of { hypothesis_rank, evidence: [{ file, line, supports: bool, explanation }] }
CONSTRAINTS: Focus on code-level evidence only | Max 5 evidence items per hypothesis

Hypotheses:
${hypothesis_summary}
" --role explore --mode analysis',
  run_in_background: true
})
```

**On callback:** Parse result, append each evidence item to `evidence.ndjson` with `type: "cli-exploration"`. Pass as supplementary context to Stage 5 testing.

### Stage 5: Hypothesis Testing
For each hypothesis (in rank order):

1. **Design test**: What specific evidence would confirm or disprove this?
2. **Execute test**: Code trace, targeted search, data inspection, or experiment
3. **Record result**: Append to `evidence.ndjson` with `type: "test"`
4. **Update understanding**: Mark hypothesis as confirmed / disproved / inconclusive

```markdown
## Test Results
### Hypothesis 1: {claim}
- Test: {what was done}
- Result: CONFIRMED / DISPROVED / INCONCLUSIVE
- Evidence: {file:line references}
```

### Stage 6: 3-Strike Escalation
If `--max-hypotheses` hypotheses all fail:

1. **Broaden scope**: If scope was restricted, suggest expanding. AskUserQuestion:
   ```
   {N} hypotheses tested, none confirmed.
   A) Broaden scope to full project
   B) I have a new hypothesis: [user provides]
   C) Escalate — this needs deeper investigation
   ```
2. **Search wiki for clues**: `maestro wiki search` with alternative keywords
3. **If still stuck**: Mark as INCONCLUSIVE with what was learned and what remains unknown

### Stage 7: Synthesize & Report
Write final `report.md`:

```markdown
# Investigation Report: {question}

## Answer
{confirmed understanding or "INCONCLUSIVE: ..."}

## Evidence Trail
| # | Type | Source | Relevance | Finding |
|---|------|--------|-----------|---------|
| 1 | code | file:line | high | ... |

## Hypotheses Tested
| Hypothesis | Result | Key Evidence |
|-----------|--------|-------------|
| ... | confirmed/disproved | file:line |

## Key Learnings
- {learning 1}
- {learning 2}

## Open Questions
- {what remains unknown}
```

### Stage 8: Persist
1. Append findings as `<spec-entry>` blocks to `specs/learnings.md` via `maestro spec add learning --roles implement --body "<content>" --keywords "investigate,{question-slug}"`:
   - Confirmed hypotheses → `roles="implement"` (merge "technique"/"pattern" into keywords)
   - Disproved hypotheses → `roles="analyze"` (merge "gotcha" into keywords)
   - Stable INS-id from `hash("investigate" + question + finding_title)`
3. Display summary with answer and next steps

**Next-step routing:**
- Save finding to specs → `/spec-add debug <finding>`
- Follow-along on discovered code → `/learn-follow <path>`
- Decompose patterns found → `/learn-decompose <module>`
- Create wiki entry for understanding → `maestro wiki create --type note`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No question provided | Provide a question as the first argument |
| E002 | error | Scope path does not exist | Check --scope path is valid |
| W001 | warning | No prior knowledge found in wiki/knowhow | Proceed with fresh investigation |
| W002 | warning | Evidence collection found very few matches (<3) | Broaden search terms or expand scope |
| W003 | warning | All hypotheses inconclusive — escalating | Investigation marked INCONCLUSIVE |
</error_codes>

<success_criteria>
- [ ] Question parsed and investigation slug generated
- [ ] Investigation directory created under `.workflow/knowhow/`
- [ ] Prior knowledge loaded from wiki and knowhow
- [ ] Evidence collected and logged to `evidence.ndjson` (structured NDJSON)
- [ ] Pattern matching performed against debug-notes and knowhow insights
- [ ] At least 1 hypothesis formed and tested
- [ ] `understanding.md` tracks evolving understanding with timestamps
- [ ] `report.md` written with answer, evidence trail, hypothesis results
- [ ] Findings appended to `specs/learnings.md` as `<spec-entry>` blocks with stable INS-ids
- [ ] 3-strike escalation triggered if all hypotheses fail
- [ ] No files modified outside `.workflow/knowhow/`
- [ ] Summary displayed with answer and next-step routing
</success_criteria>
