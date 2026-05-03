---
name: maestro-link-coordinate
description: Chain-graph walker with in-process flow control. Loads chain JSON, walks nodes in main process, dispatches command nodes via spawn_agents_on_csv. Decision nodes resolved in-process between waves.
argument-hint: "\"intent text\" [--list] [-c [sessionId]] [--chain <name>] [-y]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
In-process chain-graph coordinator. Unlike the CLI-delegated version (maestro coordinate start/next),
this coordinator loads chain graph JSON directly and drives flow in the main process:

- Command nodes → spawn via `spawn_agents_on_csv` (one command = one wave, always solo)
- Decision nodes → resolve in-process using expression evaluation against accumulated context
- Gate/terminal nodes → handle in-process

Coordinator responsibilities: load graph → walk nodes → build skill_call → spawn → read result →
evaluate decision → advance → persist state → repeat until terminal.

```
+-------------------------------------------------------------------+
|  maestro-link-coordinate (in-process walker)                       |
+-------------------------------------------------------------------+
|                                                                   |
|  Phase 1: Load Chain Graph                                        |
|     +-- Parse flags (--chain, -y, -c, --list)                     |
|     +-- Load chain JSON from chains/ directory                    |
|     +-- Initialize session state                                  |
|                                                                   |
|  Phase 2: Walk Loop                                               |
|     +-- while (current_node != terminal):                         |
|     |   +-- command  → build skill_call → spawn_agents_on_csv     |
|     |   |              → read result → update context → follow next|
|     |   +-- decision → evaluate expr against ctx.result           |
|     |   |              → match edge → follow target               |
|     |   +-- gate     → evaluate condition → on_pass / on_fail     |
|     |   +-- terminal → exit loop                                  |
|     +-- Persist state after each node                             |
|                                                                   |
|  Phase 3: Completion Report                                       |
|     +-- Per-node results with outcomes                            |
|     +-- Final status and resume hint                              |
+-------------------------------------------------------------------+
```
</purpose>

<context>
$ARGUMENTS — user intent text, or flags.

**Flags**:
- `--list` — List all available chain graphs (scan chains/ directory)
- `-c / --continue [sessionId]` — Resume from last completed node
- `--chain <name>` — Force a specific chain graph
- `-y / --yes` — Auto mode: no confirmations between nodes

**Session state**: `.workflow/.maestro/{session-id}/`
**Chain graphs**: `chains/` and `chains/singles/` directories (JSON files)
</context>

<invariants>
1. **ALL command-node execution via spawn_agents_on_csv**: Coordinator NEVER executes skills directly. Every command node dispatches through `spawn_agents_on_csv`.
2. **Coordinator = graph walker + prompt assembler**: Load graph → walk → build skill_call → spawn → read result → evaluate decisions → persist. Nothing else.
3. **One command per wave**: Each command node runs as a solo wave (result needed for subsequent decisions).
4. **Decision nodes are in-process**: Coordinator evaluates `node.eval` against `ctx.result` directly. No sub-agent or CLI delegation.
5. **Context flows forward**: Each command result is captured and available to subsequent decision expressions and command args.
6. **max_visits enforced**: Track visit count per node; bail with failure if exceeded.
7. **Resume from node**: `-c` loads saved state and continues from last incomplete node.
</invariants>

<execution>

### Phase 1: Load Chain Graph

Parse `$ARGUMENTS` to extract: `listMode` (`--list`), `autoYes` (`-y`/`--yes`), `resumeMode` (`-c`/`--continue`), `resumeId`, `forcedChain` (`--chain <name>`), `intent` (remaining text).

**`--list`**: Scan `chains/*.json` and `chains/singles/*.json`, display names + descriptions, stop.

**`-c` (resume)**: Glob `.workflow/.maestro/MLC-*/state.json`, pick most recent (or by `resumeId`). Load state → find first incomplete node → jump to Phase 2.

**Fresh session**:
1. Resolve chain: `--chain` direct or classify from intent using `chains/_intent-map.json`
2. Load chain JSON: try `chains/{name}.json` then `chains/singles/{name}.json`
3. Read `.workflow/state.json` for project context (phase, milestone)
4. Initialize session state:

```json
{
  "id": "MLC-{YYYYMMDD}-{HHmmss}",
  "intent": "<intent>", "chain": "<graph.id>", "auto_mode": false,
  "status": "in_progress", "started_at": "<ISO>",
  "current_node": "<graph.entry>",
  "context": { "phase": null, "description": "<intent>", "result": null },
  "visit_counts": {},
  "history": []
}
```

Session dir: `.workflow/.maestro/{sessionId}/`

**`--dry-run`**: Display node walk order with types, stop.
**Confirm** (skip if `autoYes`): Display chain summary, prompt `Proceed?`.

### Phase 2: Walk Loop

Loop while `state.status === 'in_progress'`:
1. Resolve `current_node` from graph — fail if not found
2. Increment `visit_counts[nodeId]` — fail if exceeds `node.max_visits`
3. Dispatch by `node.type`: command → handleCommand, decision → handleDecision, gate → handleGate, terminal → handleTerminal
4. Persist `state.json` after every node

#### handleCommand — spawn via CSV

1. Build `skill_call` from node config + context + auto_mode
2. Write single-row CSV: `wave-{nodeId}.csv` with columns `id,skill_call,topic`
3. Spawn:

```javascript
spawn_agents_on_csv({
  csv_path: csvPath,
  id_column: "id",
  instruction: AGENT_INSTRUCTION,
  max_workers: 1,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionDir}/wave-${nodeId}-results.csv`,
  output_schema: RESULT_SCHEMA
})
```

4. Read result → parse findings into `state.context.result` (for downstream decision eval)
5. Record history entry with outcome
6. Advance: success → `node.next`, failure → `node.on_failure` or fail state

#### handleDecision — in-process expr evaluation

1. Evaluate `node.eval` expression (e.g. `ctx.result.verification_status`) against `state.context` via dot-path resolution
2. Match against `node.edges[]`: first by exact `edge.value`, then by regex `edge.match`, finally `edge.default`
3. Record history: `evalKey = "value" → matchedLabel`
4. Advance to matched `edge.target` — fail if no match found

#### handleGate — condition check

Evaluate `node.condition` against context. Route to `node.on_pass` or `node.on_fail`. Record history with passed/blocked outcome.

#### handleTerminal

Set `state.status` to completed/failed based on `node.status`. Record final history entry.

### Shared Utilities

**AUTO_FLAG_MAP** (skill → auto-confirm flag):

| Skill | Flag |
|-------|------|
| `maestro-init`, `maestro-analyze`, `maestro-brainstorm`, `maestro-ui-design`, `maestro-roadmap` | `-y` |
| `maestro-plan`, `maestro-execute`, `maestro-milestone-complete` | `-y` |
| `quality-auto-test`, `quality-retrospective` | `-y` |
| `quality-test` | `-y --auto-fix` |

**buildSkillCall(node, ctx, autoMode)**: Substitute `{phase}`, `{description}`, `{issue_id}`, `{milestone_num}` from context into `node.args`. If autoMode, append auto flag from `node.auto_flag` or AUTO_FLAG_MAP. Return `$${node.cmd} ${resolvedArgs}`.

**resolveExpr(expr, ctx)**: Navigate dot-path (e.g. `ctx.result.verification_status`) from context root. Strip `ctx.` prefix, walk path segments, return leaf value or undefined.

**parseResultContext(result)**: Parse `result.findings` as JSON if string, merge with `_raw_summary` and `_status`. Fallback to raw summary on parse failure.

### Sub-Agent Instruction Template

```
你是 CSV job 子 agent。

先原样执行这一段技能调用：
{skill_call}

然后基于结果完成这一行任务说明：
{topic}

限制：
- 不要修改 .workflow/.maestro/ 下的 state 文件
- skill 内部有自己的 session 管理，按 skill SKILL.md 执行即可

最后必须调用 `report_agent_job_result`，返回 JSON：
{"status":"completed|failed","skill_call":"{skill_call}","summary":"一句话结果","findings":"JSON 结构化结果（含 decision 所需字段）","artifacts":"产物路径或空字符串","error":"失败原因或空字符串"}
```

**findings 字段规约**：sub-agent 必须在 findings 中返回 decision node 需要的字段。例如：
- `maestro-verify` → `{"verification_status": "passed|failed", ...}`
- `quality-review` → `{"review_verdict": "PASS|BLOCK", ...}`
- `quality-test` → `{"uat_status": "passed|failed", ...}`
- `maestro-milestone-audit` → `{"audit_verdict": "PASS|BLOCK", ...}`

Coordinator 将 `findings` 解析后写入 `ctx.result`，供后续 decision node 的 `eval` 表达式读取。

### Result Schema

```javascript
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "failed"] },
    skill_call: { type: "string" },
    summary: { type: "string" },
    findings: { type: "string" },
    artifacts: { type: "string" },
    error: { type: "string" }
  },
  required: ["status", "skill_call", "summary", "findings", "artifacts", "error"]
};
```

### Phase 3: Completion Report

Set `state.completed_at`, persist final `state.json`. Display:
```
=== LINK-COORDINATE COMPLETE ===
Session:  {sessionId}
Chain:    {chain.name} ({chain.id})
Status:   {completed|failed}

NODE WALK:
  [✓] plan (command) — success — Plan generated
  [→] check_verify (decision) — ctx.result.verification_status = "passed" → review
  [✓] review (command) — success — No blockers
  [→] check_review (decision) — ctx.result.review_verdict = "PASS" → test
  [✓] test (command) — success — All tests passing

Nodes: {completed}/{total} | Visits: {total_visits}
State: .workflow/.maestro/{sessionId}/state.json
Resume: $maestro-link-coordinate -c {sessionId}
```

</execution>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no --list/--chain | Suggest --list |
| E002 | error | Chain graph JSON not found | List available chains |
| E003 | error | Command node spawn failed | Check wave result CSV, resume with -c |
| E004 | error | Decision node: no matching edge | Show eval value and available edges |
| E005 | error | max_visits exceeded on node | Show loop path, suggest --chain with simpler graph |
| E006 | error | Resume session not found | List available sessions |
| W001 | warning | Decision eval returned undefined | Fall through to default edge |
</error_codes>

<success_criteria>
- [ ] Chain graph loaded from chains/ directory (multi-path resolution)
- [ ] Session state initialized with graph entry node
- [ ] Every command node dispatched via spawn_agents_on_csv — coordinator never executes skills
- [ ] Decision nodes resolved in-process via expr evaluation against ctx.result
- [ ] Gate nodes evaluated in-process with pass/fail routing
- [ ] max_visits tracked per node, exceeded → failure
- [ ] Context flows forward: command result → ctx.result → decision eval → next command args
- [ ] State persisted after every node for resumability
- [ ] -c resumes from last incomplete node
- [ ] --list displays available chains without starting a session
- [ ] -y propagates auto_flag to command skill_calls
- [ ] Completion report shows per-node walk with outcomes
- [ ] findings from sub-agent parsed into ctx.result for decision routing
</success_criteria>
