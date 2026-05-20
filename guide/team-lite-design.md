---
title: "Maestro Team Lite 协作方案"
---

面向 2-8 人小团队的极简协作扩展。核心策略：**Git-native + 文件驱动 + advisory 协作**，零基础设施，向后兼容单机模式。

## 命名空间边界（重要）

| 路径 | 含义 | 归属 | 不要混用 |
|---|---|---|---|
| `.workflow/.team/` | **agent 流水线** 内部角色间消息总线 | `src/tools/team-msg.ts` | 只由 agent team pipeline 写 |
| `.workflow/collab/` | **人类团队协作** 的成员 / 活动 / 同步记录 | 本方案 | 只由 `maestro collab *` 命令写 |

CLI 命令仍叫 `maestro collab *`（用户感知友好），但磁盘布局用 `collab` 明确与 agent 域分开。两个域共享底层 JSONL 工具，但数据严格不互通。

<details>
<summary>砍掉的复杂概念（与 Claude 深度方案对比）</summary>

| 砍掉 | 理由 | 替代 |
|---|---|---|
| Relay/Broker 服务器 | 运维成本 + 单点故障 | Git 存储 |
| Actor 层级身份 | 概念抽象，理解成本高 | Git config（name + email） |
| Commander 仲裁 | 自动化冲突极易出错 | 活动预警 + 人工协调 |
| WebSocket / P2P 直连 | VPN/防火墙不稳定 | Hook 心跳 |
| K8s 风格 Phase 租约 | 小团队太重 | `activity.jsonl` 活跃度检测 |
| 跨机 Delegate Broker | 技术复杂 | 不支持，各机独立运行 |
| 三层同步 | 概念过载 | 单层 Git 同步 |

**v1 明确不做：**

| 不做 | 原因 |
|---|---|
| `locks.json` 建议锁 | 与 activity 预警重合；`--force` 可覆盖时锁无额外保证 |
| `pid` 字段 | 跨机无意义 |
| `members.json`（单文件） | JSON 无法 `merge=union`，per-member 文件消除合并冲突 |

</details>

## 保留的 4 件事

1. **身份识别** — 映射本地 Git 身份到 `.workflow/collab/members/{uid}.json`
2. **共享活跃日志** — 全团队 append-only JSONL，记录谁在做什么
3. **冲突预警** — `/maestro-plan` / `/maestro-execute` 启动前扫日志，发现同 phase 活动即提示
4. **一键同步** — `maestro collab sync` 封装 `git stash + pull --rebase + pop + push`

## 前置依赖

| 任务 | 改动 | 工作量 |
|---|---|---|
| P0.1 | `state.json` 增加 `current_task_id`，maestro-execute 进入/退出 TASK 时写入/清空 | 0.5d |
| P0.2 | 抽公共 `src/utils/jsonl-log.ts`（appendLine/readAll/tailLast/rotateIfLarge） | 0.5d |

## 数据模型

<details>
<summary>成员文件：.workflow/collab/members/{uid}.json</summary>

每个成员一个 JSON 文件，彻底消除 Git 合并冲突。`uid` 从 git config `user.email` 的 local-part 派生，冲突时追加数字后缀。

```json
{
  "uid": "alice",
  "name": "Alice",
  "email": "alice@example.com",
  "host": "alice-laptop",
  "role": "admin",
  "joinedAt": "2026-04-11T10:00:00Z"
}
```

</details>

<details>
<summary>活动日志：.workflow/collab/activity.jsonl</summary>

全团队共享的 append-only 活动总线，由 PostToolUse hook 自动追加。

```jsonl
{"ts":"2026-04-11T10:23:00Z","user":"alice","host":"alice-laptop","action":"maestro-plan","phase_id":3}
{"ts":"2026-04-11T10:24:15Z","user":"bob","host":"bob-desktop","action":"wiki-update","target":"spec-auth"}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `ts` | ✅ | ISO 8601 UTC |
| `user` | ✅ | members 目录中的 uid |
| `host` | ✅ | `os.hostname()` |
| `action` | ✅ | 命令名或工具名 |
| `phase_id` | 否 | 关联 phase |
| `task_id` | 否 | 关联 TASK（依赖 P0.1） |
| `target` | 否 | 操作目标 |

- **合并策略**：`.gitattributes` 配置 `merge=union`，行级并集合并
- **日志轮转**：> 10MB 或每周一 00:00 重命名为归档文件

</details>

## CLI 命令清单

| 子命令 | 说明 | 备注 |
|---|---|---|
| `maestro collab join` | 从 git config 读取，写入 `members/{uid}.json` | 幂等 |
| `maestro collab whoami` | 显示当前 uid / name / host / role | — |
| `maestro collab status` | 展示谁在做什么（按时间倒序） | 核心命令 |
| `maestro collab report` | 手动上报一条 activity | 通常由 hook 调用 |
| `maestro collab sync` | `git stash` → `pull --rebase` → `pop` → `push` + 轮转 | 核心命令 |
| `maestro collab preflight --phase N` | 冲突预扫描 | 见耦合点 3 |

### 使用示例

```bash
maestro collab join
# > Joined as alice <alice@example.com> on alice-laptop (admin)

maestro collab status
# > alice@alice-laptop  maestro-execute   phase 3 / TASK-001    2 min ago
# > bob@bob-desktop     wiki-update       spec-auth             5 min ago

maestro collab sync
# > Stashing... Pulling (rebase)... Pushing... Rotating (12.4 MB)... Done.

maestro collab preflight --phase 3
# > ⚠ Bob is active on phase 3 (maestro-plan, 3 min ago @ bob-desktop)  exit: 1
```

## 与现有工作流的耦合点

所有耦合通过"注入"实现，不修改现有命令代码。

### 耦合 1：PostToolUse Hook（零感知心跳）

- 新建 `bin/maestro-team-monitor.js`，按现有 hook 模式注册第三个 PostToolUse 入口
- 每次工具调用后异步 append 一行到 `activity.jsonl`
- Dedupe：同 `user+action+phase_id` 60s 内只写一条
- 写入失败静默忽略，exit 0

### 耦合 2：Statusline（队友可见性）

- 在 Claude Code 状态栏显示最近 30 分钟队友活动摘要
- 性能：只 `tailLast(activity.jsonl, 200)`，缓存 10s

### 耦合 3：Execution Gate（冲突预警）

- 提供 `maestro collab preflight` 子命令
- 算法：tail 最近 500 条 → 过滤同 phase + 非 self → 命中则 exit 1
- 调用方在 `<execution>` 顶部加 `Bash("maestro collab preflight --phase $ARGUMENTS || confirm")`

### 耦合 4：Commit Message 标签

- 仅作用于 `team sync` 自己生成的 commit，不触及用户手动 commit
- sync 需要 merge commit 时自动注入 `[P3][TASK-001]` 前缀

## 11 天实施清单

### Week 1：前置 + 身份 + 可见性（5d）

| 任务 | 说明 | 工作量 |
|---|---|---|
| P0.1 | state.json 扩展 | 0.5d |
| P0.2 | jsonl-log util | 0.5d |
| T1.1 | 身份命令（join/whoami） | 1d |
| T1.2 | 活动模块 + report CLI | 1d |
| T1.3 | 状态展示（status CLI UI） | 1d |
| T1.4 | team-monitor bin + hooks 注册 | 1d |

### Week 2：同步 + 预飞检 + Statusline（5d）

| 任务 | 说明 | 工作量 |
|---|---|---|
| T2.1 | 同步命令（stash/pull/pop/push） | 2d |
| T2.2 | 预飞检命令 | 1d |
| T2.3 | 命令注入（改 plan/execute md） | 0.5d |
| T2.4 | Statusline 集成 | 1.5d |

### Week 3：润色（1d）

| 任务 | 工作量 |
|---|---|
| Sync commit tag | 0.5d |
| 文档 + 验证 | 0.5d |

## 兼容性

- **未执行 `team join`**：`maestro collab *` 返回 "not enabled"；hook 静默 exit 0；现有命令 100% 不变
- **已 join 但独自工作**：心跳只写本地，status 只显示自己
- **多人不 sync**：各有独立 `activity.jsonl`，本地一致但不同步

## 参考

- `src/tools/team-msg.ts` — agent 域 JSONL 总线（不混用）
- `src/hooks/context-monitor.ts` + `bin/maestro-context-monitor.js` — PostToolUse hook 样板
- `src/hooks/delegate-monitor.ts` + `bin/maestro-delegate-monitor.js` — 第二个 hook 样板
- `src/commands/hooks.ts` — hook 安装逻辑
- `src/hooks/statusline.ts` — 状态栏
- `src/commands/wiki.ts` — CLI 子命令样板
- `docs/wiki-endpoint-design.md` — per-member 文件策略参考
