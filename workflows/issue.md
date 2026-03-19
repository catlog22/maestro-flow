# Workflow: Issue Management

CRUD operations and lifecycle management for project issues.

## Input

- `$ARGUMENTS`: subcommand + options
- Operates on `.workflow/issues/`

---

### Step 1: Parse Subcommand

```
1. Extract first token from $ARGUMENTS as SUBCOMMAND
2. If empty → error E_NO_SUBCOMMAND, display usage:
     /manage-issue <create|list|status|update|close|link> [options]
3. Validate SUBCOMMAND is one of: create, list, status, update, close, link
   If not → error E_INVALID_SUBCOMMAND
4. Remaining tokens are ARGS (subcommand-specific options)
```

---

### Step 2: Validate Issues Directory

```
1. Check .workflow/ exists
   If not → fatal: "No project initialized. Run /maestro-init first."

2. Check .workflow/issues/ exists
   If not → create directory:
     mkdir -p .workflow/issues/

3. Check .workflow/issues/issues.jsonl exists
   If not → create empty file:
     touch .workflow/issues/issues.jsonl

4. Check .workflow/issues/issue-history.jsonl exists
   If not → create empty file:
     touch .workflow/issues/issue-history.jsonl
```

---

### Step 3: Route to Subcommand Handler

```
Route based on SUBCOMMAND:
  create  → Step 4
  list    → Step 5
  status  → Step 6
  update  → Step 7
  close   → Step 8
  link    → Step 9
```

---

### Step 4: Create Issue

Parse options from ARGS:

```
Options:
  --title TEXT        Issue title (required)
  --severity VALUE    critical|high|medium|low (default: medium)
  --source VALUE      verification|antipattern|discuss|discovery|manual (default: manual)
  --phase VALUE       Phase reference, e.g. "01-auth" (optional)
  --description TEXT  Detailed description (optional, prompted if missing)
  --priority NUMBER   1-5, lower is higher priority (default: 3)
  --tags TAG1,TAG2    Comma-separated tags (optional)

If --title is missing:
  AskUserQuestion({ question: "What is the issue title?" })
```

Generate issue ID:

```
1. Get current date as YYYYMMDD
2. Read issues.jsonl + issue-history.jsonl
3. Find all IDs matching ISS-{YYYYMMDD}-NNN
4. Extract max NNN value (or 0 if none found today)
5. New NNN = max + 1, zero-padded to 3 digits
6. ID = ISS-{YYYYMMDD}-{NNN}
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
1. Serialize record as single JSON line (no pretty-print)
2. Append to .workflow/issues/issues.jsonl
3. Display confirmation:

   Created: {ID}
   Title:   {TITLE}
   Status:  open
   Severity: {SEVERITY}

4. Suggest next steps:
   - Skill({ skill: "manage-issue", args: "status {ID}" }) -- View full details
   - Skill({ skill: "manage-issue", args: "link {ID} --task TASK-NNN" }) -- Link to a task
   - Skill({ skill: "manage-issue", args: "list" }) -- List all issues
```

---

### Step 5: List Issues

Parse filter options from ARGS:

```
Options:
  --status VALUE    Filter by status (open|in_progress|completed|failed|deferred)
  --phase VALUE     Filter by phase_ref
  --severity VALUE  Filter by severity (critical|high|medium|low)
  --source VALUE    Filter by source
  --all             Include closed issues from issue-history.jsonl
```

Read and filter:

```
1. Read .workflow/issues/issues.jsonl line by line
2. If --all: also read .workflow/issues/issue-history.jsonl
3. Parse each line as JSON
4. Apply filters:
   - If --status: match record.status == VALUE
   - If --phase: match record.phase_ref contains VALUE
   - If --severity: match record.severity == VALUE
   - If --source: match record.source == VALUE
5. Sort by priority (ascending), then severity order (critical > high > medium > low)
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
1. Extract issue ID (ISS-XXXXXXXX-NNN) from ARGS
   If missing → prompt: "Which issue? Provide ISS-XXXXXXXX-NNN"
2. Search issues.jsonl for matching ID
3. If not found → search issue-history.jsonl
4. If still not found → error: "Issue {ID} not found"
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
If status == "open":
  - Skill({ skill: "manage-issue", args: "update {id} --status in_progress" }) -- Start working on it
  - Skill({ skill: "manage-issue", args: "link {id} --task TASK-NNN" }) -- Link to a task

If status == "in_progress":
  - Skill({ skill: "manage-issue", args: "close {id} --resolution \"...\"" }) -- Close with resolution
  - Skill({ skill: "manage-issue", args: "update {id} --status deferred" }) -- Defer to later

If status in (completed, failed, deferred):
  - "This issue is archived."
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
  --fix-direction TEXT    Set fix_direction
  --description TEXT      Update description
  --note TEXT             Add feedback entry (type=clarification)
```

Process update:

```
1. Read issues.jsonl, find record matching ID
   If not found → error: "Issue {ID} not found in active issues"

2. For each provided option:
   - Update the corresponding field in the record
   - If --status changed: add issue_history entry:
     {
       "timestamp": "{NOW_ISO}",
       "from_status": "{old_status}",
       "to_status": "{new_status}",
       "actor": "user",
       "note": "Status updated"
     }
   - If --note provided: add feedback entry:
     {
       "timestamp": "{NOW_ISO}",
       "type": "clarification",
       "content": "{NOTE_TEXT}"
     }

3. Set updated_at = NOW_ISO

4. Rewrite issues.jsonl:
   - Read all lines
   - Replace the matching line with updated record
   - Write all lines back

5. Display confirmation:
   Updated: {ID}
   Changed: {list of changed fields}
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
1. Read issues.jsonl, find record matching ID
   If not found → error: "Issue {ID} not found in active issues"

2. If --resolution missing:
   AskUserQuestion({ question: "What is the resolution for {ID}?" })

3. Update record:
   - status = {STATUS or "completed"}
   - resolved_at = NOW_ISO
   - updated_at = NOW_ISO
   - resolution = {RESOLUTION_TEXT}
   - Add issue_history entry:
     {
       "timestamp": "{NOW_ISO}",
       "from_status": "{old_status}",
       "to_status": "{new_status}",
       "actor": "user",
       "note": "Issue closed: {RESOLUTION_TEXT}"
     }

4. Move record from issues.jsonl to issue-history.jsonl:
   - Read all lines from issues.jsonl
   - Remove the matching line, write remaining lines back
   - Append closed record as new line to issue-history.jsonl

5. Display confirmation:
   Closed: {ID}
   Status: {new_status}
   Resolution: {RESOLUTION_TEXT}
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
1. Read issues.jsonl, find record matching issue ID
   If not found → error: "Issue {ID} not found"

2. Locate task file:
   - Search .workflow/phases/*/.task/{TASK_ID}.json
   - If not found → search .workflow/scratch/*/.task/{TASK_ID}.json
   - If still not found → error: "Task {TASK_ID} not found"

3. Update issue record:
   - If gap_ref is null: set gap_ref = TASK_ID
   - Add TASK_ID to affected_components if not present
   - Add issue_history entry:
     {
       "timestamp": "{NOW_ISO}",
       "from_status": "{status}",
       "to_status": "{status}",
       "actor": "user",
       "note": "Linked to task {TASK_ID}"
     }
   - Set updated_at = NOW_ISO
   - Rewrite issues.jsonl with updated record

4. Update task JSON:
   - Read task file
   - Add or update "issue_refs" field: append issue ID if not present
   - Write task file back

5. Display confirmation:
   Linked: {ISSUE_ID} <-> {TASK_ID}
   Issue: {issue.title}
   Task:  {task file path}

6. Suggest next steps:
   - Skill({ skill: "manage-issue", args: "status {ISSUE_ID}" }) -- View updated issue
   - Skill({ skill: "manage-issue", args: "update {ISSUE_ID} --status in_progress" }) -- Start working
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
