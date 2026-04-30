# Workflow: Maestro (Codex Edition)

CSV wave coordinator version of the intelligent coordinator. Replaces `spawn_agent / wait / close_agent` loop with `spawn_agents_on_csv` (max_workers=1) for sequential pipeline execution. Each chain step is a CSV row with `skill_call` column; agents read prior results from session directory for context propagation.

> Referenced by: `~/.codex/skills/maestro/SKILL.md`

---

## Step 1: Parse Arguments

Extract from `$ARGUMENTS`:
- Flags: `-y`/`--yes` (AUTO_YES), `-c`/`--continue` (RESUME), `--dry-run`, `--chain <name>`
- `intent` = remaining text after flag removal

**Resume mode**: If RESUME, load latest `.workflow/.maestro/maestro-*/status.json`, set `current_step` to first pending step, jump to **Step 6**.

---

## Step 2: Read Project State

Read `.workflow/state.json` if present. Derive `projectState`:
- `current_phase`: first in-progress execute artifact, else first phase without completed execute
- Fields: `phase_slug`, `phase_status` (pending|exploring|planning|executing|verifying|testing|completed|blocked), `phase_artifacts`, `execution` (tasks_completed/total), `verification_status`, `review_verdict`, `uat_status`, `phases_total/completed`, `has_blockers`, `accumulated_context`

If not initialized and no intent → Error E001.

---

## Step 3: Classify Intent & Select Chain

### 3a: Exact-match keywords (fast path)

If `forceChain` is set → validate against chainMap and jump to **3c**.

Exact-match keywords: `continue`/`next`/`go`/`继续`/`下一步` → `state_continue`; `status`/`状态`/`dashboard` → `status`. If matched, skip to **3c**.

### 3a-2: Structured intent extraction (LLM-native)

Instead of regex, extract a structured intent tuple using LLM semantic understanding:

```json
{
  "action":    "<create|fix|analyze|plan|execute|verify|review|test|debug|refactor|explore|manage|transition|continue|sync|learn|retrospect>",
  "object":    "<feature|bug|issue|code|test|spec|phase|milestone|doc|performance|security|ui|memory|codebase|config>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN if mentioned, else null>",
  "phase_ref": "<integer if mentioned, else null>",
  "urgency":   "<low|normal|high>"
}
```

**Key disambiguation**: "问题"/"issue"/"problem" as something broken → `object: "bug"` (routes to debug). As a tracked item (with ISS-ID or management context) → `object: "issue"` (routes to issue management). When ambiguous, prefer `"bug"`.

### 3a-3: Route via action × object matrix

Route via `action × object` matrix. If `issue_id` present → issue pipeline directly.

| action | object-specific overrides | default |
|--------|--------------------------|---------|
| fix | bug/code/perf/security→debug, issue→issue | debug |
| create | feature→quick, issue→issue, test→test_gen, spec→spec_generate, ui→ui_design, config→init | quick |
| analyze | bug/code→analyze, issue→issue_analyze, codebase→spec_map | analyze |
| explore | issue→issue_discover, feature/ui→brainstorm/ui_design | brainstorm |
| plan | issue→issue_plan, spec→spec_generate | plan |
| execute | issue→issue_execute | execute |
| manage | issue→issue, milestone→milestone_audit, phase→phase_transition, memory/doc/codebase→memory/sync/codebase_refresh | status |
| transition | phase→phase_transition, milestone→milestone_complete | phase_transition |
| verify, review, test, debug, refactor, continue, sync, learn, retrospect, release, amend, compose | — | self-named |

**Clarity scoring**: 3 = action+object+scope, 2 = action+object, 1 = action only, 0 = empty.
If `clarity < 2` and not `AUTO_YES`: request user input (max 2 rounds).

### 3b: State-based routing (when `taskType === 'state_continue'`)

Returns `{ chain, argsOverride? }`. Steps resolved from `chainMap[chain]`.

| Condition | Chain |
|-----------|-------|
| Not initialized | `init` |
| No phases, no roadmap, has accumulated_context | `next-milestone` (with deferred/decisions context) |
| No phases | `brainstorm-driven` |
| pending + has context | `plan` |
| pending, no context | `analyze` |
| exploring/planning + has plan | `execute-verify` |
| exploring/planning, no plan | `plan` |
| executing, all tasks done | `verify` |
| executing, tasks remain | `execute` |
| verifying, passed + no review | `review` |
| verifying, passed + BLOCK | `review-fix` |
| verifying, passed + UAT pending | `test` |
| verifying, passed + UAT passed | `milestone-close` |
| verifying, passed + UAT failed | `debug` |
| verifying, not passed | `quality-loop-partial` |
| testing, UAT passed | `milestone-close` |
| testing, UAT not passed | `debug` |
| completed | `milestone-close` |
| blocked | `debug` |
| fallback | `status` |

### 3c: Intent-based chain map

```javascript
const chainMap = {
  // ── Single-step ──────────────────────────────────────────────────────────
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'analyze':            [{ cmd: 'maestro-analyze',        args: '{phase}' }],
  'ui_design':          [{ cmd: 'maestro-ui-design',       args: '{phase}' }],
  'plan':               [{ cmd: 'maestro-plan',            args: '{phase}' }],
  'execute':            [{ cmd: 'maestro-execute',         args: '{phase}' }],
  'verify':             [{ cmd: 'maestro-verify',          args: '{phase}' }],
  'test_gen':           [{ cmd: 'quality-test-gen',        args: '{phase}' }],
  'test':               [{ cmd: 'quality-test',            args: '{phase}' }],
  'debug':              [{ cmd: 'quality-debug',           args: '"{description}"' }],
  'integration_test':   [{ cmd: 'quality-integration-test',args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor',        args: '"{description}"' }],
  'review':             [{ cmd: 'quality-review',          args: '{phase}' }],
  'retrospective':      [{ cmd: 'quality-retrospective',   args: '{phase}' }],
  'learn':              [{ cmd: 'manage-learn',            args: '"{description}"' }],
  'sync':               [{ cmd: 'quality-sync' }],
  'phase_transition':   [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add',                args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load' }],
  'spec_map':           [{ cmd: 'manage-codebase-rebuild' }],
  'knowhow_capture':     [{ cmd: 'manage-knowhow-capture',   args: '"{description}"' }],
  'knowhow':             [{ cmd: 'manage-knowhow',           args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue',            args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'manage-issue-discover',   args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze',          args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan',            args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute',         args: '' }],
  'quick':              [{ cmd: 'maestro-quick',           args: '"{description}"' }],
  // ── Multi-step chains ────────────────────────────────────────────────────
  'spec-driven': [
    { cmd: 'maestro-init' },
    { cmd: 'maestro-roadmap', args: '--mode full "{description}"' },
    { cmd: 'maestro-plan',          args: '{phase}' },
    { cmd: 'maestro-execute',       args: '{phase}' },
    { cmd: 'maestro-verify',        args: '{phase}' }
  ],
  'brainstorm-driven': [
    { cmd: 'maestro-brainstorm', args: '"{description}"' },
    { cmd: 'maestro-plan',       args: '{phase}' },
    { cmd: 'maestro-execute',    args: '{phase}' },
    { cmd: 'maestro-verify',     args: '{phase}' }
  ],
  'ui-design-driven': [
    { cmd: 'maestro-ui-design', args: '{phase}' },
    { cmd: 'maestro-plan',      args: '{phase}' },
    { cmd: 'maestro-execute',   args: '{phase}' },
    { cmd: 'maestro-verify',    args: '{phase}' }
  ],
  'full-lifecycle': [
    { cmd: 'maestro-plan',          args: '{phase}' },
    { cmd: 'maestro-execute',       args: '{phase}' },
    { cmd: 'maestro-verify',        args: '{phase}' },
    { cmd: 'quality-review',        args: '{phase}' },
    { cmd: 'quality-test',          args: '{phase}' },
    { cmd: 'maestro-milestone-audit' },
    { cmd: 'maestro-milestone-complete' }
  ],
  'execute-verify': [
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify',  args: '{phase}' }
  ],
  'quality-loop': [
    { cmd: 'maestro-verify',   args: '{phase}' },
    { cmd: 'quality-review',   args: '{phase}' },
    { cmd: 'quality-test',     args: '{phase}' },
    { cmd: 'quality-debug',    args: '--from-uat {phase}' },
    { cmd: 'maestro-plan',     args: '{phase} --gaps' },
    { cmd: 'maestro-execute',  args: '{phase}' }
  ],
  'milestone-close': [
    { cmd: 'maestro-milestone-audit' },
    { cmd: 'maestro-milestone-complete' }
  ],
  'roadmap-driven': [
    { cmd: 'maestro-init' },
    { cmd: 'maestro-roadmap',  args: '"{description}"' },
    { cmd: 'maestro-plan',     args: '{phase}' },
    { cmd: 'maestro-execute',  args: '{phase}' },
    { cmd: 'maestro-verify',   args: '{phase}' }
  ],
  'next-milestone': [
    { cmd: 'maestro-roadmap',  args: '"{description}"' },
    { cmd: 'maestro-plan',     args: '{phase}' },
    { cmd: 'maestro-execute',  args: '{phase}' },
    { cmd: 'maestro-verify',   args: '{phase}' }
  ],
  'analyze-plan-execute': [
    { cmd: 'maestro-analyze', args: '"{description}" -q' },
    { cmd: 'maestro-plan',    args: '--dir {scratch_dir}' },
    { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }
  ],

  // ── SKILL.md simplified aliases (--chain <name> shortcuts) ───────────────
  'feature': [
    { cmd: 'maestro-plan',    args: '{phase}' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify',  args: '{phase}' }
  ],
  'quality-fix': [
    { cmd: 'maestro-analyze',      args: '--gaps "{description}"' },
    { cmd: 'maestro-plan',         args: '--gaps' },
    { cmd: 'maestro-execute',      args: '' },
    { cmd: 'maestro-verify',       args: '{phase}' }
  ],
  'deploy': [
    { cmd: 'maestro-verify',           args: '{phase}' },
    { cmd: 'maestro-milestone-release' }
  ],

  // ── Issue lifecycle chains (with quality gates) ────────────────────────────
  'issue-full': [
    { cmd: 'maestro-analyze',      args: '--gaps {issue_id}' },
    { cmd: 'maestro-plan',         args: '--gaps' },
    { cmd: 'maestro-execute',      args: '' },
    { cmd: 'quality-review',       args: '{phase}' },
    { cmd: 'manage-issue',         args: 'close {issue_id} --resolution fixed' }
  ],
  'issue-quick': [
    { cmd: 'maestro-plan',         args: '--gaps' },
    { cmd: 'maestro-execute',      args: '' },
    { cmd: 'manage-issue',         args: 'close {issue_id} --resolution fixed' }
  ],

  'review-fix': [
    { cmd: 'maestro-plan',    args: '{phase} --gaps' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'quality-review',  args: '{phase}' }
  ],
  'quality-loop-partial': [
    { cmd: 'maestro-plan',    args: '{phase} --gaps' },
    { cmd: 'maestro-execute', args: '{phase}' },
    { cmd: 'maestro-verify',  args: '{phase}' }
  ],
  'milestone-release': [
    { cmd: 'maestro-milestone-audit' },
    { cmd: 'maestro-milestone-release' }
  ],

  'learn':              [{ cmd: 'maestro-learn',            args: '"{description}"' }],
  'harvest':            [{ cmd: 'manage-harvest',           args: '"{description}"' }],
  'wiki':               [{ cmd: 'manage-wiki' }],
  'wiki_connect':       [{ cmd: 'wiki-connect' }],
  'wiki_digest':        [{ cmd: 'wiki-digest' }],
  'business_test':      [{ cmd: 'quality-business-test',    args: '{phase}' }],
  'spec_remove':        [{ cmd: 'spec-remove',              args: '"{description}"' }],
  'amend':              [{ cmd: 'maestro-amend',             args: '"{description}"' }],
  'release':            [{ cmd: 'maestro-milestone-release' }],
  'compose':            [{ cmd: 'maestro-composer',          args: '"{description}"' }],
  'play':               [{ cmd: 'maestro-player',            args: '"{description}"' }],
  'update':             [{ cmd: 'maestro-update' }],
  'overlay':            [{ cmd: 'maestro-overlay',           args: '"{description}"' }],
  'link_coordinate':    [{ cmd: 'maestro-link-coordinate',   args: '"{description}"' }],
};

// Aliases: task type → named chain
const taskToChain = {
  'spec_generate':  'spec-driven',
  'brainstorm':     'brainstorm-driven',
  'issue_execute':  'issue-full',    // issue execute always gets review gate
};
```

**Resolution order:**
1. `forceChain` → `chainMap[forceChain]` (E002 if not found)
2. `state_continue` → `detectNextAction(projectState)` → returns `{ chain, argsOverride? }`. Steps from `chainMap[chain]`. If `argsOverride` present, apply before template substitution.
3. `taskToChain[taskType]` → named chain
4. `chainMap[taskType]` → direct lookup

### 3d: Resolve phase, description, and issue ID

**Phase**: from structured extraction → fallback regex (`phase N` or bare number) → `projectState.current_phase`.
**Issue ID**: from structured extraction → regex match `ISS-*-NNN`.

Build context: `{ current_phase, user_intent, issue_id, spec_session_id: null, scratch_dir: null }`.

---

## Step 4: Confirm

**If `DRY_RUN`**: Display chain and exit.

```
MAESTRO-COORDINATE: {chain_name}  (dry run)
  1. ${step.cmd} {step.args}
  2. ${step.cmd} {step.args}
  …
```

**If not `AUTO_YES`**: Ask user via `functions.request_user_input`:
- Execute all steps
- Execute from step N
- Cancel

---

## Step 5: Setup Session

Create session directory `.workflow/.maestro/maestro-{timestamp}/`.

**Barrier skills** (solo wave, coordinator analyzes artifacts after): `maestro-analyze`, `maestro-plan`, `maestro-brainstorm`, `maestro-roadmap`, `maestro-execute`.

**Auto-flag injection** (when AUTO_YES): `maestro-analyze/-brainstorm/-roadmap/-ui-design` → `-y`, `maestro-plan` → `--auto`, `quality-test` → `--auto-fix`, `quality-retrospective` → `--auto-yes`.

Initialize `state.json` with: session_id, intent, chain_name, auto_yes, context (phase, dirs, issue_id, gaps), waves[], and steps[] (each with index, cmd, args, status=pending).

---

## Step 6: Wave Execution Loop

### 6a: Helper functions

**buildSkillCall**: Replace template placeholders (`{phase}`, `{description}`, `{issue_id}`, `{plan_dir}`, `{analysis_dir}`, `{brainstorm_dir}`, `{spec_session_id}`, `{scratch_dir}`) from context. Inject auto-flag if AUTO_YES. Return `$<cmd> <args>`.

**buildNextWave**: Take first pending step. If barrier → solo wave. Otherwise group consecutive non-barrier steps into one wave.

### 6b: Wave instruction template

Sub-agent instruction: execute `{skill_call}`, complete `{topic}`, do not modify state files, call `report_agent_job_result` with result JSON.

Result schema: `{ status: "completed"|"failed", skill_call, summary, artifacts, error }` (all required).

### 6c: Main loop

While pending steps remain:
1. Build next wave via `buildNextWave` (barrier → solo, non-barriers → grouped)
2. Write wave CSV (`id, skill_call, topic`) to session dir
3. Execute via `spawn_agents_on_csv` (max_workers = wave size, timeout 1800s)
4. Read results CSV, update each step's status/findings/artifacts
5. If barrier wave → run `analyzeBarrierArtifacts` to update context
6. Record wave in state, persist `state.json`
7. On any failure → abort (mark remaining steps skipped, break)

---

## Step 7: Barrier Artifact Analysis

After a barrier skill completes, the coordinator reads its artifacts and updates `context` for subsequent waves:

Context updates per barrier skill:

| Barrier | Extracts |
|---------|----------|
| `maestro-analyze` | `analysis_dir`, gaps (from context.md markers), phase (if detected) |
| `maestro-plan` | `plan_dir`, task/wave count (from plan.json) |
| `maestro-brainstorm` | `brainstorm_dir` |
| `maestro-roadmap` | `spec_session_id` (SPEC-* pattern) |
| `maestro-execute` | `exec_completed`/`exec_failed` counts (from results.csv) |

**Key principle**: The coordinator owns all context assembly. Sub-agents receive a fully-resolved `skill_call`.

---

## Step 8: Completion Report

Finalize `state.json` (status: completed or current, completed_at timestamp).

Generate `context.md` report: session ID, chain name, waves executed, steps completed/failed, per-wave result table with context updates.

Display completion banner: session, chain, wave results (per-step status + summary), artifacts path, resume command.

---

## Core Rules

1. **Semantic routing**: LLM-native structured extraction (`action × object`) replaces regex; disambiguates "问题" by context
2. **Wave-by-wave**: Never start wave N+1 before wave N results are read and barrier artifacts analyzed
3. **Barrier = solo wave**: A barrier skill always executes alone; coordinator analyzes its artifacts before proceeding
4. **Non-barriers can parallel**: Consecutive non-barrier skills share a wave with `max_workers = N`
5. **Coordinator owns context**: Sub-agents receive fully-resolved `skill_call` — no context discovery needed
6. **Simple instruction**: Sub-agent instruction is minimal — "execute {skill_call}, report result"
7. **Quality gates**: Issue chains auto-include review; `issue-full` is default for issue execution
8. **report_agent_job_result**: Every agent MUST call this with the output schema
9. **State.json tracks waves**: Each wave recorded with step IDs and results; `--continue` resumes from next pending
10. **Dry-run is read-only**: Display chain with [BARRIER] markers, no execution
11. **Abort on failure**: Failed step → skip remaining → report
