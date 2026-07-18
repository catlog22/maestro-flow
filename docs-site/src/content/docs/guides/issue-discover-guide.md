---
title: "问题发现指南"
icon: "🐛"
---

Maestro Issue 系统的完整使用手册，涵盖问题发现、管理、闭环全流程。

---

## 一、概述

Maestro Issue 系统是独立于 Phase 管线的问题追踪机制。Phase 管线（analyze -> plan -> execute -> verify）推进预定义开发任务，Issue 系统捕获和管理代码库中发现的问题。

两者可以独立运行，也可以联动：

- **独立运行**：直接发现和管理 Issue，不影响 Phase 进度
- **联动模式**：Issue 通过 `--gaps` 参数注入 Phase 管线，驱动根因分析和修复

`/maestro-manage issue discover` 是 Issue 系统的入口，提供两种发现模式：

- **多视角全扫描**：8 个专业视角并行分析，全面覆盖代码质量维度
- **Prompt 驱动探索**：围绕用户关注点进行深度定向探索

发现结果自动去重、生成 Issue 记录，进入闭环流程。

---

## 二、maestro-manage issue discover 详解

### 基本用法

```bash
/maestro-manage issue discover                              # 交互选择模式
/maestro-manage issue discover multi-perspective            # 8 视角全扫描
/maestro-manage issue discover by-prompt "检查 API 错误处理"  # Prompt 驱动
/maestro-manage issue discover multi-perspective -y         # 跳过确认
/maestro-manage issue discover multi-perspective --scope=src/auth/**  # 指定范围
/maestro-manage issue discover by-prompt "数据库查询性能" --depth=deep  # 深度探索
```

### 参数一览

| 参数 | 说明 | 默认值 |
|------|------|--------|
| _(无参数)_ | 交互模式选择 | -- |
| `multi-perspective` | 8 视角并行扫描 | -- |
| `by-prompt "..."` | Prompt 驱动探索 | -- |
| `-y` / `--yes` | 跳过确认提示 | 需确认 |
| `--scope=<pattern>` | 文件扫描范围 | `**/*` |
| `--depth=standard\|deep` | 探索深度（仅 by-prompt） | `standard` |

---

### 8 视角全扫描模式

启动 8 个专业视角的并行分析（每批 4 个 Agent）：

```
Batch 1: security, performance, reliability, maintainability
Batch 2: scalability, ux, accessibility, compliance
```

每个视角 Agent 扫描源文件，记录 `file:line` 证据，评估严重程度（critical/high/medium/low），建议修复方向。

<details>
<summary>视角定义（8 个维度）</summary>

| 视角 | 关注领域 | 核心问题 |
|------|---------|---------|
| **SECURITY** | 认证、授权、输入校验、密钥管理、注入攻击 | 存在哪些安全漏洞或不安全模式？ |
| **PERFORMANCE** | N+1 查询、无限循环、缺失缓存、内存泄漏、大载荷 | 存在哪些性能瓶颈或低效模式？ |
| **RELIABILITY** | 错误处理、重试逻辑、竞态条件、数据完整性、优雅降级 | 哪些故障模式未处理或可能导致数据丢失？ |
| **MAINTAINABILITY** | 代码重复、紧耦合、缺失抽象、命名不清、死代码 | 什么让代码库更难理解或修改？ |
| **SCALABILITY** | 硬编码限制、单线程瓶颈、有状态假设、Schema 僵化 | 随着负载/数据/用户增长，什么会出问题？ |
| **UX** | 流程混乱、缺失反馈、行为不一致、可访问性空白 | 什么给最终用户造成摩擦或困惑？ |
| **ACCESSIBILITY** | 屏幕阅读器、键盘导航、颜色对比、ARIA 标签、焦点管理 | 存在哪些残障用户的使用障碍？ |
| **COMPLIANCE** | 日志缺失、审计追踪、数据保留、隐私控制、法规要求 | 哪些法规或政策要求未满足？ |

</details>

#### 结果去重

所有视角的原始发现合并去重：按 `file:line` 分组，描述相似度 > 80% 的条目合并，保留较高严重程度。

#### 输出示例

```
Discovery Session: DBP-20260513-143022
Mode: multi-perspective
Raw findings: 47 → Unique issues: 31

Severity: critical(3) high(8) medium(12) low(8)
Next: /maestro-manage issue list --severity critical
```

---

### by-prompt 模式

Prompt 驱动模式围绕用户关注点进行深度定向探索。

**执行流程**：

1. 将用户 Prompt 分解为 3-5 个探索维度（搜索模式 + 文件模式 + 发现标准）
2. 对每个维度进行语义搜索和模式搜索，收集代码片段
3. 迭代探索（最多 3 轮）：识别问题 -> 优化搜索 -> 最终扫荡
4. 去重并创建 Issue 记录

**适用场景**：排查特定模块问题、针对性安全审计、重构前依赖分析、用户报告问题系统性排查。

**未指定 Prompt 时**，系统提示选择预设方向：Error handling gaps / API contract violations / Test coverage gaps / Custom。

---

### 产物路径

每次发现会话在 `.workflow/issues/discoveries/{SESSION_ID}/` 下创建产物（Session ID 格式：`DBP-YYYYMMDD-HHmmss`）：

| 文件 | 说明 |
|------|------|
| `discovery-state.json` | 会话元数据和进度追踪 |
| `discovery-issues.jsonl` | 本次会话创建的 Issue |
| `{PERSPECTIVE}-findings.json` | 各视角原始发现（全扫描） |
| `exploration-plan.json` | 探索维度定义（by-prompt） |
| `{dimension}-context.md` | 各维度代码上下文 |
| `exploration-log.md` | 逐轮探索日志 |

---

### 发现结果如何转为 Issue

1. 严重程度映射优先级：`critical->1`、`high->2`、`medium->3`、`low->4`
2. 生成 Issue ID（`ISS-YYYYMMDD-NNN`），扫描避免冲突
3. 构建完整 Issue 记录（含 `context.location`、`fix_direction`、`tags`）
4. 同时写入 `issues.jsonl`（全局）和 `discovery-issues.jsonl`（会话记录）
5. 初始状态 `registered`，来源 `discovery`

---

## 三、maestro-manage issue 详解

`/maestro-manage issue` 负责 Issue 生命周期管理，支持 6 个子命令。

### 基本用法

```bash
/maestro-manage issue create --title "内存泄漏" --severity high
/maestro-manage issue list --severity critical --status open
/maestro-manage issue status ISS-20260513-001
/maestro-manage issue update ISS-20260513-001 --status in_progress --priority 1
/maestro-manage issue close ISS-20260513-001 --resolution "已修复内存泄漏"
/maestro-manage issue link ISS-20260513-001 --task TASK-003
```

---

### 子命令详解

<details>
<summary>create -- 创建 Issue</summary>

```bash
/maestro-manage issue create --title "标题" [选项]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--title TEXT` | 标题（**必填**） | 交互提示 |
| `--severity VALUE` | critical / high / medium / low | `medium` |
| `--source VALUE` | planned / supplement / bug / review / verification / discovery / manual | `manual` |
| `--phase VALUE` | Phase 引用 | -- |
| `--milestone VALUE` | Milestone 引用（自动从 `state.json` 推导） | -- |
| `--description TEXT` | 详细描述 | 交互提示 |
| `--priority NUMBER` | 1-5，越小越优先 | `3` |
| `--tags TAG1,TAG2` | 标签列表 | -- |

创建后自动生成 ID（`ISS-YYYYMMDD-NNN`），提示补充上下文，对 `supplement` 类型检查跨 Milestone 冲突。

</details>

<details>
<summary>list -- 列出 Issue</summary>

| 选项 | 说明 |
|------|------|
| `--status VALUE` | open / in_progress / completed / failed / deferred |
| `--phase VALUE` | 按 Phase 过滤 |
| `--milestone VALUE` | 按 Milestone 过滤 |
| `--severity VALUE` | 按严重程度过滤 |
| `--source VALUE` | 按来源过滤 |
| `--all` | 包含已关闭（从 `issue-history.jsonl` 读取） |

输出按优先级升序、严重程度降序排列。

</details>

<details>
<summary>status / update / close / link</summary>

**status** 查看完整 Issue 详情（标题、状态、严重程度、描述、修复方向、上下文、标签、历史、反馈）：

```bash
/maestro-manage issue status ISS-20260513-001
```

**update** 更新字段，状态变更自动记录到 `issue_history`：

```bash
/maestro-manage issue update ISS-20260513-001 --status in_progress --priority 1 --add-tag urgent
# 可选: --severity, --tags, --phase, --milestone, --fix-direction, --description, --note
```

**close** 关闭并移入历史列表：

```bash
/maestro-manage issue close ISS-20260513-001 --resolution "修复说明" [--status completed|failed|deferred]
```

**link** 创建双向关联（Issue `affected_components` <-> Task `issue_refs`）：

```bash
/maestro-manage issue link ISS-20260513-001 --task TASK-003
```

</details>

---

### issues.jsonl 格式

所有 Issue 以 JSONL 存储，关键字段：

```json
{
  "id": "ISS-20260513-001",
  "title": "Refresh token 未正确轮换",
  "status": "registered",
  "priority": 1,
  "severity": "critical",
  "source": "discovery",
  "phase_ref": "01-auth",
  "milestone_ref": "MVP",
  "description": "...",
  "fix_direction": "使用数据库锁确保原子性",
  "context": { "location": "src/auth/token.ts:45", "suggested_fix": "..." },
  "tags": ["SECURITY", "auth"],
  "affected_components": ["src/auth/token.ts"],
  "issue_history": [{ "from_status": null, "to_status": "registered", "note": "Issue created" }]
}
```

| 存储位置 | 说明 |
|---------|------|
| `.workflow/issues/issues.jsonl` | 活跃 Issue |
| `.workflow/issues/issue-history.jsonl` | 已关闭（归档） |

---

### 状态流转

```
registered -> open -> in_progress -> completed
                                -> failed
                                -> deferred
```

| 状态 | 说明 | 触发 |
|------|------|------|
| `registered` | 初始（discover 创建） | 自动发现 |
| `open` | 确认待处理 | 手动创建/确认 |
| `in_progress` | 处理中 | 开始修复 |
| `completed` | 已解决 | 修复验证通过 |
| `failed` | 处理失败 | 修复失败 |
| `deferred` | 延后 | 低优先级或依赖未就绪 |

---

## 四、Issue 闭环

### 标准流程

```
discover -> list -> analyze -> plan -> execute -> verify -> close
```

```bash
# 1. 发现
/maestro-manage issue discover multi-perspective

# 2. 查看结果
/maestro-manage issue list --severity critical
/maestro-manage issue status ISS-20260513-001

# 3. 根因分析（--gaps 将 Issue 注入 Phase 管线）
/maestro-ralph --engine swarm --script wf-analyze --gaps ISS-20260513-001

# 4. 方案规划
/maestro-ralph --gaps

# 5. 执行修复
/maestro-ralph continue

# 6. 关闭
/maestro-manage issue close ISS-20260513-001 --resolution "修复说明"
```

### 快捷路径

紧急/简单问题可用 `maestro-next` 跳过中间步骤：

```bash
/maestro-next "修复 token 轮换竞态条件"
/maestro-manage issue close ISS-20260513-001 --resolution "已通过 maestro-next 修复"
```

### 与 Roadmap/Milestone 集成

- **Milestone 关联**：`--milestone` 指定所属（未指定时自动从 `state.json` 推导）；`supplement` 类型自动检查跨 Milestone 冲突
- **Phase 关联**：`--phase` 关联 Phase；`--gaps` 转为 Gap 注入分析流程；`link` 双向关联 Issue 与 Task
- **Roadmap 反馈**：Issue 统计（数量、严重度分布、修复率）为规划提供参考；高密度 Issue 的 Phase 可能需拆分；`supplement` 可作为下一 Milestone 需求输入

Commander Agent 自动识别未分析 Issue 并推进处理，配合 Hook 可实现全自动闭环。
