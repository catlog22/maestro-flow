# Verify Workflow

Dual verification: Goal-Backward structural verification + Nyquist test coverage validation.

---

## Prerequisites

- Phase execution completed (or partially completed)
- `.task/TASK-*.json` files exist with execution results
- `.summaries/TASK-*-summary.md` files exist

---

## Scope Resolution

```
Input: [phase] argument OR --dir <path>

Worktree scope check: if .workflow/worktree-scope.json exists, reject phases not in scope.owned_phases.

Resolve PLAN_DIRS and VERIFY_MODE by input type:
  --dir <path>    → single mode, PLAN_DIRS=[path], output into plan dir
  no arguments    → milestone mode, collect completed execute artifacts for current milestone from state.json
  numeric arg     → phase mode, collect completed execute artifacts for that phase from state.json

If no matching artifacts found: ERROR E001.
Milestone mode creates output dir: .workflow/scratch/verify-{milestone_slug}-{date}/
```

---

## Flag Processing

| Flag | Effect |
|------|--------|
| `--skip-tests` | Skip V2 (Nyquist test coverage), only run Goal-Backward verification |
| `--skip-antipattern` | Skip anti-pattern scan step |

---

## V0: Load Project Specs

```
specs_content = maestro spec load --category validation
```

Pass specs_content to verifier agent as quality standards context.

---

## V0.5: Tech Stack Constraint Validation

**Purpose:** Validate that modified files comply with project tech stack constraints before running expensive goal-backward verification.

**Skip if** specs_content contains no tech stack or constraint definitions.

### Step 1: Extract Constraints from Specs

```
Extract from specs_content into constraints object:
  allowed_libs[]        ← "tech_stack" / "technology" sections
  disallowed_imports[]  ← "constraints" / "disallowed" / "forbidden" sections
  required_patterns[]   ← "required_patterns" / "conventions" sections

If no allowed_libs and no disallowed_imports found: skip to V1.
```

### Step 2: Collect Modified Files

```
Collect modified_files from task summaries ("Files Modified" sections).
Fallback: git diff --name-only HEAD~{tasks_completed} -- "*.ts" "*.tsx" "*.js" "*.jsx" "*.py" "*.java" "*.go"
Deduplicate, exclude node_modules and test/spec files.
```

### Step 3: Scan Imports Against Constraints

```
For each modified file, extract import statements (language-aware: TS/JS, Python, Go, Java).

Check each import against constraints:
  disallowed_imports match → violation {id: "CV-{NNN}", type: "disallowed_import", severity: "high", file, line, import, constraint, fix_direction}
  allowed_libs allowlist defined + external package not listed → violation {id: "CV-{NNN}", type: "unlisted_dependency", severity: "medium", file, line, import, constraint, fix_direction}
```

### Step 4: Check Required Patterns

```
For each required_pattern, scan matching files (by file_glob) for pattern.regex.
Missing match → violation {id: "CV-{NNN}", type: "missing_required_pattern", severity: pattern.severity || "medium", file, constraint, fix_direction}
```

### Step 5: Report

```
Report constraint_violations count and details: [{severity}] {file}:{line} - {constraint}
If none: "V0.5: All modified files comply with tech stack constraints"
```

The `constraint_violations[]` array is included in the final `verification.json` output in V3 aggregation.

---

## V1: Goal-Backward Verification

**Purpose:** Verify execution results match phase goals through 3-layer structural checking.

### Step 1: Load Artifacts

Read from phase directory:
- index.json -- success_criteria (the ground truth for verification)
- plan.json -- original plan with task_ids and approach
- All `.task/TASK-{NNN}.json` files -- task definitions with convergence.criteria
- All `.summaries/TASK-{NNN}-summary.md` files -- execution results and outputs
- `uat.md` (if exists) -- human UAT gaps to incorporate into verification

Build a verification context object mapping:
- success_criteria -> what must be verified
- tasks + summaries -> evidence of completion

**Load UAT human findings** (if available):
```
If ${PHASE_DIR}/uat.md exists, parse "Gaps" section into uat_gaps[]:
  {id: "GAP-UAT-{NNN}", type: "human_verified_failure", severity, description, fix_direction}
```
These `uat_gaps` are merged into the final `gaps[]` in V3 aggregation.

### Step 2: Establish Must-Haves

Priority order:
1. **success_criteria from index.json** -- primary contract, each criterion is a testable truth
2. **convergence.criteria from task JSON** -- per-task completion criteria
3. **Derived from phase goal** -- fallback: derive 3-7 observable behaviors from roadmap phase goal

For each must-have, decompose into 3 layers:
- **Truths**: observable behaviors (e.g., "User can see existing messages")
- **Artifacts**: concrete file paths that must exist and be substantive (e.g., `src/components/Chat.tsx`)
- **Key Links**: critical wiring between artifacts (e.g., "Chat.tsx imports and calls /api/chat GET")

### Step 3: Verify Observable Truths (Layer 1)

For each truth, determine if the codebase enables it:

| Status | Meaning |
|--------|---------|
| VERIFIED | All supporting artifacts pass, wiring intact |
| FAILED | Artifact missing, stub, or unwired |
| UNCERTAIN | Needs human verification (visual, real-time, external service) |

For each truth: identify supporting artifacts -> check artifact existence and substance -> check wiring -> determine truth status.

### Step 4: Verify Artifacts (Layer 2)

For each artifact identified in must-haves, check at 3 levels:

| Level | Check | Status |
|-------|-------|--------|
| L1: Exists | File exists on disk | MISSING if not |
| L2: Substantive | File has real implementation (not stub/placeholder) | STUB if too small or has placeholder markers |
| L3: Wired | File is imported AND used by other modules | ORPHANED if exists but unused |

**Substance check**: Files under ~10 lines of real logic, or containing "placeholder", "coming soon", "TODO: implement" are flagged as STUB.

**Wiring check**:
```bash
# Check if artifact is imported
grep -r "import.*{artifact_name}" src/ --include="*.ts" --include="*.tsx" --include="*.py"
# Check if artifact is used (beyond import)
grep -r "{artifact_name}" src/ --include="*.ts" --include="*.tsx" --include="*.py" | grep -v "import"
```

| Exists | Substantive | Wired | Status |
|--------|-------------|-------|--------|
| yes | yes | yes | VERIFIED |
| yes | yes | no | ORPHANED |
| yes | no | - | STUB |
| no | - | - | MISSING |

### Step 5: Verify Key Links (Layer 3)

For each key link (component A -> component B via mechanism):

| Pattern | Check | Status |
|---------|-------|--------|
| Component -> API | fetch/axios call to API path, response used | WIRED / PARTIAL / NOT_WIRED |
| API -> Database | DB query on model, result returned | WIRED / PARTIAL / NOT_WIRED |
| Form -> Handler | onSubmit with real implementation (not console.log) | WIRED / STUB / NOT_WIRED |
| State -> Render | State variable appears in JSX/template | WIRED / NOT_WIRED |
| Event -> Handler | Event listener with real handler logic | WIRED / STUB / NOT_WIRED |

Record status and evidence (file:line references) for each key link.

### Build must_haves

```
must_haves = {
  truths: [
    { claim: "success_criterion text", status: "verified" | "failed", evidence: "..." }
  ],
  artifacts: [
    { path: "file/path", status: "exists" | "missing", substantive: true | false }
  ],
  key_links: [
    { from: "ComponentA -> ServiceB -> ModelC", status: "wired" | "broken" }
  ]
}
```

### Identify gaps

```
Collect gaps from failed truths, missing/stub artifacts, and broken links.
Each gap: {id: "GAP-{NNN}", type: "missing_feature"|"incomplete_implementation"|"broken_integration",
           severity: "critical"|"high"|"medium"|"low", description, fix_direction}
```

### Auto-create Issues from Gaps

```
For each gap, create an issue in .workflow/issues/issues.jsonl:
  id: "ISS-{YYYYMMDD}-{NNN}" (auto-incrementing from existing today's IDs)
  Fields: title (gap.description truncated 100 chars), status: "registered",
    priority: severity_to_priority(gap.severity), severity, source: "verification",
    phase_ref: PHASE_NUM, gap_ref: gap.id, description, fix_direction,
    context: {location, suggested_fix, notes}, tags[], affected_components[],
    feedback[], issue_history[], created_at, updated_at, resolved_at: null, resolution: null
  Back-reference: gap.issue_id = issue_id
```

### Write verification.json

```
Write ${PHASE_DIR}/verification.json:
{
  "phase": PHASE_NUM,
  "status": gaps.length > 0 ? "gaps_found" : "passed",
  "verified_at": now(),
  "verifier": "workflow-verifier",
  "must_haves": must_haves,
  "gaps": gaps
}
```

---

## Anti-Pattern Scan

**Skip if `--skip-antipattern` flag is set.**

Extract files modified in this phase from task summaries. For each file:

| Pattern | Search | Severity |
|---------|--------|----------|
| TODO/FIXME/XXX/HACK | `grep -n "TODO\|FIXME\|XXX\|HACK"` | Warning |
| Placeholder content | `grep -n -i "placeholder\|coming soon\|will be here"` | Blocker |
| Empty returns | `grep -n "return null\|return {}\|return \[\]\|=> {}"` | Warning |
| Log-only functions | Functions containing only console.log/print | Warning |
| Hardcoded test data | `grep -n "hardcoded\|dummy\|fake\|mock"` | Warning |
| Disabled tests | `grep -n "skip\|xit\|xdescribe\|@disabled"` | Warning |

Categorize: Blocker (prevents goal) | Warning (incomplete) | Info (notable).

Write anti-patterns into verification.json `antipatterns[]` array.

### Auto-create Issues from Blocker Anti-Patterns

```
For each Blocker anti-pattern, create an issue in .workflow/issues/issues.jsonl:
  id: "ISS-{YYYYMMDD}-{NNN}" (auto-incrementing from existing today's IDs)
  Fields: title: "Anti-pattern: {pattern_name}", status: "registered",
    priority: 1, severity: "critical", source: "antipattern",
    phase_ref: PHASE_NUM, description, fix_direction,
    context: {location: pattern.file_line}, tags: ["antipattern"]
  Back-reference: pattern.issue_id = issue_id
```

---

## V2: Nyquist Test Coverage (skip if `--skip-tests`)

**Purpose:** Ensure test coverage meets requirements through the Nyquist sampling principle.

### Step 1: Detect Test Infrastructure

```bash
find . -name "jest.config.*" -o -name "vitest.config.*" -o -name "pytest.ini" -o -name "pyproject.toml" 2>/dev/null | head -10
find . \( -name "*.test.*" -o -name "*.spec.*" -o -name "test_*" \) -not -path "*/node_modules/*" 2>/dev/null | head -40
```

### Step 2: Build Requirement-to-Test Map

For each success criterion / must-have truth:
- Search for test files covering the behavior
- Match by filename, imports, test descriptions

### Step 3: Gap Classification

| Status | Criteria |
|--------|----------|
| COVERED | Test exists, targets behavior, runs green |
| PARTIAL | Test exists but failing or incomplete |
| MISSING | No test found for this requirement |

### Step 4: Spawn Auditor Agent (if gaps found)

Spawn workflow-nyquist-auditor agent with gap list, test infrastructure, and phase context.
Agent generates missing tests and returns:
- GAPS FILLED -> record new tests
- PARTIAL -> record resolved, escalate remainder
- ESCALATE -> move to manual-only

### Step 5: Generate validation.json

```
Write ${PHASE_DIR}/validation.json:
{
  "phase": PHASE_NUM,
  "status": uncovered.length > 0 ? "gaps_found" : "passed",
  "validated_at": now(),
  "test_framework": test_framework,
  "coverage": { statements, branches, functions, lines },
  "requirement_coverage": [
    { "requirement": "REQ-001", "tests": ["auth.spec.ts"], "status": "covered" },
    { "requirement": "REQ-002", "tests": [], "status": "uncovered" }
  ],
  "gaps": [
    {
      "requirement": "REQ-002",
      "description": "No tests for login endpoint",
      "suggested_test": "auth.login.spec.ts"
    }
  ]
}
```

If coverage below threshold, log warning (W001).

---

## Fix Plan Generation

If gaps exist from any verification layer:

1. **Cluster related gaps**: API stub + component unwired -> "Wire frontend to backend". Multiple missing -> "Complete core implementation". Wiring only -> "Connect existing components".

2. **Generate plan per cluster**: Objective, 2-3 tasks (files/action/verify each), re-verify step. Keep focused: single concern per plan.

3. **Order by dependency**: Fix missing -> fix stubs -> fix wiring -> verify.

Enrich each fix_plan with issue_ids[] collected from its related_gaps' issue references.

Write fix plans into verification.json `fix_plans[]` array.

---

## V3: Aggregate Results and Report

### Aggregate All Verification Results

Combine goal-backward, constraint validation, anti-pattern scan, and Nyquist results:

**Overall status determination:**
- **passed**: All truths VERIFIED, all artifacts pass L1-L3, all key links WIRED, no blocker anti-patterns, no high/critical constraint violations
- **gaps_found**: Any truth FAILED, artifact MISSING/STUB, key link NOT_WIRED, blocker found, or high/critical constraint violation detected
- **human_needed**: All automated checks pass but human verification items remain

**Score**: `verified_truths / total_truths`

**Archive previous verification artifacts** before writing:
```
If any of ["verification.json", "validation.json"] exist in ${PHASE_DIR}:
  Move each to ${PHASE_DIR}/.history/{name}-{YYYY-MM-DDTHH-mm-ss}.{ext}
```

Write verification.json:
- `must_haves[]` -- list of criteria with pass/fail status, evidence, and layer results
- `gaps[]` -- unmet criteria with severity, layer, and suggested remediation (includes uat_gaps from Step 1 if available)
- `constraint_violations[]` -- tech stack violations with severity, file:line, and fix direction (from V0.5)
- `antipatterns[]` -- detected anti-patterns with severity and file:line
- `fix_plans[]` -- clustered fix plans for gap closure
- `human_verification[]` -- items needing manual testing
- `coverage_score` -- percentage of criteria met

### Update index.json

```
Set index.json.status = "verifying", updated_at = now()
Set index.json.verification = {status, verified_at, must_haves summary, gaps} from verification.json
If validation.json exists: set index.json.validation = {status, test_coverage, gaps} from validation.json
```

### Report Format

```
=== VERIFICATION RESULTS ===
Phase:         {phase_name}

Goal-Backward: {verified_count}/{total_truths} truths verified
  Artifacts:   {artifact_verified}/{artifact_total} (L1-L3)
  Wiring:      {links_wired}/{links_total} key links
Constraints:   {constraint_violation_count} violations ({high_count} high, {medium_count} medium)
Anti-patterns: {blocker_count} blockers, {warning_count} warnings
Nyquist:       {coverage_pct}% coverage ({skip_tests ? "SKIPPED" : status})

Gaps: {gap_count}
  Critical: {critical_count}
  Important: {important_count}
  Minor: {minor_count}

Fix Plans: {fix_plan_count} generated
Human Verification: {human_items} items

Files:
  {artifact_dir}/verification.json
  {artifact_dir}/validation.json (if generated)

Next steps:
  {suggested_next_command}
```

### Next Step Routing

| Result | Suggestion |
|--------|------------|
| All passed, no gaps | Skill({ skill: "quality-review", args: "{phase}" }) for code review, then Skill({ skill: "quality-test" }) for UAT |
| Critical gaps found | Skill({ skill: "quality-debug" }) for investigation |
| Minor gaps only | Skill({ skill: "maestro-plan", args: "--gaps" }) -> Skill({ skill: "maestro-execute" }) -> re-run Skill({ skill: "maestro-verify" }) |
| Low test coverage | Skill({ skill: "quality-test-gen", args: "{phase}" }) to generate missing tests |
| Human verification needed | Skill({ skill: "quality-test", args: "{phase}" }) for interactive UAT |

**Gap-fix loop**: `verify -> plan --gaps -> execute -> verify` repeats until all gaps are closed or user accepts remaining gaps.

---

## Error Handling

| Error | Action |
|-------|--------|
| Phase directory not found | Abort: "Phase {phase} not found." |
| No execution results | Abort: "No completed tasks found. Run /workflow:execute first." |
| No summaries found | Warn, proceed with task file analysis only |
| Test framework not detected | Skip coverage calculation, warn user |
| Coverage command fails | Log error, proceed with requirement mapping only |
| Verifier agent fails | Retry once, then write partial verification.json |

---

## State Updates

| When | Field | Value |
|------|-------|-------|
| V1 start | index.json.status | "verifying" |
| V1 complete | index.json.verification | Verification results |
| V2 complete | index.json.validation | Validation results |
| V3 complete | index.json.updated_at | Current timestamp |
