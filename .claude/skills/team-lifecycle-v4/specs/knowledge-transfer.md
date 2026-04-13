# Knowledge Transfer Protocols

## 1. Transfer Channels

| Channel | Method | Producer | Consumer |
|---------|--------|----------|----------|
| Artifacts | Files in `<session>/artifacts/` | Task executor | Next task in pipeline |
| State Updates | `team_msg(type="state_update")` | Task executor | Coordinator + downstream |
| Wisdom | Append to `<session>/wisdom/*.md` | Any role | All roles |
| Context Accumulator | In-memory aggregation | Inner loop only | Current task |
| Exploration Cache | `<session>/explorations/` | Analyst / researcher | All roles |

## 2. Context Loading Protocol (Before Task Execution)

Every role MUST load context in this order before starting work.

| Step | Action | Required |
|------|--------|----------|
| 1 | `team_msg(operation="get_state", role=<upstream>)` | Yes |
| 2 | Read artifact files from upstream state's `ref` paths | Yes |
| 3 | Read `<session>/wisdom/*.md` if exists | Yes |
| 4 | Check `<session>/explorations/cache-index.json` before new exploration | If exploring |

**Loading rules**:
- Never skip step 1 -- state contains key decisions and findings
- If `ref` path in state does not exist, log warning and continue
- Wisdom files are append-only -- read all entries, newest last

## 3. Context Publishing Protocol (After Task Completion)

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

**Supervisor-specific extensions** (CHECKPOINT tasks only):

```json
{
  "supervision_verdict": "pass | warn | block",
  "supervision_score": 0.85,
  "risks_logged": 0,
  "blocks_detected": 0
}
```

- `supervision_verdict`: Required for CHECKPOINT tasks. Determines pipeline progression.
- `supervision_score`: Float 0.0-1.0. Aggregate of individual check scores.
- `risks_logged`: Count of risks written to wisdom/issues.md.
- `blocks_detected`: Count of blocking issues found. >0 implies verdict=block.

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
