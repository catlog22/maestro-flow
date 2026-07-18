---
title: "MCP Tools Reference"
---

The Maestro MCP server exposes 9 tools for AI agents (Claude Code, Codex, etc.) to call directly within a session. All tools are registered via the stdio transport protocol and require no additional configuration.

> **Filtering**: Control which tools are visible via the `MAESTRO_ENABLED_TOOLS` environment variable or `config.mcp.enabledTools`. Default: `['all']`.

---

## Table of Contents

- [Overview](#overview)
- [File Operations](#file-operations)
- [Team Collaboration](#team-collaboration)
- [Persistent Memory](#persistent-memory)

---

## Overview

| Tool | Category | Purpose |
|------|----------|---------|
| `edit_file` | File Ops | Text replacement or line-level editing with dryRun preview |
| `write_file` | File Ops | Create/overwrite files with auto-mkdir |
| `read_file` | File Ops | Single file reading with line-based pagination |
| `read_many_files` | File Ops | Batch read / directory traversal / content search |
| `team_msg` | Team | Persistent JSONL message bus |
| `team_mailbox` | Team | Mailbox-style message delivery with tracking |
| `team_task` | Team | Task CRUD with state machine management |
| `team_agent` | Team | Agent lifecycle management (spawn/shutdown) |
| `store_knowhow` | Memory | Knowhow knowledge entry storage (6 types) |

---

## File Operations

### edit_file

Two edit modes: **update** (text replacement) and **line** (position-driven operations). Supports dryRun preview, multi-edit batches, fuzzy matching, and CRLF/LF adaptation.

**Common params**: `path` (string, required), `mode` (update|line, default update), `dryRun` (boolean, default false)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `oldText` | string | update* | Text to find |
| `newText` | string | update* | Replacement text |
| `edits` | `{oldText, newText}[]` | update* | Batch replacements (use instead of oldText/newText) |
| `replaceAll` | boolean | No | Replace all occurrences (default: first only) |
| `operation` | insert_before/insert_after/replace/delete | line | Line operation type |
| `line` | number | line | Line number (1-based) |
| `end_line` | number | No | End line for range operations |
| `text` | string | No | Content for insert/replace |

<details>
<summary>Examples</summary>

```jsonc
{ "path": "src/app.ts", "oldText": "hello", "newText": "world" }
{ "path": "src/app.ts", "edits": [{"oldText": "foo", "newText": "bar"}] }
{ "path": "src/app.ts", "mode": "line", "operation": "insert_after", "line": 10, "text": "// added" }
{ "path": "src/app.ts", "oldText": "old", "newText": "new", "dryRun": true }
```

</details>

---

### write_file

Create or overwrite files with auto-created parent directories. Supports optional backup and multiple encodings.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | -- | File path |
| `content` | string | Yes | -- | Content to write |
| `createDirectories` | boolean | No | `true` | Auto-create parent directories |
| `backup` | boolean | No | `false` | Create timestamped backup before overwrite |
| `encoding` | utf8/ascii/latin1/binary/hex/base64 | No | `utf8` | File encoding |

<details>
<summary>Examples</summary>

```jsonc
{ "path": "src/new-module.ts", "content": "export const hello = 'world';" }
{ "path": "config.json", "content": "{\"key\": \"value\"}", "backup": true }
```

</details>

---

### read_file / read_many_files

| Parameter | read_file | read_many_files | Description |
|-----------|-----------|-----------------|-------------|
| `paths` | string (required) | string/string[] (required) | File path or directory |
| `offset` | number (0-based) | -- | Line offset |
| `limit` | number | -- | Lines to read |
| `pattern` | -- | string | Glob filter |
| `contentPattern` | -- | string | Regex content search |
| `maxDepth` | -- | number (default 3) | Directory traversal depth |
| `includeContent` | -- | boolean (default true) | Include file content |
| `maxFiles` | -- | number (default 50) | Max files to return |

<details>
<summary>Examples</summary>

```jsonc
// read_file
{ "path": "README.md" }
{ "path": "src/large-file.ts", "offset": 99, "limit": 50 }

// read_many_files
{ "paths": ["src/a.ts", "src/b.ts"] }
{ "paths": "src/", "pattern": "*.ts" }
{ "paths": "src/", "contentPattern": "TODO|FIXME" }
{ "paths": "src/", "includeContent": false }
```

</details>

---

## Team Collaboration

### team_msg

Persistent JSONL message bus. **Storage**: `.workflow/.team/{session-id}/.msg/messages.jsonl`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | see table below | Yes | -- | Operation type |
| `session_id` | string | Yes | -- | Session ID |
| `from` | string | log/broadcast | -- | Sender role |
| `to` | string | No | `"coordinator"` | Recipient role |
| `summary` | string | No | auto-generated | One-line summary |
| `data` | object | No | -- | Structured data |
| `id` | string | read/delete | -- | Message ID |
| `last` | number | No | `20` | Last N messages (max 100) |
| `role` | string | get_state/read_mailbox | -- | Role name |

| Operation | Description | Operation | Description |
|-----------|-------------|-----------|-------------|
| `log` | Append message | `broadcast` | Send to all members |
| `read` | Read by ID | `list` | List recent messages |
| `status` | Summarize per-role | `get_state` | Read role meta.json |
| `read_mailbox` | Read unread, mark delivered | `mailbox_status` | Delivery status counts |
| `delete` | Delete message | `clear` | Clear all messages |

<details>
<summary>Examples</summary>

```jsonc
{ "operation": "log", "session_id": "TLS-proj-2026-04-21", "from": "planner", "to": "implementer", "summary": "plan ready" }
{ "operation": "read_mailbox", "session_id": "TLS-proj-2026-04-21", "role": "implementer" }
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

### team_mailbox

Mailbox-style point-to-point messaging with broker injection. **Storage**: `.workflow/.team/{session-id}/.msg/mailbox.jsonl`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | send/read/status | Yes | -- | Operation type |
| `session_id` | string | Yes | -- | Session ID |
| `from` / `to` | string | send | -- | Sender / recipient role |
| `message` | string | send | -- | Message content |
| `delivery_method` | inject/poll/broadcast | No | `inject` | Delivery method |
| `role` | string | read | -- | Role to read mailbox for |
| `limit` | number | No | `50` | Max messages (1-100) |
| `mark_delivered` | boolean | No | `true` | Mark returned as delivered |

<details>
<summary>Examples</summary>

```jsonc
{ "operation": "send", "session_id": "TLS-proj-2026-04-21", "from": "coordinator", "to": "worker-1", "message": "start task A" }
{ "operation": "read", "session_id": "TLS-proj-2026-04-21", "role": "worker-1" }
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

### team_task

Team task CRUD with state machine validation. **Storage**: `.workflow/.team/{session_id}/tasks/{id}.json`

**State transitions**: `open -> assigned -> in_progress -> pending_review -> done -> closed` (closed can reopen)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | create/update/list/get | Yes | -- | Operation type |
| `session_id` | string | Yes | -- | Session ID |
| `title` | string | create | -- | Task title |
| `description` / `owner` | string | No | `"agent"` | Description / assignee |
| `priority` | low/medium/high/critical | No | `medium` | Priority |
| `task_id` | string | update/get | -- | Task ID |
| `status` | open/assigned/in_progress/pending_review/done/closed | No | -- | Task status |

<details>
<summary>Examples</summary>

```jsonc
{ "operation": "create", "session_id": "TLS-proj-2026-04-21", "title": "Implement auth", "priority": "high" }
{ "operation": "update", "session_id": "TLS-proj-2026-04-21", "task_id": "ATASK-001", "status": "in_progress" }
{ "operation": "list", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

### team_agent

Agent lifecycle management. **Storage**: `.workflow/.team/{session_id}/members.json`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | spawn_agent/shutdown_agent/remove_agent/members | Yes | -- | Operation type |
| `session_id` | string | Yes | -- | Session ID |
| `role` | string | spawn/shutdown/remove | -- | Agent role name |
| `prompt` | string | spawn | -- | Agent instructions |
| `tool` | string | No | `"gemini"` | CLI tool to use |

<details>
<summary>Examples</summary>

```jsonc
{ "operation": "spawn_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher", "prompt": "Analyze auth patterns", "tool": "gemini" }
{ "operation": "shutdown_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher" }
{ "operation": "members", "session_id": "TLS-proj-2026-04-21" }
```

</details>

---

## Persistent Memory

### store_knowhow

Project-level knowledge reuse in `.workflow/knowhow/`. 6 types: session(KNW-), tip(TIP-), template(TPL-), recipe(RCP-), reference(REF-), decision(DCS-). WikiIndexer auto-indexes as `type=knowhow`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | add/search | Yes | Operation type |
| `type` | string | add | session/tip/template/recipe/reference/decision |
| `title` / `body` | string | add | Title / body (markdown) |
| `tags` | string[] | No | Categorization tags |
| `lang` | string | No | [template] Programming language |
| `source` | string | No | [reference] Original URL |
| `status` | string | No | [decision] proposed/accepted/superseded |
| `query` | string | search | Search keywords |
| `limit` | number | No | Max results (default: 20) |

<details>
<summary>Examples</summary>

```jsonc
{ "operation": "add", "type": "template", "title": "React Hook Form",
  "body": "import { useForm } from 'react-hook-form'; ...",
  "lang": "typescript", "tags": ["react", "form"] }
{ "operation": "add", "type": "decision", "title": "Use PostgreSQL",
  "body": "ADR: PostgreSQL as primary database...",
  "status": "accepted", "tags": ["database", "architecture"] }
{ "operation": "search", "query": "authentication middleware" }
```

</details>

---

## Architecture

```
MCP Server (stdio) -> ToolRegistry
  +-- edit_file / write_file / read_file / read_many_files  (File Ops)
  +-- team_msg / team_mailbox / team_task / team_agent      (Team)
  +-- store_knowhow                                         (Memory)
```

**Adapter**: Zod schema validation -> `{success, result, error}` -> `ccwResultToMcp()` -> MCP `{content, isError}`
