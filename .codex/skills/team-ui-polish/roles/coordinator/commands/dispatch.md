
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From analyze output | Yes |
| Target | From analyze output (url/component/full_site) | Yes |
| Dimension filters | From analyze output (targeted mode only) | No |

1. Load user requirement and polish scope from session context
2. Load pipeline stage definitions from specs/pipelines.md
3. Read `pipeline_mode`, `target`, and `dimension_filters` from session context

## Phase 3: Task Chain Creation (Mode-Branched)

### Task Description Template

Every task description uses structured format:

```
update_plan({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: <session-folder>
  - Target: <url|component-path|full_site>
  - Dimension filters: <all | specific dimensions>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `scan-only` | Create 2 tasks: SCAN -> DIAG |
| `targeted` | Create 4 tasks: SCAN -> DIAG -> OPT -> VERIFY |
| `full` | Create 4 tasks: SCAN -> DIAG -> OPT -> VERIFY (with GC loop enabled) |

---

### Scan-Only Pipeline Task Chain

**SCAN-001** (scanner):
```
update_plan({
  subject: "SCAN-001",
  description: "PURPOSE: Scan UI against Impeccable's 8 audit dimensions to discover all design problems | Success: Complete scan report with per-dimension scores and issue inventory
TASK:
  - Load target files or take screenshots via Chrome DevTools
  - Extract color values, font definitions, spacing values, animation declarations
  - Score all 8 dimensions: anti-patterns, color, typography, spacing, motion, interaction, hierarchy, responsive
  - Generate issue inventory with file:line locations and severity
CONTEXT:
  - Session: <session-folder>
  - Target: <target>
  - Dimension filters: all
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/scan/scan-report.md | 8-dimension scored report with issue inventory
CONSTRAINTS: Read-only analysis | Reference specs/anti-patterns.md and specs/design-standards.md"
})
update_plan({ taskId: "SCAN-001", owner: "scanner" })
```

**DIAG-001** (diagnostician):
```
update_plan({
  subject: "DIAG-001",
  description: "PURPOSE: Deep-dive root cause analysis of scan findings, classify severity, group systemic vs one-off | Success: Prioritized diagnosis with fix dependency graph
TASK:
  - Read scan report and classify each issue as systemic or one-off
  - Group issues by root cause
  - Build fix dependency graph (which fixes must come first)
  - Prioritize by severity (P0 -> P1 -> P2 -> P3)
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: scan/scan-report.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/diagnosis/diagnosis-report.md | Root cause groups with fix strategies and dependency graph
CONSTRAINTS: Read-only analysis | Reference specs/fix-strategies.md"
})
update_plan({ taskId: "DIAG-001", addBlockedBy: ["SCAN-001"], owner: "diagnostician" })
```

---

### Targeted Pipeline Task Chain

Same as scan-only SCAN-001 and DIAG-001, plus:

**Note**: For targeted mode, SCAN-001 description adds dimension filter:
```
  - Dimension filters: <specific dimensions from analyze output>
```

**OPT-001** (optimizer):
```
update_plan({
  subject: "OPT-001",
  description: "PURPOSE: Apply targeted fixes for specified dimensions following Impeccable design standards | Success: All P0/P1 issues in targeted dimensions resolved
TASK:
  - Read diagnosis report for prioritized fix plan
  - Apply fixes in dependency order (systemic first, then one-off)
  - Follow Impeccable fix strategies per dimension
  - Self-validate: no regressions, code compiles/lints
CONTEXT:
  - Session: <session-folder>
  - Dimension filters: <targeted dimensions>
  - Upstream artifacts: scan/scan-report.md, diagnosis/diagnosis-report.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: Modified source files + <session>/optimization/fix-log.md | Each fix documented with before/after
CONSTRAINTS: Only fix targeted dimensions | Reference specs/fix-strategies.md and specs/design-standards.md"
})
update_plan({ taskId: "OPT-001", addBlockedBy: ["DIAG-001"], owner: "optimizer" })
```

**VERIFY-001** (verifier):
```
update_plan({
  subject: "VERIFY-001",
  description: "PURPOSE: Verify fixes improved scores without introducing regressions | Success: Score improved or maintained in all dimensions, zero regressions
TASK:
  - Re-scan fixed code against same 8 dimensions
  - Calculate before/after score delta per dimension
  - Check for regressions (new issues introduced by fixes)
  - Take after screenshots if Chrome DevTools available
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: scan/scan-report.md, optimization/fix-log.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/verification/verify-report.md | Before/after comparison with regression check
CONSTRAINTS: Read-only verification | Signal fix_required if regressions found"
})
update_plan({ taskId: "VERIFY-001", addBlockedBy: ["OPT-001"], owner: "verifier" })
```

---

### Full Pipeline Task Chain

Same as targeted pipeline. The difference is in GC loop behavior:
- When VERIFY-001 reports `fix_required`, coordinator creates OPT-fix task (see monitor.md)
- Full mode enables GC loop; targeted mode does not create GC fix tasks

---

### GC Fix Task Template (created by monitor.md when verify fails)

```
update_plan({
  subject: "OPT-fix-<round>",
  description: "PURPOSE: Address verification regressions from round <round> | Success: All regressions resolved, no new issues
TASK:
  - Parse verification feedback for specific regressions
  - Apply targeted fixes for regression issues only
  - Self-validate before reporting
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: verification/verify-report.md, optimization/fix-log.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: Updated source files + appended <session>/optimization/fix-log.md
CONSTRAINTS: Fix regressions only, do not expand scope"
})
update_plan({ taskId: "OPT-fix-<round>", owner: "optimizer" })
```

Then create new VERIFY task blocked by OPT-fix.

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | list_agents count | scan-only: 2, targeted: 4, full: 4 |
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| Task IDs use correct prefixes | Pattern check | SCAN/DIAG/OPT/VERIFY |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |

If validation fails, fix the specific task and re-validate.
