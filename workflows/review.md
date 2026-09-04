---
name: review
prepare: review
commands: [quality-review]
session-mode: inherited
---

# Workflow: Review

Layered multi-dimensional code review — parallel agents, severity grading, iterative deep-dive. Artifacts unified as `review-findings.json`; findings handed to test or plan.

---

## Step 0: Spec Compliance pre-check

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
  verification_gaps: gaps from latest-verification (if any), otherwise [],
  architecture_template_evidence: inherited from blueprint, brainstorm, grill, or analysis; otherwise normalize plan.shared_context.architecture_template_search + architecture_templates into the envelope
}
```

For the architecture dimension, validate only adopted/adapted template-derived
constraints and their project-specific rationale. Do not search or load
architecture templates. A template alone cannot establish a violation: every
finding requires code evidence and an adopted project constraint. Emit
`architecture_template_checks[]` at the review level and `template_refs[]` on a
finding only when a recorded template-derived decision is relevant.

---

## Step 5: Run review

### Quick — inline scan

Scan each file per dimension, collect findings:

```
correctness: unhandled null/undefined, missing error propagation, type mismatch,
             off-by-one, missing boundary check, unreachable code, logic contradiction
security:    SQL/command injection, hardcoded secrets/passwords, missing input validation, XSS vectors

finding: { id, dimension, severity, title, file, line, snippet,
           description, impact, suggestion, template_refs[] }
```

After scanning, jump directly to Step 6.

### Standard — parallel agent review

**Mandatory, cannot be substituted with manual Read/Grep**: dispatch one workflow-reviewer agent per dimension (all parallel, launched in a single message).

```
Context: dimension, session_goal, review_files, success_criteria,
         tech_stack, specs_content, verification_gaps,
         architecture_template_evidence
Instructions:
  - read each file, analyze only issues of this dimension
  - grade critical / high / medium / low
  - return a JSON array: id, dimension, severity, title, file, line, snippet,
    description, impact, suggestion, spec_violation (if any), template_refs[] (only when applicable)
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

**GATE: dimension-coverage** — all requested dimensions merged into all_findings (no dimension silently dropped).
**GATE: severity-triaged** — every finding graded and severity_dist computed BEFORE verdict.

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

Write qualifying findings into `outputs/issue-candidates.json`:

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

For each finding that directly contradicts a loaded spec entry (code behavior ≠ spec rule), write into `outputs/spec-conflicts.json`:

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
Write outputs/review-findings.json:
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
  "architecture_template_checks": architecture_template_checks,
  "findings": all_findings,
  "deep_dives": deep_dive_results,
  "issue_candidates": [...]
}
```

`architecture_template_checks[]` records `{template_id, disposition, applies_to,
rationale, result}` for inherited adopted/adapted entries; no-match,
load-failed, and not-applicable statuses remain explicit and cannot create
findings by themselves.

---

## Step 10.5: Route BLOCK atomically

PASS and WARN do not modify the chain. For BLOCK, inspect the canonical Session queue:

1. If the immediate next node is a formal decision node, do not emit a proposal. The decision evaluator owns `proceed|fix|escalate`.
2. Otherwise write `outputs/chain-proposal.json` and insert a full repair loop immediately after the current review step.
3. The proposal must use the current Run's `session_id`, `run_id`, Skill name `review`, current `chain_step_id`, and current step `goal_ref`.

Because every operation inserts at the same anchor, write them in reverse order so the resulting chain is `plan → execute → review`:

```json
{
  "_meta": {
    "kind": "chain-proposal",
    "schema": "chain-proposal/1.0",
    "role": "attachment",
    "alias": "chain-proposal"
  },
  "proposal_id": "review-repair-<run-id>",
  "source": {
    "session_id": "<session-id>",
    "run_id": "<run-id>",
    "skill": "review"
  },
  "reason": "BLOCK findings require a planned repair loop before the existing pending tail.",
  "operations": [
    {
      "op": "insert",
      "after": "<current-chain-step-id>",
      "command": "review",
      "stage": "repair-review",
      "goal_ref": "<current-goal-ref>"
    },
    {
      "op": "insert",
      "after": "<current-chain-step-id>",
      "command": "execute",
      "stage": "repair-execute",
      "goal_ref": "<current-goal-ref>"
    },
    {
      "op": "insert",
      "after": "<current-chain-step-id>",
      "command": "plan",
      "args": "--gaps",
      "stage": "repair-plan",
      "goal_ref": "<current-goal-ref>"
    }
  ]
}
```

Omit `goal_ref` only when the current step has no goal binding. Never replace or repurpose an existing pending step to simulate this loop.

Completion disposition:

| BLOCK routing | Completion |
|---|---|
| valid proposal emitted | orchestrator validates the proposal, applies each pending-tail operation through receipt-chained fenced `maestro session chain insert`, then runs `maestro run complete {run_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {complete_request_id} --reason "complete review with repair proposal" --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict done_with_concerns --advance --json` |
| immediate formal decision follows | complete the review Run with the same fully fenced form and `done_with_concerns`, consume the fresh receipt, then submit the gate through the structured `continuation`'s exact fenced `maestro run decide` contract |
| neither is available | run `maestro run transition {run_id} blocked --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {blocked_request_id} --reason "BLOCK has no valid repair route" --expected-run-revision {run_revision} --json`; do not advance the pre-existing tail |

---

## report.md

Write `report.md` with standard frontmatter + fixed five sections. frontmatter records scope, level, verdict, severity_distribution, findings_count, issue_candidate_count. report.md frontmatter `verdict` 使用 report 层 ready 词表：BLOCK→blocked、WARN→ready_with_concerns、PASS→ready；BLOCK/WARN/PASS 仅写进 review-findings 产物与正文。 Body contains a review results summary and handoff.

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
| BLOCK | typed proposal: `plan --gaps` → `execute` → re-run `review`; a following formal decision may own this routing instead |
| spec conflict found | `maestro spec conflict list` → knowledge audit |

---

## Success Criteria

- [ ] Review level determined (quick/standard/deep)
- [ ] All required dimensions produced findings (quick: 2, standard/deep: 6)
- [ ] Every finding anchored to file:line with severity/evidence/impact/recommendation
- [ ] Severity triage completed (severity_dist computed)
- [ ] Spec-conflict routing applied (supersede for evolved practice, conflict mark for disputes)
- [ ] Delta comparison with prior-review (if exists)
- [ ] review-findings.json written with PASS/WARN/BLOCK verdict
- [ ] Architecture-template checks validate adopted/adapted constraints without new search/load or template-only findings
- [ ] issue-candidates.json written (if findings warrant)
- [ ] BLOCK produced a validated repair-loop proposal, or the immediate formal decision owns routing

---

## GateRecord

After review completes, inline-record one entry per declared gate (no separate gate artifact):

```json
{ "gate": "dimension-coverage", "verdict": "PASS|WARN|BLOCK", "checked_at": now(),
  "evidence": { "dimensions_covered": N, "findings": N },
  "artifact": "outputs/review-findings.json" }
{ "gate": "severity-triaged", "verdict": "PASS|WARN|BLOCK", "checked_at": now(),
  "evidence": { "critical": N, "high": N, "triaged": N },
  "artifact": "outputs/review-findings.json" }
{ "gate": "repair-routing", "verdict": "PASS|BLOCK", "checked_at": now(),
  "evidence": { "review_verdict": "PASS|WARN|BLOCK", "route": "none|decision|chain-proposal" },
  "artifact": "outputs/chain-proposal.json|null" }
```

BLOCKED conditions: `review-findings.json` missing, there are unhandled UNMET spec compliance criteria, or verdict BLOCK has neither an immediate formal decision nor a valid repair-loop proposal.

---

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No change manifest (`current-execution` missing or has no completed tasks) | Abort; run `execute` first |
| E002 | No changed files detected for this scope | Abort; verify scope has pending changes |
| E003 | All dimension agents failed | Abort; cannot complete the review, retry |
| W001 | Reviewer agent failed (one dimension) | Record, continue with available dimension results |
| W002 | Deep-dive agent failed | Record finding as unresolved, skip enrichment, mark [LOW CONFIDENCE] |

## Knowledge Hooks

- Confirmed findings and contradictions: `maestro knowledge record <knowledge-ids...> --signal validated|contradicted --source manual` against the entries you verified.
- Stage review-derived rules with `maestro knowledge stage spec "<title>" --content-file <path|-> --run <run-id>` when they generalize.
