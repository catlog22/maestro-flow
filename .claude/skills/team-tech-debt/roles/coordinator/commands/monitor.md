# Monitor Pipeline

Event-driven pipeline coordination. Beat model: coordinator wake -> process -> spawn -> STOP.

## Constants

- SPAWN_MODE: background
- ONE_STEP_PER_INVOCATION: true
- FAST_ADVANCE_AWARE: true
- WORKER_AGENT: team-worker
- MAX_GC_ROUNDS: 3

## Handler Router

| Source | Handler |
|--------|---------|
| Message contains [scanner], [assessor], [planner], [executor], [validator] | handleCallback |
| "capability_gap" | handleAdapt |
| "check" or "status" | handleCheck |
| "resume" or "continue" | handleResume |
| All tasks completed | handleComplete |
| Default | handleSpawnNext |

## handleCallback

Worker completed. Process and advance.

1. Find matching worker by role tag in message
2. Check if progress update (inner loop) or final completion
3. Progress update -> update session state, STOP
4. Completion -> mark task done:
   ```
   TaskUpdate({ taskId: "<task-id>", status: "completed" })
   ```
5. Remove from active_workers, record completion in session

6. Check for checkpoints:
   - **TDPLAN-001 completes** -> Plan Approval Gate:
     ```
     AskUserQuestion({
       questions: [{ question: "Remediation plan generated. Review and decide:",
         header: "Plan Review", multiSelect: false,
         options: [
           { label: "Approve", description: "Proceed with fix execution" },
           { label: "Revise", description: "Re-run planner with feedback" },
           { label: "Abort", description: "Stop pipeline" }
         ]
       }]
     })
     ```
     - Approve -> Worktree Creation -> handleSpawnNext
     - Revise -> Create TDPLAN-revised task -> handleSpawnNext
     - Abort -> Log shutdown -> handleComplete

   - **Worktree Creation** (before TDFIX):
     ```
     Bash("git worktree add .worktrees/TD-<slug>-<date> -b tech-debt/TD-<slug>-<date>")
     ```
     Update .msg/meta.json with worktree info.

   - **TDVAL-* completes** -> GC Loop Check:
     Read validation results from .msg/meta.json

     | Condition | Action |
     |-----------|--------|
     | No regressions | -> handleSpawnNext (pipeline complete) |
     | Regressions AND gc_rounds < 3 | Create fix-verify tasks, increment gc_rounds |
     | Regressions AND gc_rounds >= 3 | Accept current state -> handleComplete |

     Fix-Verify Task Creation:
     ```
     TaskCreate({ subject: "TDFIX-fix-<round>", description: "PURPOSE: Fix regressions | Session: <session>" })
     TaskCreate({ subject: "TDVAL-recheck-<round>", description: "..." })
     TaskUpdate({ taskId: "TDVAL-recheck-<round>", addBlockedBy: ["TDFIX-fix-<round>"] })
     ```

7. -> handleSpawnNext

## handleCheck

Read-only status report, then STOP.

```
Pipeline Status (<mode>):
  [DONE]  TDSCAN-001  (scanner)   -> scan complete
  [DONE]  TDEVAL-001  (assessor)  -> assessment ready
  [RUN]   TDPLAN-001  (planner)   -> planning...
  [WAIT]  TDFIX-001   (executor)  -> blocked by TDPLAN-001
  [WAIT]  TDVAL-001   (validator) -> blocked by TDFIX-001

GC Rounds: 0/3
Session: <session-id>
Commands: 'resume' to advance | 'check' to refresh
```

Output status -- do NOT advance pipeline.

## handleResume

1. Audit task list:
   - Tasks stuck in "in_progress" -> reset to "pending"
   - Tasks with completed blockers but still "pending" -> include in spawn list
2. -> handleSpawnNext

## handleSpawnNext

Find ready tasks, spawn workers, STOP.

1. Collect: completedSubjects, inProgressSubjects, readySubjects (pending + all blockedBy completed)
2. No ready + work in progress -> report waiting, STOP
3. No ready + nothing in progress -> handleComplete
4. Has ready -> for each:
   a. Check inner loop role with active worker -> skip (worker picks up)
   b. TaskUpdate -> in_progress
   c. team_msg log -> task_unblocked
   d. Spawn team-worker:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "tech-debt",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: ~  or <project>/.claude/skills/team-tech-debt/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: tech-debt
requirement: <task-description>
inner_loop: <true|false>

Read role_spec file to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

Stage-to-role mapping:
| Task Prefix | Role |
|-------------|------|
| TDSCAN | scanner |
| TDEVAL | assessor |
| TDPLAN | planner |
| TDFIX | executor |
| TDVAL | validator |

5. Add to active_workers, update session, output summary, STOP

## handleComplete

Pipeline done. Generate report and completion action.

1. Verify all tasks (including fix-verify tasks) have status "completed"
2. If any not completed -> handleSpawnNext
3. If all completed:
   - Read final state from .msg/meta.json
   - If worktree exists and validation passed: commit, push, gh pr create, cleanup worktree
   - Compile summary: total tasks, completed, gc_rounds, debt_score_before, debt_score_after
   - Transition to coordinator Phase 5

## handleAdapt

Capability gap reported mid-pipeline.

1. Parse gap description
2. Check if existing role covers it -> redirect
3. Role count < 5 -> generate dynamic role spec in <session>/role-specs/
4. Create new task, spawn worker
5. Role count >= 5 -> merge or pause

## Fast-Advance Reconciliation

On every coordinator wake:
1. Read team_msg entries with type="fast_advance"
2. Sync active_workers with spawned successors
3. No duplicate spawns
