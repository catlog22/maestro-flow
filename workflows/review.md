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

Resolve phase from .workflow/state.json artifacts (type=execute, match by phase number or slug)
→ PHASE_DIR = ".workflow/" + artifact.path
→ Error if not found or no completed tasks
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
Collect changed_files from PHASE_DIR:
  - .summaries/TASK-{NNN}-summary.md → extract referenced file paths (created/modified/deleted)
  - .task/TASK-{NNN}.json → extract files[].path where action is create|modify
Deduplicate result
```

### 1b: Validate files exist

```
review_files = changed_files filtered to: exists on disk AND not in excluded patterns

Excluded patterns:
  - node_modules/**, vendor/**, dist/**, build/**
  - *.lock, *.min.js, *.min.css
  - .workflow/**, .claude/**
```

### 1c: Error if empty

```
Abort E004 if review_files is empty
```

---

## Step 2: Determine Review Level

```
level = --level flag value, or auto-detect:
  ≤3 files → quick | ≥20 files or critical phase → deep | otherwise → standard

Log: "Review level: {level} ({file_count} files)"
```

### Determine dimensions

```
dimensions = --dimensions flag (comma-separated), or level defaults:
  quick → [correctness, security]
  standard|deep → [correctness, security, performance, architecture, maintainability, best-practices]
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
  verification_gaps: load from ${PHASE_DIR}/verification.json .gaps if exists, else []
}
```

---

## Step 5: Execute Review

**Execution strategy depends on review level.**

### Quick Level — Inline Scan

No agents spawned. The orchestrator performs the review directly.

```
Scan each review_file against each dimension, collecting findings:

  correctness: unhandled null/undefined, missing error propagation, type mismatches,
               off-by-one, missing boundary checks, unreachable code, logic contradictions
  security:    SQL/command injection, hardcoded secrets/keys/passwords,
               missing input validation, XSS vectors

Each finding: { id: "{PREFIX}-{NNN}", dimension, severity, title, file, line, snippet,
               description, impact, suggestion }
```

**After inline scan, skip to Step 6 (Aggregate).**

### Standard Level — Parallel Agent Review

Spawn one workflow-reviewer agent per dimension, all in parallel:

```
Per dimension → spawn workflow-reviewer agent (all parallel):
  Context: dimension, phase_name, phase_goal, review_files, success_criteria,
           tech_stack, specs_content, verification_gaps
  Instructions:
    - Read each file, analyze for {dimension}-specific issues only
    - Classify: critical / high / medium / low
    - Return JSON array: id, dimension, severity, title, file, line, snippet,
      description, impact, suggestion, spec_violation (if applicable)
    - Top 20 findings by severity, each with file:line evidence
```

**Launch ALL dimension agents in a single message** (parallel execution).

Collect dimension_results from each agent (JSON findings array). Log W001 on agent failure, continue with partial results.

### Deep Level — Enhanced Agent Review

Same parallel agent spawning as standard, but with enhanced prompt:

```
Same parallel agent spawning as standard, with deep-mode enhancements:
  - Also read direct imports for context
  - Trace callers/dependents for critical/high findings
  - Cross-reference patterns across files (duplication, inconsistency)
  - Return includes additional field: related_files[]
  - Top 30 findings (vs 20 for standard)
```

Collect results same as standard.

---

## Step 6: Aggregate Findings

### 6a: Merge all findings

```
all_findings = merge all dimension results, sorted by severity (critical > high > medium > low), then dimension
```

### 6b: Severity distribution

```
severity_dist = count all_findings by severity {critical, high, medium, low}
```

### 6c: Identify critical files (standard + deep only)

```
IF level != "quick":
  critical_files = files with critical/high findings across 3+ distinct dimensions
  → [{ file, dimensions[] }]
```

### 6d: Determine verdict

```
verdict:
  BLOCK → any critical, or >5 high
  WARN  → any high (≤5)
  PASS  → no critical or high
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
deep_dive_targets:
  deep  → critical + high findings, top 15
  standard → critical findings only, top 10
```

### 7b: Deep-dive iteration

```
Iterate up to max_iterations (deep=3, standard=1) over unresolved targets:

  Per target → spawn workflow-reviewer agent:
    Context: original finding JSON, previous analysis (if iteration > 1)
    Tasks: read affected file, find callers/imports, check test coverage
    Analyze: root cause, impact radius, remediation (with code example), risk if unfixed

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

  Merge: enrich original finding, mark complete if confidence >= 0.8,
         update severity if reassessed. Stop early if all resolved.
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
Filter findings by level threshold (quick=critical, standard=critical+high, deep=+medium)

For each qualifying finding → append issue to .workflow/issues/issues.jsonl:
  id: "ISS-{YYYYMMDD}-{NNN}" (auto-increment from existing today's entries)
  title: "[{dimension}] {title}" (max 100 chars)
  status: "registered"
  priority: severity_to_priority (critical→1, high→2, medium→3)
  severity, source: "review", phase_ref, gap_ref: finding.id
  description, fix_direction: finding.suggestion
  context: { location: "{file}:{line}", suggested_fix, notes: impact }
  tags: ["review", dimension]
  Timestamps: created_at, updated_at = now()

Link finding.issue_id back to created issue
```

**severity_to_priority mapping**: critical → 1, high → 2, medium → 3

---

## Step 9: Write review.json

**Archive previous review artifacts** before writing:
```
Archive existing review.json → ${PHASE_DIR}/.history/review-{YYYY-MM-DDTHH-mm-ss}.json
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
Update index.json.updated_at = now()
Set index.json.review = { level, verdict, reviewed_at, severity_distribution,
                          findings_count, issues_created count }
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
