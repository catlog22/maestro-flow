---
role: scout
prefix: SCOUT
inner_loop: false
message_types:
  success: scan_ready
  error: error
  issues: issues_found
---

# Multi-Perspective Scout

Scan codebase from multiple perspectives (bug, security, test-coverage, code-quality, UX) to discover potential issues. Produce structured scan results with severity-ranked findings.

## Phase 2: Context & Scope Assessment

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | No |

1. Extract session path and target scope from task description
2. Determine scan scope: explicit scope from task or `**/*` default
3. Get recent changed files: `git diff --name-only HEAD~5 2>/dev/null || echo ""`
4. Read .msg/meta.json for historical defect patterns (`defect_patterns`)
5. Select scan perspectives based on task description:
   - Default: `["bug", "security", "test-coverage", "code-quality"]`
   - Add `"ux"` if task mentions UX/UI
6. Assess complexity to determine scan strategy:

| Complexity | Condition | Strategy |
|------------|-----------|----------|
| Low | < 5 changed files, no specific keywords | ACE search + Grep inline |
| Medium | 5-15 files or specific perspective requested | CLI fan-out (3 core perspectives) |
| High | > 15 files or full-project scan | CLI fan-out (all perspectives) |

## Phase 3: Multi-Perspective Scan

**Low complexity**: Use `mcp__ace-tool__search_context` for quick pattern-based scan.

**Medium/High complexity**: CLI fan-out -- one `maestro delegate --mode analysis` per perspective:

For each active perspective, build prompt:
```
PURPOSE: Scan code from <perspective> perspective to discover potential issues
TASK: Analyze code patterns for <perspective> problems, identify anti-patterns, check for common issues
MODE: analysis
CONTEXT: @<scan-scope>
EXPECTED: List of findings with severity (critical/high/medium/low), file:line references, description
CONSTRAINTS: Focus on actionable findings only
```
Execute via: `maestro delegate "<prompt>" --role analyze --mode analysis`

After all perspectives complete:
- Parse CLI outputs into structured findings
- Deduplicate by file:line (merge perspectives for same location)
- Compare against known defect patterns from .msg/meta.json
- Rank by severity: critical > high > medium > low

## Phase 4: Result Aggregation

1. Build `discoveredIssues` array from critical + high findings (with id, severity, perspective, file, line, description)
2. Write scan results to `<session>/scan/scan-results.json`:
   - scan_date, perspectives scanned, total findings, by_severity counts, findings detail, issues_created count
3. Update `<session>/wisdom/.msg/meta.json`: merge `discovered_issues` field
4. Contribute to wisdom/issues.md if new patterns found
