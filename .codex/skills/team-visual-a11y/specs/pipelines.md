

# Pipeline Definitions

Visual accessibility pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Count |
|------|-------------|------------|
| audit-only | 3 parallel auditors -> remediation plan | 4 tasks |
| full | 3 parallel auditors -> remediation -> fix -> 2 parallel re-auditors | 7 tasks |

## Audit-Only Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| COLOR-001 | color-auditor | [] | OKLCH color contrast audit: WCAG 2.1 + APCA ratios, color blindness simulation |
| TYPO-001 | typo-auditor | [] | Typography readability: font size at breakpoints, line-height, reading width |
| FOCUS-001 | focus-auditor | [] | Focus management: tab order, indicators, skip link, ARIA, keyboard |
| REMED-001 | remediation-planner | [COLOR-001, TYPO-001, FOCUS-001] | Prioritized remediation plan with code-level fixes |

**CRITICAL**: COLOR-001, TYPO-001, FOCUS-001 have NO blockedBy -- they run in PARALLEL.

## Full Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| COLOR-001 | color-auditor | [] | OKLCH color contrast audit (initial) |
| TYPO-001 | typo-auditor | [] | Typography readability audit |
| FOCUS-001 | focus-auditor | [] | Focus management audit (initial) |
| REMED-001 | remediation-planner | [COLOR-001, TYPO-001, FOCUS-001] | Prioritized remediation plan |
| FIX-001 | fix-implementer | [REMED-001] | Implement a11y fixes from remediation plan |
| COLOR-002 | color-auditor | [FIX-001] | Re-audit color contrast after fixes |
| FOCUS-002 | focus-auditor | [FIX-001] | Re-audit focus management after fixes |

**CRITICAL**: COLOR-002 and FOCUS-002 both blocked only by FIX-001 -- they run in PARALLEL.

## Dependency Graphs

### Audit-Only

```
COLOR-001 --+
            |
TYPO-001  --+--> REMED-001
            |
FOCUS-001 --+
```

### Full

```
COLOR-001 --+
            |
TYPO-001  --+--> REMED-001 --> FIX-001 --+--> COLOR-002
            |                             |
FOCUS-001 --+                             +--> FOCUS-002
```

## Fan-In Points

| Point | Waiting For | Gate Task | Action |
|-------|------------|-----------|--------|
| Audit fan-in | COLOR-001 + TYPO-001 + FOCUS-001 (all 3) | REMED-001 | Unblock REMED-001 when all 3 complete |
| Re-audit fan-in | COLOR-002 + FOCUS-002 (both) | Pipeline complete | Check GC convergence |

## GC Loop Behavior (Full Mode)

After re-audit fan-in (COLOR-002 + FOCUS-002 both complete):

| Signal | Condition | Action |
|--------|-----------|--------|
| All pass | 0 critical + 0 high issues remaining | GC converged -> pipeline complete |
| Issues remain | Critical or high issues found | gc_rounds < 2 -> create FIX-002 + re-audit tasks |
| Max rounds | gc_rounds >= 2 | Escalate to user: accept / try one more / terminate |

## Parallel Spawn Rules

| Mode | Scenario | Spawn Behavior |
|------|----------|---------------|
| audit-only | Initial | Spawn COLOR-001 + TYPO-001 + FOCUS-001 in parallel |
| audit-only | After 3 audits | Spawn REMED-001 |
| full | Initial | Spawn COLOR-001 + TYPO-001 + FOCUS-001 in parallel |
| full | After 3 audits | Spawn REMED-001 |
| full | After REMED-001 | Spawn FIX-001 |
| full | After FIX-001 | Spawn COLOR-002 + FOCUS-002 in parallel |
| full (GC) | After re-audit fan-in | If issues: spawn FIX-002, then new re-audits |

## Output Artifacts

| Task | Output Path |
|------|-------------|
| COLOR-001 | {run_dir}/outputs/audits/color/color-audit-001.md |
| TYPO-001 | {run_dir}/outputs/audits/typography/typo-audit-001.md |
| FOCUS-001 | {run_dir}/outputs/audits/focus/focus-audit-001.md |
| REMED-001 | {run_dir}/outputs/remediation/remediation-plan.md |
| FIX-001 | Modified source files + {run_dir}/outputs/fixes/fix-summary-001.md |
| COLOR-002 | {run_dir}/outputs/re-audit/color-audit-002.md |
| FOCUS-002 | {run_dir}/outputs/re-audit/focus-audit-002.md |
