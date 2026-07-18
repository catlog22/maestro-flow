---
title: "Issue Discovery Guide"
---

A complete manual for the Maestro Issue system, covering issue discovery, management, and the full closure workflow.

---

## 1. Overview

The Maestro Issue system is a problem-tracking mechanism independent of the Phase pipeline. The Phase pipeline (analyze -> plan -> execute -> verify) drives predefined development tasks, while the Issue system captures and manages problems discovered in the codebase.

The two can operate independently or in concert:

- **Independent operation**: Discover and manage Issues directly without affecting Phase progress
- **Linked mode**: Issues are injected into the Phase pipeline via the `--gaps` parameter to drive root cause analysis and remediation

`/maestro-manage issue discover` is the entry point of the Issue system, providing two discovery modes:

- **Multi-perspective full scan**: 8 specialized perspectives analyze in parallel, providing comprehensive coverage of code quality dimensions
- **Prompt-driven exploration**: Deep, targeted exploration around user-specified concerns

Discovery results are automatically deduplicated, Issue records are generated, and they enter the closure workflow.

---

## 2. maestro-manage issue discover in Detail

### Basic Usage

```bash
/maestro-manage issue discover                                    # Interactive mode selection
/maestro-manage issue discover multi-perspective                  # 8-perspective full scan
/maestro-manage issue discover by-prompt "Check API error handling"  # Prompt-driven
/maestro-manage issue discover multi-perspective -y               # Skip confirmation
/maestro-manage issue discover multi-perspective --scope=src/auth/**  # Specify scope
/maestro-manage issue discover by-prompt "Database query perf" --depth=deep  # Deep exploration
```

### Parameter Reference

| Parameter | Description | Default |
|-----------|-------------|---------|
| _(no parameter)_ | Interactive mode selection | -- |
| `multi-perspective` | 8-perspective parallel scan | -- |
| `by-prompt "..."` | Prompt-driven exploration | -- |
| `-y` / `--yes` | Skip confirmation prompts | Confirmation required |
| `--scope=<pattern>` | File scan scope | `**/*` |
| `--depth=standard\|deep` | Exploration depth (by-prompt only) | `standard` |

---

### 8-Perspective Full Scan Mode

Launches parallel analysis from 8 specialized perspectives (4 Agents per batch):

```
Batch 1: security, performance, reliability, maintainability
Batch 2: scalability, ux, accessibility, compliance
```

Each perspective Agent scans source files, records `file:line` evidence, assesses severity (critical/high/medium/low), and suggests remediation direction.

<details>
<summary>Perspective Definitions (8 dimensions)</summary>

| Perspective | Focus Area | Core Question |
|-------------|-----------|---------------|
| **SECURITY** | Authentication, authorization, input validation, secret management, injection attacks | What security vulnerabilities or unsafe patterns exist? |
| **PERFORMANCE** | N+1 queries, infinite loops, missing caches, memory leaks, large payloads | What performance bottlenecks or inefficient patterns exist? |
| **RELIABILITY** | Error handling, retry logic, race conditions, data integrity, graceful degradation | What failure modes are unhandled or could cause data loss? |
| **MAINTAINABILITY** | Code duplication, tight coupling, missing abstractions, unclear naming, dead code | What makes the codebase harder to understand or modify? |
| **SCALABILITY** | Hardcoded limits, single-thread bottlenecks, stateful assumptions, schema rigidity | What will break as load/data/users grow? |
| **UX** | Confusing flows, missing feedback, inconsistent behavior, accessibility gaps | What causes friction or confusion for end users? |
| **ACCESSIBILITY** | Screen readers, keyboard navigation, color contrast, ARIA labels, focus management | What barriers exist for users with disabilities? |
| **COMPLIANCE** | Missing logging, audit trails, data retention, privacy controls, regulatory requirements | Which regulatory or policy requirements are unmet? |

</details>

#### Result Deduplication

Raw findings from all perspectives are merged and deduplicated: grouped by `file:line`, entries with description similarity > 80% are merged, the record with the higher severity is retained.

#### Output Example

```
Discovery Session: DBP-20260513-143022
Mode: multi-perspective
Raw findings: 47 → Unique issues: 31

Severity: critical(3) high(8) medium(12) low(8)
Next: /maestro-manage issue list --severity critical
```

---

### by-prompt Mode

Prompt-driven mode performs deep, targeted exploration around user-specified concerns.

**Execution Flow**:

1. Break the user Prompt into 3-5 exploration dimensions (search pattern + file pattern + finding criteria)
2. For each dimension, perform semantic search and pattern search, collecting code snippets
3. Iterative exploration (up to 3 rounds): identify issues -> refine search -> final sweep
4. Deduplicate and create Issue records

**Use Cases**: Investigate specific module problems, targeted security audits, dependency analysis before refactoring, systematic investigation of user-reported issues.

**When no Prompt is specified**, the system prompts selection from preset directions: Error handling gaps / API contract violations / Test coverage gaps / Custom.

---

### Artifact Paths

Each discovery session creates artifacts under `.workflow/issues/discoveries/{SESSION_ID}/` (Session ID format: `DBP-YYYYMMDD-HHmmss`):

| File | Description |
|------|-------------|
| `discovery-state.json` | Session metadata and progress tracking |
| `discovery-issues.jsonl` | Issues created in this session |
| `{PERSPECTIVE}-findings.json` | Raw findings per perspective (full scan) |
| `exploration-plan.json` | Exploration dimension definitions (by-prompt) |
| `{dimension}-context.md` | Code context collected per dimension |
| `exploration-log.md` | Round-by-round exploration log |

---

### How Discovery Results Become Issues

1. Severity mapped to priority: `critical->1`, `high->2`, `medium->3`, `low->4`
2. Issue ID generated (`ISS-YYYYMMDD-NNN`), scanning to avoid conflicts
3. Complete Issue record constructed (including `context.location`, `fix_direction`, `tags`)
4. Written to both `issues.jsonl` (global) and `discovery-issues.jsonl` (session record)
5. Initial status `registered`, source `discovery`

---

## 3. maestro-manage issue in Detail

`/maestro-manage issue` manages the full Issue lifecycle with 6 subcommands.

### Basic Usage

```bash
/maestro-manage issue create --title "Memory leak" --severity high
/maestro-manage issue list --severity critical --status open
/maestro-manage issue status ISS-20260513-001
/maestro-manage issue update ISS-20260513-001 --status in_progress --priority 1
/maestro-manage issue close ISS-20260513-001 --resolution "Fixed memory leak"
/maestro-manage issue link ISS-20260513-001 --task TASK-003
```

---

### Subcommand Details

<details>
<summary>create -- Create an Issue</summary>

```bash
/maestro-manage issue create --title "Title" [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--title TEXT` | Title (**required**) | Interactive prompt |
| `--severity VALUE` | critical / high / medium / low | `medium` |
| `--source VALUE` | planned / supplement / bug / review / verification / discovery / manual | `manual` |
| `--phase VALUE` | Phase reference | -- |
| `--milestone VALUE` | Milestone reference (auto-derived from `state.json`) | -- |
| `--description TEXT` | Detailed description | Interactive prompt |
| `--priority NUMBER` | 1-5, lower is higher priority | `3` |
| `--tags TAG1,TAG2` | Tag list | -- |

After creation, the system auto-generates an ID (`ISS-YYYYMMDD-NNN`), prompts for additional context, and checks for cross-Milestone conflicts on `supplement` type Issues.

</details>

<details>
<summary>list -- List Issues</summary>

| Option | Description |
|--------|-------------|
| `--status VALUE` | open / in_progress / completed / failed / deferred |
| `--phase VALUE` | Filter by Phase |
| `--milestone VALUE` | Filter by Milestone |
| `--severity VALUE` | Filter by severity |
| `--source VALUE` | Filter by source |
| `--all` | Include closed (read from `issue-history.jsonl`) |

Output is sorted by priority ascending, severity descending.

</details>

<details>
<summary>status / update / close / link</summary>

**status** displays full Issue details (title, status, severity, description, fix direction, context, tags, history, feedback):

```bash
/maestro-manage issue status ISS-20260513-001
```

**update** modifies fields; status changes are automatically recorded in `issue_history`:

```bash
/maestro-manage issue update ISS-20260513-001 --status in_progress --priority 1 --add-tag urgent
# Options: --severity, --tags, --phase, --milestone, --fix-direction, --description, --note
```

**close** resolves and moves to history list:

```bash
/maestro-manage issue close ISS-20260513-001 --resolution "Fix description" [--status completed|failed|deferred]
```

**link** creates a bidirectional link (Issue `affected_components` <-> Task `issue_refs`):

```bash
/maestro-manage issue link ISS-20260513-001 --task TASK-003
```

</details>

---

### issues.jsonl Format

All Issues are stored in JSONL. Key fields:

```json
{
  "id": "ISS-20260513-001",
  "title": "Refresh token not rotating correctly",
  "status": "registered",
  "priority": 1,
  "severity": "critical",
  "source": "discovery",
  "phase_ref": "01-auth",
  "milestone_ref": "MVP",
  "description": "...",
  "fix_direction": "Use database locks to ensure atomic rotation",
  "context": { "location": "src/auth/token.ts:45", "suggested_fix": "..." },
  "tags": ["SECURITY", "auth"],
  "affected_components": ["src/auth/token.ts"],
  "issue_history": [{ "from_status": null, "to_status": "registered", "note": "Issue created" }]
}
```

| Storage Location | Description |
|-----------------|-------------|
| `.workflow/issues/issues.jsonl` | Active Issues |
| `.workflow/issues/issue-history.jsonl` | Closed (archived) |

---

### Status Transitions

```
registered -> open -> in_progress -> completed
                                -> failed
                                -> deferred
```

| Status | Description | Trigger |
|--------|-------------|---------|
| `registered` | Initial (created by discover) | Auto-discovery |
| `open` | Confirmed, pending action | Manual creation/confirmation |
| `in_progress` | Being worked on | Remediation started |
| `completed` | Resolved | Fix verified |
| `failed` | Remediation failed | Fix unsuccessful |
| `deferred` | Postponed | Low priority or dependencies not ready |

---

## 4. Issue Closure Workflow

### Standard Process

```
discover -> list -> analyze -> plan -> execute -> verify -> close
```

```bash
# 1. Discover
/maestro-manage issue discover multi-perspective

# 2. Review results
/maestro-manage issue list --severity critical
/maestro-manage issue status ISS-20260513-001

# 3. Root cause analysis (--gaps injects Issue into Phase pipeline)
/maestro-ralph --engine swarm --script wf-analyze --gaps ISS-20260513-001

# 4. Solution planning
/maestro-ralph --gaps

# 5. Execute fix
/maestro-ralph continue

# 6. Close
/maestro-manage issue close ISS-20260513-001 --resolution "Fix description"
```

### Shortcut Path

For urgent/simple issues, use `maestro-next` to skip intermediate steps:

```bash
/maestro-next "Fix token rotation race condition"
/maestro-manage issue close ISS-20260513-001 --resolution "Fixed via maestro-next"
```

### Integration with Roadmap/Milestone

- **Milestone association**: `--milestone` specifies ownership (auto-derived from `state.json` when unspecified); `supplement` type auto-checks cross-Milestone conflicts
- **Phase association**: `--phase` links to Phase; `--gaps` converts to Gap for analysis flow; `link` bidirectionally links Issue and Task
- **Roadmap feedback**: Issue statistics (count, severity distribution, fix rate) inform planning; high-density Issue Phases may need splitting; `supplement` can serve as next Milestone requirements

The Commander Agent automatically identifies unanalyzed Issues and advances processing. Combined with Hook automation, a fully automated closure workflow can be achieved.
