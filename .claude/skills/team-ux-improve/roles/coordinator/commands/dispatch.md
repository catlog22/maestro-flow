# Dispatch Command

## Purpose

Create task chains based on execution mode. Generate structured task descriptions with PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS format.

---

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session ID | coordinator Phase 2 | Yes |
| Project path | coordinator Phase 1 | Yes |
| Framework | coordinator Phase 1 | Yes |
| Pipeline mode | meta.json | Yes |

1. Load session ID from coordinator context
2. Load project path and framework from meta.json
3. Determine pipeline mode (standard)

---

## Phase 3: Task Chain Creation

### Task Description Template

Every task description uses structured format for clarity:

```
TaskCreate({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: <session-folder>
  - Scope: <scope>
  - Upstream artifacts: <artifact-1.md>, <artifact-2.md>
  - Key files: <file1>, <file2> (if applicable)
  - State: via team_msg(operation="get_state", role=<upstream-role>)
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>
---
InnerLoop: <true|false>
<additional-metadata-fields>"
})
TaskUpdate({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Standard Pipeline Tasks

**SCAN-001: UI Component Scanning**
```
TaskCreate({
  subject: "SCAN-001",
  description: "PURPOSE: Scan UI components to identify interaction issues (unresponsive buttons, missing feedback, state not refreshing) | Success: Complete issue report with file:line references and severity classification
TASK:
  - Detect framework (React/Vue) from project structure
  - Scan UI components for interaction patterns using ACE search and file analysis
  - Identify missing feedback mechanisms (loading states, error handling, success confirmation)
  - Detect unresponsive actions (event binding issues, async handling problems)
  - Check state update patterns (mutation vs reactive updates)
CONTEXT:
  - Session: <session-folder>
  - Scope: Project path: <project-path>, Framework: <framework>
  - File patterns: **/*.tsx, **/*.vue, **/*.jsx
  - Focus: UI components with user interactions
EXPECTED: {run_dir}/outputs/scan-report.md with structured issue list (severity: High/Medium/Low, file:line, description, category)
CONSTRAINTS: Focus on interaction issues only, exclude styling/layout problems
---
InnerLoop: false"
})
TaskUpdate({ taskId: "SCAN-001", owner: "scanner" })
```

**DIAG-001: Root Cause Diagnosis**
```
TaskCreate({
  subject: "DIAG-001",
  description: "PURPOSE: Diagnose root causes of identified UI issues | Success: Complete diagnosis report with fix recommendations for each issue
TASK:
  - Load scan report from {run_dir}/outputs/scan-report.md
  - Analyze state management patterns (direct mutation vs reactive updates)
  - Trace event binding and propagation
  - Check async handling (promises, callbacks, error catching)
  - Identify framework-specific anti-patterns
  - Use CLI for complex multi-file analysis when needed
CONTEXT:
  - Session: <session-folder>
  - Scope: Issues from scan report
  - Upstream artifacts: {run_dir}/outputs/scan-report.md
  - State: via team_msg(operation="get_state", role="scanner")
EXPECTED: {run_dir}/outputs/diagnosis.md with root cause analysis (issue ID, root cause, pattern type, fix recommendation)
CONSTRAINTS: Focus on actionable root causes, provide specific fix strategies
---
InnerLoop: false"
})
TaskUpdate({ taskId: "DIAG-001", addBlockedBy: ["SCAN-001"], owner: "diagnoser" })
```

**DESIGN-001: Solution Design**
```
TaskCreate({
  subject: "DESIGN-001",
  description: "PURPOSE: Design feedback mechanisms and state management solutions for identified issues | Success: Complete implementation guide with code patterns and examples
TASK:
  - Load diagnosis report from {run_dir}/outputs/diagnosis.md
  - Design feedback mechanisms (loading/error/success states) for each issue
  - Design state management patterns (useState/ref, reactive updates)
  - Design input control improvements (file selectors, validation)
  - Generate framework-specific code patterns (React/Vue)
  - Use CLI for complex multi-component solutions when needed
CONTEXT:
  - Session: <session-folder>
  - Scope: Issues from diagnosis report
  - Upstream artifacts: {run_dir}/outputs/diagnosis.md
  - Framework: <framework>
  - State: via team_msg(operation="get_state", role="diagnoser")
EXPECTED: {run_dir}/outputs/design-guide.md with implementation guide (issue ID, solution design, code patterns, state management examples, UI binding templates)
CONSTRAINTS: Solutions must be framework-appropriate, provide complete working examples
---
InnerLoop: false"
})
TaskUpdate({ taskId: "DESIGN-001", addBlockedBy: ["DIAG-001"], owner: "designer" })
```

**IMPL-001: Code Implementation**
```
TaskCreate({
  subject: "IMPL-001",
  description: "PURPOSE: Generate fix code with proper state management, event handling, and UI feedback bindings | Success: All fixes implemented and validated
TASK:
  - Load design guide from {run_dir}/outputs/design-guide.md
  - Extract implementation tasks from design guide
  - Generate fix code with proper state management (useState/ref)
  - Add event handlers with error catching
  - Implement UI feedback bindings (loading/error/success)
  - Use CLI for complex multi-file changes, direct Edit/Write for simple changes
  - Validate syntax and file existence after each fix
CONTEXT:
  - Session: <session-folder>
  - Scope: Fixes from design guide
  - Upstream artifacts: {run_dir}/outputs/design-guide.md
  - Framework: <framework>
  - State: via team_msg(operation="get_state", role="designer")
  - Context accumulator: Load from prior IMPL tasks (inner loop)
EXPECTED: {run_dir}/outputs/fixes/ directory with all fix files, implementation summary in {run_dir}/outputs/fixes/README.md
CONSTRAINTS: Maintain existing code style, ensure backward compatibility, validate all changes
---
InnerLoop: true"
})
TaskUpdate({ taskId: "IMPL-001", addBlockedBy: ["DESIGN-001"], owner: "implementer" })
```

**TEST-001: Test Validation**
```
TaskCreate({
  subject: "TEST-001",
  description: "PURPOSE: Generate and run tests to verify fixes (loading states, error handling, state updates) | Success: Pass rate >= 95%, all critical fixes validated
TASK:
  - Detect test framework (Jest/Vitest) from project
  - Get changed files from implementer state
  - Load test strategy from design guide
  - Generate test cases for loading states, error handling, state updates
  - Run tests and parse results
  - If pass rate < 95%, use CLI to generate fixes (max 5 iterations)
  - Generate test report with pass/fail counts, coverage, fix iterations
CONTEXT:
  - Session: <session-folder>
  - Scope: Fixes from implementer
  - Upstream artifacts: {run_dir}/outputs/fixes/, {run_dir}/outputs/design-guide.md
  - Framework: <framework>
  - State: via team_msg(operation="get_state", role="implementer")
EXPECTED: {run_dir}/outputs/test-report.md with test results (pass/fail counts, coverage metrics, fix iterations, remaining issues)
CONSTRAINTS: Pass rate threshold: 95%, max fix iterations: 5
---
InnerLoop: false"
})
TaskUpdate({ taskId: "TEST-001", addBlockedBy: ["IMPL-001"], owner: "tester" })
```

---

## Phase 4: Validation

1. Verify all tasks created successfully
2. Check task dependency chain is valid (no cycles)
3. Verify all task owners match Role Registry
4. Confirm task prefixes match role frontmatter
5. Output task count and dependency graph

| Check | Pass Criteria |
|-------|---------------|
| Task count | 5 tasks created |
| Dependencies | Linear chain: SCAN → DIAG → DESIGN → IMPL → TEST |
| Owners | All owners in Role Registry |
| Prefixes | Match role frontmatter |
