# Maestro-Flow Command Usage Guide

The Maestro-Flow command system includes 51 slash commands, organized into 6 major categories. This document covers the main pipeline command sequencing, quick channels, the Issue closed-loop workflow, learning toolkit, and the usage scenarios for each command.

## Command Overview

| Category | Count | Prefix | Responsibility |
|----------|-------|--------|----------------|
| **Core Workflow** | 20 | `maestro-*` | Project initialization, planning, execution, verification, phase progression, coordination, milestones, overlays |
| **Management** | 12 | `manage-*` | Issue lifecycle, codebase documentation, knowledge capture, memory, harvest, status |
| **Quality** | 9 | `quality-*` | Code review, business testing, UAT, debugging, refactoring, retrospective, sync |
| **Specification** | 3 | `spec-*` | Project spec initialization, loading, entry |
| **Learning** | 5 | `learn-*` | Unified retro (git+decision), follow-along, pattern decompose, investigate, second opinion |
| **Wiki** | 2 | `wiki-*` | Connection discovery, knowledge digest |

The global entry point `/maestro` is the smart coordinator that automatically selects the optimal command chain based on user intent and project state.

### Command Panorama

```mermaid
graph TB
    subgraph entry["Entry"]
        M["/maestro<br>Smart Coordinator"]
    end

    subgraph init["Project Initialization"]
        BS["/maestro-brainstorm"]
        INIT["/maestro-init"]
        RM["/maestro-roadmap"]
        SG["/maestro-spec-generate"]
        UID["/maestro-ui-design"]
    end

    subgraph pipeline["Milestone Pipeline"]
        AN["/maestro-analyze"]
        PL["/maestro-plan"]
        EX["/maestro-execute"]
        VF["/maestro-verify"]
    end

    subgraph quality["Quality Pipeline"]
        QR["/quality-review"]
        QBT["/quality-business-test"]
        QTG["/quality-test-gen"]
        QT["/quality-test"]
        QD["/quality-debug"]
        QIT["/quality-integration-test"]
        QRF["/quality-refactor"]
        QS["/quality-sync"]
    end

    subgraph issue["Issue Closed-Loop"]
        ID["/manage-issue-discover"]
        IC["/manage-issue<br>create"]
        IA["/maestro-analyze --gaps"]
        IP["/maestro-plan --gaps"]
        IE["/maestro-execute"]
        ICL["/manage-issue<br>close"]
    end

    subgraph milestone["Milestone"]
        MA["/maestro-milestone-audit"]
        MC["/maestro-milestone-complete"]
    end

    subgraph quick["Quick Channel"]
        MQ["/maestro-quick"]
        LP["/workflow-lite-plan"]
    end

    M -->|"Intent routing"| init
    M -->|"Intent routing"| pipeline
    M -->|"continue"| pipeline
    M -->|quick| quick

    BS -.->|"Optional"| INIT
    INIT --> RM
    INIT --> SG
    RM --> PL
    SG --> PL
    UID -.->|"Optional"| PL

    AN --> PL
    PL --> EX
    EX --> VF
    VF --> QBT
    QBT --> QR
    QR --> QT
    QT -->|"All Phases completed"| MA

    QBT -->|"Failure"| PL
    VF -->|gaps| PL
    QT -->|"Failure"| QD
    QD -->|"Fix"| PL

    ID --> IC
    IC --> IA
    IA --> IP
    IP --> IE
    IE --> ICL

    MA --> MC
    MC -->|"Next Milestone"| AN
```

### Interaction Between Main Pipeline and Issues

```mermaid
graph TB
    subgraph phase_pipeline["Main Phase Pipeline"]
        direction LR
        AN["analyze"] --> PL["plan"] --> EX["execute"] --> VF["verify"]
        VF --> QBT["business-test"] --> QR["review"] --> QT["test"] --> PT["transition"]
    end

    subgraph issue_loop["Issue Closed-Loop"]
        direction LR
        ID["discover"] --> IC["create"] --> IA["analyze"]
        IA --> IP["plan"] --> IE["execute"] --> ICL["close"]
    end

    subgraph shared["Shared Infrastructure"]
        JSONL[("issues.jsonl")]
        CMD["Commander Agent"]
        SCHED["ExecutionScheduler"]
        WS["WebSocket"]
    end

    %% Phase → Issue: Main pipeline produces Issues
    QR -->|"Review finds problems<br>auto-create Issue"| IC
    QT -->|"Test failure<br>Create Issue"| IC
    VF -->|"Verify gaps<br>produce Issue"| IC

    %% Issue → Phase: Issue links to Phase
    IC -->|"phase_id linkage<br>path=workflow"| phase_pipeline
    IE -->|"Fix code<br>serves Phase"| EX

    %% Commander drives both directions
    CMD -->|"Schedule Phase tasks"| SCHED
    CMD -->|"Auto-advance Issue"| IA
    CMD -->|"Auto-advance Issue"| IP

    %% Shared storage
    IC --> JSONL
    IA --> JSONL
    IP --> JSONL
    IE --> JSONL

    classDef phaseNode fill:#2d5a3d,color:#fff,stroke:#1a3a25
    classDef issueNode fill:#4a3a6a,color:#fff,stroke:#2d2245
    classDef sharedNode fill:#3a4a5a,color:#fff,stroke:#252f3a

    class AN,PL,EX,VF,QR,QT,PT phaseNode
    class ID,IC,IA,IP,IE,ICL issueNode
    class JSONL,CMD,SCHED,WS sharedNode
```

> **Key relationship overview**: The Phase pipeline and Issue closed-loop are two parallel workflows interconnected through the following mechanisms:
>
> 1. **Phase to Issue (problem production)**: `quality-review` automatically creates Issues for critical/high severity findings during code review; `quality-business-test` produces Issues on business rule failures (with REQ traceability); `quality-test` produces Issues on failure; `maestro-verify` can associate Issues when gaps are found
> 2. **Issue to Phase (fix injection)**: Issues link to specific Phases via the `phase_id` field, with `path=workflow` indicating the Issue belongs to the Phase pipeline context; code modified during Issue execution serves the owning Phase
> 3. **Commander bidirectional orchestration**: Commander Agent manages both Phase task scheduling (via ExecutionScheduler) and Issue closed-loop advancement (via AgentManager), forming a unified automation scheduling layer
> 4. **Shared storage**: Both workflows share `issues.jsonl` storage and WebSocket real-time communication

### Two Issue Processing Paths

The Issue `path` field distinguishes two processing paths:

| path | Meaning | Source | Lifecycle |
|------|---------|--------|-----------|
| `standalone` | Independent Issue, not bound to a Phase | Manual creation, `/manage-issue-discover`, external import | Independent closed-loop, does not affect Phase progression |
| `workflow` | Phase-linked Issue | `quality-review` auto-create, `quality-business-test` failure, Phase verification output | May block Phase transition |

- `standalone` Issues are displayed independently on the kanban board, resolved through the Issue closed-loop (analyze, plan, execute)
- `workflow` Issues carry a `phase_id` and are displayed alongside their corresponding Phase column on the kanban board; their resolution status may affect whether the Phase can transition

```mermaid
graph LR
    subgraph standalone_path["standalone path"]
        S1["Manual create /<br>discover found"] --> S2["Independent closed-loop<br>analyze→plan→execute"]
        S2 --> S3["close"]
    end

    subgraph workflow_path["workflow path"]
        W1["review/verify/test<br>auto-create"] --> W2["Link to Milestone<br>milestone=M1"]
        W2 --> W3["Issue closed-loop fix"]
        W3 --> W4["Re-verification"]
        W4 --> W5["milestone-audit"]
    end

    style standalone_path fill:#1a1a2e,stroke:#4a4a6a
    style workflow_path fill:#1a2e1a,stroke:#4a6a4a
```

### Issue Closed-Loop State Transitions

```mermaid
stateDiagram-v2
    [*] --> open: Create Issue
    open --> analyzing: /maestro-analyze --gaps<br>writes analysis
    analyzing --> planned: /maestro-plan --gaps<br>writes solution
    planned --> in_progress: /maestro-execute<br>starts execution
    in_progress --> resolved: Execution succeeded
    in_progress --> open: Execution failed (rollback)
    resolved --> closed: /manage-issue close
    closed --> [*]

    note right of open: Kanban Backlog column
    note right of in_progress: Kanban In Progress column
    note right of resolved: Kanban Review column
    note right of closed: Kanban Done column

    note left of analyzing
        Derived DisplayStatus
        status remains open
        but card shows analyzing
    end note
```

### Main Phase State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: Phase created
    no_artifacts --> analyzed: /maestro-analyze → ANL artifact
    analyzed --> planned: /maestro-plan → PLN artifact
    planned --> executed: /maestro-execute → EXC artifact
    executed --> verified: /maestro-verify → VRF artifact
    verified --> audited: /maestro-milestone-audit
    audited --> completed: /maestro-milestone-complete
    completed --> [*]

    verified --> planned: Gaps found → plan --gaps
    executed --> planned: Failure → debug → plan --gaps
```

**Core change**: Phase = label, not directory. All artifacts live in `.workflow/scratch/`, tracked by `state.json.artifacts[]`. Each step produces an artifact entry (ANL/PLN/EXC/VRF) forming a dependency chain.

---

## 1. Main Workflow (Milestone Pipeline)

The main workflow progresses the project in units of **Phase**, with each Phase going through a complete lifecycle pipeline.

### 1.1 Project Initialization

```
/maestro-init → /maestro-roadmap or /maestro-spec-generate
```

| Step | Command | Purpose | Output |
|------|---------|---------|--------|
| 0 | `/maestro-brainstorm` (optional) | Multi-role brainstorming | guidance-specification.md |
| 1 | `/maestro-init` | Initialize .workflow/ directory | state.json, project.md, specs/ |
| 2a | `/maestro-roadmap` | Lightweight roadmap (interactive) | roadmap.md (phases as labels) |
| 2b | `/maestro-spec-generate` | Full specification chain (7 stages) | PRD + architecture docs + roadmap.md |
| (optional) | `/maestro-ui-design` | UI design prototype | design-ref/ tokens |

**Choosing 2a vs 2b**: Use roadmap for small projects or when requirements are clear; use spec-generate for large projects or when complete specification documents are needed.

### 1.2 Milestone Pipeline (Scratch-Based Artifact Registry)

```
/maestro-analyze → /maestro-plan → /maestro-execute → /maestro-verify → /quality-review → /maestro-milestone-audit → /maestro-milestone-complete
```

| Stage | Command | Input | Output | Artifact |
|-------|---------|-------|--------|----------|
| Analyze | `/maestro-analyze` | roadmap + project.md | context.md, analysis.md | ANL-{NNN} |
| Plan | `/maestro-plan` | context.md (from ANL) | plan.json + TASK-*.json | PLN-{NNN} |
| Execute | `/maestro-execute` | plan.json | .summaries/, code changes | EXC-{NNN} |
| Verify | `/maestro-verify` | .summaries/ | verification.json | VRF-{NNN} |
| Review | `/quality-review` | code changes | review.json | — |
| Audit | `/maestro-milestone-audit` | artifact registry | audit-report.md | — |
| Complete | `/maestro-milestone-complete` | audit passed | archived to milestones/ | — |

**All output paths**: `scratch/{type}-{slug}-{date}/` — no more `.workflow/phases/` directories.

**Scope routing**: No args = entire milestone; number = specific phase; text = adhoc/standalone.

### 1.3 Gap Fix Loop

When verification or testing finds gaps:

```
/maestro-verify (gaps found) → /maestro-plan --gaps → /maestro-execute → /maestro-verify (re-check)
/quality-business-test (business rule failure) → /quality-debug --from-business-test → /maestro-plan --gaps → re-execute
/quality-test --auto-fix (failure) → /quality-debug → /maestro-plan --gaps → re-execute
```

### 1.4 Milestone Management

When all Phases of a milestone are completed:

```
/maestro-milestone-audit → /maestro-milestone-complete
```

- `milestone-audit`: Cross-Phase integration verification, checking inter-module dependencies and interface consistency
- `milestone-complete`: Archive the milestone and advance to the next one

### 1.5 Using the Maestro Coordinator

All of the above sequencing can be orchestrated automatically via `/maestro`:

```bash
/maestro "Implement user authentication module"          # Intent recognition → auto-select command chain
/maestro continue                    # Auto-execute next step based on state.json
/maestro -y "Add OAuth support"        # Fully automatic mode (skip all interactive confirmations)
/maestro --chain full-lifecycle      # Force use of the full lifecycle chain
/maestro status                      # Quick view of project status
```

**Available command chains**:

| Chain Name | Command Sequence | Use Case |
|------------|------------------|----------|
| `full-lifecycle` | init→spec-generate→plan→execute→verify→review→test→transition | Brand new project |
| `spec-driven` | init→spec-generate→... | Requires full specification |
| `roadmap-driven` | init→roadmap→... | Lightweight roadmap |
| `brainstorm-driven` | brainstorm→init→roadmap→... | Start from brainstorming |
| `ui-design-driven` | ui-design→plan→execute→verify | UI design driven |
| `analyze-plan-execute` | analyze→plan→execute | Quick analyze-plan-execute |
| `execute-verify` | execute→verify | Plan already exists, execute directly |
| `quality-loop` | review→test→debug | Quality pipeline |
| `milestone-close` | milestone-audit→milestone-complete | Close a milestone |
| `quick` | quick task | Instant small tasks |

---

## 2. Quick Channel (Scratch Mode)

Bypasses the Phase pipeline and completes tasks directly in a scratch directory.

### 2.1 Quick Tasks

```bash
/maestro-quick "Fix login page bug"              # Shortest path, skip optional agents
/maestro-quick --full "Refactor API layer"            # With plan-checker validation
/maestro-quick --discuss "Database migration strategy"       # With decision extraction (Locked/Free/Deferred)
```

Output is stored in `.workflow/scratch/{task-slug}/`, without affecting the main Phase pipeline.

### 2.2 Quick Analyze + Plan + Execute

```bash
/maestro-analyze -q "Performance optimization"    # Quick mode, decision extraction only → generates context.md
/maestro-plan --dir .workflow/scratch/xxx   # Plan against scratch directory
/maestro-execute --dir .workflow/scratch/xxx  # Execute against scratch directory
```

The `--dir` parameter skips roadmap validation and works directly in the specified directory.

### 2.3 Lite Plan Workflow (Skill Level)

A lighter plan-execute chain via the Skill system's `workflow-lite-plan`:

```bash
/workflow-lite-plan "Implement Issue closed-loop system"    # explore→clarify→plan→confirm→execute→test-review
```

Automatic chaining: `lite-plan → lite-execute → lite-test-review`, managed entirely under `.workflow/.lite-plan/`.

---

## 3. Issue Closed-Loop Workflow

The Issue system runs in parallel with the Phase pipeline. It can operate as an independent closed-loop or deeply integrate with Phases.

**Relationship with the main pipeline** (see "Interaction Between Main Pipeline and Issues" in the Command Panorama):
- **Phase produces Issues**: `quality-review` automatically creates Issues for critical/high findings during review (auto-issue creation); `quality-business-test` creates Issues on business rule failures (with REQ traceability); `quality-test` creates Issues on failure; gaps from `maestro-verify` can also be converted to Issues
- **Issue fixes inject back into Phase**: Issues with `phase_id` (`path=workflow`) serve the Phase after fix execution; re-verify and re-test are required before transition
- **Standalone Issues do not block Phases**: `path=standalone` Issues are resolved through the Issue closed-loop independently, without affecting Phase progression
- **Commander unified scheduling**: Commander Agent drives both Phase tasks and Issue closed-loop, auto-scheduling with priority order `execute > analyze > plan`

### 3.1 Issue Lifecycle

```
Discover → Create → Analyze → Plan → Execute → Close
```

```
/manage-issue-discover                          # Auto-discover problems
       ↓
/manage-issue create --title "..." --severity high   # Create Issue
       ↓
/maestro-analyze --gaps ISS-xxx                  # Root cause analysis → writes analysis
       ↓
/maestro-plan --gaps                             # Solution planning → TASK-*.json + issue.task_refs[]
       ↓
/maestro-execute                                 # Execute solution → TASK completed + issue resolved
       ↓
/manage-issue close ISS-xxx --resolution "fixed" # Close Issue
```

### 3.2 Command Details

#### `/manage-issue-discover` — Problem Discovery

Two modes:

```bash
/manage-issue-discover                        # Full 8-perspective scan (security/performance/reliability/maintainability/scalability/UX/accessibility/compliance)
/manage-issue-discover by-prompt "Check error handling in APIs" # Targeted discovery by prompt
```

Output: Deduplicated Issue list, automatically written to `issues.jsonl`.

#### `/manage-issue` — CRUD Operations

```bash
/manage-issue create --title "Memory leak" --severity high --source discovery
/manage-issue list --status open --severity high
/manage-issue status ISS-xxx
/manage-issue update ISS-xxx --priority urgent --tags "perf,memory"
/manage-issue close ISS-xxx --resolution "Fixed in commit abc123"
/manage-issue link ISS-xxx --task TASK-001      # Bidirectional link Issue ↔ Task
```

#### `/maestro-analyze --gaps` — Issue Root Cause Analysis

```bash
/maestro-analyze --gaps ISS-xxx                  # Analyze Issue root cause (uses gemini by default)
/maestro-analyze --gaps ISS-xxx --tool qwen --depth deep  # Specify tool and depth
```

Flow: Read Issue → CLI codebase exploration → Identify root cause → Write to `issue.analysis` field (root_cause, impact, confidence, related_files, suggested_approach).

After analysis, the Issue's display status changes from `open` to `analyzing` (diagnosed).

#### `/maestro-plan --gaps` — Issue Solution Planning

```bash
/maestro-plan --gaps                             # Generate TASK-*.json from diagnosed Issues
/maestro-plan --gaps --from-analysis              # Explicitly use analysis results
```

Flow: Read Issue + analysis → CLI planning → Generate TASK-*.json files → Update `issue.task_refs[]` with task references.

After planning, the Issue's display status changes from `analyzing` to `planned`.

#### `/maestro-execute` — Unified Execution (Issues + Tasks)

```bash
/maestro-execute                                 # Execute all pending TASKs (including Issue-linked)
/maestro-execute --dry-run                        # Dry run (no actual execution)
```

**Unified data flow**: Issues produce TASKs via `--gaps` planning; `maestro-execute` runs TASKs and marks linked Issues as resolved on completion.

### 3.3 Issue and Kanban Integration

How Issues appear on the Dashboard kanban board:

| Issue Status | Kanban Column | Display Status | Card Features |
|-------------|---------------|----------------|---------------|
| `open` (no analysis) | Backlog | `open` (gray) | Type + priority badge |
| `open` + analysis | Backlog | `analyzing` (blue) | + analysis marker |
| `open` + solution | Backlog | `planned` (purple) | + "N steps" indicator |
| `in_progress` | In Progress | `in_progress` (yellow) | + execution status animation |
| `resolved` | Review | `resolved` (green) | Completion marker |
| `closed` | Done | `closed` (gray) | Archived |

The **path badge** on IssueCard identifies the Issue source:
- `standalone` — Independent Issue (manually created or discovered)
- `workflow` — Phase-linked Issue (auto-created by review/verify/test, with `phase_id`)

Available actions on the kanban board:
- **Analyze/Plan/Execute buttons** → Click in Issue detail modal, triggers backend Agent via WebSocket
- **Executor selector** → Hover on IssueCard to display, choose Claude/Codex/Gemini
- **Batch execution** → Multi-select Issues then use ExecutionToolbar

### 3.4 Commander Agent Automation

Commander Agent acts as an autonomous supervisor that can automatically advance the Issue closed-loop without manual intervention:

1. Finds `open` Issues without `analysis` → auto-triggers `analyze_issue`
2. Finds Issues with `analysis` but no `solution` → auto-triggers `plan_issue`
3. Executes in priority order: `execute > analyze > plan`

This means Issues can be fully automated through the analyze, plan, execute closed-loop by Commander after creation.

---

## 4. Quality Pipeline

Quality commands typically run after Phase execution, but can also be used independently.

### 4.1 Standard Quality Flow

```
/maestro-execute → /maestro-verify → /quality-business-test → /quality-review → /quality-test-gen → /quality-test → /maestro-phase-transition
```

### 4.2 Command Descriptions

| Command | Purpose | Parameters | Typical Scenario |
|---------|---------|------------|------------------|
| `/quality-business-test {N}` | PRD-forward business testing | `--spec` `--layer L1\|L2\|L3` `--gen-code` `--dry-run` `--re-run` `--auto` | Extract scenarios from REQ acceptance criteria, progressive L1 Interface → L2 Business Rule → L3 Scenario |
| `/quality-review {N}` | Tiered code review | `--level quick\|standard\|deep` | Review code quality after execution |
| `/quality-test-gen {N}` | Test generation | `--layer unit\|e2e\|all` | Nyquist coverage analysis + RED-GREEN |
| `/quality-test {N}` | Session-based UAT | `--smoke` `--auto-fix` | Acceptance testing + auto-fix loop |
| `/quality-debug` | Hypothesis-driven debugging | `--from-uat {N}` `--from-business-test {N}` `--parallel` | Root cause analysis after test failure |
| `/quality-integration-test {N}` | Integration testing | `--max-iter N` `--layer L0-L3` | L0-L3 progressive integration testing |
| `/quality-refactor` | Technical debt remediation | `[scope]` | Reflection-driven refactoring iteration |
| `/quality-sync` | Documentation sync | `--since HEAD~N` | Sync documentation after code changes |

### 4.3 Three-Track Testing

Three test commands verify from different angles — complementary, not replacements:

| Command | Input Source | Verification Angle |
|---------|-------------|-------------------|
| `/quality-business-test` | REQ-*.md acceptance criteria | **PRD-forward** — are business rules satisfied? |
| `/quality-test` | verification.json must_haves | **Code-backward** — does the code work? |
| `/quality-test-gen` | validation.json gaps | **Coverage-backward** — is coverage sufficient? |

### 4.4 Debug Loop

```
/quality-business-test (business rule failure) → /quality-debug --from-business-test {N} → fix → /quality-business-test --re-run (re-verify)
/quality-test (failure found) → /quality-debug --from-uat {N} → fix → /quality-test (re-verify)
```

`quality-debug` supports parallel hypothesis verification (`--parallel`), using the scientific method (hypothesis, experiment, verification) for root cause analysis.

---

## 5. Specification and Knowledge Management

### 5.1 Specification Management

```bash
/spec-setup                          # Initialize specs/ (scan project to generate conventions)
/spec-add arch "Use JSONL format for Issue storage"  # Record a design decision
/spec-add coding "All API endpoints use the Hono framework"  # Record a code pattern
/spec-load --category arch       # Load planning-related specs (called before agent execution)
```

Types: `bug` / `pattern` / `decision` / `rule` / `debug` / `test` / `review` / `validation`

### 5.2 Codebase Documentation

```bash
/manage-codebase-rebuild             # Full rebuild of .workflow/codebase/ docs
/manage-codebase-refresh             # Incremental refresh (based on git diff)
```

### 5.3 Memory Management

```bash
/manage-memory-capture compact       # Compact current session memory
/manage-learn tip "Always use bun instead of npm" --tag tooling
/manage-memory list --store workflow --tag tooling
/manage-memory search "authentication"
```

### 5.4 Status View

```bash
/manage-status                       # Project dashboard (progress, active tasks, next step suggestions)
```

---

## 6. Command Sequencing Quick Reference

### Main Phase Pipeline

```mermaid
graph LR
    INIT[init] --> RM["roadmap /<br>spec-generate"]
    RM -.-> UID["ui-design<br>(Optional)"]
    RM --> AN[analyze]
    UID -.-> AN
    AN --> PL[plan]
    PL --> EX[execute]
    EX --> VF[verify]
    VF --> QBT[business-test]
    QBT --> QR[review]
    QR --> QT[test]
    QT --> PT[phase-transition]
    VF -->|"gaps"| PL
    QBT -->|"Failure"| PL
    QT -->|"Failure"| PL
```

### Issue Closed-Loop

```mermaid
graph LR
    DIS[discover] --> CRE[create]
    CRE --> ANA[analyze]
    ANA --> PLN[plan]
    PLN --> EXE[execute]
    EXE --> CLS[close]

    CMD["Commander<br>Agent"]:::commander -->|"Auto"| ANA
    CMD -->|"Auto"| PLN
    CMD -->|"Auto"| EXE

    classDef commander fill:#4a6fa5,color:#fff,stroke:#345
```

### Quality Pipeline

```mermaid
graph LR
    EX[execute] --> VF[verify]
    VF --> QR[review]
    QR --> TG[test-gen]
    TG --> QT[test]
    QT --> PT[phase-transition]
    QT -->|"Failure"| QD[debug]
    QD --> PL["plan --gaps"]
    PL --> EX2[execute]
    EX2 --> VF2[verify]
```

### Quick Channel

```mermaid
graph LR
    subgraph quick["Quick Task"]
        MQ["/maestro-quick"]
    end

    subgraph scratch["Scratch Mode"]
        AQ["/maestro-analyze -q"] --> PD["/maestro-plan --dir"]
        PD --> ED["/maestro-execute --dir"]
    end

    subgraph lite["Lite Chain"]
        LP["/workflow-lite-plan"] --> LE[lite-execute]
        LE --> LT[lite-test-review]
    end
```

---

## 7. Common Workflow Examples

### New Project from Scratch

```bash
/maestro-brainstorm "Online education platform"
/maestro-init --from-brainstorm ANL-xxx
/maestro-roadmap "Create roadmap based on brainstorm results" -y
/maestro-plan 1
/maestro-execute 1
/maestro-verify 1
/maestro-phase-transition
```

### One-Click Fully Automatic

```bash
/maestro -y "Implement user authentication system"
# Auto-executes: init → roadmap → plan → execute → verify → review → test → transition
```

### Discover and Fix Problems

```bash
/manage-issue-discover by-prompt "Check error handling in all API endpoints"
/maestro-analyze --gaps ISS-xxx
/maestro-plan --gaps
/maestro-execute
/manage-issue close ISS-xxx --resolution "Fixed"
```

### Quick Fix a Bug

```bash
/maestro-quick "Fix login page layout issues on mobile"
```

### Test Failure After Phase Execution

```bash
/quality-business-test 3             # PRD-forward business testing (L1→L2→L3)
/quality-test 3                     # Session-based UAT
# If failures found:
/quality-debug --from-business-test 3  # Diagnose from business test failures
/maestro-plan 3 --gaps              # Generate fix plan
/maestro-execute 3                  # Execute fix
/quality-business-test 3 --re-run   # Re-run only failed scenarios
/maestro-phase-transition           # Advance after passing
```
