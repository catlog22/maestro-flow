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
- `/maestro-ralph --engine swarm --script wf-review` 发现流程层面的不足
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
/maestro-overlay --amend "maestro-ralph continue 缺少 CLI 编译验证步骤"  # 直接描述问题
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

## 三、spec remove — 规范移除

从 specs 文件中移除指定的 `<spec-entry>` 条目。与 `/spec add` 对称，使用 `maestro wiki remove-entry` 原子删除并自动更新索引。

### Entry ID 格式

```
spec-{file-stem}-{NNN}  （如 spec-learnings-003）
```

### 常见用法

```bash
maestro wiki list --type spec --json    # 列出所有 spec 条目
/spec load --keyword auth               # 按关键词搜索
/spec remove spec-learnings-003          # 移除指定条目
```

### 注意事项

- 需先通过 `/spec setup` 初始化 `.workflow/specs/`
- Entry ID 必须是 spec 类型子节点
- 移除不可逆（建议先用 `/spec load` 预览）

---

## 四、manage knowledge audit — 知识审计淘汰

审计 spec / knowhow / artifact 三存储，识别矛盾、过期、孤立和元数据质量问题。与 `/manage knowledge harvest`（写入/提取）对称——harvest 积累知识，audit 清理知识。

### 审计场景（8 类 28 子场景）

| 大类 | 示例子场景 |
|------|-----------|
| 显式矛盾 | 同一 topic 的两条 spec 条目结论相反 |
| 隐式矛盾 | 不同 category 的条目对同一实践给出冲突建议 |
| 过期条目 | 关联代码已重构，条目内容不再适用 |
| 元数据质量 | 缺少 category/keywords/date，无法正确路由 |
| Maestro 特定 | 链引用断裂、artifact 残留、session 孤立产物 |
| Timeline 产物 | T1-T6 阶段产物未归档或已过期 |
| Knowhow 漂移 | recipe/template 与实际代码实现不一致 |
| Artifact 残留 | 临时 scratch 文件未清理 |

### 三态决策模型

| 状态 | 动作 | 适用场景 |
|------|------|----------|
| **keep** | 保留不变 | 条目仍然准确有效 |
| **deprecate** | 标记废弃 | 条目部分过时，保留参考价值 |
| **delete** | 移入 `.trash/` | 条目完全失效，无保留价值 |

### 标志

| 标志 | 说明 |
|------|------|
| `--scope <spec\|knowhow\|artifact\|all>` | 审计范围（必需） |
| `--level P0\|P1\|P2` | 严重级别过滤 |
| `--since YYYY-MM-DD` | 仅审计此后修改的条目 |
| `--milestone <name>` | 限定到特定里程碑 |
| `--interactive` | 逐条三态决策面板（默认） |
| `--mark` | 非交互：仅标记不删除 |
| `--delete` | 非交互：软删除到 `.trash/` |
| `--purge` | 非交互：物理擦除（仅 artifact，需二次确认） |
| `--dry-run` | 预览不修改 |
| `--report` | 仅生成审计报告 |

### 关键不变量

- **备份优先**：任何修改前自动创建备份
- **废弃优于删除**：文本存储（spec/knowhow）默认 deprecate 而非 delete
- **purge 需二次确认**：仅 artifact scope 可用，且必须二次确认
- **救援优先**：删除前提示先执行 harvest 提取未收割的知识

### 常见用法

```bash
/manage knowledge audit --scope all              # 全量审计（交互式）
/manage knowledge audit --scope spec --level P0  # 仅审计 P0 级 spec 问题
/manage knowledge audit --scope knowhow --dry-run # 预览 knowhow 审计
/manage knowledge audit --scope artifact --report # 仅生成 artifact 审计报告
/manage knowledge audit --scope all --mark        # 非交互标记所有问题条目
```

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
