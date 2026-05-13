---
name: maestro-collab
description: Multi-CLI collaborative analysis -- fan-out to multiple CLI tools, cross-verify, synthesize
argument-hint: "\"<requirement>\" [--tools gemini,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-CLI collaboration via `spawn_agents_on_csv`. Diamond topology:
Wave 1 (parallel CLI fan-out) → Wave 2 (cross-verify) → Wave 3 (synthesis).

Each CLI tool independently analyzes the requirement. Results cross-verified for consensus/conflicts, synthesized into unified report.
</purpose>

<context>
$ARGUMENTS — requirement text and optional flags.

**Flags**:
- `--tools <list>`: Comma-separated CLI tools (default: first 3 enabled)
- `--mode analysis|write`: Delegate mode (default: analysis)
- `--rule <template>`: Shared rule template
- `-y`: Skip confirmations
- `-c N`: Max concurrency per wave (default: 5)

**Auto-select** (no --tools): read `~/.maestro/cli-tools.json` → filter enabled + eligible → first 3. Exclude api-endpoint when --mode write. Minimum 2 required.

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-collab-{slug}/`
**Scratch**: `.workflow/scratch/{YYYYMMDD}-collab-{slug}/`

**Output files**:
- `collab-report.md` — merged findings (Consensus/Conflicts/Unique/Recommendations)
- `context.md` — Locked/Free/Deferred decisions (plan compatible)
- `conclusions.json` — session_id, tools[], consensus_level, recommendation, confidence, dimensions[], decisions[]
- `per-tool/{tool}-output.md` — raw outputs
</context>

<csv_schema>

### tasks.csv

```csv
id,title,description,tool,role,prompt,mode,rule,deps,context_from,wave,status,findings,recommendations,confidence,error
"1","CLI: gemini","...","gemini","analyze","<prompt>","analysis","","","","1","","","","",""
"2","CLI: claude","...","claude","analyze","<prompt>","analysis","","","","1","","","","",""
"3","Cross-Verify","Compare CLI outputs: CONSENSUS/CONFLICT/UNIQUE","","","","","","1;2","1;2","2","","","","",""
"4","Synthesis","Merge verified findings → collab-report.md + context.md + conclusions.json","","","","","","3","3","3","","","","",""
```

Input columns: id, title, description, tool, role, prompt, mode, rule, deps, context_from, wave.
Output columns: status (pending→completed/failed), findings, recommendations, confidence, error.

### Downstream Compatibility

| Consumer | Artifact |
|----------|----------|
| maestro-plan | context.md + conclusions.json (via --dir) |
| maestro-analyze | context.md as prior context (via state.json) |
| maestro-ralph | artifact chain lookup (type=collab) |

</csv_schema>

<invariants>
1. **Wave order sacred**: Never execute wave N+1 before wave N completes
2. **CSV is source of truth**: Master tasks.csv holds all state
3. **Same prompt, different tool**: Wave 1 agents all use same base prompt, only --to differs
4. **Minimum 2 tools**: Abort if fewer eligible
5. **Delegate protocol**: All exec_command calls follow delegate-protocol.codex.md (yield_time + poll)
6. **Partial degradation**: If 1+ tool fails in wave 1, continue with remaining
7. **Discovery board append-only**: Never modify/delete discoveries.ndjson
</invariants>

<state_machine>

<states>
S_PARSE      — 解析参数、发现工具                       PERSIST: —
S_CONFIRM    — 展示计划、用户确认（-y 跳过）            PERSIST: —
S_CSV_GEN    — 生成 tasks.csv                           PERSIST: tasks.csv
S_WAVE_1     — CLI Fan-Out (parallel spawn)              PERSIST: per-tool outputs + tasks.csv
S_WAVE_2     — Cross-Verify (single agent spawn)         PERSIST: tasks.csv
S_WAVE_3     — Synthesis (single agent spawn)            PERSIST: reports + tasks.csv
S_AGGREGATE  — 注册 artifact、输出摘要                   PERSIST: state.json + results.csv
</states>

<transitions>

S_PARSE:
  → S_CONFIRM    WHEN: eligible tools >= 2               DO: A_PARSE_AND_DISCOVER
  → ERROR(E002)  WHEN: eligible tools < 2

S_CONFIRM:
  → S_CSV_GEN    WHEN: -y OR user confirms "执行"
  → S_PARSE      WHEN: user modifies tools               DO: re-select, validate >= 2
  → END          WHEN: user cancels

S_CSV_GEN:
  → S_WAVE_1     DO: A_GENERATE_CSV (N tool rows wave 1 + 1 verify wave 2 + 1 synthesis wave 3)

S_WAVE_1:
  → S_WAVE_2     WHEN: 1+ agents completed               DO: A_SPAWN_WAVE_1
  → ERROR(E004)  WHEN: all failed

S_WAVE_2:
  → S_WAVE_3     DO: A_SPAWN_WAVE_2

S_WAVE_3:
  → S_AGGREGATE  DO: A_SPAWN_WAVE_3

S_AGGREGATE:
  → END          DO: A_AGGREGATE_RESULTS

</transitions>

<actions>

### A_PARSE_AND_DISCOVER

1. Parse flags: requirement, tools, mode, rule, autoYes, concurrency
2. Read cli-tools.json → build eligible tool list
3. Auto-select if no --tools: first 3 eligible in config order
4. Load context: project.md + `maestro spec load --category arch` + `maestro wiki list --category arch`
5. Build shared delegate prompt (6-field format: PURPOSE/TASK/MODE/CONTEXT/EXPECTED/CONSTRAINTS)

### A_GENERATE_CSV

Create session + scratch dirs. Write tasks.csv:
- Wave 1: one row per selected tool (parallel)
- Wave 2: cross-verify row (deps on all wave 1 IDs)
- Wave 3: synthesis row (deps on wave 2 ID)

### A_SPAWN_WAVE_1

Filter wave==1 from CSV → write wave-1.csv.

```
spawn_agents_on_csv({ csv_path: "wave-1.csv", max_concurrency: N })
```

**Agent instruction**: Execute `maestro delegate "<prompt>" --to <tool> --mode <mode>` via exec_command (delegate-protocol.codex.md). Write output to per-tool/{tool}-output.md. Extract findings/recommendations/confidence. Append discoveries.ndjson.

Merge results → master tasks.csv.

### A_SPAWN_WAVE_2

Filter wave==2 → write wave-2.csv. Build prev_context from wave 1 findings.

```
spawn_agents_on_csv({ csv_path: "wave-2.csv", max_concurrency: 1 })
```

**Agent instruction**: Read all per-tool outputs + discoveries.ndjson. Classify each finding:

| Condition | Tag |
|-----------|-----|
| 2+ tools agree | CONSENSUS |
| Tools disagree | CONFLICT |
| 1 tool only | UNIQUE |

Compute consensus_level = consensus_count / total * 100.

Merge results → master tasks.csv.

### A_SPAWN_WAVE_3

Filter wave==3 → write wave-3.csv. Build prev_context from wave 2 findings.

```
spawn_agents_on_csv({ csv_path: "wave-3.csv", max_concurrency: 1 })
```

**Agent instruction**: Resolve conflicts via evidence-weighted voting (higher confidence wins, specific evidence > general). Generate 3 files:
1. **collab-report.md**: Summary, Consensus Findings, Resolved Conflicts, Unresolved Items, Unique Insights, Recommendations, Per-Tool Confidence table
2. **context.md**: Locked (CONSENSUS), Free (UNIQUE w/ strong evidence), Deferred (UNRESOLVED). Standard Locked/Free/Deferred format.
3. **conclusions.json**: session_id, subject, mode, tools[], consensus_level, recommendation (Go/No-Go/Conditional), confidence, dimensions[], decisions[]

Merge results → master tasks.csv.

### A_AGGREGATE_RESULTS

1. Export tasks.csv → results.csv
2. Verify outputs exist (fallback: build minimal from available findings)
3. Copy collab-report.md + context.md + conclusions.json → scratchDir
4. Register CLB artifact in state.json (type: collab, scope: adhoc)
5. Spec enrichment: for each Locked decision → `maestro spec add arch`
6. Display summary (requirement, tools, consensus_level, per-tool status, artifact ID, next steps)

</actions>

</state_machine>

<discovery_board>

| Type | Dedup Key | Data |
|------|-----------|------|
| cli_finding | tool+dimension | {tool, dimension, finding, confidence, evidence} |
| consensus | area | {area, tools[], finding, confidence} |
| conflict | area | {area, positions[{tool, stance, evidence}], resolution} |
| unique_insight | tool+finding | {tool, finding, significance, actionable} |

Protocol: read before analysis, append-only, dedup by type+key.
</discovery_board>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E002 | Fewer than 2 eligible tools | Check cli-tools.json |
| E004 | All wave 1 delegates failed | Abort with per-tool error details |
| W001 | One tool failed wave 1 | Continue with remaining |
| W003 | Synthesis failed | Use cross-verify output as fallback |
| W004 | consensus_level < 40% | Flag in summary |
</error_codes>

<success_criteria>
- [ ] Wave 1: all delegates via delegate-protocol.codex.md, per-tool outputs written
- [ ] Wave 2: consensus/conflict/unique classified, consensus_level computed
- [ ] Wave 3: collab-report.md + context.md + conclusions.json produced
- [ ] CLB artifact registered, outputs copied to scratchDir
- [ ] Partial degradation: continued if 1+ tools succeeded
</success_criteria>
