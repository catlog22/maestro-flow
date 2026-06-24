---
name: maestro-collab
description: Use when a question needs cross-verification from multiple CLI tools or diverse analytical perspectives
argument-hint: "\"<requirement>\" [--tools agy,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]"
allowed-tools: Read, Write, Edit, Glob, Grep, request_user_input
---

<purpose>
Direct CLI fan-out collaboration via `exec_command`. Diamond topology:
Fan-out (parallel `exec_command` → `maestro delegate --to <tool>`) → Cross-verify (coordinator) → Synthesize (coordinator).

Each CLI tool independently analyzes the requirement via `maestro delegate` shell call.
Coordinator polls ALL CLI results to completion via delegate-protocol.codex.md,
then cross-verifies for consensus/conflicts and synthesizes into unified report.

NO spawn_agents_on_csv. NO spawn_agent. ALL CLI calls directly by coordinator via exec_command.
</purpose>


<context>
$ARGUMENTS — requirement text and optional flags.

**Flags**:
- `--tools <list>`: Comma-separated CLI tools (default: first 3 enabled)
- `--mode analysis|write`: Delegate mode (default: analysis)
- `--rule <template>`: Shared rule template for all delegates (see Rule Reference below)
- `-y`: Skip confirmations

**Rule Reference** — common `--rule` values for collab scenarios:

| Scenario | Rule | Description |
|----------|------|-------------|
| Code quality review | `analysis-review-code-quality` | 代码质量多维评审 |
| Architecture review | `analysis-review-architecture` | 架构设计评审 |
| Bug root cause | `analysis-diagnose-bug-root-cause` | Bug 根因诊断 |
| Security assessment | `analysis-assess-security-risks` | 安全风险评估 |
| Performance analysis | `analysis-analyze-performance` | 性能瓶颈分析 |
| Code pattern analysis | `analysis-analyze-code-patterns` | 代码模式/反模式识别 |
| Architecture design | `planning-plan-architecture-design` | 架构方案设计 |
| Task breakdown | `planning-breakdown-task-steps` | 任务分解规划 |
| Migration strategy | `planning-plan-migration-strategy` | 迁移策略制定 |
| Rigorous style | `universal-universal-rigorous-style` | 严谨风格（通用） |

**Auto-select** (no --tools): read `~/.maestro/cli-tools.json` → filter enabled + eligible → first 3. Exclude api-endpoint when --mode write. Minimum 2 required.

**Session**: `.workflow/.maestro/{YYYYMMDD}-collab-{slug}/`
**Scratch**: `.workflow/scratch/{YYYYMMDD}-collab-{slug}/`

**Output files**:
- `collab-report.md` — merged findings (Consensus/Conflicts/Unique/Recommendations)
- `context.md` — Locked/Free/Deferred decisions (plan compatible)
- `conclusions.json` — session_id, tools[], consensus_level, recommendation, confidence, dimensions[], decisions[]
- `per-tool/{tool}-output.md` — raw CLI outputs

**Downstream compatibility**:

| Consumer | Artifact |
|----------|----------|
| maestro-plan | context.md + conclusions.json (via --dir) |
| maestro-analyze | context.md as prior context (via state.json) |
| maestro-ralph | artifact chain lookup (type=collab) |
</context>

<invariants>
1. **ALL analysis via exec_command → maestro delegate** — coordinator NEVER performs analysis internally, NEVER spawns agents for analysis
2. **exec_command is the execution mechanism** — every delegate call: `exec_command({ cmd: "maestro delegate ..." })`
3. **delegate-protocol.codex.md governs lifecycle** — MUST follow exec_command → poll write_stdin → parse for every delegate
4. **NEVER fire-and-forget** — every exec_command MUST be polled to completion via write_stdin, result consumed before proceeding
5. **NEVER substitute internal reasoning** — if CLI fails, report failure; do NOT generate analysis yourself as replacement
6. **Indefinite wait** — polling has NO max timeout; continue polling until CLI returns regardless of elapsed time; NEVER abandon a running session
6. **Same prompt, different --to** — fan-out delegates all use identical base prompt, only `--to <tool>` differs
7. **Minimum 2 tools** — abort if fewer eligible
8. **Partial degradation** — 1 tool fails → continue with remaining (minimum 2 results for cross-verify)
</invariants>

<state_machine>

<states>
S_PARSE          — 解析参数、发现工具                       PERSIST: —
S_CONFIRM        — 展示计划、用户确认（-y 跳过）            PERSIST: —
S_FAN_OUT        — 并行 exec_command fan-out + 轮询等待      PERSIST: per-tool outputs
S_CROSS_VERIFY   — 交叉验证：共识/冲突/独特分类              PERSIST: cross-verify.md
S_SYNTHESIZE     — 生成最终报告                              PERSIST: reports
S_AGGREGATE      — 注册 artifact、输出摘要                   PERSIST: state.json
</states>

<transitions>

S_PARSE:
  → S_CONFIRM    WHEN: eligible tools >= 2               DO: A_PARSE_AND_DISCOVER
  → ERROR(E002)  WHEN: eligible tools < 2

S_CONFIRM:
  → S_FAN_OUT    WHEN: -y OR user confirms
  → S_PARSE      WHEN: user modifies tools
  → END          WHEN: user cancels

S_FAN_OUT:
  → S_CROSS_VERIFY  WHEN: 2+ delegates completed        DO: A_FAN_OUT_DELEGATES
  → ERROR(E004)     WHEN: all failed OR fewer than 2 completed

S_CROSS_VERIFY:
  → S_BOUNDARY_GRILL  DO: A_CROSS_VERIFY

S_BOUNDARY_GRILL:
  → S_SYNTHESIZE    WHEN: no boundary conflicts detected     DO: —
  → S_SYNTHESIZE    WHEN: conflicts detected + resolved      DO: A_BOUNDARY_GRILL
  GUARD: max 3 conflicts × 3 questions; non-blocking (see boundary-grill.md)

S_SYNTHESIZE:
  → S_AGGREGATE     DO: A_SYNTHESIZE

S_AGGREGATE:
  → END             DO: A_AGGREGATE_RESULTS

</transitions>

<actions>

### A_PARSE_AND_DISCOVER

1. Parse flags: requirement, tools, mode, rule, autoYes
2. Read `~/.maestro/cli-tools.json` → build eligible tool list
3. Auto-select if no --tools: first 3 eligible in config order
4. Build shared delegate prompt (6-field format):
   ```
   PURPOSE: {requirement} + cross-verification analysis
   TASK: {specific analysis tasks from requirement}
   MODE: {mode}
   CONTEXT: @**/* | {project context if available}
   EXPECTED: Structured findings with evidence, confidence per dimension
   CONSTRAINTS: {scope limits}
   ```
5. Create session + scratch dirs
6. `update_plan` with all phases pending

### A_FAN_OUT_DELEGATES

#### Phase 1: Parallel Launch

Launch ALL delegate commands simultaneously via `multi_tool_use.parallel`:

```
multi_tool_use.parallel({
  tool_uses: [
    {
      recipient_name: "functions.exec_command",
      parameters: {
        cmd: "maestro delegate \"<shared_prompt>\" --to agy --mode <mode> [--rule <rule>]",
        yield_time_ms: 30000,
        max_output_tokens: 6000
      }
    },
    {
      recipient_name: "functions.exec_command",
      parameters: {
        cmd: "maestro delegate \"<shared_prompt>\" --to claude --mode <mode> [--rule <rule>]",
        yield_time_ms: 30000,
        max_output_tokens: 6000
      }
    }
    // ... one entry per selected tool
  ]
})
```

#### Phase 2: Block Until ALL Complete

For each result from Phase 1, check completion status:

- **Completed** (no session_id) → save output directly to `{scratchDir}/per-tool/{tool}-output.md`
- **Running** (session_id returned) → add to `pending_sessions[]`

**Blocking poll loop — runs until pending_sessions is empty:**

```
pending_sessions = [{ tool, session_id }, ...]

WHILE pending_sessions.length > 0:
  FOR EACH session IN pending_sessions:
    result = write_stdin({
      session_id: session.session_id,
      chars: "",
      yield_time_ms: 60000,          // 60s per poll — no rush, wait for real output
      max_output_tokens: 6000
    })

    IF result indicates completed:
      save output → {scratchDir}/per-tool/{session.tool}-output.md
      REMOVE session FROM pending_sessions
      completed_count += 1

    IF result indicates failed/error:
      log error for session.tool
      REMOVE session FROM pending_sessions
      failed_count += 1

    // still running → stays in pending_sessions, poll again next round
```

**Blocking guarantees:**
- `yield_time_ms: 60000` — each poll waits up to 60s for output, no short-circuit
- NO max retry count — loop continues indefinitely until CLI returns
- NO timeout escalation — delegate can run as long as needed (30s to 10min+)
- NO early exit — even if tool 1 and 2 are done, keep polling tool 3 until it completes
- Round-robin ensures fair polling across all pending sessions

#### Phase 3: Validate

- Count completed tools
- completed < 2 → ERROR(E004)
- 1 tool failed but 2+ succeeded → W001, log failure, continue

**Iron rules**:
- NEVER skip polling — every session_id MUST be polled to completion
- NEVER proceed to S_CROSS_VERIFY while pending_sessions is non-empty
- NEVER set a max timeout or max retry count on the poll loop
- NEVER generate analysis internally as substitute for CLI output
- NEVER summarize or paraphrase — save raw CLI output verbatim

### A_CROSS_VERIFY

Coordinator reads ALL per-tool outputs from `{scratchDir}/per-tool/` and classifies each finding:

| Condition | Tag |
|-----------|-----|
| 2+ tools agree on same finding | CONSENSUS |
| Tools have contradictory findings | CONFLICT |
| Only 1 tool identified | UNIQUE |

For each CONFLICT: note which tools disagree, their evidence, and confidence levels.

Compute: `consensus_level = consensus_count / total_findings * 100`

Write results to `{scratchDir}/cross-verify.md`.

### A_BOUNDARY_GRILL

Run boundary grill per `~/.maestro/workflows/boundary-grill.md` after cross-verification.
Input: classified CONFLICT findings + per-tool outputs. Check upstream scope if `--from` used.
IF conflicts → tag with resolution, feed into A_SYNTHESIZE. No conflicts → pass through.

### A_SYNTHESIZE

Generate 3 output files from cross-verify results:

1. **collab-report.md**:
   ```markdown
   # Collaborative Analysis: {requirement}

   ## Summary
   Tools: {tool list} | Consensus: {consensus_level}%

   ## Consensus Findings
   {findings agreed by 2+ tools, with evidence}

   ## Conflicts
   {contradictory findings with per-tool positions and evidence}

   ## Unique Insights
   {single-tool findings worth noting}

   ## Recommendations
   {actionable recommendations, prioritized}

   ## Per-Tool Confidence
   | Tool | Confidence | Key Contribution |
   |------|-----------|-----------------|
   ```

2. **context.md**: Locked (CONSENSUS) / Free (UNIQUE w/ strong evidence) / Deferred (CONFLICT unresolved)

3. **conclusions.json**:
   ```json
   {
     "session_id": "", "subject": "", "mode": "",
     "tools": [], "consensus_level": 0,
     "recommendation": "Go|No-Go|Conditional",
     "confidence": 0,
     "dimensions": [{ "name": "", "consensus": "", "details": "" }],
     "decisions": [{ "area": "", "status": "locked|free|deferred", "rationale": "" }]
   }
   ```

### A_AGGREGATE_RESULTS

1. Copy outputs to scratchDir
2. Register CLB artifact in state.json (type: collab, scope: adhoc)
3. Spec enrichment: for each Locked decision → `maestro spec add arch "<title>" "<content>" --keywords <kw> --description "<summary>"`
4. `update_plan` all steps completed
5. Display summary:
   ```
   == Collab Analysis Complete ==
   Requirement: {requirement}
   Tools: {tool list with status}
   Consensus Level: {consensus_level}%

   Key Findings:
     CONSENSUS: {count}
     CONFLICT:  {count}
     UNIQUE:    {count}

   Reports: {scratchDir}/collab-report.md
   Next: $maestro-plan --dir {scratchDir}
   ```

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E002 | Fewer than 2 eligible tools | Check cli-tools.json, specify --tools |
| E004 | All delegates failed or < 2 completed | Show per-tool errors, abort |
| W001 | One tool failed | Continue with remaining |
| W004 | consensus_level < 40% | Flag in summary as low-confidence |
</error_codes>

<success_criteria>
- [ ] ALL analysis performed via exec_command → maestro delegate — zero internal analysis
- [ ] multi_tool_use.parallel used for fan-out launch
- [ ] Every exec_command polled to completion via write_stdin — no timeout cap, no max retries
- [ ] Blocking poll loop ran until pending_sessions empty — no early exit
- [ ] Per-tool raw outputs saved to {scratchDir}/per-tool/
- [ ] Cross-verify: CONSENSUS/CONFLICT/UNIQUE classified, consensus_level computed
- [ ] Boundary grill executed on CONFLICT items (skip if no boundary conflicts detected)
- [ ] Boundary grill results written to collab-report.md § Boundary Grill Results (if conflicts found)
- [ ] collab-report.md + context.md + conclusions.json produced
- [ ] CLB artifact registered in state.json
- [ ] Partial degradation: continued if 2+ tools succeeded
</success_criteria>

<next_step_routing>
- Deep feasibility analysis → `$maestro-analyze "{topic}"`
- Plan from conclusions → `$maestro-plan --dir {scratchDir}`
- Expand exploration → `$maestro-brainstorm "{topic}"`
</next_step_routing>
