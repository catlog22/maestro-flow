---
title: "杂项命令指南"
---

Maestro 工作流中用于维护和规范管理的辅助命令。

---

## 一、maestro-overlay --amend — 增量修改

信号驱动的 Overlay 生成器。从多种来源收集工作流缺陷信号，诊断哪些命令需要补充修改，批量生成针对性的 Overlay 补丁。所有修改通过 Overlay 系统（`~/.maestro/overlays/*.json`）完成——不侵入原始命令文件，幂等且重装后保留。

与 `/maestro-overlay`（单次显式创建）不同，`/maestro-overlay --amend` 通过分析工作流产物自动**发现**需要修复的内容。

### 使用场景

- `execute` 步骤内置验证门控（E2.7）暴露了命令步骤缺失
- `review` 步骤发现流程层面的不足
- 工作流执行偏差，根因指向命令定义不完整
- Issue 追踪显示同类问题反复出现

### 信号来源

| 标志 | 来源 | 采集内容 |
|------|------|---------|
| `--from-verify <dir>` | verification.json | 验证失败暴露的工作流缺口 |
| `--from-review <dir>` | review.json | 代码审查发现的流程缺陷 |
| `--from-session <id>` | 会话产物 | 执行期间遇到的问题 |
| `--from-issues ISS-xxx,...` | issues.jsonl | 追溯到命令缺陷的 Issue |
| `--scan` | 自动扫描 .workflow/ | 发现所有工作流相关信号 |
| _(位置参数文本)_ | 用户描述 | 直接观察和说明 |

### 工作流程

```
收集信号 → 诊断分类 → 分组规划 → 预览确认 → 生成 Overlay → 安装
```

1. **收集信号**：提取缺陷信号，分类为"命令缺陷"或"代码 Bug"
2. **诊断映射**：确定目标命令、section、补丁模式（prepend/append/new-section）
3. **分组规划**：按命令 + section 分组，展示注入点
4. **预览确认**：用户确认或编辑注入点地图
5. **生成安装**：生成 Overlay JSON，通过 `maestro overlay add` 安装

### 常见用法

```bash
/maestro-overlay --amend --from-verify .workflow/phases/1    # 从验证结果中发现命令缺口
/maestro-overlay --amend --from-review .workflow/phases/2    # 从审查结果中提取流程改进
/maestro-overlay --amend --scan                               # 自动扫描所有信号
/maestro-overlay --amend "execute 步骤缺少 CLI 编译验证"  # 直接描述问题
/maestro-overlay --amend --dry-run                            # 预览模式（不安装）
/maestro-overlay --amend -y                                   # 跳过确认
```

---

## 二、maestro-update — 更新检查

检测当前 `.workflow/` 的 schema 版本，展示可用迁移计划，交互式执行版本升级。支持增量链式升级（如 1.0 → 2.0 → 3.0）。

### 标志

| 标志 | 说明 |
|------|------|
| `--dry-run` | 仅预览迁移计划，不执行 |
| `--force` | 跳过确认，应用所有待执行迁移 |

### 执行流程

```
检测版本 → 预览计划 → 逐步确认 → 执行迁移 → 汇总报告
```

### 常见用法

```bash
/maestro-update --dry-run   # 检查是否有待执行的迁移
/maestro-update             # 交互式逐步升级
/maestro-update --force     # 一键全量升级
```

### 注意事项

- 跳过步骤可能破坏版本链（系统会警告）
- 每次迁移前自动创建备份：`.workflow/state.json.backup-v{from}-{timestamp}`
- 手动恢复：`cp .workflow/state.json.backup-v{from}-{ts} .workflow/state.json`

---

## 三、specs-remove — 规范移除

从 specs 文件中移除指定的 `<spec-entry>` 条目。作为 `/maestro-spec`（录入）的对称操作，`specs-remove` 是编排器派发的 step，使用 `maestro wiki remove-entry` 原子删除并自动更新索引。

### Entry ID 格式

```
spec-{file-stem}-{NNN}  （如 spec-learnings-003）
```

### 常见用法

```bash
maestro wiki list --type spec --json    # 列出所有 spec 条目
maestro spec load --keyword auth        # 按关键词搜索（CLI）
specs-remove spec-learnings-003         # 移除指定条目（step，由编排器派发）
```

### 注意事项

- 需先通过 `maestro spec init` 初始化 `.workflow/specs/`
- Entry ID 必须是 spec 类型子节点
- 移除不可逆（建议先用 `maestro spec load` 预览）

---

## 四、maestro-knowledge audit — 只读知识健康审计

Audit 读取 Spec/Knowhow corpus，并始终附加 pipeline/repository findings；MaestroGraph 已初始化时还报告 usage concentration。它没有 artifact scope、交互裁决、mutation、delete 或 purge 阶段。

### 实现的 detector 类

| 区域 | Findings |
|------|----------|
| Spec | missing SID、unsynchronized supersession、exact duplicate、dangling links、supersession cycle、stale-active observation |
| Knowhow | missing required metadata、invalid frontmatter、ghost related path、exact duplicate |
| Pipeline/repository | invalid Session authority/ledger、promotion backlog、missing manifest、linked ID/capability、pending cross-repo promotion |
| Usage | exposure concentration（仅观察；不生成 prune action） |
| Compatibility | legacy aliases、unscoped entries、free category |

### 标志与输出

| 标志 | 说明 |
|------|------|
| `--scope <spec\|knowhow\|all>` | Corpus detector 范围；默认 `all` |
| `--prune` | 在输出中附加 deterministic soft-action suggestions；仍然不写盘 |
| `--json` | 输出完整 `knowledge-audit/1.0` 对象 |
| `--workflow-root <path>` | 指定包含 `.workflow/` 的项目根 |

```bash
maestro knowledge audit --scope all --json
maestro knowledge audit --scope spec
maestro knowledge audit --scope knowhow --prune  # report-only
```

`--prune` 只建议 Spec deprecate（unsynchronized supersession/exact duplicate）或 Knowhow supersede（exact duplicate）。Audit 不会应用建议，也不会写 report、backup 或 audit log。Compatibility migration 必须单独先保存并审阅 `maestro knowledge normalize --report <path>`，再以同一路径显式追加 `--apply`；这是唯一的 report-fenced migration apply。

---

## 五、Boundary Grill 协议

嵌入式迷你审查协议，在管线阶段间触发，用于检测和解决冲突。

### 冲突类型

| 类型 | 代码 | 说明 |
|------|------|------|
| Scope Breach | **RSC** | 任务超出当前阶段职责范围 |
| Module Boundary | **MOD** | 跨模块修改未遵循约定 |
| Decision Conflict | **DEC** | 与已有决策或规范冲突 |

### 触发条件

Boundary Grill 在以下场景自动触发：

- `analyze` 步骤完成后
- `plan` 步骤完成后
- `brainstorm` 步骤完成后
- `collab` 阶段间
- 管线阶段间的 mini-grill 审查

### 协议流程

```
检测冲突 → 最多 3x3 问答 → 冲突分类 → 解决方案 → 记录决策
```

1. **检测**: 自动扫描产物和上下文，识别潜在冲突
2. **问答**: 最多 3 轮，每轮最多 3 个问题
3. **分类**: 将冲突归类为 RSC/MOD/DEC
4. **解决**: 生成解决方案或升级决策
5. **记录**: 写入决策日志

### Auto Mode

```bash
# 使用 -y 标志启用 Auto Mode（自动回答，基于代码分析）
/maestro-next "分析 auth module" -y
```

Auto Mode 下，Grill 使用代码分析结果自动回答问题，无需人工交互。

### 输出格式

```json
{
  "conflicts": [
    {
      "type": "RSC",
      "description": "任务修改了 auth 模块但当前阶段是 database 优化",
      "resolution": "将 auth 修改移至下一阶段",
      "severity": "medium"
    }
  ],
  "questions_asked": 2,
  "auto_answered": true
}
```

### 集成命令

| 步骤 | 集成方式 |
|------|----------|
| `analyze` | 分析完成后触发 |
| `plan` | 计划完成后触发 |
| `brainstorm` | 头脑风暴完成后触发 |
| `collab` | 协作阶段间触发 |

> 完整协议定义见 `workflows/boundary-grill.md`
