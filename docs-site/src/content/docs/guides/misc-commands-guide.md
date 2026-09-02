---
title: "杂项命令指南"
icon: "⚙️"
---

Maestro 工作流中用于维护、发布和规范管理的辅助命令。

---

## 一、maestro-overlay --amend — 增量修改

信号驱动的 Overlay 生成器。从多种来源收集工作流缺陷信号，诊断哪些命令需要补充修改，批量生成针对性的 Overlay 补丁。所有修改通过 Overlay 系统（`~/.maestro/overlays/*.json`）完成——不侵入原始命令文件，幂等且重装后保留。

与 `/maestro-overlay`（单次显式创建）不同，`/maestro-overlay --amend` 通过分析工作流产物自动**发现**需要修复的内容。

### 使用场景

- `/maestro-ralph` 决策门控暴露了命令步骤缺失
- `review` 决策门（`post-review`）发现流程层面的不足
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
/maestro-overlay --amend "maestro-ralph -c 缺少 CLI 编译验证步骤"  # 直接描述问题
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

## 五、maestro-update — 里程碑发布

将已完成里程碑打包发布。执行 semver 版本提升、生成 Changelog、创建 git tag，可选推送远端。是 SDLC 最终交付步骤。

### 前置条件

| 条件 | 说明 |
|------|------|
| 里程碑已完成 | `/maestro-session-seal` 已执行 |
| 审计通过 | audit report verdict 为 PASS |
| 工作区干净 | 无未提交变更（`--dry-run` 例外） |

### 标志

| 标志 | 说明 |
|------|------|
| `<version>` | 显式指定版本号 |
| `--bump patch\|minor\|major` | 递增版本（默认 `minor`） |
| `--dry-run` | 预览，不写入 |
| `--no-tag` | 跳过 git tag |
| `--no-push` | 跳过推送 |

### 发布流程

```
验证前置条件 → 解析版本 → 收集变更 → 生成 Changelog → 写入版本 → 创建 Tag → 推送
```

### 里程碑生命周期

```
/maestro-session-seal → /maestro-update
```

seal 完成会话并验证 → maestro-update 发布。

### 常见用法

```bash
/maestro-update                  # 标准发布（minor 递增）
/maestro-update --bump patch     # 补丁版本
/maestro-update 2.0.0            # 显式版本号
/maestro-update --dry-run        # 仅预览
/maestro-update --no-push        # 发布但不推送
```

### 注意事项

- manifest 文件不存在时，可手动指定版本并使用 `--no-tag`
- 推送失败时可手动执行 `git push --follow-tags`
- `--dry-run` 不写入任何文件或创建 tag
