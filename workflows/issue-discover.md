# Workflow: Issue Discovery

Automated issue discovery via multi-perspective analysis or prompt-driven exploration.

## Input

- `$ARGUMENTS`: empty (multi-perspective) or `by-prompt [prompt text]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Mode

```
1. Extract mode from $ARGUMENTS:
   - empty or no arguments → MULTI_PERSPECTIVE mode (Step 3)
   - "by-prompt" → PROMPT_DRIVEN mode (Step 7)

2. Remaining tokens after mode keyword = DISCOVERY_ARGS
   For by-prompt: join remaining tokens as USER_PROMPT
```

---

### Step 2: Validate Environment

```
1. Check .workflow/ exists
   If not → fatal: "No project initialized. Run /maestro-init first."

2. Check .workflow/issues/ exists
   If not → mkdir -p .workflow/issues/

3. Ensure issues.jsonl exists
   If not → touch .workflow/issues/issues.jsonl

4. Generate discovery session ID:
   DBP-{YYYYMMDD}-{HHmmss}

5. Create discovery session directory:
   mkdir -p .workflow/issues/discoveries/{SESSION_ID}/

6. Initialize discovery-state.json:
   {
     "id": "{SESSION_ID}",
     "mode": "{discover|discover-by-prompt}",
     "status": "in_progress",
     "started_at": "{NOW_ISO}",
     "completed_at": null,
     "perspectives_completed": [],
     "issues_found": 0,
     "issues_deduplicated": 0
   }
```

---

## Multi-Perspective Discovery (discover)

### Step 3: Define Analysis Perspectives

```
8 analysis perspectives, each with a focus area and guiding questions:

1. SECURITY
   Focus: Authentication, authorization, input validation, secrets, injection
   Question: "What security vulnerabilities or unsafe patterns exist?"

2. PERFORMANCE
   Focus: N+1 queries, unbounded loops, missing caching, memory leaks, large payloads
   Question: "What performance bottlenecks or inefficiencies exist?"

3. RELIABILITY
   Focus: Error handling, retry logic, race conditions, data integrity, graceful degradation
   Question: "What failure modes are unhandled or could cause data loss?"

4. MAINTAINABILITY
   Focus: Code duplication, tight coupling, missing abstractions, unclear naming, dead code
   Question: "What makes this codebase harder to understand or change?"

5. SCALABILITY
   Focus: Hardcoded limits, single-threaded bottlenecks, stateful assumptions, schema rigidity
   Question: "What will break or degrade as load/data/users increase?"

6. UX
   Focus: Confusing flows, missing feedback, inconsistent behavior, accessibility gaps
   Question: "What creates friction or confusion for end users?"

7. ACCESSIBILITY
   Focus: Screen reader support, keyboard navigation, color contrast, ARIA labels, focus management
   Question: "What barriers exist for users with disabilities?"

8. COMPLIANCE
   Focus: Logging gaps, audit trails, data retention, privacy controls, regulatory requirements
   Question: "What regulatory or policy requirements are not met?"
```

### Step 3.5: Load Project Specs

```
specs_content = maestro spec load --category execution
```

Pass to each analysis agent so severity assessments align with project quality standards.

---

### Step 4: Launch Parallel Analysis

```
Launch analysis agents in batches of up to 4 concurrent:

Batch 1: security, performance, reliability, maintainability
Batch 2: scalability, ux, accessibility, compliance

For each perspective, launch a CLI analysis:

  maestro delegate "PURPOSE: Discover {PERSPECTIVE} issues in the codebase.
  Focus: {FOCUS_AREA}
  Guiding question: {QUESTION}

  TASK:
  - Scan all source files for {PERSPECTIVE}-related problems
  - Identify concrete issues with file:line references
  - Rate each finding: critical / high / medium / low severity
  - Provide brief fix direction for each finding

  MODE: analysis
  CONTEXT: @**/*
  EXPECTED: JSON array of findings, each with:
    title, severity, description, location (file:line), fix_direction, affected_components[]
  CONSTRAINTS: Only report real issues with evidence, no speculative findings
  " --to gemini --mode analysis

Store results per perspective in:
  .workflow/issues/discoveries/{SESSION_ID}/{PERSPECTIVE}-findings.json

Update discovery-state.json:
  perspectives_completed += ["{PERSPECTIVE}"]
```

### Step 5: Deduplicate Findings

```
1. Load all *-findings.json from the session directory
2. Merge all findings into a single list
3. Deduplicate by similarity:
   - Group findings by affected file path
   - Within each file group, compare descriptions
   - If two findings describe the same issue (>80% description overlap
     or same file:line), keep the one with higher severity
4. Track: issues_found (pre-dedup), issues_deduplicated (post-dedup)
5. Update discovery-state.json with counts
```

### Step 6: Create Issues from Findings

```
For each unique finding:
1. Generate ISS-YYYYMMDD-NNN ID (same logic as create handler in issue.md)
2. Build issue record:
   {
     "id": "{ID}",
     "title": "{finding.title}",
     "status": "registered",
     "priority": {severity_to_priority},
     "severity": "{finding.severity}",
     "source": "discovery",
     "phase_ref": null,
     "gap_ref": null,
     "description": "{finding.description}",
     "fix_direction": "{finding.fix_direction}",
     "context": {
       "location": "{finding.location}",
       "suggested_fix": "",
       "notes": "Discovered by {PERSPECTIVE} analysis in session {SESSION_ID}"
     },
     "tags": ["{PERSPECTIVE}"],
     "affected_components": {finding.affected_components},
     "feedback": [],
     "issue_history": [
       {
         "timestamp": "{NOW_ISO}",
         "from_status": null,
         "to_status": "registered",
         "actor": "discovery-agent",
         "note": "Auto-discovered via {PERSPECTIVE} perspective"
       }
     ],
     "created_at": "{NOW_ISO}",
     "updated_at": "{NOW_ISO}",
     "resolved_at": null,
     "resolution": null
   }

   Severity-to-priority mapping:
     critical → 1
     high     → 2
     medium   → 3
     low      → 4

3. Append to .workflow/issues/issues.jsonl
4. Also append to .workflow/issues/discoveries/{SESSION_ID}/discovery-issues.jsonl

5. Update discovery-state.json:
   status = "completed"
   completed_at = NOW_ISO

6. Display summary:
   ====================================================
     DISCOVERY COMPLETE: {SESSION_ID}
     Mode: multi-perspective (8 perspectives)
     Findings: {issues_found} raw, {issues_deduplicated} unique
     Issues created: {issues_deduplicated}
   ====================================================

   BREAKDOWN BY PERSPECTIVE:
     Security:        {count}
     Performance:     {count}
     Reliability:     {count}
     Maintainability: {count}
     Scalability:     {count}
     UX:              {count}
     Accessibility:   {count}
     Compliance:      {count}

   BREAKDOWN BY SEVERITY:
     Critical: {count}
     High:     {count}
     Medium:   {count}
     Low:      {count}

7. Suggest next steps:
   - Skill({ skill: "manage-issue", args: "list --severity critical" }) -- Review critical issues
   - Skill({ skill: "manage-issue", args: "list" }) -- View all issues
   - Skill({ skill: "manage-issue-discover", args: "by-prompt \"...\"" }) -- Explore specific area deeper
```

---

## Prompt-Driven Discovery (discover-by-prompt)

### Step 7: Parse User Prompt

```
1. Extract USER_PROMPT from DISCOVERY_ARGS
   If empty → AskUserQuestion({
     question: "What kind of issues should I look for?",
     options: [
       { label: "Error handling gaps", description: "Missing try/catch, unhandled promises, swallowed errors" },
       { label: "API contract violations", description: "Mismatched types, missing validation, undocumented endpoints" },
       { label: "Test coverage gaps", description: "Untested code paths, missing edge cases" },
       { label: "Custom", description: "Describe what to look for" }
     ]
   })

2. Store USER_PROMPT for exploration context
```

### Step 8: Plan Exploration Dimensions

```
Use Gemini CLI to decompose the user prompt into exploration dimensions:

  maestro delegate "PURPOSE: Decompose this issue discovery prompt into 3-5 specific exploration dimensions.

  User wants to find: {USER_PROMPT}

  TASK:
  - Break down the prompt into concrete, searchable dimensions
  - For each dimension: provide search patterns (regex/keywords), file patterns, and what constitutes a finding
  - Output as JSON array of dimensions

  MODE: analysis
  EXPECTED: JSON array:
    [{
      name: string,
      description: string,
      search_patterns: string[],
      file_patterns: string[],
      finding_criteria: string
    }]
  " --to gemini --mode analysis

Store dimensions in:
  .workflow/issues/discoveries/{SESSION_ID}/exploration-plan.json
```

### Step 9: Gather Codebase Context

```
For each exploration dimension:

1. Use @~/.maestro/templates/search-tool.json for semantic search:
   {search_tool}(
     project_root_path="{PROJECT_ROOT}",
     query="{dimension.description}"
   )

2. Use ripgrep for pattern-based search:
   For each pattern in dimension.search_patterns:
     rg "{pattern}" --type-add "src:*.{ts,tsx,js,jsx,py,java,go}" --type src -n

3. Collect matching files and code snippets
4. Store context per dimension in:
   .workflow/issues/discoveries/{SESSION_ID}/{dimension.name}-context.md
```

### Step 10: Iterative Exploration Loop

```
Max 3 rounds of exploration:

Round 1: Initial analysis
  - Analyze gathered context from Step 9
  - Identify concrete issues with evidence
  - Identify gaps in coverage (areas not yet explored)

Round 2: Deepen search (if gaps found)
  - For each identified gap:
    - Refine search patterns
    - Search adjacent files/modules
    - Cross-reference with related code
  - Merge new findings with Round 1

Round 3: Final sweep (if significant gaps remain)
  - Focus on high-severity patterns not yet covered
  - Check cross-module interactions
  - Finalize findings list

After each round:
  - Log findings count and coverage assessment
  - If no new gaps or no new findings → exit loop early

Store exploration log:
  .workflow/issues/discoveries/{SESSION_ID}/exploration-log.md

  ## Round {N}
  - Files analyzed: {count}
  - Findings: {count} new, {total} cumulative
  - Gaps remaining: {list or "none"}
```

### Step 11: Generate Issues from Findings

```
1. Collect all findings from exploration rounds
2. Deduplicate (same logic as Step 5):
   - Group by affected file
   - Merge similar descriptions
   - Keep higher-severity duplicate

3. For each unique finding:
   - Generate ISS-YYYYMMDD-NNN ID
   - Build issue record (same structure as Step 6)
   - Set source = "discovery"
   - Set tags = ["prompt-discovery", "{relevant dimension name}"]
   - Set context.notes = "Discovered via prompt: {USER_PROMPT}"

4. Append to .workflow/issues/issues.jsonl
5. Append to .workflow/issues/discoveries/{SESSION_ID}/discovery-issues.jsonl

6. Update discovery-state.json:
   status = "completed"
   completed_at = NOW_ISO

7. Display summary:
   ====================================================
     DISCOVERY COMPLETE: {SESSION_ID}
     Mode: prompt-driven
     Prompt: "{USER_PROMPT}"
     Rounds: {rounds_executed}
     Findings: {raw_count} raw, {deduped_count} unique
     Issues created: {deduped_count}
   ====================================================

   FINDINGS BY DIMENSION:
     {dimension.name}: {count}
     ...

   BREAKDOWN BY SEVERITY:
     Critical: {count}
     High:     {count}
     Medium:   {count}
     Low:      {count}

8. Suggest next steps:
   - Skill({ skill: "manage-issue", args: "list --source discovery" }) -- View discovered issues
   - Skill({ skill: "manage-issue-discover" }) -- Run full 8-perspective scan
   - Skill({ skill: "manage-issue-discover", args: "by-prompt \"...\"" }) -- Explore another area
```

---

## Output

- **Session artifacts**: `.workflow/issues/discoveries/{SESSION_ID}/`
  - `discovery-state.json` -- session metadata and progress
  - `discovery-issues.jsonl` -- issues found in this session
  - `*-findings.json` -- raw findings per perspective (discover mode)
  - `exploration-plan.json` -- dimensions (discover-by-prompt mode)
  - `*-context.md` -- gathered context per dimension
  - `exploration-log.md` -- round-by-round exploration log
- **Issues**: appended to `.workflow/issues/issues.jsonl`

## Quality Criteria

- Multi-perspective mode covers all 8 analysis angles
- Prompt-driven mode decomposes user intent into searchable dimensions
- Findings backed by concrete file:line evidence
- Deduplication prevents duplicate issue records
- Discovery session fully traceable via session directory
- All created issues follow the issue.json template schema
- ID generation avoids collisions with existing issues
