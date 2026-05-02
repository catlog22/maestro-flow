---
name: maestro-ralph
description: Closed-loop lifecycle decision engine — read project state, infer position, build adaptive command chain with decision/skill/cli nodes
argument-hint: "\"intent\" | status | continue"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---
<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Reads project state → infers lifecycle position → builds command chain with three node types:
- **decision**: Hand back to ralph for re-evaluation (adaptive branching)
- **skill**: In-session Skill() call (synchronous, lightweight)
- **cli**: CLI delegate call via `maestro delegate` (context-isolated, heavy)

Decision nodes at key checkpoints enable dynamic chain expansion —
ralph re-reads actual execution result files, then decides whether to append debug+fix loops or proceed.

Key difference from maestro coordinator:
- maestro: static chainMap → one-time selection → chain-execute runs all steps
- ralph: living chain → decision nodes re-evaluate after each critical step → chain grows/shrinks dynamically

Produces session at `.workflow/.ralph/ralph-{YYYYMMDD-HHmmss}/status.json`.
Mutual invocation with `/maestro-ralph-execute` forms a persistent self-perpetuating work loop.
</purpose>

<context>
$ARGUMENTS — user intent text, or keywords.

**Keywords:**
- `status` — Display current ralph session progress. **End.**
- `continue` — Find latest running session → `Skill({ skill: "maestro-ralph-execute" })`. **End.**

**Decision-node trigger detection:**
If a running ralph session exists AND `commands[current].type == "decision"` AND `commands[current].status == "running"`:
→ Enter **Decision Evaluation Mode** (Step 2b) instead of New Session Mode.

**State files read:**
- `.workflow/state.json` — artifact registry, milestone, phase status
- `.workflow/roadmap.md` — milestone/phase structure
- `.workflow/.ralph/ralph-*/status.json` — ralph session state
</context>

<execution>

## Step 1: Parse & Route

```
Parse $ARGUMENTS:
  "status"   → handleStatus(). End.
  "continue" → handleContinue(). End.
  
Check running ralph session:
  Scan .workflow/.ralph/ralph-*/status.json for status == "running"
  If found AND commands[current].type == "decision" AND commands[current].status == "running":
    → Step 2b (Decision Evaluation Mode)
  Else if $ARGUMENTS is non-empty:
    → Step 2a (New Session Mode)
  Else:
    → AskUserQuestion: "请描述目标，或输入 status/continue"
```

### handleStatus()
```
Scan .workflow/.ralph/ralph-*/status.json (latest by created_at)
Display:
  Session:  {id}
  Status:   {status}
  Position: {lifecycle_position}
  Progress: {completed}/{total} commands
  Current:  [{current}] {commands[current].skill} [{commands[current].type}]
  
  Commands:
    [✓] 0. maestro-analyze 1         [skill]
    [▸] 1. maestro-plan 1            [skill]
    [ ] 2. maestro-execute 1         [cli]
    ...
```

### handleContinue()
```
Find latest running ralph session
If not found → "无运行中的 ralph 会话"
Skill({ skill: "maestro-ralph-execute" })
```

---

## Step 2a: New Session Mode

### 2a.1: Read project state

Read `.workflow/state.json`. Extract:

```
state.json actual schema:
{
  "current_milestone": "MVP",
  "milestones": [{ "id": "M1", "name": "MVP", "status": "active", "phases": [1, 2] }],
  "artifacts": [
    {
      "id": "ANL-001",
      "type": "analyze",       // analyze | plan | execute | verify
      "milestone": "MVP",
      "phase": 1,
      "scope": "phase",        // phase | milestone | adhoc | standalone
      "path": "phases/01-auth-multi-tenant",   // relative to .workflow/scratch/
      "status": "completed",
      "depends_on": "PLN-001",
      "harvested": true
    }
  ],
  "accumulated_context": {
    "key_decisions": [...],
    "deferred": [...]
  }
}
```

Also check:
- `.workflow/roadmap.md` existence
- `.workflow/scratch/` for recent result files

### 2a.2: Infer lifecycle position

**First: determine project bootstrap state:**

```
Check .workflow/ existence:

Case A — No .workflow/ at all (0→1 or existing code without workflow):
  Check project root for source files (src/, package.json, go.mod, etc.)
  
  A1: No source files (empty project, 0→1)
    → position = "brainstorm"
    → chain starts: brainstorm → init → roadmap → analyze → ...
    → brainstorm args = "{intent}" (user describes what to build)

  A2: Has source files (existing code, first time using maestro)
    → position = "init"
    → chain starts: init → roadmap → analyze → ...
    → init auto-detects existing code and bootstraps state.json

Case B — Has .workflow/ but no state.json:
  → position = "init" (corrupted or partial setup)
  → chain starts: init → roadmap → analyze → ...

Case C — Has state.json:
  → proceed to artifact-based position inference below
```

**Artifact-based position inference (Case C):**

Filter artifacts by `milestone == current_milestone`. Group by phase. For the target phase, find the **latest completed artifact type**:

```
  state.json exists, no milestones[]           → "roadmap" (init done, needs roadmap)
  Has milestones, no roadmap.md                → "roadmap"
  Has roadmap, no artifacts for target phase   → "analyze"
  Latest artifact type == "analyze"            → "plan"
  Latest artifact type == "plan"               → "execute"
  Latest artifact type == "execute"            → "verify"
  Latest artifact type == "verify"             → check result files (see below)

When latest is "verify", read result files to refine position:
  resolve_artifact_dir(latest_verify_artifact)
  Read verification.json from that dir:
    gaps[] non-empty or passed == false         → "verify-failed" (needs fix loop)
    passed == true, no review.json              → "business-test"
    has review.json with verdict == "BLOCK"     → "review-failed"
    has review.json with verdict != "BLOCK"     → "test"
    has uat.md with status == "complete", all passed → "milestone-audit"
    has uat.md with failures                    → "test-failed"
```

**resolve_artifact_dir(artifact):**
```
artifact.path is relative path (e.g. "phases/01-auth-multi-tenant")
Full path = .workflow/scratch/{artifact.path}/
If path starts with "phases/": also try .workflow/scratch/{YYYYMMDD}-*-P{phase}-*/
Fallback: glob .workflow/scratch/*-P{phase}-*/ sorted by date DESC, take first
```

### 2a.3: Resolve phase number

Priority:
1. User intent text (regex `phase\s*(\d+)` or bare number)
2. Latest in-progress artifact's phase field
3. First phase in current milestone's `phases[]` that lacks complete artifact chain
4. AskUserQuestion if ambiguous

### 2a.4: Build command sequence

Generate commands from `lifecycle_position` to target (default: `milestone-complete`).

**Lifecycle stages** (full pipeline with decision nodes):

```
Stage              Command                       Type    Decision After
─────────────────────────────────────────────────────────────────────────
brainstorm         maestro-brainstorm "{intent}" cli     — (0→1 only)
init               maestro-init                  skill   —
roadmap            maestro-roadmap "{intent}"    skill   —
analyze            maestro-analyze {phase}       cli     —
plan               maestro-plan {phase}          skill   —
execute            maestro-execute {phase}       cli     —
verify             maestro-verify {phase}        skill   decision:post-verify
business-test      quality-business-test {phase}  skill   decision:post-business-test
review             quality-review {phase}        skill   decision:post-review
test-gen           quality-test-gen {phase}      skill   —
test               quality-test {phase}          skill   decision:post-test
milestone-audit    maestro-milestone-audit       skill   —
milestone-complete maestro-milestone-complete    skill   decision:post-milestone
```

**Command type (cli vs skill):**
| Command | Type | Why |
|---------|------|-----|
| maestro-analyze | `cli` | Heavy multi-source exploration |
| maestro-execute | `cli` | Heavy code generation |
| maestro-brainstorm | `cli` | Heavy multi-role generation |
| maestro-plan | `skill` | Needs user interaction for clarification |
| All quality-* | `skill` | In-session, user-visible results |
| All milestone-* | `skill` | Lightweight lifecycle ops |

**Build rules:**
1. Start from current lifecycle_position (skip completed stages)
2. After each decision-triggering stage, insert a decision node
3. Each decision node carries: `{ decision, retry_count: 0, max_retries: 2 }` in args
4. Args use placeholders — resolved at execution time by ralph-execute (Step 2.5):
   - `{phase}` → session.phase
   - `{intent}` → session.intent (user's original text)
   - `{scratch_dir}` → resolved from latest artifact path at execution time
5. Commands that need user intent text (brainstorm, roadmap, init) use `"{intent}"` as args
6. Commands that need prior output (plan→execute, analyze→plan) have args resolved via artifact lookup at execution time

**Example — from "plan" position (M1 with phases [1,2]):**
```json
[
  { "index": 0, "type": "skill", "skill": "maestro-plan", "args": "{phase}" },
  { "index": 1, "type": "cli",  "skill": "maestro-execute", "args": "{phase}" },
  { "index": 2, "type": "skill", "skill": "maestro-verify", "args": "{phase}" },
  { "index": 3, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}" },
  { "index": 4, "type": "skill", "skill": "quality-business-test", "args": "{phase}" },
  { "index": 5, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-business-test\",\"retry_count\":0,\"max_retries\":2}" },
  { "index": 6, "type": "skill", "skill": "quality-review", "args": "{phase}" },
  { "index": 7, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-review\",\"retry_count\":0,\"max_retries\":2}" },
  { "index": 8, "type": "skill", "skill": "quality-test-gen", "args": "{phase}" },
  { "index": 9, "type": "skill", "skill": "quality-test", "args": "{phase}" },
  { "index": 10, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-test\",\"retry_count\":0,\"max_retries\":2}" },
  { "index": 11, "type": "skill", "skill": "maestro-milestone-audit", "args": "" },
  { "index": 12, "type": "skill", "skill": "maestro-milestone-complete", "args": "" },
  { "index": 13, "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-milestone\"}" }
]
```

### 2a.5: Create session

```
session_id = "ralph-{YYYYMMDD-HHmmss}"
session_dir = ".workflow/.ralph/{session_id}/"

Write status.json:
{
  "id": "{session_id}",
  "created_at": "{ISO}",
  "intent": "{user_intent}",
  "status": "running",
  "lifecycle_position": "{position}",
  "target": "milestone-complete",
  "phase": {N},
  "milestone": "{M}",
  "commands": [...],
  "current": 0,
  "updated_at": "{ISO}"
}
```

### 2a.6: Display plan + confirm

```
============================================================
  RALPH DECISION
============================================================
  Position:  {lifecycle_position} (Phase {N}, {milestone})
  Target:    {target}
  Commands:  {total} steps ({decision_count} decision points)

  [ ] 0. maestro-plan 1                  [skill]
  [ ] 1. maestro-execute 1               [cli]
  [ ] 2. maestro-verify 1                [skill]
  [ ] 3. ◆ post-verify                   [decision]
  [ ] 4. quality-business-test 1         [skill]
  [ ] 5. ◆ post-business-test            [decision]
  [ ] 6. quality-review 1                [skill]
  [ ] 7. ◆ post-review                   [decision]
  [ ] 8. quality-test-gen 1              [skill]
  [ ] 9. quality-test 1                  [skill]
  [ ] 10. ◆ post-test                    [decision]
  [ ] 11. maestro-milestone-audit        [skill]
  [ ] 12. maestro-milestone-complete     [skill]
============================================================
```

AskUserQuestion: Proceed / Edit / Cancel

### 2a.7: Launch execution

```
Skill({ skill: "maestro-ralph-execute" })
```

---

## Step 2b: Decision Evaluation Mode

Triggered when ralph-execute encounters a decision node and hands back to ralph.

### 2b.1: Load session + locate results

Read ralph session status.json. Identify the decision node at `commands[current]`.

**Locate result files** — find the artifact dir for current phase:
```
Read .workflow/state.json
Filter artifacts: milestone == session.milestone, phase == session.phase
Sort by created_at DESC

For the decision type, find the relevant artifact:
  post-verify        → latest type=="verify" artifact → {.workflow/scratch/{artifact.path}/}
  post-business-test → same dir as verify (business-test writes to same artifact dir)
  post-review        → latest artifact dir → review.json
  post-test          → latest artifact dir → uat.md + .tests/test-results.json

artifact_dir = .workflow/scratch/{artifact.path}/
```

### 2b.2: Parse decision metadata

```
meta = JSON.parse(decision_node.args)
// { decision: "post-verify", retry_count: 0, max_retries: 2 }
// or { decision: "post-milestone" }
decision_type = meta.decision
```

### 2b.3: Evaluate by decision type (meta.decision)

**post-verify:**
```
Read {artifact_dir}/verification.json
Check: gaps[] array and passed field

If gaps found (passed == false or gaps[].length > 0):
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug "{gap_summary}", decision:post-debug-escalate]
    → Display: ◆ post-verify: max retries ({max_retries}) reached, escalating to debug
  Else:
    → Insert: [quality-debug "{gap_summary}", maestro-plan --gaps {phase},
               maestro-execute {phase} [cli], maestro-verify {phase},
               decision:post-verify {retry_count+1}]
    → Display: ◆ post-verify: gaps detected, inserting debug+fix loop (retry {N}/{max})

If no gaps (passed == true):
  → No insertion, proceed
```

**post-business-test:**
```
Read {artifact_dir}/business-test-results.json or scan for business test output
Check: failures[] or passed field

If failures found:
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-business-test {phase}, decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug --from-business-test {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase} [cli],
               maestro-verify {phase}, decision:post-verify {retry:0},
               quality-business-test {phase}, decision:post-business-test {retry+1}]

If all pass:
  → No insertion, proceed
```

**post-review:**
```
Read {artifact_dir}/review.json
Check: verdict field and issues[].severity

If verdict == "BLOCK" or any issue.severity == "critical":
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug "{block_summary}", decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug "{block_issues}",
               maestro-plan --gaps {phase}, maestro-execute {phase} [cli],
               quality-review {phase}, decision:post-review {retry+1}]

If verdict == "PASS" or "WARN":
  → No insertion, proceed
```

**post-test:**
```
Read {artifact_dir}/uat.md (parse frontmatter + gap sections)
Read {artifact_dir}/.tests/test-results.json if exists

If failures found (any test result != pass, or gaps with severity >= high):
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-uat {phase}, decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug --from-uat {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase} [cli],
               maestro-verify {phase}, decision:post-verify {retry:0},
               quality-business-test {phase}, decision:post-business-test {retry:0},
               quality-review {phase}, decision:post-review {retry:0},
               quality-test-gen {phase}, quality-test {phase},
               decision:post-test {retry+1}]

If all pass:
  → No insertion, proceed
```

**post-milestone:**
```
Re-read .workflow/state.json (milestone-complete will have updated it).
Check: state.milestones[] for next milestone with status == "pending" or "active"

If next milestone found:
  next_m = next milestone
  next_phases = next_m.phases[]
  first_phase = next_phases[0]

  Update ralph session: milestone = next_m.name, phase = first_phase

  → Insert full lifecycle for next milestone:
    [maestro-analyze {first_phase} [cli],
     maestro-plan {first_phase} [skill],
     maestro-execute {first_phase} [cli],
     maestro-verify {first_phase} [skill],
     decision:post-verify {retry:0},
     quality-business-test {first_phase} [skill],
     decision:post-business-test {retry:0},
     quality-review {first_phase} [skill],
     decision:post-review {retry:0},
     quality-test-gen {first_phase} [skill],
     quality-test {first_phase} [skill],
     decision:post-test {retry:0},
     maestro-milestone-audit [skill],
     maestro-milestone-complete [skill],
     decision:post-milestone {}]

  → Display: ◆ post-milestone: {completed_m.name} done → advancing to {next_m.name} Phase {first_phase} (+14 commands)

If no next milestone:
  → No insertion — session will complete naturally
  → Display: ◆ post-milestone: all milestones complete! 🎉
```

**post-debug-escalate:**
```
This is a terminal escalation — debug was run but we exceeded max retries.
→ Set session status = "paused"
→ Display: ◆ 已达最大重试次数，debug 已执行。请人工介入检查结果。
→ Display: 使用 /maestro-ralph continue 在处理后恢复
→ End.
```

### 2b.4: Insert commands + reindex

When inserting new commands after current position:

```
new_commands = buildInsertionCommands(...)  // each with appropriate type/skill/args
splice commands[] at position (current + 1), insert new_commands
Reindex: commands.forEach((cmd, i) => cmd.index = i)
```

### 2b.5: Update session

```
Mark current decision node status = "completed", completed_at = now
Update status.json: commands[], current, updated_at

If commands were inserted:
  Display: ◆ Decision: {type} → {outcome}, +{N} commands inserted
```

### 2b.6: Resume execution

```
Skill({ skill: "maestro-ralph-execute" })
```

</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no running session | Prompt for intent |
| E002 | error | Cannot infer lifecycle position | Show raw state, ask user |
| E003 | error | Artifact dir not found for decision evaluation | Show glob results, ask user |
| E004 | error | Result file (verification.json etc) missing in artifact dir | Warn, treat as failure |
| W001 | warning | Decision node expanded chain | Auto-handled, log expansion |
| W002 | warning | Max retries reached, escalating to debug | Auto-handled |
| W003 | warning | Multiple running sessions found | Use latest, warn user |
</error_codes>

<success_criteria>
- [ ] state.json artifacts correctly read with actual schema (type, path, scope, milestone)
- [ ] Lifecycle position inferred from artifacts + result files (verification.json, review.json, uat.md)
- [ ] Artifact dir resolved via artifact.path → .workflow/scratch/{path}/
- [ ] Full quality pipeline: verify → business-test → review → test-gen → test
- [ ] Decision nodes at: post-verify, post-business-test, post-review, post-test
- [ ] Every decision failure path starts with quality-debug before plan --gaps
- [ ] retry_count tracked per decision node, max_retries enforced
- [ ] Max retries → post-debug-escalate → session paused for human intervention
- [ ] Command insertion + reindex works correctly
- [ ] Handoff to maestro-ralph-execute via Skill()
</success_criteria>
