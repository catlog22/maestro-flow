

# Pipeline Definitions

UI polish pipeline modes and task registry.

## Pipeline Modes

| Mode | Description | Task Count |
|------|-------------|------------|
| scan-only | Discover + diagnose, report only | 2 tasks |
| targeted | Fix specific dimensions: scan -> diagnose -> optimize -> verify | 4 tasks |
| full | Complete polish cycle with GC loop on verify failure | 4 tasks + GC |

## Scan-Only Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| SCAN-001 | scanner | [] | 8-dimension UI audit against Impeccable design standards |
| DIAG-001 | diagnostician | [SCAN-001] | Root cause analysis, severity classification, fix dependency graph |

## Targeted Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| SCAN-001 | scanner | [] | 8-dimension UI audit (filtered to target dimensions) |
| DIAG-001 | diagnostician | [SCAN-001] | Root cause analysis for targeted dimensions |
| OPT-001 | optimizer | [DIAG-001] | Apply targeted fixes per Impeccable standards |
| VERIFY-001 | verifier | [OPT-001] | Before/after comparison, regression check |

## Full Pipeline Task Registry

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| SCAN-001 | scanner | [] | Full 8-dimension UI audit |
| DIAG-001 | diagnostician | [SCAN-001] | Complete root cause analysis with fix dependency graph |
| OPT-001 | optimizer | [DIAG-001] | Apply all fixes in dependency order |
| VERIFY-001 | verifier | [OPT-001] | Verification with GC loop trigger |

## GC Loop (Full Mode Only)

| Checkpoint | Task | Condition | Action |
|------------|------|-----------|--------|
| VERIFY completes | VERIFY-* | verify_passed (no regressions, score >= before) | Pipeline complete |
| VERIFY completes | VERIFY-* | verify_failed (non-critical regressions) | gc_rounds < 2 -> create OPT-fix task |
| VERIFY completes | VERIFY-* | fix_required (critical regressions or score drop) | gc_rounds < 2 -> create OPT-fix task (CRITICAL) |
| VERIFY completes | VERIFY-* | gc_rounds >= 2 | Escalate to user |

### GC Fix Tasks (dynamically created)

| Task ID | Role | blockedBy | Description |
|---------|------|-----------|-------------|
| OPT-fix-1 | optimizer | [VERIFY-001] | Fix regressions from round 1 verification |
| VERIFY-002 | verifier | [OPT-fix-1] | Re-verify after round 1 fixes |
| OPT-fix-2 | optimizer | [VERIFY-002] | Fix regressions from round 2 verification (if needed) |
| VERIFY-003 | verifier | [OPT-fix-2] | Final re-verify (max round) |

## Collaboration Patterns

| Pattern | Roles | Description |
|---------|-------|-------------|
| CP-1 Linear Pipeline | All | Base sequential flow: scan -> diagnose -> optimize -> verify |
| CP-2 Review-Fix (GC) | optimizer <-> verifier | Generator-Critic loop, max 2 rounds |

## Spawn Rules

| Mode | Behavior |
|------|----------|
| scan-only | Sequential: SCAN-001 then DIAG-001 |
| targeted | Sequential: SCAN -> DIAG -> OPT -> VERIFY |
| full | Sequential: SCAN -> DIAG -> OPT -> VERIFY, then GC loop if verify triggers |

All modes use sequential spawning (one task at a time) since each task depends on the previous.

## Output Artifacts

| Task | Output Path |
|------|-------------|
| SCAN-001 | <session>/scan/scan-report.md |
| DIAG-001 | <session>/diagnosis/diagnosis-report.md |
| OPT-001 / OPT-fix-* | <session>/optimization/fix-log.md + modified source files |
| VERIFY-001 / VERIFY-* | <session>/verification/verify-report.md |
| Screenshots (if DevTools) | <session>/evidence/*.png |
