---
title: "Antigravity Tools Guide"
---

Antigravity AI assistant available tools, including parameters and Schema.

## Tool Reference

| # | Tool | Purpose |
|---|------|------|
| 1 | `ask_permission` | Request user authorization when permissions are insufficient |
| 2 | `ask_question` | Ask the user multiple-choice questions |
| 3 | `define_subagent` | Define a new sub-Agent type |
| 4 | `generate_image` | Generate or edit images from text |
| 5 | `grep_search` | Exact match search using ripgrep |
| 6 | `invoke_subagent` | Invoke one or more sub-Agents by name |
| 7 | `list_dir` | List directory contents |
| 8 | `list_permissions` | List all current permission grants |
| 9 | `manage_subagents` | List, terminate, or terminate all sub-Agents |
| 10 | `manage_task` | List, terminate, view status, or send input to background tasks |
| 11 | `multi_replace_file_content` | Multiple non-contiguous edits in the same file |
| 12 | `read_url_content` | Fetch URL content (HTML → Markdown) |
| 13 | `replace_file_content` | Single contiguous block edit in a file |
| 14 | `run_command` | Execute commands in the user's shell |
| 15 | `schedule` | One-time scheduled or recurring cron tasks |
| 16 | `search_web` | Web search |
| 17 | `send_message` | Send a message to other Agents |
| 18 | `view_file` | View file contents (text, images, PDF) |
| 19 | `write_to_file` | Create or overwrite a file |

<details>
<summary>Parameter Details</summary>

### 1. ask_permission
- `Action` (enum): `command`, `unsandboxed`, `mcp`, `custom`, `read_file`, `write_file`, `read_url`, `execute_url`
- `Target` (string): Operation target
- `Reason` (string): Reason for needing permission
- `toolAction`, `toolSummary` (string)

### 2. ask_question
- `questions` (array): `{question, options, is_multi_select}` list
- `toolAction`, `toolSummary` (string)

### 3. define_subagent
- `name`, `description`, `system_prompt` (string)
- `enable_write_tools`, `enable_mcp_tools`, `enable_subagent_tools` (boolean)
- `toolAction`, `toolSummary` (string)

### 4. generate_image
- `Prompt`, `ImageName` (string); `ImagePaths` (array, optional)
- `toolAction`, `toolSummary` (string)

### 5. grep_search
- `SearchPath`, `Query` (string)
- `IsRegex`, `CaseInsensitive`, `MatchPerLine` (boolean)
- `Includes` (array, glob patterns)
- `toolAction`, `toolSummary` (string)

### 6. invoke_subagent
- `Subagents` (array): `{TypeName, Role, Prompt, Workspace}` list
  - `Workspace`: `inherit`, `branch` or `share`
- `toolAction`, `toolSummary` (string)

### 7. list_dir
- `DirectoryPath` (string); `toolAction`, `toolSummary`

### 8. list_permissions
- `toolAction`, `toolSummary`

### 9. manage_subagents
- `Action` (enum): `list`, `kill`, `kill_all`
- `ConversationIds` (array, used for kill); `toolAction`, `toolSummary`

### 10. manage_task
- `Action` (enum): `list`, `kill`, `status`, `send_input`
- `TaskId` (string, used for kill/status/send_input)
- `Input` (string, used for send_input); `toolAction`, `toolSummary`

### 11. multi_replace_file_content
- `TargetFile`, `Instruction`, `Description` (string)
- `ReplacementChunks` (array): `{StartLine, EndLine, TargetContent, ReplacementContent, AllowMultiple}`
- `TargetLintErrorIds`, `ArtifactMetadata` (optional); `toolAction`, `toolSummary`

### 12. read_url_content
- `Url` (string); `toolAction`, `toolSummary`

### 13. replace_file_content
- `TargetFile`, `Instruction`, `Description`, `TargetContent`, `ReplacementContent` (string)
- `StartLine`, `EndLine` (integer); `AllowMultiple` (boolean)
- `TargetLintErrorIds` (array, optional); `toolAction`, `toolSummary`

### 14. run_command
- `CommandLine`, `Cwd` (string); `WaitMsBeforeAsync` (integer)
- `toolAction`, `toolSummary`

### 15. schedule
- `Prompt` (string); `DurationSeconds` (one-time) or `CronExpression` (recurring)
- `MaxIterations` (optional); `toolAction`, `toolSummary`

### 16. search_web
- `query`, `domain` (string); `toolAction`, `toolSummary`

### 17. send_message
- `Recipient` (Conversation ID), `Message` (string); `toolAction`, `toolSummary`

### 18. view_file
- `AbsolutePath` (string); `StartLine`, `EndLine` (integer, used for text)
- `IsSkillFile` (boolean); `toolAction`, `toolSummary`

### 19. write_to_file
- `TargetFile`, `CodeContent`, `Description` (string)
- `Overwrite`, `IsArtifact` (boolean); `ArtifactMetadata` (object)
- `toolAction`, `toolSummary`

</details>

## Agent Communication and Coordination

### Communication Flow

1. **Initiate**: Parent Agent uses `invoke_subagent` -> gets `conversationID`
2. **Messaging**: Agent uses `send_message` specifying target `conversationID`
3. **Passive Wakeup**: When a sub-Agent responds, the system automatically restores the idle parent Agent

### Workspace Modes

| Mode | Description |
|------|------|
| `inherit` | Shares the same directory and state with the parent Agent |
| `branch` | Gets an independent copy/clone of the workspace |
| `share` | Shares the underlying repository (similar to git worktree), independent branch + shared storage |
