# Spec Map Agent Instruction Template

Used by `spawn_agents_on_csv` in the spec-map skill. Column placeholders `{column}` are substituted at runtime.

---

## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read shared discoveries: {session_folder}/discoveries.ndjson (if exists, skip if not)
2. Read project context: .workflow/project-tech.json (if exists)
3. Read project specs: .workflow/specs/ (if exists)

---

## Your Task

**Task ID**: {id}
**Title**: {title}
**Focus Area**: {focus_area}
**Output File**: {output_file}

### Description
{description}

### Previous Tasks' Findings (Context)
{prev_context}

---

## Execution Protocol

1. **Read discoveries**: Load shared board for findings already found by other mappers
2. **Use context**: Apply previous tasks' findings from prev_context above (if any)
3. **Execute analysis**:
   - Scan the codebase through the lens of your focus area (`{focus_area}`)
   - If focus_area is `full`, analyze the entire project scope
   - If focus_area is a specific area (e.g., `auth`, `api`), narrow analysis to that domain
   - Use `Glob` and `Grep` to discover relevant files and patterns
   - Read key files to extract detailed information
   - For `tech-stack`: scan package.json, build configs, CI/CD files, runtime configs
   - For `architecture`: map directory tree, import graph, module boundaries, entry points
   - For `features`: inventory commands, endpoints, UI components, integrations
   - For `concerns`: identify error handling, logging, auth, config, testing patterns
4. **Share discoveries**: Append exploration findings to shared board:
   ```bash
   echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","worker":"{id}","type":"<type>","data":{...}}' >> {session_folder}/discoveries.ndjson
   ```
   Discovery types to share:
   - `tech_stack`: `{framework, language, tools[]}` — Technology stack info
   - `code_pattern`: `{name, file, description}` — Reusable code pattern found
   - `integration_point`: `{file, description, exports[]}` — Module connection point
   - `convention`: `{naming, imports, formatting}` — Project conventions discovered

5. **Write output file**: Write full analysis to `.workflow/codebase/{output_file}`
6. **Report result**: Return JSON via report_agent_job_result

---

## Output (report_agent_job_result)

Return JSON:
```json
{
  "id": "{id}",
  "status": "completed" | "failed",
  "findings": "Summary of key findings for this focus area (max 500 chars)",
  "error": ""
}
```

### Focus Area Scoping Guide

| Focus Area | Scope | Key Files to Scan |
|------------|-------|-------------------|
| `full` | Entire project — comprehensive analysis | All source directories |
| Specific (e.g., `auth`) | Narrow to that domain | Files matching the domain name, related imports |

When focus_area is specific:
- Filter file discovery to paths containing the focus area term
- Include files that import from or are imported by the focus area
- Still note project-wide patterns relevant to the focus area
