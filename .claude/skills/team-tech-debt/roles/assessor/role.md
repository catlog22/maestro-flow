---
role: assessor
prefix: TDEVAL
inner_loop: false
message_types: [state_update]
---

# Tech Debt Assessor

Quantitative evaluator for tech debt items. Score each debt item on business impact (1-5) and fix cost (1-5), classify into priority quadrants, produce priority-matrix.json.

## Phase 2: Load Debt Inventory

| Input | Source | Required |
|-------|--------|----------|
| Session path | task description (regex: `session:\s*(.+)`) | Yes |
| .msg/meta.json | <session>/.msg/meta.json | Yes |
| Debt inventory | meta.json:debt_inventory OR <session>/scan/debt-inventory.json | Yes |

1. Extract session path from task description
2. Read .msg/meta.json for team context
3. Load debt_inventory from shared memory or fallback to debt-inventory.json file
4. If debt_inventory is empty -> report empty assessment and exit

## Phase 3: Evaluate Each Item

**Strategy selection**:

| Item Count | Strategy |
|------------|----------|
| <= 10 | Heuristic: severity-based impact + effort-based cost |
| 11-50 | CLI batch: single gemini analysis call |
| > 50 | CLI chunked: batches of 25 items |

**Impact Score Mapping** (heuristic):

| Severity | Impact Score |
|----------|-------------|
| critical | 5 |
| high | 4 |
| medium | 3 |
| low | 1 |

**Cost Score Mapping** (heuristic):

| Estimated Effort | Cost Score |
|------------------|------------|
| small | 1 |
| medium | 3 |
| large | 5 |
| unknown | 3 |

**Priority Quadrant Classification**:

| Impact | Cost | Quadrant |
|--------|------|----------|
| >= 4 | <= 2 | quick-win |
| >= 4 | >= 3 | strategic |
| <= 3 | <= 2 | backlog |
| <= 3 | >= 3 | defer |

For CLI mode, prompt gemini with full debt summary requesting JSON array of `{id, impact_score, cost_score, risk_if_unfixed, priority_quadrant}`. Unevaluated items fall back to heuristic scoring.

## Phase 4: Generate Priority Matrix

1. Build matrix structure: evaluation_date, total_items, by_quadrant (grouped), summary (counts per quadrant)
2. Sort within each quadrant by impact_score descending
3. Write `<session>/assessment/priority-matrix.json`
4. Update .msg/meta.json with `priority_matrix` summary and evaluated `debt_inventory`
