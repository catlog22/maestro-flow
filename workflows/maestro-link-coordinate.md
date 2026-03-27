# Workflow: maestro-link-coordinate

Interactive step-by-step coordinator. Pauses at each command node for user preview and action. Supports dynamic chain editing (add/remove/modify/skip steps). Each command node carries a `description` for meaningful previews.

---

### Step 1: Parse Arguments & Load Graph

```javascript
const args = $ARGUMENTS.trim();
const listMode = /\b--list\b/.test(args);
const resumeMode = /\b(-c|--continue)\b/.test(args);
const resumeId = args.match(/(?:-c|--continue)\s+(\S+)/)?.[1] || null;
const forcedChain = args.match(/--chain\s+(\S+)/)?.[1] || null;
const cliTool = args.match(/--tool\s+(\S+)/)?.[1] || 'claude';
const intent = args
  .replace(/\b(--list|-c|--continue)\b/g, '')
  .replace(/(?:-c|--continue)\s+\S+/g, '')
  .replace(/--(chain|tool)\s+\S+/g, '')
  .trim();
```

**If listMode:**
1. Load all graphs via `GraphLoader.listAll()`
2. For each graph: show ID, Name, Cmd count, Description
3. Exit — no interactive session

**If resumeMode:**
1. Find session in `.workflow/.maestro-coordinate/` (by ID or latest)
2. Load `link-state.json` + `graph-snapshot.json`
3. Resume from last `pending_preview` → jump to **Step 3**

**If no intent and no --chain:** Ask user via AskUserQuestion for intent or suggest `--list`.

**Resolve graph:**
- If `--chain` → use directly
- Else → use IntentRouter to resolve intent to graph ID
- Load graph, deep-clone for mutable editing, create LinkWalker

---

### Step 2: Initialize & Get First Preview

1. Call `walker.start(graphId, intent, { tool, workflowRoot })` with resolved graph
2. Walker initializes state, reads `.workflow/state.json` for project snapshot
3. Walker advances through entry node → auto-resolves non-command nodes (decision/gate/eval)
4. Returns `LinkStepPreview` for first command node:
   - `node_id`, `cmd`, `resolved_args` (template vars substituted)
   - `prompt_preview` (full assembled prompt)
   - `step_index` / `total_steps` (position in chain)
   - `upcoming[]` — remaining command nodes with `cmd`, `args_template`, `description`
   - `context_summary` — previous step result if any
5. If null (empty graph or only non-command nodes) → error E002

---

### Step 3: Interactive Loop

Display step preview to user via AskUserQuestion:

```
**Step {step_index}/{total_steps}: /{cmd}**
Args: {resolved_args}
Description: {node.description}

Context: {context_summary}

Upcoming chain:
  → {upcoming[0].cmd} — {upcoming[0].description}
  → {upcoming[1].cmd} — {upcoming[1].description}
  ...

Choose action:
- **Execute** — run this step now
- **Skip** — skip and advance to next command
- **Modify <new_args>** — change args, then execute
- **Add <cmd> [args]** — insert a new step after current
- **Delete <N>** — remove Nth upcoming step
- **Quit** — save session and exit (resumable with -c)
```

**Handle response:**

| Action | Walker Call | Next |
|--------|-----------|------|
| Execute | `executeStep({ type: 'execute' })` | Step 4 |
| Skip | `executeStep({ type: 'skip' })` | Step 4 |
| Modify "args" | `executeStep({ type: 'modify', args })` | Step 4 |
| Add "cmd" "args" | `addNode(current_node, cmd, args)` — updates graph, refreshes upcoming | Stay Step 3 |
| Delete N | `removeNode(upcoming[N-1].node_id)` — removes from graph, refreshes upcoming | Stay Step 3 |
| Quit | `executeStep({ type: 'quit' })` — saves state | Step 5 |

**On Add/Delete:** The graph is mutated in-place. Rebuild the upcoming display from `session.traceCommandPath()` and re-display the same step preview with updated upcoming list.

---

### Step 4: Post-Step Processing

After execute/skip returns the next preview:

1. **Show result summary** of the step just completed:
   - Outcome: success / failure / skipped
   - Summary from parsed output (extracted from COORDINATE RESULT block)
   - Duration if available

2. **If next preview is not null** → loop back to **Step 3**

3. **If next preview is null** → walk reached terminal node → go to **Step 5**

**Decision node handling:** After a command completes, the walker may traverse decision/gate/eval nodes before reaching the next command. These are resolved automatically:
- Decision: evaluates `ctx.result.*` against edge conditions
- Gate: evaluates condition expression
- Eval: sets context variables
- Terminal: ends the walk

If a decision has no matching edge, the walk fails with E005.

---

### Step 5: Completion

Print session summary:

```
Session: {session_id}
Status: {completed|paused|failed}
Graph: {graph_id} ({graph_name})

Steps executed: {count}
Steps skipped: {count}
Steps added: {count}  (chain modifications)
Steps removed: {count}

History:
  1. /{cmd} — {outcome} — {summary}
  2. /{cmd} — {outcome} — {summary}
  ...
```

**Session files** at `.workflow/.maestro-coordinate/{session_id}/`:

| File | Content |
|------|---------|
| `link-state.json` | Full `LinkSessionState` (extends WalkerState with link_mode, pending_preview, chain_modifications) |
| `graph-snapshot.json` | Modified graph copy (reflects all user add/remove/modify edits) |
| `modifications.json` | Ordered log of chain modifications with timestamps |
| `outputs/{node_id}.txt` | Raw output per executed step |

**Resume:** `maestro lc -c` loads latest session. `maestro lc -c {session_id}` loads specific session. Walker reconstructs from link-state + graph-snapshot, resumes at pending_preview position.
