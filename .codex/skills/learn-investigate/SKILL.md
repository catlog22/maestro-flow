---
name: learn-investigate
description: Investigate questions with hypothesis testing and evidence logging
argument-hint: "<question> [--scope <path>] [--max-hypotheses N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Systematic investigation for understanding questions (not bug-fixing). 4-phase approach
with scope lock and 3-strike escalation. Produces structured evidence trails and
understanding documents that persist to the learning system.

Unlike `quality-debug` (fixing bugs during execution), this answers "how does X work?",
"why does Y happen?", "what would happen if Z?" questions.
</purpose>

<context>
$ARGUMENTS — question text and optional flags.

**Flags:**
- `--scope <path>` — Restrict to files under this directory (default: entire project)
- `--max-hypotheses N` — Max hypotheses before escalating (default: 3)

**Output**: `.workflow/knowhow/KNW-investigate-{slug}/` (evidence.ndjson, understanding.md, report.md)
</context>

<execution>

### Stage 1: Frame the Question
- Parse question, generate slug, create investigation directory
- Load debug specs: `maestro spec load --category debug` for known issues and patterns
- Search prior knowledge: `maestro search --category debug`, wiki search, grep .workflow/specs/learnings.md
- Write initial `understanding.md`

### Stage 2: Evidence Collection
1. **Code search**: Grep keywords across scoped files
2. **File inspection**: Read most relevant files
3. **Import tracing**: Follow dependency chain
4. **Git history**: `git log --oneline -10 -- <relevant-files>`

Each evidence item → `evidence.ndjson`:
```json
{"ts":"ISO","type":"code|git|search|doc","source":"file:line","relevance":"high|medium|low","content":"...","note":"..."}
```

### Stage 3: Hypothesis Formation + Testing
Generate ranked hypotheses from evidence. For each (in rank order):
1. Design test: what evidence would confirm/disprove?
2. Execute test: code trace, targeted search, experiment
3. Record result in `evidence.ndjson` (type: "test")
4. Update `understanding.md`: confirmed / disproved / inconclusive

### Stage 4: 3-Strike Escalation
If all hypotheses fail: broaden scope, search wiki with alt keywords, or mark INCONCLUSIVE.

### Stage 5: Synthesize + Persist
1. Write `report.md` with answer, evidence trail, hypothesis results
2. Append to `.workflow/specs/learnings.md`:
   - Confirmed → category: "technique" / "pattern"
   - Disproved → category: "gotcha"
3. Display summary with next-step routing

**Next steps:** `$spec-add debug <finding>`, `$learn-follow <path>`, `$learn-decompose <module>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No question provided | Provide question as first argument |
| E002 | error | Scope path does not exist | Check --scope path |
| W001 | warning | No prior knowledge found | Proceed with fresh investigation |
| W002 | warning | Very few evidence matches (<3) | Broaden search terms |
| W003 | warning | All hypotheses inconclusive | Marked INCONCLUSIVE |
</error_codes>

<success_criteria>
- [ ] Question parsed and investigation directory created
- [ ] Evidence collected and logged to evidence.ndjson
- [ ] At least 1 hypothesis formed and tested
- [ ] understanding.md tracks evolving understanding
- [ ] report.md written with answer and evidence trail
- [ ] Findings appended to .workflow/specs/learnings.md with stable INS-ids
- [ ] 3-strike escalation triggered if all hypotheses fail
</success_criteria>
