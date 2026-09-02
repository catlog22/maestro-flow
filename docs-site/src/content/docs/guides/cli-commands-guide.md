---
title: "CLI 终端命令参考"
icon: "💻"
---

Maestro 提供 35+ 个终端命令，通过 `maestro <command>` 直接调用。覆盖安装、会话编排、委派、搜索、Wiki、Hook、协作、配置等全场景。

> **v0.5.56 重要变更**：Maestro 与 Ralph 合并为统一的 **Session/Run 链协议**。新增人类入口命令 `maestro session start`，`maestro run start` 降级为兼容别名；独立的 `maestro ralph` CLI 子命令族与顶层 `maestro next` 已退役，编排能力统一收敛到 `maestro session` / `maestro run`。

> **别名**: `coord`→`coordinate`、`msg`→`agent-msg`、`kh`→`knowhow`、`bv`→`brainstorm-visualize`、`team`→`collab`、`ws`→`workspace`、`cfg`→`config`、`dc`→`delegate-config`、`ch`→`command-help`。

---

## 命令总览

| 命令 | 别名 | 用途 |
|------|------|------|
| `install` | -- | 安装 Maestro 资源（交互式） |
| `uninstall` | -- | 卸载已安装资源 |
| `update` | -- | 检查/安装最新版本 |
| `plugin` | -- | 注册/移除 maestro 为 Claude Code / Codex 原生插件 |
| `session` | -- | **Session 编排（人类入口）**：建链、链步进、Run 管理、决策、可视化 |
| `run` | -- | Run 生命周期管理（brief/check/create/complete…），`run start` 为兼容别名 |
| `skills` | -- | 列出有效命令、Skill 与可解析的 Run 步骤 |
| `delegate` | -- | 委派任务给 AI 智能体 |
| `explore` | -- | 轻量并行代码搜索（API 端点驱动） |
| `moa` | -- | Mixture-of-Agents 多模型聚合探索 |
| `coordinate` | `coord` | 基于 session 的工作流协调器 |
| `cli` | -- | 运行 CLI 智能体工具 |
| `serve` | -- | 启动工作流服务器 |
| `launcher` | -- | Claude Code 启动器 |
| `search` | -- | 统一知识搜索（wiki + 代码，默认混合） |
| `load` | -- | 统一知识加载（specs / wiki / sessions） |
| `embedding` | -- | 向量模型状态、预热与重建（search 子命令族） |
| `spec` | -- | 项目 Spec 管理 |
| `wiki` | -- | Wiki 知识图谱查询 |
| `domain` | -- | 领域术语表（glossary）管理 |
| `workspace` | `ws` | 跨工作区知识共享（link/unlink/list/status） |
| `knowhow` | `kh` | 知识复用管理 |
| `issue` | -- | 轻量本地 Issue 生命周期管理 |
| `hooks` | -- | Hook 管理与运行 |
| `overlay` | -- | 命令 Overlay 管理 |
| `collab` | `team` | 人类团队协作 |
| `agent-msg` | `msg` | 智能体团队消息总线 |
| `brainstorm-visualize` | `bv` | 头脑风暴可视化服务器 |
| `config` | `cfg` | 统一配置中心（Skills/Delegate/Hooks/Overlay/Specs/Install） |
| `delegate-config` | `dc` | 委派工具注册配置 |
| `impeccable` | -- | Impeccable 设计工具实用程序 |
| `command-help` | `ch` | 在浏览器打开命令参考指南 |
| `ext` | -- | 扩展管理 |
| `tool` | -- | 工具交互（list/exec） |
| `timeline` | -- | 统一项目活动时间线（git commits + sessions） |
| `kg` | -- | UA 知识图谱查询 |

> **已退役命令**：`maestro ralph`（CLI 子命令族）、顶层 `maestro next`。其能力分别由 `maestro session`/`maestro run` 生命周期与 `/maestro-next` 路由 skill 承接。

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
<summary>maestro uninstall / update / plugin</summary>

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

**plugin** -- 将 maestro 注册为 Claude Code / Codex 的原生插件：

```bash
maestro plugin register        # 注册插件
maestro plugin remove          # 移除注册
maestro plugin status          # 查看注册状态
```

</details>

---

## Dashboard（已退役）

Dashboard UI 不再发布，`maestro view` 和 `maestro stop` 已从命令帮助中隐藏。为兼容旧脚本，这两个命令仍可解析旧参数，但只显示退役提示，不会启动或终止进程。

查看当前工作流状态请使用：

- `maestro run brief` — 查看当前 Run 的恢复信息
- `maestro run check` — 检查当前 Run 的门禁与完成指引
- `maestro session status` — 查看 canonical Session/Run 状态

---

## 会话编排（Session / Run）

v0.5.56 起，Maestro 与 Ralph 共享同一套 **canonical Session/Run 链协议**：

- **Session** 是 topic 分组与索引；`session.json.orchestration` 是 chain / goal / decision 的唯一真相源。
- **Run** 是一次执行尝试（attempt）；Run 的 outputs、handoff、gate、proposal 归该 Run。
- 编排层调用 `maestro session ...`（next/done/decide/seal/status/resolve/resume/chain insert·skip·replace/meta update），执行层调用 `maestro run ...`（brief/check/create/prepare）。
- 链推进由 **verdict 驱动**：执行步通过 `session done --verdict` 完成，决策步通过 `session decide --verdict` 完成。

<details>
<summary>maestro session start（人类入口）</summary>

创建 Session 并派发第一步（单步或命令链）。这是 v0.5.56 起的**推荐人类入口**，取代已废弃的 `maestro run start`。

```bash
# 命令链：创建简单链 Session，默认派发第一步
maestro session start "修复登录链路" --chain analyze plan execute review

# 新建 Session 并显式命名：用 --id（--session 不能用于新建）
maestro session start "理解认证流程" --chain learn --id learn-auth --arg "src/auth"

# 单步：在已存在的 Session 上追加一个 Run；--session 指向的 Session 必须已存在，否则报错
maestro session start "理解认证流程" --session 20260721-learn-auth --chain learn --arg "src/auth"

# 高级 JSON 链定义
maestro session start "重构认证" --chain-file chain.json

# 只建链不派发
maestro session start "重构认证" --chain analyze plan execute --no-dispatch
```

| 选项 | 说明 |
|------|------|
| `--chain <commands...>` | 简单命令链，如 `--chain companion` 或 `--chain analyze execute review` |
| `--chain-file <path>` | 高级链定义 JSON 文件；`-` 读取 stdin |
| `--id <slug>` | 为**新建**的 Session 显式指定 ID/slug（仅创建时有效） |
| `--session <id>` | 在**已存在**的 Session 上跑单个 Run（不建链；Session 不存在会报错，新建命名请用 `--id`） |
| `--topic <text>` | 命令无关的 Session topic；默认为 intent |
| `--arg <value>` | 命令输入，存入 Run input.args（可重复） |
| `--platform <name>` | 为该 Run 持久化目标平台 |
| `--no-dispatch` | 只创建 Session，不派发第一步 |
| `--engine <name>` | 编排引擎：`ralph` \| `coordinator` \| `manual` |
| `--quality <mode>` | 质量模式：`quick` \| `standard` \| `full` |
| `--auto` | 启用 auto 模式 |

> `maestro run start ...` 仍可用，但会打印废弃提示并等价转发到 `maestro session ...`，仅作向后兼容保留。

</details>

<details>
<summary>maestro session create / next / done / decide</summary>

机器与编排层使用的核心生命周期动词。

```bash
# 建链（不派发）——编排器/skill 的标准建链方式
maestro session create "修复登录链路" --id maestro-fix-login --chain-file chain.json

# 分配下一个 Run（唯一能分配 Run 的动词）；--inline-brief 在 birth packet 内联 Resume Packet
maestro session next --session <id> --inline-brief --json

# 完成执行步并推进链（verdict 驱动）
maestro session done <run-id> --session <id> --verdict done --summary "实现登录校验"
maestro session done <run-id> --session <id> --verdict done-with-concerns --note "后续补文档"
maestro session done <run-id> --session <id> --verdict needs-retry        # 重大 drift，未重试
maestro session done <run-id> --session <id> --verdict blocked --reason "外部依赖缺失"

# 决策步提交裁决（不创建 Run）
maestro session decide <point-id> --session <id> --verdict proceed --confidence high
maestro session decide <point-id> --session <id> --verdict fix --confidence medium --summary "review BLOCK"
```

| `done --verdict` | 语义 |
|------|------|
| `done` | aligned，正常完成 |
| `done-with-concerns` | 轻微 drift 或重试后仍有保留 |
| `needs-retry` | 重大 drift，尚未重试 |
| `blocked` | 外部 blocker，暂停等人工 |

| `decide --verdict` | 语义 |
|------|------|
| `proceed` | 通过，继续下一 Run / decision / seal |
| `fix` | 失败，需 repair Skill 产生 proposal 修复 pending tail |
| `escalate` | 升级，转入 audited recovery |

</details>

<details>
<summary>maestro session 查询与维护</summary>

```bash
maestro session list [--status running|paused|sealed|archived|failed]   # 列出 Session
maestro session show <session-id>          # 查看单个 Session 状态
maestro session status [session-id]        # canonical 状态（显式或最新兼容 Session）
maestro session check [session-id]         # 校验链、Run 绑定与决策引用
maestro session evidence [session-id]      # 查询 Evidence Registry（可 --kind/--status/--run/--point 过滤）
maestro session graph [session-id]         # 链可视化：steps、decisions、goals、position
maestro session seal <session-id> --summary "..."   # 所有 Run/gate 完成后封存
```

**链编辑**（仅作用于 pending step）：

```bash
maestro session chain insert --session <id> --after <step_id|index> --command review --stage review   # 在某步后插入
maestro session chain skip --session <id> --step <step-id>            # 跳过 pending 步
maestro session chain replace --session <id> --step <step-id> --command test   # 原地替换字段
maestro session meta update --session <id> --position-file pos.json --decomposition-file -   # 整块更新 position/decomposition
```

**恢复与迁移**：

```bash
maestro session resolve --session <id> --decision <point> --disposition proceed   # 解决单个 paused blocker
maestro session resume --session <id>                                             # 全部 blocker 清零后恢复
maestro session migrate [--session <id>]    # 将 legacy ralph-meta.json 折叠进 session.json，打 session/1.3 标记（幂等）
```

</details>

<details>
<summary>maestro run（执行层）</summary>

Run 是 Session 内的一次执行尝试。`run` 子命令多为机器/执行器使用；`run start` 为兼容别名。

```bash
maestro run start "理解认证流程" --chain learn --session <id>   # 已废弃 → 等价 session start
maestro run create <command> --session <id> --intent "<intent>" --json   # 在已有/新建 Session 中创建 Run
maestro run next --session <id> --json                          # 推进链：创建下一 Run 并输出 birth packet
maestro run brief <run-id> --session <id>                       # 返回 Resume Packet（回溯/崩溃恢复时用）
maestro run prepare <step>                                      # 返回 prepare 文件 + workflow 元数据（只读、无状态）
maestro run skill <step>                                        # 加载某步的 prepare + workflow 内容（无 Session）
maestro run check <run-id> --session <id>                       # 幂等扫描输出并评估 Run gate
maestro run done [run-id]                                       # check + complete 当前 Run（人类友好别名）
maestro run complete [run-id] --verdict done --summary "..."    # 封存 Run 并按 verdict 推进链
maestro run edit test review --after latest                     # 编辑未来 chain step（插入 pending 步）
maestro run accept-reuse <run-id> --assessment-hash <hash> ...  # 显式接受一条 exact REVIEW 评估并绑定产物
maestro run recall <command> --intent "<intent>"                # 只读 Session/topic 查找（历史相似度仅为证据）
maestro run seal-session <session-id>                           # 所有 Run 与 Session gate 完成后封存
maestro run log-mutation <target> / maestro run mutations       # 记录/列出 run 外文件变更
```

| 子命令 | 说明 |
|--------|------|
| `start` | **已废弃**：等价 `session start`，仅向后兼容 |
| `create` / `next` | 创建 Run / 推进链分配下一 Run |
| `brief` | 重新加载 Resume Packet（仅回溯场景；正常前向流程用 `session next --inline-brief`） |
| `prepare` / `skill` | 任务前思考的只读 prepare/workflow 内容 |
| `check` | 扫描输出、评估 gate、发现并校验 `chain-proposal/1.0` |
| `done` / `complete` | 完成当前 Run（`done` 为友好别名） |
| `edit` | 中途修改未来 chain step，不创建新 Session |
| `status` / `recover` | canonical 状态 / 解决 paused blocker 或恢复 |

</details>

<details>
<summary>maestro skills</summary>

列出当前生效的命令、Skill 与可被 `maestro run next` 解析的步骤。建链前用于 skill 名预校验。

```bash
maestro skills                          # 列出命令与 Skill
maestro skills --platform codex         # 按平台过滤：claude | codex | agent | agy | pi
maestro skills --steps                  # 包含 prepare/workflow 可解析步骤名
maestro skills --json                   # 机器可读（每行一条 JSON）
```

</details>

---

## 任务委派与搜索

<details>
<summary>maestro delegate</summary>

委派任务给 AI 智能体（gemini/qwen/codex/claude/opencode/agy/pi）。支持同步、异步、会话恢复。

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
<summary>maestro explore / moa</summary>

**explore** -- 轻量并行代码搜索（API 端点驱动）：

```bash
maestro explore "auth middleware"             # 单 prompt 搜索
maestro explore -p "auth" -p "session"        # 多 prompt 并行
```

**moa** -- Mixture-of-Agents 多模型聚合探索：多个 reference 端点并行分析，再由 aggregator 综合。

```bash
maestro moa "compare auth strategies"         # 多模型聚合
maestro moa list                              # 列出近期 MOA/explore 会话
```

</details>

<details>
<summary>maestro coordinate</summary>

基于 session 的工作流协调器，支持 step 模式和 auto 模式。

> **注意**：v0.5.50+ 已移除 chains 数据层（coordinate 图执行子系统退役）。coordinate 命令仍可用于基于 session 的工作流协调；完整链编排请使用 `maestro session`。

```bash
maestro coordinate list                                    # 列出可用工作流
maestro coordinate start "implement auth"                  # 步进模式
maestro coordinate next <sessionId>                        # 下一步
maestro coordinate status <sessionId>                      # 会话状态
```

| 选项 | 说明 |
|------|------|
| `--tool <tool>` | 智能体工具（默认 `claude`） |
| `-y` | 自动确认模式 |
| `--dry-run` | 预览执行计划 |
| `-c` | 恢复会话 |

</details>

<details>
<summary>maestro cli / serve</summary>

**cli** -- 统一 CLI 智能体工具接口：

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
```

选项同 `delegate`（`-p` 必填），另有 `show`、`output <id>`、`watch <id>` 子命令。

**serve** -- 启动工作流服务器：

```bash
maestro serve --port 3600 --host localhost
```

</details>

---

## 知识与搜索

<details>
<summary>maestro search / load</summary>

**search** -- 统一知识搜索（wiki + 代码，默认混合检索）：

```bash
maestro search "authentication flow"        # 混合搜索（wiki + code）
maestro search "login" --tag security       # 按 tag 过滤
maestro search-daemon start                 # 启动常驻搜索守护进程（预热 ONNX 模型）
maestro embedding status                    # 向量模型状态 / 预热 / 重建
```

**load** -- 统一知识加载（specs / wiki / sessions）：

```bash
maestro load --category coding --keyword auth   # 加载 spec
maestro load --wiki "auth"                       # 加载 wiki 条目
```

> `search` / `load` 统一了原 `maestro search` 与 `maestro load` 的 `--tag` / `--keyword` 参数语义（v0.5.5x）。

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
maestro wiki list --type spec --tag security --status active --json
maestro wiki list -q "authentication"                # BM25 内联搜索
maestro wiki search "auth token"                     # 全文搜索
maestro wiki get <id>                                # 获取单条

# 创建（spec / memory / note）
maestro wiki create --type spec --slug auth --title "Auth" --body "# Auth\n..."

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
<summary>maestro domain / workspace / knowhow</summary>

**domain** -- 领域术语表（glossary）管理：

```bash
maestro domain init                     # 初始化 .workflow/domain/glossary.yaml
maestro domain add "术语" "定义"         # 注册术语
maestro domain list                     # 列出术语
```

**workspace (ws)** -- 跨工作区知识共享：

```bash
maestro ws link ../other-project        # 链接另一个 Maestro 工作区
maestro ws unlink ../other-project
maestro ws list                         # 列出链接
maestro ws status                       # 共享状态
```

**knowhow (kh)** -- 知识复用管理。9 种兼容类型: session, tip, template, recipe, reference, decision, asset, blueprint, document。普通 Knowhow 只要求 type/title/content；普通 Spec 只要求 category/title/content。Audit 只读；迁移先 `knowledge normalize --report <path>`，审阅后才 `--apply`。CLI `--repo` 选择物理目标，repeatable `--applies-to-repo` 只记录适用范围。host/MCP `targetRepoId` 不是 CLI flag：当前仓库写省略它，仅显式 linked target 且 host 提供 exact UUID + live capability 时传，绝不从 cwd/name/alias/path 推导。

```bash
maestro kh add --type template --title "React Hook Form" --content "..." --language typescript
maestro kh add --type recipe --title "Deploy" --content "Steps: ..." --keywords deploy
maestro kh add --type decision --title "Use PG" --content "ADR: ..." --decision-state accepted
maestro kh list                           # 列出全部
maestro kh list --type template           # 按类型筛选
maestro kh search "deploy"               # 关键词搜索
maestro kh get knowhow-20260427-1912     # 查看详情
```

</details>

<details>
<summary>maestro issue</summary>

轻量本地 Issue 生命周期管理：

```bash
maestro issue create --title "登录失败" --body "..."   # 创建 issue
maestro issue list [--status open]                     # 列出 issue
```

> 完整 Issue 闭环（discover → analyze → plan → execute → close）由 `/maestro` 的 issue 链驱动。

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
<summary>maestro hooks</summary>

Hook 管理与评估器运行。支持 Claude Code、Codex 和 Agy 三平台。

```bash
# Claude Code
maestro hooks install --level full
maestro hooks uninstall

# Codex
maestro hooks install --target codex --level standard
maestro hooks uninstall --target codex

# Agy (Antigravity)
maestro hooks install --target agy --level standard

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

<details>
<summary>maestro timeline</summary>

统一项目活动时间线 -- 聚合 git commits 与 sessions：

```bash
maestro timeline                    # 查看时间线
maestro timeline --limit 50         # 限制条数
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

## 配置与扩展

<details>
<summary>maestro config (cfg)</summary>

统一配置中心，整合 Skills、Delegate、Hooks、Overlay、Specs、Install 配置：

```bash
maestro config skill            # Skill 参数默认值（TUI）
maestro config delegate         # 委派工具配置
maestro config hooks            # Hook 配置
maestro config overlay          # Overlay 配置
```

**delegate-config (dc)** -- 委派工具注册配置（`maestro dc`）。

</details>

<details>
<summary>maestro impeccable / ext / tool / command-help</summary>

**impeccable** -- Impeccable 设计工具实用程序：

```bash
maestro impeccable context      # 加载 PRODUCT.md 与 DESIGN.md 上下文
```

**ext** -- 扩展管理：

```bash
maestro ext list                # 列出扩展
```

**tool** -- 工具交互：

```bash
maestro tool list                       # 列出工具
maestro tool exec read_file '{"path":"README.md"}'
```

**command-help (ch)** -- 在浏览器打开 Maestro 命令参考指南：

```bash
maestro command-help
```

</details>

<details>
<summary>maestro brainstorm-visualize (bv)</summary>

头脑风暴 HTML 原型可视化服务器：

```bash
maestro bv start --dir ./prototypes     # 启动服务
maestro bv status <execId>              # 查看状态
maestro bv stop <execId>                # 停止服务
```

</details>

---

## 知识图谱

<details>
<summary>maestro kg</summary>

UA 知识图谱 CLI -- 查询 `.workflow/codebase/knowledge-graph.json` 中的代码结构语义信息。

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

---

## 相关指南

- [全部命令与工作流](./command-usage-guide.md) — slash 命令与工作流衔接
- [Ralph v2 引擎与协调器](./maestro-ralph-guide.md) — Session/Run 闭环策略
- [产物目录结构](./workflow-structure-guide.md) — `.workflow/` 布局与 session.json Schema
