---
name: learn-investigate
description: Investigate questions with hypothesis testing and evidence logging
argument-hint: <question> [--scope <path>] [--max-hypotheses N] [-y]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<run_mode>
**Session mode:** `run`. This boundary is mandatory and overrides legacy Codex session-path examples below.

1. Before domain work, call `maestro run create learn-investigate -- $ARGUMENTS` and retain the returned `run_id`, `run_dir`, and `upstream`.
2. Formal deliverables go to `{run_dir}/outputs/`; evidence and worker traces go to `{run_dir}/evidence/`; synthesis and handoff go to `{run_dir}/report.md`.
3. Do not edit protocol JSON or append to project `state.json.artifacts[]`.
4. Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Later references to scratch, hidden command/team directories, milestones, phases, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` are semantic labels only. Map them into the active Run and never create a second formal truth source.
</run_mode>

<purpose>
Systematic investigation for understanding questions (not bug-fixing). 4-phase approach
with scope lock and 3-strike escalation. Produces structured evidence trails and
understanding documents that persist to the learning system.
</purpose>

<context>
$ARGUMENTS — question text and optional flags.

**Flags:**
- `--scope <path>` — Restrict to files under this directory (default: entire project)
- `--max-hypotheses N` — Max hypotheses before escalating (default: 3)
- `--no-persist` — Skip writing to learnings.md (report.md still written locally)
- `-y` — Skip user confirmation prompts (headless mode)

**Output**: `.workflow/knowhow/KNW-investigate-{slug}/` (evidence.ndjson, understanding.md, report.md)

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-investigate-{slug}/` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only investigation** — NEVER modify source code files; all writes go to `.workflow/` only
2. **Evidence append-only** — `evidence.ndjson` MUST be appended line-by-line; NEVER overwrite or truncate existing evidence entries
3. **Scope lock** — once `--scope` is resolved, NEVER expand search scope without explicit user confirmation via escalation
4. **Hypothesis cap** — MUST NOT generate more than `--max-hypotheses` (default 3) before triggering escalation; NEVER silently exceed the cap
5. **Structured evidence format** — every evidence entry MUST include `{ts, type, source, relevance, content, note}`; incomplete entries SHALL NOT be appended
6. **3-strike escalation** — after all hypotheses fail, MUST escalate to user via `request_user_input`; NEVER silently conclude as INCONCLUSIVE without user interaction
7. **Confirmation gate** — unless `--no-persist` or `-y` is set, MUST present report.md path and spec-entries via `request_user_input` before final writes
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Frame → Evidence Collection**
- REQUIRED: Question parsed, slug generated, investigation directory created.
- REQUIRED: Prior knowledge search completed (maestro search + learnings.md + debug-notes).
- BLOCKED if: no question provided (E001) or scope path not found (E002).

**GATE 2: Evidence → Hypothesis Formation**
- REQUIRED: At least 3 evidence items collected in evidence.ndjson.
- BLOCKED if: fewer than 3 evidence matches (W002 — broaden search before proceeding).

**GATE 3: Hypothesis Testing → Report**
- REQUIRED: All hypotheses tested (up to max-hypotheses) with results recorded.
- REQUIRED: If all failed, 3-strike escalation triggered via `request_user_input`.
- BLOCKED if: hypotheses remain untested.

**GATE 4: Report → Completion**
- REQUIRED: report.md written with answer, evidence trail, hypothesis results.
- REQUIRED: Unless `--no-persist`, user confirmation obtained before learnings append.
- BLOCKED if: user declines — offer to adjust findings before retry.

### Stage 1: Frame the Question
- Parse question, generate slug, create investigation directory
- Load debug specs: `maestro load --type spec --category debug` for known issues and patterns
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

### Stage 5: Synthesize + Persist (confirmation-gated)
1. Write `report.md` with answer, evidence trail, hypothesis results
2. If `--no-persist`: skip learnings append, display summary only
3. Otherwise: **Confirmation gate** — unless `-y` is set, prompt user via `request_user_input`: "Persist findings to learnings.md? (y/n)". (If `-y`, auto-confirm.)
   - `y` (or auto-confirm) → append to `.workflow/specs/learnings.md`:
     - Confirmed → category: "technique" / "pattern"
     - Disproved → category: "gotcha"
   - `n` → skip learnings append
4. Display summary with next-step routing

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
- [ ] User confirmation obtained before learnings append (unless --no-persist or -y)
- [ ] Findings appended to .workflow/specs/learnings.md with stable INS-ids (if confirmed)
- [ ] 3-strike escalation triggered if all hypotheses fail
</success_criteria>
