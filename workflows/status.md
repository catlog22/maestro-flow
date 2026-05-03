# Workflow: status

Status dashboard with intelligent routing.

---

## Step 1: Load State

1. Check `.workflow/state.json` exists:
   - If missing → display "No project initialized. Run `/workflow:init` to start." → exit

2. Read `.workflow/state.json`:
   - Extract: project_name, current_milestone, status, milestones, artifacts
   - Derive current_phase and phases_summary from artifacts[] (see src/utils/state-schema.ts)
   - Extract: accumulated_context (key_decisions, blockers, deferred)

3. Read `.workflow/roadmap.md`:
   - Extract phase list with titles

4. Load Issue State from `.workflow/issues/issues.jsonl` (if exists):
   ```
   Compute: by_status (registered/diagnosed/planning/planned/executing counts),
     by_severity (critical/high/medium/low counts),
     total_open (exclude completed/failed/deferred),
     critical_open + critical_issues list {id, title, status}
   ```
   If file missing → issue_state = null

---

## Step 2: Build Virtual Phase View from Artifact Registry

Derive phase progress from `state.json.artifacts[]`:

```
milestone_artifacts = artifacts filtered by current_milestone
phases_from_roadmap = parse roadmap.md → { number, slug, title }

Per phase: check completed artifact types (analyze/plan/execute/verify)
  → derive status: verified > executed > planned > analyzed > pending
  → get task counts from plan artifact's plan.json if available

Output: phases[] = { number, slug, title, status, tasks_total, tasks_completed, has_verify }
Also collect: adhoc_artifacts (scope == "adhoc")
```

---

## Step 2.5: Artifact Registry Consistency Check

```
If roadmap exists → warn if any artifacts reference phases not in roadmap (orphan check)
If roadmap missing but artifacts exist → warn: may indicate completed milestone, suggest /maestro continue
```

---

## Step 3: Compute Progress

```
Count phases by status: completed, executing, planning, exploring, pending, blocked
progress_pct = (completed / total) * 100
```

---

## Step 4: Display Dashboard

```
PROJECT / MILESTONE / STATUS / PROGRESS bar ({completed}/{total} phases)
Per phase: [{status_icon}] Phase {N}: {title} — status, task counts, verification
CONTEXT: key_decisions, blockers, deferred
```

### Step 4.1: Render Issue Summary

If issue_state exists: display ISSUES panel (open count, critical count, by-status breakdown, critical issues list).
- Omit critical sub-section if none. Note blockers→issues migration if applicable. Note deferred items.

If issue_state is null: "No issues tracked. Use /manage-issue create or /maestro-verify to discover issues."

Status icons:
- `[x]` completed
- `[>]` executing / in_progress
- `[~]` planning / exploring
- `[ ]` pending
- `[!]` blocked

### Step 4.2: Render Worktree Status

```
If .workflow/worktree-scope.json exists → WORKTREE MODE panel: milestone, branch, owned_phases, main_worktree
Else if .workflow/worktrees.json has active entries → ACTIVE WORKTREES panel: milestone/branch/path per worktree,
  with sync (/maestro-fork --sync) and merge (/maestro-merge) hints
```

---

## Step 5: Route Next Step

### Step 5.0: Issue-Aware Routing

If issue_state exists, evaluate BEFORE status routing:
- critical_open > 0 → suggest manage-issue list --severity critical, quality-debug --from-uat
- diagnosed > 0 → suggest maestro-plan --gaps
- registered > 0 → suggest quality-debug

### Step 5.1: Status-Based Routing

Based on current project state, suggest the next command:

| Current State | Suggested Command |
|---|---|
| No phases planned | /maestro-brainstorm 1 or /maestro-plan 1 |
| Phase pending, needs analysis | /maestro-analyze \<N\> |
| Phase pending, needs decisions | /maestro-analyze \<N\> -q |
| Phase planned, not executed | /maestro-execute \<N\> |
| Phase executing, tasks blocked | /quality-debug \<N\> |
| Phase executed, not verified | /maestro-verify \<N\> |
| Phase verified with gaps | /maestro-plan \<N\> --gaps |
| Phase verified, not reviewed | /quality-review \<N\> |
| Phase reviewed, BLOCK verdict | /maestro-plan \<N\> --gaps |
| Phase reviewed, PASS/WARN | /quality-test \<N\> |
| Low test coverage | /quality-auto-test \<N\> |
| UAT passed, all phases done | /maestro-milestone-audit |
| UAT has failures | /quality-debug --from-uat \<N\> |
| Need integration tests | /quality-auto-test \<N\> |
| All milestone phases complete | /maestro-milestone-audit |
| Milestone audit passed | /maestro-milestone-complete |
| Ad-hoc small task | /maestro-quick \<task\> |

Display:
```
NEXT STEP: {suggested_command}
  {reason}
```

If there are blockers, display them prominently before the routing suggestion.

---

## Step 6: Scratch Tasks (if any)

Check `.workflow/scratch/` for active tasks:

1. For each `scratch/*/index.json` where status != "completed":
   - Display: type, title, status, progress
2. If active scratch tasks exist:
   - Note: "Active scratch tasks found. These are independent of phase pipeline."
