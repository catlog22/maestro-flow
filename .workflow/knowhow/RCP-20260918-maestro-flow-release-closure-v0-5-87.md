---
title: "Maestro Flow v0.5.87 发布闭环：run rebind/contract drift、help catalog v2.0 与 npm 读侧传播延迟"
type: recipe
created: 2026-09-18T06:45:00.000Z
keywords:
  - 发布
  - 版本
  - run-rebind
  - contract-drift
  - help-catalog
  - npm-propagation
lifecycleStatus: active
relatedPaths:
  - docs/release-notes/.release-notes-v0.5.87.md
  - src/run/v3/mutation-engine.ts
  - src/run/runtime.ts
  - src/commands/help-json.ts
  - scripts/check-session-run-release-machine.mjs
---

# Maestro Flow v0.5.87 发布闭环：run rebind/contract drift、help catalog v2.0 与 npm 读侧传播延迟

## Goal

把工作区 WIP 按逻辑分 3 批提交（v3 run rebind + diagnostic contract drift + output_contract；help --json catalog v2.0 + argv 校验；Windows windowsHide），连同此前已合并未发布的 36 个 commit 一起发布为 `maestro-flow@0.5.87`。修复两处发布门禁后 prepublishOnly 全过，npm publish 一次成功（但 registry 读侧延迟约 8 分钟），五路验证全过。

## Release Identity

- previous tag：`v0.5.86`（`b786812b`，peeled `bf4a4f54`）
- product range：`v0.5.86..63e547f7`（39 product commits，177 files / +7051 / -1096）
- 版本期提交：`dd10fe93` chore(release): prepare v0.5.87（38 files：六处版本面 + 32 codex mirrors + ChangelogPage + release notes）
- 门禁修复：`9b6781fb` docs(commands) resync reference.md；`5968d6dd` fix(release-machine) add run rebind to expected v3 help catalog
- final release commit：`5968d6ddb5d74454e4766596dd5ed36b06a5b4bd`
- annotated tag：`v0.5.87`（remote peeled = `5968d6dd`）
- GitHub Release：https://github.com/catlog22/maestro-flow/releases/tag/v0.5.87（published 2026-09-18T06:27:57Z，非 draft，非 prerelease）
- npm：https://www.npmjs.com/package/maestro-flow/v/0.5.87（latest=0.5.87）

## Knowledge-First Discovery

- `RCP-20260906-maestro-flow-v0-5-86-knowledge-evidence-`（上一闭环：:start-end 证据锚点 + --session 身份边界；npm publish 600s timeout 教训）
- `RCP-20260718-maestro-flow-release-closure`（基础发布闭环：版本面清单、dirty worktree 双工作区、五路验证）

## Product Scope（39 commits，177 files / +7051 / -1096）

1. **v3 run rebind + contract drift 治理**（`b39ccf3b`）：Run 创建时捕获 `command_contract_hash`；`run rebind` 变更把漂移 Run 重绑到当前契约；`checkRun`/`briefRun` 以 diagnostic 模式解析契约，报告 `contract_drift` 与结构化 `output_contract`（declared/observed/missing/mismatches/unexpected）而不再抛错。
2. **help --json catalog v2.0**（`a95b1d23`）：逐命令 `option_specs`（names/required/value_arity/repeatable/choices）与 `positionals`；`validateArgvAgainstCatalog` 预检校验器（UNKNOWN_OPTION/MISSING_VALUE/EXCESS_POSITIONAL/MISSING_REQUIRED/UNKNOWN_COMMAND + 编辑距离建议）。
3. **Windows windowsHide**（`63e547f7`）：`getGitHead` 改 `execFileSync` + `windowsHide`，`readGitStatus` 传 `windowsHide`，消除控制台窗口闪烁。
4. **此前已合并 PR**：Grok Build CLI 适配、Goal 对齐宿主 /goal + Statusline 默认开启、knowledge-guard hook、instruction kernel 精简、KG 根分裂/daemon 死 pid/delegate worker 入口/Windows 测试门禁等修复。

## Required Gates

主仓 `npm run prepublishOnly` 全过：arch-kb 80 entries、invocation policy、execution + session-run prompt lint、docs-reference sync（修复后）、contract parity、search-ranking source + built attestation、release-machine（修复后）、mirrors 32 skills + 29 agents、packaged-install smoke v3 chain、skill surface 100 invocations。

## Package Proof

从 release commit `5968d6dd` 创建 detached worktree `D:/maestro2-rel-v0.5.87`，worktree 内真实 `npm ci`（root 347 包 + docs-site 231 包）。`npm run build`（dashboard tsc → root tsc）+ `npm run lint` 全过后 pack：

```text
filename: maestro-flow-0.5.87.tgz
size: 20,979,790 B（约 21.0 MB）
files: 4641
shasum: 361bf77e418be9ebef5f7f4bb642197d664df567
integrity: sha512-ns22GV8oHBwDMpFBD20riX5QVI0fj7BqmE8FtD5Aupf8Mo7xslg3SDk7a8pVaRZX01wZRXS48+PPW8u1CzZXqw==
```

包内容断言：`.cache=0`、`.pyc=0`、`resources/arch-kb/index.json=1`、`dist/src/index.js` + `bin/maestro.js` 存在、32/32 codex skill 版本戳=0.5.87、0 个 0.5.86 残留。

Fresh consumer：`npm init` + `npm install <tgz>`（284 pkgs）→ `import('maestro-flow')` = 49 ESM exports → `bin/maestro.js --version` = 0.5.87 → 安装包 `package.json`/codex `maestro/SKILL.md` version = 0.5.87。

## Publish and Verification

1. push master（`912c07c0..5968d6dd`）；
2. annotated tag `v0.5.87` 创建并推送，`git ls-remote` peeled = `5968d6dd`；
3. `gh release create v0.5.87 --title v0.5.87 --notes-file docs/release-notes/.release-notes-v0.5.87.md`；`gh release view` 确认 published/非 draft/非 prerelease；
4. `npm publish ./maestro-flow-0.5.87.tgz --access public` 一次成功（600s timeout），但 registry 读侧延迟约 8 分钟才可见；
5. 五路验证全过：
   - `npm view maestro-flow@0.5.87 dist.shasum` = `361bf77e...` / `dist.integrity` = `sha512-ns22GV...` 与本地 pack 字节级一致；
   - `npm view maestro-flow dist-tags.latest` = 0.5.87；
   - `git ls-remote origin master` = `5968d6dd` + tag peeled = `5968d6dd`；
   - `gh release view v0.5.87` = published / non-draft / non-prerelease（2026-09-18T06:27:57Z）；
   - Deploy Docs Site workflow 在 `5968d6dd` 上 conclusion=success（run 35314966237）。

## Problems Found and Durable Fixes

### 1. `check:docs-reference` 门禁失败（reference.md 漂移）

**现象**：prepublishOnly 在 `check:docs-reference` 失败：`reference.md is out of sync with inventory-v2.json + .claude/commands/`。

**根因**：`maestro-knowledge` 命令的 invocation 描述从 "Explicit routing or user slash command" 变为 "Automatic entrypoint and explicit slash command"（instruction kernel 重构引入），docs reference 未同步。

**修复**：`npm run sync:docs-reference` 重新生成，`9b6781fb` 提交。

**清单增量**：prepublishOnly 前先跑 `npm run check:docs-reference`；instruction kernel/invocation policy 变更后必须同步 docs reference。

### 2. `check:session-run-release-machine` 期望清单缺 `run rebind`

**现象**：release machine 断言 `help --json` 命令清单 deepEqual 失败，actual 多出 `run rebind`。

**根因**：新增 `run rebind` 命令后，`scripts/check-session-run-release-machine.mjs` 的 `expectedV3Commands` 硬编码清单未更新。

**修复**：清单插入 `'run rebind'`（`5968d6dd`）。

**清单增量**：新增/退役 v3 命令时同步 `expectedV3Commands`；该清单按字典序排列。

### 3. npm publish 返回成功但 registry 读侧延迟约 8 分钟

**现象**：`npm publish` 输出 `+ maestro-flow@0.5.87` 成功，但随后 6 分钟内 `npm view maestro-flow@0.5.87` 持续 E404、`dist-tags.latest` 仍为 0.5.86；重试 publish 报 "cannot publish over previously published versions"。

**根因**：npm registry 写侧已提交，读侧（CDN/复制）传播延迟；21 MB 大包更明显。

**修复**：无需修复；等待约 8 分钟后 `dist-tags.latest` = 0.5.87、shasum/integrity 与本地一致。

**清单增量**：publish 成功后 E404 不等于失败——先用第二次 publish 的 "cannot publish over" 或 `npm view` 轮询确认写侧状态，不要急于重发；读侧可见前不要宣布验证失败。

### 4. `npm run lint` 依赖 dashboard 先编译（顺序陷阱）

**现象**：clean worktree 中先跑 `npm run lint`（`tsc --noEmit`）报大量 `Cannot find module '#maestro-dashboard/wiki/*'`。

**根因**：`#maestro-dashboard/*` import 映射到 `dashboard/dist-server/*`，必须先由 `npm run build` 内的 `cd dashboard && npx tsc -p tsconfig.node.json` 生成。

**修复**：先 `npm run build` 再 `npm run lint`。

**清单增量**：clean worktree 验证顺序固定为 `npm ci` → `npm run build` → `npm run lint` → `npm pack`；lint 不能脱离 build 单独作为首道门禁。

### 5. 后台管道 `| tail` 掩盖真实退出码

**现象**：`npm run prepublishOnly 2>&1 | tail -40` 在门禁失败时仍返回 exit 0（tail 的退出码）。

**修复**：`set -o pipefail && npm run prepublishOnly 2>&1 | tail -N`。

**清单增量**：所有后台门禁命令必须 `set -o pipefail`，否则失败被 tail 吞掉。

## Reusable Checklist 增量（v0.5.87）

1. **新增 v3 命令**：同步 `scripts/check-session-run-release-machine.mjs` 的 `expectedV3Commands`（字典序）。
2. **invocation/entrypoint 变更**：同步 `npm run sync:docs-reference`。
3. **npm publish 后 E404**：是读侧传播延迟，用重复 publish 的 "cannot publish over" 判定写侧已入；等待 ~8 分钟再验证。
4. **clean worktree 顺序**：`npm ci` → `build` → `lint` → `pack`；lint 依赖 dashboard dist-server。
5. **后台门禁**：`set -o pipefail` + `| tail`，否则 exit code 失真。
6. 其余沿用 v0.5.86 清单：>20MB tarball 用 600s publish timeout；pack 前 `git checkout -- resources/arch-kb/ bin/` 恢复构建噪音。

## Related

- `[[knowhow-rcp-20260906-maestro-flow-v0-5-86-knowledge-evidence-]]`
- `[[knowhow-rcp-20260718-maestro-flow-release-closure]]`
- Release notes：`docs/release-notes/.release-notes-v0.5.87.md`
- GitHub Release：https://github.com/catlog22/maestro-flow/releases/tag/v0.5.87
