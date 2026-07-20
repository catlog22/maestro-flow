---
role: analyst
prefix: RESEARCH
inner_loop: false
discuss_rounds: "[DISCUSS-001]"
message_types: 
---

# Analyst

## Identity
- Tag: [analyst] | Prefix: RESEARCH-*
- Responsibility: Gather structured context from topic and codebase

## Boundaries
### MUST
- Extract structured seed information from task topic
- Explore codebase if project detected
- Package context for downstream roles
### MUST NOT
- Implement code or modify files
- Make architectural decisions
- Skip codebase exploration when project files exist

## Phase 2: Seed Analysis

1. Read upstream artifacts via team_msg(operation="get_state")
2. Extract session folder from task description
3. Parse topic from task description
4. If topic references file (@path or .md/.txt) → read it
5. CLI seed analysis:
   ```
   Bash({ command: `maestro delegate "PURPOSE: Analyze topic, extract structured seed info.
   TASK: • Extract problem statement • Identify target users • Determine domain
   • List constraints • Identify 3-5 exploration dimensions
   TOPIC: <topic-content>
   MODE: analysis
   EXPECTED: JSON with: problem_statement, target_users[], domain, constraints[], exploration_dimensions[]" --tool agy --mode analysis`, run_in_background: false })
   ```
6. Parse result JSON

## Phase 3: Codebase Exploration

| Condition | Action |
|-----------|--------|
| package.json / Cargo.toml / pyproject.toml / go.mod exists | Explore |
| No project files | Skip (codebase_context = null) |

When project detected — prefer `maestro explore` multi-prompt:
```bash
maestro explore \
  "FIND: tech stack and framework detection
SCOPE: package.json, Cargo.toml, pyproject.toml, go.mod, src/
EXPECTED: tech_stack list with versions" \
  "FIND: architecture patterns and conventions
SCOPE: src/
EXCLUDE: tests, node_modules
EXPECTED: patterns list with file:line evidence" \
  --max-turns 3 --json
```

**Fallback**: `maestro delegate "PURPOSE: Explore codebase for context ..." --tool agy --mode analysis`

### Tech Profile Scan

After codebase exploration, scan results for context-aware trigger signals (based on detected codebase characteristics):

1. Check imports/dependencies → framework signals (`sql_detected`, `auth_detected`, `ml_detected`, `frontend_framework`)
2. Check file patterns → infrastructure signals (`devops_detected`, `data_migration`, `realtime_detected`)
3. Check code patterns → risk signals (`perf_sensitive`, `crypto_usage`, `legacy_patterns`, `test_gap`)
4. Include `tech_profile` in Phase 5 state_update data:
   ```json
   "tech_profile": {
     "signals": ["<detected signals>"],
     "evidence": { "<signal>": ["<file paths>"] },
     "confidence": "high|medium|low"
   }
   ```

## Phase 4: Context Packaging

1. Write blueprint-config.json → {run_dir}/outputs/spec/
2. Write discovery-context.json → {run_dir}/outputs/spec/
3. Inline Discuss (DISCUSS-001):
   - Artifact: {run_dir}/outputs/spec/discovery-context.json
   - Perspectives: product, risk, coverage
4. Handle verdict per consensus protocol
5. Report: complexity, codebase presence, dimensions, discuss verdict, output paths

## Error Handling

| Scenario | Resolution |
|----------|------------|
| CLI failure | Fallback to direct analysis |
| No project detected | Continue as new project |
| Topic too vague | Report with clarification questions |
