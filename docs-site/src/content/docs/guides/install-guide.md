---
title: "安装指南"
icon: "📦"
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
- Node.js ≥ 22.19
- 至少一个宿主 CLI：Claude Code（默认）和/或 [Grok Build](https://docs.x.ai/build/overview)
- Codex CLI / Gemini CLI / OpenCode / Pi（可选，用于多 Agent 工作流）

---

## 安装流程

`maestro install` 执行以下步骤：

1. **检测项目状态** — 已有 manifest / 磁盘上的平台目录 / 全新安装
2. **选择平台** — 交互式勾选宿主（含 Grok Build）
3. **选择组件** — 按平台过滤后的组件选择界面
4. **选择安装范围** — 全局（用户主目录）或项目级（`--path <dir>`）
5. **配置钩子 / MCP / Extra MCP / statusline**
6. **复制或构建文件** — 按组件定义写入目标位置
7. **生成 manifest** — 记录已安装组件，支持增量更新

> 共享运行时始终写入 `~/.maestro/`。平台资产写入 `~/.claude/`、`~/.grok/` 或项目下对应目录。`.workflow/` 是项目数据目录，不是安装目标。

### 加法语义（v0.5.50+）

安装采用**加法语义**——只添加、不删除。已存在的组件文件保留不覆盖，manifest 记录 `knownComponentIds` 跟踪所有曾安装过的组件。

关键机制：
- **安装锁** — 使用 lockfile 防止并发安装互相覆盖
- **原子写** — manifest 写入采用 write-tmp-then-rename，避免断电/崩溃导致 manifest 损坏
- **幂等安装** — 重复运行 `maestro install` 安全无副作用

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

> 自 v0.5.61 起 skill 面大幅精简：20 个零使用团队/辅助 skill 已删除，
> 原 skills-extra-team / skills-meta 成员或并入核心、或移除。现仅保留 1 个实质可选包。

#### skills-scholar（10 个学术技能，选装）

学术写作与研究的端到端技能链，默认不安装（源自 `optional/skills/`），用 `maestro install toggle` 启用：

| 技能 | 说明 |
|------|------|
| scholar-ideation | 研究选题 |
| scholar-writing | 论文写作（端到端） |
| scholar-experiment | 实验分析 |
| scholar-citation-verify | 引文核验 |
| scholar-anti-ai-writing | 去 AI 痕迹 |
| scholar-latex-organizer | LaTeX 整理 |
| scholar-review | 论文评审 |
| scholar-rebuttal-pro | 审稿回复 Pro |
| scholar-thesis-docx | 学位论文排版 |
| scholar-publish | 投稿准备 |

#### skills-extra-team / skills-meta（遗留空 bundle）

仅为旧清单回放迁移保留的 no-op 分组，不再安装任何技能。原成员去向：

- `team-arch-opt`、`team-issue`、`team-perf-opt` → 转为内置团队技能（skills-team）
- `skill-generator`、`skill-simplify`、`skill-iter-tune`、`skill-tuning`、`workflow-skill-designer` → 并入核心 `skills` 组件（始终安装）
- 其余 17 个 team-* 及 `prompt-generator`、`delegation-check`、`codify-to-knowhow`、`insight-challenge` → 已删除

### 内置团队技能（始终安装）

以下 8 个团队技能随核心组件（`skills-team`）自动安装，无需单独选择：

- team-arch-opt
- team-coordinate
- team-issue
- team-lifecycle-v4
- team-perf-opt
- team-review
- team-swarm
- team-testing

另有 6 个核心元技能随 `skills` 组件始终安装：maestro-help、skill-generator、
skill-iter-tune、skill-simplify、skill-tuning、workflow-skill-designer。

### 逐个启用/禁用技能（install toggle）

技能包按组安装后，可用 `maestro install toggle` 对单个技能、命令或 agent 精细控制：

```bash
# 交互式 TUI — 勾选/取消单个项目
maestro install toggle

# 列出所有项目及状态（✓ 启用 / ✗ 禁用 / · 未安装）
maestro install toggle --list

# 按类型过滤
maestro install toggle --type skill --list

# 非交互式启用/禁用（逗号分隔）
maestro install toggle --type skill --enable scholar-writing,scholar-review
maestro install toggle --type skill --disable scholar-latex-organizer

# 项目级安装作用域
maestro install toggle --path ./my-project --list
```

`--type` 取值：`command`、`skill`、`agent`。状态写入 manifest，支持增量更新与跨项目隔离。

---

## 安装模式

交互式安装默认进入 TUI；`--global` / `--path` 只预设范围。没有 `--mode` 标志。

### 全局范围（推荐）

平台资产写入用户主目录（如 `~/.claude/`、`~/.grok/`），共享运行时写入 `~/.maestro/`：

```bash
maestro install --global
```

适合：个人开发机，多项目共享配置

### 项目范围

平台资产写入指定项目（如 `<dir>/.claude/`、`<dir>/.grok/`）：

```bash
maestro install --path <dir>
```

适合：团队协作，项目特定配置。Grok 会从当前目录向上走到 git 根读取每一层 `.grok/config.toml`。

`--force` 会重建技能 / Agent，并对指令文件做 tag inject（更新 Maestro 段，保留段外用户正文）。没有 `--force` 时已存在的组件文件尽量不覆盖。

项目级 MCP / hooks 需要信任该文件夹（交互 `grok` 确认，或 `/hooks-trust`）。用户级 `~/.grok/config.toml` 的 `maestro-tools` 不依赖信任。安装器不会改 `trusted_folders.toml`。

---

## Extra MCP 目标

除 Claude Code 外，可将 `maestro-tools` 注册到：

| 目标 ID | 配置路径 | 格式 |
|---------|----------|------|
| `cursor` | `.cursor/mcp.json` | JSON |
| `qoder` | 项目根 `mcp.json` | JSON |
| `trae` | `.mcp.json` | JSON |
| `kiro` | `.kiro/settings/mcp.json` | JSON |
| `roo` | `.roo/mcp.json`（仅项目级） | JSON |
| `vscode-copilot` | `.vscode/mcp.json` | JSON |
| `gemini-cli` | `.gemini/settings.json` | JSON |
| `grok` | `~/.grok/config.toml` 或 `.grok/config.toml` | TOML `[mcp_servers.maestro-tools]` |

```bash
maestro install --force --extra-mcp grok,cursor
```

---

## Grok Build

Grok 是一等宿主与 delegate 后端。`maestro install` 勾选平台 `grok` 与 Extra MCP 的 Grok 目标即可。

```bash
# 安装 Grok CLI（macOS / Linux）
curl -fsSL https://x.ai/cli/install.sh | bash

# Windows PowerShell
irm https://x.ai/cli/install.ps1 | iex

# 安装 Maestro 的 Grok 资产 + MCP
# 全新机器请同时带上 workflows,prepare,ref,arch-kb,templates,overlays
maestro install --force --components workflows,prepare,ref,arch-kb,templates,overlays,grok-context,grok-md-chinese,grok-skills,grok-agents --extra-mcp grok
```

资产落点：`.grok/rules/maestro.md`、`.grok/skills/`、`.grok/agents/`（不是 `AGENTS.md`）。重装会剥离旧 `.grok/AGENTS.md` 里的 Maestro 段。项目资产写到调用方当前目录，可用 `--path`。装完只教 v3：`session open` → `run next` → `run complete --advance` → `session complete`。认证用 `grok login` 或 `XAI_API_KEY`。验证：

```bash
grok inspect
grok mcp doctor maestro-tools
maestro delegate "读 README 并总结" --to grok --mode analysis
```

执行 ID 前缀为 `grk-`。默认模型 `grok-4.6`。prompt 经 `--prompt-file` 传递。`maestro delegate message` 的 inject 会停掉当前 headless 轮次并以 `grok --continue` 重拉。完整说明见仓库 `guide/install-guide.md`。

---

## 从旧版本迁移

### v0.5.32+ 自动迁移

旧版本的个别 skill ID 会自动映射到新分组 ID：

| 旧 ID | 新 ID |
|--------|-------|
| team-arch-opt / team-issue / team-perf-opt | skills-team（已转为内置） |
| team-brainstorm 等已删除 team 技能 | skills-extra-team（遗留空 bundle，无操作） |
| prompt-generator / delegation-check | skills-meta（遗留空 bundle，无操作） |
| scholar-ideation 等 scholar-* | skills-scholar |
| ... | ... |

迁移在安装时自动执行，无需手动操作。

### 手动迁移

如需手动更新 manifest：

```bash
# 查看当前安装状态
maestro install toggle --list

# 强制重新安装
maestro install --force
```

---

## 更新

```bash
# 仅检查
maestro update --check

# 更新到最新
maestro update

# 预览版本通知
maestro update --notices --dry-run

# 非交互（CI）
maestro update --non-interactive
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
maestro install toggle --list
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
maestro install [--global|--path <dir>] [--force] [--all-platforms]
maestro install --force --extra-mcp grok,cursor --mcp --hooks standard
maestro uninstall [--yes]
maestro update [--check] [--notices] [--dry-run] [--non-interactive]

# 版本信息
maestro --version
```
