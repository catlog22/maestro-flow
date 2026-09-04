---
name: maestro-issue
disable-model-invocation: true
description: Intent-driven issue lifecycle management — describe what you want
  in natural language (报告一个 bug / 列出开放 issue / 关掉 ISS-xxx / 关联到 task / 扫描发现问题)
  and the workflow routes to the right operation. Operates on .workflow/issues/.
  知识管理走 /maestro-knowledge；knowhow 沉淀走 /maestro-knowhow；约束规则走
  /maestro-spec。Triggers on "issue 管理", "报 bug", "记录问题", "issue list", "关闭
  issue", "issue discover", "发现问题".
argument-hint: "[intent — e.g. '记录一个登录失败的 bug' | 'list open' | 'close
  ISS-20260101-001' | 'discover']"
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
version: 0.5.85
---

<purpose>
Intent-driven issue management (renamed from maestro-manage, narrowed to issues). No fixed subcommand grammar — state your intent; the `issue` step classifies it into one operation and extracts the needed parameters:

- **create** — report/record a new issue
- **list** — list issues (with optional filters)
- **show** — view one issue in detail
- **update** — change status/priority/add a note
- **close** — resolve/fail/defer an issue
- **link** — link an issue to a task
- **discover** — automated multi-perspective issue discovery
</purpose>

<dispatch>
Read `~/.maestro/workflows/issue.md` and follow the execution document directly. Do not create a Session or Run just to load this document.

Pass the full `$ARGUMENTS` to the workflow. For `discover`, read `~/.maestro/workflows/issue-discover.md` instead. The workflow classifies the intent, extracts parameters, and routes to the requested issue operation.
</dispatch>
