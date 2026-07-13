<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Ralph Goal Amendment Flow

## Phase 1 — 快照

1. 定位最新 running ralph session
2. Read: `task_decomposition` WHERE `status != "superseded"`, `boundary_contract`, completed steps `completion_summary`
3. Display:
   ```
   📍 Session: {session_id}
   进度: {completed}/{total} steps
   目标:
   {for g in active_goals:}
     [{status_icon}] {g.id}: {g.goal} — done_when: {g.done_when}
   {end for}
   边界: in_scope={count}, out_of_scope={count}
   修改历史: {goal_changelog.length} 次
   ```

## Phase 2 — 解析

| Condition | 行为 |
|-----------|------|
| `change_request` 非空 | 直接使用 |
| `change_request` 为空 | AskUserQuestion（4 选项 + 自由输入追加） |

AskUserQuestion options:

| label | description |
|-------|-------------|
| 修改现有目标 | 调整子目标范围或完成条件 |
| 新增目标 | 追加新子目标 |
| 移除目标 | 取消未完成子目标 |
| 调整边界 | 修改 in_scope / out_of_scope / constraints |

## Phase 3 — Mini Grill

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Delegate (run_in_background, STOP, wait):

```
maestro delegate "PURPOSE: 评估目标变更影响
TASK:
  1. 对比 current_goals 与 change_request，识别冲突/缺口
  2. 判定已完成 steps 在新目标下是否有效（基于 completion_summary + completion_decisions）
  3. 判定 pending steps 是否需重建/跳过
  4. 评估 risk_level
CONTEXT:
  intent             = {session.intent}
  current_goals      = {task_decomposition where status != superseded}
  completed_steps    = [{index, skill, stage, completion_summary, completion_decisions}]
  pending_steps      = [{index, skill, stage, goal_ref}]
  boundary_contract  = {boundary_contract}
  change_request     = {change_request}
EXPECTED:
  ---IMPACT---
  CHANGE_TYPE=modify|add|remove|boundary
  AFFECTED_GOALS=[{id, action: modify|supersede|keep, new_goal?, new_done_when?}]
  INVALIDATED_STEPS=[{index, reason}]
  NEW_GAPS=[{goal_id, description, suggested_stages: [analyze|plan|execute|...]}]
  BOUNDARY_CHANGES={in_scope_add:[], out_of_scope_add:[], constraints_add:[]}
  RISK_LEVEL=low|medium|high
  RISK_REASON=...
  ---END---
CONSTRAINTS:
  - 只评估不修改
  - high: 已完成工作与新目标直接冲突
  - medium: 部分 steps 需跳过/重建，已完成工作可保留
  - low: 纯增量，已有工作不受影响"
--role analyze --mode analysis
```

**GATE Phase 3→4**: REQUIRED impact_assessment complete; BLOCKED if delegate output missing

## Phase 4 — 确认

Display: 影响摘要（risk_level, affected, invalidated, new_gaps）。AskUserQuestion:

| label | description |
|-------|-------------|
| 应用并继续 | 归档旧目标 → 写入新目标 → 重建链路 → handoff |
| 仅改目标 | 更新目标，保留链路不变 |
| 取消 | 无修改 |

GUARD: `RISK_LEVEL == high` → auto_confirm 无效

## Phase 5 — 应用

### 5.1 Changelog entry

Append to `session.goal_changelog[]`：

```json
{
  "id": "CHG-{NNN}",
  "timestamp": "{ISO}",
  "change_type": "{CHANGE_TYPE}",
  "reason": "{change_request}",
  "impact_assessment": { "risk_level": "...", "invalidated_steps": [...], "new_steps_inserted": 0, "evidence_source": "delegate impact assessment output" },
  "before": { "goals": [{"id":"...","goal":"...","done_when":"..."}] },
  "after":  { "goals": [{"id":"...","goal":"...","done_when":"..."}] }
}
```

`NNN` = `(goal_changelog.length + 1).toString().padStart(3, '0')`

**GATE 5.1→5.2**: REQUIRED goal_changelog written; BLOCKED if changelog entry missing

### 5.2 归档

对 AFFECTED_GOALS 中 `action ∈ {modify, supersede}` 的条目：
- Set `status: "superseded"`, `superseded_by: "CHG-{NNN}"`, `superseded_at: now`
- GUARD: `status == "done"` 的目标不可 supersede（skip + warn）

### 5.3 写入新目标

| action | 处理 |
|--------|------|
| `modify` | 新条目 `id: "{original_id}v{version}"`, `origin: "CHG-{NNN}"`, `status: "pending"` |
| `add` | 新条目 `id: "G{next_num}"`, `origin: "CHG-{NNN}"`, `status: "pending"` |
| `remove` | 仅 supersede，不新增 |
| `keep` | 不变 |

### 5.4 重建链路

GUARD: 用户选"应用并继续"

1. INVALIDATED_STEPS 中 pending step → set `status: "skipped"`
2. NEW_GAPS → 按 `suggested_stages` 插入 steps + decision nodes
   - 按 A_BUILD_STEPS 规则构建（goal_ref + command_path 解析 + command_scope 校验）
   - 插入位置：当前 active step 之后、`post-goal-audit` 之前
3. 原链路有 `post-goal-audit` → 保留
4. 原链路无 `post-goal-audit` AND `task_decomposition` 存在 → 在 `milestone-complete` 前插入
5. Reindex all steps

### 5.5 Boundary

`BOUNDARY_CHANGES` 非空时：
- `in_scope_add` → append to `boundary_contract.in_scope`
- `out_of_scope_add` → append to `boundary_contract.out_of_scope`
- `constraints_add` → append to `boundary_contract.constraints`

### 5.6 Persist + Handoff

1. Write status.json
2. Display:
   ```
   ◆ Goal amendment: {CHG-NNN}
   {change_type} — {reason}
   Risk: {RISK_LEVEL} | Superseded: {n} | Added: {n} | Skipped steps: {n} | Inserted steps: {n}
   ```
3. Handoff → maestro-ralph-execute（平台适配：Claude 用 `Skill()`，Codex 用 `$` 直调）

---

## Anchor 呈现规则

Goals Overview 输出格式（CLI `buildSessionAnchor` 自动生成）：

```
**Goals Overview**:
- [✓] G1: 实现搜索 API — done_when: 测试通过
- [superseded] G2: 前端搜索页 → 被 CHG-001 替换
- [○] G2v2: 前端搜索页+迁移兼容 — done_when: 新旧数据均可检索 (via CHG-001)
- [○] G3: 旧数据迁移脚本 — done_when: 全量测试通过 (via CHG-001)
- Course corrections: 1 applied
```

规则：
- `superseded` 目标 → 单行标注，不展开细节
- 新目标 → 标注 `(via CHG-xxx)`
- re-grounding / goal-audit → 仅取 `status != "superseded"`
