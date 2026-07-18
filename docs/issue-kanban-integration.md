# Issue System & Kanban Board Integration

Issue 闭环工作流系统与看板视图的集成说明。涵盖数据模型、生命周期状态、UI 组件、CLI 命令、API 端点、WebSocket 协议和 Commander Agent 自动化。

## 数据模型

### Issue 核心类型 (`shared/issue-types.ts`)

```typescript
interface Issue {
  id: string;                          // ISS-{ulid}
  title: string;
  description: string;
  type: 'bug' | 'feature' | 'improvement' | 'task';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: IssueStatus;                 // 'open' | 'in_progress' | 'resolved' | 'closed'
  created_at: string;
  updated_at: string;
  // 闭环扩展字段
  analysis?: IssueAnalysis;            // 根因分析结果
  solution?: IssueSolution;            // 实施方案
  execution?: IssueExecution;          // 执行结果
  path?: 'standalone' | 'workflow';    // 处理路径
  phase_id?: number;                   // 关联 phase
  executor?: AgentType;                // 执行器类型
}
```

### 显示状态派生 (`shared/constants.ts`)

`getDisplayStatus(issue)` 从 issue 的 status + metadata 派生出 6 种显示状态：

| 条件 | DisplayStatus | 颜色 |
|------|---------------|------|
| `status === 'open'`，无 analysis/solution | `open` | 灰色 |
| `status === 'open'` + `analysis` 存在 | `analyzing` | 蓝色 |
| `status === 'open'` + `solution` 存在 | `planned` | 紫色 |
| `status === 'in_progress'` | `in_progress` | 黄色 |
| `status === 'resolved'` | `resolved` | 绿色 |
| `status === 'closed'` | `closed` | 灰色 |

优先级：`planned > analyzing > open`（当 analysis 和 solution 同时存在时显示 planned）。

> **重要区分**: 系统存在两层状态。`IssueStatus`（open/in_progress/resolved/closed）决定 Issue 在看板的**哪一列**；`DisplayStatus`（open/analyzing/planned/in_progress/resolved/closed）决定卡片上**显示的标签颜色**。一个 `status=open` 的 Issue 始终停留在 Backlog 列，但当它被分析或规划后，卡片标签会从 "open" 变为 "analyzing" 或 "planned"，直观反映闭环进度。只有当 `status` 变为 `in_progress` 时，Issue 才会移动到 In Progress 列。

## 看板视图集成

### 四种视图模式

看板页面 (`KanbanPage.tsx`) 提供 4 个视图，均展示 Issue 卡片：

| 视图 | 快捷键 | Issue 展示方式 |
|------|--------|---------------|
| **Board** (K) | 按状态分列 | IssueCard 在对应列中，Phase 卡片下方以分隔线区分 |
| **Timeline** (T) | 时间线 | 仅 Phase，不直接显示 Issue |
| **Table** (L) | 表格行 | Issue 与 Phase 混排在表格中 |
| **Center** (C) | 三面板 | Panel 2 "Issue Queue" 展示 open/in_progress 的 Issue 列表 |

### Board 视图：状态到列的映射

`KanbanBoard.tsx` 定义了 Issue status 到看板列的映射：

```
open        → Backlog 列
in_progress → In Progress 列
resolved    → Review 列
closed      → Done 列
```

每列内容按顺序排列：Phase 卡片 → 分隔线 "Issues" → IssueCard → 分隔线 "Linear" → LinearIssueCard。

### IssueCard 卡片内容

IssueCard (`IssueCard.tsx`) 展示三行信息：

1. **Row 1**: 类型徽标 + 路径徽标(standalone/workflow) + 方案指示器(N steps) + 执行状态 + 优先级
2. **Row 2**: 标题（最多两行）
3. **Row 3**: 派生显示状态（着色文字） + 执行器选择器(Claude/Codex/Gemini) + 执行按钮

交互功能：
- **点击卡片** → 打开 IssueDetailModal
- **执行器下拉** → 选择执行 Agent（hover 时显示）
- **执行按钮** ▶ → 发送 `execute:issue` WS 消息触发执行
- **多选复选框** → hover 或 batch 模式下显示，用于批量执行
- **执行中指示器** → 点击打开 CLI 输出面板

### IssueDetailModal 详情弹窗

弹窗支持 3 种样式（通过设置页配置）：slide panel / centered modal / full-page。

内容区域：
- **基本信息**: ID、类型、优先级、路径、创建时间
- **AnalysisSection**: 展示 root_cause、impact、confidence、related_files、suggested_approach
- **SolutionSection**: 展示 steps 列表（description + target + verification）、context、planned_by
- **ExecutionResultSection**: 展示执行结果
- **ActionButtons**: 三个动作按钮，根据当前状态条件性显示
  - **Analyze** → 当 `!analysis` 时显示，发送 `issue:analyze` WS 消息
  - **Plan** → 当 `analysis && !solution` 时显示，发送 `issue:plan` WS 消息
  - **Execute** → 当 `solution` 时显示，发送 `execute:issue` WS 消息

### Center 视图：Issue Queue 面板

KanbanCenterView 的中间面板 "Issue Queue" 展示所有 `open` 和 `in_progress` 状态的 Issue，按类型和优先级着色。右侧 Summary 面板展示 Issue 统计（open/resolved 计数）。

## 闭环生命周期

Issue 通过以下路径推进：

```
创建(open) → 分析(open+analysis) → 规划(open+solution) → 执行(in_progress) → 完成(resolved/closed)
```

### CLI 命令

| 命令 | 触发阶段 | 作用 |
|------|----------|------|
| `/manage issue` | 创建 | CRUD 操作，创建新 Issue |
| `/manage issue discover` | 发现 | 多视角自动发现代码问题 |
| `/manage issue analyze` | 分析 | 对指定 Issue 进行根因分析，写入 `analysis` 字段 |
| `/manage issue plan` | 规划 | 对已分析 Issue 生成解决方案，写入 `solution` 字段 |
| `/manage issue execute` | 执行 | 双模式执行（Server UP → API dispatch / Server DOWN → ccw cli 直接执行） |

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/issues` | 列出所有 Issue（支持 status/type 过滤） |
| `POST` | `/api/issues` | 创建新 Issue |
| `GET` | `/api/issues/:id` | 获取单个 Issue |
| `PATCH` | `/api/issues/:id` | 更新 Issue 字段 |
| `DELETE` | `/api/issues/:id` | 删除 Issue |
| `PATCH` | `/api/issues/:id/analysis` | 写入分析结果（IssueAnalysis） |
| `PATCH` | `/api/issues/:id/solution` | 写入解决方案（IssueSolution） |

analysis 和 solution 端点包含输入验证：
- analysis: 必须包含 `root_cause`，`confidence` 必须在 0-1 范围内
- solution: `steps` 不能为空，必须包含 `planned_at`

### WebSocket 协议

| 客户端消息 | 触发操作 |
|-----------|----------|
| `issue:analyze` | 启动分析 Agent（AgentManager.spawn） |
| `issue:plan` | 启动规划 Agent（AgentManager.spawn） |
| `execute:issue` | 通过 ExecutionScheduler 调度执行 |

### Commander Agent 自动化

Commander Agent 作为自主 supervisor，通过定时 tick 循环（assess → decide → dispatch）持续评估项目状态并自动调度 Agent：

**Tick 循环机制**:
1. **Assess** — 读取当前所有 Issue 状态，生成评估上下文（含每个 Issue 的 NEW/ANALYZED/READY 标记）
2. **Decide** — 基于评估结果和 Decision Rules 生成 `PriorityAction[]` 列表
3. **Dispatch** — 按优先级执行动作（execute > analyze > plan）

**Issue 相关动作类型**:
- `analyze_issue` → 使用 `AgentManager.spawn()` 启动分析（不占用 ExecutionScheduler 工位）
- `plan_issue` → 使用 `AgentManager.spawn()` 启动规划（同上）
- `execute_issue` → 通过 `ExecutionScheduler` 调度执行（占用工位）

**Decision Rule #8**: 当发现 `open` 且无 `analysis` 的 Issue 时触发 analyze；有 `analysis` 无 `solution` 时触发 plan。这使得 Issue 可以在无人干预下自动完成 分析→规划→执行 的闭环流转。

## 状态存储

### 前端 Store

| Store | 职责 |
|-------|------|
| `issue-store` | Issue CRUD、乐观更新、状态同步 |
| `execution-store` | 执行槽位管理、多选批量操作、CLI 面板状态 |
| `linear-store` | Linear 集成（导入/导出/同步） |
| `board-store` | Phase 看板状态 |
| `ui-prefs-store` | UI 偏好（弹窗样式等，持久化到 localStorage） |

### 后端存储

Issue 数据存储在 `.workflow/issues/issues.jsonl`，每行一条 JSON 记录。读写使用 `withWriteLock()` 确保并发安全。

## 执行控制

### 单个执行

1. 在 IssueCard 上选择执行器 → 点击 ▶ 按钮
2. 前端发送 `execute:issue` WS 消息（包含 issueId + executor）
3. 服务端 WS handler 调用 ExecutionScheduler 调度
4. 执行中状态通过 WS 广播到前端，IssueCard 显示旋转指示器
5. 点击旋转指示器可打开 ExecutionCliPanel 查看实时输出

### 批量执行

1. hover IssueCard 显示复选框，或在 batch 模式下全部显示
2. 选中多个 Issue 后，底部浮动的 ExecutionToolbar 出现
3. SupervisorStatusBar 显示队列状态和执行进度

### 创建 Issue

- 快捷键 `C` → 打开创建弹窗（IssueCreateModal）
- 列头 `+` 按钮 → 在对应列创建（InlineIssueComposer）
- 创建后自动刷新 Issue 列表
