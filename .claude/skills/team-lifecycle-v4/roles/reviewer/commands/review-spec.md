# Spec Quality Review

5-dimension spec quality gate with discuss protocol.

## Inputs

- All spec docs in <session>/spec/
- Quality gate config from specs/quality-gates.md

## Dimensions

| Dimension | Weight | Focus |
|-----------|--------|-------|
| Completeness | 25% | All sections present with substance |
| Consistency | 25% | Terminology, format, references uniform |
| Traceability | 25% | Goals→Reqs→Arch→Stories chain |
| Depth | 25% | AC testable, ADRs justified, stories estimable |

## Review Process

1. Read all spec documents from <session>/spec/
2. Load quality gate thresholds from specs/quality-gates.md
3. Score each dimension
4. Run cross-document validation
5. Generate readiness-report.md + spec-summary.md
6. Run DISCUSS-003:
   - Artifact: <session>/spec/readiness-report.md
   - Perspectives: product, technical, quality, risk, coverage
   - Handle verdict per consensus protocol
   - DISCUSS-003 HIGH always triggers user pause

## Quality Gate

| Gate | Score |
|------|-------|
| PASS | >= 80% |
| REVIEW | 60-79% |
| FAIL | < 60% |

## Output

Write to <session>/artifacts/:
- readiness-report.md: Dimension scores, issue list, traceability matrix
- spec-summary.md: Executive summary of all spec docs
