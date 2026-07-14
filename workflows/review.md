# Workflow: Review

Layered multi-dimensional code review — parallel agents, severity grading, iterative deep-dive. Artifacts unified as `review-findings.json`; findings handed to test or plan.

---

## Phase 0: Spec Compliance pre-check

1. Read acceptance criteria from each execution task's `convergence.criteria[]`.
2. For each criterion, grep for the function/endpoint/component named in it.
3. Classify: **MET** (evidence found) | **UNMET** (not implemented) | **PARTIAL** (incomplete).

| Result | Action |
|------|------|
| all MET | proceed to Step 1 dimension review |
| any UNMET | record as spec_compliance_failure, add to findings, severity=critical, dimension="spec-compliance" |
| any PARTIAL | record into findings, severity=high |

---

## Step 1: Collect changed files

Parse the change manifest from `current-execution`: created/modified/deleted paths from task summaries + `files[].path` from task JSON (action create/modify). Deduplicate.

Filter: keep files that exist on disk and are not in the exclusion patterns. Exclude `node_modules/**`, `vendor/**`, `dist/**`, `build/**`, `*.lock`, `*.min.js`, `*.min.css`, `.workflow/**`, `.claude/**`.

Empty changed files → abort (E004).

---

## Step 2: Determine review level and dimensions

```
level = --level value, or auto:
  ≤3 files → quick | ≥20 files or critical session → deep | otherwise → standard

dimensions = --dimensions value, or level default:
  quick → [correctness, security]
  standard | deep → [correctness, security, performance, architecture, maintainability, best-practices]
```

---

## Step 3: Load specs (unless --skip-specs)

```
specs_content = maestro spec load --category review
→ passed to the reviewer agent as the quality standard
```

---

## Step 4: Build review context

```
review_context = {
  session_goal:      goal / description from report.md frontmatter,
  success_criteria:  acceptance criteria,
  tech_stack:        detected from package.json / pyproject.toml / go.mod / Cargo.toml,
  specs:             specs_content (Step 3),
  verification_gaps: gaps from latest-verification (if any), otherwise []
}
```

---

## Step 5: Run review

### Quick — inline scan

Scan each file per dimension, collect findings:

```
correctness: unhandled null/undefined, missing error propagation, type mismatch,
             off-by-one, missing boundary check, unreachable code, logic contradiction
security:    SQL/command injection, hardcoded secrets/passwords, missing input validation, XSS vectors

finding: { id, dimension, severity, title, file, line, snippet,
           description, impact, suggestion }
```

After scanning, jump directly to Step 6.

### Standard — parallel agent review

**Mandatory, cannot be substituted with manual Read/Grep**: dispatch one workflow-reviewer agent per dimension (all parallel, launched in a single message).

```
Context: dimension, session_goal, review_files, success_criteria,
         tech_stack, specs_content, verification_gaps
Instructions:
  - read each file, analyze only issues of this dimension
  - grade critical / high / medium / low
  - return a JSON array: id, dimension, severity, title, file, line, snippet,
    description, impact, suggestion, spec_violation (if any)
  - take top 20 by severity, each with file:line evidence
```

Collect dimension_results. On agent failure record W001, continue with partial results, and mark the review [LOW CONFIDENCE] (partial results).

### Deep — enhanced agent review

Same as standard, plus deep enhancements:

```
- additionally read direct imports as context
- for critical/high findings, trace callers/dependents
- cross-file pattern comparison (duplication, inconsistency)
- return additional field related_files[]
- top 30 findings (standard is 20)
```

---

## Step 6: Aggregate findings

```
all_findings = merge all dimension results, sort by severity (critical > high > medium > low), then by dimension
severity_dist = count by {critical, high, medium, low}

IF level != quick:
  critical_files = files with a critical/high finding in 3+ distinct dimensions → [{ file, dimensions[] }]

verdict:
  BLOCK → any critical, or >5 high
  WARN  → has high (≤5)
  PASS  → no critical, no high
```

---

## Step 6.5: CLI supplementary analysis (standard + deep)

Skip for quick level or when no CLI tool is enabled. Do CLI cross-validation on critical/high findings — calibrate severity, identify false positives, discover issues missed in the first pass. See `ref/cli-supplementary.md`. Merge the callback results into `all_findings` (new items prefixed with id `CLI-`), recompute severity_dist.

---

## Step 7: Deep-Dive (conditionally triggered)

Skip for quick level.

| Level | Trigger |
|------|------|
| standard | `severity_dist.critical > 0` |
| deep | always |

```
Targets: deep → critical + high, top 15 | standard → critical only, top 10

Iterate (deep up to 3 rounds, standard 1 round):
  Mandatory, cannot be substituted with manual Read/Grep: dispatch a workflow-reviewer agent per target
    Context: original finding JSON, previous round's analysis (if iteration > 1)
    Tasks: read affected files, find callers/imports, check test coverage
    return JSON: finding_id, root_cause, impact_radius[], remediation{approach, code_example},
              risk_if_unfixed, reassessed_severity, confidence(0.0-1.0)

  Merge: enrich the original finding; confidence >= 0.8 mark complete; update severity by reassessed. Stop early if all resolved.
```

---

## Step 8: Generate issue candidates

Filter by level threshold: quick → critical only | standard → critical + high | deep → critical + high + medium.

Write qualifying findings into `outputs/issue-candidates.json` (schema `issue-candidates/1.0`):

```
Each candidate:
  finding_ref: finding.id
  title: "[{dimension}] {title}" (≤100 chars)
  severity, priority: critical→1, high→2, medium→3
  location: "{file}:{line}"
  description, fix_direction: finding.suggestion
  notes: impact
  tags: ["review", dimension]
```

Candidates only describe problems, no manual writing to the issue registry. Formal issue registration is handled by the downstream consumer.

---

## Step 9: Write spec-conflicts

For each finding that directly contradicts a loaded spec entry (code behavior ≠ spec rule), write into `outputs/spec-conflicts.json` (schema `spec-conflicts/1.0`):

```
Each item:
  finding_ref, spec_id, code_location: "{file}:{line}",
  conflict_type: "outdated" | "disputed",
  suggested_action: "supersede" | "conflict-mark"
```

Code is the single source of truth. Determination and handling details see `ref/spec-conflict.md`.

---

## Step 10: Write review-findings.json

When an old file exists, archive first → `outputs/.history/review-findings-{YYYY-MM-DDTHH-mm-ss}.json`.

```
Write outputs/review-findings.json (schema review-findings/1.0, alias latest-review):
{
  "scope": "{scope}",
  "level": "quick" | "standard" | "deep",
  "verdict": "PASS" | "WARN" | "BLOCK",
  "reviewed_at": now(),
  "reviewer": "workflow-reviewer",
  "dimensions_reviewed": dimensions,
  "files_reviewed": review_files,
  "severity_distribution": { "critical": N, "high": N, "medium": N, "low": N, "total": N },
  "critical_files": critical_files,
  "findings": all_findings,
  "deep_dives": deep_dive_results,
  "issue_candidates": [...]
}
```

---

## report.md

Write `report.md` with standard frontmatter + fixed five sections. frontmatter records scope, level, verdict, severity_distribution, findings_count, issue_candidate_count. Body contains a review results summary and handoff.

```
=== CODE REVIEW RESULTS ===
Scope:    {scope}
Level:    {quick | standard | deep}
Files:    {N} files × {M} dimensions

Severity Distribution:
  Critical: {c}   High: {h}   Medium: {m}   Low: {l}

Top Issues: (up to 10)
  1. [{severity}] {finding_id}: {title} ({file}:{line})

{IF level != quick:
Critical Files (flagged in 3+ dimensions):
  - {file} ({dim1}, {dim2}, {dim3})
}

Verdict: {PASS | WARN | BLOCK}
Issue Candidates: {count}
```

---

## Handoff routing

The verdict decides the downstream run; the report's needs includes `latest-review` (and `latest-verification` where necessary) accordingly:

| verdict | Routing |
|---------|------|
| PASS | `test` (UAT), or proceed directly to session wrap-up |
| WARN | acknowledge warnings then proceed to `test` |
| BLOCK (≤3 findings, all medium/low) | lightweight fix loop: inline fix → re-run review on affected files only → loop until PASS/WARN (up to 2 rounds) |
| BLOCK (>3 findings or has critical) | full fix loop: `plan --gaps` → `execute` → re-run `review` |
| spec conflict found | `maestro spec conflict list` → knowledge audit |

---

## GateRecord

After review completes, inline-record one GateRecord (no separate gates.json):

```json
{ "gate": "review", "verdict": "PASS|WARN|BLOCK", "checked_at": now(),
  "evidence": { "findings": N, "critical": N, "high": N },
  "artifact": "outputs/review-findings.json" }
```

BLOCKED conditions: `review-findings.json` missing, or there are unhandled UNMET spec compliance criteria.

---

## Error Handling

| Error | Action |
|------|------|
| no change manifest | abort: `current-execution` missing or has no completed tasks |
| no changed files (E004) | abort: no changed files detected for this scope |
| reviewer agent failed (W001) | record, continue with available dimension results |
| all agents failed | abort: all dimension agents failed, cannot complete the review |
| deep-dive agent failed | record that finding as unresolved, skip enrichment, mark [LOW CONFIDENCE] |
