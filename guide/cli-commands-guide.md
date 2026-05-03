# CLI 终端命令参考

Maestro 提供 21 个终端命令，通过 `maestro <command>` 直接调用。覆盖安装、委派、协调、Wiki、Hook、协作等全场景。

> **别名**: 部分命令有短别名，如 `coord` → `coordinate`、`msg` → `agent-msg`、`kh` → `knowhow`、`bv` → `brainstorm-visualize`、`team` → `collab`。

---

## 目录

- [命令总览](#命令总览)
- [安装与更新](#安装与更新)
  - [maestro install](#maestro-install)
  - [maestro uninstall](#maestro-uninstall)
  - [maestro update](#maestro-update)
- [Dashboard](#dashboard)
  - [maestro view](#maestro-view)
  - [maestro stop](#maestro-stop)
- [任务执行](#任务执行)
  - [maestro delegate](#maestro-delegate)
  - [maestro coordinate](#maestro-coordinate)
  - [maestro cli](#maestro-cli)
  - [maestro run](#maestro-run)
  - [maestro serve](#maestro-serve)
- [项目管理](#项目管理)
  - [maestro launcher](#maestro-launcher)
  - [maestro spec](#maestro-spec)
  - [maestro wiki](#maestro-wiki)
  - [maestro hooks](#maestro-hooks)
  - [maestro overlay](#maestro-overlay)
- [团队协作](#团队协作)
  - [maestro collab](#maestro-collab)
  - [maestro agent-msg](#maestro-agent-msg)
- [记忆与扩展](#记忆与扩展)
  - [maestro knowhow](#maestro-knowhow)
  - [maestro brainstorm-visualize](#maestro-brainstorm-visualize)
  - [maestro ext / maestro tool](#maestro-ext--maestro-tool)

---

## 命令总览

| 命令 | 别名 | 用途 |
|------|------|------|
| `maestro install` | — | 安装 Maestro 资源（交互式） |
| `maestro uninstall` | — | 卸载已安装资源 |
| `maestro update` | — | 检查/安装最新版本 |
| `maestro view` | — | 启动 Dashboard 看板 |
| `maestro stop` | — | 停止 Dashboard 服务 |
| `maestro delegate` | — | 委派任务给 AI 智能体 |
| `maestro coordinate` | `coord` | 图工作流协调器 |
| `maestro cli` | — | 运行 CLI 智能体工具 |
| `maestro run` | — | 执行指定工作流 |
| `maestro serve` | — | 启动工作流服务器 |
| `maestro launcher` | — | Claude Code 启动器 |
| `maestro spec` | — | 项目 Spec 管理 |
| `maestro wiki` | — | Wiki 知识图谱查询 |
| `maestro hooks` | — | Hook 管理与运行 |
| `maestro overlay` | — | 命令 Overlay 管理 |
| `maestro collab` | `team` | 人类团队协作 |
| `maestro agent-msg` | `msg` | 智能体团队消息总线 |
| `maestro knowhow` | `kh` | 知识复用管理 |
| `maestro brainstorm-visualize` | `bv` | 头脑风暴可视化服务器 |
| `maestro ext` | — | 扩展管理 |
| `maestro tool` | — | 工具交互（list/exec） |

---

## 安装与更新

### maestro install

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

---

### maestro uninstall

移除已安装的 Maestro 资源。

```bash
maestro uninstall              # 交互式卸载
maestro uninstall --all        # 卸载所有已记录安装
maestro uninstall --all -y     # 跳过确认
```

---

### maestro update

检查并安装最新版本。

```bash
maestro update                 # 检查并提示安装
maestro update --check         # 仅检查，不安装
```

---

## Dashboard

### maestro view

启动 Dashboard 看板（浏览器或 TUI）。

```bash
maestro view                   # 启动看板（自动打开浏览器）
maestro view --tui             # 终端 UI 模式
maestro view --dev             # Vite 开发模式（HMR）
maestro view --port 8080       # 指定端口
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--port`, `-p` | `3001` | 服务端口 |
| `--host` | `127.0.0.1` | 绑定主机 |
| `--path <dir>` | CWD | 工作区根目录 |
| `--no-browser` | — | 不自动打开浏览器 |
| `--tui` | — | 终端 UI 模式 |
| `--dev` | — | Vite 开发服务器模式 |

---

### maestro stop

停止 Dashboard 服务器。三阶段策略：graceful shutdown → 端口查找 kill → force kill。

```bash
maestro stop                   # 优雅停止
maestro stop --force           # 强制终止
maestro stop --port 8080       # 指定端口
```

---

## 任务执行

### maestro delegate

委派任务给 AI 智能体工具（gemini/qwen/codex/claude/opencode）。支持同步、异步、会话恢复。

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
| `--mode <mode>` | `analysis` | analysis（只读）/ write（可写） |
| `--model <model>` | 工具默认 | 模型覆盖 |
| `--cd <dir>` | CWD | 工作目录 |
| `--rule <template>` | — | 协议+模板加载 |
| `--id <id>` | 自动生成 | 执行 ID |
| `--resume [id]` | — | 恢复上次/指定会话 |
| `--async` | — | 后台异步执行 |
| `--backend <type>` | `direct` | 适配后端：direct / terminal |

**子命令:**

| 子命令 | 说明 |
|--------|------|
| `show [--all]` | 列出执行历史 |
| `output <id> [--verbose]` | 获取输出 |
| `status <id> [--events N]` | 查看状态 |
| `tail <id>` | 最近事件+历史 |
| `cancel <id>` | 请求取消 |
| `message <id> <text> [--delivery inject\|after_complete]` | 注入消息 |
| `messages <id>` | 查看消息队列 |

---

### maestro coordinate

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
| `-y`, `--yes` | 自动确认模式 |
| `--parallel` | 启用 fork/join 并行 |
| `--dry-run` | 预览执行计划 |
| `--continue`, `-c` | 恢复会话 |

---

### maestro cli

统一 CLI 智能体工具接口。

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
maestro cli show
maestro cli output <id>
maestro cli watch <id>
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `-p`, `--prompt` | **必填** | 提示文本 |
| `--tool <name>` | 首个启用工具 | CLI 工具 |
| `--mode <mode>` | `analysis` | 执行模式 |
| `--model <model>` | 工具默认 | 模型覆盖 |
| `--cd <dir>` | CWD | 工作目录 |
| `--rule <template>` | — | 模板加载 |
| `--id <id>` | 自动生成 | 执行 ID |
| `--resume [id]` | — | 恢复会话 |

---

### maestro run

执行指定名称的工作流。

```bash
maestro run <workflow>           # 执行工作流
maestro run <workflow> --dry-run  # 预览
maestro run <workflow> -c config.json
```

---

### maestro serve

启动工作流服务器。

```bash
maestro serve --port 3600 --host localhost
```

---

## 项目管理

### maestro launcher

Claude Code 统一启动器，管理 workflow profile 和 settings 切换。

```bash
maestro launcher -w my-project -s dev   # 指定 profile 启动
maestro launcher list                   # 列出所有 profile
maestro launcher status                 # 当前活跃 profile
maestro launcher add-workflow my-proj --claude-md ./CLAUDE.md
maestro launcher add-settings dev ./settings-dev.json
maestro launcher scan ./configs         # 扫描配置文件
```

---

### maestro spec

项目 Spec 管理（初始化、加载、列表、状态）。

```bash
maestro spec init                              # 初始化
maestro spec load --category coding --keyword auth  # 加载
maestro spec list                              # 列出文件
maestro spec status                            # 状态
maestro spec add <category> "<title>" "<content>"    # 添加条目
```

---

### maestro wiki

Wiki 知识图谱查询和变更。默认离线，`--live` 使用 HTTP API。

```bash
# 列表 + 过滤
maestro wiki list --type spec                        # 按类型
maestro wiki list --category security                # 按分类
maestro wiki list --created-by manage-harvest        # 按创建来源
maestro wiki list --tag auth --status active          # 组合过滤
maestro wiki list --group                            # 按类型分组
maestro wiki list -q "authentication"                # BM25 内联搜索
maestro wiki list --json                             # JSON 输出

# 搜索
maestro wiki search "auth token"                     # BM25 全文搜索
maestro wiki get <id>                                # 获取单条

# 创建（spec / memory / note）
maestro wiki create --type spec --slug auth --title "Auth" --body "# Auth\n..."
maestro wiki create --type memory --slug debug-01 --title "Debug" --body "..."
maestro wiki create --type note --slug tip-01 --title "Tip" --body "..."
  # 可选: --category, --created-by, --source-ref, --parent, --frontmatter '{}'

# Spec 条目追加（统一写入路径）
maestro wiki append <containerId> --category coding --body "Use named exports"
maestro wiki append spec-learnings --category learning --body "Token rotation..." --keywords "auth,token"

# Spec 条目移除
maestro wiki remove-entry <entryId>                  # 按 ID 精确删除子条目

# 更新 / 删除
maestro wiki update <id> --title "New Title"         # 更新 frontmatter
maestro wiki delete <id>                             # 删除整个文件

# 图谱分析
maestro wiki health                                  # 健康评分（0-100）
maestro wiki orphans                                 # 孤立节点
maestro wiki hubs --limit 10                         # Top-N 枢纽节点
maestro wiki backlinks <id>                          # 谁引用了它
maestro wiki forward <id>                            # 它引用了谁
maestro wiki graph                                   # 完整图谱 JSON
```

| 子命令 | 用途 |
|--------|------|
| `list` / `ls` | 列表+过滤（type, tag, status, category, created-by, q） |
| `get` | 获取单条目（含 body） |
| `search` | BM25 全文搜索 |
| `create` | 创建 spec/memory/note 文件 |
| `append` | 向 spec 容器追加 `<spec-entry>` 条目 |
| `remove-entry` | 从 spec 容器中精确移除子条目 |
| `update` | 更新 frontmatter（spec body 受保护） |
| `delete` / `rm` | 删除整个条目文件 |
| `health` | 图谱健康评分 |
| `orphans` | 孤立节点列表 |
| `hubs` | 中心节点排名 |
| `backlinks` | 反向链接 |
| `forward` | 正向链接 |
| `graph` | 完整图谱 JSON |

> **写保护模型**：`specs/*.md` 的 body 通过 `wiki update` 禁止修改（返回 403），需使用 `wiki append` / `wiki remove-entry` 进行条目级操作。`memory/*.md` 支持完整 CRUD。虚拟条目（issue/lesson）完全只读。

---

### maestro hooks

Hook 管理与评估器运行。

```bash
maestro hooks install --level full     # 安装 Hook
maestro hooks status                   # 安装状态
maestro hooks list                     # 列出所有 Hook
maestro hooks toggle spec-injector on  # 开关 Hook
maestro hooks run spec-injector        # 运行评估器
```

可用 Hook: `context-monitor`, `spec-injector`, `delegate-monitor`, `team-monitor`, `telemetry`, `session-context`, `skill-context`, `coordinator-tracker`, `preflight-guard`, `spec-validator`, `keyword-spec-injector`, `workflow-guard`

---

### maestro overlay

命令 Overlay 管理 —— 非侵入式 `.claude/commands` 补丁。

```bash
maestro overlay list                    # 查看并管理
maestro overlay apply                   # 重新应用（幂等）
maestro overlay add my-overlay.json     # 安装
maestro overlay remove my-overlay       # 移除
maestro overlay bundle -o bundle.json   # 打包
maestro overlay import-bundle bundle.json  # 导入
maestro overlay push                    # 推送到团队共享
```

---

## 团队协作

### maestro collab

人类团队协作（别名: `team`）。

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

---

### maestro agent-msg

智能体团队消息总线（别名: `msg`）。

```bash
maestro msg send "task done" -s <session> --from worker --to coordinator
maestro msg list -s <session> --last 10
maestro msg status -s <session>
maestro msg broadcast "meeting" -s <session> --from coordinator
```

---

## 记忆与扩展

### maestro knowhow

知识复用管理（别名: `kh`）。6 种类型: session, tip, template, recipe, reference, decision。

```bash
maestro kh add --type template --title "React Hook Form" --body "..." --lang typescript
maestro kh add --type recipe --title "Deploy" --body "Steps: ..." --tags deploy
maestro kh add --type decision --title "Use PG" --body "ADR: ..." --status accepted
maestro kh list                           # 列出全部
maestro kh list --type template           # 按类型筛选
maestro kh search "deploy"               # 关键词搜索
maestro kh get knowhow-20260427-1912     # 查看详情
```

---

### maestro brainstorm-visualize

头脑风暴 HTML 原型可视化服务器（别名: `bv`）。

```bash
maestro bv start --dir ./prototypes     # 启动服务
maestro bv status <execId>              # 查看状态
maestro bv stop <execId>                # 停止服务
```

---

### maestro ext / maestro tool

扩展与工具管理。

```bash
maestro ext list                        # 列出扩展
maestro tool list                       # 列出工具
maestro tool exec read_file '{"path":"README.md"}'  # 执行工具
```
