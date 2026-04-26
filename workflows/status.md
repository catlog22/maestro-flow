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

4. Load Issue State:
   - If `.workflow/issues/issues.jsonl` exists:
     - Read all lines, parse each as JSON
     - Compute statistics:
       ```
       by_status: {
         registered: count(status == "registered"),
         diagnosed:  count(status == "diagnosed"),
         planning:   count(status == "planning"),
         planned:    count(status == "planned"),
         executing:  count(status == "executing")
       }
       by_severity: {
         critical: count(severity == "critical"),
         high:     count(severity == "high"),
         medium:   count(severity == "medium"),
         low:      count(severity == "low")
       }
       total_open:    count where status NOT in [completed, failed, deferred]
       critical_open: count where severity == "critical" AND status NOT in [completed, failed, deferred]
       critical_issues: list of {id, title, status} where severity == "critical" AND status NOT in [completed, failed, deferred]
       ```
     - Store as issue_state
   - Else:
     - issue_state = null (no issues tracked)

---

## Step 2: Build Virtual Phase View from Artifact Registry

Derive phase progress from `state.json.artifacts[]`:

```
// Group artifacts by phase for current milestone
milestone_artifacts = state.json.artifacts.filter(a => a.milestone == current_milestone)

// Build phase view from roadmap + artifact registry
phases_from_roadmap = parse roadmap.md → list of { number, slug, title }

FOR each phase IN phases_from_roadmap:
  phase_artifacts = milestone_artifacts.filter(a => a.phase == phase.number)
  has_analyze = phase_artifacts.some(a => a.type == "analyze" && a.status == "completed")
  has_plan = phase_artifacts.some(a => a.type == "plan" && a.status == "completed")
  has_execute = phase_artifacts.some(a => a.type == "execute" && a.status == "completed")
  has_verify = phase_artifacts.some(a => a.type == "verify" && a.status == "completed")

  // Derive status from artifact chain
  status = has_verify ? "verified" :
           has_execute ? "executed" :
           has_plan ? "planned" :
           has_analyze ? "analyzed" :
           "pending"

  // Get task counts from plan artifacts
  plan_artifact = phase_artifacts.find(a => a.type == "plan" && a.status == "completed")
  IF plan_artifact:
    plan_json = read .workflow/{plan_artifact.path}/plan.json
    tasks_total = plan_json.task_ids.length
    tasks_completed = count .task/TASK-*.json where status == "completed"

phases[] = { number, slug, title, status, tasks_total, tasks_completed, has_verify }

// Also show adhoc artifacts
adhoc_artifacts = milestone_artifacts.filter(a => a.scope == "adhoc")
```

---

## Step 2.5: Artifact Registry Consistency Check

```
IF .workflow/roadmap.md exists:
  roadmap_phases = parse phase headings from roadmap.md (count "### Phase N:" entries)
  artifact_phases = unique phase numbers from milestone_artifacts

  // Check for unregistered work (artifacts without matching roadmap phases)
  orphan_artifacts = milestone_artifacts.filter(a => a.phase && !roadmap_phases.includes(a.phase))
  IF orphan_artifacts.length > 0:
    Display WARNING: "Artifacts reference phases not in roadmap"

ELSE IF NOT .workflow/roadmap.md exists AND milestone_artifacts.length > 0:
  Display WARNING:
    ⚠️  Roadmap missing but artifact registry has {milestone_artifacts.length} entries.
    This may indicate a completed milestone. Run /maestro continue to plan next milestone.
```

---

## Step 3: Compute Progress

1. Count by status:
   ```
   total     = phases.length
   completed = phases.filter(status == "completed").length
   executing = phases.filter(status == "executing").length
   planning  = phases.filter(status == "planning").length
   exploring = phases.filter(status == "exploring").length
   pending   = phases.filter(status == "pending").length
   blocked   = phases.filter(status == "blocked").length
   ```

2. Calculate overall progress:
   ```
   progress_pct = (completed / total) * 100
   ```

---

## Step 4: Display Dashboard

```
====================================================
  PROJECT: {project_name}
  MILESTONE: {current_milestone}
  STATUS: {status}
  PROGRESS: [{progress_bar}] {completed}/{total} phases ({progress_pct}%)
====================================================

PHASES:
  {for each phase}
  [{status_icon}] Phase {number}: {title}
      Status: {status}
      Tasks: {tasks_completed}/{tasks_total}
      Verification: {verification_status}
  {/for}

CONTEXT:
  Key Decisions: {key_decisions, comma-separated}
  Blockers: {blockers or "none"}
  Deferred: {deferred or "none"}

====================================================
```

### Step 4.1: Render Issue Summary

If issue_state is not null:

```
┌─────────────────────────────────────────┐
│ ISSUES                                  │
├─────────────────────────────────────────┤
│ Open: {total_open}                      │
│   Critical: {critical_open}             │
│   By Status:                            │
│     registered: {N} | diagnosed: {N}    │
│     planning: {N}   | planned: {N}      │
│     executing: {N}                      │
│                                         │
│ Critical Issues:                        │
│   {id} | {title (truncated 40ch)} | {status}  │
│   ...                                   │
└─────────────────────────────────────────┘
```

If critical_issues is empty, omit the "Critical Issues:" sub-section.

If accumulated_context.blockers is non-empty AND issue_state has critical issues:
  - Print: "Note: Blockers are now tracked as critical issues in .workflow/issues/issues.jsonl"

If accumulated_context.deferred is non-empty:
  - Print: "Note: Deferred items are tracked as deferred issues. Use /manage-issue list --status deferred"

Else (issue_state is null):
  - Print: "ISSUES: No issues tracked. Use /manage-issue create or /maestro-verify to discover issues."

Status icons:
- `[x]` completed
- `[>]` executing / in_progress
- `[~]` planning / exploring
- `[ ]` pending
- `[!]` blocked

### Step 4.2: Render Worktree Status

```
IF file_exists(".workflow/worktree-scope.json"):
  // Running inside a worktree
  Read .workflow/worktree-scope.json → scope
  Display:
    ┌─────────────────────────────────────────┐
    │ WORKTREE MODE                           │
    ├─────────────────────────────────────────┤
    │ Milestone: {scope.milestone}            │
    │ Branch:    {scope.branch}               │
    │ Phases:    {scope.owned_phases}         │
    │ Main:      {scope.main_worktree}        │
    └─────────────────────────────────────────┘

ELSE IF file_exists(".workflow/worktrees.json"):
  // Running in main worktree with active worktrees
  Read .workflow/worktrees.json → registry
  activeWorktrees = registry.worktrees.filter(w => w.status === "active")

  IF activeWorktrees.length > 0:
    Display:
      ┌─────────────────────────────────────────┐
      │ ACTIVE WORKTREES                        │
      ├─────────────────────────────────────────┤
      {for each wt in activeWorktrees}
      │ {wt.milestone} | {wt.branch} | {wt.path} │
      {/for}
      │                                         │
      │ Sync:  /maestro-fork <milestone> --sync │
      │ Merge: /maestro-merge <milestone>       │
      └─────────────────────────────────────────┘
```

---

## Step 5: Route Next Step

### Step 5.0: Issue-Aware Routing

If issue_state is not null, evaluate issue-based recommendations BEFORE status routing:

If critical_open > 0:
  - Recommend: "{critical_open} critical issues require attention"
  - Suggest: Skill({ skill: "manage-issue", args: "list --severity critical" })
  - Suggest: Skill({ skill: "quality-debug", args: "--from-uat" })

If by_status.diagnosed > 0:
  - Recommend: "{diagnosed} issues diagnosed and ready for planning"
  - Suggest: Skill({ skill: "maestro-plan", args: "--gaps" })

If by_status.registered > 0:
  - Recommend: "{registered} new issues need investigation"
  - Suggest: Skill({ skill: "quality-debug" })

### Step 5.1: Status-Based Routing

Based on current project state, suggest the next command:

```
NEXT-STEP DECISION TABLE:
-------------------------------------------------------------
Current State                        | Suggested Command                  | Reason
-------------------------------------------------------------
No phases planned                    | /maestro-brainstorm 1 or /maestro-plan 1 | Explore ideas or start planning first phase
Phase pending, needs analysis        | /maestro-analyze <N>               | Evaluate feasibility before planning
Phase pending, needs decisions       | /maestro-analyze <N> -q            | Quick decision extraction
Phase planned, not executed          | /maestro-execute <N>               | Execute the planned phase
Phase executing, tasks blocked       | /quality-debug <N>                 | Unblock stuck tasks
Phase executed, not verified         | /maestro-verify <N>                | Verify execution results
Phase verified with gaps             | /maestro-plan <N> --gaps           | Plan gap fixes
Phase verified, not reviewed         | /quality-review <N>                | Code quality review before UAT
Phase reviewed, verdict BLOCK        | /maestro-plan <N> --gaps           | Fix critical review findings first
Phase reviewed, verdict PASS/WARN    | /quality-test <N>                  | Proceed to UAT testing
Phase verified, low test coverage    | /quality-test-gen <N>              | Generate missing automated tests
UAT passed, all phases done          | /maestro-milestone-audit           | Cross-phase integration check
UAT has failures                     | /quality-debug --from-uat <N>      | Debug UAT gaps with parallel agents
Need integration test cycle          | /quality-integration-test <N>      | Self-iterating integration tests
All phases in milestone complete     | /maestro-milestone-audit           | Cross-phase integration check
Milestone audit passed               | /maestro-milestone-complete        | Archive milestone, advance
Ad-hoc small task                    | /maestro-quick <task>              | Quick execute without full pipeline
-------------------------------------------------------------
```

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
