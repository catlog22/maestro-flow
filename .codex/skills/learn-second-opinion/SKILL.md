---
name: learn-second-opinion
description: Get alternative perspectives -- review, challenge, or consult
argument-hint: "<target> [--mode review|challenge|consult]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Structured second-opinion for code, decisions, or plans. Three modes:
- **review** (default): 3 parallel persona agents independently assess target via spawn_agents_on_csv
- **challenge**: single adversarial agent via spawn_agents_on_csv (1 worker)
- **consult**: interactive Q&A (no CSV wave — direct orchestration)

Findings persist to `.workflow/specs/learnings.md`. Decoupled from phase lifecycle.
</purpose>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution (auto-detected):**
- File path → analyze file content
- Wiki ID (`type-slug`) → fetch via `maestro wiki get`
- `HEAD` / `staged` → analyze git diff
- Phase number → analyze phase plan

**Flags:**
- `--mode review` — 3-persona parallel review (default)
- `--mode challenge` — Adversarial single-agent analysis
- `--mode consult` — Interactive Q&A session

**Output**: `.workflow/knowhow/KNW-opinion-{slug}-{date}.md`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-opinion-{slug}-{date}.md` and `.workflow/specs/learnings.md` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — NEVER modify source code, wiki entries, or plan files under review; all writes go to `.workflow/` only
2. **Agent independence** — in review mode, each persona agent (Pragmatist/Purist/Strategist) MUST operate independently without shared state; NEVER pass one agent's findings to another during wave 1
3. **Evidence-backed verdicts** — every finding MUST include a `location` reference (file:line or section); ungrounded opinions SHALL NOT appear in the report
4. **Mode contract** — MUST execute exactly the mode specified (review/challenge/consult); NEVER mix mode behaviors within a single execution
5. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
6. **Confirmation gate** — MUST present findings and target files via `request_user_input` before any writes
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Resolve → Execute**
- REQUIRED: Target resolved to concrete content (file, wiki entry, git diff, or phase plan).
- BLOCKED if: target unresolvable (E001) or unknown mode (E002).

**GATE 2: Execute → Synthesize**
- REQUIRED: Mode-specific analysis completed (review: ≥2 of 3 personas completed; challenge: adversarial agent completed; consult: Q&A session ended).
- BLOCKED if: all persona agents failed in review mode — skip to degraded synthesis with LOW CONFIDENCE flag.

**GATE 3: Synthesize → Persist**
- REQUIRED: Synthesis produced with agreements, disagreements, verdict, and top 3 recommendations.
- BLOCKED if: synthesis agent failed — use raw persona outputs as fallback.

**GATE 4: Persist → Completion**
- REQUIRED: `request_user_input` confirmation before writing learnings.
- REQUIRED: KNW-opinion-{slug}-{date}.md written.
- BLOCKED if: user declines — offer to adjust findings before retry.

### Phase 1: Resolve Target + Load Context
Resolve target to content. Load specs, `maestro search`, prior lessons for context brief.

### Phase 2: Execute Mode

#### Review Mode (spawn_agents_on_csv)

| id | persona | focus | grading |
|----|---------|-------|---------|
| 1 | pragmatist | Simplicity, YAGNI, maintenance cost, readability | complexity score, abstraction depth |
| 2 | purist | Correctness, type safety, edge cases, error handling | error paths, type completeness |
| 3 | strategist | Scalability, extensibility, architecture alignment | coupling, cohesion |
| 4 | synthesis | Merge verdicts → agreements, disagreements, top 3 recommendations | combined verdict |

Wave 1: 3 persona agents in parallel (filter `wave==1 AND status=="pending"`).

**Failed persona handling** (between Wave 1 and Wave 2):
- Exclude rows where `result_status == "failed"` from synthesis input
- If any persona failed, inject `gap_note` into synthesis prev_context listing missing perspectives
- If fewer than 2 personas completed, mark overall synthesis as `evidence_incomplete: true` in output

Wave 2: synthesis agent with completed wave 1 findings as prev_context (failed rows excluded).

**output_schema** (both waves):

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "persona":       { "type": "string" },
    "verdict":       { "type": "string", "enum": ["approve", "concern", "reject", ""] },
    "confidence":    { "type": "string", "description": "0-100" },
    "findings":      { "type": "string", "description": "JSON array of {severity, description, location, suggestion}, max 500 chars summary" },
    "summary":       { "type": "string", "maxLength": 500 },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings", "summary"]
}
```

Merge: `result_status` → master `status`; copy `persona`, `verdict`, `confidence`, `findings`, `summary`, `error`.

**Shared termination contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed with concrete verdict
- Failure → result_status=failed with error message
- Timeout → near max_runtime_seconds → result_status=failed, error="timeout (partial)"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
- Read-only analysis. Do NOT modify source files.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv (no recursion).
```

#### Challenge Mode
Single agent via spawn_agents_on_csv (max_concurrency: 1) with the same `output_schema` + termination contract above. Adversarial analysis with forcing questions:
- "What assumption would invalidate this entire approach?"
- "What's the simplest thing that breaks this?"
- "What's the implicit contract that isn't enforced?"

#### Consult Mode
Interactive loop via request_user_input. Agent studies target, answers questions with code references. Compile Q&A into report on exit.

### Phase 3: Persist
1. Write `KNW-opinion-{slug}-{date}.md` with per-persona findings + synthesis
2. Append non-trivial findings to `.workflow/specs/learnings.md` (source: "second-opinion")
3. Display summary with verdict and next steps

**Next steps:** `$manage-issue create`, `$learn-decompose <path>`, `$learn-follow <path>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target not resolvable | Verify path/ID |
| E002 | error | Unknown --mode value | Use: review, challenge, consult |
| W001 | warning | Persona agent failed — partial perspectives | Exclude failed rows, inject gap_note, mark evidence_incomplete if <2 completed |
| W003 | warning | Git diff empty for HEAD/staged | Use file path instead |
</error_codes>

<success_criteria>
- [ ] Target resolved and context loaded
- [ ] Mode executed: review (3 parallel agents), challenge (adversarial), or consult (interactive)
- [ ] Failed persona rows excluded from synthesis input; gap_note injected if any failed; evidence_incomplete marked if <2 completed
- [ ] Synthesis produced with agreements, disagreements, verdict
- [ ] Report written to `KNW-opinion-{slug}-{date}.md`
- [ ] Non-trivial findings appended to `.workflow/specs/learnings.md`
</success_criteria>
