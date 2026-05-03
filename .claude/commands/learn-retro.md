---
name: learn-retro
description: Unified retrospective — git activity metrics and decision quality evaluation with lens-based selection
argument-hint: "[--lens git|decision|all] [--days N] [--author <name>] [--area <path>] [--phase N] [--tag <tag>] [--id <id>] [--compare]"
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
Unified retrospective that combines git activity analysis and decision quality evaluation into a single command with lens-based selection. Works on raw git history and wiki/spec data — does not require completed phase artifacts (unlike `quality-retrospective`).

Two lenses, usable independently or together:
- **git**: Commit metrics, session detection, per-author breakdown, file hotspots, trend tracking
- **decision**: Decision tracing across wiki/specs/git, multi-perspective evaluation, lifecycle classification

All insights persist to `.workflow/learning/lessons.jsonl` for cross-session queryability via `manage-learn`.
</purpose>

<context>
Arguments: $ARGUMENTS

**Lens selection:**
- `--lens git` — Git activity retrospective only
- `--lens decision` — Decision evaluation only
- `--lens all` — Both lenses (default)

**Git lens flags:**
- `--days N` — Time window in days (default: 7)
- `--author <name>` — Filter commits by author name (substring match)
- `--area <path>` — Scope to files under a specific directory
- `--compare` — Compare against the previous retro report if one exists

**Decision lens flags:**
- `--phase N` — Decisions from phase N's context and related specs
- `--tag <tag>` — Decisions tagged with specific tag in wiki/specs
- `--id <id>` — Single decision by wiki ID or lessons.jsonl INS-id

**Storage written:**
- `.workflow/learning/retro-{YYYY-MM-DD}.md` — Unified human-readable report
- `.workflow/learning/retro-{YYYY-MM-DD}.json` — Structured metrics (machine-readable)
- `.workflow/learning/lessons.jsonl` — Appended insights (source: "retro-git" or "retro-decision")
- `.workflow/learning/learning-index.json` — Updated index

**Storage read:**
- `.workflow/state.json` — Current phase context (optional)
- `.workflow/learning/retro-*.json` — Prior retro for trend comparison
- `.workflow/learning/lessons.jsonl` — Existing insights for dedup
- `maestro wiki list --type spec --json` — Spec entries (decision lens)
- `.workflow/specs/architecture-constraints.md` — Documented architectural decisions (decision lens)
- Phase context with Locked/Free/Deferred decisions (decision lens) — resolve via `state.json.artifacts[]` scratch paths
</context>

<execution>

### Stage 1: Parse Arguments & Select Lenses
- Parse `--lens` flag: `git`, `decision`, or `all` (default: `all`)
- Extract lens-specific flags
- Check `.workflow/learning/` exists; bootstrap if missing

Display banner:
```
============================================================
  LEARN RETRO
============================================================
  Lens:    {git | decision | all}
  Scope:   {days/author/area for git} {phase/tag/id for decision}
```

---

### Stage 2: Git Lens (skip if --lens decision)

#### 2a: Gather Raw Data (parallel git commands)
Run ALL these git commands in parallel:

```bash
# Commit stats with author, timestamp, subject, files changed
git log --since="<start-date>T00:00:00" --format="%H|%aN|%ae|%ai|%s" --shortstat

# Per-commit numstat for test vs production LOC split
git log --since="<start-date>T00:00:00" --format="COMMIT:%H|%aN" --numstat

# Timestamps for session detection (sorted)
git log --since="<start-date>T00:00:00" --format="%at|%aN|%ai|%s" | sort -n

# File hotspots (most frequently changed files)
git log --since="<start-date>T00:00:00" --format="" --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20

# Per-author commit counts
git shortlog --since="<start-date>T00:00:00" -sn --no-merges
```

Apply `--author` and `--area` filters if provided.

#### 2b: Compute Metrics
| Metric | Computation |
|--------|-------------|
| Commits | Count of non-merge commits |
| Contributors | Unique author count |
| Total insertions / deletions | Sum from shortstat |
| Net LOC | insertions - deletions |
| Test LOC (insertions) | Sum insertions for test files from numstat |
| Test ratio | test_insertions / total_insertions x 100% |
| Churn rate | Files changed >2 times / total unique files |
| Active days | Distinct dates with commits |

#### 2c: Detect Work Sessions
Cluster commits by >2hr gaps in timestamps:
- Per session: start time, end time, duration, commit count, primary focus area
- Compute: total sessions, avg session duration, avg LOC/session-hour

#### 2d: Per-Author Breakdown
For each author:
- Commit count, LOC added/removed, top 3 file areas
- Test ratio (their test LOC / their total LOC)
- Session count and patterns

#### 2e: Trend Comparison (if --compare or prior report exists)
- Find most recent `.workflow/learning/retro-*.json`
- Compute deltas: commits, LOC, test ratio, churn rate, session count
- Flag significant changes (>20% delta) as trend highlights

#### 2f: Distill Git Insights
- **High churn files** (changed >3 times): instability signal
- **Low test ratio areas** (<20%): testing gap
- **Session patterns**: scattered vs deep sessions
- **Area drift**: commits not aligned with current roadmap phase

Each insight: title, description, category (pattern/antipattern/technique), tags, confidence.

---

### Stage 3: Decision Lens (skip if --lens git)

#### 3a: Collect Decisions (parallel)
```bash
maestro wiki search "decision" --json
maestro wiki list --type spec --json
git log --oneline --all --grep="decision\|chose\|decided\|architecture" -20
```

Also read:
- `.workflow/specs/architecture-constraints.md` — grep for `<spec-entry category="arch"` blocks
- Phase context files — resolve via `state.json.artifacts[]` scratch paths — scan for "Locked:", "Deferred:" sections
- `.workflow/learning/lessons.jsonl` — filter `category == "decision"`

Apply scope filter (--phase, --tag, --id).

#### 3b: Build Decision Registry
Per decision:
```json
{
  "id": "source id",
  "title": "what was decided",
  "source": "wiki|spec|phase-context|lesson|git",
  "date": "when decided",
  "rationale": "why",
  "alternatives": "what was considered",
  "phase": "which phase",
  "implementation_evidence": ["file paths from git"]
}
```

#### 3c: Multi-Perspective Evaluation
Spawn 3 Agents in a single message:

**Agent 1 — Technical Soundness:**
- Does implementation match stated intent?
- Has technical context changed since decision was made?
- Grade: sound / degraded / violated

**Agent 2 — Cost Assessment:**
- What complexity did this decision add?
- Is it creating coupling or tech debt?
- Grade: low-cost / acceptable / expensive / debt-creating

**Agent 3 — Alternative Hindsight:**
- With what we know now, was this the right call?
- Would reversing be feasible?
- Grade: confirmed / questionable / should-revisit

#### 3d: Classify Decision Lifecycle
| Status | Criteria |
|--------|---------|
| **Validated** | Sound + Low/Acceptable cost + Confirmed |
| **Aging** | Sound but Expensive + Confirmed |
| **Questionable** | Degraded or Violated + Questionable |
| **Stale** | Any + Should-revisit |
| **Reversed** | Code contradicts the decision |

#### 3e: Generate Recommendations
- **Aging**: flag for tech debt review
- **Questionable**: create issue for investigation
- **Stale**: suggest decision refresh
- **Reversed**: suggest documenting the reversal

---

### Stage 4: Unified Report

Write `.workflow/learning/retro-{date}.md`:

```markdown
# Retrospective: {date}
**Lenses:** {active lenses} | **Period:** {days}d

## Git Activity  (if git lens active)
### Metrics
| Metric | Value | Trend |
|--------|-------|-------|
| Commits | N | +/-% |
| ...

### Work Sessions
{session timeline}

### File Hotspots
{top 10 most-changed files}

### Per-Author
{author breakdown table}

## Decision Health  (if decision lens active)
### Dashboard
| Status | Count | Decisions |
|--------|-------|-----------|
| Validated | N | {list} |
| Aging | N | {list} |
| ...

### Per-Decision Evaluation
{detailed evaluations}

## Combined Insights
{merged insights from both lenses, deduplicated}

## Recommended Actions
1. {action}: {reason}
```

Write `.workflow/learning/retro-{date}.json` with structured data.

---

### Stage 5: Persist
1. Write report files
2. Append insights to `lessons.jsonl`:
   - Git insights: `source: "retro-git"`, `category` per insight type
   - Decision insights: `source: "retro-decision"`, `category: "decision"`
   - Stable INS-id from `hash(lens + metric_or_decision + date)`
3. Update `learning-index.json`
4. Display summary

**Next-step routing:**
- Browse insights → `/manage-learn list --tag retro`
- Deep dive on high-churn file → `/learn-follow <path>`
- Fix test gaps → `/quality-auto-test <area>`
- Create issue for questionable decision → `/manage-issue create ...`
- Investigate stale decision → `/learn-investigate <question>`
- Full phase retrospective → `/quality-retrospective`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Not inside a git repository (git lens) | Navigate to a git repo directory |
| E002 | error | No commits found in time window (git lens) | Increase --days or check filters |
| E003 | error | No decisions found in any source (decision lens) | Check wiki/specs content, or provide --id |
| E004 | error | --id not found in wiki or lessons (decision lens) | Verify the decision ID exists |
| W001 | warning | `.workflow/learning/` not found, bootstrapping | Auto-created; proceed normally |
| W002 | warning | No prior retro report for comparison | Skip trend section; first retro establishes baseline |
| W003 | warning | One perspective agent failed — partial evaluation (decision lens) | Proceed with available perspectives |
| W004 | warning | No git implementation evidence for a decision | Evaluation is theoretical only |
| W005 | warning | Phase context files not found (decision lens) | Skip phase-context decisions |
</error_codes>

<success_criteria>
- [ ] Lens selection parsed correctly (git / decision / all)
- [ ] Git lens (if active):
  - [ ] All git commands executed successfully
  - [ ] Metrics computed: commits, LOC, test ratio, churn rate, sessions
  - [ ] Sessions detected with >2hr gap clustering
  - [ ] Per-author breakdown generated
  - [ ] Trend comparison computed if prior report exists
  - [ ] At least 1 actionable insight distilled
- [ ] Decision lens (if active):
  - [ ] Decisions collected from available sources
  - [ ] Scope filter applied correctly
  - [ ] 3 perspective agents spawned in parallel
  - [ ] Each decision classified by lifecycle status
  - [ ] Recommendations generated for non-Validated decisions
- [ ] Unified report written to `retro-{date}.md`
- [ ] Structured data written to `retro-{date}.json`
- [ ] `lessons.jsonl` appended with insights (stable INS-ids)
- [ ] `learning-index.json` updated
- [ ] No files modified outside `.workflow/learning/`
- [ ] Summary displayed with next-step routing
</success_criteria>
