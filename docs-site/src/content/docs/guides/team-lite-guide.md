---
title: "Maestro Team Lite — 使用指南"
icon: "👥"
---

面向 2-8 人小团队的 Git-native 协作扩展。架构与设计理由见
[team-lite-design.md](./team-lite-design.md)，本文只讲「怎么用」。

## 快速开始

```bash
# 1. 确认 git 身份（uid 从 user.email 的 local-part 派生）
git config user.name && git config user.email

# 2. 登记成员（幂等）
maestro collab join

# 3. 启用 PostToolUse 心跳 hook
maestro hooks install --project
```

完成后 `maestro collab whoami` 应能打印你的 uid / host / role。每次调用工具时 `maestro-team-monitor` 会自动向 `activity.jsonl` 追加心跳。

## 日常工作流

```bash
maestro collab status              # 查看最近 30 分钟谁在做什么
maestro collab sync                # 一键同步（stash → pull --rebase → pop → push）
```

`/maestro-next` 和 `/maestro-ralph continue` 的模板已集成 preflight 调用，无需手动触发。

## 核心命令速查

| 命令 | 说明 | 示例 |
|------|------|------|
| `join` | 幂等注册 git 身份 | `maestro collab join` |
| `whoami` | 展开本地成员档案 | `maestro collab whoami` |
| `status [--window N]` | 最近 N 分钟队友活动（默认 30） | `maestro collab status` |
| `report --action <name>` | 手动上报 activity | `maestro collab report --action build --phase 3` |
| `sync [--dry-run] [--with-overlays]` | 一键同步 | `maestro collab sync` |
| `preflight --phase N [--force]` | 冲突预扫描 | `maestro collab preflight --phase 3` |

<details>
<summary>命令输出示例</summary>

```
$ maestro collab join
Joined as alice <alice@example.com> on alice-laptop (admin)

$ maestro collab status
Active in last 30 min:
  alice@alice-laptop    maestro-execute     P3/TASK-001    2 min ago
  bob@bob-desktop       wiki-update         spec-auth      5 min ago

$ maestro collab sync --with-overlays
Stashing local changes (maestro-team-sync-auto)...
Pulling from origin/HEAD (rebase)...
Pushing...
Importing team overlays...
  bob-bundle.json — imported (newer than local)
Sync complete.

$ maestro collab preflight --phase 3
⚠ bob@bob-desktop is active on phase 3 (last: maestro-execute, 4 min ago)
exit: 1
```

</details>

## Statusline

安装 hook 后，状态栏会出现队友段：

```
model | P3 | TASK-001 | ~/proj | 👥 alice (P3/001) | bob (spec-auth) +2
```

- `👥` 开头，最多展示 3 个最活跃队友
- `alice (P3/001)` — 在 phase 3 / TASK-001 活动
- `+2` — 还有 2 位被折叠

开启条件：已 join + activity.jsonl 有 30 分钟内非自身事件。缓存 10 秒。

## 冲突预警

`preflight --phase N` 会 tail 最近 500 条 activity，过滤同 phase 非自身心跳，命中则 exit 1。

**何时用 `--force` 绕过：**
- 已和队友协调确认
- 队友心跳是历史遗留（实际已停手）
- 临时补丁，范围不撞车

**不要用 `--force`**：拿不准、没人确认、对方 action 是 `maestro-execute`（正在动代码）。

## 增量同步 Fast Path

`team sync` 在完整流程前先做 SHA 比较：

| 场景 | 行为 | 耗时 |
|------|------|------|
| 本地 == 远端 | 跳过（SKIP） | < 1s |
| 本地领先远端 | 只 push（PUSH-ONLY） | fetch + push |
| 本地落后远端 | 只 pull（PULL-ONLY） | fetch + pull |
| 分叉 | 完整流程 | 正常耗时 |

`--dry-run` 打印 SHA 信息但不执行 git 操作。

## Overlay 团队共享

### 推送 overlay

```bash
maestro overlay push                  # 打包所有 overlay
maestro overlay push -n my-overlay    # 只推送指定 overlay
```

### 同步队友 overlay

```bash
maestro collab sync --with-overlays
```

扫描 `*-bundle.json`，跳过自己的，对比 `manifest.json` 中上次导入时间，只导入更新的。

<details>
<summary>目录结构</summary>

```
.workflow/collab/overlays/
├── alice-bundle.json     # alice 的 overlay 导出
├── bob-bundle.json       # bob 的 overlay 导出
└── manifest.json         # 各成员最后导入时间戳
```

`.gitignore` 通过 negation 规则打开此目录的 git 追踪。

</details>

## Spec 个人化（三层加载）

| 层 | 目录 | 用途 |
|----|------|------|
| Baseline | `.workflow/specs/` | 项目基线 spec（全员共享） |
| Team | `.workflow/collab/specs/` | 团队共享 spec |
| Personal | `.workflow/collab/specs/{uid}/` | 个人 spec 覆盖 |

```bash
maestro collab spec list              # 列出个人 spec 文件
maestro collab spec edit my-rules     # 创建/编辑个人 spec
```

个人 spec 在 agent 的 spec injection 中自动生效。

## 命名空间保护

Namespace Guard 防止误写队友文件。v1 为告警模式（advisory），不阻止操作。

每个成员只能写入：
- `.workflow/collab/members/{自己uid}.json`
- `.workflow/collab/specs/{自己uid}/` 下所有文件
- `.workflow/collab/overlays/{自己uid}-bundle.json`
- **共享**：`activity.jsonl`（追加）、`overlays/manifest.json`

```bash
$ maestro collab guard          # 查看边界
```

## 角色权限

首位成员默认 `admin`，后续为 `member`。敏感操作需 admin 权限。读操作和 `sync`、`join`、`status` 等日常命令对所有角色开放。

## 同步策略

**何时同步：** 新 phase 前、被 preflight 拦下、超过 2 小时没 pull。

| 问题 | 行为 |
|------|------|
| stash pop 冲突 | exit 4 停留，改动在 stash 中，手动解决后 `git add + commit` |
| rebase 失败 | 自动 `git rebase --abort` + `git stash pop` 恢复 |
| push 被拒 | 自动重试一次 pull --rebase + push，两次失败 exit 3 |

## 故障排查

| 问题 | 解决 |
|------|------|
| "Team mode not enabled" | 检查 `git config user.email` 有值 + `.workflow/collab/members/{uid}.json` 存在 |
| Hook 没触发 | `maestro hooks status` 检查 PostToolUse 是否含 `maestro-team-monitor.js` |
| 跨机同 uid 冲突 | join 自动追加数字后缀（`alice-2`） |
| 日志轮转 | 文件 > 10 MB 或每周一 00:00 自动轮转 |
| 清空活动 | `rm .workflow/collab/activity.jsonl`，下次心跳自动重建 |

## 与 agent 协作边界

`maestro team` 命令**只**读写 `.workflow/collab/`（人类协作域）。`.workflow/.team/` 是 agent 流水线内部消息总线，两者严格隔离。不要手工在 `.workflow/.team/` 下放东西。

## 测试说明

使用 vitest 运行测试（项目已从 node:test 迁移至 vitest）：

```bash
# 运行所有测试
npx vitest run

# 运行特定测试文件
npx vitest run src/utils/__tests__/jsonl-log.test.ts

# 运行 team 相关测试
npx vitest run --reporter=verbose src/tools/__tests__/team-members.test.ts \
  src/tools/__tests__/team-activity.test.ts \
  src/tools/__tests__/namespace-guard.test.ts \
  src/hooks/__tests__/team-monitor.test.ts \
  src/commands/__tests__/team-preflight.test.ts
```

端到端冒烟：`node scripts/team-lite-smoke.mjs`
