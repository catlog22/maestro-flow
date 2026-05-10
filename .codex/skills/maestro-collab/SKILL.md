---
name: maestro-collab
description: Multi-CLI collaborative analysis -- fan-out to multiple CLI tools, cross-verify, synthesize
argument-hint: "\"<requirement>\" [--tools gemini,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-CLI collaboration using `spawn_agents_on_csv`. Diamond topology: parallel CLI fan-out (Wave 1), cross-verification (Wave 2), then unified synthesis (Wave 3).

Each CLI tool independently analyzes the same requirement from its own perspective. Results are cross-verified for conflicts, then synthesized into a single actionable output.

**Core workflow**: Parse Requirement -> CLI Fan-Out -> Cross-Verify -> Synthesize

```
+---------------------------------------------------------------------------+
|                    COLLAB CSV WAVE WORKFLOW                                |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Requirement Resolution -> CSV                                   |
|     +-- Parse requirement and flags from arguments                        |
|     +-- Select CLI tools (explicit --tools or auto-select)                |
|     +-- Load project context (project.md, specs, codebase)               |
|     +-- Generate tasks.csv with fan-out + verify + synthesis rows         |
|     +-- User validates tool selection (skip if -y)                        |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: CLI Fan-Out (parallel, 2-5 agents)                       |
|     |   +-- Each agent delegates to one CLI tool via exec_command         |
|     |   +-- Same requirement, different CLI perspective                   |
|     |   +-- Results: per-tool findings + recommendations                  |
|     +-- Wave 2: Cross-Verification (single agent)                        |
|     |   +-- Compare all CLI outputs for consensus/conflicts              |
|     |   +-- Tag: [CONSENSUS] / [CONFLICT] / [UNIQUE]                     |
|     |   +-- Results: conflict matrix + agreement areas                    |
|     +-- Wave 3: Synthesis (single agent)                                  |
|     |   +-- Merge verified findings into actionable output               |
|     |   +-- Resolve conflicts with evidence-weighted voting              |
|     |   +-- Generate final collab-report.md                              |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv + collab-report.md                            |
|     +-- Display summary with consensus level + next steps                |
|                                                                           |
+---------------------------------------------------------------------------+
```

</purpose>

<context>
```bash
$maestro-collab "analyze the auth module for security vulnerabilities"
$maestro-collab "design a caching strategy for the API layer" --tools gemini,qwen,claude
$maestro-collab -y "review error handling patterns across the codebase"
$maestro-collab "refactor user service to use repository pattern" --mode write --tools gemini,claude
```

**Flags**:
- `--tools <list>`: Comma-separated CLI tools (default: auto-select top 3 enabled from cli-tools.json)
- `--mode analysis|write`: Delegate mode (default: analysis)
- `--rule <template>`: Shared rule template for all delegates
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 5)

**Auto-select logic** (when `--tools` omitted):
1. Read `~/.maestro/cli-tools.json`
2. Filter `enabled == true`
3. Take first 3 tools in config order
4. Exclude `api-endpoint` type tools when `--mode write`

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` + `results.csv` + `discoveries.ndjson` + `collab-report.md`
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,tool,role,prompt,mode,rule,deps,context_from,wave,status,findings,recommendations,confidence,error
"1","CLI: gemini","Analyze requirement via gemini CLI","gemini","analyze","<full prompt>","analysis","","","","1","","","","",""
"2","CLI: qwen","Analyze requirement via qwen CLI","qwen","analyze","<full prompt>","analysis","","","","1","","","","",""
"3","CLI: claude","Analyze requirement via claude CLI","claude","analyze","<full prompt>","analysis","","","","1","","","","",""
"4","Cross-Verify","Compare all CLI outputs: tag consensus, conflicts, unique findings","","","","","","1;2;3","1;2;3","2","","","","",""
"5","Synthesis","Merge verified findings into actionable collab-report.md","","","","","","4","4","3","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier |
| `title` | Input | Short task title |
| `description` | Input | Detailed instructions for this task |
| `tool` | Input | CLI tool name (wave 1 only) |
| `role` | Input | Delegate --role value |
| `prompt` | Input | Full 6-field prompt for delegate |
| `mode` | Input | analysis or write |
| `rule` | Input | --rule template name (optional) |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs for prev_context |
| `wave` | Computed | Wave number (1=fan-out, 2=verify, 3=synthesis) |
| `status` | Output | pending -> completed / failed |
| `findings` | Output | Key findings summary (max 500 chars) |
| `recommendations` | Output | Per-tool recommendations |
| `confidence` | Output | Self-assessed confidence (0-100) |
| `error` | Output | Error message if failed |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-collab-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- collab-report.md
+-- context.md              ← standard Locked/Free/Deferred format (downstream compatible)
+-- conclusions.json        ← structured conclusions (plan fast-track compatible)
+-- wave-{N}.csv (temporary)
+-- per-tool/
    +-- gemini-output.md
    +-- qwen-output.md
    +-- claude-output.md
```

### Downstream Compatibility

| Consumer | Consumption Path | Artifact |
|----------|-----------------|----------|
| **maestro-plan** | `$maestro-plan "N --dir .workflow/scratch/{collab-session}/"` | `context.md` + `conclusions.json` |
| **maestro-analyze** | auto via `state.json.artifacts[]` (type=collab) | `context.md` as prior context |
| **maestro-brainstorm** | auto via `state.json.artifacts[]` (type=collab) | `context.md` as supplementary context |
| **maestro-ralph** | auto — lifecycle position inference includes collab | artifact chain lookup |

`context.md` uses the standard Locked/Free/Deferred decision format. `conclusions.json` follows the same schema as maestro-analyze's output. This allows plan to skip wave 1 exploration when collab has already produced structured conclusions.
</csv_schema>

<invariants>
1. **Plan Before Execute**: Present collaboration plan with tool selection for user approval before any CLI invocation
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never modify or delete discoveries.ndjson
6. **Same Prompt, Different Tool**: Wave 1 agents all use the same base prompt, only --to differs
7. **Minimum 2 Tools**: Collaboration requires at least 2 CLI tools; abort if fewer enabled
8. **Delegate Protocol**: All exec_command calls follow delegate-protocol.codex.md (yield_time + poll)
9. **DO NOT STOP**: Continuous execution until all waves complete
10. **Partial Degradation**: If 1+ tool fails in wave 1, continue with available results
</invariants>

<execution>

### Session Initialization

**Parse from `$ARGUMENTS`**:

| Variable | Source | Default |
|----------|--------|---------|
| `AUTO_YES` | `--yes` or `-y` | false |
| `maxConcurrency` | `--concurrency N` or `-c N` | 5 |
| `selectedTools` | `--tools <list>` | auto-select |
| `delegateMode` | `--mode` | `analysis` |
| `ruleTemplate` | `--rule` | null |
| `requirement` | remaining text after flag removal | "" (E001 if empty) |

**Auto-bootstrap**: If `.workflow/` missing, create minimal structure.

**Session paths** (UTC+8 date prefix):
- `slug` ← requirement kebab-cased, max 40 chars
- `sessionFolder`: `.workflow/.csv-wave/{YYYYMMDD}-collab-{slug}/`

- `scratchDir`: `.workflow/scratch/{YYYYMMDD}-collab-{slug}/`

Create `sessionFolder` + `sessionFolder/per-tool/` + `scratchDir`.

### Phase 1: Requirement Resolution -> CSV

**Objective**: Parse requirement, discover available tools, present plan for user approval, generate tasks.csv.

**1. Discover available CLI tools**:

Read `~/.maestro/cli-tools.json` → extract all tool entries. Build `availableTools[]`:

```
For each tool in config.tools:
  availableTools.push({
    name: tool.name,
    enabled: tool.enabled,
    type: tool.type,              // builtin | cli-wrapper | api-endpoint
    model: tool.primaryModel,
    tags: tool.tags,              // [fullstack, frontend, backend, ...]
    eligible: tool.enabled
              && (delegateMode != "write" || tool.type != "api-endpoint")
  })
```

Validate: at least 2 eligible tools required (E002 if fewer).

**2. Auto-recommend tool selection**:

| Source | Logic |
|--------|-------|
| `--tools` explicit | Use provided list, validate each is eligible |
| No `--tools` | Take first 3 eligible tools in config order |

Mark each eligible tool as `recommended: true/false` based on auto-selection.

**3. Context loading**:
- Read `.workflow/project.md` if exists
- Load project specs: `maestro spec load --role implement` (if available)
- Grep for relevant codebase files based on requirement keywords

**4. Build delegate prompt** (shared across all tools):

```
PURPOSE: {requirement}; success = actionable findings with evidence
TASK: {auto-decomposed from requirement into 3-5 specific verbs}
MODE: {delegateMode}
CONTEXT: @**/* | Memory: {project context if available}
EXPECTED: Structured findings with file:line references, confidence score (0-100), prioritized recommendations
CONSTRAINTS: {from requirement} | Output findings as structured text with sections: ## Findings, ## Recommendations, ## Confidence
```

**5. Present Collaboration Plan** (skip if AUTO_YES):

Display plan summary, then `request_user_input` for approval:

```
============================================================
  COLLABORATION PLAN
============================================================
  Requirement: {requirement}
  Mode:        {delegateMode}
  Rule:        {ruleTemplate || "none"}

  Available CLI Tools (from cli-tools.json):
    [✓] gemini    — gemini-3.1-pro-preview     [fullstack, frontend]
    [✓] claude    — claude-sonnet-4-6           [fullstack]
    [✓] codex     — gpt-5.5                    [fullstack, backend]
    [ ] opencode  — (no model)                  [fullstack]

  Selected: gemini, claude, codex (3 tools)

  Pipeline:
    Wave 1: Fan-out → gemini + claude + codex (parallel)
    Wave 2: Cross-verification (conflicts/consensus)
    Wave 3: Synthesis → context.md + conclusions.json

  Prompt Preview:
    PURPOSE: {first 80 chars}...
    TASK:    {task verbs}
============================================================
```

```json
request_user_input({
  "questions": [{
    "id": "collab_plan",
    "header": "Collaboration Plan",
    "question": "以上为协作计划。如何继续？",
    "options": [
      {
        "label": "执行 (Recommended)",
        "description": "使用选中的 {N} 个 CLI 工具开始协作分析"
      },
      {
        "label": "修改工具选择",
        "description": "更改参与协作的 CLI 工具组合"
      },
      {
        "label": "取消",
        "description": "中止协作，不执行任何调用"
      }
    ]
  }]
})
```

**Handle user response**:

| Response | Action |
|----------|--------|
| **执行** | Proceed to step 6 (CSV generation) |
| **修改工具选择** | → Tool Modification Interaction (step 5a) |
| **取消** | Abort with message "协作已取消" |

#### 5a. Tool Modification Interaction

Present all eligible tools as toggleable options:

```json
request_user_input({
  "questions": [{
    "id": "tool_selection",
    "header": "CLI Tool Selection",
    "question": "选择参与协作的 CLI 工具（至少 2 个）：",
    "options": [
      { "label": "gemini", "description": "gemini-3.1-pro-preview — fullstack, frontend" },
      { "label": "claude", "description": "claude-sonnet-4-6 — fullstack" },
      { "label": "codex", "description": "gpt-5.5 — fullstack, backend" },
      { "label": "opencode", "description": "(no model) — fullstack" }
    ]
  }]
})
```

Options are **dynamically built** from `availableTools.filter(t => t.eligible)`:
- `label` = tool name
- `description` = `{primaryModel} — {tags.join(", ")}`

Parse user selection → update `selectedTools`. Validate minimum 2 (re-prompt if fewer).
Return to step 5 to re-display updated plan.

**6. CSV generation**:
- N tool rows (wave 1, one per selected tool)
- 1 cross-verify row (wave 2, deps on all wave 1)
- 1 synthesis row (wave 3, deps on wave 2)

### Phase 2: Wave Execution Engine

#### Wave 1: CLI Fan-Out (Parallel)

Filter `wave == 1 && status == pending` from master CSV. Write `wave-1.csv`.

Each wave 1 agent:

1. Read task row: extract `tool`, `prompt`, `mode`, `rule`
2. Execute delegate (blocking):

```
exec_command({
  cmd: `maestro delegate "${prompt}" --to ${tool} --mode ${mode} ${rule ? '--rule ' + rule : ''}`,
  yield_time_ms: 30000,
  max_output_tokens: 6000
})
// If session_id returned -> poll write_stdin until completion
// See @~/.maestro/workflows/delegate-protocol.codex.md
```

3. Parse delegate output
4. Write per-tool output to `per-tool/{tool}-output.md`
5. Share findings via discovery board

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildFanOutInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, recommendations, confidence, error }
})
```

Merge results into master `tasks.csv`, delete `wave-1.csv`.

**Fan-Out Agent Instruction**:

```
You are a CLI collaboration agent. Your task is to delegate analysis to a specific CLI tool and capture its output.

1. Read your task row for: tool, prompt, mode, rule
2. Execute the delegate call using exec_command (follow delegate-protocol.codex.md):
   exec_command({
     cmd: `maestro delegate "<prompt>" --to <tool> --mode <mode> [--rule <rule>]`,
     yield_time_ms: 30000, max_output_tokens: 6000
   })
3. If session_id returned, poll via write_stdin until completion
4. Write full output to {sessionFolder}/per-tool/{tool}-output.md
5. Extract: findings (key points), recommendations (actionable items), confidence (0-100)
6. Share via discoveries.ndjson: type="cli_finding", data={tool, dimension, finding, confidence}
7. Report result with findings, recommendations, confidence
```

#### Wave 2: Cross-Verification (Single Agent)

Filter `wave == 2 && status == pending`. Build `prev_context` from wave 1 findings.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: buildCrossVerifyInstruction(sessionFolder),
  max_concurrency: 1,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, recommendations, confidence, error }
})
```

**Cross-Verify Agent Instruction**:

```
You are a cross-verification agent. Compare outputs from multiple CLI tools.

1. Read all per-tool outputs from {sessionFolder}/per-tool/
2. Read discoveries.ndjson for shared findings
3. For each finding across tools, classify:
   - [CONSENSUS]: 2+ tools agree on same finding/recommendation
   - [CONFLICT]: Tools disagree on approach/assessment
   - [UNIQUE]: Finding from only one tool (may be valuable or noise)
4. For [CONFLICT] items: note each tool's position and evidence strength
5. Compute consensus_level: (consensus_count / total_findings) * 100
6. Write findings as structured text:
   ## Consensus Areas
   ## Conflicts (with per-tool positions)
   ## Unique Findings (with source tool)
   ## Consensus Level: {N}%
```

Merge results into master `tasks.csv`, delete `wave-2.csv`.

#### Wave 3: Synthesis (Single Agent)

Filter `wave == 3 && status == pending`. Build `prev_context` from wave 2 findings.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-3.csv`,
  id_column: "id",
  instruction: buildSynthesisInstruction(sessionFolder),
  max_concurrency: 1,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-3-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, recommendations, confidence, error }
})
```

**Synthesis Agent Instruction**:

```
You are a synthesis agent. Merge cross-verified findings into a final report.

1. Read cross-verification results from prev_context
2. Read all per-tool outputs from {sessionFolder}/per-tool/
3. Read discoveries.ndjson
4. Resolve [CONFLICT] items via evidence-weighted voting:
   - Higher confidence tool's position wins
   - More specific evidence (file:line refs) wins over general statements
   - If tied: present both with [SUGGESTED] tag
5. Generate collab-report.md:

   # Multi-CLI Collaboration Report -- {requirement}

   ## Summary
   - Tools: {tool_list}
   - Consensus level: {N}%
   - Key finding: {top finding}

   ## Consensus Findings
   {merged findings agreed by 2+ tools}

   ## Resolved Conflicts
   {conflicts resolved with rationale}

   ## Unresolved Items
   {items requiring human judgment}

   ## Unique Insights
   {valuable unique findings with source attribution}

   ## Recommendations
   {prioritized, merged recommendations}

   ## Per-Tool Confidence
   | Tool | Confidence | Key Strength |
   |------|-----------|--------------|

6. Generate context.md (standard downstream format):

   # Context: {requirement}

   **Date**: {date}
   **Mode**: collab ({tool_list})
   **Consensus Level**: {N}%

   ## Decisions

   ### Decision N: {TITLE}
   - **Context**: {what and why}
   - **Options**: 1. {opt1} 2. {opt2}
   - **Chosen**: {selected — from consensus or evidence-weighted resolution}
   - **Reason**: {rationale — include which tools agreed/disagreed}

   ## Constraints

   ### Locked
   {[CONSENSUS] items — agreed by 2+ tools, treat as confirmed decisions}

   ### Free
   {[UNIQUE] items with strong evidence — implementer may adopt or skip}

   ### Deferred
   {[UNRESOLVED] conflicts — require human judgment before proceeding}

   ## Code Context
   {file:line references from per-tool findings}

7. Generate conclusions.json (plan fast-track compatible):

   {
     "session_id": "<session>",
     "subject": "<requirement>",
     "mode": "collab",
     "tools": ["gemini", "qwen", "claude"],
     "consensus_level": 85,
     "recommendation": "Go|No-Go|Conditional",
     "confidence": "high|medium|low",
     "dimensions": [
       { "name": "<tool>", "score": 80, "findings": "...", "recommendations": "..." }
     ],
     "decisions": [
       { "title": "...", "classification": "locked|free|deferred", "source_tools": ["gemini","qwen"], "rationale": "..." }
     ],
     "timestamp": "<ISO>"
   }

8. Write collab-report.md, context.md, conclusions.json to {sessionFolder}/
```

Merge results into master `tasks.csv`, delete `wave-3.csv`.

### Phase 3: Results Aggregation

1. Export final `tasks.csv` as `results.csv`
2. Verify `collab-report.md` + `context.md` + `conclusions.json` exist (if synthesis failed, build minimal versions from available findings)
3. Copy final outputs to `scratchDir`:
   - `collab-report.md` → `{scratchDir}/collab-report.md`
   - `context.md` → `{scratchDir}/context.md`
   - `conclusions.json` → `{scratchDir}/conclusions.json`

4. **Register artifact in state.json**:
   ```json
   {
     "id": "CLB-{next_id}",
     "type": "collab",
     "milestone": "{current_milestone}",
     "phase": null,
     "scope": "adhoc",
     "path": "scratch/{YYYYMMDD}-collab-{slug}",
     "status": "completed",
     "depends_on": null,
     "harvested": false,
     "created_at": "<ISO>",
     "completed_at": "<ISO>"
   }
   ```

5. **Spec Enrichment**: For each Locked decision in context.md:
   - `maestro spec add arch "<decision.title>" "<decision.rationale>" --keywords ... --source collab:{sessionId}`

6. Display summary:

```
============================================================
  MULTI-CLI COLLABORATION COMPLETE
============================================================
  Requirement:     {requirement}
  Tools:           {tool_list}
  Consensus Level: {N}%
  Wave Results:    {completed}/{total} tasks

  Per-Tool:
    gemini:  {status} (confidence: {N}%)
    qwen:    {status} (confidence: {N}%)
    claude:  {status} (confidence: {N}%)

  Artifact: CLB-{id} registered in state.json
  Output:   {scratchDir}/

  Next steps:
    $maestro-analyze "{topic}"                              -- Deep feasibility analysis
    $maestro-plan "{phase} --dir {scratchDir}"              -- Plan from collab conclusions
    $maestro-brainstorm "{topic}"                           -- Expand with multi-role brainstorm
============================================================
```

### Shared Discovery Board Protocol

#### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `cli_finding` | `data.tool+data.dimension` | `{tool, dimension, finding, confidence, evidence}` | Per-tool finding |
| `consensus` | `data.area` | `{area, tools[], finding, confidence}` | Cross-tool agreement |
| `conflict` | `data.area` | `{area, positions[{tool, stance, evidence}], resolution}` | Cross-tool disagreement |
| `unique_insight` | `data.tool+data.finding` | `{tool, finding, significance, actionable}` | Single-tool unique finding |

#### Protocol

Read `discoveries.ndjson` before analysis. Append-only: dedup by type+key, never modify/delete.

</execution>

<error_codes>

| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | Requirement argument missing | Prompt for requirement |
| E002 | error | Fewer than 2 CLI tools available | Check cli-tools.json, enable more tools |
| E003 | error | Specified tool not found/enabled | Show available tools |
| E004 | error | All wave 1 delegates failed | Abort with per-tool error details |
| W001 | warning | One tool failed in wave 1 | Continue with remaining tools |
| W002 | warning | Cross-verify found >50% conflicts | Highlight in report, recommend manual review |
| W003 | warning | Synthesis agent failed | Use cross-verify output as fallback report |
| W004 | warning | Low consensus level (<40%) | Flag in summary, tools may need different prompts |

</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] Available CLI tools discovered from cli-tools.json with eligibility filtering
- [ ] Collaboration plan presented via request_user_input (tool list, pipeline, prompt preview)
- [ ] User approved or modified tool selection before execution
- [ ] CLI tools finalized (auto or user-modified) with minimum 2
- [ ] All wave 1 delegates executed via delegate-protocol.codex.md (blocking poll)
- [ ] Per-tool outputs written to per-tool/{tool}-output.md
- [ ] Cross-verification completed with consensus/conflict/unique classification
- [ ] Synthesis produced collab-report.md with merged findings
- [ ] context.md produced in standard Locked/Free/Deferred format (downstream compatible)
- [ ] conclusions.json produced with per-tool dimensions and decision trail (plan fast-track compatible)
- [ ] Consensus level computed and displayed
- [ ] Results.csv exported with all task statuses
- [ ] CLB artifact registered in state.json
- [ ] Final outputs copied to scratchDir (collab-report.md, context.md, conclusions.json)
- [ ] Spec enrichment applied for Locked decisions
- [ ] discoveries.ndjson append-only throughout
- [ ] Partial degradation: continue if 1+ tools succeed in wave 1
</success_criteria>
