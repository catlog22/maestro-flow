---
title: "CLI 终端命令参考"
---

Maestro 提供 35+ 个终端命令，通过 `maestro <command>` 直接调用。覆盖安装、委派、协调、知识管理、搜索、Hook、协作等全场景。

> **别名**: `coord`->`coordinate`、`msg`->`agent-msg`、`kh`->`knowhow`、`bv`->`brainstorm-visualize`、`team`->`collab`、`ch`->`command-help`、`cfg`->`config`、`dc`->`delegate-config`、`ws`->`workspace`。

---

## 命令总览

| 命令 | 别名 | 用途 |
|------|------|------|
| `install` | -- | 安装 Maestro 资源（交互式） |
| `uninstall` | -- | 卸载已安装资源 |
| `update` | -- | 检查/安装最新版本 |
| `view` | -- | ~~启动 Dashboard 看板~~ (已废弃) |
| `stop` | -- | ~~停止 Dashboard 服务~~ (已废弃) |
| `delegate` | -- | 委派任务给 AI 智能体 |
| `explore` | -- | 轻量并行代码搜索（API 端点驱动） |
| `load` | -- | 统一知识加载（spec/knowhow/session/domain 等） |
| `search` | -- | 统一知识搜索（wiki + code 混合） |
| `search-daemon` | -- | 搜索守护进程管理（start/stop/status） |
| `embedding` | -- | 嵌入模型管理（status/warmup/rebuild） |
| `coordinate` | `coord` | 图工作流协调器 |
| `cli` | -- | 运行 CLI 智能体工具 |
| `run` | -- | 执行指定工作流 |
| `serve` | -- | 启动工作流服务器 |
| `launcher` | -- | Claude Code 启动器 |
| `spec` | -- | 项目 Spec 管理 |
| `wiki` | -- | Wiki 知识图谱查询 |
| `kg` | -- | 代码知识图谱查询 |
| `domain` | -- | 领域知识术语管理 |
| `workspace` | `ws` | 跨工作区知识共享 |
| `hooks` | -- | Hook 管理与运行 |
| `overlay` | -- | 命令 Overlay 管理 |
| `collab` | `team` | 人类团队协作 |
| `agent-msg` | `msg` | 智能体团队消息总线 |
| `knowhow` | `kh` | 知识复用管理 |
| `brainstorm-visualize` | `bv` | 头脑风暴可视化服务器 |
| `ext` | -- | 扩展管理 |
| `tool` | -- | 工具交互（list/exec） |
| `config` | `cfg` | 配置管理 |
| `delegate-config` | `dc` | 委派配置管理 |
| `impeccable` | -- | 完美执行模式 |
| `command-help` | `ch` | 命令帮助查询 |
| `ralph` | -- | Ralph CLI 子命令族 |

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

## Dashboard (已废弃)

> **⚠️ 废弃通知**: Dashboard 前端已在 v0.5.36 移除。`maestro view` 和 `maestro stop` 命令仅保留为向后兼容占位符，调用时会显示废弃警告并退出。
>
> 如需查看工作流状态，请使用：
> - `maestro collab status` — 查看团队协作状态
> - `maestro delegate status <id>` — 查看委派任务状态
> - `maestro ralph status` — 查看 Ralph 会话状态

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

---

## 知识管理

<details>
<summary>maestro load</summary>

统一知识加载命令 — 替代旧版 `spec load`/`wiki load`/`session load`，支持 9 种类型。

```bash
maestro load --type spec --category coding           # 加载 coding 类 spec
maestro load --type knowhow --list                   # 列出 knowhow 条目
maestro load --type session --id WFS-20260624-abc    # 加载特定 session
maestro load --type domain --keyword auth            # 按关键词过滤 domain
maestro load --type spec --list --json               # JSON 格式输出
```

| 选项 | 说明 |
|------|------|
| `--type <type>` | **必填**。条目类型：`spec`, `knowhow`, `note`, `domain`, `issue`, `project`, `roadmap`, `session`, `scratch` |
| `--id <ids>` | 按 ID 加载（逗号分隔） |
| `--category <cat>` | 按类别过滤（如 coding, arch, debug, test, review, learning） |
| `--keyword <word>` | 按关键词搜索标题/正文 |
| `--list` | 列出匹配条目（紧凑模式，不含正文） |
| `--scope <scope>` | Spec 作用域：`project`/`global`/`team`/`personal`（默认 project） |
| `--limit <n>` | 最大条目数（默认：list=20, load=10） |
| `--json` | JSON 格式输出 |

> **与旧版命令的关系**: `maestro load --type spec` 等效于 `maestro spec load`，`maestro load --type knowhow` 等效于 `maestro wiki list --type knowhow`。推荐使用统一命令。

</details>

<details>
<summary>maestro search</summary>

统一知识搜索 — BM25F 排名，支持 wiki + code 混合搜索。

```bash
maestro search "user authentication"              # 混合搜索（wiki + code）
maestro search "auth" --type spec                 # 仅搜索 spec 类型
maestro search "login" --code                     # 仅代码图搜索
maestro search "api" --wiki-only                  # 仅 wiki 搜索
maestro search "domain term" --kg                 # KG 全源统一搜索
maestro search "hook" --category coding --limit 5 # 按类别过滤，限制 5 条
```

| 选项 | 说明 |
|------|------|
| `--type <type>` | 按类型过滤：`project`, `roadmap`, `spec`, `issue`, `knowhow`, `note`, `domain`, `session`, `scratch` |
| `--category <cat>` | 按类别过滤（如 coding, arch, debug, test, review, learning） |
| `--code` | 仅代码图结果（无 wiki） |
| `--kg` | KG 统一搜索（MaestroGraph 全源：codegraph + domain + spec + knowhow） |
| `--wiki-only` | 仅 wiki 结果（无代码搜索） |
| `--workspace <name>` | 过滤到特定链接工作区 |
| `--no-emb` | 跳过嵌入，仅用 BM25 |
| `--limit <n>` | 最大结果数（默认 20） |
| `--json` | JSON 格式输出 |

**搜索模式**:
- **默认**: wiki + code 混合，按归一化分数交错排列
- `--code`: 仅 CodeGraph 结果
- `--wiki-only`: 仅 wiki 结果
- `--kg`: MaestroGraph 全源统一搜索（代码符号 + 领域术语 + spec 规则 + knowhow 文档）

**评分**: Wiki 使用 BM25F + 类型加权（spec > knowhow > note）；Code 使用 BM25 + kind 加权 + 名称匹配奖励。Per-source caps: session ≤3, scratch ≤3。

</details>

<details>
<summary>maestro search-daemon</summary>

管理搜索守护进程 — 保持 ONNX 模型热缓存，避免冷启动惩罚。

```bash
maestro search-daemon start     # 启动守护进程
maestro search-daemon stop      # 停止守护进程
maestro search-daemon status    # 查看状态
```

| 操作 | 说明 |
|------|------|
| `start` | 启动守护进程（如果已运行则跳过） |
| `stop` | 停止守护进程 |
| `status` | 显示状态（pid、port、startedAt） |

> 守护进程空闲 30 分钟后自动退出。首次搜索会自动启动守护进程。

</details>

<details>
<summary>maestro embedding</summary>

嵌入模型管理 — 状态查看、预热、重建索引。

```bash
maestro embedding status    # 查看模型和索引状态
maestro embedding warmup    # 预热模型（首次使用前）
maestro embedding rebuild   # 重建嵌入索引
```

| 操作 | 说明 |
|------|------|
| `status` | 显示 Transformers 可用性、设备信息、索引状态（文档数、维度、模型） |
| `warmup` | 预热模型（加载到内存，减少首次搜索延迟） |
| `rebuild` | 重建嵌入索引（所有文档重新编码） |

> 嵌入默认启用（v0.5.37+），可通过 `--no-emb` 标志跳过。

</details>

<details>
<summary>maestro domain</summary>

领域知识术语管理 — 项目术语表的增删改查。

```bash
maestro domain init --project myapp              # 初始化术语表
maestro domain add "API Gateway" "统一入口服务"   # 添加术语
maestro domain list                              # 列出所有术语
maestro domain show api-gateway                  # 查看术语详情
maestro domain search "auth"                     # 搜索术语
maestro domain discover                          # 自动发现术语
maestro domain validate                          # 验证术语表
```

| 子命令 | 说明 |
|--------|------|
| `init` | 初始化 `.workflow/domain/` 和 `glossary.yaml` |
| `add <term> <def>` | 添加术语（`--aliases`, `--keywords`, `--tier`） |
| `list` | 列出所有术语 |
| `show <id>` | 查看术语详情 |
| `update <id>` | 更新术语 |
| `remove <id>` | 删除术语 |
| `search <query>` | 搜索术语 |
| `discover` | 自动发现代码库中的领域术语 |
| `import` | 导入外部术语表 |
| `deprecate <id>` | 标记术语为废弃 |
| `validate` | 验证术语表完整性 |

</details>

<details>
<summary>maestro workspace</summary>

跨工作区知识共享管理 — 链接其他 Maestro 项目的知识。

```bash
maestro workspace link ../other-project --share spec,knowhow   # 链接工作区
maestro workspace unlink other-project                          # 取消链接
maestro workspace list                                          # 列出链接
maestro workspace status                                        # 查看状态
```

| 子命令 | 说明 |
|--------|------|
| `link <path>` | 链接工作区（`--name`, `--share spec,knowhow,domain`） |
| `unlink <name>` | 取消链接 |
| `list` | 列出所有链接（`--json`） |
| `status` | 查看链接状态和共享类型 |

> 链接的工作区知识会自动集成到 `search` 和 `load` 命令的结果中。

</details>

---

## 工作流执行

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

> **写保护**：`specs/*.md` 的 body 通过 `wiki update` 禁止修改（403），需使用 `wiki append` / `wiki remove-entry`。`memory/*.md` 支持 CRUD。虚拟条目（issue、codebase、KG）完全只读。
>
> **KG 集成**：当 `.workflow/codebase/knowledge-graph.json` 存在时，KG 节点、架构层、代码导览自动作为虚拟条目索引到 wiki，可通过 `wiki search`、`wiki list --keyword kg` 发现。

</details>

<details>
<summary>maestro kg</summary>

代码知识图谱查询。操作 `.workflow/codebase/knowledge-graph.json`（由 `/manage-codebase-rebuild` 的 KG 管道生成）。

```bash
# 统计
maestro kg stats                         # 节点/边/层/导览统计
maestro kg stats --json                  # JSON 输出

# 搜索
maestro kg query "认证"                   # 按名称/摘要/标签搜索节点
maestro kg query "auth" --limit 5 --type module --json

# 节点详情（含 Wiki 双向绑定）
maestro kg explain <node-id>             # 节点详情 + 出入边 + 关联 wiki 条目
maestro kg explain <node-id> --json      # JSON 输出（含 wiki 匹配）
maestro kg explain <node-id> --no-wiki   # 跳过 wiki 交叉引用

# 路径查找
maestro kg path <from-id> <to-id>        # BFS 最短路径
maestro kg path <from-id> <to-id> --json

# 变更影响分析
maestro kg diff                          # git diff 影响的 KG 节点 + 1-hop 扩展
maestro kg diff --staged                 # 仅暂存区变更

# 变更影响 × Wiki 交叉引用
maestro kg diff-wiki                     # git 变更 → KG 影响 → 受影响 wiki 条目
maestro kg diff-wiki --staged --json     # JSON 输出
```

> **Wiki 集成**：`explain` 自动查询 WikiIndexer，显示与 KG 节点关联的 wiki 条目（通过 virtualKind 匹配和 codePaths/filePath 匹配）。`diff-wiki` 将代码变更的影响面传导到 wiki 层面。

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

---

## 智能路由

<details>
<summary>maestro ralph</summary>

Ralph CLI 子命令族 — 管理 Ralph 自适应生命周期引擎的 session、skill 和执行。

```bash
maestro ralph session              # 列出活跃 ralph session
maestro ralph skills               # 列出可用 skill
maestro ralph skills --platform codex  # 按平台过滤
maestro ralph next                 # 加载下一步（注入 skill defaults）
maestro ralph check                # 检查当前 step 状态
maestro ralph complete N --status DONE  # 标记 step 完成
```

| 子命令 | 说明 |
|--------|------|
| `session` | 列出活跃 session 及状态 |
| `skills` | 扫描可用 skill（支持 `--platform` 过滤） |
| `next` | 加载下一步 SKILL.md 并注入 config defaults |
| `check` | 查询当前 step 执行状态 |
| `complete` | 标记 step 完成并写入 emit 结果 |

</details>

---

## 知识图谱

<details>
<summary>maestro kg</summary>

代码知识图谱 CLI — 查询 `.workflow/codebase/knowledge-graph.json` 中的代码结构语义信息。

```bash
maestro kg stats                    # 图谱统计（节点数、边数、模块分布）
maestro kg query "UserService"      # 按名称/类型搜索节点
maestro kg explain "validateToken"  # 节点详情（依赖、调用者、模块）
maestro kg path "loginController" "db.query"  # 调用路径
maestro kg diff                     # 对比图谱快照差异
```

| 子命令 | 说明 |
|--------|------|
| `stats` | 图谱统计信息 |
| `query <pattern>` | 按名称/类型搜索节点 |
| `explain <node>` | 节点详情 |
| `path <from> <to>` | 两节点间调用路径 |
| `diff` | 图谱快照差异 |

</details>
