---
title: "Session/Run 全量迁移验收记录"
verified_at: "2026-07-13T01:22:32+08:00"
status: passed
---

# Session/Run 全量迁移验收记录

本记录对应 `session-run-structure-guide.md` 与 `core-command-migration-plan.md` 的当前实现。它记录机器执行结果，不替代协议真相源。

## 覆盖范围

- Command：69 个（43 个 `run`，22 个 `none`，3 个 `deprecated`，1 个 `bootstrap`）；其中 `maestro-verify` 为新增独立 Verify Run。
- Skill：45 个（28 个 `run`，17 个 `none`）；所有 stateful skill 的 `roles/**/*.md` 均声明 Run Artifact Boundary。
- Workflow：122 个（106 个 `inherited`，11 个 `none`，4 个 `deprecated`，1 个 `bootstrap`）。
- Runtime：`maestro run create/check/complete/seal-session`、Protected SessionStore、typed Artifact、Gate、handoff/evidence、legacy shim。
- Search：sealed/archived Session/Run 索引、typed artifact 优先、临时/草稿排除、深层 mtime 增量失效、legacy archive 兼容。

## 机器验证

| 验证 | 命令 | 结果 |
|---|---|---|
| Prompt migration lint | `npm run lint:session-run` | passed：69 commands，45 skills |
| Root strict typecheck | `npm run lint` | passed |
| Runtime tests | `npx vitest run src/run/runtime.test.ts` | passed：10/10 |
| Search tests | `cd dashboard && npx vitest run src/server/wiki/wiki-indexer.test.ts` | passed：38/38 |
| Production build | `npm run build` | passed |
| Mirrors | `npm run build:mirrors` | passed：69 command skills、45 skill dirs、24 agents |
| Diff whitespace | `git diff --check` | passed；仅 Git LF→CRLF 提示 |

## CLI Pilot

Pilot 工作区位于 PlanEx session 的 `pilot-workspace/`，未进入产品源文件。

1. `maestro run create pilot -- --flag value`
   - Session：`20260713-pilot`
   - Run：`20260713-001-pilot`
   - Entry gates：无 blocking
2. 写入 `outputs/result.json`（`_meta.kind=pilot-result`）与带 frontmatter 的 `report.md`。
3. `maestro run check 20260713-001-pilot --stage exit`
   - Artifact 自发现成功；Exit gate passed。
4. `maestro run complete 20260713-001-pilot`
   - Run sealed；primary artifact：`ART-001-001`；alias：`latest-pilot`。
5. `maestro run seal-session 20260713-pilot --summary "Pilot complete"`
   - Session sealed；active pointer 已清除。
6. `maestro search "Session Run pilot" --json --no-emb`
   - 返回 `session-run-20260713-pilot-20260713-001-pilot` 与 Session 摘要，证明 sealed Run 可被 Search 发现。

## 已知兼容边界

- L0 shim 仍会把 sealed Run artifacts 投影到 legacy `state.json.artifacts[]`，仅供尚未升级的消费者读取；新命令不得直接写该数组。
- 无强制 typed `check` 的抽象字符串 Gate 会以非阻塞 `skipped` 留痕；需要硬门禁的 command contract 必须提供结构化 `check`。
- `.workflow/.team/` 仅保留为 Agent 消息总线，不是正式 artifact 或 Search 知识源。
