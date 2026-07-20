---
title: "Maestro Flow v0.5.53 发布闭环：Quick 退休、clean checkout 与包纯净性"
description: "记录 v0.5.53 从产品范围冻结、发布门禁、Windows fresh checkout 修复到 npm、GitHub、Pages 和 registry consumer 验证的完整证据"
type: recipe
category: release
created: "2026-07-20T10:45:00+08:00"
tags: [发布, Companion, Quick退休, clean-checkout, npm, GitHub-Pages]
status: active
source: "v0.5.53"
---

# Maestro Flow v0.5.53 发布闭环

## Goal

把 Session/Run 1.3 与 Quick → Companion 路由重构发布为 `maestro-flow@0.5.53`，并证明 Git tag、npm tarball、docs-site 和 fresh consumer 使用同一 release commit。发布必须排除 `.pyc` 与退休的 first-tier Quick 资产，同时保留 19 个正式 `prepare` contract。

## Release Identity

- previous tag：`v0.5.52`
- product range：`v0.5.52..92bcd3ba`
- product range statistics：30 commits，554 files，14,789 insertions，7,178 deletions
- release commit：`4eeaf2e9b504785e35e90112ecf403ae884735c6`
- release preparation：`2ead96dc`（version / changelog / notes）、`60278f8c`（CRLF-safe docs reference check）、`4eeaf2e9`（generated mirror EOL contract）
- annotated tag：`v0.5.53`
- Node.js / npm：`v22.22.0` / `11.7.0`
- GitHub Release：<https://github.com/catlog22/maestro-flow/releases/tag/v0.5.53>
- npm：<https://www.npmjs.com/package/maestro-flow/v/0.5.53>

## Required Gates

发布前在 canonical checkout 与 detached clean worktree 中执行：

```bash
npm run prepublishOnly
npm --prefix docs-site run build
npm pack --json
```

通过结果：

- invocation policy lint：只允许 `maestro-next`、`maestro`、`maestro-ralph`、`maestro-companion` 自动入口；
- Session/Run prompt lint：18 commands、45 skills；
- Session/Run contract parity：17/17；
- root TypeScript build、release-machine parity、mirror parity、docs reference 均通过；
- docs-site：2,382 modules transformed，production build 通过；
- `build:mirrors`：`updated 0 Codex skills`，24 Codex agents parity 通过，tracked diff 为空。

full test 不是全绿：150 个 test files 中 132 个通过；2,056 个 tests 中 1,994 个通过、62 个失败。失败主要属于已知 Windows / Vitest harness baseline；本次修复的陈旧断言定向测试为 25/25 通过。发布阻断 gates 与 clean consumer runtime 均通过。

## Package Proof

最终包从 `4eeaf2e9` detached clean worktree 生成，并直接发布同一份已验证 tgz：

```text
filename: maestro-flow-0.5.53.tgz
size: 6,259,777 bytes
unpacked: 33,390,599 bytes
files: 5,072
shasum: c654d5aff45b88a730ff242ae20d6cf550a77103
integrity: sha512-bNXw1nAvVNRNThr9TDeE/Wo5oofpsCDWmAeoHdWG4VMCsaGjJ6PRdar5D6qSgmww54tiGkRWNfArR3jrPT1Qbw==
```

包内容断言：

- `.pyc = 0`；
- first-tier Quick assets = 0；
- Companion assets = 4：`.claude` command，以及 `.codex`、`.agy`、`.agents` skills；
- `prepare` contracts = 19；
- `.codex/skills/Maestro/SKILL.md` version = `0.5.53`。

本地 tgz fresh consumer 与 registry fresh consumer 都通过：ESM import 29 exports、CLI `--version = 0.5.53`、package / skill version 一致、Quick 不存在、Companion 完整、`.pyc = 0`。registry consumer lockfile 的 `resolved` 指向 npm tarball，integrity 与发布前 tgz 完全相同。

## Problems Found and Durable Fixes

### 1. Python cache 污染 npm package

dirty checkout 的 pack 首先包含 2 个 `ui-search` tracked `.pyc`，继续检查又发现 swarm mirrors 中 16 个 `.pyc`。宽泛 `git clean -fX -- '*.pyc'` 的 dry-run 会扩大到整个 ignored 目录，不能执行。

安全做法：

1. 用 `npm pack --dry-run --json` 枚举确切 package paths；
2. `git rm` tracked `.pyc`；
3. 对每个 ignored/generated 文件使用精确 `-LiteralPath` 删除；
4. 重新 `build:mirrors` 与 pack，断言 `.pyc = 0`。

### 2. Windows fresh checkout 暴露 raw EOL parity bug

canonical checkout 的生成缓存让 gates 通过，但 detached fresh checkout 首先在 `check:docs-reference` 失败，随后 `build:mirrors` 将 63 个 Codex skills 和 24 个 Codex agents 误判为 stale。根因是 generated content 使用 LF，而 Git fresh checkout 在 Windows 写为 CRLF，checker 做 raw byte/string comparison。

耐久修复：

- `sync-docs-reference.mjs --check` 比较前统一 `CRLF/CR` 为 LF；
- `.gitattributes` 对 `*.md` 与 `*.toml` 固定 `text eol=lf`；
- 删除并重建 detached worktree，重新 `npm ci`，证明 `prepublishOnly` 与 docs build 都从零通过。

### 3. dirty pack 与 clean pack 的内容数量不同

dirty checkout pack 一度有 5,812 files，而 clean release commit pack 为 5,072 files。差异说明 ignored/generated 文件可能被 npm 的 package inclusion 规则带入；不能把 canonical checkout 的 dry-run 当作最终 provenance proof。

最终 publish 使用 clean worktree 生成且已 fresh-install 验证的确切 tgz，而不是重新从 dirty checkout 打包。

## Publish Sequence

1. 确认 npm `0.5.53`、本地/远端 `v0.5.53`、GitHub Release 均不存在；registry latest 为 `0.5.52`。
2. 确认 `origin/master...master = 0 33`，远端没有独有提交。
3. push `master` 到 `4eeaf2e9`。
4. 创建并 push annotated tag `v0.5.53`。
5. 用 `.release-notes-v0.5.53.md` 创建 GitHub Release。
6. `npm publish ./maestro-flow-0.5.53.tgz --access public` 发布已验证 tarball。

## Post-release Verification

- npm version / latest：`0.5.53`；
- npm shasum / integrity：与 clean pack 一致；
- `origin/master`：`4eeaf2e9b504785e35e90112ecf403ae884735c6`；
- GitHub Release：published、非 draft、非 prerelease；
- Docs workflow：`Deploy Docs Site` run `29712893991`，release head `4eeaf2e9`；发布收口时因 GitHub Actions critical incident（<https://stspg.io/w8d77c7t94zf>）仍在 hosted runner 队列，Pages / browser acceptance 待服务恢复后由标准 workflow 自动继续；
- registry fresh consumer：package / CLI / Codex skill `0.5.53`，ESM 29 exports，Quick = 0，Companion = complete，prepare = 19，`.pyc = 0`。

release closure knowhow 在发布后作为单独 commit 推到 `master`；`v0.5.53` tag 保持指向已验证 release commit `4eeaf2e9`。

## Reusable Checklist

1. 冻结 product range，不把 release-preparation commits 混入产品统计。
2. 在 dirty checkout 先做 package path audit，不只看 tests/build。
3. release metadata 和 mirrors 提交后，从该 commit 建 detached clean worktree。
4. clean worktree 中重新 `npm ci`、root prepublish、docs build、pack。
5. 安装本地 tgz 验证，再发布 exact tgz。
6. npm 发布后从 registry 创建第二个 fresh consumer，核对 lockfile provenance 与 integrity。
7. 验证 remote master/tag、GitHub Release、npm dist-tag/integrity、Pages workflow。
8. 最后补录 closure knowhow；closure commit 不移动 release tag。

## Related

- `[[knowhow-rcp-20260718-maestro-flow-release-closure]]` — 基础 dirty worktree / docsite / fresh consumer 发布闭环。
- Release notes：`.release-notes-v0.5.53.md`
- GitHub Actions：<https://github.com/catlog22/maestro-flow/actions/runs/29712893991>
