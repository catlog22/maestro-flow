---
name: learn-second-opinion
description: Get alternative perspectives — review, challenge, or consult
argument-hint: "<target> [--mode review|challenge|consult]"
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
Structured second-opinion workflow for code, decisions, or plans. Three modes inspired by gstack `/codex`:

- **review** (default): 3 parallel agents with distinct personas (pragmatist, purist, strategist) independently assess the target
- **challenge**: single adversarial agent that tries to break the approach, find hidden assumptions, and propose alternatives
- **consult**: interactive Q&A mode where the agent studies the target and answers your questions

Decoupled from the phase/execution lifecycle — can be invoked on any piece of code or knowledge at any time. Findings persist to `specs/learnings.md` as `<spec-entry>` blocks.
</purpose>

<context>
Arguments: $ARGUMENTS

**Target resolution (auto-detected):**
- File path → analyze that file's content
- Wiki ID (`<type>-<slug>`) → fetch via `maestro wiki get`
- `HEAD` or `staged` → analyze current git diff (`git diff HEAD` or `git diff --staged`)
- Phase number (e.g., `3`) → resolve via `state.json.artifacts[]` to find plan in scratch dir

**Flags:**
- `--mode review` — 3-persona parallel review (default)
- `--mode challenge` — Adversarial single-agent analysis
- `--mode consult` — Interactive Q&A session

**Storage written:**
- `.workflow/knowhow/KNW-opinion-{slug}-{YYYY-MM-DD}.md` — Opinion report
- `.workflow/knowhow/specs/learnings.md` — New `<spec-entry>` blocks from analysis (source: "second-opinion")

**Storage read:**
- Target content (file, wiki entry, diff, or plan)
- `.workflow/specs/` — Project conventions for context
- `maestro wiki search` — Related knowledge entries
- `.workflow/knowhow/specs/learnings.md` — Prior insights about the topic
</context>

<execution>

### Stage 1: Resolve Target
- File path: Read the file
- Wiki ID: `maestro wiki get <id>`
- `HEAD`: `git diff HEAD` (unstaged + staged changes)
- `staged`: `git diff --staged`
- Phase N: Resolve via `state.json.artifacts.find(a => a.type === 'plan' && a.phase === N)` → read `.workflow/{artifact.path}/plan.json`
- If unresolvable, AskUserQuestion for clarification

### Stage 2: Load Context
- Read relevant specs: `Skill({ skill: "spec-load" })` silently to get project conventions
- Search wiki: `maestro wiki search "<target topic>"` for related entries (top 5)
- Search insights: search `specs/learnings.md` for entries related to the target area
- Build context brief: target content + conventions + related knowledge

### Stage 3: Execute Mode

#### Mode: review (default)
Spawn 3 Agents in a single message with distinct personas:

**Agent 1 — Pragmatist:**
- Focus: simplicity, YAGNI, maintenance cost, readability
- Question: "Is this the simplest thing that could work? What's the maintenance burden?"
- Evaluates: complexity score, abstraction depth, dependency count

**Agent 2 — Purist:**
- Focus: correctness, type safety, edge cases, error handling
- Question: "What assumptions can be violated? Where are the edge cases?"
- Evaluates: error paths covered, type completeness, invariant preservation

**Agent 3 — Strategist:**
- Focus: scalability, extensibility, architecture alignment
- Question: "Does this support future growth? Does it fit the overall architecture?"
- Evaluates: coupling, cohesion, architecture constraint compliance

Each agent returns:
```json
{
  "persona": "pragmatist|purist|strategist",
  "verdict": "approve|concern|reject",
  "confidence": "high|medium|low",
  "findings": [{ "severity": "high|medium|low", "description": "...", "location": "file:line", "suggestion": "..." }],
  "summary": "one paragraph assessment"
}
```

#### Mode: challenge
Spawn 1 Agent as an adversarial reviewer:

- Try to find the weakest assumption in the approach
- Propose a concrete scenario that breaks the current implementation
- Identify the single biggest risk
- Suggest an alternative approach and argue why it might be better
- Apply forcing questions:
  - "What assumption would invalidate this entire approach?"
  - "What's the simplest thing that breaks this?"
  - "If you had to rewrite this in 6 months, what would you regret?"
  - "What's the implicit contract that isn't enforced?"

#### Mode: consult
Interactive loop:
1. Agent studies the target content thoroughly
2. Display: "Target loaded. What would you like to know?"
3. AskUserQuestion for the first question
4. Agent answers with code references and evidence
5. Loop: AskUserQuestion for follow-up or "done" to exit
6. On exit, compile all Q&A into the report

### Stage 4: Synthesize
Across all perspectives (or from single agent in challenge/consult):
- **Points of agreement**: findings all personas share
- **Points of disagreement**: where personas diverge (with reasoning)
- **Verdict**: combined assessment with confidence level
- **Top 3 recommendations**: prioritized by impact

### Stage 5: Persist & Report
1. Write `.workflow/knowhow/KNW-opinion-{slug}-{date}.md`:
   - Target summary
   - Per-persona findings (review) / adversarial analysis (challenge) / Q&A transcript (consult)
   - Synthesis: agreements, disagreements, verdict
   - Recommendations
2. Append non-trivial findings as `<spec-entry>` blocks to `specs/learnings.md` via `maestro spec add learning --roles implement --body "<content>" --keywords "second-opinion,{mode},{target-slug}"`
4. Display summary with verdict and recommendations

**Next-step routing:**
- Create issue for a finding → `/manage-issue create <description>`
- Decompose patterns found → `/learn-decompose <path>`
- Follow-along on the code → `/learn-follow <path>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target not resolvable (file/wiki/diff/plan not found) | Verify target argument, provide correct path or ID |
| E002 | error | Unknown --mode value | Use: review, challenge, or consult |
| W001 | warning | One review agent failed — partial perspectives | Proceed with available agents, note incomplete coverage |
| W002 | warning | No related wiki entries found for context | Proceed without wiki context |
| W003 | warning | Git diff empty (no changes) for HEAD/staged target | Nothing to review; suggest using a file path instead |
</error_codes>

<success_criteria>
- [ ] Target resolved and content loaded
- [ ] Context gathered (specs, wiki, knowhow)
- [ ] Mode executed correctly:
  - review: 3 agents spawned in parallel, all returned findings
  - challenge: adversarial analysis completed with forcing questions
  - consult: interactive Q&A loop completed
- [ ] Synthesis produced with agreements, disagreements, verdict
- [ ] Report written to `KNW-opinion-{slug}-{date}.md`
- [ ] Non-trivial findings appended to `specs/learnings.md` as `<spec-entry>` blocks
- [ ] No files modified outside `.workflow/knowhow/`
- [ ] Summary displayed with verdict and next-step routing
</success_criteria>
