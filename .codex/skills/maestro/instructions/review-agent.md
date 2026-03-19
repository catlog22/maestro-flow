# Review Agent Instruction Template

Used by `spawn_agents_on_csv` in the review skill. Column placeholders `{column}` are substituted at runtime.

---

## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read shared discoveries: {session_folder}/discoveries.ndjson (if exists, skip if not)
2. Read project context: .workflow/project-tech.json (if exists)
3. Read project specs referenced in project_specs field below

---

## Your Task

**Task ID**: {id}
**Title**: {title}
**Dimension**: {dimension}
**Review Level**: {review_level}

### Description
{description}

### Files to Review
{changed_files}

### Project Specs Context
{project_specs}

### Previous Tasks' Findings (Context)
{prev_context}

---

## Execution Protocol

1. **Read discoveries**: Load shared board for cross-dimension findings already found
2. **Use context**: Apply previous tasks' findings from prev_context above
3. **Execute review**:
   - Read each file in `changed_files` (semicolon-separated paths)
   - For each file, analyze through the lens of your `dimension`
   - Classify each finding by severity: critical / high / medium / low
   - Include precise `file:line` references for each finding
   - For `aggregation` dimension: synthesize all dimension findings, determine verdict, perform deep-dive if critical findings exist
4. **Share discoveries**: Append exploration findings to shared board:
   ```bash
   echo '{"ts":"<ISO8601>","worker":"{id}","type":"<type>","data":{...}}' >> {session_folder}/discoveries.ndjson
   ```
   Discovery types to share:
   - `vulnerability`: `{location, type, severity, cwe}` — Security vulnerability
   - `code_smell`: `{location, type, severity, description}` — Code quality issue
   - `performance_hotspot`: `{location, type, impact}` — Performance issue
   - `architecture_violation`: `{location, rule, description}` — Architecture rule violation
   - `code_pattern`: `{name, file, description}` — Reusable code pattern found
   - `convention`: `{naming, imports, formatting}` — Project conventions discovered

5. **Report result**: Return JSON via report_agent_job_result

---

## Output (report_agent_job_result)

Return JSON:
```json
{
  "id": "{id}",
  "status": "completed" | "failed",
  "findings": "Summary of key findings for this dimension (max 500 chars)",
  "severity_counts": "{\"critical\":0,\"high\":0,\"medium\":0,\"low\":0}",
  "top_issues": "[severity] description (file:line) — one per line, max 5",
  "error": ""
}
```

### Severity Classification Guide

| Severity | Criteria | Examples |
|----------|----------|---------|
| Critical | Data loss, security breach, crash in production | SQL injection, null deref on hot path, auth bypass |
| High | Significant bug, security weakness, major perf issue | Missing input validation, N+1 query, race condition |
| Medium | Minor bug, code smell, moderate concern | Unused import, missing error type, suboptimal algorithm |
| Low | Style, convention, minor improvement | Naming inconsistency, missing JSDoc, verbose code |
