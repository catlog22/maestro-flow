# Workflow: Issue Management

CRUD operations and lifecycle management for project issues.

## Input

- `$ARGUMENTS`: subcommand + options
- Operates on `.workflow/issues/`

---

### Step 1: Parse Subcommand

```
Extract SUBCOMMAND (first token) and ARGS (remaining) from $ARGUMENTS.
Valid: create | list | status | update | close | link
Missing/invalid → error with usage: /manage-issue <create|list|status|update|close|link> [options]
```

---

### Step 2: Validate Issues Directory

```
Require .workflow/ exists → fatal if missing: "No project initialized. Run /maestro-init first."
Auto-create if missing: .workflow/issues/, issues.jsonl, issue-history.jsonl
```

---

### Step 3: Route to Subcommand Handler

```
Route: create→Step 4, list→Step 5, status→Step 6, update→Step 7, close→Step 8, link→Step 9
```

---

### Step 4: Create Issue

Parse options from ARGS:

```
Options:
  --title TEXT        Issue title (required)
  --severity VALUE    critical|high|medium|low (default: medium)
  --source VALUE      planned|supplement|bug|review|verification|discovery|manual (default: manual)
  --phase VALUE       Phase reference, e.g. "01-auth" (optional)
  --milestone VALUE   Milestone reference, e.g. "MVP" (optional, auto-derived from state.json if omitted)
  --description TEXT  Detailed description (optional, prompted if missing)
  --priority NUMBER   1-5, lower is higher priority (default: 3)
  --tags TAG1,TAG2    Comma-separated tags (optional)

If --title is missing:
  AskUserQuestion({ question: "What is the issue title?" })

Derive milestone_ref if not provided:
  IF --milestone not provided AND file_exists(".workflow/state.json"):
    milestone_ref = state.json.current_milestone
  ELSE:
    milestone_ref = --milestone value or null
```

Generate issue ID:

```
ID = ISS-{YYYYMMDD}-{NNN} where NNN = next available 3-digit sequence for today
Scan both issues.jsonl and issue-history.jsonl to avoid collisions.
```

Build issue record from template:

```json
{
  "id": "{ID}",
  "title": "{TITLE}",
  "status": "open",
  "priority": {PRIORITY},
  "severity": "{SEVERITY}",
  "source": "{SOURCE}",
  "milestone_ref": "{MILESTONE_REF or null}",
  "phase_ref": "{PHASE_REF or null}",
  "gap_ref": null,
  "description": "{DESCRIPTION}",
  "fix_direction": "",
  "context": {
    "location": "",
    "suggested_fix": "",
    "notes": ""
  },
  "tags": ["{TAGS}"],
  "affected_components": [],
  "feedback": [],
  "issue_history": [
    {
      "timestamp": "{NOW_ISO}",
      "from_status": null,
      "to_status": "open",
      "actor": "user",
      "note": "Issue created"
    }
  ],
  "created_at": "{NOW_ISO}",
  "updated_at": "{NOW_ISO}",
  "resolved_at": null,
  "resolution": null
}
```

Write to storage:

```
Append record as single JSONL line to .workflow/issues/issues.jsonl.
Display confirmation: ID, title, status, severity.
```

Ask for supplementary information:

```
Prompt user for supplementary context (background, repro steps, related issues, notes).
If provided → append supplement entry {content, stage:"post_creation", author:"user", created_at} to issue record.
If empty → skip.
```

Cross-milestone conflict check (for supplement issues):

```
IF source == "supplement" AND milestone_ref set:
  Scan other milestones' plan.json for files_to_create[] that overlap with affected_components.
  If overlap found → warn about cross-milestone conflict, suggest minimal fix vs deferral.
```

Suggest next steps:

```
Suggest: status {ID}, link {ID} --task TASK-NNN, list
```

---

### Step 5: List Issues

Parse filter options from ARGS:

```
Options:
  --status VALUE      Filter by status (open|in_progress|completed|failed|deferred)
  --phase VALUE       Filter by phase_ref
  --milestone VALUE   Filter by milestone_ref
  --severity VALUE    Filter by severity (critical|high|medium|low)
  --source VALUE      Filter by source
  --all               Include closed issues from issue-history.jsonl
```

Read and filter:

```
Read issues.jsonl (+ issue-history.jsonl if --all).
Apply matching filters: status, phase_ref (contains), severity, milestone_ref, source.
Sort by priority (ascending), then severity (critical > high > medium > low).
```

Display tabular output:

```
ISSUES ({count} found):
---------------------------------------------------------------
ID                | Status      | Sev    | Pri | Title
---------------------------------------------------------------
ISS-20260315-001  | open        | high   |  2  | Refresh token rotation
ISS-20260315-002  | in_progress | medium |  3  | Missing input validation
---------------------------------------------------------------

Filters applied: {list of active filters or "none"}
```

If no issues found:

```
No issues found{with applied filters}.

Create one: Skill({ skill: "manage-issue", args: "create --title \"...\"" })
Discover issues: Skill({ skill: "manage-issue-discover" })
```

---

### Step 6: Show Issue Status

Parse issue ID from ARGS:

```
Extract ISS-XXXXXXXX-NNN from ARGS (prompt if missing).
Lookup in issues.jsonl, fallback to issue-history.jsonl → error if not found.
```

Display full detail view:

```
====================================================
  ISSUE: {id}
  TITLE: {title}
  STATUS: {status}    SEVERITY: {severity}    PRIORITY: {priority}
====================================================

SOURCE:     {source}
PHASE:      {phase_ref or "none"}
GAP REF:    {gap_ref or "none"}
CREATED:    {created_at}
UPDATED:    {updated_at}
RESOLVED:   {resolved_at or "pending"}

DESCRIPTION:
  {description}

FIX DIRECTION:
  {fix_direction or "not specified"}

CONTEXT:
  Location:      {context.location or "not specified"}
  Suggested Fix: {context.suggested_fix or "none"}
  Notes:         {context.notes or "none"}

TAGS: {tags joined by ", " or "none"}
AFFECTED: {affected_components joined by ", " or "none"}

HISTORY:
  {for each entry in issue_history}
  [{timestamp}] {from_status} -> {to_status} ({actor}): {note}
  {/for}

FEEDBACK:
  {for each entry in feedback}
  [{timestamp}] ({type}): {content}
  {/for}
  {or "none"}

RESOLUTION:
  {resolution or "not resolved"}
====================================================
```

Suggest next steps based on status:

```
open → suggest: update --status in_progress, link --task
in_progress → suggest: close --resolution, update --status deferred
completed/failed/deferred → "This issue is archived."
```

---

### Step 7: Update Issue

Parse issue ID and field updates from ARGS:

```
Options:
  ISS-XXXXXXXX-NNN       Issue ID (required, first positional arg)
  --status VALUE          New status (open|in_progress)
  --priority NUMBER       New priority (1-5)
  --severity VALUE        New severity (critical|high|medium|low)
  --tags TAG1,TAG2        Replace tags
  --add-tag TAG           Add a tag
  --phase VALUE           Set phase_ref
  --milestone VALUE       Set milestone_ref
  --fix-direction TEXT    Set fix_direction
  --description TEXT      Update description
  --note TEXT             Add feedback entry (type=clarification)
```

Process update:

```
Find record by ID in issues.jsonl → error if not found.
Apply each provided option to the corresponding field.
If --status changed → append issue_history entry {timestamp, from_status, to_status, actor:"user"}.
If --note provided → append feedback entry {timestamp, type:"clarification", content}.
Set updated_at, rewrite issues.jsonl, display changed fields.
```

---

### Step 8: Close Issue

Parse issue ID and resolution from ARGS:

```
Options:
  ISS-XXXXXXXX-NNN     Issue ID (required)
  --resolution TEXT     Resolution description (required)
  --status VALUE       Final status: completed|failed|deferred (default: completed)
```

Process close:

```
Find record by ID in issues.jsonl → error if not found.
Prompt for --resolution if missing.
Set status (default "completed"), resolved_at, resolution; append issue_history entry.
Move record from issues.jsonl → issue-history.jsonl.
Display: ID, final status, resolution.
```

---

### Step 9: Link Issue to Task

Parse issue ID and task reference from ARGS:

```
Options:
  ISS-XXXXXXXX-NNN     Issue ID (required)
  --task TASK-NNN       Task ID to link (required)
```

Process bidirectional link:

```
Find issue by ID in issues.jsonl → error if not found.
Locate task file via artifact registry (.workflow/{path}/.task/{TASK_ID}.json)
  or scratch fallback (.workflow/scratch/*/.task/{TASK_ID}.json) → error if not found.

Update issue: set gap_ref (if null), add TASK_ID to affected_components, append issue_history entry.
Update task: append issue ID to "issue_refs" field.

Display: linked pair, issue title, task path.
Suggest: status {ISSUE_ID}, update --status in_progress.
```

---

## Output

- **Storage**: `.workflow/issues/issues.jsonl` (active), `.workflow/issues/issue-history.jsonl` (closed)
- **Format**: One JSON object per line (JSONL), append-friendly
- **ID scheme**: `ISS-YYYYMMDD-NNN` (NNN auto-incremented per day)

## Quality Criteria

- Issues directory auto-created if missing
- ID generation scans both active and history files to avoid collisions
- Status transitions recorded in issue_history
- Close operation moves records from active to history JSONL
- Link creates bidirectional references (issue -> task and task -> issue)
- List output is filterable and sorted by priority/severity
