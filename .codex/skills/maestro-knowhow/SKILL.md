---
name: maestro-knowhow
disable-model-invocation: true
description: Intent-driven knowhow precipitation — describe what you want to
  capture (记一个关于X的决策 / 保存这段代码模板 / 写个部署配方 / 存个调试技巧) and the workflow infers the
  type and records it into .workflow/knowhow/. Pure capture surface; knowhow
  的管理/审计走 /maestro-knowledge；项目约束规则走 /maestro-spec add。Triggers on "knowhow
  capture", "知识沉淀", "沉淀经验", "记录模板", "记录决策", "adr", "存个技巧".
argument-hint: "[intent — e.g. '记录一个 JWT 刷新的决策' | 'template 这段重试代码' | 'tip: redis 管道陷阱']"
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
session-mode: none
version: 0.5.83
---

<purpose>
Intent-driven knowhow precipitation path (沉淀路径) — captures reusable knowledge into `.workflow/knowhow/`. No fixed grammar — state your intent; the `knowhow` step infers the content type and extracts the content. Type keywords still work as deterministic shortcuts:

| Type | Keywords | Prefix |
|------|----------|--------|
| session | `session` / `compact` / 压缩 | KNW- |
| template | `template` / `tpl` / 模板 | TPL- |
| recipe | `recipe` / `rcp` / 配方 / 步骤 | RCP- |
| reference | `reference` / `ref` / 参考 | REF- |
| decision | `decision` / `dcs` / `adr` / 决策 | DCS- |
| tip | `tip` / `note` / 技巧 / 记录 | TIP- |
| asset | `asset` / 资产 | AST- |
| blueprint | `blueprint` / 蓝图 | BLP- |
| document | `document` / doc / 文档 | DOC- |
</purpose>

<dispatch>
Read `~/.maestro/workflows/knowhow.md` and follow the execution document directly. Do not create a Session or Run just to load this document.

Pass the full `$ARGUMENTS` to the workflow as its intent (the first `capture` argument is implied). The workflow infers one of the nine compatible types and writes through the canonical CLI.

Minimal ordinary creation is `maestro knowhow add --type <type> --title "<title>" --content-file <path>`: type, title, and content are the only required knowledge parameters. Keywords, sourceRef, relatedPaths, applicability, language, decision state, explicit ID, and tool are advanced optional metadata. Repository authority is host-owned: omit `targetRepoId` for current-repository writes; pass the exact host-supplied stable UUID only for an explicitly selected linked write with live `knowhow` write capability. Never derive identity from cwd/name/alias/path or persist those values as identity.
</dispatch>
