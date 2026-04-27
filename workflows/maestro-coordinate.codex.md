# Workflow: Maestro-coordinate (Codex CLI-Delegate Edition)

Autonomous CLI coordinator for Codex. Classifies intent, selects command chain, executes each step via `codex delegate` with template-driven prompts and async state machine. After each step, gemini evaluates output quality and generates optimization hints for subsequent steps.

> Referenced by: `~/.codex/skills/maestro-coordinate/SKILL.md`

---

## Step 1: Parse Arguments

Extract from `$ARGUMENTS`:
- Flags: `-y`/`--yes` (autoYes), `-c`/`--continue` (resumeMode), `--dry-run`, `--chain <name>`, `--tool <name>` (default: codex)
- `intent` = remaining text after flag removal

**If resumeMode:** Load latest `.workflow/.maestro-coordinate/*/status.json`, set `current_step` to first non-completed step, jump to **Step 6**.

---

## Step 2: Read Project State

```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```

**If exists:** Read `.workflow/state.json` + `.workflow/roadmap.md` + current phase `index.json`. Derive `projectState`: current_milestone, latest_artifact, milestone_progress, phase_artifacts (brainstorm/analysis/context/plan/verification/uat flags), execution (tasks_completed/total), verification_status, review_verdict (PASS|WARN|BLOCK|null), uat_status, phases_total/completed, has_blockers, accumulated_context.

**If missing:** `projectState = { initialized: false }`. If intent also empty → **Error E001**.

---

## Step 3: Classify Intent & Select Chain

### 3a: Exact-match keywords (fast path)

If `forcedChain` is set, validate and jump to **3c**.

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
| create | feature→quick, issue→issue, test→test_gen, spec→spec_generate, ui→ui_design, config→init, phase→roadmap | quick |
| analyze | bug/code→analyze, issue→issue_analyze, codebase→spec_map | analyze |
| explore | issue→issue_discover, feature/ui→brainstorm/ui_design | brainstorm |
| plan | issue→issue_plan, spec→spec_generate | plan |
| execute | issue→issue_execute | execute |
| manage | issue→issue, milestone→milestone_audit, phase→milestone_close, memory/doc/codebase→memory/sync/codebase_refresh | status |
| transition | phase→milestone_close, milestone→milestone_complete | milestone_close |
| verify, review, test, debug, refactor, continue, sync, learn, retrospect | — | self-named |

Clarity scoring: 3=action+object+scope, 2=action+object, 1=action only, 0=empty.
If clarity < 2 and not autoYes: clarify via AskUserQuestion (max 2 rounds).

### 3b: State-based routing (task_type == `state_continue`)

Returns `{ chain, steps }`. Steps are inline (unlike maestro.codex which uses chainMap lookup).

| Condition | Chain | Steps |
|-----------|-------|-------|
| Not initialized | `init` | maestro-init |
| No phases, no roadmap, has context | `next-milestone` | maestro-roadmap |
| No phases | `brainstorm-driven` | brainstorm → plan → execute → verify |
| pending + has context | `plan` | maestro-plan |
| pending, no context | `analyze` | maestro-analyze |
| exploring/planning + has plan | `execute-verify` | execute → verify |
| exploring/planning, no plan | `plan` | maestro-plan |
| executing, all tasks done | `verify` | maestro-verify |
| executing, tasks remain | `execute` | maestro-execute |
| verifying, passed + no review | `review` | quality-review |
| verifying, passed + UAT pending | `test` | quality-test |
| verifying, passed + UAT passed | `milestone-close` | audit → complete |
| verifying, passed + UAT failed | `debug` | quality-debug |
| verifying, not passed | `quality-loop-partial` | plan --gaps → execute → verify |
| testing, UAT passed | `milestone-close` | audit → complete |
| testing, UAT not passed | `debug` | quality-debug |
| completed | `milestone-close` | audit → complete |
| blocked | `debug` | quality-debug |
| fallback | `status` | manage-status |

### 3c: Intent-based chain map

```javascript
const chainMap = {
  // Single-step
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'analyze':            [{ cmd: 'maestro-analyze', args: '{phase}' }],
  'ui_design':          [{ cmd: 'maestro-ui-design', args: '{phase}' }],
  'plan':               [{ cmd: 'maestro-plan', args: '{phase}' }],
  'execute':            [{ cmd: 'maestro-execute', args: '{phase}' }],
  'verify':             [{ cmd: 'maestro-verify', args: '{phase}' }],
  'test_gen':           [{ cmd: 'quality-test-gen', args: '{phase}' }],
  'test':               [{ cmd: 'quality-test', args: '{phase}' }],
  'debug':              [{ cmd: 'quality-debug', args: '"{description}"' }],
  'integration_test':   [{ cmd: 'quality-integration-test', args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor', args: '"{description}"' }],
  'review':             [{ cmd: 'quality-review', args: '{phase}' }],
  'retrospective':      [{ cmd: 'quality-retrospective', args: '{phase}' }],
  'learn':              [{ cmd: 'manage-learn', args: '"{description}"' }],
  'sync':               [{ cmd: 'quality-sync', args: '{phase}' }],
  'milestone_close':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap':            [{ cmd: 'maestro-roadmap', args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load', args: '"{description}"' }],
  'spec_map':           [{ cmd: 'manage-codebase-rebuild' }],
  'knowhow_capture':     [{ cmd: 'manage-knowhow-capture', args: '"{description}"' }],
  'knowhow':             [{ cmd: 'manage-knowhow', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_discover':     [{ cmd: 'manage-issue-discover', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze', args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan', args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute', args: '' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],
  'fork':               [{ cmd: 'maestro-fork', args: '-m {milestone_num}' }],
  'merge':              [{ cmd: 'maestro-merge', args: '-m {milestone_num}' }],
  // Multi-step chains
  'spec-driven':     [{ cmd: 'maestro-init' }, { cmd: 'maestro-spec-generate', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'brainstorm-driven': [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'ui-design-driven': [{ cmd: 'maestro-ui-design', args: '{phase}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'full-lifecycle':  [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'execute-verify':  [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'quality-loop':    [{ cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close': [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap-driven': [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'next-milestone': [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {scratch_dir}' }, { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }],
  // Issue lifecycle chains (with quality gates)
  'issue-full': [{ cmd: 'maestro-analyze', args: '--gaps {issue_id}' }, { cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'quality-review', args: '--scope {affected_files}' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
  'issue-quick': [{ cmd: 'maestro-plan', args: '--gaps' }, { cmd: 'maestro-execute', args: '' }, { cmd: 'manage-issue', args: 'close {issue_id} --resolution fixed' }],
};

// Aliases: task type → named multi-step chain
const taskToChain = {
  'spec_generate': 'spec-driven',
  'brainstorm': 'brainstorm-driven',
  'issue_execute': 'issue-full',    // issue execute always gets review gate
};
```

**Resolution order:**
1. `forcedChain` → `chainMap[forcedChain]`
2. `state_continue` → `detectNextAction(projectState)`
3. `taskToChain[taskType]` → named chain
4. `chainMap[taskType]` → direct lookup

### 3d: Resolve phase number and issue ID

**Phase**: from structured extraction → fallback regex (`phase N` or bare number) → null (milestone-wide default).
**Issue ID**: from structured extraction → regex match `ISS-*-NNN`.

When executing issue chains, replace `{issue_id}` in step args with the resolved issue ID.

---

## Step 4: Confirm

**If `dryRun`:** Display chain and exit.

```
MAESTRO-COORDINATE: {chain_name} (dry run)
  1. [{cmd}] {args}
  2. [{cmd}] {args}
```

**If not autoYes:** AskUserQuestion — Execute / Execute from step N / Cancel.

---

## Step 5: Setup Session

Create session directory `.workflow/.maestro-coordinate/coord-{timestamp}/`.

Initialize `status.json` with: session_id, intent, task_type, chain_name, tool, auto_mode, phase, current_step=0, gemini_session_id=null, step_analyses=[], steps[] (each: index, skill, args, status=pending, exec_id=null, analysis=null).

Build context: `{ resolved_phase, user_intent, issue_id, spec_session_id: null }`.

---

## Step 6: Execute Step via codex delegate

### 6a: Assemble args

Replace template placeholders (`{phase}`, `{description}`, `{issue_id}`, `{spec_session_id}`, `{scratch_dir}`) from context. Inject auto-flags if auto_mode: analyze/brainstorm/ui-design/spec-generate → `-y`, plan → `--auto`, quality-test → `--auto-fix`, quality-retrospective → `--auto-yes`.

### 6b: Build prompt from template

Read `~/.maestro/templates/cli/prompts/coordinate-step.txt`, fill placeholders: `{{COMMAND}}`, `{{ARGS}}`, `{{STEP_N}}`, `{{AUTO_DIRECTIVE}}`, `{{CHAIN_NAME}}`, `{{ANALYSIS_HINTS}}`.

Analysis hints assembled from previous step's gemini evaluation: prompt_additions, cautions, context_to_carry.

### 6c: Launch via codex delegate

Display step header. Mark step as running, persist state. Execute:

```bash
codex delegate '<prompt>' --to {tool} --mode write
```

Run in background (timeout 600s). **STOP** -- wait for callback.

---

## Step 7: Post-Step Callback

On callback:
1. Capture exec_id from stderr `[CODEX_EXEC_ID=xxx]`
2. **Context propagation**: extract `PHASE:`, `SPEC-*`, `scratch_dir:` from output
3. **Success/failure**: if failed + auto_mode → retry once then skip; if failed + interactive → ask Retry/Skip/Abort
4. Save output to `step-{N}-output.txt`, persist state
5. If completed + multi-step chain → **Step 7b** (gemini analysis); otherwise advance to next step or **Step 8**

---

## Step 7b: Analyze Step Output (via gemini)

After each completed step, delegate to gemini for quality evaluation. Prompt includes: step command/args, last 200 lines of output, prior step analyses, next step info.

Expected JSON response: `{ quality_score, execution_assessment: { success, completeness, key_outputs, missing_outputs }, issues: [{ severity, description }], next_step_hints: { prompt_additions, cautions, context_to_carry }, step_summary }`.

```bash
codex delegate '<analysis_prompt>' --to gemini --mode analysis --rule analysis-review-code-quality [--resume {gemini_session_id}]
```

Run in background (timeout 300s). **STOP** -- wait for callback.

### Step 7c: Post-Analyze Callback

Capture gemini session ID for resume chain. Store analysis result (quality_score, issues, next_step_hints, summary) in `step_analyses[]` and per-step `analysis` field. Write `step-{N}-analysis.json`.

Advance `current_step`. If more steps remain → back to **Step 6**; otherwise → **Step 8**.

---

## Step 8: Completion Report

Finalize state: status = `completed` or `completed_with_errors`, persist `status.json`.

Display completion banner: session, chain, tool, per-step status with quality scores, average quality score, resume command.

---

## Core Rules

1. **Semantic routing** — LLM-native structured extraction (`action × object`) replaces regex; disambiguates "问题" by context
2. **STOP after each `codex delegate` call** — background execution, wait for hook callback
3. **State machine** — advance via `current_step`, no sync loops for async operations
4. **Template-driven** — all steps use `coordinate-step.txt`, no per-command prompt assembly
5. **Context propagation** — parse PHASE / spec session ID / scratch_dir / issue_id from each step output, feed to next step
6. **Quality gates** — issue chains auto-include review; `issue-full` is default for issue execution
7. **Tool fallback** — if `codex delegate` fails: retry with same tool once, then try `gemini` → `qwen`
8. **Auto-confirm injection** — `{{AUTO_DIRECTIVE}}` in template prevents blocking during background execution
9. **Resumable** — `-c` reads `status.json`, jumps to first pending step
10. **Gemini analysis after each step** — evaluate output quality via `codex delegate --to gemini --mode analysis`, chained via `--resume`. Analysis generates `next_step_hints` injected into next step's prompt as `{{ANALYSIS_HINTS}}`
11. **Session capture** — after each gemini callback, capture exec_id → `gemini_session_id` for resume chain
12. **Analysis skip conditions** — skip gemini analysis for: failed/skipped steps, single-step chains
