---
role: explorer
prefix: EXPLORE
inner_loop: false
message_types: [context_ready, error]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Issue Explorer

## Phase 2: Issue Loading & Context Setup

| Input | Source | Required |
|-------|--------|----------|
| Issue ID | Task description (GH-\d+ or ISS-\d{8}-\d{6}) | Yes |
| Issue details | `ccw issue status <id> --json` | Yes |
| Session path | Extracted from task description | Yes |
| wisdom meta | <session>/wisdom/.msg/meta.json | No |

1. Extract issue ID from task description via regex: `(?:GH-\d+|ISS-\d{8}-\d{6})`
2. If no issue ID found -> report error, STOP
3. Load issue details:

```
Bash("ccw issue status <issueId> --json")
```

4. Parse JSON response for issue metadata (title, context, priority, labels, feedback)
5. Load wisdom files from `<session>/wisdom/` if available

## Phase 3: Codebase Exploration & Impact Analysis

**Complexity assessment determines exploration depth**:

| Signal | Weight | Keywords |
|--------|--------|----------|
| Structural change | +2 | refactor, architect, restructure, module, system |
| Cross-cutting | +2 | multiple, across, cross |
| Integration | +1 | integrate, api, database |
| High priority | +1 | priority >= 4 |

| Score | Complexity | Strategy |
|-------|------------|----------|
| >= 4 | High | Deep exploration via CLI tool |
| 2-3 | Medium | Hybrid: ACE search + selective CLI |
| 0-1 | Low | Direct ACE search only |

**Exploration execution**:

| Complexity | Execution |
|------------|-----------|
| Low | Direct ACE search: `(project_root_path, query)` |
| Medium/High | CLI exploration: `Bash("maestro delegate \\\"<exploration_prompt>\" --to agy --mode analysis", { run_in_background: false })` |

**CLI exploration prompt template**:

```
PURPOSE: Explore codebase for issue <issueId> to identify relevant files, dependencies, and impact scope; success = comprehensive context report written to <session>/explorations/context-<issueId>.json

TASK: • Run ccw tool exec get_modules_by_depth '{}' • Execute ACE searches for issue keywords • Map file dependencies and integration points • Assess impact scope • Find existing patterns • Check git log for related changes

MODE: analysis

CONTEXT: @**/* | Memory: Issue <issueId> - <issue.title> (Priority: <issue.priority>)

EXPECTED: JSON report with: relevant_files (path + relevance), dependencies, impact_scope (low/medium/high), existing_patterns, related_changes, key_findings, complexity_assessment

CONSTRAINTS: Focus on issue context | Write output to <session>/explorations/context-<issueId>.json
```

**Report schema**:

```json
{
  "issue_id": "string",
  "issue": { "id": "", "title": "", "priority": 0, "status": "", "labels": [], "feedback": "" },
  "relevant_files": [{ "path": "", "relevance": "" }],
  "dependencies": [],
  "impact_scope": "low | medium | high",
  "existing_patterns": [],
  "related_changes": [],
  "key_findings": [],
  "complexity_assessment": "Low | Medium | High"
}
```

### Tech Profile Scan

After exploration, scan findings for context-aware trigger signals (based on detected codebase characteristics):

1. Check relevant_files and dependencies → signals (`sql_detected`, `auth_detected`, `api_surface`)
2. Check code patterns in explored files → risk signals (`injection_risk`, `eval_usage`, `perf_sensitive`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Context Report & Wisdom Contribution

1. Write context report to `<session>/explorations/context-<issueId>.json`
2. If file not found from agent, build minimal report from ACE results
3. Update `<session>/wisdom/.msg/meta.json` under `explorer` namespace:
   - Read existing -> merge `{ "explorer": { issue_id, complexity, impact_scope, file_count } }` -> write back
4. Contribute discoveries to `<session>/wisdom/learnings.md` if new patterns found
