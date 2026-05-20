# Session Schema

Required session structure for team-executor v2. All components MUST exist for valid execution. Updated for role-spec architecture (lightweight Phase 2-4 files instead of full role.md files).

## Directory Structure

```
<session-folder>/
+-- team-session.json           # Session state + dynamic role registry (REQUIRED)
+-- task-analysis.json          # Task analysis output: capabilities, dependency graph (REQUIRED)
+-- role-specs/                 # Dynamic role-spec definitions (REQUIRED, >= 1 .md file)
|   +-- <role-1>.md             # Lightweight: YAML frontmatter + Phase 2-4 only
|   +-- <role-2>.md
+-- artifacts/                  # All MD deliverables from workers
|   +-- <artifact>.md
+-- .msg/                       # Team message bus + state
|   +-- messages.jsonl          # Message log
|   +-- meta.json               # Session metadata + cross-role state
+-- wisdom/                     # Cross-task knowledge
|   +-- learnings.md
|   +-- decisions.md
|   +-- issues.md
+-- explorations/               # Shared explore cache
|   +-- cache-index.json
|   +-- explore-<angle>.json
+-- discussions/                # Inline discuss records
|   +-- <round>.md
```

## Validation Checklist

team-executor validates the following before execution:

### Required Components

| Component | Validation | Error Message |
|-----------|------------|---------------|
| `--session` argument | Must be provided | "Session required. Usage: --session=<path-to-TC-folder>" |
| Directory | Must exist at path | "Session directory not found: <path>" |
| `team-session.json` | Must exist, parse as JSON, and contain all required fields | "Invalid session: team-session.json missing, corrupt, or missing required fields" |
| `task-analysis.json` | Must exist, parse as JSON, and contain all required fields | "Invalid session: task-analysis.json missing, corrupt, or missing required fields" |
| `role-specs/` directory | Must exist and contain >= 1 .md file | "Invalid session: no role-spec files in role-specs/" |
| Role-spec file mapping | Each role in team-session.json#roles must have .md file | "Role-spec file not found: role-specs/<role>.md" |
| Role-spec structure | Each role-spec must have YAML frontmatter + Phase 2-4 sections | "Invalid role-spec: role-specs/<role>.md missing required section" |

### Validation Algorithm

```
1. Parse --session=<path> from arguments
   +- Not provided -> ERROR: "Session required. Usage: --session=<path-to-TC-folder>"

2. Check directory exists
   +- Not exists -> ERROR: "Session directory not found: <path>"

3. Check team-session.json
   +- Not exists -> ERROR: "Invalid session: team-session.json missing"
   +- Parse error -> ERROR: "Invalid session: team-session.json corrupt"
   +- Validate required fields:
       +- session_id (string) -> missing -> ERROR
       +- task_description (string) -> missing -> ERROR
       +- status (string: active|paused|completed) -> invalid -> ERROR
       +- team_name (string) -> missing -> ERROR
       +- roles (array, non-empty) -> missing/empty -> ERROR

4. Check task-analysis.json
   +- Not exists -> ERROR: "Invalid session: task-analysis.json missing"
   +- Parse error -> ERROR: "Invalid session: task-analysis.json corrupt"
   +- Validate required fields:
       +- capabilities (array) -> missing -> ERROR
       +- dependency_graph (object) -> missing -> ERROR
       +- roles (array, non-empty) -> missing/empty -> ERROR

5. Check role-specs/ directory
   +- Not exists -> ERROR: "Invalid session: role-specs/ directory missing"
   +- No .md files -> ERROR: "Invalid session: no role-spec files in role-specs/"

6. Check role-spec file mapping and structure
   +- For each role in team-session.json#roles:
       +- Check role-specs/<role.name>.md exists
           +- Not exists -> ERROR: "Role-spec file not found: role-specs/<role.name>.md"
       +- Validate role-spec structure (see Role-Spec Structure Validation)

7. All checks pass -> proceed to Phase 0
```

---

## team-session.json Schema

```json
{
  "session_id": "TC-<slug>-<date>",
  "task_description": "<original user input>",
  "status": "active | paused | completed",
  "team_name": "<team-name>",
  "roles": [
    {
      "name": "<role-name>",
      "prefix": "<PREFIX>",
      "responsibility_type": "<type>",
      "inner_loop": false,
      "role_spec": "role-specs/<role-name>.md"
    }
  ],
  "pipeline": {
    "dependency_graph": {},
    "tasks_total": 0,
    "tasks_completed": 0
  },
  "active_workers": [],
  "completed_tasks": [],
  "completion_action": "interactive",
  "created_at": "<timestamp>"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Unique session identifier |
| `task_description` | string | Original task description from user |
| `status` | string | One of: "active", "paused", "completed" |
| `team_name` | string | Team name for Agent tool |
| `roles` | array | List of role definitions |
| `roles[].name` | string | Role name (must match .md filename) |
| `roles[].prefix` | string | Task prefix for this role |
| `roles[].role_spec` | string | Relative path to role-spec file |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `pipeline` | object | Pipeline metadata |
| `active_workers` | array | Currently running workers |
| `completed_tasks` | array | List of completed task IDs |
| `completion_action` | string | Completion mode: interactive, auto_archive, auto_keep |
| `created_at` | string | ISO timestamp |

---

## task-analysis.json Schema

```json
{
  "capabilities": [
    {
      "name": "<capability-name>",
      "description": "<description>",
      "artifact_type": "<type>"
    }
  ],
  "dependency_graph": {
    "<task-id>": {
      "depends_on": ["<dependency-task-id>"],
      "role": "<role-name>"
    }
  },
  "roles": [
    {
      "name": "<role-name>",
      "prefix": "<PREFIX>",
      "responsibility_type": "<type>",
      "inner_loop": false,
      "role_spec_metadata": {
        "additional_members": [],
        "message_types": {
          "success": "<prefix>_complete",
          "error": "error"
        }
      }
    }
  ],
  "complexity_score": 0
}
```

---

## Role-Spec File Schema

Each role-spec in `role-specs/<role-name>.md` follows the lightweight format with YAML frontmatter + Phase 2-4 body.

### Required Structure

```markdown
---
role: <name>
prefix: <PREFIX>
inner_loop: <true|false>
message_types:
  success: <type>
  error: error
---

# <Role Name> — Phase 2-4

## Phase 2: <Name>
<domain-specific context loading>

## Phase 3: <Name>
<domain-specific execution>

## Phase 4: <Name>
<domain-specific validation>
```

### Role-Spec Structure Validation

```
For each role-spec in role-specs/<role>.md:
  1. Read file content
  2. Check for YAML frontmatter (content between --- markers)
     +- Not found -> ERROR: "Invalid role-spec: role-specs/<role>.md missing frontmatter"
  3. Parse frontmatter, check required fields:
     +- role (string) -> missing -> ERROR
     +- prefix (string) -> missing -> ERROR
     +- inner_loop (boolean) -> missing -> ERROR
     +- message_types (object) -> missing -> ERROR
  4. Check for "## Phase 2" section
     +- Not found -> ERROR: "Invalid role-spec: missing Phase 2"
  5. Check for "## Phase 3" section
     +- Not found -> ERROR: "Invalid role-spec: missing Phase 3"
  6. Check for "## Phase 4" section
     +- Not found -> ERROR: "Invalid role-spec: missing Phase 4"
  7. All checks pass -> role-spec valid
```

---

## Example Valid Session

```
.workflow/.team/TC-auth-feature-2026-02-27/
+-- team-session.json           # Valid JSON with session metadata
+-- task-analysis.json          # Valid JSON with dependency graph
+-- role-specs/
|   +-- researcher.md           # YAML frontmatter + Phase 2-4
|   +-- developer.md            # YAML frontmatter + Phase 2-4
|   +-- tester.md               # YAML frontmatter + Phase 2-4
+-- artifacts/                  # (may be empty)
+-- .msg/                       # Team message bus + state (messages.jsonl + meta.json)
+-- wisdom/
|   +-- learnings.md
|   +-- decisions.md
|   +-- issues.md
+-- explorations/
|   +-- cache-index.json
+-- discussions/                # (may be empty)
```

---

## Recovery from Invalid Sessions

If session validation fails:

1. **Missing team-session.json**: Re-run team-coordinate with original task
2. **Missing task-analysis.json**: Re-run team-coordinate with resume
3. **Missing role-spec files**: Re-run team-coordinate with resume
4. **Invalid frontmatter**: Manual fix or re-run team-coordinate
5. **Corrupt JSON**: Manual inspection or re-run team-coordinate

**team-executor cannot fix invalid sessions** -- it can only report errors and suggest recovery steps.
