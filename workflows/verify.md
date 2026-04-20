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

# Worktree scope check
IF file_exists(".workflow/worktree-scope.json"):
  scope = read(".workflow/worktree-scope.json")
  IF <phase> is a number AND <phase> NOT IN scope.owned_phases:
    ERROR "Phase {phase} not owned by this worktree. Owned: {scope.owned_phases}"
    EXIT

IF --dir <path> is provided:
  // Single plan verification
  PLAN_DIRS = [<path>]
  VERIFY_MODE = "single"
  VERIFY_OUTPUT_DIR = <path>  // verification.json written into plan dir

ELSE IF no arguments:
  // Milestone-level verification
  Read state.json.artifacts
  PLAN_DIRS = artifacts.filter(a =>
    a.milestone == current_milestone &&
    a.type == "execute" &&
    a.status == "completed"
  ).map(a => a.path)
  IF PLAN_DIRS is empty: ERROR E001
  VERIFY_MODE = "milestone"
  milestone_slug = slugify(current_milestone name)
  VERIFY_OUTPUT_DIR = .workflow/scratch/verify-{milestone_slug}-{date}/
  mkdir -p VERIFY_OUTPUT_DIR

ELSE IF argument is a number:
  // Phase-level verification
  Read state.json.artifacts
  PLAN_DIRS = artifacts.filter(a =>
    a.milestone == current_milestone &&
    a.type == "execute" &&
    a.phase == arg &&
    a.status == "completed"
  ).map(a => a.path)
  IF PLAN_DIRS is empty: ERROR E001
  VERIFY_MODE = "phase"
  VERIFY_OUTPUT_DIR = first plan dir  // single plan → write there
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
constraints = {
  allowed_libs: [],
  disallowed_imports: [],
  required_patterns: []
}

Parse specs_content for constraint definitions:
  - "tech_stack" / "technology" sections -> extract allowed libraries/frameworks
  - "constraints" / "disallowed" / "forbidden" sections -> extract disallowed imports
  - "required_patterns" / "conventions" sections -> extract required patterns

IF constraints.allowed_libs is empty AND constraints.disallowed_imports is empty:
  Print: "V0.5: No tech stack constraints found in specs, skipping."
  constraint_violations = []
  SKIP to V1
```

### Step 2: Collect Modified Files

```
modified_files = []

# Method 1: Extract from task summaries
FOR each summary IN ${PHASE_DIR}/.summaries/TASK-*-summary.md:
  Parse "Files Modified" section
  Extract file paths -> add to modified_files[]

# Method 2: Fallback to git diff if no summaries or empty list
IF modified_files is empty:
  modified_files = git diff --name-only HEAD~{tasks_completed} -- "*.ts" "*.tsx" "*.js" "*.jsx" "*.py" "*.java" "*.go"

# Deduplicate and filter to source files only
modified_files = unique(modified_files).filter(f => !f.includes("node_modules") && !f.includes(".test.") && !f.includes(".spec."))
```

### Step 3: Scan Imports Against Constraints

```
constraint_violations = []

FOR each file IN modified_files:
  IF file does not exist: SKIP

  # Extract import statements based on file type
  IF file ends with .ts/.tsx/.js/.jsx:
    imports = grep -n "^import .* from ['\"]" {file}
    imports += grep -n "require(['\"]" {file}
  ELSE IF file ends with .py:
    imports = grep -n "^import \|^from .* import" {file}
  ELSE IF file ends with .go:
    imports = grep -n "\".*\"" {file}  # inside import block
  ELSE IF file ends with .java:
    imports = grep -n "^import " {file}

  FOR each import_line IN imports:
    # Check against disallowed imports
    FOR each disallowed IN constraints.disallowed_imports:
      IF import_line contains disallowed:
        constraint_violations.push({
          id: "CV-{NNN}",
          type: "disallowed_import",
          severity: "high",
          file: file,
          line: import_line.line_number,
          import: import_line.text,
          constraint: "Disallowed: " + disallowed,
          fix_direction: "Replace " + disallowed + " with an allowed alternative"
        })

    # Check against allowed_libs (if allowlist is defined)
    IF constraints.allowed_libs is not empty:
      package_name = extract package/module name from import_line
      IF package_name is external AND package_name NOT IN constraints.allowed_libs:
        constraint_violations.push({
          id: "CV-{NNN}",
          type: "unlisted_dependency",
          severity: "medium",
          file: file,
          line: import_line.line_number,
          import: import_line.text,
          constraint: "Not in allowed tech stack",
          fix_direction: "Verify if " + package_name + " is approved, add to tech stack or replace"
        })
```

### Step 4: Check Required Patterns

```
FOR each pattern IN constraints.required_patterns:
  FOR each file IN modified_files matching pattern.file_glob:
    IF file does not contain pattern.regex:
      constraint_violations.push({
        id: "CV-{NNN}",
        type: "missing_required_pattern",
        severity: pattern.severity || "medium",
        file: file,
        line: null,
        import: null,
        constraint: "Required pattern missing: " + pattern.description,
        fix_direction: pattern.fix_hint || "Add required pattern to file"
      })
```

### Step 5: Report

```
IF constraint_violations.length > 0:
  Print: "V0.5: {constraint_violations.length} constraint violation(s) found"
  FOR each violation IN constraint_violations:
    Print: "  [{violation.severity}] {violation.file}:{violation.line} - {violation.constraint}"
ELSE:
  Print: "V0.5: All modified files comply with tech stack constraints"
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
uat_gaps = []
IF file exists "${PHASE_DIR}/uat.md":
  Parse uat.md "Gaps" section.
  FOR each gap in uat.md:
    uat_gaps.push({
      id: "GAP-UAT-{NNN}",
      type: "human_verified_failure",
      severity: gap.severity,
      description: "From UAT: " + gap.reason,
      fix_direction: "Address user-reported issue: " + gap.truth
    })
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
gaps = []
For each failed truth:
  gaps.push({
    id: "GAP-{NNN}",
    type: "missing_feature" | "incomplete_implementation" | "broken_integration",
    severity: "critical" | "high" | "medium" | "low",
    description: "What is missing or broken",
    fix_direction: "Suggested approach to fix"
  })

For each missing/non-substantive artifact:
  gaps.push({ ... })

For each broken link:
  gaps.push({ ... })
```

### Auto-create Issues from Gaps

```
IF gaps.length > 0:
  mkdir -p ".workflow/issues"
  existing_ids = []
  IF file exists ".workflow/issues/issues.jsonl":
    Read .workflow/issues/issues.jsonl
    Extract all id fields matching today's date prefix ISS-YYYYMMDD-*
    existing_ids = collected IDs

  today = format(now(), "YYYYMMDD")
  counter = max sequence number from existing_ids for today + 1 (start at 1 if none)

  FOR each gap IN gaps[]:
    issue_id = "ISS-{today}-{counter padded to 3 digits}"
    issue = {
      id: issue_id,
      title: gap.description (truncated to 100 chars),
      status: "registered",
      priority: severity_to_priority(gap.severity),
      severity: gap.severity,
      source: "verification",
      phase_ref: PHASE_NUM,
      gap_ref: gap.id,
      description: gap.description,
      fix_direction: gap.fix_direction,
      context: { location: "", suggested_fix: gap.fix_direction, notes: "" },
      tags: [],
      affected_components: [],
      feedback: [],
      issue_history: [],
      created_at: now(),
      updated_at: now(),
      resolved_at: null,
      resolution: null
    }
    Append JSON line to .workflow/issues/issues.jsonl
    gap.issue_id = issue_id   // back-reference on gap object
    counter++

  Print: "Created {gaps.length} issues from verification gaps"
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
blocker_patterns = antipatterns.filter(ap => ap.severity == "Blocker")

IF blocker_patterns.length > 0:
  mkdir -p ".workflow/issues"
  existing_ids = []
  IF file exists ".workflow/issues/issues.jsonl":
    Read .workflow/issues/issues.jsonl
    Extract all id fields matching today's date prefix ISS-YYYYMMDD-*
    existing_ids = collected IDs

  today = format(now(), "YYYYMMDD")
  counter = max sequence number from existing_ids for today + 1 (start at 1 if none)

  FOR each pattern IN blocker_patterns:
    issue_id = "ISS-{today}-{counter padded to 3 digits}"
    issue = {
      id: issue_id,
      title: "Anti-pattern: " + pattern.pattern_name (truncated to 100 chars),
      status: "registered",
      priority: 1,
      severity: "critical",
      source: "antipattern",
      phase_ref: PHASE_NUM,
      gap_ref: null,
      description: "Blocker anti-pattern detected: " + pattern.pattern_name + " at " + pattern.file_line,
      fix_direction: "Remove " + pattern.pattern_name + " from " + pattern.file_line,
      context: { location: pattern.file_line, suggested_fix: "", notes: "" },
      tags: ["antipattern"],
      affected_components: [],
      feedback: [],
      issue_history: [],
      created_at: now(),
      updated_at: now(),
      resolved_at: null,
      resolution: null
    }
    Append JSON line to .workflow/issues/issues.jsonl
    pattern.issue_id = issue_id   // back-reference on anti-pattern object
    counter++

  Print: "Created {blocker_patterns.length} issues from blocker anti-patterns"
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

Enrich fix plan entries with issue references:
```
FOR each fix_plan IN fix_plans[]:
  fix_plan.issue_ids = []
  FOR each gap IN fix_plan.related_gaps:
    IF gap.issue_id exists:
      fix_plan.issue_ids.push(gap.issue_id)
```

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
ARCHIVE_TARGETS = ["verification.json", "validation.json"]
has_existing = false
FOR artifact IN ARCHIVE_TARGETS:
  IF file exists "${PHASE_DIR}/${artifact}":
    has_existing = true
    break

IF has_existing:
  mkdir -p "${PHASE_DIR}/.history"
  TIMESTAMP = current timestamp formatted as "YYYY-MM-DDTHH-mm-ss"
  FOR artifact IN ARCHIVE_TARGETS:
    IF file exists "${PHASE_DIR}/${artifact}":
      mv "${PHASE_DIR}/${artifact}" "${PHASE_DIR}/.history/${name}-${TIMESTAMP}.${ext}"
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
index.json.status = "verifying"
index.json.updated_at = now()

index.json.verification = {
  status: verification.json.status,
  verified_at: verification.json.verified_at,
  must_haves: summary of must_haves,
  gaps: verification.json.gaps
}

If validation.json exists:
  index.json.validation = {
    status: validation.json.status,
    test_coverage: validation.json.coverage,
    gaps: validation.json.gaps
  }
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
  {phase_dir}/verification.json
  {phase_dir}/validation.json (if generated)

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
