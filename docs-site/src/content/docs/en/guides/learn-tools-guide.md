---
title: "Learn Toolkit Guide"
---

A complete reference for Maestro's learning toolkit, covering the principles, usage, and collaboration patterns of 5 `/learn` subcommands.

---

## 1. Overview

The learning toolkit is Maestro's **interactive deep learning** module, focused on extracting structured knowledge from code, documentation, and decision history. Each command follows the scientific method -- hypothesis, evidence, verification, codification -- transforming implicit engineering experience into reusable explicit knowledge.

### Comparison with /manage knowledge capture

| Dimension | /learn subcommands | /manage knowledge capture |
|-----------|-----------------|-------------|
| Interaction mode | Interactive deep learning, multi-round guidance | Atomic operation, single capture |
| Goal | Systematic acquisition of deep understanding | Quick recording of a single insight |
| Output | Structural reports, pattern catalog, evidence trail | Single `<spec-entry>` |
| Duration | Minutes, multi-agent parallel | Seconds, instant completion |

Simple rule: **Use /learn when you need to think, use /manage knowledge capture when you need to record**.

---

## 2. Command Reference

### 2.1 learn consult — Unified Retrospective

Periodic review of project activities, distilling insights from Git commit history and architecture decisions.

**Parameters**:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--lens` | Analysis perspective: `git` / `decision` / `all` | `all` |
| `--days N` | Number of days to look back for Git lens | 7 |
| `--author <name>` | Filter by author | All |
| `--area <path>` | Filter by directory | All |
| `--compare` | Compare with previous retrospective | Off |
| `--phase N` | Decision lens focus on specific Phase | All |
| `--tag <tag>` | Decision lens filter by tag | All |
| `--id <id>` | Evaluate a specific decision individually | -- |

<details>
<summary>Command examples</summary>

```bash
/learn consult                                    # Default: both lenses, full analysis of last 7 days
/learn consult --lens git --days 14               # Git analysis only, last 14 days
/learn consult --lens decision --phase 2          # Decision analysis only, focus on Phase 2
/learn consult --lens all --author alice --compare # Full analysis, filtered by author, compare with last retro
```
</details>

#### Git Lens -- Activity Analysis

| Metric | Calculation | Significance |
|--------|------------|--------------|
| Test ratio | test_insertions / total_insertions | Proportion of test coverage investment |
| Churn rate | Files changed >2 times / total files | Code stability |
| Sessions | Commit clusters grouped by time gaps >2 hours | Work cadence |
| LOC/session-hour | Net lines added per session per hour | Development efficiency |

Output: Per-person statistics, high-churn file list, low-test area warnings (< 20%), trend comparison with previous retrospective.

#### Decision Lens -- Decision Quality Assessment

3 parallel agents evaluate from different dimensions:

| Agent Role | Evaluation Dimension | Rating |
|-----------|----------------------|--------|
| Technical Soundness | Does the implementation match the intent? Has the context changed? | sound / degraded / violated |
| Cost Assessment | How much complexity was added? Was technical debt introduced? | low-cost / acceptable / expensive / debt-creating |
| Alternative Hindsight | Was it the right choice in hindsight? | confirmed / questionable / should-revisit |

| Status | Meaning | Recommendation |
|--------|---------|----------------|
| Validated | Technically sound + cost-controlled + confirmed in hindsight | No action needed |
| Aging | Sound but costly | Schedule technical debt review |
| Questionable | Implementation has drifted or decision is doubtful | Create an issue to track |
| Stale | Environment has changed, needs re-evaluation | Refresh decision document |
| Reversed | Code behavior contradicts the decision | Record the reversal |

**Output paths**: `KNW-retro-{date}.md` (report), `KNW-retro-{date}.json` (metrics), `specs/learnings.md` (codification)

---

### 2.2 learn follow — Guided Reading

Extract deep understanding from code or documentation through section-by-section guided reading.

**Parameters**:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<target>` | File path / Wiki ID / topic keyword | Required |
| `--depth shallow\|deep` | Shallow (key structures and patterns) or deep (every function, branch) | `shallow` |
| `--save-wiki` | Save reading notes as wiki entry | Off |

<details>
<summary>Command examples</summary>

```bash
/learn follow src/auth/jwt.ts                     # Follow-read a specific file
/learn follow src/utils/ --depth deep              # Deep follow-read of entire directory
/learn follow arch-auth-design --save-wiki          # Follow-read wiki document and save notes
```
</details>

**Target resolution**: File path (contains `/` or `\`) reads source directly; Wiki ID calls `wiki get`; topic text searches wiki first, then source code.

#### 4 Forcing Questions

| # | Question | What It Extracts |
|---|----------|-----------------|
| 1 | What pattern is used here? | Design patterns, idioms, conventions |
| 2 | Why was this approach chosen over alternatives? | Trade-offs, rejected options |
| 3 | What implicit assumptions does this code depend on? | Implicit contracts, input shapes, execution order |
| 4 | If this changes, what breaks? | Fragility points, downstream impact scope |

The command automatically builds a **1-hop context neighborhood** (wiki references, import dependencies, downstream consumers). Extracted results are cross-referenced with `coding-conventions.md`: documented patterns marked as "confirmed", undocumented ones suggested for spec inclusion.

**Output paths**: `KNW-follow-{slug}-{date}.md` (Understanding Map), `specs/learnings.md` (codification)

---

### 2.3 learn decompose — Code Pattern Decomposition

Systematically decompose complex code into a reusable design pattern catalog, with parallel analysis across 4 dimensions.

**Parameters**:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<target>` | File path / directory / module name | Required |
| `--patterns <list>` | Comma-separated pattern name list for focused analysis | Detect all |
| `--save-spec` | Auto-call `/spec add` for each new pattern | Off |
| `--save-wiki` | Create wiki notes per dimension | Off |

<details>
<summary>Command examples</summary>

```bash
/learn decompose src/auth/                       # Decompose the auth module
/learn decompose src/utils/ --patterns "Factory,Observer,Strategy"  # Focus on specified patterns
/learn decompose src/core/ --save-spec --save-wiki  # Decompose and sync to spec and wiki
```
</details>

#### 4-Dimension Parallel Analysis

| Agent | Dimension | Detection Scope |
|-------|-----------|----------------|
| Structural | Structural patterns | Class hierarchies, composition relationships, DI/IoC, Factory/Builder/Singleton, barrel exports |
| Behavioral | Behavioral patterns | Event streams, middleware chains, Observer/Pub-Sub, Command/Strategy, state machines |
| Data | Data patterns | Repository/DAO, DTO pipelines, caching strategies (memo/LRU/TTL), serialization, schema validation |
| Error | Error patterns | Error boundaries, retry/backoff/circuit-breaker, degradation chains, guard clauses, logging strategies |

Each finding carries: pattern name, dimension, confidence, code anchor (file:line), description, trade-offs. Findings are compared against existing knowledge and tagged as documented / known / new. Cross-dimension duplicates are auto-merged.

**Output paths**: `KNW-decompose-{slug}-{date}.md` (Pattern Catalog), `specs/learnings.md` (codification)

---

### 2.4 learn consult — Multi-Perspective Analysis

Get alternative perspectives on code, decisions, or plans, avoiding blind spots from a single judgment.

**Parameters**:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<target>` | File path / Wiki ID / `HEAD` / `staged` / Phase number | Required |
| `--mode` | `review` / `challenge` / `consult` | `review` |

<details>
<summary>Command examples</summary>

```bash
/learn consult src/auth/jwt.ts                    # Default review mode
/learn consult src/core/ --mode challenge          # Adversarial challenge
/learn consult HEAD --mode consult                 # Interactive Q&A
/learn consult 2 --mode review                     # Review Phase 2 plan
```
</details>

#### Three Modes

**Review (default)**: 3 agents review in parallel

| Agent Role | Focus | Core Questions |
|-----------|-------|---------------|
| Pragmatist | Simplicity, YAGNI, maintenance cost | "Simplest viable approach? Maintenance burden?" |
| Purist | Correctness, edge cases, type safety | "Which assumptions could be violated?" |
| Strategist | Extensibility, architectural consistency | "Supports future growth? Fits the architecture?" |

Synthesized as: consensus points, disagreement points, overall verdict, top 3 recommendations.

**Challenge**: A single adversarial agent finds the weakest assumptions, constructs failure scenarios, identifies risks, and proposes alternatives.

**Consult**: Interactive Q&A loop -- agent loads the target, answers user questions, compiles report when user says "done".

**Output paths**: `KNW-opinion-{slug}-{date}.md` (analysis report), `specs/learnings.md` (codification)

---

### 2.5 learn investigate — Systematic Investigation

Investigate "why" and "how" questions in the codebase using the scientific method -- not bug fixing, but understanding the system.

**Parameters**:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<question>` | The question to investigate | Required |
| `--scope <path>` | Limit search scope | Entire project |
| `--max-hypotheses N` | Maximum number of hypotheses; exceeding triggers escalation | 3 |

<details>
<summary>Command examples</summary>

```bash
/learn investigate "What is the full lifecycle of a JWT refresh token"
/learn investigate "Why does queue consumption sometimes process duplicates" --scope src/queue/
/learn investigate "What cache invalidation strategies are used" --max-hypotheses 5
```
</details>

#### Hypothesis Testing Workflow

```
Define Problem -> Collect Evidence -> Pattern Match -> Generate Hypotheses -> Test Hypotheses -> Synthesize Report
                                                                              ^
                                                                    3-strike escalation mechanism
```

**Collect evidence**: 4 parallel channels -- code search (Grep), file inspection, dependency tracing (import chains), Git history.

**Generate hypotheses**: Ranked list based on evidence, e.g. `[HIGH] JWT refresh uses rotation strategy -- Evidence: src/auth/jwt.ts:42`.

**Test hypotheses**: Test in priority order, mark as confirmed / disproved / inconclusive. All evidence recorded as NDJSON in `evidence.ndjson`.

**3-strike escalation**: When all are inconclusive, ask the user -- expand scope and re-hypothesize, or mark as INCONCLUSIVE with a known-unknowns report.

**Output paths**: `KNW-investigate-{slug}/` (with `evidence.ndjson`, `understanding.md`, `report.md`), `specs/learnings.md` (codification)

---

## 3. Learning Data Flow

### Output Structure

All learning command outputs follow unified storage conventions:

```
.workflow/knowhow/                         # Learning output directory
├── KNW-retro-{date}.md / .json            # Retrospective report
├── KNW-follow-{slug}-{date}.md            # Guided reading notes
├── KNW-decompose-{slug}-{date}.md         # Pattern catalog
├── KNW-opinion-{slug}-{date}.md           # Second opinion
└── KNW-investigate-{slug}/                # Investigation directory
    ├── evidence.ndjson
    ├── understanding.md
    └── report.md
specs/learnings.md                         # Unified learning codification
```

### learnings.md Structure

Uses the `<spec-entry>` closed-tag format with `category`, `keywords`, `date`, `source` attributes for traceability.

### Knowledge Flow

- All commands **automatically** write to knowhow reports and `specs/learnings.md`
- `--save-spec` / `--save-wiki` control whether to further sync to the spec system and wiki
- Duplicate findings are automatically deduplicated -- existing knowledge marked as documented/known; only new entries proceed to codification

---

## 4. Use Case Quick Reference

### Choosing a Command by Intent

| What You Want To Do | Command | Example |
|--------------------|---------|---------|
| Review last week's work quality | `learn consult` | `--lens git --days 7` |
| Check if architecture decisions are still valid | `learn consult` | `--lens decision --phase 2` |
| Understand the design of an unfamiliar module | `learn follow` | `src/auth/ --depth deep` |
| Learn implicit conventions in a code section | `learn follow` | `src/utils/logger.ts` |
| Inventory a module's design patterns | `learn decompose` | `src/core/ --save-spec` |
| Extract a reusable pattern library | `learn decompose` | `src/ --save-wiki` |
| Review code quality (multi-perspective) | `learn consult` | `src/api/` |
| Stress-test a solution | `learn consult` | `HEAD --mode challenge` |
| Consult AI about an implementation | `learn consult` | `plan.json --mode consult` |
| Understand "why does it work this way" | `learn investigate` | `"What causes cache penetration"` |
| Trace a complete call chain path | `learn investigate` | `"Request path from entry to database"` |

### Typical Workflow Combinations

| Scenario | Steps |
|----------|-------|
| **New Member Onboarding** | `learn follow src/` -> `learn decompose src/core/ --save-wiki` -> `learn consult --lens git --days 30` |
| **Before Architecture Decisions** | `learn follow src/auth/ --depth deep` -> `learn consult --mode review` -> `learn consult --mode challenge` -> `learn investigate "impact scope"` |
| **Iteration Retrospective** | `learn consult --lens all --days 14 --compare` -> `learn investigate "high churn cause"` -> `learn decompose --save-spec` |
| **Issue Investigation (Understanding, Not Fixing)** | `learn investigate "latency cause"` -> `learn follow key file` -> `learn consult --mode consult` |

### Natural Transitions Between Commands

```
learn follow -> learn decompose      # From understanding to pattern extraction
learn follow -> learn consult        # From understanding to multi-perspective validation
learn decompose -> /spec add         # From pattern discovery to spec inclusion
learn consult -> learn investigate   # From retrospective finding to deep investigation
learn investigate -> learn follow    # From problem identification to deep reading
learn consult -> learn decompose     # From challenge to systematic decomposition
```
