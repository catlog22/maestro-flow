# Knowledge Transfer Protocols

## 1. Transfer Channels

| Channel | Scope | Mechanism | When to Use |
|---------|-------|-----------|-------------|
| **Artifacts** | Producer -> Consumer | Write to `<session>/artifacts/<name>.md`, consumer reads in Phase 2 | Structured deliverables (reports, plans, specs) |
| **State Updates** | Cross-role | `team_msg(operation="log", type="state_update", data={...})` / `team_msg(operation="get_state", session_id=<session-id>)` | Key findings, decisions, metadata (small, structured data) |
| **Wisdom** | Cross-task | Append to `<session>/wisdom/{learnings,decisions,conventions,issues}.md` | Patterns, conventions, risks discovered during execution |
| **Context Accumulator** | Intra-role (inner loop) | In-memory array, passed to each subsequent task in same-prefix loop | Prior task summaries within same role's inner loop |
| **Exploration Cache** | Cross-role | `<session>/explorations/cache-index.json` + per-angle JSON | Codebase discovery results, prevents duplicate exploration |

## 2. Context Loading Protocol (Phase 2)

Every role MUST load context in this order before starting work.

| Step | Action | Required |
|------|--------|----------|
| 1 | Extract session path from task description | Yes |
| 2 | `team_msg(operation="get_state", session_id=<session-id>)` | Yes |
| 3 | Read artifact files from upstream state's `ref` paths | Yes |
| 4 | Read `<session>/wisdom/*.md` if exists | Yes |
| 5 | Check `<session>/explorations/cache-index.json` before new exploration | If exploring |
| 6 | For inner_loop roles: load context_accumulator from prior tasks | If inner_loop |

**Loading rules**:
- Never skip step 2 -- state contains key decisions and findings
- If `ref` path in state does not exist, log warning and continue
- Wisdom files are append-only -- read all entries, newest last

## 3. Context Publishing Protocol (Phase 4)

| Step | Action | Required |
|------|--------|----------|
| 1 | Write deliverable to `<session>/artifacts/<task-id>-<name>.md` | Yes |
| 2 | Send `team_msg(type="state_update")` with payload (see schema below) | Yes |
| 3 | Append wisdom entries for learnings, decisions, issues found | If applicable |

## 4. State Update Schema

Sent via `team_msg(type="state_update")` on task completion.

```json
{
  "status": "task_complete",
  "task_id": "<TASK-NNN>",
  "ref": "<session>/artifacts/<filename>",
  "key_findings": [
    "Finding 1",
    "Finding 2"
  ],
  "decisions": [
    "Decision with rationale"
  ],
  "files_modified": [
    "path/to/file.ts"
  ],
  "verification": "self-validated | peer-reviewed | tested"
}
```

**Field rules**:
- `ref`: Always an artifact path, never inline content
- `key_findings`: Max 5 items, each under 100 chars
- `decisions`: Include rationale, not just the choice
- `files_modified`: Only for implementation tasks
- `verification`: One of `self-validated`, `peer-reviewed`, `tested`

**Write state** (namespaced by role):
```
team_msg(operation="log", session_id=<session-id>, from=<role>, type="state_update", data={
  "<role_name>": { "key_findings": [...], "scope": "..." }
})
```

**Read state**:
```
team_msg(operation="get_state", session_id=<session-id>)
// Returns merged state from all state_update messages
```

## 5. Exploration Cache Protocol

Prevents redundant research across tasks and discussion rounds.

| Step | Action |
|------|--------|
| 1 | Read `<session>/explorations/cache-index.json` |
| 2 | If angle already explored, read cached result from `explore-<angle>.json` |
| 3 | If not cached, perform exploration |
| 4 | Write result to `<session>/explorations/explore-<angle>.json` |
| 5 | Update `cache-index.json` with new entry |

**cache-index.json format**:
```json
{
  "entries": [
    {
      "angle": "competitor-analysis",
      "file": "explore-competitor-analysis.json",
      "created_by": "RESEARCH-001",
      "timestamp": "2026-01-15T10:30:00Z"
    }
  ]
}
```

**Rules**:
- Cache key is the exploration `angle` (normalized to kebab-case)
- Cache entries never expire within a session
- Any role can read cached explorations; only the creator updates them
