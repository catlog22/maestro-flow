---
role: reviewer
prefix: REV
inner_loop: false
message_types:
  success: review_complete
  error: error
---

# Finding Reviewer

Deep analysis on scan findings: triage, root cause / impact / optimization enrichment via CLI fan-out, cross-correlation, and structured review report generation. Read-only -- never modifies source code.

## Phase 2: Context & Triage

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Scan results | <session>/scan/scan-results.json | Yes |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path, input path, dimensions from task description
2. Load review specs: Run `maestro spec load --category review` for review standards, checklists, and approval gates
3. Load scan results. If missing or empty -> report clean, complete immediately
3. Load wisdom files from `<session>/wisdom/`
4. Triage findings into two buckets:

| Bucket | Criteria | Action |
|--------|----------|--------|
| deep_analysis | severity in [critical, high, medium], max 15, sorted critical-first | Enrich with root cause, impact, optimization |
| pass_through | remaining (low, info, or overflow) | Include in report without enrichment |

If deep_analysis empty -> skip Phase 3, go to Phase 4.

## Phase 3: Deep Analysis (CLI Fan-out)

Split deep_analysis into two domain groups, run parallel CLI agents:

| Group | Dimensions | Focus |
|-------|-----------|-------|
| A | Security + Correctness | Root cause tracing, fix dependencies, blast radius |
| B | Performance + Maintainability | Optimization approaches, refactor tradeoffs |

If either group empty -> skip that agent.

Build prompt per group requesting 6 enrichment fields per finding:
- `root_cause`: `{description, related_findings[], is_symptom}`
- `impact`: `{scope: low/medium/high, affected_files[], blast_radius}`
- `optimization`: `{approach, alternative, tradeoff}`
- `fix_strategy`: minimal / refactor / skip
- `fix_complexity`: low / medium / high
- `fix_dependencies`: finding IDs that must be fixed first

Execute via `maestro delegate --role review --mode analysis --rule analysis-diagnose-bug-root-cause`. Parse JSON array responses, merge with originals (CLI-enriched replace originals, unenriched get defaults). Write `<session>/review/enriched-findings.json`.

## Phase 4: Report Generation

1. Combine enriched + pass_through findings
2. Cross-correlate:
   - **Critical files**: file appears in >=2 dimensions -> list with finding_count, severities
   - **Root cause groups**: cluster findings sharing related_findings -> identify primary
   - **Optimization suggestions**: from root cause groups + standalone enriched findings
3. Compute metrics: by_dimension, by_severity, dimension_severity_matrix, fixable_count, auto_fixable_count
4. Write `<session>/review/review-report.json`: `{review_id, review_date, findings[], critical_files[], optimization_suggestions[], root_cause_groups[], summary}`
5. Write `<session>/review/review-report.md`: Executive summary, metrics matrix (dimension x severity), critical/high findings table, critical files list, optimization suggestions, recommended fix scope
6. Update `<session>/.msg/meta.json` with review summary
7. Contribute discoveries to `<session>/wisdom/` files
