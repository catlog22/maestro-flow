---
name: maestro-manage
disable-model-invocation: true
description: Project management hub — status, issues, knowledge stores, and
  drift/rebuild sync. knowledge 子命令覆盖 capture（knowhow 沉淀）/ audit（知识审计）/ harvest
  / wiki / domain；约束类规则走 /maestro-spec add。Triggers on "项目状态", "issue 管理",
  "知识沉淀", "knowhow capture", "knowledge audit", "知识审计", "drift 同步".
argument-hint: status|issue|knowledge|sync [args...]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - WebFetch
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: none
version: 0.5.52
---

<purpose>
Unified project management hub. Routes to four subcommand groups:
- **status** — project dashboard (progress, tasks, active work, next steps)
- **issue** — issue lifecycle (create/list/status/update/close/link) + automated discovery
- **knowledge** — knowledge stores: capture, audit, harvest, wiki, extractors, domain
- **sync** — artifact drift detection/realignment + full codebase doc rebuild
</purpose>

<dispatch>
Parse the first token(s) of $ARGUMENTS. Run `maestro run skill --platform codex <step>` to load the matched workflow, then follow it completely.

| Tokens | Step | Description |
|--------|------|-------------|
| _(empty)_ or `status` | `status` | Project dashboard |
| `issue` [action] | `issue` | Issue CRUD: create, list, status, update, close, link |
| `issue discover` | `issue-discover` | Automated multi-perspective issue discovery |
| `knowledge capture` | `knowhow` | Capture reusable knowledge by type (Part B) |
| `knowledge knowhow` | `knowhow` | Manage knowhow entries (Part A) |
| `knowledge audit` | `knowledge-audit` | Audit/prune spec, knowhow, artifact stores |
| `knowledge harvest` | `harvest` | Extract knowledge from workflow artifacts |
| `knowledge wiki` [action] | Wiki routing (below) | Wiki graph management |
| `knowledge extractors` | `extractors` | Auto-generate KG extractor rules |
| `knowledge domain` | `domain-add` | Register a domain term |
| `sync codebase` | `sync` | Incremental codebase doc sync |
| `sync drift` | `drift-realign` | Detect and realign artifact drift |
| `sync rebuild` | `codebase-rebuild` | Full codebase doc rebuild |

### Wiki action routing

For `knowledge wiki [action]`, parse the third token:

| Wiki action | Step |
|-------------|------|
| `health` / `search` / `cleanup` / `stats` / _(empty)_ | `wiki-manage` |
| `connect` | `wiki-connect` |
| `digest` | `wiki-digest` |

### Routing rules

- No subcommand → default to `status`.
- Unrecognized top-level token → display this dispatch table.
- Remaining tokens after routing become the workflow's own arguments.
</dispatch>
