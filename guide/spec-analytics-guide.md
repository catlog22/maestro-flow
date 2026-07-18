---
title: "Spec 分析系统指南"
---

Spec 分析系统记录每次 spec 注入调用、关键词匹配、hook 执行和 CLI 端点使用，提供命中率统计和关键词热力分布。

---

## 概览

Spec 注入系统在 agent 创建和 prompt 转换时自动注入项目规范。分析系统回答：
- 哪些 spec 被命中？哪些从未使用？
- 关键词匹配的准确率如何？
- context budget 是否频繁触发降级？
- 哪些 agent type 的注入成功率最低？

### 架构

```
采集层（同步、不抛异常）
  spec-injector ─────┐
  keyword-spec-injector ─┤
  spec-injection-plugin ─┤──> .workflow/spec-analytics.jsonl
  SpecAnalyticsPlugin ───┤     (JSONL append-only, 5MB 轮转)
  子进程 Hook 追踪 ──────┤
  CLI 端点追踪 ──────────┘
                              │
消费层                        ▼
  CLI summary  ·  TUI Panel (5 views)  ·  computeStats
```

---

## 日志数据模型

日志文件 `.workflow/spec-analytics.jsonl` 包含三种条目类型。

### 注入事件 (`type: "injection"`)

<details>
<summary>完整字段示例</summary>

```json
{
  "type": "injection",
  "id": "SINJ-1715788800000-1",
  "timestamp": "2026-05-15T12:00:00.000Z",
  "source": "spec-injector",
  "agentType": "code-developer",
  "promptSnippet": "Implement the user authentication...",
  "categories": ["coding", "learning", "ui"],
  "specCount": 12,
  "budgetAction": "full",
  "contentLength": 4520,
  "inject": true,
  "reason": null,
  "matchedKeywords": ["auth", "jwt"],
  "matchedEntryIds": ["entry-001", "entry-002"],
  "inferredCategory": "coding"
}
```

</details>

| 关键字段 | 用途 |
|---------|------|
| `source` | 区分调用来源（spec-injector / keyword-spec-injector / plugin） |
| `agentType` | 分析哪些 agent 触发注入 |
| `inject` | 计算命中率 |
| `reason` | 诊断注入失败根因 |
| `matchedKeywords` | 分析关键词匹配效果 |

**失败原因：**

| reason | 含义 | 改进方向 |
|--------|------|---------|
| `no-categories` | agent type 无 category 映射 | 添加映射到 `AGENT_CATEGORY_MAP` |
| `no-content` | 所有 category 的 spec 内容为空 | 检查 spec 文件内容 |
| `budget-skip` | context budget 不足 | 减少 `maxContentLength` |
| `no-keyword-match` | 关键词未命中 | 扩展 entry 的 `keywords` |
| `all-deduped` | 已在本 session 注入过 | 正常现象 |

### CLI 事件 (`type: "cli"`) 和 Hook 事件 (`type: "hook"`)

<details>
<summary>CLI 事件示例</summary>

```json
{
  "type": "cli",
  "id": "CLI-1715788800000-2",
  "timestamp": "2026-05-15T12:00:01.000Z",
  "command": "maestro-spec load",
  "args": { "category": "coding", "scope": "project" }
}
```

追踪命令：`maestro-spec load` · `spec list` · `spec init` · `maestro-spec add` · `spec analytics` 等

</details>

<details>
<summary>Hook 事件示例</summary>

```json
{
  "type": "hook",
  "id": "HOOK-1715788800000-3",
  "timestamp": "2026-05-15T12:00:02.000Z",
  "hookName": "spec-injector",
  "pluginName": "subprocess",
  "outcome": "success",
  "durationMs": 45,
  "data": { "event": "PreToolUse", "matcher": "Agent", "level": "minimal" }
}
```

**追踪的子进程 Hook（11 个）：**

| Hook | 事件 | 级别 |
|------|------|------|
| `spec-injector` | PreToolUse [Agent] | minimal |
| `keyword-spec-injector` | UserPromptSubmit | standard |
| `skill-context` | UserPromptSubmit | standard |
| `session-context` | Notification | standard |
| `delegate-monitor` | PostToolUse [Bash\|Agent] | standard |
| `workflow-guard` | PreToolUse [Bash\|Write\|Edit] | full |

**追踪的 Coordinator Hook（9 个）：** `beforeRun` · `afterRun` · `beforeNode` · `afterNode` · `beforeCommand` · `afterCommand` · `onError` · `transformPrompt` · `onDecision`

</details>

---

## 采集点

| # | 采集点 | 文件 | 记录内容 |
|---|--------|------|---------|
| 1 | spec-injector | `src/hooks/spec-injector.ts` | 4 个 return 路径：inject true/false + reason |
| 2 | keyword-spec-injector | `src/hooks/keyword-spec-injector.ts` | 5 个 return 路径 + matchedKeywords + dedup |
| 3 | spec-injection-plugin | `src/hooks/plugins/spec-injection-plugin.ts` | inferredCategory + promptSnippet |
| 4 | SpecAnalyticsPlugin | `src/hooks/plugins/spec-analytics-plugin.ts` | 全部 9 个 coordinator hooks |
| 5 | 子进程 Hook 追踪 | `src/commands/hooks.ts` | hookName + outcome + durationMs |
| 6 | CLI 端点追踪 | `src/commands/spec.ts` | command + args |

---

## CLI 使用

```bash
# 统计摘要
maestro spec analytics

# 最近 30 条事件
maestro spec analytics --recent 30

# JSON 格式
maestro spec analytics --json
maestro spec analytics --recent 50 --json

# 归档日志
maestro spec analytics --clear

# TUI 面板
maestro spec analytics --tui
```

### Hook 专用分析

```bash
# Hook 统计摘要
maestro hooks analytics

# 最近 30 条 hook 事件
maestro hooks analytics --recent 30

# 只看特定 hook
maestro hooks analytics --hook spec-injector

# JSON 格式
maestro hooks analytics --json
```

---

## TUI 面板

通过 `maestro config` → **Analytics** tab 或 `maestro spec analytics --tui` 进入。

| 按键 | 模式 | 内容 |
|------|------|------|
| `s` | Summary | 总览：命中率、source/category/budget 分布、hook 统计 |
| `r` | Recent | 最近 100 条事件列表，`Enter` 展开详情 |
| `k` | Keywords | 关键词命中排行榜（柱状图）、dedup 统计 |
| `a` | Agents | Agent 类型维度：每种 agent 的注入成功率 |
| `h` | Hooks | Hook 调用频次（柱状图）、plugin 分布、平均耗时 |

---

## 配置

```json
{
  "specInjection": {
    "analytics": {
      "enabled": true,
      "logPath": ".workflow/spec-analytics.jsonl",
      "maxFileSize": 5242880,
      "retentionWeeks": 4
    }
  }
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 启用分析（设为 false 零开销） |
| `maxFileSize` | 5MB | 超过时自动归档到 `.workflow/archive/` |
| `retentionWeeks` | 4 | 归档保留周数 |

---

## 使用场景

**分析关键词匹配效果：**
```bash
maestro spec analytics --json | jq '.keywordStats'
# avgMatchedPerPrompt < 1.0 → 扩展 spec entry 的 keywords
```

**诊断注入失败：**
```bash
maestro spec analytics --recent 50 | grep "✗"
# 按 reason 查找：no-categories / no-keyword-match / budget-skip
```

**追踪 CLI 使用习惯：**
```bash
maestro spec analytics --json | jq '.cliStats'
```

**监控 hook 系统健康：**
```bash
maestro hooks analytics --hook spec-injector --json | jq '.byHook["spec-injector"].avgDurationMs'
# 查看错误率高的 hook
maestro hooks analytics --json | jq '[.byHook | to_entries[] | select(.value.errorRate > 0)]'
```
