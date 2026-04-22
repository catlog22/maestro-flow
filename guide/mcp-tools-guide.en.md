# MCP Tools Reference

The Maestro MCP server exposes 9 tools for AI agents (Claude Code, Codex, etc.) to call directly within a session. All tools are registered via the stdio transport protocol and require no additional configuration.

> **Filtering**: Control which tools are visible via the `MAESTRO_ENABLED_TOOLS` environment variable or `config.mcp.enabledTools`. Default: `['all']`.

---

## Table of Contents

- [Overview](#overview)
- [File Operations](#file-operations)
  - [edit_file](#edit_file)
  - [write_file](#write_file)
  - [read_file](#read_file)
  - [read_many_files](#read_many_files)
- [Team Collaboration](#team-collaboration)
  - [team_msg](#team_msg)
  - [team_mailbox](#team_mailbox)
  - [team_task](#team_task)
  - [team_agent](#team_agent)
- [Persistent Memory](#persistent-memory)
  - [core_memory](#core_memory)
- [CLI Terminal Commands](#cli-terminal-commands)

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
| `core_memory` | Memory | Cross-session JSON memory storage |

---

## File Operations

### edit_file

Two edit modes: **update** (text replacement) and **line** (position-driven operations). Supports dryRun preview, multi-edit batches, fuzzy matching, and auto line-ending adaptation (CRLF/LF).

#### edit_file Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | — | Target file path |
| `mode` | `"update"` \| `"line"` | No | `"update"` | Edit mode |
| `dryRun` | boolean | No | `false` | Preview diff without modifying file |

**Update mode parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `oldText` | string | Yes* | Text to find |
| `newText` | string | Yes* | Replacement text |
| `edits` | `{oldText, newText}[]` | Yes* | Batch replacements (use instead of oldText/newText) |
| `replaceAll` | boolean | No | Replace all occurrences (default: first only) |

**Line mode parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | `"insert_before"` \| `"insert_after"` \| `"replace"` \| `"delete"` | Yes | Line operation type |
| `line` | number | Yes | Line number (1-based) |
| `end_line` | number | No | End line for range operations |
| `text` | string | No | Content for insert/replace |

#### edit_file Examples

```jsonc
// Text replacement
{ "path": "src/app.ts", "oldText": "hello", "newText": "world" }

// Batch replacement
{ "path": "src/app.ts", "edits": [{"oldText": "foo", "newText": "bar"}, {"oldText": "baz", "newText": "qux"}] }

// Line insertion
{ "path": "src/app.ts", "mode": "line", "operation": "insert_after", "line": 10, "text": "// added" }

// Preview changes
{ "path": "src/app.ts", "oldText": "old", "newText": "new", "dryRun": true }
```

---

### write_file

Create or overwrite files with auto-created parent directories. Supports optional backup and multiple encodings.

#### write_file Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | — | File path |
| `content` | string | Yes | — | Content to write |
| `createDirectories` | boolean | No | `true` | Auto-create parent directories |
| `backup` | boolean | No | `false` | Create timestamped backup before overwrite |
| `encoding` | `"utf8"` \| `"utf-8"` \| `"ascii"` \| `"latin1"` \| `"binary"` \| `"hex"` \| `"base64"` | No | `"utf8"` | File encoding |

#### write_file Examples

```jsonc
// Create file
{ "path": "src/new-module.ts", "content": "export const hello = 'world';" }

// Overwrite with backup
{ "path": "config.json", "content": "{\"key\": \"value\"}", "backup": true }
```

---

### read_file

Read a single file with optional line-based pagination. Useful for large files.

#### read_file Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | — | File path |
| `offset` | number | No | — | Line offset (0-based) |
| `limit` | number | No | — | Number of lines to read |

#### read_file Examples

```jsonc
// Read entire file
{ "path": "README.md" }

// Paginated read (lines 100-149)
{ "path": "src/large-file.ts", "offset": 99, "limit": 50 }
```

---

### read_many_files

Batch file reading, directory traversal, and content regex search. Supports glob pattern filtering and depth control.

#### read_many_files Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `paths` | string \| string[] | Yes | — | File path(s) or directory |
| `pattern` | string | No | — | Glob filter (e.g., `"*.ts"`) |
| `contentPattern` | string | No | — | Regex content search |
| `maxDepth` | number | No | `3` | Max directory traversal depth |
| `includeContent` | boolean | No | `true` | Include file content in results |
| `maxFiles` | number | No | `50` | Max files to return |

#### read_many_files Examples

```jsonc
// Read multiple files
{ "paths": ["src/a.ts", "src/b.ts"] }

// Traverse directory (TypeScript only)
{ "paths": "src/", "pattern": "*.ts" }

// Content search
{ "paths": "src/", "contentPattern": "TODO|FIXME" }

// List files only (no content)
{ "paths": "src/", "includeContent": false }
```

---

## Team Collaboration

### team_msg

Persistent JSONL message bus for agent team communication. Provides 10 operations with delivery status tracking.

**Storage**: `.workflow/.team/{session-id}/.msg/messages.jsonl`

#### team_msg Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | enum (see below) | Yes | — | Operation type |
| `session_id` | string | Yes* | — | Session ID (e.g., `TLS-my-project-2026-02-27`) |
| `from` | string | No* | — | Sender role name |
| `to` | string | No | `"coordinator"` | Recipient role |
| `type` | string | No | `"message"` | Message type |
| `summary` | string | No | auto-generated | One-line summary |
| `data` | object | No | — | Structured data payload |
| `id` | string | No* | — | Message ID (for read/delete) |
| `last` | number | No | `20` | Last N messages (max 100) |
| `role` | string | No* | — | Role name (for get_state/read_mailbox) |
| `delivery_method` | string | No | — | Delivery method tracking |

**Operations:**

| Operation | Description |
|-----------|-------------|
| `log` | Append message to log |
| `broadcast` | Send to all team members |
| `read` | Read a specific message by ID |
| `list` | List recent messages with from/to/type filters |
| `status` | Summarize per-role activity |
| `get_state` | Read role state from `meta.json` |
| `read_mailbox` | Read unread messages for a role, mark delivered |
| `mailbox_status` | Per-role delivery status counts |
| `delete` | Delete a message by ID |
| `clear` | Delete all messages for a session |

#### team_msg Examples

```jsonc
// Send message
{ "operation": "log", "session_id": "TLS-proj-2026-04-21", "from": "planner", "to": "implementer", "summary": "plan ready", "data": {"phase": 1} }

// Read mailbox
{ "operation": "read_mailbox", "session_id": "TLS-proj-2026-04-21", "role": "implementer" }

// View team status
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

---

### team_mailbox

Mailbox-style agent messaging with delivery tracking and broker injection. Compared to `team_msg`, this tool focuses on point-to-point delivery confirmation.

**Storage**: `.workflow/.team/{session-id}/.msg/mailbox.jsonl`

#### team_mailbox Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | `"send"` \| `"read"` \| `"status"` | Yes | — | Operation type |
| `session_id` | string | Yes | — | Session ID |
| `from` | string | send | — | Sender role |
| `to` | string | send | — | Recipient role |
| `message` | string | send | — | Message content |
| `type` | string | No | `"message"` | Message type |
| `delivery_method` | `"inject"` \| `"poll"` \| `"broadcast"` | No | `"inject"` | Delivery method |
| `data` | object | No | — | Structured data |
| `role` | string | read | — | Role to read mailbox for |
| `limit` | number | No | `50` | Max messages (1-100) |
| `mark_delivered` | boolean | No | `true` | Mark returned messages as delivered |

#### team_mailbox Examples

```jsonc
// Send message (auto-inject into running agent)
{ "operation": "send", "session_id": "TLS-proj-2026-04-21", "from": "coordinator", "to": "worker-1", "message": "start task A" }

// Read mailbox
{ "operation": "read", "session_id": "TLS-proj-2026-04-21", "role": "worker-1" }

// Check delivery status
{ "operation": "status", "session_id": "TLS-proj-2026-04-21" }
```

---

### team_task

Team task CRUD with session-scoped namespaces and state machine validation. Built on the CollabTask system.

**Storage**: `.workflow/.team/{session_id}/tasks/{id}.json`

#### team_task Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | `"create"` \| `"update"` \| `"list"` \| `"get"` | Yes | — | Operation type |
| `session_id` | string | Yes | — | Session ID |
| `title` | string | create | — | Task title |
| `description` | string | No | — | Task description |
| `owner` | string | No | `"agent"` | Owner (assignee) |
| `priority` | `"low"` \| `"medium"` \| `"high"` \| `"critical"` | No | `"medium"` | Priority |
| `task_id` | string | update/get | — | Task ID (e.g., `ATASK-001`) |
| `status` | `"open"` \| `"assigned"` \| `"in_progress"` \| `"pending_review"` \| `"done"` \| `"closed"` | No | — | Task status |

**State transitions:**

```
open → assigned → in_progress → pending_review → done → closed
                                                        ↘ open (reopen)
```

#### team_task Examples

```jsonc
// Create task
{ "operation": "create", "session_id": "TLS-proj-2026-04-21", "title": "Implement auth", "priority": "high" }

// Update status
{ "operation": "update", "session_id": "TLS-proj-2026-04-21", "task_id": "ATASK-001", "status": "in_progress" }

// List tasks
{ "operation": "list", "session_id": "TLS-proj-2026-04-21" }
```

---

### team_agent

Agent lifecycle management — spawn, shutdown, and remove agents via the Delegate Broker.

**Storage**: `.workflow/.team/{session_id}/members.json`

#### team_agent Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | `"spawn_agent"` \| `"shutdown_agent"` \| `"remove_agent"` \| `"members"` | Yes | — | Operation type |
| `session_id` | string | Yes | — | Session ID |
| `role` | string | spawn/shutdown/remove | — | Agent role name |
| `prompt` | string | spawn | — | Agent instructions |
| `tool` | string | No | `"gemini"` | CLI tool to use |

#### team_agent Examples

```jsonc
// Spawn agent
{ "operation": "spawn_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher", "prompt": "Analyze auth patterns", "tool": "gemini" }

// Shutdown agent
{ "operation": "shutdown_agent", "session_id": "TLS-proj-2026-04-21", "role": "researcher" }

// List members
{ "operation": "members", "session_id": "TLS-proj-2026-04-21" }
```

---

## Persistent Memory

### core_memory

Cross-session JSON memory storage at `~/.maestro/data/core-memory/`. Provides 4 operations: list, import, export, search.

**Storage**: `~/.maestro/data/core-memory/{md5-hash-of-project-path}.json`

**ID format**: `CMEM-YYYYMMDD-HHMMSS`

#### core_memory Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operation` | `"list"` \| `"import"` \| `"export"` \| `"search"` | Yes | — | Operation type |
| `path` | string | No | auto-detected | Project path override |
| `text` | string | import | — | Content to import |
| `id` | string | export | — | Memory ID |
| `query` | string | search | — | Search keywords |
| `limit` | number | No | `100` | Max results |
| `tags` | string[] | No | — | Tag filter (AND logic) |

#### core_memory Examples

```jsonc
// Import memory
{ "operation": "import", "text": "Auth module uses bcrypt + JWT", "tags": ["auth", "security"] }

// Search
{ "operation": "search", "query": "auth token" }

// Export
{ "operation": "export", "id": "CMEM-20260421-143000" }

// List with tag filter
{ "operation": "list", "tags": ["auth"], "limit": 10 }
```

---

## Architecture

```
MCP Server (stdio)
  └─ ToolRegistry
       ├─ edit_file       ─ File editing (update/line)
       ├─ write_file      ─ File writing
       ├─ read_file       ─ Single file read
       ├─ read_many_files ─ Batch read / search
       ├─ team_msg        ─ Message bus (JSONL)
       ├─ team_mailbox    ─ Mailbox delivery
       ├─ team_task       ─ Task management
       ├─ team_agent      ─ Agent lifecycle
       └─ core_memory     ─ Persistent memory
```

**Adapter**: Tools use Zod schemas internally and return `{success, result, error}` format. The `ccwResultToMcp()` adapter converts this to the MCP standard `{content, isError}` format.
