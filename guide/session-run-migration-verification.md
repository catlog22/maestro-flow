---
title: "Session/Run 全量迁移验收记录"
verified_at: "2026-07-13T09:51:00+08:00"
status: passed
---

# Session/Run 全量迁移验收记录

本记录对应 `session-run-structure-guide.md` 与 `core-command-migration-plan.md` 的当前实现。它记录机器执行结果，不替代协议真相源。

## 覆盖范围

- Command：69 个（43 个 `run`，22 个 `none`，3 个 `deprecated`，1 个 `bootstrap`）；其中 `maestro-verify` 为新增独立 Verify Run。
- Skill：45 个（30 个 `run`，15 个 `none`）；所有 stateful skill 的活动子流程均声明 Run Artifact Boundary；`team-executor` 的 `.workflow/.team/` 仅为输入 schema 示例。
- Workflow：122 个（106 个 `inherited`，11 个 `none`，4 个 `deprecated`，1 个 `bootstrap`）。
- Runtime：`maestro run create/check/complete/seal-session`、Protected SessionStore、typed Artifact、Gate、handoff/evidence；不再投影或消费 legacy artifact registry。
- Search：仅索引 canonical Session/Run 与 typed artifacts；scratch working documents、milestone archive adapter 和 legacy archive loader 已移除。
- Hooks/Tools：session context、skill context、statusline 与 merge validator 均读取 Session `session.json`、`artifacts.json` 和 Run `run.json`。

## 机器验证

| 验证 | 命令 | 结果 |
|---|---|---|
| Prompt + mirror migration lint | `npm run lint:session-run` | passed：69 commands，45 skills；`.agy`、`.agents`、`.codex` frontmatter/contract 一致性通过 |
| Root strict typecheck | `npm run lint` | passed |
| Runtime tests | `npx vitest run src/run/runtime.test.ts` | passed：11/11 |
| Hook tests | `npx vitest run src/hooks/__tests__/skill-context.test.ts src/hooks/__tests__/session-context.test.ts src/hooks/__tests__/statusline-chains.test.ts` | passed：22/22 |
| Merge validator tests | `npx vitest run src/tools/__tests__/merge-validator.test.ts` | passed：7/7 |
| Search tests | `cd dashboard && npx vitest run src/server/wiki/wiki-indexer.test.ts` | passed：27/27；移除的 11 项均为 archive/scratch compatibility 覆盖 |
| Production build | `npm run build` | passed |
| Mirrors | `npm run build:mirrors` | passed：69 command skills、45 skill dirs、24 agents；`.codex` 二次同步 0 changes |
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

## Canonical 边界

- 正式产物只允许写入 `{run_dir}/outputs/`，evidence 只允许写入 `{run_dir}/evidence/`，叙事与 handoff 只允许写入 `{run_dir}/report.md`。
- `run create` 仅复用 normalized intent 相同且状态为 running/paused 的 Session；没有匹配项时创建新 Session。
- lifecycle 基础协议统一引用 `@~/.maestro/workflows/run-mode.md`；command 仍需自包含领域逻辑。
- scratch、milestone phase artifact folder 与 `state.json.artifacts[]` 不再属于运行时、Search、Hook 或 merge validation 的兼容输入。
- 无强制 typed `check` 的抽象字符串 Gate 会以非阻塞 `skipped` 留痕；需要硬门禁的 command contract 必须提供结构化 `check`。
- `.workflow/.team/` 仅保留为 Agent 消息总线，不是正式 artifact 或 Search 知识源。
- `.agy` frontmatter 使用正式 YAML round-trip，嵌套 `contract` 与 flow/block `allowed-tools` 均由 mirror lint 校验；`.codex` 保留平台专属 body/tools，只同步 canonical `session-mode`、Run boundary 与 contract。
