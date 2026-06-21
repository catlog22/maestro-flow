---
title: "安装指南"
---

Maestro-Flow 安装分为全局 CLI 安装和项目初始化两步。

---

## 快速安装

```bash
# 1. 安装全局 CLI
npm install -g maestro-flow

# 2. 初始化项目（在项目根目录执行）
maestro install
```

**前置要求**：
- Node.js ≥ 18
- Claude Code CLI（必需）
- Codex CLI / Gemini CLI（可选，用于多 agent 工作流）

---

## 安装流程

`maestro install` 执行以下步骤：

1. **检测项目状态** — 空项目 / 已有代码 / 已有 .workflow/
2. **选择组件** — 交互式组件选择界面
3. **选择安装模式** — 全局 (~/.maestro/) 或项目级 (.workflow/)
4. **复制文件** — 按组件定义复制到目标位置
5. **生成 manifest** — 记录已安装组件，支持增量更新

---

## 组件分组

从 v0.5.32 起，安装组件从 53 个独立条目整合为 25 个分组，提供更简洁的选择体验。

### 核心组件（默认选中）

| 分组 | 说明 | 文件数 |
|------|------|--------|
| **commands** | 核心 slash 命令 | ~30 |
| **hooks** | 自动化钩子 | ~5 |
| **workflows** | 工作流脚本 | ~10 |
| **specs** | 规范模板 | 7 |

### 可选技能包

| 分组 | 包含技能 | 说明 |
|------|----------|------|
| **skills-extra-team** | team-arch-opt, team-brainstorm, team-designer, team-frontend, team-issue, team-planex 等 | 团队协作相关技能 |
| **skills-scholar** | scholar-anti-ai-writing, scholar-citation-verify, scholar-experiment, scholar-ideation 等 | 学术研究技能 |
| **skills-meta** | meta-workflow, meta-analysis 等 | 元技能和工作流编排 |

### 内置团队技能（始终安装）

以下 9 个团队技能随核心组件自动安装，无需单独选择：

- team-adversarial-swarm
- team-coordinate
- team-executor
- team-lifecycle-v4
- team-quality-assurance
- team-review
- team-swarm
- team-tech-debt
- team-testing

---

## 安装模式

### 全局模式（推荐）

安装到 `~/.maestro/`，所有项目共享：

```bash
maestro install --mode global
```

适合：个人开发机，多项目共享配置

### 项目模式

安装到项目目录 `.workflow/`，仅当前项目生效：

```bash
maestro install --mode project
```

适合：团队协作，项目特定配置

---

## 从旧版本迁移

### v0.5.32+ 自动迁移

旧版本的个别 skill ID 会自动映射到新分组 ID：

| 旧 ID | 新 ID |
|--------|-------|
| team-arch-opt | skills-extra-team |
| team-brainstorm | skills-extra-team |
| scholar-ideation | skills-scholar |
| ... | ... |

迁移在安装时自动执行，无需手动操作。

### 手动迁移

如需手动更新 manifest：

```bash
# 查看当前安装状态
maestro install --status

# 强制重新安装
maestro install --force
```

---

## 更新

```bash
# 检查更新
maestro update

# 预览变更（不实际应用）
maestro update --dry-run

# 强制覆盖
maestro update --force
```

---

## 卸载

```bash
# 交互式卸载
maestro uninstall

# 批量卸载（跳过确认）
maestro uninstall --yes
```

卸载时会：
1. 移除已安装的组件文件
2. 清理 manifest 记录
3. 保留 `.workflow/` 中的项目数据（specs、knowhow 等）

---

## 网络代理

如需通过代理安装，在 `~/.maestro/cli-tools.json` 中配置：

```json
{
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  }
}
```

---

## 常见问题

### 安装卡住

1. 检查网络连接
2. 尝试配置代理（见上）
3. 使用 `--verbose` 查看详细日志

### 组件缺失

```bash
# 重新安装
maestro install --force

# 检查组件状态
maestro install --status
```

### 权限错误

全局安装可能需要管理员权限：
```bash
# macOS/Linux
sudo npm install -g maestro-flow

# Windows（以管理员身份运行）
npm install -g maestro-flow
```

---

## 相关命令

```bash
# 安装管理
maestro install [--mode global|project] [--force] [--status]
maestro uninstall [--yes]
maestro update [--dry-run] [--force]

# 版本信息
maestro --version
```
