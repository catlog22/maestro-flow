---
name: learn-second-opinion
description: Get alternative perspectives -- review, challenge, or consult
argument-hint: "[-y|--yes] [-c|--concurrency 3] [--continue] \"<target> [--mode review|challenge|consult]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Structured second-opinion for code, decisions, or plans. Three modes:
- **review** (default): 3 parallel persona agents independently assess target via spawn_agents_on_csv
- **challenge**: single adversarial agent via spawn_agents_on_csv (1 worker)
- **consult**: interactive Q&A (no CSV wave — direct orchestration)

Findings persist to `LRN-insights.md`. Decoupled from phase lifecycle.
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

**Output**: `.workflow/knowhow/LRN-opinion-{slug}-{date}.md`
</context>

<execution>

### Phase 1: Resolve Target + Load Context
Resolve target to content. Load specs, wiki search, prior lessons for context brief.

### Phase 2: Execute Mode

#### Review Mode (spawn_agents_on_csv)

| id | persona | focus | grading |
|----|---------|-------|---------|
| 1 | pragmatist | Simplicity, YAGNI, maintenance cost, readability | complexity score, abstraction depth |
| 2 | purist | Correctness, type safety, edge cases, error handling | error paths, type completeness |
| 3 | strategist | Scalability, extensibility, architecture alignment | coupling, cohesion |
| 4 | synthesis | Merge verdicts → agreements, disagreements, top 3 recommendations | combined verdict |

Wave 1: 3 persona agents in parallel. Wave 2: synthesis agent with wave 1 findings as prev_context.

Each persona returns: `{ persona, verdict: approve|concern|reject, confidence, findings: [{severity, description, location, suggestion}], summary }`

#### Challenge Mode
Single agent via spawn_agents_on_csv (1 worker). Adversarial analysis with forcing questions:
- "What assumption would invalidate this entire approach?"
- "What's the simplest thing that breaks this?"
- "What's the implicit contract that isn't enforced?"

#### Consult Mode
Interactive loop via AskUserQuestion. Agent studies target, answers questions with code references. Compile Q&A into report on exit.

### Phase 3: Persist
1. Write `LRN-opinion-{slug}-{date}.md` with per-persona findings + synthesis
2. Append non-trivial findings to `LRN-insights.md` (source: "second-opinion")
3. Display summary with verdict and next steps

**Next steps:** `/manage-issue create`, `/learn-decompose <path>`, `/learn-follow <path>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target not resolvable | Verify path/ID |
| E002 | error | Unknown --mode value | Use: review, challenge, consult |
| W001 | warning | Persona agent failed — partial perspectives | Proceed with available agents |
| W003 | warning | Git diff empty for HEAD/staged | Use file path instead |
</error_codes>

<success_criteria>
- [ ] Target resolved and context loaded
- [ ] Mode executed: review (3 parallel agents), challenge (adversarial), or consult (interactive)
- [ ] Synthesis produced with agreements, disagreements, verdict
- [ ] Report written to `LRN-opinion-{slug}-{date}.md`
- [ ] Non-trivial findings appended to `LRN-insights.md`
</success_criteria>
