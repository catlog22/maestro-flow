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
- Node.js ≥ 22.19（`package.json` `engines.node`）
- 至少一个宿主 CLI：
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（默认宿主，提供 `/maestro-*` slash 命令）
  - [Grok Build CLI](https://docs.x.ai/build/overview)（一等宿主与 delegate 后端）
- Codex CLI / Gemini CLI / OpenCode / Pi（可选，用于多 Agent 工作流）

---

## 安装流程

`maestro install` 执行以下步骤：

1. **检测项目状态** — 已有 manifest / 磁盘上的平台目录 / 全新安装
2. **选择平台** — 交互式勾选宿主（Claude / Codex / Grok / 60+ EXTRA_PLATFORMS）
3. **选择组件** — 按平台过滤后的组件选择界面
4. **选择安装范围** — 全局（用户主目录）或项目级（`--path <dir>`）
5. **配置钩子 / MCP / Extra MCP / statusline**
6. **复制或构建文件** — 按组件定义写入目标位置
7. **生成 manifest** — 记录已安装组件，支持增量更新

> 安装范围决定的是平台资产落点（如 `~/.grok/` 或 `<项目>/.grok/`）。
> 共享运行时（`workflows` / `prepare` / `templates` / `overlays` / `arch-kb`）始终写入 `~/.maestro/`。
> `.workflow/` 是项目数据目录（specs、knowhow），不是安装目标。

> **`maestro explore` 需要额外配置（可选）**：它是独立的 OpenAI 兼容 API 通道，
> 需自行创建 `~/.maestro/api.json`（`model` + `baseUrl` + `apiKey`，格式见 `guide/explore-guide.md`）。
> 安装器不会也不应生成该文件；不配置时 explore 报 "No endpoints configured"，属预期状态。
> 零配置替代：`maestro search`、Grep/rg、宿主原生 `Agent()`、`maestro delegate`。

### 加法语义（v0.5.50+）

安装采用**加法语义**——只添加、不删除。已存在的组件文件保留不覆盖，manifest 记录 `knownComponentIds` 跟踪所有曾安装过的组件。

关键机制：
- **安装锁** — 使用 lockfile 防止并发安装互相覆盖
- **原子写** — manifest 写入采用 write-tmp-then-rename，避免断电/崩溃导致 manifest 损坏
- **幂等安装** — 重复运行 `maestro install` 安全无副作用

---

## 支持的平台 (Platforms)

在 `maestro install` 的第一步，你可以勾选当前项目或开发环境所需的目标 AI 辅助编程平台。

由于支持的平台多达 60+ 个，交互式 TUI 平台选择界面已进行**分页管理**（每页展示 10 项）。
* **分页切换**：支持使用键盘的 **左/右箭头 (`Left/Right`)**、**`h`/`l` 键** 以及 **`[`/`]` 键** 进行翻页。
* **快捷按键**：每页的前 9 项会被局部标记为 `[1]` 至 `[9]`，按下键盘对应的数字键可快捷勾选。
* **极客指示器**：底部显示分页指示器，如 `Page 1 / 7 [● ○ ○ ○ ○ ○ ○]`。

目前完整支持的平台列表如下（涵盖大部分主流 AI 编程客户端及 Agent 治具）：

| 平台 ID | 平台名称 (Label) | 安装目标路径 / 描述 |
|---------|------------------|-------------------|
| `claude` | Claude Code | 核心 Slash 命令、技能、Agent、Hooks、MCP |
| `codex` | Codex | Agent、技能、Hooks、MCP |
| `cursor` | Cursor | 技能、Agent → 复制到 `.cursor/` |
| `agy` | Agy (Gemini CLI) | 技能、Agent、Hooks → 复制到 `.gemini/` |
| `copilot` | GitHub Copilot | 技能、Agent → 复制到 `.github/` |
| `kiro` | Kiro | 技能、Agent → 复制到 `.kiro/` |
| `opencode` | OpenCode | 技能、Agent → 复制到 `.opencode/` |
| `kilo` | Kilo Code | 技能、Agent → 复制到 `.kilocode/` |
| `devin` | Devin | 技能、Agent → 复制到 `.devin/` |
| `qoder` | Qoder / Qoder CN | 技能、Agent → 复制到 `.qoder/` |
| `codebuddy` | CodeBuddy | 技能、Agent → 复制到 `.codebuddy/` |
| `droid` | Droid | 技能、Agent → 复制到 `.factory/` |
| `trae` | Trae / Trae CN | 技能、Agent → 复制到 `.trae/` |
| `roo` | Roo Code | 技能、Agent → 复制到 `.roo/` |
| `aider-desk` | AiderDesk | 技能、Agent → 复制到 `.aider-desk/` |
| `amp` | Amp | 技能、Agent → 复制到 `.amp/` |
| `antigravity` | Antigravity | 技能、Agent → 复制到 `.antigravity/` |
| `antigravity-cli` | Antigravity CLI | 技能、Agent → 复制到 `.antigravity-cli/` |
| `astrbot` | AstrBot | 技能、Agent → 复制到 `.astrbot/` |
| `autohand-code` | Autohand Code CLI | 技能、Agent → 复制到 `.autohand/` |
| `augment` | Augment | 技能、Agent → 复制到 `.augment/` |
| `bob` | IBM Bob | 技能、Agent → 复制到 `.bob/` |
| `cline` | Cline | 技能、Agent → 复制到 `.cline/` |
| `codearts-agent` | CodeArts Agent | 技能、Agent → 复制到 `.codeartsdoer/` |
| `codemaker` | Codemaker | 技能、Agent → 复制到 `.codemaker/` |
| `codestudio` | Code Studio | 技能、Agent → 复制到 `.codestudio/` |
| `command-code` | Command Code | 技能、Agent → 复制到 `.commandcode/` |
| `continue` | Continue | 技能、Agent → 复制到 `.continue/` |
| `cortex` | Cortex Code | 技能、Agent → 复制到 `.cortex/` |
| `crush` | Crush | 技能、Agent → 复制到 `.crush/` |
| `deepagents` | Deep Agents | 技能、Agent → 复制到 `.deepagents/` |
| `dexto` | Dexto | 技能、Agent → 复制到 `.dexto/` |
| `eve` | Eve | 技能、Agent → 复制到 `agent/` |
| `firebender` | Firebender | 技能、Agent → 复制到 `.firebender/` |
| `forgecode` | ForgeCode | 技能、Agent → 复制到 `.forge/` |
| `goose` | Goose | 技能、Agent → 复制到 `.goose/` |
| `grok` | Grok Build | 项目指令 → `.grok/rules/maestro.md`；技能 / Agent → `.grok/skills/`、`.grok/agents/` |
| `hermes-agent` | Hermes Agent | 技能、Agent → 复制到 `.hermes/` |
| `inference-sh` | inference.sh | 技能、Agent → 复制到 `.inferencesh/` |
| `jazz` | Jazz | 技能、Agent → 复制到 `.jazz/` |
| `junie` | Junie | 技能、Agent → 复制到 `.junie/` |
| `iflow-cli` | iFlow CLI | 技能、Agent → 复制到 `.iflow/` |
| `kimi-code-cli` | Kimi Code CLI | 技能、Agent → 复制到 `.kimi-code/` |
| `kode` | Kode | 技能、Agent → 复制到 `.kode/` |
| `lingma` | Lingma | 技能、Agent → 复制到 `.lingma/` |
| `loaf` | Loaf | 技能、Agent → 复制到 `.loaf/` |
| `mcpjam` | MCPJam | 技能、Agent → 复制到 `.mcpjam/` |
| `mistral-vibe` | Mistral Vibe | 技能、Agent → 复制到 `.vibe/` |
| `moxby` | Moxby | 技能、Agent → 复制到 `.moxby/` |
| `mux` | Mux | 技能、Agent → 复制到 `.mux/` |
| `openhands` | OpenHands | 技能、Agent → 复制到 `.openhands/` |
| `ona` | Ona | 技能、Agent → 复制到 `.ona/` |
| `qwen-code` | Qwen Code | 技能、Agent → 复制到 `.qwen/` |
| `replit` | Replit | 技能、Agent → 复制到 `.replit/` |
| `reasonix` | Reasonix | 技能、Agent → 复制到 `.reasonix/` |
| `rovodev` | Rovo Dev | 技能、Agent → 复制到 `.rovodev/` |
| `tabnine-cli` | Tabnine CLI | 技能、Agent → 复制到 `.tabnine/` |
| `terramind` | Terramind | 技能、Agent → 复制到 `.terramind/` |
| `tinycloud` | Tinycloud | 技能、Agent → 复制到 `.tinycloud/` |
| `warp` | Warp | 技能、Agent → 复制到 `.warp/` |
| `windsurf` | Windsurf | 技能、Agent → 复制到 `.windsurf/` |
| `zed` | Zed | 技能、Agent → 复制到 `.zed/` |
| `zencoder` | Zencoder / Zenflow | 技能、Agent → 复制到 `.zencoder/` |
| `neovate` | Neovate | 技能、Agent → 复制到 `.neovate/` |
| `pochi` | Pochi | 技能、Agent → 复制到 `.pochi/` |
| `promptscript` | PromptScript | 技能、Agent → 复制到 `.promptscript/` |
| `adal` | AdaL | 技能、Agent → 复制到 `.adal/` |
| `agents-standard` | Open Standard | `.agents/` 开放规范格式（多平台通用） |

> **Pi Agent 提示**：Maestro 不再直接安装 Pi 平台（不再向 `~/.pi/` 复制技能/Agent）。
> 请在 Pi 中安装官方 Maestro Flow 插件以接入 Pi 平台：
>
> ```bash
> pi install https://github.com/catlog22/pi-maestro-flow
> ```

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
| **skills-scholar** | scholar-ideation, scholar-writing, scholar-review, scholar-rebuttal-pro 等 10 个 | 学术研究技能（选装，默认不安装，源自 `optional/skills/`） |
| **skills-extra-team** | — | 遗留空 bundle，仅为旧清单回放迁移保留，不再安装任何技能 |
| **skills-meta** | — | 遗留空 bundle（原成员已并入核心 `skills`），仅为迁移保留 |

> 自 v0.5.61 起，skill 面大幅精简：20 个零使用团队/辅助 skill 已删除，
> 10 个 `scholar-*` 技能改为选装。技能管理用 `maestro install toggle`，
> 例如 `maestro install toggle --enable scholar-writing`。

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

---

## 安装模式

交互式安装默认进入 TUI；`--global` / `--path` 只预设范围，也可与 `--force` 一起用于非交互安装。**没有** `--mode` 标志。

### 全局范围（推荐）

平台资产写入用户主目录（如 `~/.claude/`、`~/.grok/`），共享运行时写入 `~/.maestro/`：

```bash
maestro install --global
maestro install --force --global
```

适合：个人开发机，多项目共享配置

### 项目范围

平台资产写入指定项目（如 `<dir>/.claude/`、`<dir>/.grok/`），仅当前项目生效：

```bash
maestro install --path ./my-project
maestro install --force --path ./my-project
```

适合：团队协作，项目特定配置。Grok 会从当前目录向上走到 git 根读取每一层 `.grok/config.toml`。

`--force` 会重建技能 / Agent 文件，并对指令文件做 tag inject（更新 `<!-- maestro:start/end -->` 段，段外用户正文保留）。这与默认交互安装的加法语义不同：没有 `--force` 时已存在的组件文件尽量不覆盖。

Grok 项目指令落在 `.grok/rules/maestro.md`。若目录里还留着旧的 `.grok/AGENTS.md` 且含 Maestro 段，安装时会剥段或在剥空后删除，避免与 `rules/maestro.md` 重复进上下文。

项目级 MCP / hooks 需要 Grok 信任该文件夹（交互 `grok` 确认，或 TUI `/hooks-trust`）。用户级 `~/.grok/config.toml` 里的 `maestro-tools` 不依赖这一步。`maestro install` 不会改 `~/.grok/trusted_folders.toml`。

---

## 子命令

`maestro install` 提供以下子命令，可直接访问特定安装步骤：

| 子命令 | 说明 |
|--------|------|
| `maestro install components` | 安装文件组件（交互式组件选择） |
| `maestro install hooks` | 安装钩子（交互式级别选择） |
| `maestro install mcp` | 注册 MCP 服务器（交互式工具选择） |
| `maestro install toggle` | 启用/禁用已安装的命令、技能、代理 |
| `maestro install fonts` | 安装字体资源 |
| `maestro install workflows` | 只安装共享工作流 / prepare / ref / arch-kb |
| `maestro install entry-commands` | 生成薄 slash 命令包装（默认 grill、collab） |
| `maestro install embedding` | 管理本地 embedding 模型与索引 |
| `maestro install wizard` | 启动完整交互式 TUI 向导（旧版） |

每个子命令支持 `--global` 或 `--path <dir>` 指定安装范围。

---

## Toggle — 启用/禁用管理

`maestro install toggle` 提供交互式 TUI 和非交互式命令行两种方式，管理已安装的命令、技能和代理的启用状态。

### 三状态模型

每个条目有三种状态：

| 状态 | 图标 | 含义 |
|------|------|------|
| **on** | ✓ | 已安装且已启用 |
| **off** | ✗ | 已安装但已禁用（文件重命名为 `.md.disabled`） |
| **available** | · | 源目录中存在，但尚未安装到目标位置 |

禁用机制：将 `.md` 文件重命名为 `.md.disabled`，启用时反向重命名恢复。对技能类型，禁用 `SKILL.md` → `SKILL.md.disabled`。

### 交互式 TUI

```bash
# 全局安装的 toggle
maestro install toggle

# 项目安装的 toggle
maestro install toggle --path ./my-project
```

ToggleView 界面提供三个标签页：

| 标签页 | 内容 |
|--------|------|
| **Commands** | 所有 `.claude/commands/*.md` 命令文件 |
| **Skills** | 所有 `.claude/skills/*/SKILL.md` 技能目录 |
| **Agents** | 所有 `.claude/agents/*.md` 代理文件 |

操作方式：
- **Tab** — 切换标签页（Shift+Tab 反向）
- **空格** — 切换当前条目状态（available→on, on→off, off→on）
- **上/下箭头** — 移动光标
- **Enter** — 保存并退出（更新 manifest 中的 disabledItems 列表）
- **Escape** — 退出（如有未保存变更则自动保存）

视口窗口：当条目超过 20 项时，显示滚动提示（↑ N more / ↓ N more）。

可通过 `--type` 标志限定标签页：

```bash
# 只显示命令标签页
maestro install toggle --type command
```

### 非交互式操作

```bash
# 列出所有条目及状态
maestro install toggle --list

# 按类型过滤
maestro install toggle --list --type skill

# 批量启用
maestro install toggle --enable "maestro-ralph,maestro-search"

# 批量禁用
maestro install toggle --disable "team-swarm,team-review"
```

---

## Config Profile — 配置导出/导入

安装配置可导出为 JSON profile 文件，用于团队共享或 CI 环境复现安装。

### 导出 Profile

```bash
# 从全局安装配置导出
maestro install --export

# 导出到指定路径
maestro install --export ./team-profile.json

# 从项目配置导出
maestro install --path ./my-project --export
```

导出的 profile 包含：组件选择、钩子级别、MCP 配置、statusline 主题等完整安装配置。

### 导入 Profile

```bash
# 从 profile 非交互安装
maestro install --import ./team-profile.json
```

导入时自动执行完整安装流程，无需人工干预。适合：
- 团队统一开发环境
- CI/CD 环境快速初始化
- 多机器配置同步

### Profile 存储位置

导出的 profile 默认保存到 `~/.maestro/install-profiles/` 目录。

---

## Extra MCP 目标

除 Claude Code 外，`maestro install` 支持将 MCP 服务器注册到以下 IDE/工具：

| 目标 ID | 配置文件路径 | 说明 |
|---------|-------------|------|
| `cursor` | `.cursor/mcp.json` | Cursor IDE |
| `qoder` | 项目根 `mcp.json` | Qoder |
| `trae` | `.mcp.json` | Trae IDE |
| `kiro` | `.kiro/settings/mcp.json` | Kiro IDE |
| `roo` | `.roo/mcp.json` | Roo Code（仅项目级） |
| `vscode-copilot` | `.vscode/mcp.json` | VS Code Copilot |
| `gemini-cli` | `.gemini/settings.json` | Gemini CLI |
| `grok` | `~/.grok/config.toml` 或 `.grok/config.toml` | Grok Build（TOML `[mcp_servers.maestro-tools]`） |

在交互式安装向导中，Extra MCP 步骤可选择注册到上述目标。每个目标支持全局和项目两种范围（`roo` 仅项目级）。

MCP 工具列表（7 个）：`write_file`, `edit_file`, `read_file`, `read_many_files`, `team_msg`, `store_knowhow`, `delegate`（任务委派，默认只读模式）

非交互示例：

```bash
maestro install --force --extra-mcp grok,cursor
```

`--extra-mcp` 必须使用上表的目标 ID（`vscode-copilot`、`gemini-cli`、`grok`），不能写成 `vscode` / `gemini`。

---

## Grok Build

Grok 是一等宿主与 delegate 后端。安装后可在 Grok TUI 中使用 Maestro 技能，也可 `maestro delegate --to grok`。

### 安装 Grok CLI

```bash
# macOS / Linux
curl -fsSL https://x.ai/cli/install.sh | bash

# Windows PowerShell
irm https://x.ai/cli/install.ps1 | iex
```

认证任选其一：交互式 `grok login`，或设置 `XAI_API_KEY`。

### 安装 Maestro 的 Grok 资产

交互式 `maestro install` 勾选平台 `grok`，并在 Extra MCP 步骤勾选 Grok。等价的非交互命令：

```bash
# 全新机器请同时带上 workflows,prepare,ref,arch-kb,templates,overlays
maestro install --force --components workflows,prepare,ref,arch-kb,templates,overlays,grok-context,grok-md-chinese,grok-skills,grok-agents --extra-mcp grok
```

| 组件 ID | 落点 |
|---------|------|
| `grok-context` | `.grok/rules/maestro.md`（注入项目指令） |
| `grok-md-chinese` | 同一 `rules/maestro.md` 的中文回复段 |
| `grok-skills` | `.grok/skills/`（`SKILL.md` 标准格式） |
| `grok-agents` | `.grok/agents/` |

不要把 `~/.grok/AGENTS.md` 或 `.grok/AGENTS.md` 当成项目指令落点。安装时会剥离旧文件里的 Maestro 段。Grok 官方会发现 `./.grok/skills/`（向仓库根上溯）与 `~/.grok/skills/`。

项目级 MCP / hooks 需要信任该文件夹（交互 `grok` 确认，或 `/hooks-trust`）。用户级 `maestro-tools` 不依赖信任。

装完只教 v3 主线：`session open` → `run next` → `run complete --advance` → `session complete`。

写入的 MCP 段形如：

```toml
[mcp_servers.maestro-tools]
command = "maestro-mcp"
args = []
env = { MAESTRO_ENABLED_TOOLS = "write_file,edit_file,read_file,read_many_files,team_msg,store_knowhow,delegate" }
enabled = true
```

Windows 上 `command` 为当前 `node.exe`，`args` 为 `maestro-mcp.js` 的绝对路径，避免 `cmd /c maestro-mcp.cmd` 弹出控制台窗口。写入器只替换 `maestro-tools` 这一节，保留其余配置与注释。

### 验证

```bash
grok inspect                 # 查看本目录发现的指令 / skills / MCP
grok mcp list
grok mcp doctor maestro-tools
maestro delegate "读 README 并总结" --to grok --mode analysis
```

项目级 MCP 受 Grok 自身文件夹信任策略约束；用户级 `~/.grok/config.toml` 更适合本机默认启用。

### Delegate

```bash
maestro delegate "<PROMPT>" --to grok --mode analysis
```

执行 ID 前缀为 `grk-`。默认模型 `grok-4.6`。prompt 经 `--prompt-file` 临时文件传递，避免命令行长度限制。`maestro delegate message` 的 inject 会停掉当前 headless 轮次并以 `grok --continue` 重拉（见 `workflows/delegate-usage.md`）。

Grok 里也可以直接调 MCP 工具 `delegate`（`run` / `message` / `status` / `output` / `cancel`），不必再开一层命令行。默认只读。旧安装需重跑 Extra MCP 才能看到该工具。

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

如需手动更新：

```bash
# 强制重新安装
maestro install --force
```

---

## 更新

```bash
# 检查更新（仅检查，不安装）
maestro update --check

# 更新到最新版本
maestro update

# 预览更新通知（配合 --notices 使用）
maestro update --notices --dry-run

# 非交互式更新（CI/自动化场景）
maestro update --non-interactive
```

### 更新流程

执行 `maestro update` 时会自动执行三步流程：

1. **重装工作流** — 使用 profile-based 机制（`manifestToProfile + spawn --import --upgrade`）
2. **应用版本通知** — 显示新版本的功能/工具/技能变更
3. **运行迁移** — 执行必要的数据迁移

### Profile-Based 重装机制

v0.5.37 引入了基于 Profile 的重装机制，解决了 Windows 命令行长度限制（~8192 字符）和 shell 转义问题：

- `manifestToProfile()` 将当前安装状态导出为临时 Profile JSON
- `spawn --import --upgrade` 使用新版本重新导入
- `mergeNewDefaults()` 自动将新默认组件合并到已有选择中

### --upgrade 标志

```bash
# 导入 Profile 并合并新默认组件
maestro install --import profile.json --upgrade
```

`--upgrade` 标志告诉安装命令在导入时调用 `mergeNewDefaults()`，自动添加新版本中 `defaultSelected !== false` 的组件。

### 更新选项

| 选项 | 说明 |
|------|------|
| `--check` | 仅检查更新，不安装 |
| `--notices` | 显示版本通知 |
| `--dry-run` | 预览变更（需配合 `--notices`） |
| `--from <ver>` | 指定起始版本（通知过滤） |
| `--to <ver>` | 指定目标版本（通知过滤） |
| `--non-interactive` | 非交互式模式（CI/自动化） |
| `--migrate <path>` | 运行指定迁移脚本（内部使用） |

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
# 强制重新安装
maestro install --force
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
maestro install [--global] [--path <dir>] [--force] [--all-platforms]
maestro install [--export [path]] [--import <path>] [--upgrade]
maestro install [--load <path>]  # 尚未实现；请用 --import
maestro install --force --extra-mcp grok,cursor --mcp --hooks standard
maestro uninstall [--yes]
maestro update [--check] [--notices] [--dry-run] [--from <ver>] [--to <ver>] [--non-interactive]

# 子命令
maestro install components [--global | --path <dir>]
maestro install hooks [--global | --project]
maestro install mcp [--global | --path <dir>]
maestro install toggle [--global | --path <dir>] [--type <type>] [--enable <names>] [--disable <names>] [--list]
maestro install fonts
maestro install workflows
maestro install entry-commands [--steps <list>]
maestro install embedding [--download] [--status] [--local] [--rebuild]
maestro install wizard

# 版本信息
maestro --version
```
