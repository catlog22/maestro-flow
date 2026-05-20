---
title: "CLI 终端命令参考"
---

Maestro 提供 21 个终端命令，通过 `maestro <command>` 直接调用。覆盖安装、委派、协调、Wiki、Hook、协作等全场景。

> **别名**: `coord`->`coordinate`、`msg`->`agent-msg`、`kh`->`knowhow`、`bv`->`brainstorm-visualize`、`team`->`collab`。

---

## 命令总览

| 命令 | 别名 | 用途 |
|------|------|------|
| `install` | -- | 安装 Maestro 资源（交互式） |
| `uninstall` | -- | 卸载已安装资源 |
| `update` | -- | 检查/安装最新版本 |
| `view` | -- | 启动 Dashboard 看板 |
| `stop` | -- | 停止 Dashboard 服务 |
| `delegate` | -- | 委派任务给 AI 智能体 |
| `coordinate` | `coord` | 图工作流协调器 |
| `cli` | -- | 运行 CLI 智能体工具 |
| `run` | -- | 执行指定工作流 |
| `serve` | -- | 启动工作流服务器 |
| `launcher` | -- | Claude Code 启动器 |
| `spec` | -- | 项目 Spec 管理 |
| `wiki` | -- | Wiki 知识图谱查询 |
| `hooks` | -- | Hook 管理与运行 |
| `overlay` | -- | 命令 Overlay 管理 |
| `collab` | `team` | 人类团队协作 |
| `agent-msg` | `msg` | 智能体团队消息总线 |
| `knowhow` | `kh` | 知识复用管理 |
| `brainstorm-visualize` | `bv` | 头脑风暴可视化服务器 |
| `ext` | -- | 扩展管理 |
| `tool` | -- | 工具交互（list/exec） |

---

## 安装与更新

<details>
<summary>maestro install</summary>

安装 Maestro 资源到项目或全局目录。交互式步骤选择。

```bash
maestro install                           # 交互式安装
maestro install --force                   # 非交互批量安装
maestro install components                # 安装文件组件
maestro install hooks                     # 安装 Hook
maestro install mcp                       # 注册 MCP 服务器
```

| 选项 | 说明 |
|------|------|
| `--force` | 非交互批量安装所有组件 |
| `--global` | 仅安装全局资源 |
| `--path <dir>` | 安装到指定项目目录 |
| `--hooks <level>` | Hook 级别：none / minimal / standard / full |
| `--codex-hooks <level>` | Codex Hook 级别 |
| `--codex-mcp` | 注册 Codex MCP 服务器 |

> 交互式模式新增 Codex Hooks 和 Codex MCP 配置步骤。

</details>

<details>
<summary>maestro uninstall / update</summary>

**uninstall** -- 移除已安装资源：

```bash
maestro uninstall              # 交互式卸载
maestro uninstall --all -y     # 卸载所有，跳过确认
```

**update** -- 检查并安装最新版本：

```bash
maestro update                 # 检查并提示安装
maestro update --check         # 仅检查
```

</details>

---

## Dashboard

<details>
<summary>maestro view / stop</summary>

**view** -- 启动 Dashboard 看板（浏览器或 TUI）：

```bash
maestro view                   # 启动（自动打开浏览器）
maestro view --tui             # 终端 UI 模式
maestro view --dev             # Vite 开发模式
maestro view --port 8080       # 指定端口
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--port`, `-p` | `3001` | 服务端口 |
| `--host` | `127.0.0.1` | 绑定主机 |
| `--path <dir>` | CWD | 工作区根目录 |
| `--no-browser` | -- | 不自动打开浏览器 |
| `--tui` | -- | 终端 UI 模式 |
| `--dev` | -- | Vite 开发服务器模式 |

**stop** -- 停止 Dashboard（graceful -> 端口查找 -> force kill）：

```bash
maestro stop                   # 优雅停止
maestro stop --force           # 强制终止
maestro stop --port 8080       # 指定端口
```

</details>

---

## 任务执行

<details>
<summary>maestro delegate</summary>

委派任务给 AI 智能体（gemini/qwen/codex/claude/opencode）。支持同步、异步、会话恢复。

```bash
maestro delegate "analyze auth module" --to gemini
maestro delegate "fix bug" --to gemini --async
maestro delegate show
maestro delegate output gem-143022-a7f2
maestro delegate status gem-143022-a7f2
maestro delegate message gem-143022-a7f2 "also check utils"
maestro delegate "continue" --to gemini --resume
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--to <tool>` | 首个启用工具 | 目标工具 |
| `--mode <mode>` | `analysis` | analysis（只读）/ write |
| `--model <model>` | 工具默认 | 模型覆盖 |
| `--cd <dir>` | CWD | 工作目录 |
| `--rule <template>` | -- | 协议+模板加载 |
| `--id <id>` | 自动生成 | 执行 ID |
| `--resume [id]` | -- | 恢复会话 |
| `--async` | -- | 后台异步执行 |
| `--backend <type>` | `direct` | 适配后端：direct / terminal |

**子命令**: `show [--all]`、`output <id>`、`status <id>`、`tail <id>`、`cancel <id>`、`message <id> <text>`、`messages <id>`

</details>

<details>
<summary>maestro coordinate</summary>

图工作流协调器，支持 step 模式和 auto 模式。

```bash
maestro coordinate list                                    # 列出链图
maestro coordinate run "implement auth" --chain default -y # 自动运行
maestro coordinate start "implement auth" --chain default  # 步进模式
maestro coordinate next <sessionId>                        # 下一步
maestro coordinate status <sessionId>                      # 会话状态
maestro coordinate report --session <id> --node <id> --status SUCCESS
```

| 选项 | 说明 |
|------|------|
| `--chain <name>` | 指定链图 |
| `--tool <tool>` | 智能体工具（默认 `claude`） |
| `-y` | 自动确认模式 |
| `--parallel` | 启用 fork/join 并行 |
| `--dry-run` | 预览执行计划 |
| `-c` | 恢复会话 |

</details>

<details>
<summary>maestro cli / run / serve</summary>

**cli** -- 统一 CLI 智能体工具接口：

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
```

选项同 `delegate`（`-p` 必填），另有 `show`、`output <id>`、`watch <id>` 子命令。

**run** -- 执行指定名称的工作流：

```bash
maestro run <workflow>           # 执行
maestro run <workflow> --dry-run # 预览
maestro run <workflow> -c config.json
```

**serve** -- 启动工作流服务器：

```bash
maestro serve --port 3600 --host localhost
```

</details>

---

## 项目管理

<details>
<summary>maestro launcher</summary>

Claude Code 统一启动器，管理 workflow profile 和 settings 切换。

```bash
maestro launcher -w my-project -s dev   # 指定 profile 启动
maestro launcher list                   # 列出所有 profile
maestro launcher status                 # 当前活跃 profile
maestro launcher add-workflow my-proj --claude-md ./CLAUDE.md
maestro launcher add-settings dev ./settings-dev.json
maestro launcher scan ./configs         # 扫描配置文件
```

</details>

<details>
<summary>maestro spec</summary>

项目 Spec 管理（初始化、加载、列表、状态）。

```bash
maestro spec init                              # 初始化
maestro spec load --category coding --keyword auth
maestro spec list                              # 列出文件
maestro spec status                            # 状态
maestro spec add <category> "<title>" "<content>"
```

</details>

<details>
<summary>maestro wiki</summary>

Wiki 知识图谱查询和变更。默认离线，`--live` 使用 HTTP API。

```bash
# 列表与搜索
maestro wiki list --type spec --tag security --status active --group --json
maestro wiki list -q "authentication"                # BM25 内联搜索
maestro wiki search "auth token"                     # 全文搜索
maestro wiki get <id>                                # 获取单条

# 创建（spec / memory / note）
maestro wiki create --type spec --slug auth --title "Auth" --body "# Auth\n..."
  # 可选: --created-by, --source-ref, --parent, --frontmatter

# 条目追加与移除
maestro wiki append <containerId> --body "..." --keywords "coding,exports"
maestro wiki remove-entry <entryId>

# 更新 / 删除
maestro wiki update <id> --title "New Title"
maestro wiki delete <id>

# 图谱分析
maestro wiki health | orphans | hubs --limit 10 | backlinks <id> | forward <id> | graph
```

> **写保护**：`specs/*.md` 的 body 通过 `wiki update` 禁止修改（403），需使用 `wiki append` / `wiki remove-entry`。`memory/*.md` 支持 CRUD。虚拟条目完全只读。

</details>

<details>
<summary>maestro hooks</summary>

Hook 管理与评估器运行。支持 Claude Code 和 Codex 双平台。

```bash
# Claude Code
maestro hooks install --level full
maestro hooks uninstall

# Codex
maestro hooks install --target codex --level standard
maestro hooks uninstall --target codex

# 通用
maestro hooks status               # 安装状态（双平台）
maestro hooks list                 # 列出所有 Hook
maestro hooks toggle spec-injector on
maestro hooks run spec-injector    # 运行评估器
```

| 选项 | 说明 |
|------|------|
| `--target` | `claude`（默认）或 `codex` |
| `--level` | minimal / standard / full |
| `--global` | 安装到全局（默认） |
| `--project` | 安装到项目级 |

> Codex hooks 需 `~/.codex/config.toml` 中启用 `codex_hooks = true`。Windows 暂不支持。

</details>

<details>
<summary>maestro overlay</summary>

命令 Overlay 管理 -- 非侵入式 `.claude/commands` 补丁。

```bash
maestro overlay list                    # 查看并管理
maestro overlay apply                   # 重新应用（幂等）
maestro overlay add my-overlay.json     # 安装
maestro overlay remove my-overlay       # 移除
maestro overlay bundle -o bundle.json   # 打包
maestro overlay import-bundle bundle.json
maestro overlay push                    # 推送到团队共享
```

</details>

---

## 团队协作

<details>
<summary>maestro collab (team)</summary>

人类团队协作。

```bash
maestro collab join                    # 注册为团队成员
maestro collab whoami                  # 当前身份
maestro collab status                  # 团队活动
maestro collab sync                    # 同步远程
maestro collab preflight --phase 1     # 冲突预检
maestro collab guard                   # 命名空间边界
maestro collab task create --title "task"
maestro collab task list --status open
maestro collab task status <id> in_progress
maestro collab task assign <id> <uid>
```

</details>

<details>
<summary>maestro agent-msg (msg)</summary>

智能体团队消息总线。

```bash
maestro msg send "task done" -s <session> --from worker --to coordinator
maestro msg list -s <session> --last 10
maestro msg status -s <session>
maestro msg broadcast "meeting" -s <session> --from coordinator
```

</details>

---

## 记忆与扩展

<details>
<summary>maestro knowhow (kh)</summary>

知识复用管理。6 种类型: session, tip, template, recipe, reference, decision。

```bash
maestro kh add --type template --title "React Hook Form" --body "..." --lang typescript
maestro kh add --type recipe --title "Deploy" --body "Steps: ..." --tags deploy
maestro kh add --type decision --title "Use PG" --body "ADR: ..." --status accepted
maestro kh list                           # 列出全部
maestro kh list --type template           # 按类型筛选
maestro kh search "deploy"               # 关键词搜索
maestro kh get knowhow-20260427-1912     # 查看详情
```

</details>

<details>
<summary>maestro brainstorm-visualize (bv) / ext / tool</summary>

**brainstorm-visualize** -- 头脑风暴 HTML 原型可视化服务器：

```bash
maestro bv start --dir ./prototypes     # 启动服务
maestro bv status <execId>              # 查看状态
maestro bv stop <execId>                # 停止服务
```

**ext** -- 扩展管理：

```bash
maestro ext list                        # 列出扩展
```

**tool** -- 工具交互：

```bash
maestro tool list                       # 列出工具
maestro tool exec read_file '{"path":"README.md"}'
```

</details>
