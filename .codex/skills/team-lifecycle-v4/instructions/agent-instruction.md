# Team Lifecycle v4 — Agent Instruction

---

## Role-Based Execution

### Analyst Role

**Responsibility**: Research domain, extract structured context, identify constraints.

**Input**:
- `id`: Task ID (e.g., `RESEARCH-001`)
- `title`: Task title
- `description`: Detailed task description with PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS
- `role`: `analyst`
- `pipeline_phase`: `research`
- `prev_context`: Previous tasks' findings (empty for wave 1)

**Execution Protocol**:

1. **Read shared discoveries**:
   ```javascript
   const discoveries = Read(`{session}/discoveries.ndjson`)
   ```

2. **Explore domain** (use CLI analysis tools):
   ```
   shell_exec(`maestro delegate "PURPOSE: Research domain for {requirement}
   TASK: • Identify problem statement • Define target users • Extract constraints • Map integration points
   CONTEXT: @**/* | Memory: {requirement}
   EXPECTED: Structured research context with problem/users/domain/constraints
   CONSTRAINTS: Read-only analysis" --role analyze --mode analysis --rule analysis-trace-code-execution`, { timeout: 30000 })
   // Execution mapping: @~/.maestro/workflows/shell-exec-protocol.md
   ```

3. **Extract structured context**:
   - Problem statement: What problem are we solving?
   - Target users: Who will use this?
   - Domain: What domain/industry?
   - Constraints: Technical, business, regulatory constraints
   - Integration points: External systems, APIs, services

4. **Write discovery context**:
   ```javascript
   Write(`{session}/spec/discovery-context.json`, JSON.stringify({
     problem_statement: "Users need OAuth2 authentication with SSO support",
     target_users: ["Enterprise customers", "Internal teams"],
     domain: "Authentication & Authorization",
     constraints: ["Must support SAML", "GDPR compliance", "99.9% uptime"],
     integration_points: ["User service API", "Session store", "Audit log"],
     exploration_dimensions: ["Security", "Scalability", "User experience"]
   }, null, 2))
   ```

5. **Share discoveries**:
   ```bash
   echo '{"ts":"2026-03-08T10:00:00+08:00","worker":"{id}","type":"research","data":{"dimension":"domain","findings":["Auth system needs OAuth2 + RBAC"],"constraints":["Must support SSO"],"integration_points":["User service API"]}}' >> {session}/discoveries.ndjson
   ```

6. **Report result**:
   ```javascript
   report_agent_job_result({
     id: "{id}",
     status: "completed",
     findings: "Explored domain: identified OAuth2+RBAC auth pattern, 5 integration points, TypeScript/React stack. Key constraint: must support SSO.",
     quality_score: "",
     supervision_verdict: "",
     error: ""
   })
   ```

**Success Criteria**:
- Discovery context written with all required fields
- Problem statement clear and actionable
- Constraints identified
- Integration points mapped

---

### Writer Role

**Responsibility**: Generate specification documents (product brief, requirements, architecture, epics).

**Input**:
- `id`: Task ID (e.g., `DRAFT-001`)
- `title`: Task title
- `description`: Detailed task description
- `role`: `writer`
- `pipeline_phase`: `product-brief`, `requirements`, `architecture`, or `epics`
- `context_from`: Upstream task IDs
- `prev_context`: Previous tasks' findings
- `inner_loop`: `true` (writer uses inner loop for revision)

**Execution Protocol**:

1. **Read upstream artifacts**:
   ```javascript
   const discoveryContext = JSON.parse(Read(`{session}/spec/discovery-context.json`))
   const productBrief = Read(`{session}/spec/product-brief.md`)  // if exists
   ```

2. **Generate document based on pipeline_phase**:

   **Product Brief** (DRAFT-001):
   ```markdown
   # Product Brief: OAuth2 Authentication System

   ## Vision
   Enable enterprise customers to authenticate users via OAuth2 with SSO support.

   ## Problem
   Current authentication system lacks OAuth2 support, blocking enterprise adoption.

   ## Target Users
   - Enterprise customers requiring SSO
   - Internal teams needing centralized auth

   ## Success Goals
   - 99.9% uptime
   - <200ms auth latency
   - GDPR compliant
   - Support 10k concurrent users

   ## Key Decisions
   - Use OAuth2 over custom auth
   - Support SAML for SSO
   - Implement RBAC for authorization
   ```

   **Requirements PRD** (DRAFT-002):
   ```markdown
   # Requirements: OAuth2 Authentication

   ## Functional Requirements

   ### FR-001: OAuth2 Authorization Flow
   **Priority**: Must Have
   **Description**: Implement OAuth2 authorization code flow
   **Acceptance Criteria**:
   - User redirected to OAuth provider
   - Authorization code exchanged for access token
   - Token stored securely in session

   ### FR-002: SSO Integration
   **Priority**: Must Have
   **Description**: Support SAML-based SSO
   **Acceptance Criteria**:
   - SAML assertion validated
   - User attributes mapped to internal user model
   - Session created with SSO context

   ## User Stories

   ### US-001: Enterprise User Login
   **As an** enterprise user
   **I want to** log in via my company's SSO
   **So that** I don't need separate credentials

   **Acceptance Criteria**:
   - Given I'm on the login page
   - When I click "Login with SSO"
   - Then I'm redirected to my company's SSO provider
   - And I'm logged in after successful authentication
   ```

   **Architecture Design** (DRAFT-003):
   ```markdown
   # Architecture: OAuth2 Authentication

   ## Component Diagram
   [User] -> [Auth Gateway] -> [OAuth Provider]
                |
                v
           [Session Store]
                |
                v
           [User Service]

   ## Tech Stack
   - **Backend**: Node.js + Express
   - **OAuth Library**: Passport.js
   - **Session Store**: Redis
   - **Database**: PostgreSQL

   ## Architecture Decision Records

   ### ADR-001: Use Passport.js for OAuth
   **Status**: Accepted
   **Context**: Need OAuth2 + SAML support
   **Decision**: Use Passport.js with passport-oauth2 and passport-saml strategies
   **Consequences**: Mature library, good community support, but adds dependency

   ## Data Model
   ```sql
   CREATE TABLE users (
     id UUID PRIMARY KEY,
     email VARCHAR(255) UNIQUE,
     oauth_provider VARCHAR(50),
     oauth_id VARCHAR(255)
   );
   ```

   ## Integration Points
   - User Service API: GET /users/:id, POST /users
   - Session Store: Redis SET/GET with TTL
   - Audit Log: POST /audit/events
   ```

   **Epics and Stories** (DRAFT-004):
   ```markdown
   # Epics: OAuth2 Authentication

   ## Epic 1: OAuth2 Core Flow
   **Priority**: Must Have (MVP)
   **Estimate**: 13 story points

   ### Stories
   1. **STORY-001**: Implement authorization endpoint (3 pts)
   2. **STORY-002**: Implement token exchange (5 pts)
   3. **STORY-003**: Implement token refresh (3 pts)
   4. **STORY-004**: Add session management (2 pts)

   ## Epic 2: SSO Integration
   **Priority**: Must Have (MVP)
   **Estimate**: 8 story points

   ### Stories
   1. **STORY-005**: Integrate SAML provider (5 pts)
   2. **STORY-006**: Map SAML attributes (3 pts)

   ## Epic 3: RBAC Authorization
   **Priority**: Should Have
   **Estimate**: 8 story points

   ### Stories
   1. **STORY-007**: Define role model (2 pts)
   2. **STORY-008**: Implement permission checks (3 pts)
   3. **STORY-009**: Add role assignment UI (3 pts)
   ```

3. **Write document to spec/ directory**:
   ```javascript
   Write(`{session}/spec/{doc-type}.md`, documentContent)
   ```

4. **Share discoveries**:
   ```bash
   echo '{"ts":"2026-03-08T10:15:00+08:00","worker":"{id}","type":"spec_artifact","data":{"doc_type":"product-brief","path":"spec/product-brief.md","sections":["Vision","Problem","Users","Goals"],"key_decisions":["OAuth2 over custom auth"]}}' >> {session}/discoveries.ndjson
   ```

5. **Report result**:
   ```javascript
   report_agent_job_result({
     id: "{id}",
     status: "completed",
     findings: "Generated product brief with vision, problem statement, target users, success goals. Key decision: OAuth2 over custom auth.",
     quality_score: "",
     supervision_verdict: "",
     error: ""
   })
   ```

**Success Criteria**:
- Document follows template structure
- All required sections present
- Terminology consistent with upstream docs
- Key decisions documented

---

### Planner Role

**Responsibility**: Break down requirements into implementation tasks.

**Input**:
- `id`: Task ID (e.g., `PLAN-001`)
- `title`: Task title
- `description`: Detailed task description
- `role`: `planner`
- `pipeline_phase`: `planning`
- `context_from`: Upstream task IDs (e.g., `QUALITY-001`)
- `prev_context`: Previous tasks' findings
- `inner_loop`: `true` (planner uses inner loop for refinement)

**Execution Protocol**:

1. **Read spec artifacts**:
   ```javascript
   const requirements = Read(`{session}/spec/requirements.md`)
   const architecture = Read(`{session}/spec/architecture.md`)
   const epics = Read(`{session}/spec/epics.md`)
   ```

2. **Explore codebase** (use CLI analysis tools):
   ```
   shell_exec(`maestro delegate "PURPOSE: Explore codebase for {requirement}
   TASK: • Identify relevant files • Find existing patterns • Locate integration points
   CONTEXT: @**/* | Memory: {requirement}
   EXPECTED: Exploration findings with file paths and patterns
   CONSTRAINTS: Read-only analysis" --role explore --mode analysis --rule analysis-trace-code-execution`, { timeout: 30000 })
   // Execution mapping: @~/.maestro/workflows/shell-exec-protocol.md
   ```

3. **Generate implementation plan**:
   ```javascript
   const plan = {
     requirement: "{requirement}",
     complexity: "Medium",  // Low (1-2 modules), Medium (3-4), High (5+)
     approach: "Strategy pattern for OAuth providers",
     tasks: [
       {
         task_id: "TASK-001",
         title: "Create OAuth provider interface",
         description: "Define provider interface with authorize/token/refresh methods",
         files: ["src/auth/providers/oauth-provider.ts"],
         depends_on: [],
         convergence_criteria: [
           "Interface compiles without errors",
           "Type definitions exported"
         ]
       },
       {
         task_id: "TASK-002",
         title: "Implement Google OAuth provider",
         description: "Concrete implementation for Google OAuth2",
         files: ["src/auth/providers/google-oauth.ts"],
         depends_on: ["TASK-001"],
         convergence_criteria: [
           "Tests pass",
           "Handles token refresh",
           "Error handling complete"
         ]
       }
     ],
     exploration_findings: {
       existing_patterns: ["Strategy pattern in payment module"],
       tech_stack: ["TypeScript", "Express", "Passport.js"],
       integration_points: ["User service", "Session store"]
     }
   }
   Write(`{session}/plan/plan.json`, JSON.stringify(plan, null, 2))
   ```

4. **Write per-task files**:
   ```javascript
   for (const task of plan.tasks) {
     Write(`{session}/plan/.task/${task.task_id}.json`, JSON.stringify(task, null, 2))
   }
   ```

5. **Share discoveries**:
   ```bash
   echo '{"ts":"2026-03-08T11:00:00+08:00","worker":"{id}","type":"plan_task","data":{"task_id":"TASK-001","title":"Create OAuth provider interface","files":["src/auth/providers/oauth-provider.ts"],"complexity":"Low","convergence_criteria":["Interface compiles"]}}' >> {session}/discoveries.ndjson
   ```

6. **Report result**:
   ```javascript
   report_agent_job_result({
     id: "{id}",
     status: "completed",
     findings: "Generated implementation plan with 2 tasks. Complexity: Medium. Approach: Strategy pattern for OAuth providers. Identified existing strategy pattern in payment module.",
     quality_score: "",
     supervision_verdict: "",
     error: ""
   })
   ```

**Success Criteria**:
- plan.json written with valid structure
- 2-7 tasks defined
- Task dependencies form DAG (no cycles)
- Convergence criteria defined per task
- Complexity assessed

---

### Executor Role

**Responsibility**: Execute implementation plan tasks.

**Input**:
- `id`: Task ID (e.g., `IMPL-001`)
- `title`: Task title
- `description`: Detailed task description
- `role`: `executor`
- `pipeline_phase`: `implementation`
- `context_from`: Upstream task IDs (e.g., `PLAN-001`)
- `prev_context`: Previous tasks' findings
- `inner_loop`: `true` (executor uses inner loop for self-repair)

**Execution Protocol**:

1. **Read implementation plan**:
   ```javascript
   const plan = JSON.parse(Read(`{session}/plan/plan.json`))
   ```

2. **For each task in plan.tasks** (ordered by depends_on):

   a. **Read context files**:
   ```javascript
   for (const file of task.files) {
     if (fileExists(file)) Read(file)
   }
   ```

   b. **Identify patterns**:
   - Note imports, naming conventions, existing structure
   - Follow project patterns from exploration_findings

   c. **Apply changes**:
   - Use Edit for existing files (prefer)
   - Use Write for new files
   - Follow convergence criteria from task

   d. **Build check** (if build command exists):
   ```bash
   npm run build 2>&1 || echo BUILD_FAILED
   ```
   - If build fails: analyze error → fix → rebuild (max 3 retries)

   e. **Verify convergence**:
   - Check each criterion in task.convergence_criteria
   - If not met: self-repair loop (max 3 iterations)

3. **Share discoveries**:
   ```bash
   echo '{"ts":"2026-03-08T11:00:00+08:00","worker":"{id}","type":"implementation","data":{"task_id":"IMPL-001","files_modified":["src/auth/oauth.ts","src/auth/rbac.ts"],"approach":"Strategy pattern for auth providers","changes_summary":"Created OAuth2 provider, RBAC middleware, session management"}}' >> {session}/discoveries.ndjson
   ```

4. **Report result**:
   ```javascript
   report_agent_job_result({
     id: "{id}",
     status: "completed",
     findings: "Implemented 2 tasks: OAuth provider interface + Google OAuth implementation. Modified 2 files. All convergence criteria met.",
     quality_score: "",
     supervision_verdict: "",
     error: ""
   })
   ```

**Success Criteria**:
- All tasks completed in dependency order
- Build passes (if build command exists)
- All convergence criteria met
- Code follows project patterns

---

### Tester Role

**Responsibility**: Run tests, fix failures, achieve 95% pass rate.

**Input**:
- `id`: Task ID (e.g., `TEST-001`)
- `title`: Task title
- `description`: Detailed task description
- `role`: `tester`
- `pipeline_phase`: `validation`
- `context_from`: Upstream task IDs (e.g., `IMPL-001`)
- `prev_context`: Previous tasks' findings

**Execution Protocol**:

1. **Detect test framework**:
   ```javascript
   const packageJson = JSON.parse(Read('package.json'))
   const testCommand = packageJson.scripts?.test || packageJson.scripts?.['test:unit']
   ```

2. **Run affected tests first** (if possible):
   ```bash
   npm test -- --changed
   ```

3. **Run full test suite**:
   ```bash
   npm test 2>&1
   ```

4. **Parse test results**:
   - Total tests
   - Passed tests
   - Failed tests
   - Pass rate = passed / total

5. **Self-repair loop** (if pass rate < 95%):
   - Analyze test output
   - Diagnose failure cause
   - Fix source code
   - Re-run tests
   - Max 10 iterations

6. **Share discoveries**:
   ```bash
   echo '{"ts":"2026-03-08T11:30:00+08:00","worker":"{id}","type":"test_result","data":{"framework":"vitest","pass_rate":98,"failures":["timeout in SSO integration test"],"fix_iterations":2}}' >> {session}/discoveries.ndjson
   ```

7. **Report result**:
   ```javascript
   report_agent_job_result({
     id: "{id}",
     status: "completed",
     findings: "Ran 50 tests. Pass rate: 98% (49/50). Fixed 2 failures in 2 iterations. Remaining failure: timeout in SSO integration test (non-blocking).",
     quality_score: "",
     supervision_verdict: "",
     error: ""
   })
   ```

**Success Criteria**:
- Test suite executed
- Pass rate >= 95%
- Failures fixed (max 10 iterations)
- Test results documented

---

### Reviewer Role

**Responsibility**: Multi-dimensional code review or quality gate scoring.

**Input**:
- `id`: Task ID (e.g., `REVIEW-001` or `QUALITY-001`)
- `title`: Task title
- `description`: Detailed task description
- `role`: `reviewer`
- `pipeline_phase`: `review` or `readiness`
- `context_from`: Upstream task IDs
- `prev_context`: Previous tasks' findings

**Execution Protocol**:

**For Code Review** (REVIEW-*):

1. **Read implementation files**:
   ```javascript
   const plan = JSON.parse(Read(`{session}/plan/plan.json`))
   const modifiedFiles = plan.tasks.flatMap(t => t.files)
   ```

2. **Multi-dimensional review**:
   - **Quality**: Code style, naming, structure
   - **Security**: Input validation, auth checks, SQL injection
   - **Architecture**: Follows design, proper abstractions
   - **Requirements**: Covers all FRs, acceptance criteria met

3. **Determine verdict**:
   - `BLOCK`: Critical issues, cannot merge
   - `CONDITIONAL`: Minor issues, can merge with fixes
   - `APPROVE`: No issues, ready to merge

4. **Write review report**:
   ```markdown
   # Code Review: {id}

   ## Verdict: APPROVE

   ## Quality (8/10)
   - Code style consistent
   - Naming clear and semantic
   - Minor: some functions could be extracted

   ## Security (9/10)
   - Input validation present
   - Auth checks correct
   - SQL injection prevented

   ## Architecture (8/10)
   - Follows strategy pattern
   - Proper abstractions
   - Minor: could use dependency injection

   ## Requirements Coverage (10/10)
   - All FRs implemented
   - Acceptance criteria met
   - Edge cases handled

   ## Issues
   (none)

   ## Recommendations
   1. Extract validation logic to separate module
   2. Add dependency injection for testability
   ```

**For Quality Gate** (QUALITY-*):

1. **Read all spec artifacts**:
   ```javascript
   const productBrief = Read(`{session}/spec/product-brief.md`)
   const requirements = Read(`{session}/spec/requirements.md`)
   const architecture = Read(`{session}/spec/architecture.md`)
   const epics = Read(`{session}/spec/epics.md`)
   ```

2. **Score 4 dimensions** (25% each):
   - **Completeness**: All sections present, no gaps
   - **Consistency**: Terminology aligned, decisions traced
   - **Traceability**: Vision → requirements → architecture → epics
   - **Depth**: Sufficient detail for implementation

3. **Calculate overall score**:
   ```javascript
   const score = (completeness + consistency + traceability + depth) / 4
   ```

4. **Determine gate verdict**:
   - `>= 80%`: PASS (proceed to implementation)
   - `60-79%`: REVIEW (revisions recommended)
   - `< 60%`: FAIL (return to writer for rework)

5. **Write quality report**:
   ```markdown
   # Quality Gate: {id}

   ## Overall Score: 82%

   ## Dimension Scores
   - Completeness: 90% (23/25)
   - Consistency: 85% (21/25)
   - Traceability: 80% (20/25)
   - Depth: 75% (19/25)

   ## Verdict: PASS

   ## Findings
   - All spec documents present and complete
   - Terminology consistent across docs
   - Clear trace from vision to epics
   - Sufficient detail for implementation
   - Minor: architecture could include more error handling details
   ```

6. **Share discoveries**:
   ```bash
   echo '{"ts":"2026-03-08T12:00:00+08:00","worker":"{id}","type":"quality_gate","data":{"gate_id":"QUALITY-001","score":82,"dimensions":{"completeness":90,"consistency":85,"traceability":80,"depth":75},"verdict":"pass"}}' >> {session}/discoveries.ndjson
   ```

7. **Report result**:
   ```javascript
   report_agent_job_result({
     id: "{id}",
     status: "completed",
     findings: "Quality gate: Completeness 90%, Consistency 85%, Traceability 80%, Depth 75%. Overall: 82.5% PASS.",
     quality_score: "82",
     supervision_verdict: "",
     error: ""
   })
   ```

**Success Criteria**:
- All dimensions scored
- Report written with findings
- Verdict determined
- Score >= 80% for quality gate pass

---

## Progress Milestone Protocol

All roles MUST report progress at milestones during task execution via `team_msg`.

**Why**: Gives coordinator execution trace on resume, enables human CLI monitoring during wait, and provides blocker forensics on timeout.

### Milestone Reporting

When you reach a natural phase boundary (context loaded, core work done, verification complete), report:

```javascript
mcp__maestro-tools__team_msg({
  operation: "log",
  session_id: "<from task assignment>",
  from: "<task_id>",        // e.g., "IMPL-001"
  to: "coordinator",
  type: "progress",
  summary: "[<task_id>] <brief phase description> (<pct>%)",
  data: {
    task_id: "<task_id>",
    role: "<role>",
    status: "in_progress",   // in_progress | blocked | completed
    progress_pct: <0-100>,
    phase: "<what just completed>",
    key_info: "<most important finding or decision>"
  }
})
```

### Role-Specific Milestones

| Role | Milestone 1 (~20%) | Milestone 2 (~60%) | Milestone 3 (~90%) |
|------|--------------------|--------------------|---------------------|
| analyst | Domain exploration started | Analysis complete | Findings documented |
| writer | Template & upstream loaded | Draft complete | Self-reviewed |
| planner | Specs read, codebase explored | Plan generated | Tasks validated |
| executor | Context loaded, plan read | Core changes implemented | Build/test verified |
| tester | Test suite identified | Tests executed | Fix iterations done |
| reviewer | Files loaded for review | Review complete | Report written |

### Blocker Reporting (Immediate)

If you hit a blocker (build fails 3x, missing dependency, ambiguous requirement), report **immediately** — don't wait for next milestone:

```javascript
mcp__maestro-tools__team_msg({
  operation: "log",
  session_id: "<session_id>",
  from: "<task_id>",
  to: "coordinator",
  type: "blocker",
  summary: "[<task_id>] BLOCKED: <brief description>",
  data: {
    task_id: "<task_id>",
    status: "blocked",
    blocker_type: "<build_failure|missing_dep|ambiguous_req|test_failure>",
    blocker_detail: "<specific error or issue>",
    attempts: <N>,
    needs: "<what would unblock>"
  }
})
```

After reporting, continue attempting resolution (inner loop). Don't wait for coordinator response.

### Completion Report

After calling `report_agent_job_result`, also log to team_msg for coordinator trace:

```javascript
mcp__maestro-tools__team_msg({
  operation: "log",
  session_id: "<session_id>",
  from: "<task_id>",
  to: "coordinator",
  type: "task_complete",
  summary: "[<task_id>] DONE: <brief result>",
  data: {
    task_id: "<task_id>",
    status: "completed",
    progress_pct: 100,
    files_modified: [],
    key_findings: [],
    elapsed: "<estimated time>"
  }
})
```

### Overhead Rule

Milestone reporting is **lightweight** — log and continue. Never block execution to report. If `team_msg` call fails, continue working — the discovery file is the authoritative output.

---

## Inner Loop Protocol

Roles with `inner_loop: true` support self-repair:

| Scenario | Max Iterations | Action |
|----------|---------------|--------|
| Build failure | 3 | Analyze error → fix source → rebuild |
| Test failure | 10 | Analyze failure → fix source → re-run tests |
| Convergence not met | 3 | Check criteria → adjust implementation → re-verify |
| Document incomplete | 2 | Review template → add missing sections → re-validate |

After max iterations: report error, mark task as failed.

---

## Shared Discovery Board

All roles read/write `{session}/discoveries.ndjson`:

**Discovery Types**:
- `research`: Research findings
- `spec_artifact`: Specification document
- `exploration`: Codebase exploration
- `plan_task`: Implementation task definition
- `implementation`: Implementation result
- `test_result`: Test execution result
- `review_finding`: Code review finding
- `checkpoint`: Supervisor checkpoint result
- `quality_gate`: Quality gate assessment

**Protocol**:
1. Read discoveries at start
2. Append discoveries during execution (never modify existing)
3. Deduplicate by type + dedup key

---

## Error Handling

| Error | Resolution |
|-------|------------|
| Upstream artifact not found | Report error, mark failed |
| Spec document invalid format | Report error, mark failed |
| Plan JSON corrupt | Report error, mark failed |
| Build fails after 3 retries | Mark task failed, report error |
| Tests fail after 10 retries | Mark task failed, report error |
| CLI tool timeout | Fallback to direct implementation |
| Dependency task failed | Skip dependent tasks, report error |

---

## Termination Contract (MANDATORY for ALL roles)

Every spawned worker — regardless of role — MUST call `report_agent_job_result` EXACTLY ONCE before exiting. NO exceptions:

| Path | Action |
|------|--------|
| Success | `status=completed` after verification passes |
| Failure | `status=failed` with error message (unrecoverable error) |
| Blocked | `status=failed` (no separate "blocked" enum here — use error message to explain blockage) |
| Timeout | Approaching `max_runtime_seconds` → revert partial unsafe work → `status=failed` with error="timeout" |

Rules:
- NEVER continue indefinitely.
- NEVER exit silently.
- NEVER omit `report_agent_job_result`.
- Do NOT write to tasks.csv, wave-*.csv, results.csv — orchestrator owns those.
- Do NOT call `spawn_agents_on_csv` (no recursion).

## Output Format

All roles use `report_agent_job_result` with this schema:

```json
{
  "id": "{id}",
  "status": "completed" | "failed",
  "findings": "Key discoveries (max 500 chars)",
  "quality_score": "0-100 (reviewer only)",
  "supervision_verdict": "pass|warn|block (supervisor only)",
  "error": ""
}
```

Note: spawn output_schema in SKILL.md uses `result_status` (not `status`). The orchestrator's merge step maps `result_status` → master `status`. Workers report via `report_agent_job_result` which the harness converts to the CSV result row — the field key here (`status`) is the worker-facing field name documented for this skill family.
