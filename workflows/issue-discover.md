# Workflow: Issue Discovery

Automated issue discovery via multi-perspective analysis or prompt-driven exploration.

## Input

- `$ARGUMENTS`: empty (multi-perspective) or `by-prompt [prompt text]`
- Operates on `.workflow/issues/`

---

### Step 1: Parse Mode

```
Mode from $ARGUMENTS:
  empty         → MULTI_PERSPECTIVE (Step 3)
  "by-prompt"   → PROMPT_DRIVEN (Step 7), remaining tokens = USER_PROMPT
```

---

### Step 2: Validate Environment

```
Require .workflow/ exists → fatal if missing: "No project initialized. Run /maestro-init first."
Ensure .workflow/issues/ and issues.jsonl exist (create if missing).

Session ID: DBP-{YYYYMMDD}-{HHmmss}
Session dir: .workflow/issues/discoveries/{SESSION_ID}/

Initialize discovery-state.json:
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
specs_content = maestro spec load --category coding
```

Pass to each analysis agent so severity assessments align with project quality standards.

---

### Step 4: Launch Parallel Analysis

```
Batches of 4 concurrent agents:
  Batch 1: security, performance, reliability, maintainability
  Batch 2: scalability, ux, accessibility, compliance

Per perspective → delegate analysis:

  maestro delegate "PURPOSE: Discover {PERSPECTIVE} issues in the codebase.
  Focus: {FOCUS_AREA} | Question: {QUESTION}
  TASK: Scan source files → identify issues with file:line → rate severity → suggest fix
  MODE: analysis
  CONTEXT: @**/*
  EXPECTED: JSON array: [{ title, severity, description, location, fix_direction, affected_components[] }]
  CONSTRAINTS: Evidence-backed findings only
  " --role analyze --mode analysis

Results → .workflow/issues/discoveries/{SESSION_ID}/{PERSPECTIVE}-findings.json
Update discovery-state.json: perspectives_completed += ["{PERSPECTIVE}"]
```

### Step 5: Deduplicate Findings

```
Merge all *-findings.json → single list.
Deduplicate: group by file path, merge entries with >80% description overlap
or same file:line (keep higher severity).
Track issues_found (pre-dedup) and issues_deduplicated (post-dedup) in discovery-state.json.
```

### Step 6: Create Issues from Findings

```
Per unique finding → generate ISS-YYYYMMDD-NNN, build issue record:
  {
    "id", "title", "status": "registered",
    "priority": severity_to_priority(critical→1, high→2, medium→3, low→4),
    "severity", "source": "discovery",
    "description", "fix_direction",
    "context": { "location", "notes": "Discovered by {PERSPECTIVE} in {SESSION_ID}" },
    "tags": ["{PERSPECTIVE}"],
    "affected_components",
    "issue_history": [{ from: null, to: "registered", actor: "discovery-agent" }],
    "created_at", "updated_at"
  }

Append to: .workflow/issues/issues.jsonl + discoveries/{SESSION_ID}/discovery-issues.jsonl
Finalize discovery-state.json: status = "completed", completed_at = NOW_ISO

Display summary: session ID, mode, raw/unique counts, per-perspective breakdown, severity breakdown.

Next steps:
  - manage-issue list --severity critical
  - manage-issue list
  - manage-issue-discover by-prompt "..."
```

---

## Prompt-Driven Discovery (discover-by-prompt)

### Step 7: Parse User Prompt

```
Extract USER_PROMPT from DISCOVERY_ARGS.
If empty → prompt user to select focus area:
  - Error handling gaps | API contract violations | Test coverage gaps | Custom
```

### Step 8: Plan Exploration Dimensions

```
Delegate to decompose USER_PROMPT into 3-5 exploration dimensions:

  maestro delegate "Decompose into searchable dimensions: {USER_PROMPT}
  EXPECTED: JSON array: [{ name, description, search_patterns[], file_patterns[], finding_criteria }]
  " --role analyze --mode analysis

Store → .workflow/issues/discoveries/{SESSION_ID}/exploration-plan.json
```

### Step 9: Gather Codebase Context

```
Per dimension:
  1. Semantic search via {search_tool}(query="{dimension.description}")
  2. Pattern search via rg for each dimension.search_patterns
  3. Collect matching files/snippets → {SESSION_ID}/{dimension.name}-context.md
```

### Step 10: Iterative Exploration Loop

```
Up to 3 rounds (exit early if no new gaps/findings):
  Round 1: Analyze context → identify issues + coverage gaps
  Round 2: Refine patterns for gaps → search adjacent files → merge findings
  Round 3: Final sweep on uncovered high-severity patterns + cross-module interactions

Log per round → {SESSION_ID}/exploration-log.md:
  Files analyzed, new/cumulative findings, remaining gaps.
```

### Step 11: Generate Issues from Findings

```
Deduplicate all findings (same logic as Step 5).
Per unique finding → issue record (same structure as Step 6):
  source = "discovery", tags = ["prompt-discovery", "{dimension.name}"]
  context.notes = "Discovered via prompt: {USER_PROMPT}"

Append to: issues.jsonl + discoveries/{SESSION_ID}/discovery-issues.jsonl
Finalize discovery-state.json: status = "completed"

Display summary: session, prompt, rounds, raw/unique counts, per-dimension + severity breakdown.

Next steps:
  - manage-issue list --source discovery
  - manage-issue-discover (full 8-perspective scan)
  - manage-issue-discover by-prompt "..." (explore another area)
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
