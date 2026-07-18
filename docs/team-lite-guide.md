# Maestro Team Lite — 使用指南

面向 2-8 人小团队的 Git-native 协作扩展。架构与设计理由见
[team-lite-design.md](./team-lite-design.md)，本文只讲「怎么用」。

## 快速开始

3 步加入你的团队：

```bash
# 1. 确认 git 身份已配置（uid 从 user.email 的 local-part 派生）
git config user.name  # 例: Alice
git config user.email # 例: alice@example.com

# 2. 登记成员（幂等，可重复跑）
maestro team join

# 3. 启用 PostToolUse 心跳 hook（per-project 写入 .claude/settings.json）
maestro hooks install --project
```

完成后，`maestro team whoami` 应能打印你的 uid / host / role。每次你在
Claude Code 里调用工具，`maestro-team-monitor` 会自动向
`.workflow/collab/activity.jsonl` 追加一条心跳。

## 日常工作流

```bash
# 查看谁在做什么（最近 30 分钟）
maestro team status

# 同步队友改动（stash → pull --rebase → pop → push）
maestro team sync

# 启动 /maestro-ralph 或 /maestro-ralph continue 前会自动跑 preflight，
# 如果队友在同一 phase 活动会打印警告并拒绝继续
```

`/maestro-ralph` 和 `/maestro-ralph continue` 命令的 markdown 模板已经集成了
preflight 调用，你不需要手工触发。

## 核心命令速查

**`maestro team join`** — 幂等注册当前 git 身份到
`.workflow/collab/members/{uid}.json`

```
$ maestro team join
Joined as alice <alice@example.com> on alice-laptop (admin)
```

**`maestro team whoami`** — 展开本地成员档案

```
$ maestro team whoami
uid:    alice
name:   Alice
email:  alice@example.com
host:   alice-laptop
role:   admin
joined: 2026-04-11T10:00:00.000Z
```

**`maestro team status [--window N]`** — 按时间倒序展示最近 N 分钟（默认 30）的队友活动

```
$ maestro team status
Active in last 30 min:
  alice@alice-laptop    maestro-ralph       P3/TASK-001    2 min ago
  bob@bob-desktop       wiki-update         spec-auth      5 min ago
```

**`maestro team report --action <name>`** — 手动上报一条 activity。通常
由 hook 调用，也可用在长跑脚本里：

```bash
maestro team report --action nightly-import --phase 3 --target etl-jobs
```

**`maestro team sync [--dry-run] [--with-overlays]`** — 一键同步（fast-path → stash → pull --rebase → pop → push）

```
$ maestro team sync
Fast-path: local and remote are identical. Nothing to do.

$ maestro team sync --with-overlays
Stashing local changes (maestro-team-sync-auto)...
Pulling from origin/HEAD (rebase)...
Pushing...
Importing team overlays...
  bob-bundle.json — imported (newer than local)
  charlie-bundle.json — skipped (already up-to-date)
Sync complete.
```

**`maestro team preflight --phase N [--force] [--json]`** — 冲突预扫描

```
$ maestro team preflight --phase 3
⚠ bob@bob-desktop is active on phase 3 (last: maestro-ralph, 4 min ago)
exit: 1
```

## Statusline

安装 hook 后，Claude Code 状态栏会出现队友段：

```
model | P3 | TASK-001 | ~/proj | 👥 alice (P3/001) | bob (spec-auth) +2
```

格式约定：
- `👥` emoji 开头，最多展示 3 个最活跃的队友
- `alice (P3/001)` — `alice` 在 phase 3 / TASK-001 活动
- `bob (spec-auth)` — `bob` 在操作 `spec-auth` 这个 target
- `+2` — 还有 2 位队友活动，但超出 inline 上限被折叠

开启条件：已执行 `maestro team join`（无成员档案则整段不显示），且
`activity.jsonl` 里存在 30 分钟内的非自身事件。结果缓存 10 秒以避免
statusline 刷新时把磁盘 IO 拉满。

## 冲突预警

`maestro team preflight --phase N` 会 tail 最近 500 条 activity，过滤出
同 phase 但非自身的心跳，命中则 exit 1。`/maestro-ralph` 与
`/maestro-ralph continue` 命令会在执行体前调用它，因此两人同时进入同一 phase 时
后进入者会看到警告。

什么时候用 `--force` 绕过：
- **你已经和队友协调过**（口头、IM 等），确认是合作而非冲突
- 队友的心跳是历史遗留（超过 30 分钟窗口内但实际已停手）
- 临时补丁类工作，你知道范围不会撞车

**不要用 `--force` 的场景**：拿不准、没人确认过、警告里的 action 是
`maestro-ralph`（意味着对方正在动代码）。

## 增量同步 Fast Path

`team sync` 在执行完整 stash/pull/push 流程前，会先做一次 SHA 比较
（`git fetch` + `git rev-parse`）。三种快速路径：

| 场景 | 行为 | 耗时 |
|------|------|------|
| 本地 == 远端 | 跳过，什么都不做（SKIP） | < 1s |
| 本地领先远端 | 只 push（PUSH-ONLY） | fetch + push |
| 本地落后远端 | 只 pull（PULL-ONLY） | fetch + pull |
| 分叉 | 走完整流程（stash → rebase → push） | 正常耗时 |

Fast path 是透明的——命中时打印原因，未命中时静默回退到完整流程。
`--dry-run` 模式下会打印 SHA 信息但不执行 git 操作。

## Overlay 团队共享

### 推送 overlay 给队友

```bash
# 打包你的 overlay 到 .workflow/collab/overlays/{uid}-bundle.json
maestro overlay push

# 只推送指定 overlay
maestro overlay push -n my-overlay another-overlay
```

bundle 文件会标记 `sourceMember` 和 `ts`（时间戳），队友在 `team sync
--with-overlays` 时自动导入比本地更新的 bundle。

### 同步队友 overlay

```bash
maestro team sync --with-overlays
```

同步流程会扫描 `.workflow/collab/overlays/` 下所有 `*-bundle.json`，
跳过自己的 bundle，对比 `manifest.json` 中记录的上次导入时间，只导入
更新的 bundle。导入使用已有的 `importBundle()` 机制。

### 目录结构

```
.workflow/collab/overlays/
├── alice-bundle.json     # alice 的 overlay 导出
├── bob-bundle.json       # bob 的 overlay 导出
└── manifest.json         # 各成员最后导入时间戳
```

`.gitignore` 通过 negation 规则打开此目录的 git 追踪，使 bundle 文件
能通过 `git push/pull` 在队友间传递。

## Spec 个人化（三层加载）

spec 加载支持三层目录扫描，内容按层追加（不替换）：

| 层 | 目录 | 用途 |
|----|------|------|
| Baseline | `.workflow/specs/` | 项目基线 spec（全员共享） |
| Team | `.workflow/collab/specs/` | 团队共享 spec |
| Personal | `.workflow/collab/specs/{uid}/` | 个人 spec 覆盖 |

无 uid（非团队模式）或无对应目录时，行为与原来单目录加载完全一致。

### 管理个人 spec

```bash
# 列出你的个人 spec 文件
maestro team spec list

# 创建/编辑个人 spec（自动补 .md 后缀，不存在则用模板创建）
maestro team spec edit my-rules
```

个人 spec 会在 agent 的 spec injection 中自动生效，不需要额外配置。

## 命名空间保护

Namespace Guard 防止队友间误写对方的协作文件。v1 为**告警模式**
（advisory），不会阻止操作，仅在 `team-monitor` hook 中打印警告。

### 可写范围

每个成员只能写入自己的命名空间：

- `.workflow/collab/members/{自己的uid}.json`
- `.workflow/collab/specs/{自己的uid}/` 下的所有文件
- `.workflow/collab/overlays/{自己的uid}-bundle.json`
- **共享路径**：`activity.jsonl`（追加）、`overlays/manifest.json`

写入其他成员的文件时，hook 会输出警告：
```
[NamespaceGuard] Blocked: write to bob.json by alice — file belongs to another member's namespace
```

### 查看边界

```bash
$ maestro team guard
Namespace boundaries for alice:

Writable paths (own namespace):
  .workflow/collab/members/alice.json
  .workflow/collab/specs/alice/
  .workflow/collab/overlays/alice-bundle.json

Shared writable paths:
  .workflow/collab/activity.jsonl
  .workflow/collab/overlays/manifest.json

Mode: advisory (warnings only, non-blocking)
```

## 角色权限

`team join` 默认赋予首位成员 `admin` 角色，后续成员为 `member`。
部分敏感操作需要 `admin` 权限，普通成员调用时会收到提示：

```
Error: This operation requires admin role. Your role: member
```

当前需要 admin 权限的操作会在未来版本中逐步明确。所有读操作和
`team sync`、`team join`、`team status` 等日常命令对所有角色开放。

## 同步策略

**什么时候跑 `team sync`**：
- 开始新 phase 前
- 被 preflight 拦下，想拿最新状态再判断
- 长时间没 pull（> 2 小时）

**stash pop 遇到 conflict**：`team sync` 会以 exit 4 停在冲突状态。你的
改动仍然在 stash 里（`git stash list` 能看到 `maestro-team-sync-auto`
条目）。手动解决后 `git add` + `git commit`，或 `git stash drop` 丢掉
本地改动。

**rebase 失败**：`team sync` 会自动 `git rebase --abort` 并尝试
`git stash pop` 恢复现场。如果你看到 `Warning: failed to restore stash`，
你的改动还在 stash 列表里，手动 `git stash pop` 即可。

**push 被拒**：`team sync` 会自动重试一次 pull --rebase + push。两次都
失败时 exit 3，保留 stash。查 `git log --oneline origin/HEAD..HEAD` 看
本地超前情况，必要时分批 push。

## 故障排查

**"Team mode not enabled"** — 你没跑过 `maestro team join`，或者当前工作
目录不是 git 仓库。验证：`git config user.email` 有值，且
`.workflow/collab/members/` 下存在 `{你的 uid}.json`。

**`activity.jsonl` 在哪里** — `.workflow/collab/activity.jsonl`。这是
团队共享的 append-only 日志，`.gitattributes` 里配置了 `merge=union` 所以
行级并集合并，很少出冲突。

**日志轮转** — 文件 > 10 MB 或每周一 00:00 会被重命名为
`.workflow/collab/activity-archives/activity-{YYYY}W{WW}.jsonl`。轮转由
`maestro team sync` 顺带检查，也可以手动 `maestro team sync --dry-run`
查看是否需要触发。

**清空某人的活动** — activity.jsonl 是 append-only 的，不要手编辑单行。
如需清空整个文件：`rm .workflow/collab/activity.jsonl`，下次心跳会自动
重建。

**Hook 没触发** — 跑 `maestro hooks status` 检查 PostToolUse 入口里是否
包含 `maestro-team-monitor.js`，没有则重跑 `maestro hooks install --project`。
hook 设计是静默失败，只能靠 `team status` 间接验证。

**跨机同 uid 冲突** — 两人 git email 的 local-part 相同时（`alice@a.com`
vs `alice@b.com`），join 会给后来者追加数字后缀（`alice-2`）。

## 与 agent 协作边界

`maestro team` 命令**只**读写 `.workflow/collab/` 目录——这是**人类
团队协作**的数据域。`.workflow/.team/` 目录是**agent 流水线**内部角色间
消息总线，由 `src/tools/team-msg.ts` 独占管理，两者严格不互通。

不要手工在 `.workflow/.team/` 下放东西，也不要让 `maestro team report`
写入 agent 域。命名重复是历史原因；磁盘布局已经隔离。详情见
[team-lite-design.md](./team-lite-design.md) 「命名空间边界」章节。

## 测试说明

全部 team-lite 测试使用 Node.js 内置 `node:test`：

```bash
npx tsx --test src/utils/__tests__/jsonl-log.test.ts \
  src/tools/__tests__/team-members.test.ts \
  src/tools/__tests__/team-activity.test.ts \
  src/tools/__tests__/namespace-guard.test.ts \
  src/tools/__tests__/spec-loader.test.ts \
  src/hooks/__tests__/team-monitor.test.ts \
  src/commands/__tests__/team-preflight.test.ts \
  src/hooks/__tests__/statusline-team.test.ts
```

> **注意**：这些测试必须用 `npx tsx --test` 运行，不要用 vitest。
> vitest 无法识别 `node:test` API 的测试套件。

端到端冒烟（自动 build + 临时 git 仓库 + 跑完所有子命令）：

```bash
node scripts/team-lite-smoke.mjs
```
