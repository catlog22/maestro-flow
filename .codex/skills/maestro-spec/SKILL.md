---
name: maestro-spec
disable-model-invocation: true
description: Intent-driven spec precipitation — state a constraint in natural
  language (加一条规范：禁止用 any / 记录架构约束：服务间走 gRPC / 质量规则：覆盖率≥80%) and the workflow
  infers the category and records a <spec-entry>. Spec =
  项目约束规则（编码规范、架构约束、质量标准）；可复用知识文档走 /maestro-knowhow capture。Triggers on
  "maestro-spec add", "记录规范", "添加约束", "添加规则", "加一条规范", "spec add".
  Terminology：spec = project constraints/rules (<spec-entry>). Reusable
  knowledge documents use /maestro-knowhow capture. Learning discoveries from
  /maestro-learn use <learning-entry> tags in learnings.md (separate from spec
  entries).
argument-hint: "[intent — e.g. '加一条规范：禁止用 any' | 'arch 约束：服务间走 gRPC' | '--scope
  team coding: 统一用 pnpm']"
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
session-mode: none
version: 0.5.85
---

<purpose>
Intent-driven spec precipitation path (沉淀路径) — records project constraint rules. No fixed grammar — state the constraint; the `specs-add` step infers the category and scope and formats the `<spec-entry>`. Explicit form still works as a shortcut: `[--scope <scope>] <category> <content>`.

Categories: `coding · arch · quality · debug · test · review · learning · ui`
Scopes: `project` (default) · `global` · `team` · `personal`
</purpose>

<dispatch>
Read `~/.maestro/workflows/specs-add.md` and follow the execution document directly. Do not create a Session or Run just to load this document.

Pass the full `$ARGUMENTS` to the workflow as its intent (the `add` keyword is implied). The workflow infers category, scope, and content, then appends the entry.
</dispatch>
