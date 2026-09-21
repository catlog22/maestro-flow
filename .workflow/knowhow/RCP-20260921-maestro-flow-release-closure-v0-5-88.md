---
title: "Maestro Flow v0.5.88 发布闭环：run check completion_preflight、argv INVALID_VALUE 与 scanOutputs declared schema/role"
type: recipe
created: 2026-09-21T10:00:00.000Z
keywords:
  - 发布
  - 版本
  - completion-preflight
  - argv-validation
  - artifact-contract
  - npm-propagation
lifecycleStatus: active
relatedPaths:
  - docs/release-notes/.release-notes-v0.5.88.md
  - src/commands/run-v3.ts
  - src/commands/help-json.ts
  - src/run/artifacts.ts
---

# Maestro Flow v0.5.88 发布闭环：run check completion_preflight、argv INVALID_VALUE 与 scanOutputs declared schema/role

## Goal

把工作区 WIP 按逻辑分 3 批提交（scanOutputs declared schema/role；help catalog INVALID_VALUE + portable-path-segment；run check completion_preflight + verdict choices），发布为 `maestro-flow@0.5.88`。prepublishOnly 零门禁失败一次全过，npm publish 一次成功（registry 读侧延迟约 10 分钟），五路验证全过。

## Release Identity

- previous tag：`v0.5.87`（`d3b8c467` 的前任，peeled `5968d6dd`）
- product range：`v0.5.87..21fcc546`（3 product commits + 1 post-release knowhow docs commit，7 files / +268 / -16）
- 版本期提交：`f4496710` chore(release): prepare v0.5.88（38 files：六处版本面 + 32 codex mirrors + ChangelogPage + release notes）
- final release commit：`f4496710a019c5ce476344418ad81f4f5483ed63`
- annotated tag：`v0.5.88`（remote peeled = `f4496710`）
- GitHub Release：https://github.com/catlog22/maestro-flow/releases/tag/v0.5.88（published 2026-09-21T09:43:13Z，非 draft，非 prerelease）
- npm：https://www.npmjs.com/package/maestro-flow/v/0.5.88（latest=0.5.88）

## Knowledge-First Discovery

- `RCP-20260918-maestro-flow-release-closure-v0-5-87`（上一闭环：docs-reference 漂移、release-machine expectedV3Commands、npm 读侧延迟 ~8min、lint 依赖 build、pipefail）
- `RCP-20260718-maestro-flow-release-closure`（基础发布闭环：版本面清单、dirty worktree 双工作区、五路验证）

## Product Scope（3 product commits，6 files / +121 / -16；另有 `2f8b0a2e` knowhow docs +147）

1. **scanOutputs declared schema/role**（`bbf62d30`）：`scanOutputs` 遵循契约 `produces` 声明的 `schema`/`role`；单 `.json` primary 推断只作用于未声明输出；显式不匹配的 `_meta` role/schema 报严格契约错误而非静默修复。
2. **help catalog argv 值校验**（`e447a62b`）：新增 `INVALID_VALUE` 错误码；option_specs 增加 `value_constraint`（`--request-id` = `portable-path-segment`），choices 与路径段约束在预检期校验。
3. **run check completion_preflight**（`21fcc546`）：输出 `completion_preflight` {ready, blockers, warnings, summary_source}——blockers 含契约漂移需 rebind、缺 summary、非 running 状态；新增 `--summary`；`run complete --verdict` 改 Commander choices(done|done_with_concerns)。

## Required Gates

clean worktree `npm run prepublishOnly` 一次全过、零拦截：arch-kb 80 entries ✓；instructions in sync ✓；invocation policy ✓；session-execution + session-run prompt lint（18 commands、14 skills）✓；docs-reference in sync ✓；contract parity 43 checks ✓；search-ranking source（root 113 + dashboard 70 tests，0 failures）✓；build + built attestation（qrels hash match、exactMrrAt10=1、knowledgeRecallAt20=1）✓；release-machine parity ✓；mirrors 32 skills + 29 agents ✓；packaged-install smoke v3 chain ✓；skill surface 100 invocations ✓。

**关键：本次零门禁修复。** WIP 提交前已在主仓预验证（`npm run build` + 3 个受影响测试文件 72/72 + `check:docs-reference` + `check:session-run-release-machine` + `check:session-run-contract-parity`），命令面变更（`run check --summary`、`--verdict` choices、catalog value_constraint）未造成任何清单漂移。

## Package Proof

从 release commit `f4496710` 创建 detached worktree `D:/maestro2-rel-v0.5.88`，worktree 内真实 `npm ci`（root 347 包 + docs-site 312 包）。`npm run build` + `npm run lint` 全过后 pack：

```text
filename: maestro-flow-0.5.88.tgz
size: 21,405,695 B（约 21.4 MB）
files: 5085
shasum: 26e8a88de90f2260d584c401819fe7ccae095fbb
integrity: sha512-/ejJOzurhygK71XLVWzuVoo/wP9B4l2Eg2DctW2+2NSO8wGZN4BrcDARfkGltpNoSMRHfOZlROObrBRfbRdR+A==
```

包内容断言：`.cache=0`、`.pyc=0`、`resources/arch-kb/index.json=1`、`dist/src/index.js` + `bin/maestro.js` 存在、32/32 codex skill 版本戳=0.5.88、0 个 0.5.87 残留。

Fresh consumer：`npm init` + `npm install <tgz>`（284 pkgs）→ `import('maestro-flow')` = 49 ESM exports → `bin/maestro.js --version` = 0.5.88 → 安装包 `package.json`/codex `maestro/SKILL.md` version = 0.5.88。

## Publish and Verification

1. push master（`2f8b0a2e..f4496710`）；
2. annotated tag `v0.5.88` 创建并推送，`git ls-remote` peeled = `f4496710`；
3. `gh release create v0.5.88 --title v0.5.88 --notes-file docs/release-notes/.release-notes-v0.5.88.md`；`gh release view` 确认 published/非 draft/非 prerelease（2026-09-21T09:43:13Z）；
4. `npm publish ./maestro-flow-0.5.88.tgz --access public` 一次成功（输出 `+ maestro-flow@0.5.88`），registry 读侧延迟约 10 分钟才可见；
5. 五路验证全过：
   - `npm view maestro-flow@0.5.88 dist.shasum` = `26e8a88d...` / `dist.integrity` = `sha512-/ejJOz...` 与本地 pack 字节级一致；
   - `npm view maestro-flow dist-tags.latest` = 0.5.88；
   - `git ls-remote origin master` = `f4496710` + tag peeled = `f4496710`；
   - `gh release view v0.5.88` = published / non-draft / non-prerelease；
   - Deploy Docs Site workflow 在 `f4496710` 上 conclusion=success（run 35584807209）。

## Problems Found and Durable Fixes

### 1. `npm view --json` 在 E404 时仍向 stdout 输出 JSON 错误对象

**现象**：轮询脚本用 `r=$(npm view pkg@ver --json 2>/dev/null); [ -n "$r" ]` 判可见性，第一次就 break——E404 时 stdout 也有 `{"error":{"code":"E404",...}}` 输出，非空。

**修复**：改为 `npm view pkg@ver version 2>/dev/null | grep -q <version>` 按内容判定。

**清单增量**：npm 读侧轮询必须 grep 目标版本号，不能靠 stdout 非空或 exit code（`--json` 模式下 E404 exit code 也可能被吞）。

### 2. npm 读侧传播延迟再现（本次约 10 分钟）

**现象**：publish 返回 `+ maestro-flow@0.5.88` 后，`npm view` 持续 E404、`dist-tags.latest` 保持 0.5.87 约 10 分钟（v0.5.87 为约 8 分钟；21MB+ 大包更明显）。

**处置**：已知行为，耐心等待轮询即可；未重复 publish。

## Reusable Checklist 增量（v0.5.88）

1. **WIP 预验证投入产出比确认**：提交前在主仓跑 build + 受影响测试 + docs-reference/release-machine/contract-parity 三个易漂移门禁，本次 prepublishOnly 零修复一次通过。
2. **npm 轮询判据**：`npm view pkg@ver version | grep -q <ver>`；不要用 stdout 非空判定（`--json` 模式 E404 也输出错误对象）。
3. npm 读侧延迟预期放宽到 ~10 分钟（21MB+ 包）。
4. 其余沿用 v0.5.87 清单：clean worktree `npm ci` → `build` → `lint` → `pack`；`set -o pipefail`；pack 前 `git checkout -- resources/arch-kb/ bin/`；>20MB 用 600s publish timeout；新增 v3 命令同步 `expectedV3Commands`；invocation 变更同步 `sync:docs-reference`。

## Related

- `[[knowhow-rcp-20260918-maestro-flow-release-closure-v0-5-87]]`
- `[[knowhow-rcp-20260718-maestro-flow-release-closure]]`
- Release notes：`docs/release-notes/.release-notes-v0.5.88.md`
- GitHub Release：https://github.com/catlog22/maestro-flow/releases/tag/v0.5.88
