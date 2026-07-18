<!-- session-mode: none -->
<!-- lifecycle-profile: neutral -->
# Task Tracking Protocol

Task 工具是 session 权威状态的 **UI 镜像**，不替代 session 状态。

## 原则

- 权威真相在 `session.json` / `run.json`，task 工具是只读投影
- LLM 不维护镜像一致性——插件/宿主负责对账
- 手工 update 仅用于 LLM 主动发现的状态变更（完成/失败），不用于中间进度

## Claude Code 操作表

| 时机 | 操作 | 示例 |
|------|------|------|
| Session 创建后 | [@task] TaskCreate session goal | `TaskCreate({ description: "所有 steps completed", subject: "Session: {intent_summary}" })` |
| Step 派发时 | [@task] TaskCreate step goal | `TaskCreate({ description: "{step.stage} 完成", subject: "Step {index}: {step.skill}" })` |
| Step 完成时 | [@task] TaskUpdate step goal | `TaskUpdate({ taskId: step_goal_id, status: "completed" })` |
| 子目标全完成时 | [@task] TaskUpdate session goal | `TaskUpdate({ taskId: session_goal_id, status: "completed" })` |
| Step 失败时 | [@task] TaskUpdate step goal | `TaskUpdate({ taskId: step_goal_id, status: "failed" })` |

## 字段语义

| 字段 | 含义 | 示例 |
|------|------|------|
| `subject` | 任务标题（显示名） | `"Step 3: implement"` |
| `description` | 完成判据 | `"implement 阶段完成 + tests pass"` |
