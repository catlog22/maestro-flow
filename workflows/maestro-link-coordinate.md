# Workflow: maestro-link-coordinate

Chain-graph coordinator. Loads a chain JSON from `chains/`, walks the graph node by node, executes each command step via `maestro cli`. Decision/gate/eval nodes auto-resolve. Walker state persisted for resume.

---

### Step 1: Parse Arguments

```javascript
const args = $ARGUMENTS.trim();
const listMode = /\b--list\b/.test(args);
const autoYes = /\b(-y|--yes)\b/.test(args);
const resumeMode = /\b(-c|--continue)\b/.test(args);
const resumeId = args.match(/(?:-c|--continue)\s+(\S+)/)?.[1] || null;
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const cliTool = args.match(/--tool\s+(\S+)/)?.[1] || 'claude';
const intent = args
  .replace(/\b(-y|--yes|--list|-c|--continue)\b/g, '')
  .replace(/(?:-c|--continue)\s+\S+/g, '')
  .replace(/--(chain|tool)\s+\S+/g, '')
  .trim();
```

**Resolve chains root:**

```bash
# Local chains first, fallback to global
test -d chains && CHAINS_ROOT="chains" || CHAINS_ROOT="$HOME/.maestro/chains"
```

---

### Step 2: Handle --list

If `listMode`:

```bash
# List all chain JSON files
for f in "$CHAINS_ROOT"/*.json "$CHAINS_ROOT"/singles/*.json; do
  [ -f "$f" ] && echo "$f"
done
```

For each JSON file: read `id`, `name`, `description`, count nodes with `type: "command"`.

Display:

```
Available chains:

  ID                        Name                  Cmds  Description
  ────────────────────────────────────────────────────────────────────
  full-lifecycle             Full Lifecycle         6    Plan → execute → verify → review → test → transition
  issue-lifecycle            Issue Lifecycle         5    Analyze → plan → execute with retry
  singles/analyze            Analyze                1    Run maestro-analyze
  ...
```

Exit after display.

---

### Step 3: Load Chain Graph

**If resumeMode:** Jump to **Step 3b**.

**If no intent and no forcedChain:** Error E001.

#### 3a: Resolve graph ID

```javascript
let graphId;
if (forcedChain) {
  graphId = forcedChain;
} else {
  // Load _intent-map.json, match intent against patterns
  const intentMap = Read(`${CHAINS_ROOT}/_intent-map.json`);
  // For each pattern: test regex against intent
  // First match → route.graph
  // No match → fallback.graph ("singles/quick")
  graphId = matchedGraphId;
}
```

Load chain JSON:

```javascript
const graph = Read(`${CHAINS_ROOT}/${graphId}.json`);
// Validate: must have "entry", "nodes", each node must have "type"
```

If file not found → Error E002.

#### 3b: Resume session

```bash
# Find session state
ls .workflow/.maestro-coordinate/*/link-state.json 2>/dev/null | sort -r | head -1
```

If `resumeId` specified, load `.workflow/.maestro-coordinate/{resumeId}/link-state.json`.
If not specified, load latest session.

Load `link-state.json` → restore `graph`, `currentNode`, `history`, `context`.
Jump to **Step 5** with restored position.

---

### Step 4: Initialize Session

```javascript
const sessionId = `lc-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`;
```

```bash
mkdir -p "${sessionDir}"
```

Read project state for context:

```bash
test -f .workflow/state.json && cat .workflow/state.json
```

```javascript
const state = {
  session_id: sessionId,
  status: 'running',
  created_at: new Date().toISOString(),
  intent, graph_id: graphId,
  tool: cliTool, auto_mode: autoYes,
  current_node: graph.entry,
  context: {
    result: { status: 'SUCCESS' },  // initial — no prior step
    inputs: {
      phase: /* from state.json current_phase or intent match */,
      description: intent,
      issue_id: /* if present in intent */,
    },
  },
  history: [],
  step_count: 0,
  gemini_session_id: null,
  step_analyses: [],
};
Write(`${sessionDir}/link-state.json`, JSON.stringify(state, null, 2));
Write(`${sessionDir}/graph.json`, JSON.stringify(graph, null, 2));
```

---

### Step 5: Walk Loop — Resolve Current Node

Read `state.current_node` from state, look up in `graph.nodes`:

```javascript
const node = graph.nodes[state.current_node];
```

**Route by node type:**

| Node Type | Action |
|-----------|--------|
| `command` | → **Step 6** (execute via CLI) |
| `decision` | → **Step 5a** (evaluate + advance) |
| `gate` | → **Step 5b** (check condition) |
| `eval` | → **Step 5c** (set context vars) |
| `terminal` | → **Step 8** (complete) |
| `fork` / `join` | → **Step 5d** (sequential fallback) |

#### 5a: Decision node

```javascript
// node.eval = "ctx.result.status"
// node.edges = [{ value: "SUCCESS", target: "done" }, { default: true, target: "retry" }]
const evalValue = resolveExpression(node.eval, state.context);
const matchedEdge = node.edges.find(e => e.value === evalValue)
  || node.edges.find(e => e.default);
if (!matchedEdge) { /* Error E005 */ }
```

Record in history, advance `current_node = matchedEdge.target`, loop back to **Step 5**.

#### 5b: Gate node

```javascript
// node.condition = "ctx.inputs.phase"
const pass = !!resolveExpression(node.condition, state.context);
state.current_node = pass ? node.next : (node.on_fail || /* terminal */);
```

Loop back to **Step 5**.

#### 5c: Eval node

```javascript
// node.set = { "key": "value_expression" }
for (const [k, v] of Object.entries(node.set)) {
  state.context[k] = resolveExpression(v, state.context);
}
state.current_node = node.next;
```

Loop back to **Step 5**.

#### 5d: Fork/join (sequential fallback)

Advance to `node.next` or `node.join`. Loop back to **Step 5**.

---

### Step 6: Execute Command Node via maestro cli

#### 6a: Check max_visits

```javascript
const visits = state.history.filter(h => h.node_id === state.current_node).length;
if (node.max_visits && visits >= node.max_visits) {
  // Skip — max visits reached
  state.history.push({ node_id: state.current_node, type: 'command', outcome: 'skipped', reason: 'max_visits' });
  state.current_node = node.on_failure || node.next || /* find terminal */;
  // → Step 5
}
```

#### 6b: Resolve args

```javascript
const resolvedArgs = (node.args || '')
  .replace(/\{phase\}/g, state.context.inputs.phase || '')
  .replace(/\{description\}/g, state.context.inputs.description || '')
  .replace(/\{issue_id\}/g, state.context.inputs.issue_id || '');
```

#### 6c: Build prompt from template

Read `~/.maestro/templates/cli/prompts/coordinate-step.txt`, fill placeholders:

```javascript
function escapeForShell(str) { return "'" + str.replace(/'/g, "'\\''") + "'"; }

const template = Read('~/.maestro/templates/cli/prompts/coordinate-step.txt');

// Analysis hints from previous step
let analysisHints = '';
const prevAnalysis = (state.step_analyses || []).slice(-1)[0];
if (prevAnalysis?.next_step_hints) {
  const h = prevAnalysis.next_step_hints;
  const parts = [];
  if (h.prompt_additions) parts.push(h.prompt_additions);
  if (h.cautions?.length) parts.push('Cautions: ' + h.cautions.join('; '));
  if (h.context_to_carry) parts.push('Context: ' + h.context_to_carry);
  if (parts.length) analysisHints = parts.join('\n');
}

const AUTO_FLAG_MAP = {
  'maestro-analyze': '-y', 'maestro-brainstorm': '-y', 'maestro-ui-design': '-y',
  'maestro-plan': '--auto', 'maestro-spec-generate': '-y', 'quality-test': '--auto-fix',
};

let stepArgs = resolvedArgs;
if (state.auto_mode) {
  const flag = AUTO_FLAG_MAP[node.cmd];
  if (flag && !stepArgs.includes(flag)) stepArgs = stepArgs ? `${stepArgs} ${flag}` : flag;
}

const prompt = template
  .replace('{{COMMAND}}', `/${node.cmd}`)
  .replace('{{ARGS}}', stepArgs)
  .replace('{{STEP_N}}', `${state.step_count + 1}`)
  .replace('{{AUTO_DIRECTIVE}}', state.auto_mode ? 'Auto-confirm all prompts. No interactive questions.' : '')
  .replace('{{CHAIN_NAME}}', state.graph_id)
  .replace('{{ANALYSIS_HINTS}}', analysisHints);
```

#### 6d: Launch

```
------------------------------------------------------------
  NODE: {current_node} → /{node.cmd}  |  Tool: {tool}
  Graph: {graph_id}  |  Step: {step_count + 1}
------------------------------------------------------------
```

```javascript
state.history.push({
  node_id: state.current_node, type: 'command', cmd: node.cmd,
  args: stepArgs, started_at: new Date().toISOString(), outcome: 'running'
});
Write(`${sessionDir}/link-state.json`, JSON.stringify(state, null, 2));

Bash({
  command: `maestro cli -p ${escapeForShell(prompt)} --tool ${state.tool} --mode write`,
  run_in_background: true, timeout: 600000
});
// STOP — wait for hook callback
```

---

### Step 7: Post-Step Processing

#### 7a: Parse output

```javascript
const output = /* callback output */;
const histEntry = state.history[state.history.length - 1];

// Success/failure detection
const failed = /^STATUS:\s*FAILURE/m.test(output) || output.includes('STATUS: FAILURE');
histEntry.outcome = failed ? 'failure' : 'success';
histEntry.completed_at = new Date().toISOString();

// Context propagation — capture phase/spec/scratch from output
const phaseMatch = output.match(/PHASE:\s*(\d+)/m);
if (phaseMatch) state.context.inputs.phase = phaseMatch[1];

// Set ctx.result for decision node evaluation
state.context.result = { status: failed ? 'FAILURE' : 'SUCCESS', raw: output.slice(-2000) };
state.step_count++;

Write(`${sessionDir}/step-${state.step_count}-output.txt`, output);
```

#### 7b: Handle failure

```javascript
if (failed && state.auto_mode && !histEntry.retried) {
  histEntry.retried = true;
  histEntry.outcome = 'running';
  // Re-execute Step 6d (retry once)
} else if (failed) {
  // Advance to on_failure or next
  state.current_node = node.on_failure || node.next;
  Write(`${sessionDir}/link-state.json`, JSON.stringify(state, null, 2));
  // → Step 5
}
```

#### 7c: Gemini analysis (multi-step chains only)

Skip if: single-command graph, step failed/skipped, or `node.analyze === false`.

```javascript
const cmdNodeCount = Object.values(graph.nodes).filter(n => n.type === 'command').length;
if (histEntry.outcome === 'success' && cmdNodeCount > 1 && node.analyze !== false) {
  const analysisPrompt = `PURPOSE: Evaluate step "${node.cmd}" quality and generate hints for next step.
CHAIN: ${state.graph_id} | Intent: ${state.intent}
COMMAND: /${node.cmd} ${stepArgs}
OUTPUT (last 200 lines): ${output.split('\n').slice(-200).join('\n')}
EXPECTED (JSON): { "quality_score": <0-100>, "issues": [], "next_step_hints": { "prompt_additions": "", "cautions": [], "context_to_carry": "" }, "step_summary": "" }`;

  let cmd = `maestro cli -p ${escapeForShell(analysisPrompt)} --tool gemini --mode analysis`;
  if (state.gemini_session_id) cmd += ` --resume ${state.gemini_session_id}`;
  Bash({ command: cmd, run_in_background: true, timeout: 300000 });
  // STOP — wait for callback
}
```

#### 7d: Post-analysis callback

```javascript
const analysis = /* parsed JSON from callback */;
state.gemini_session_id = /* from callback [MAESTRO_EXEC_ID=xxx] */;
state.step_analyses.push({
  node_id: state.current_node, cmd: node.cmd,
  quality_score: analysis.quality_score,
  issues: analysis.issues,
  next_step_hints: analysis.next_step_hints,
  summary: analysis.step_summary,
});

Write(`${sessionDir}/step-${state.step_count}-analysis.json`, JSON.stringify(analysis, null, 2));
```

#### 7e: Advance to next node

```javascript
state.current_node = node.next;
Write(`${sessionDir}/link-state.json`, JSON.stringify(state, null, 2));
// → Step 5
```

---

### Step 8: Completion

Terminal node reached or no valid next node.

```javascript
const completed = state.history.filter(h => h.outcome === 'success').length;
const failed = state.history.filter(h => h.outcome === 'failure').length;
const skipped = state.history.filter(h => h.outcome === 'skipped').length;

state.status = failed > 0 ? 'completed_with_errors' : 'completed';
state.completed_at = new Date().toISOString();
Write(`${sessionDir}/link-state.json`, JSON.stringify(state, null, 2));
```

```
============================================================
  LINK-COORDINATE COMPLETE
============================================================
  Session: {session_id}
  Graph:   {graph_id}
  Tool:    {tool}

  Steps:
    [✓] analyze → success (quality: 85)
    [✓] plan → success (quality: 90)
    [✗] execute → failure
    [→] check_result → decision → retry_plan
    [✓] retry_plan → success
    [✓] retry_execute → success
    [→] done → terminal

  Executed: {completed} | Failed: {failed} | Skipped: {skipped}
  Avg Quality: {avg}/100
============================================================
```

---

## Core Rules

1. **STOP after each `maestro cli` call** — background execution, wait for hook callback
2. **Graph-driven** — chain JSON is single source of truth for step order and branching
3. **Decision auto-resolve** — evaluate `ctx.result.status` against edge conditions, no user interaction
4. **max_visits** — prevent infinite loops on retry nodes
5. **Template-driven** — all command steps use `coordinate-step.txt` template
6. **Context propagation** — `ctx.result` updated after each step, available to decision nodes
7. **Gemini analysis** — between steps (skippable via `analyze: false` on node), hints injected into next step
8. **Resumable** — `-c` loads `link-state.json`, continues from `current_node`
9. **Tool fallback** — if CLI fails: retry once, then try `gemini` → `qwen`
10. **Local chains first** — check `./chains/` before `~/.maestro/chains/`
