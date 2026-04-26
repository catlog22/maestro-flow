# Review Workflow

Tiered multi-dimensional code review with parallel agents, severity classification, and iterative deep-dive.

---

## Prerequisites

- Phase execution completed (task summaries exist)
- Recommended: maestro-verify already run (review uses verification gaps as context)

---

## Phase Resolution

```
Input: <phase> argument (number or slug)

Read .workflow/state.json → state
artifacts = state.artifacts ?? []

IF number: art = artifacts.find(a => a.type === 'execute' && a.phase === number)
IF slug:   art = artifacts.find(a => a.type === 'execute' && a.slug?.includes(slug))
IF art:    PHASE_DIR = ".workflow/" + art.path
ELSE:      ERROR "Phase not found in artifact registry"

Validate execution has occurred (tasks_completed > 0 or .task/ exists)
```

---

## Flag Processing

| Flag | Effect |
|------|--------|
| `--level quick\|standard\|deep` | Explicit review level (default: auto-detect) |
| `--dimensions <list>` | Comma-separated subset (overrides level defaults) |
| `--skip-specs` | Skip loading project specs |

---

## Review Levels

Three tiers that scale with task depth:

| Aspect | Quick | Standard | Deep |
|--------|-------|----------|------|
| **Trigger** | `--level quick`, or auto ≤3 files | Default, or auto 4-19 files | `--level deep`, or auto ≥20 files / critical phase |
| **Dimensions** | correctness, security | All 6 | All 6 |
| **Execution** | Inline (no agents) | Parallel agents | Parallel agents |
| **Deep-Dive** | None | Auto (if critical > 0) | Forced, max 3 iterations |
| **Issue Creation** | Critical only | Critical + High | Critical + High + Medium |
| **Cross-File Analysis** | None | Critical files (3+ dims) | Full impact radius |

---

## Step 1: Collect Changed Files

**Purpose:** Build the file list to review from phase execution artifacts.

### 1a: Extract from task summaries

```
changed_files = []
FOR each .summaries/TASK-{NNN}-summary.md in PHASE_DIR:
  Parse summary for file paths mentioned (created, modified, deleted)
  Add to changed_files[]

FOR each .task/TASK-{NNN}.json in PHASE_DIR:
  Extract files[].path where action is "create" or "modify"
  Add to changed_files[]

Deduplicate changed_files
```

### 1b: Validate files exist

```
review_files = []
FOR each file in changed_files:
  IF file exists on disk AND is not in excluded patterns:
    review_files.push(file)

Excluded patterns:
  - node_modules/**, vendor/**, dist/**, build/**
  - *.lock, *.min.js, *.min.css
  - .workflow/**, .claude/**
```

### 1c: Error if empty

```
IF review_files.length == 0:
  Abort with E004: "No changed files detected in phase"
```

---

## Step 2: Determine Review Level

```
IF --level flag provided:
  level = flag value (quick | standard | deep)
ELSE:
  is_critical_phase = index.json.priority == "critical" || index.json.tags?.includes("critical")
  file_count = review_files.length

  IF file_count <= 3:
    level = "quick"
  ELSE IF file_count >= 20 OR is_critical_phase:
    level = "deep"
  ELSE:
    level = "standard"

Log: "Review level: {level} ({file_count} files)"
```

### Determine dimensions

```
IF --dimensions flag provided:
  dimensions = parse comma-separated list, validate each
ELSE IF level == "quick":
  dimensions = ["correctness", "security"]
ELSE:
  dimensions = ["correctness", "security", "performance", "architecture", "maintainability", "best-practices"]
```

---

## Step 3: Load Project Specs

**Skip if `--skip-specs` flag is set.**

```
specs_content = maestro spec load --category review
```

Pass specs_content to reviewer agents as quality standards context.

---

## Step 4: Load Review Context

Build context object for reviewer agents:

```
review_context = {
  phase_goal: index.json.goal || index.json.description,
  success_criteria: index.json.success_criteria,
  tech_stack: detect from package.json / pyproject.toml / go.mod / Cargo.toml,
  specs: specs_content (from Step 3),
  verification_gaps: [] // from verification.json if exists
}

IF file exists "${PHASE_DIR}/verification.json":
  Load verification.json
  review_context.verification_gaps = verification.json.gaps
  (Reviewers use this to focus on areas with known issues)
```

---

## Step 5: Execute Review

**Execution strategy depends on review level.**

### Quick Level — Inline Scan

No agents spawned. The orchestrator performs the review directly.

```
all_findings = []

FOR each dimension in dimensions:  // correctness, security
  FOR each file in review_files:
    Read file content
    Apply dimension-specific checks:

    IF dimension == "correctness":
      - Scan for: unhandled null/undefined, missing error propagation, type mismatches
      - Scan for: off-by-one patterns, missing boundary checks
      - Scan for: unreachable code, logic contradictions

    IF dimension == "security":
      - Scan for: SQL/command injection (string interpolation in queries)
      - Scan for: hardcoded secrets, API keys, passwords
      - Scan for: missing input validation on external inputs
      - Scan for: XSS vectors (unsanitized user content in output)

    FOR each issue found:
      all_findings.push({
        id: "{PREFIX}-{NNN}",
        dimension, severity, title, file, line, snippet,
        description, impact, suggestion
      })
```

**After inline scan, skip to Step 6 (Aggregate).**

### Standard Level — Parallel Agent Review

Spawn one workflow-reviewer agent per dimension, all in parallel:

```
Agent({
  subagent_type: "workflow-reviewer",
  run_in_background: false,
  description: "Review: {dimension}",
  prompt: `
    ## Assignment
    Dimension: {dimension}
    Phase: {phase_name} — {phase_goal}

    ## Files to Review
    {review_files joined by newline}

    ## Phase Context
    Success criteria: {success_criteria}
    Tech stack: {tech_stack}

    ## Project Specs
    {specs_content or "No specs loaded"}

    ## Known Issues (from verification)
    {verification_gaps or "No prior verification gaps"}

    ## Instructions
    1. Read each file listed above
    2. Analyze for {dimension}-specific issues only
    3. Classify each finding: critical / high / medium / low
    4. Return findings as JSON array with: id, dimension, severity, title, file, line, snippet, description, impact, suggestion, spec_violation (if applicable)
    5. Limit to top 20 findings, prioritized by severity
    6. Every finding MUST have file:line evidence
  `
})
```

**Launch ALL dimension agents in a single message** (parallel execution).

Collect results:
```
dimension_results = {}
FOR each completed agent:
  Parse JSON findings array from agent output
  dimension_results[dimension] = findings[]
  IF agent failed:
    Log warning W001, continue with partial results
```

### Deep Level — Enhanced Agent Review

Same parallel agent spawning as standard, but with enhanced prompt:

```
Agent({
  subagent_type: "workflow-reviewer",
  run_in_background: false,
  description: "Review: {dimension}",
  prompt: `
    ## Assignment
    Dimension: {dimension}
    Phase: {phase_name} — {phase_goal}
    Review Level: DEEP — thorough analysis required

    ## Files to Review
    {review_files joined by newline}

    ## Phase Context
    Success criteria: {success_criteria}
    Tech stack: {tech_stack}

    ## Project Specs
    {specs_content or "No specs loaded"}

    ## Known Issues (from verification)
    {verification_gaps or "No prior verification gaps"}

    ## Instructions (Deep Mode)
    1. Read each file listed above completely
    2. For each file, also read its direct imports to understand context
    3. Analyze for {dimension}-specific issues
    4. Classify each finding: critical / high / medium / low
    5. For critical/high findings: trace callers and dependents
    6. Cross-reference patterns across files (duplication, inconsistency)
    7. Return findings as JSON array with: id, dimension, severity, title, file, line, snippet, description, impact, suggestion, spec_violation, related_files[]
    8. Limit to top 30 findings, prioritized by severity
    9. Every finding MUST have file:line evidence
  `
})
```

Collect results same as standard.

---

## Step 6: Aggregate Findings

### 6a: Merge all findings

```
all_findings = []
FOR each dimension in dimension_results (or inline results for quick):
  all_findings.push(...findings)

Sort all_findings by severity (critical > high > medium > low), then by dimension
```

### 6b: Severity distribution

```
severity_dist = {
  critical: all_findings.filter(f => f.severity == "critical").length,
  high: all_findings.filter(f => f.severity == "high").length,
  medium: all_findings.filter(f => f.severity == "medium").length,
  low: all_findings.filter(f => f.severity == "low").length
}
```

### 6c: Identify critical files (standard + deep only)

```
IF level != "quick":
  file_dimension_map = {}
  FOR each finding in all_findings:
    IF finding.severity in ["critical", "high"]:
      file_dimension_map[finding.file] = file_dimension_map[finding.file] || new Set()
      file_dimension_map[finding.file].add(finding.dimension)

  critical_files = Object.entries(file_dimension_map)
    .filter(([file, dims]) => dims.size >= 3)
    .map(([file, dims]) => ({ file, dimensions: [...dims] }))
```

### 6d: Determine verdict

```
IF severity_dist.critical > 0:
  verdict = "BLOCK"    // Must fix before proceeding
ELSE IF severity_dist.high > 5:
  verdict = "BLOCK"    // Too many high-severity issues
ELSE IF severity_dist.high > 0:
  verdict = "WARN"     // Should fix, can proceed with acknowledgment
ELSE:
  verdict = "PASS"     // Good to proceed
```

---

## Step 7: Deep-Dive (Conditional)

**Skip entirely for quick level.**

**Trigger conditions:**
- **Standard**: `severity_dist.critical > 0` (auto-trigger)
- **Deep**: Always triggered (forced)

**Skip if level == "standard" AND severity_dist.critical == 0.**

### 7a: Select deep-dive targets

```
IF level == "deep":
  deep_dive_targets = all_findings
    .filter(f => f.severity in ["critical", "high"])
    .slice(0, 15)  // More targets for deep level
ELSE:
  deep_dive_targets = all_findings
    .filter(f => f.severity == "critical")
    .slice(0, 10)
```

### 7b: Deep-dive iteration

```
max_iterations = level == "deep" ? 3 : 1
deep_dive_results = []

FOR iteration = 1 TO max_iterations:
  unresolved = deep_dive_targets.filter(t => !t.deep_dive_complete)
  IF unresolved.length == 0: break

  FOR each target in unresolved:
    Agent({
      subagent_type: "workflow-reviewer",
      run_in_background: false,
      description: "Deep-dive: {target.id}",
      prompt: `
        ## Deep-Dive Analysis (Iteration {iteration})
        Original finding: {target as JSON}
        {IF iteration > 1: "Previous analysis: {previous_result}"}

        ## Extended Context
        1. Read the affected file completely: {target.file}
        2. Find all imports/callers of the affected code:
           grep -r "{identifier}" src/ --include="*.ts" --include="*.tsx" --include="*.py"
        3. Check related test files for coverage

        ## Analyze
        - Root cause: Why does this issue exist?
        - Impact radius: What other code is affected?
        - Remediation: Specific fix with code example
        - Risk: What could go wrong if unfixed?

        ## Output
        Return JSON:
        {
          "finding_id": "{target.id}",
          "root_cause": "...",
          "impact_radius": ["file1.ts", "file2.ts"],
          "remediation": { "approach": "...", "code_example": "..." },
          "risk_if_unfixed": "...",
          "reassessed_severity": "critical|high|medium|low",
          "confidence": 0.0-1.0
        }
      `
    })

  Merge results:
  FOR each result:
    Find original finding by finding_id
    Enrich with root_cause, impact_radius, remediation, risk_if_unfixed
    IF result.confidence >= 0.8:
      target.deep_dive_complete = true
    Update severity if reassessed differently (with justification)
    deep_dive_results.push(result)

  IF level == "deep" AND iteration < max_iterations:
    Log: "Deep-dive iteration {iteration} complete. {unresolved remaining} findings need further analysis."
```

---

## Step 8: Auto-Create Issues

**Issue creation thresholds by level:**

| Level | Severities that create issues |
|-------|-------------------------------|
| Quick | Critical only |
| Standard | Critical + High |
| Deep | Critical + High + Medium |

```
IF level == "quick":
  issue_findings = all_findings.filter(f => f.severity == "critical")
ELSE IF level == "standard":
  issue_findings = all_findings.filter(f => f.severity in ["critical", "high"])
ELSE:
  issue_findings = all_findings.filter(f => f.severity in ["critical", "high", "medium"])

IF issue_findings.length > 0:
  mkdir -p ".workflow/issues"
  existing_ids = []
  IF file exists ".workflow/issues/issues.jsonl":
    Read .workflow/issues/issues.jsonl
    Extract all id fields matching today's date prefix ISS-YYYYMMDD-*
    existing_ids = collected IDs

  today = format(now(), "YYYYMMDD")
  counter = max sequence number from existing_ids for today + 1 (start at 1 if none)

  FOR each finding IN issue_findings:
    issue_id = "ISS-{today}-{counter padded to 3 digits}"
    issue = {
      id: issue_id,
      title: "[{finding.dimension}] {finding.title}" (truncated to 100 chars),
      status: "registered",
      priority: severity_to_priority(finding.severity),
      severity: finding.severity,
      source: "review",
      phase_ref: PHASE_NUM,
      gap_ref: finding.id,
      description: finding.description,
      fix_direction: finding.suggestion,
      context: {
        location: "{finding.file}:{finding.line}",
        suggested_fix: finding.suggestion,
        notes: finding.impact
      },
      tags: ["review", finding.dimension],
      affected_components: [],
      feedback: [],
      issue_history: [],
      created_at: now(),
      updated_at: now(),
      resolved_at: null,
      resolution: null
    }
    Append JSON line to .workflow/issues/issues.jsonl
    finding.issue_id = issue_id
    counter++

  Print: "Created {issue_findings.length} issues from review findings"
```

**severity_to_priority mapping**: critical → 1, high → 2, medium → 3

---

## Step 9: Write review.json

**Archive previous review artifacts** before writing:
```
IF file exists "${PHASE_DIR}/review.json":
  mkdir -p "${PHASE_DIR}/.history"
  TIMESTAMP = current timestamp formatted as "YYYY-MM-DDTHH-mm-ss"
  mv "${PHASE_DIR}/review.json" "${PHASE_DIR}/.history/review-${TIMESTAMP}.json"
```

```
Write ${PHASE_DIR}/review.json:
{
  "phase": PHASE_NUM,
  "level": "quick" | "standard" | "deep",
  "verdict": "PASS" | "WARN" | "BLOCK",
  "reviewed_at": now(),
  "reviewer": "workflow-reviewer",
  "dimensions_reviewed": dimensions,
  "files_reviewed": review_files,
  "severity_distribution": {
    "critical": N,
    "high": N,
    "medium": N,
    "low": N,
    "total": N
  },
  "critical_files": critical_files,
  "findings": all_findings,
  "deep_dives": deep_dive_results (if any),
  "issues_created": issue_ids[]
}
```

---

## Step 10: Update index.json

```
index.json.updated_at = now()
index.json.review = {
  level: review.json.level,
  verdict: review.json.verdict,
  reviewed_at: review.json.reviewed_at,
  severity_distribution: review.json.severity_distribution,
  findings_count: review.json.severity_distribution.total,
  issues_created: review.json.issues_created.length
}
```

---

## Report Format

```
=== CODE REVIEW RESULTS ===
Phase:     {phase_name}
Level:     {quick | standard | deep}
Files:     {files_reviewed.length} files across {dimensions.length} dimensions
Duration:  {duration}

Severity Distribution:
  Critical: {critical}
  High:     {high}
  Medium:   {medium}
  Low:      {low}

Top Issues:
  1. [{severity}] {finding_id}: {title} ({file}:{line})
  2. [{severity}] {finding_id}: {title} ({file}:{line})
  3. [{severity}] {finding_id}: {title} ({file}:{line})
  ... (up to 10)

{IF level != "quick":
Critical Files (3+ dimensions flagged):
  - {file} ({dimension1}, {dimension2}, {dimension3})
}

Verdict: {PASS | WARN | BLOCK}
Issues Created: {count}

Files:
  {artifact_dir}/review.json

Next steps:
  {suggested_next_command}
```

---

## Next Step Routing

| Verdict | Suggestion |
|---------|------------|
| PASS | Skill({ skill: "quality-test", args: "{phase}" }) for UAT, or Skill({ skill: "maestro-milestone-audit" }) if UAT already passed |
| WARN | Review findings, then Skill({ skill: "quality-test", args: "{phase}" }) — acknowledge warnings before proceeding |
| BLOCK | Fix critical issues first: Skill({ skill: "maestro-plan", args: "{phase} --gaps" }) -> Skill({ skill: "maestro-execute", args: "{phase}" }) -> re-run Skill({ skill: "quality-review", args: "{phase}" }) |

---

## Error Handling

| Error | Action |
|-------|--------|
| Phase directory not found | Abort: "Phase {phase} not found." |
| No execution results | Abort: "No completed tasks found. Run maestro-execute first." |
| No changed files | Abort: "No changed files detected in this phase." |
| Reviewer agent fails | Log W001, continue with available dimension results |
| All agents fail | Abort: "Review could not complete — all dimension agents failed." |
| Deep-dive agent fails | Log finding as unresolved, skip enrichment |

---

## State Updates

| When | Field | Value |
|------|-------|-------|
| Step 5 start | index.json.status | "reviewing" (if currently "verifying") |
| Step 10 | index.json.review | Review results summary |
| Step 10 | index.json.updated_at | Current timestamp |
