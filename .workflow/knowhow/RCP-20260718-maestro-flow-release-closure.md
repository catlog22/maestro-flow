---
title: "Maestro-Flow 发布闭环：dirty worktree、docsite 与 fresh consumer"
description: "从版本范围分析到 GitHub、npm、docsite 和 fresh consumer 验证的隔离发布配方"
type: recipe
category: release
created: "2026-07-18T14:15:00+08:00"
tags: [发布, 版本, 文档站, 构建验证, 包验证]
status: active
source: "v0.5.51"
---

# Maestro-Flow 发布闭环：dirty worktree、docsite 与 fresh consumer

## Goal

在保留现有未提交工作的前提下，把“版本范围分析 → Release Note → 版本与 docsite 同步 → fresh checkout 验证 → GitHub Release → npm publish → Pages 验证”闭合为可复现、可审计的发布流程，并保证 Git tag、npm tarball 与生成镜像一致。

## Prerequisites

- 当前目录是 `maestro-flow` canonical checkout，remote 指向 `catlog22/maestro-flow`。
- `gh auth status` 与 `npm whoami` 成功。
- 已安装满足 `engines.node` 的 Node.js；v0.5.51 使用 Node `22.22.0`、npm `11.7.0`。
- 已加载基础 recipe `Maestro-Flow Release 发布流程`；本配方补充 dirty worktree、docsite、fresh build、mirror 与 post-release proof。
- 发布者明确版本边界。用户说“从上版本到当前 commit”时，范围是 `v<previous>..HEAD`，不自动包含 working tree。

## Steps

### 1. 先加载知识，再核验实时状态

```bash
maestro search "发布流程" --type knowhow
maestro load --type knowhow --keyword "Maestro-Flow Release"
git fetch --tags origin
git status --short --branch
git remote -v
git tag --sort=-version:refname
npm view maestro-flow version dist-tags --json
npm whoami
gh auth status
gh release list --limit 10
```

不要从旧 memory 或相邻仓库复制版本号。npm registry、Git tag、GitHub Release 和当前 package manifest 必须现场复核。

### 2. 冻结发布范围并量化变更

```bash
git rev-list --count v<previous>..HEAD
git log v<previous>..HEAD --reverse --date=short --pretty=format:'%h%x09%ad%x09%s'
git diff v<previous>..HEAD --shortstat
git diff v<previous>..HEAD --numstat
```

按 `feat`、`fix`、`refactor`、`docs`、`chore`、`test` 分类；同时按 top-level scope 汇总 file/addition/deletion。Release Note 要标明统计范围的终点 commit，避免把后续 release-preparation commits 混入产品统计。

### 3. dirty worktree 使用双工作区策略

如果主工作区有大量未提交修改：

1. 在主工作区只提交发布元数据或必要的最小修复；对已脏文件使用 partial staging，禁止整文件误提交。
2. 从 release commit 创建 detached clean worktree：

```bash
git worktree add --detach D:/maestro2-release-vX.Y.Z-<sha> <release-sha>
```

3. 在 clean worktree 安装依赖、构建、生成镜像、pack、publish。
4. 如果生成文件会与主工作区未提交内容冲突，在 clean worktree 创建 `release/vX.Y.Z` 分支并提交生成结果；从该分支 fast-forward 推送 `origin/master`。

此策略保证 npm 不会意外打包 working tree 的未来改动，也不会为了发布而 stash/reset 用户内容。

### 4. 同步所有可见版本面

至少同步：

- root `package.json`；
- root `package-lock.json` 的顶层 `version` 与 `packages[""]`；
- `docs-site/package.json`；
- `docs-site/package-lock.json` 的顶层 `version` 与 `packages[""]`；
- `docs-site/src/client/pages/ChangelogPage.tsx` 最新条目；
- docsite `Latest` badge 使用数组首项 `index === 0`，不得硬编码某个旧版本；
- `.release-notes-vX.Y.Z.md`；
- prepublish 生成的 tracked mirror version。

docsite TopBar 的绿色版本标签来自 `docs-site/package.json`，由 `vite.config.ts` 注入 `__APP_VERSION__`；修改 root package version 不会自动更新它。

### 5. Release Note 使用证据化结构

Release Note 至少包含：

1. Overview 与 Full Changelog URL；
2. Highlights；
3. Features / Bug Fixes / Refactors / Documentation；
4. Compatibility Notes；
5. Changed Files Summary；
6. 每个重要条目的短 commit hash 与 scope；
7. 产品统计范围和 release-preparation commits 的边界声明。

### 6. clean checkout 安装与构建

```bash
npm ci --no-audit --no-fund
cd docs-site && npm ci --no-audit --no-fund && npm run build
cd ..
npm run lint
npm run build
npm run build:mirrors
git status --short
```

`npm run build` 必须在没有旧 `dist/` 的 fresh checkout 中通过。v0.5.51 暴露的陷阱是 dashboard server 先编译，却通过包名 `maestro-flow` 读取尚未生成的 root `dist`；正确修复是使用 shared-core source-relative imports，不能调整为依赖残留构建产物。

### 7. mirror 必须二次生成零 diff

第一次 `npm run build:mirrors` 可能更新 tracked `.codex/skills/*/SKILL.md` 的版本或 contract。提交这些生成结果后再次运行：

```bash
npm run build:mirrors
git status --short
```

成功标准是 `updated 0 Codex skills` 且 tracked diff 为空。否则 npm prepublish 生成的内容会与 Git tag 不一致。

### 8. 区分 required gate 与 baseline failures

```bash
npm test
npm run lint
npm run build
npm run build:mirrors
npm publish --dry-run --json
```

- `lint`、root build、docsite build、mirror lint、publish dry-run 和 fresh consumer 是发布阻断 gate。
- full test 失败必须记录准确计数和失败族；不能写“全绿”。
- 若失败集中在已知 Windows/Vitest harness（dynamic import cache-bust、临时目录 Git 假设、陈旧 fixture/断言、固定 5 秒 timeout），应与产品回归分开，但仍需在发布记录中公开。
- 如果失败指向发布改动、build、pack、manifest 或 runtime import，则必须修复后再发。

v0.5.51 记录：116 个 test file 中 106 个通过、10 个失败；1,817 个 test 中 1,602 个通过、162 个 skipped、53 个失败。失败为既有 harness/fixture 基线，发布阻断 gates 全部通过。

### 9. dry-run 与 fresh consumer

```bash
npm publish --dry-run --json
npm pack --silent
```

在新目录安装本地 tarball，并验证：

```bash
npm init -y
npm install D:/path/to/maestro-flow-X.Y.Z.tgz --no-audit --no-fund
node --input-type=module -e "import('maestro-flow').then(m => console.log(Object.keys(m).length))"
node node_modules/maestro-flow/bin/maestro.js --version
```

同时读取安装包内 `package.json` 和 `.codex/skills/Maestro/SKILL.md`，确认两者都是目标版本。v0.5.51 的 proof 为 29 个 ESM exports、CLI `0.5.51`、Codex skill version match。

### 10. push、tag、GitHub、npm 的顺序

```bash
git merge-base --is-ancestor origin/master HEAD
git push origin HEAD:master
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file .release-notes-vX.Y.Z.md
npm publish
```

在创建 tag/release/publish 前分别确认目标不存在。任何一步失败都停止后续不可逆操作并保留已完成状态，恢复时先读 remote/registry，而不是重复创建。

### 11. 五路发布后验证

```bash
npm view maestro-flow@X.Y.Z version dist.integrity dist.shasum dist.tarball --json
npm view maestro-flow dist-tags --json
git ls-remote origin refs/heads/master refs/tags/vX.Y.Z
gh release view vX.Y.Z --json tagName,name,publishedAt,url,targetCommitish
gh run list --workflow deploy-docs.yml --branch master --limit 5 --json databaseId,status,conclusion,headSha,url
git status --short --branch
```

额外从 registry tarball 做一次 fresh install 最可靠；本地 monorepo resolution 和旧 `dist` 都可能掩盖发布缺陷。

### 12. 发布完成后 capture knowhow

把本次实际命令、修复、gate 结果、registry integrity、GitHub workflow run 和坑点写入新的 recipe。先做 exact/near duplicate search；不要覆盖旧条目。知识文件提交到 `master`，但 tag 保持指向已验证的 release commit。

## Expected Outcome

- `origin/master` 包含 release commit，annotated tag 指向相同已验证 commit。
- GitHub Release body 来自 repo 内 Release Note 文件。
- npm `latest` 指向目标版本，integrity 与 dry-run 一致。
- docsite Pages workflow 在 release head 上成功。
- fresh consumer 能 import package、执行 CLI，并读取正确的 mirror version。
- 原 dirty worktree 的未提交内容没有丢失或混入 tarball。
- 新 recipe 可被 `maestro search --type knowhow` 检索。

## Common Pitfalls

- **只在旧工作区 build**：残留 `dist` 会掩盖 fresh checkout 的 self-import/build-order 缺陷。
- **直接从 dirty worktree publish**：npm 会打包未提交内容，tag 与 registry 不一致。
- **只 bump root package**：docsite TopBar 仍显示旧版本，lock 和 mirror 也会漂移。
- **先 tag 后生成 mirrors**：prepublish 修改 tracked package 内容，GitHub source 与 npm 不同。
- **把 dry-run 当真实发布**：必须再次查询 registry `dist-tags` 和目标版本。
- **只看命令 exit code，不看 git diff**：生成脚本可成功退出但留下 tracked diff。
- **声称 full tests 全绿**：应报告准确 pass/fail/skip 计数并区分 baseline 与 regression。
- **在 PowerShell 中直接内联大 Release Note**：使用 `gh release create --notes-file`，避免引号和换行转义。

## Related

- `[[knowhow-rcp-20260712-maestro-flow-release]]` — 基础发布流程。
- GitHub Release: https://github.com/catlog22/maestro-flow/releases/tag/v0.5.51
- npm: https://www.npmjs.com/package/maestro-flow/v/0.5.51
- GitHub Pages run: https://github.com/catlog22/maestro-flow/actions/runs/29633500812
