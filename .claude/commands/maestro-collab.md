---
name: maestro-collab
description: Multi-CLI collaborative analysis -- fan-out to multiple CLI tools, cross-verify, synthesize
argument-hint: "\"<requirement>\" [--tools gemini,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<purpose>
Fan-out requirement to multiple CLI tools in parallel → cross-verify for consensus/conflicts → synthesize into unified report with downstream artifacts (context.md + conclusions.json).
</purpose>

<context>
$ARGUMENTS — requirement text and optional flags.

**Flags**:
- `--tools <list>`: Comma-separated CLI tools (default: first 3 enabled)
- `--mode analysis|write`: Delegate mode (default: analysis)
- `--rule <template>`: Shared rule template for all delegates
- `-y`: Skip plan confirmation

**Pre-load** (optional): `maestro spec load --category arch` + `maestro wiki list --category arch` → include in delegate prompts.

**Output**: `.workflow/scratch/{YYYYMMDD}-collab-{slug}/`
- `collab-report.md` — merged findings with consensus/conflict/unique tags
- `context.md` — Locked/Free/Deferred decisions (plan compatible)
- `conclusions.json` — structured: session_id, tools[], consensus_level, recommendation, confidence, dimensions[], decisions[]
- `per-tool/{tool}-output.md` — raw outputs
</context>

<state_machine>

<states>
S_PARSE           — 解析参数、提取 flags                      PERSIST: —
S_DISCOVER        — 发现可用 CLI 工具                          PERSIST: —
S_CONFIRM         — 展示计划、用户确认（-y 跳过）              PERSIST: —
S_FANOUT          — 构建 prompt、并行启动 delegate、STOP       PERSIST: —
S_COLLECT         — 回调到达、收集结果                          PERSIST: per-tool outputs
S_CROSS_VERIFY    — 分类发现（共识/冲突/独有）                  PERSIST: —
S_SYNTHESIZE      — 解决冲突、生成 3 个输出文件                 PERSIST: outputs
S_REGISTER        — 注册 CLB artifact                          PERSIST: state.json
S_REPORT          — 显示摘要 + next-step routing               PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_DISCOVER    WHEN: requirement non-empty              DO: extract requirement, tools, mode, rule, autoYes
  → S_PARSE       WHEN: requirement empty                  DO: AskUserQuestion for requirement

S_DISCOVER:
  → S_CONFIRM     WHEN: eligible tools >= 2                DO: A_DISCOVER_TOOLS
  → ERROR(E002)   WHEN: eligible tools < 2

S_CONFIRM:
  → S_FANOUT      WHEN: autoYes                            DO: A_SETUP_SESSION
  → S_FANOUT      WHEN: user confirms "执行"               DO: A_SETUP_SESSION
  → S_DISCOVER    WHEN: user selects "修改工具选择"         DO: re-select tools, validate >= 2
  → END           WHEN: user cancels

S_FANOUT:
  → S_COLLECT     DO: A_PARALLEL_DELEGATE then STOP — wait for callbacks

S_COLLECT:
  → S_CROSS_VERIFY  WHEN: all callbacks arrived            DO: A_COLLECT_OUTPUTS
  → ERROR(E004)     WHEN: all delegates failed
  GUARD: 1+ succeeded → continue with partial results (W001)

S_CROSS_VERIFY:
  → S_SYNTHESIZE    DO: A_CLASSIFY_FINDINGS

S_SYNTHESIZE:
  → S_REGISTER      DO: A_GENERATE_OUTPUTS

S_REGISTER:
  → S_REPORT        DO: append CLB artifact to state.json (type: collab, scope: adhoc)

S_REPORT:
  → END             DO: display summary (requirement, tools, consensus_level, per-tool status, artifact id, output dir)

</transitions>

<actions>

### A_DISCOVER_TOOLS

```
Bash("maestro tools list --json 2>/dev/null || cat ~/.maestro/cli-tools.json")
```
Filter: enabled == true. If --mode write: exclude type == "api-endpoint".
Auto-select (no --tools): first 3 eligible in config order.

### A_SETUP_SESSION

Create: `.workflow/scratch/{YYYYMMDD}-collab-{slug}/` + `per-tool/`.

### A_PARALLEL_DELEGATE

1. Build shared prompt:
   ```
   PURPOSE: {requirement}; success = actionable findings with evidence
   TASK: {auto-decomposed into 3-5 specific verbs}
   MODE: {delegateMode}
   CONTEXT: @**/*
   EXPECTED: Structured findings with file:line refs, confidence (0-100), prioritized recommendations
   CONSTRAINTS: {from requirement}
   ```
2. Launch ALL delegates in ONE message — multiple `Bash(run_in_background: true)`:
   ```
   maestro delegate "${prompt}" --to {tool} --mode ${mode} [--rule ${rule}]
   ```
3. **STOP immediately after launch. Wait for background callbacks.**

### A_COLLECT_OUTPUTS

On each callback: `maestro delegate output <id>` → write `per-tool/{tool}-output.md`.

### A_CLASSIFY_FINDINGS

Read all per-tool outputs. For each finding:

| Condition | Tag |
|-----------|-----|
| 2+ tools agree | CONSENSUS |
| Tools disagree | CONFLICT |
| 1 tool only | UNIQUE |

consensus_level = consensus_count / total_findings * 100.
If consensus_level < 40%: W003.

### A_GENERATE_OUTPUTS

Resolve conflicts via evidence-weighted voting:
- Higher confidence wins; more specific evidence (file:line) wins over general; tied → SUGGESTED

Write 3 files:
1. **collab-report.md**: Summary, Consensus Findings, Resolved Conflicts, Unresolved Items, Unique Insights, Recommendations, Per-Tool Confidence table
2. **context.md**: Locked (CONSENSUS items), Free (UNIQUE with strong evidence), Deferred (UNRESOLVED conflicts). Standard Locked/Free/Deferred format for plan compatibility.
3. **conclusions.json**: session_id, subject, mode, tools[], consensus_level, recommendation (Go/No-Go/Conditional), confidence, dimensions[{name, score, findings}], decisions[{title, classification, source_tools, rationale}]

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E002 | Fewer than 2 eligible tools | Check cli-tools.json, enable more tools |
| E004 | All delegates failed | Abort with per-tool error details |
| W001 | One tool failed | Continue with remaining (partial degradation) |
| W003 | consensus_level < 40% | Flag in summary, recommend manual review |
</error_codes>

<success_criteria>
- [ ] All delegates launched in parallel via Bash(run_in_background: true), STOP after launch
- [ ] Cross-verification: consensus/conflict/unique classification with consensus_level
- [ ] 3 output files produced (collab-report.md, context.md, conclusions.json)
- [ ] CLB artifact registered in state.json
- [ ] Partial degradation: continued if 1+ tools succeeded
</success_criteria>

<next_step_routing>
- Deep feasibility → `/maestro-analyze "{topic}"`
- Plan from conclusions → `/maestro-plan --dir {dir}`
- Expand → `/maestro-brainstorm "{topic}"`
</next_step_routing>
