# Command: analyze-task

## Purpose

Parse user task description -> detect required capabilities -> build dependency graph -> design dynamic roles with role-spec metadata. Outputs structured task-analysis.json with frontmatter fields for role-spec generation.

## CRITICAL CONSTRAINT

**TEXT-LEVEL analysis only. MUST NOT read source code or explore codebase.**

**Allowed:**
- Parse user task description text
- AskUserQuestion for clarification
- Keyword-to-capability mapping
- Write `task-analysis.json`

If task context requires codebase knowledge, set `needs_research: true`. Phase 2 will spawn researcher worker.

## When to Use

| Trigger | Condition |
|---------|-----------|
| New task | Coordinator Phase 1 receives task description |
| Re-analysis | User provides revised requirements |
| Adapt | handleAdapt extends analysis for new capability |

## Strategy

- **Delegation**: Inline execution (coordinator processes directly)
- **Mode**: Text-level analysis only (no codebase reading)
- **Output**: `<session>/task-analysis.json`

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | User input from Phase 1 | Yes |
| Clarification answers | AskUserQuestion results (if any) | No |
| Session folder | From coordinator Phase 2 | Yes |

## Phase 3: Task Analysis

### Step 1: Signal Detection

Scan task description for capability keywords:

| Signal | Keywords | Capability | Prefix | Responsibility Type |
|--------|----------|------------|--------|---------------------|
| Research | investigate, explore, compare, survey, find, research, discover, benchmark, study | researcher | RESEARCH | orchestration |
| Writing | write, draft, document, article, report, blog, describe, explain, summarize, content | writer | DRAFT | code-gen (docs) |
| Coding | implement, build, code, fix, refactor, develop, create app, program, migrate, port | developer | IMPL | code-gen (code) |
| Design | design, architect, plan, structure, blueprint, model, schema, wireframe, layout | designer | DESIGN | orchestration |
| Analysis | analyze, review, audit, assess, evaluate, inspect, examine, diagnose, profile | analyst | ANALYSIS | read-only |
| Testing | test, verify, validate, QA, quality, check, assert, coverage, regression | tester | TEST | validation |
| Planning | plan, breakdown, organize, schedule, decompose, roadmap, strategy, prioritize | planner | PLAN | orchestration |

**Multi-match**: A task may trigger multiple capabilities.

**No match**: Default to a single `general` capability with `TASK` prefix.

### Step 2: Artifact Inference

Each capability produces default output artifacts:

| Capability | Default Artifact | Format |
|------------|-----------------|--------|
| researcher | Research findings | `<session>/artifacts/research-findings.md` |
| writer | Written document(s) | `<session>/artifacts/<doc-name>.md` |
| developer | Code implementation | Source files + `<session>/artifacts/implementation-summary.md` |
| designer | Design document | `<session>/artifacts/design-spec.md` |
| analyst | Analysis report | `<session>/artifacts/analysis-report.md` |
| tester | Test results | `<session>/artifacts/test-report.md` |
| planner | Execution plan | `<session>/artifacts/execution-plan.md` |

### Step 2.5: Key File Inference

For each task, infer relevant files based on capability type and task keywords:

| Capability | File Inference Strategy |
|------------|------------------------|
| researcher | Extract domain keywords → map to likely directories (e.g., "auth" → `src/auth/**`, `middleware/auth.ts`) |
| developer | Extract feature/module keywords → map to source files (e.g., "payment" → `src/payments/**`, `types/payment.ts`) |
| designer | Look for architecture/config keywords → map to config/schema files |
| analyst | Extract target keywords → map to files under analysis |
| tester | Extract test target keywords → map to source + test files |
| writer | Extract documentation target → map to relevant source files for context |
| planner | No specific files (planning is abstract) |

**Inference rules:**
- Extract nouns and verbs from task description
- Match against common directory patterns (src/, lib/, components/, services/, utils/)
- Include related type definition files (types/, *.d.ts)
- For "fix bug" tasks, include error-prone areas (error handlers, validation)
- For "implement feature" tasks, include similar existing features as reference

### Step 3: Dependency Graph Construction

Build a DAG of work streams using natural ordering tiers:

| Tier | Capabilities | Description |
|------|-------------|-------------|
| 0 | researcher, planner | Knowledge gathering / planning |
| 1 | designer | Design (requires context from tier 0 if present) |
| 2 | writer, developer | Creation (requires design/plan if present) |
| 3 | analyst, tester | Validation (requires artifacts to validate) |

### Step 4: Complexity Scoring

| Factor | Weight | Condition |
|--------|--------|-----------|
| Capability count | +1 each | Number of distinct capabilities |
| Cross-domain factor | +2 | Capabilities span 3+ tiers |
| Parallel tracks | +1 each | Independent parallel work streams |
| Serial depth | +1 per level | Longest dependency chain length |

| Total Score | Complexity | Role Limit |
|-------------|------------|------------|
| 1-3 | Low | 1-2 roles |
| 4-6 | Medium | 2-3 roles |
| 7+ | High | 3-5 roles |

### Step 5: Role Minimization

Apply merging rules to reduce role count (cap at 5).

### Step 6: Role-Spec Metadata Assignment

For each role, determine frontmatter and generation hints:

| Field | Derivation |
|-------|------------|
| `prefix` | From capability prefix (e.g., RESEARCH, DRAFT, IMPL) |
| `inner_loop` | `true` if role has 2+ serial same-prefix tasks |
| `CLI tools` | Suggested, not mandatory — coordinator may adjust based on task needs |
| `pattern_hint` | Reference pattern name from role-spec-template (research/document/code/analysis/validation) — guides coordinator's Phase 2-4 composition, NOT a rigid template selector |
| `output_type` | `artifact` (new files in session/artifacts/) / `codebase` (modify existing project files) / `mixed` (both) — determines verification strategy in Behavioral Traits |
| `message_types.success` | `<prefix>_complete` |
| `message_types.error` | `error` |

**output_type derivation**:

| Task Signal | output_type | Example |
|-------------|-------------|---------|
| "write report", "analyze", "research" | `artifact` | New analysis-report.md in session |
| "update docs", "modify code", "fix bug" | `codebase` | Modify existing project files |
| "implement feature + write summary" | `mixed` | Code changes + implementation summary |

## Phase 4: Output

Write `<session-folder>/task-analysis.json`:

```json
{
  "task_description": "<original user input>",
  "capabilities": [
    {
      "name": "researcher",
      "prefix": "RESEARCH",
      "responsibility_type": "orchestration",
      "tasks": [
        {
          "id": "RESEARCH-001",
          "goal": "What this task achieves and why",
          "steps": [
            "step 1: specific action with clear verb",
            "step 2: specific action with clear verb",
            "step 3: specific action with clear verb"
          ],
          "key_files": [
            "src/path/to/relevant.ts",
            "src/path/to/other.ts"
          ],
          "upstream_artifacts": [],
          "success_criteria": "Measurable completion condition",
          "constraints": "Scope limits, focus areas"
        }
      ],
      "artifacts": ["research-findings.md"]
    }
  ],
  "dependency_graph": {
    "RESEARCH-001": [],
    "DRAFT-001": ["RESEARCH-001"],
    "ANALYSIS-001": ["DRAFT-001"]
  },
  "roles": [
    {
      "name": "researcher",
      "prefix": "RESEARCH",
      "responsibility_type": "orchestration",
      "task_count": 1,
      "inner_loop": false,
      "role_spec_metadata": {
        "CLI tools": ["explore"],
        "pattern_hint": "research",
        "output_type": "artifact",
        "message_types": {
          "success": "research_complete",
          "error": "error"
        }
      }
    }
  ],
  "complexity": {
    "capability_count": 2,
    "cross_domain_factor": false,
    "parallel_tracks": 0,
    "serial_depth": 2,
    "total_score": 3,
    "level": "low"
  },
  "needs_research": false,
  "artifacts": [
    { "name": "research-findings.md", "producer": "researcher", "path": "artifacts/research-findings.md" }
  ]
}
```

## Complexity Interpretation

**CRITICAL**: Complexity score is for **role design optimization**, NOT for skipping team workflow.

| Complexity | Team Structure | Coordinator Action |
|------------|----------------|-------------------|
| Low (1-2 roles) | Minimal team | Generate 1-2 role-specs, create team, spawn workers |
| Medium (2-3 roles) | Standard team | Generate role-specs, create team, spawn workers |
| High (3-5 roles) | Full team | Generate role-specs, create team, spawn workers |

**All complexity levels use team-worker architecture**:
- Single-role tasks still spawn team-worker agent
- Coordinator NEVER executes task work directly
- Team infrastructure provides session management, message bus, fast-advance

**Purpose of complexity score**:
- ✅ Determine optimal role count (merge vs separate)
- ✅ Guide dependency graph design
- ✅ Inform user about task scope
- ❌ NOT for deciding whether to use team workflow

## Error Handling

| Scenario | Resolution |
|----------|------------|
| No capabilities detected | Default to single `general` role with TASK prefix |
| Circular dependency in graph | Break cycle at lowest-tier edge, warn |
| Task description too vague | Return minimal analysis, coordinator will AskUserQuestion |
| All capabilities merge into one | Valid -- single-role execution via team-worker |
