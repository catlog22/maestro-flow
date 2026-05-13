---
name: learn-retro
description: Retrospective of git activity and decision quality
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
Unified retrospective combining git activity analysis and decision quality evaluation. Works on raw git history and wiki/spec data. Two lenses (git, decision), usable independently or together.

All insights persist to `specs/learnings.md` as `<spec-entry>` blocks.
</purpose>

<context>
$ARGUMENTS — lens selection and scope flags.

**Lens**: `--lens git` | `--lens decision` | `--lens all` (default: all)

**Git lens flags**: `--days N` (default: 7), `--author <name>`, `--area <path>`, `--compare` (vs prior retro)
**Decision lens flags**: `--phase N`, `--tag <tag>`, `--id <id>` (single decision by wiki/INS id)

**Storage write**:
- `.workflow/knowhow/KNW-retro-{date}.md` — unified report
- `.workflow/knowhow/KNW-retro-{date}.json` — structured metrics
- `specs/learnings.md` — appended `<spec-entry>` blocks (source: retro-git / retro-decision)

**Storage read**: git history, `.workflow/state.json`, prior `KNW-retro-*.json`, `specs/learnings.md`, wiki specs, `architecture-constraints.md`, phase context files
</context>

<state_machine>

<states>
S_PARSE       — 解析 lens + flags                           PERSIST: —
S_GIT         — git 活动分析（lens=git/all 时）              PERSIST: metrics
S_DECISION    — 决策质量评估（lens=decision/all 时）         PERSIST: evaluations
S_REPORT      — 生成统一报告                                 PERSIST: .md + .json
S_PERSIST     — 写 spec-entry 块                             PERSIST: specs/learnings.md
</states>

<transitions>

S_PARSE:
  → S_GIT         WHEN: lens == git OR all               DO: ensure .workflow/knowhow/ exists (mkdir -p)
  → S_DECISION    WHEN: lens == decision                  DO: ensure .workflow/knowhow/ exists (mkdir -p)

S_GIT:
  → S_DECISION    WHEN: lens == all                          DO: A_GIT_ANALYSIS
  → S_REPORT      WHEN: lens == git                          DO: A_GIT_ANALYSIS

S_DECISION:
  → S_REPORT      DO: A_DECISION_ANALYSIS

S_REPORT:
  → S_PERSIST     DO: write KNW-retro-{date}.md + .json

S_PERSIST:
  → END           DO: append insights to specs/learnings.md via `maestro spec add learning`
  RULE: INS-id = hash(lens + metric_or_decision_id + date) for cross-session stability

</transitions>

<actions>

### A_GIT_ANALYSIS

**Parallel git commands**:
```bash
git log --since="{start}" --format="%H|%aN|%ae|%ai|%s" --shortstat
git log --since="{start}" --format="COMMIT:%H|%aN" --numstat
git log --since="{start}" --format="%at|%aN|%ai|%s" | sort -n
git log --since="{start}" --format="" --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20
git shortlog --since="{start}" -sn --no-merges
```
Apply --author and --area filters.

**Compute metrics**:

| Metric | Formula |
|--------|---------|
| Test ratio | test_insertions / total_insertions * 100% |
| Churn rate | files changed >2x / total unique files |
| Sessions | Cluster commits by >2hr gaps in timestamps |
| LOC/session-hour | net_loc / total_session_hours |

**Per-author breakdown**: commits, LOC, top 3 areas, test ratio, session count.

**Trend** (if --compare or prior KNW-retro-*.json exists): compute deltas, flag >20% changes.

**Distill insights**: high churn files (instability), low test ratio areas (<20%), session patterns, area drift vs roadmap.

### A_DECISION_ANALYSIS

**Collect** (parallel):
```bash
maestro wiki search "decision" --json
maestro wiki list --type spec --json
git log --oneline --all --grep="decision\|chose\|decided" -20
```
Plus: architecture-constraints.md, phase context Locked/Deferred sections, specs/learnings.md.
Apply --phase/--tag/--id filters.

**Build registry** per decision: id, title, source, date, rationale, alternatives, phase, implementation_evidence [file paths].

**Evaluate** — spawn 3 Agents in single message:

| Agent | Dimension | Grades |
|-------|-----------|--------|
| Technical Soundness | Implementation matches intent? Context changed? | sound / degraded / violated |
| Cost Assessment | Complexity added? Coupling/debt? | low-cost / acceptable / expensive / debt-creating |
| Alternative Hindsight | Right call with current knowledge? Reversible? | confirmed / questionable / should-revisit |

**Classify lifecycle**:

| Status | Criteria |
|--------|---------|
| Validated | sound + low/acceptable + confirmed |
| Aging | sound + expensive + confirmed |
| Questionable | degraded/violated + questionable |
| Stale | any + should-revisit |
| Reversed | code contradicts decision |

**Recommend**: Aging → tech debt review, Questionable → create issue, Stale → refresh, Reversed → document reversal.

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | Not in git repo (git lens) | Navigate to git repo |
| E002 | No commits in window (git lens) | Increase --days |
| E003 | No decisions found (decision lens) | Check wiki/specs or provide --id |
| E004 | --id not found in wiki or knowhow | Verify the decision ID exists |
| W002 | No prior retro for comparison | Skip trend; first retro = baseline |
| W003 | One perspective agent failed | Proceed with available perspectives |
</error_codes>

<success_criteria>
- [ ] Git lens: metrics computed (commits, LOC, test ratio, churn, sessions), insights distilled
- [ ] Decision lens: decisions collected, 3 agents evaluated in parallel, lifecycle classified
- [ ] Unified report + structured JSON written
- [ ] specs/learnings.md appended with stable INS-ids
</success_criteria>

<next_step_routing>
- Browse insights → `/manage-learn list --tag retro`
- Deep dive churn → `/learn-follow <path>`
- Fix test gaps → `/quality-auto-test <area>`
- Investigate stale decision → `/learn-investigate <question>`
</next_step_routing>
