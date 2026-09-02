---
title: "CLI Terminal Commands Reference"
icon: "💻"
---

Maestro provides 35+ terminal commands, invoked directly via `maestro <command>`. It covers the full range of scenarios: installation, Session orchestration, delegation, search, Wiki, Hooks, collaboration, configuration, and more.

> **Important change in v0.5.56**: Maestro and Ralph have merged into a unified **Session/Run chain protocol**. A new human entry command `maestro session start` has been added, and `maestro run start` has been demoted to a compatibility alias; the standalone `maestro ralph` CLI subcommand family and the top-level `maestro next` have been retired, with orchestration capabilities unified and consolidated into `maestro session` / `maestro run`.

> **Aliases**: `coord`→`coordinate`, `msg`→`agent-msg`, `kh`→`knowhow`, `bv`→`brainstorm-visualize`, `team`→`collab`, `ws`→`workspace`, `cfg`→`config`, `dc`→`delegate-config`, `ch`→`command-help`.

---

## Command Overview

| Command | Alias | Purpose |
|------|------|------|
| `install` | -- | Install Maestro assets (interactive) |
| `uninstall` | -- | Remove installed assets |
| `update` | -- | Check/install the latest version |
| `plugin` | -- | Register/remove maestro as a native plugin for Claude Code / Codex |
| `session` | -- | **Session orchestration (human entry)**: chain creation, chain stepping, Run management, decisions, visualization |
| `run` | -- | Run lifecycle management (brief/check/create/complete…); `run start` is a compatibility alias |
| `skills` | -- | List active commands, Skills, and resolvable Run steps |
| `delegate` | -- | Delegate tasks to an AI agent |
| `explore` | -- | Lightweight parallel code search (API-endpoint-driven) |
| `moa` | -- | Mixture-of-Agents multi-model aggregated exploration |
| `coordinate` | `coord` | Session-based workflow coordinator |
| `cli` | -- | Run CLI agent tools |
| `serve` | -- | Start the workflow server |
| `launcher` | -- | Claude Code launcher |
| `search` | -- | Unified knowledge search (wiki + code, hybrid by default) |
| `load` | -- | Unified knowledge loading (specs / wiki / sessions) |
| `embedding` | -- | Vector model status, warmup, and rebuild (search subcommand family) |
| `spec` | -- | Project Spec management |
| `wiki` | -- | Wiki knowledge graph queries |
| `domain` | -- | Domain glossary management |
| `workspace` | `ws` | Cross-workspace knowledge sharing (link/unlink/list/status) |
| `knowhow` | `kh` | Knowledge reuse management |
| `issue` | -- | Lightweight local Issue lifecycle management |
| `hooks` | -- | Hook management and execution |
| `overlay` | -- | Command Overlay management |
| `collab` | `team` | Human team collaboration |
| `agent-msg` | `msg` | Agent team message bus |
| `brainstorm-visualize` | `bv` | Brainstorm visualization server |
| `config` | `cfg` | Unified configuration center (Skills/Delegate/Hooks/Overlay/Specs/Install) |
| `delegate-config` | `dc` | Delegate tool registration configuration |
| `impeccable` | -- | Impeccable design tool utilities |
| `command-help` | `ch` | Open the command reference guide in the browser |
| `ext` | -- | Extension management |
| `tool` | -- | Tool interaction (list/exec) |
| `timeline` | -- | Unified project activity timeline (git commits + sessions) |
| `kg` | -- | UA knowledge graph queries |

> **Retired commands**: `maestro ralph` (CLI subcommand family) and the top-level `maestro next`. Their capabilities are now carried by the `maestro session`/`maestro run` lifecycle and the `/maestro-next` routing skill, respectively.

---

## Installation & Update

<details>
<summary>maestro install</summary>

Install Maestro assets to a project or global directory. Interactive step selection.

```bash
maestro install                           # 交互式安装
maestro install --force                   # 非交互批量安装
maestro install components                # 安装文件组件
maestro install hooks                     # 安装 Hook
maestro install mcp                       # 注册 MCP 服务器
```

| Option | Description |
|------|------|
| `--force` | Non-interactive batch install of all components |
| `--global` | Install global assets only |
| `--path <dir>` | Install to the specified project directory |
| `--hooks <level>` | Hook level: none / minimal / standard / full |
| `--codex-hooks <level>` | Codex Hook level |
| `--codex-mcp` | Register the Codex MCP server |

> Interactive mode adds Codex Hooks and Codex MCP configuration steps.

</details>

<details>
<summary>maestro uninstall / update / plugin</summary>

**uninstall** -- Remove installed assets:

```bash
maestro uninstall              # 交互式卸载
maestro uninstall --all -y     # 卸载所有，跳过确认
```

**update** -- Check for and install the latest version:

```bash
maestro update                 # 检查并提示安装
maestro update --check         # 仅检查
```

**plugin** -- Register maestro as a native plugin for Claude Code / Codex:

```bash
maestro plugin register        # 注册插件
maestro plugin remove          # 移除注册
maestro plugin status          # 查看注册状态
```

</details>

---

## Dashboard (Retired)

The Dashboard UI is no longer published, and `maestro view` and `maestro stop` are hidden from command help. For compatibility with existing scripts, both commands still accept their legacy options, but only print a retirement notice and never start or terminate a process.

Use these commands to inspect the current workflow:

- `maestro run brief` — show the current Run resume packet
- `maestro run check` — evaluate the current Run gates and completion guidance
- `maestro session status` — show canonical Session/Run status

---

## Session Orchestration (Session / Run)

Since v0.5.56, Maestro and Ralph share the same **canonical Session/Run chain protocol**:

- A **Session** is the topic grouping and index; `session.json.orchestration` is the single source of truth for the chain / goal / decision.
- A **Run** is a single execution attempt; a Run's outputs, handoff, gate, and proposal belong to that Run.
- The orchestration layer invokes `maestro session ...` (next/done/decide/seal/status/resolve/resume/chain insert·skip·replace/meta update), and the execution layer invokes `maestro run ...` (brief/check/create/prepare).
- Chain advancement is **verdict-driven**: an execution step completes via `session done --verdict`, and a decision step completes via `session decide --verdict`.

<details>
<summary>maestro session start (human entry)</summary>

Create a Session and dispatch the first step (a single step or a command chain). This is the **recommended human entry point** since v0.5.56, replacing the deprecated `maestro run start`.

```bash
# Command chain: create a simple chain Session; dispatches the first step by default
maestro session start "fix login flow" --chain analyze plan execute review

# Create a new Session with an explicit name: use --id (--session cannot create)
maestro session start "understand auth flow" --chain learn --id learn-auth --arg "src/auth"

# Single step: append one Run to an EXISTING Session; --session errors if the Session does not exist
maestro session start "understand auth flow" --session 20260721-learn-auth --chain learn --arg "src/auth"

# Advanced JSON chain definition
maestro session start "refactor auth" --chain-file chain.json

# Create the chain without dispatching
maestro session start "refactor auth" --chain analyze plan execute --no-dispatch
```

| Option | Description |
|------|------|
| `--chain <commands...>` | Simple command chain, e.g. `--chain companion` or `--chain analyze execute review` |
| `--chain-file <path>` | Advanced chain definition JSON file; `-` reads from stdin |
| `--id <slug>` | Explicit ID/slug for a **newly created** Session (only applies when creating) |
| `--session <id>` | Run a single Run on an **existing** Session (no chain created; errors if the Session does not exist — use `--id` to name a new one) |
| `--topic <text>` | Command-agnostic Session topic; defaults to the intent |
| `--arg <value>` | Command input, stored in Run input.args (repeatable) |
| `--platform <name>` | Persist the target platform for this Run |
| `--no-dispatch` | Create the Session only, without dispatching the first step |
| `--engine <name>` | Orchestration engine: `ralph` \| `coordinator` \| `manual` |
| `--quality <mode>` | Quality mode: `quick` \| `standard` \| `full` |
| `--auto` | Enable auto mode |

> `maestro run start ...` still works, but it prints a deprecation notice and forwards equivalently to `maestro session ...`; it is retained only for backward compatibility.

</details>

<details>
<summary>maestro session create / next / done / decide</summary>

Core lifecycle verbs used by the machine and orchestration layers.

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

| `done --verdict` | Meaning |
|------|------|
| `done` | aligned, completed normally |
| `done-with-concerns` | Minor drift, or still has reservations after a retry |
| `needs-retry` | Major drift, not yet retried |
| `blocked` | External blocker; paused awaiting human intervention |

| `decide --verdict` | Meaning |
|------|------|
| `proceed` | Passed; continue to the next Run / decision / seal |
| `fix` | Failed; a repair Skill must produce a proposal to fix the pending tail |
| `escalate` | Escalated; transition to audited recovery |

</details>

<details>
<summary>maestro session query & maintenance</summary>

```bash
maestro session list [--status running|paused|sealed|archived|failed]   # 列出 Session
maestro session show <session-id>          # 查看单个 Session 状态
maestro session status [session-id]        # canonical 状态（显式或最新兼容 Session）
maestro session check [session-id]         # 校验链、Run 绑定与决策引用
maestro session evidence [session-id]      # 查询 Evidence Registry（可 --kind/--status/--run/--point 过滤）
maestro session graph [session-id]         # 链可视化：steps、decisions、goals、position
maestro session seal <session-id> --summary "..."   # 所有 Run/gate 完成后封存
```

**Chain editing** (applies only to pending steps):

```bash
maestro session chain insert --session <id> --after <step_id|index> --command review --stage review   # insert after a step
maestro session chain skip --session <id> --step <step-id>            # skip a pending step
maestro session chain replace --session <id> --step <step-id> --command test   # replace fields in place
maestro session meta update --session <id> --position-file pos.json --decomposition-file -   # integral-replace position/decomposition
```

**Recovery and migration**:

```bash
maestro session resolve --session <id> --decision <point> --disposition proceed   # 解决单个 paused blocker
maestro session resume --session <id>                                             # 全部 blocker 清零后恢复
maestro session migrate [--session <id>]    # 将 legacy ralph-meta.json 折叠进 session.json，打 session/1.3 标记（幂等）
```

</details>

<details>
<summary>maestro run (execution layer)</summary>

A Run is a single execution attempt within a Session. The `run` subcommands are mostly used by machines/executors; `run start` is a compatibility alias.

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

| Subcommand | Description |
|--------|------|
| `start` | **Deprecated**: equivalent to `session start`, retained only for backward compatibility |
| `create` / `next` | Create a Run / advance the chain to assign the next Run |
| `brief` | Reload the Resume Packet (backtracking scenarios only; use `session next --inline-brief` for the normal forward flow) |
| `prepare` / `skill` | Read-only prepare/workflow content for pre-task thinking |
| `check` | Scan outputs, evaluate the gate, and discover and validate `chain-proposal/1.0` |
| `done` / `complete` | Complete the current Run (`done` is a friendly alias) |
| `edit` | Modify future chain steps mid-flight without creating a new Session |
| `status` / `recover` | canonical status / resolve a paused blocker or recover |

</details>

<details>
<summary>maestro skills</summary>

List the currently active commands, Skills, and steps that can be resolved by `maestro run next`. Used for pre-validating skill names before creating a chain.

```bash
maestro skills                          # 列出命令与 Skill
maestro skills --platform codex         # 按平台过滤：claude | codex | agent | agy | pi
maestro skills --steps                  # 包含 prepare/workflow 可解析步骤名
maestro skills --json                   # 机器可读（每行一条 JSON）
```

</details>

---

## Task Delegation & Search

<details>
<summary>maestro delegate</summary>

Delegate tasks to AI agents (gemini/qwen/codex/claude/opencode/agy/pi). Supports sync, async, and session resume.

```bash
maestro delegate "analyze auth module" --to gemini
maestro delegate "fix bug" --to gemini --async
maestro delegate show
maestro delegate output gem-143022-a7f2
maestro delegate status gem-143022-a7f2
maestro delegate message gem-143022-a7f2 "also check utils"
maestro delegate "continue" --to gemini --resume
```

| Option | Default | Description |
|------|--------|------|
| `--to <tool>` | First enabled tool | Target tool |
| `--mode <mode>` | `analysis` | analysis (read-only) / write |
| `--model <model>` | Tool default | Model override |
| `--cd <dir>` | CWD | Working directory |
| `--rule <template>` | -- | Protocol + template loading |
| `--id <id>` | Auto-generated | Execution ID |
| `--resume [id]` | -- | Resume session |
| `--async` | -- | Run asynchronously in the background |
| `--backend <type>` | `direct` | Adapter backend: direct / terminal |

**Subcommands**: `show [--all]`, `output <id>`, `status <id>`, `tail <id>`, `cancel <id>`, `message <id> <text>`, `messages <id>`

</details>

<details>
<summary>maestro explore / moa</summary>

**explore** -- Lightweight parallel code search (API-endpoint-driven):

```bash
maestro explore "auth middleware"             # 单 prompt 搜索
maestro explore -p "auth" -p "session"        # 多 prompt 并行
```

**moa** -- Mixture-of-Agents multi-model aggregated exploration: multiple reference endpoints analyze in parallel, then an aggregator synthesizes the results.

```bash
maestro moa "compare auth strategies"         # 多模型聚合
maestro moa list                              # 列出近期 MOA/explore 会话
```

</details>

<details>
<summary>maestro coordinate</summary>

A Session-based workflow coordinator, supporting step mode and auto mode.

> **Note**: v0.5.50+ removed the chains data layer (the coordinate graph execution subsystem has been retired). The coordinate command is still available for Session-based workflow coordination; for full chain orchestration, use `maestro session`.

```bash
maestro coordinate list                                    # 列出可用工作流
maestro coordinate start "implement auth"                  # 步进模式
maestro coordinate next <sessionId>                        # 下一步
maestro coordinate status <sessionId>                      # 会话状态
```

| Option | Description |
|------|------|
| `--tool <tool>` | Agent tool (default `claude`) |
| `-y` | Auto-confirm mode |
| `--dry-run` | Preview the execution plan |
| `-c` | Resume session |

</details>

<details>
<summary>maestro cli / serve</summary>

**cli** -- Unified CLI agent tool interface:

```bash
maestro cli -p "analyze code" --tool gemini --mode analysis
maestro cli -p "fix bug" --tool gemini --mode write
```

Options are the same as `delegate` (`-p` required), with additional `show`, `output <id>`, and `watch <id>` subcommands.

**serve** -- Start the workflow server:

```bash
maestro serve --port 3600 --host localhost
```

</details>

---

## Knowledge & Search

<details>
<summary>maestro search / load</summary>

**search** -- Unified knowledge search (wiki + code, hybrid retrieval by default):

```bash
maestro search "authentication flow"        # 混合搜索（wiki + code）
maestro search "login" --tag security       # 按 tag 过滤
maestro search-daemon start                 # 启动常驻搜索守护进程（预热 ONNX 模型）
maestro embedding status                    # 向量模型状态 / 预热 / 重建
```

**load** -- Unified knowledge loading (specs / wiki / sessions):

```bash
maestro load --category coding --keyword auth   # 加载 spec
maestro load --wiki "auth"                       # 加载 wiki 条目
```

> `search` / `load` unify the `--tag` / `--keyword` parameter semantics of the former `maestro search` and `maestro load` (v0.5.5x).

</details>

<details>
<summary>maestro spec</summary>

Project Spec management (init, load, list, status).

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

Wiki knowledge graph queries and mutations. Offline by default; `--live` uses the HTTP API.

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

> **Write protection**: modifying the body of `specs/*.md` via `wiki update` is forbidden (403); use `wiki append` / `wiki remove-entry` instead. `memory/*.md` supports CRUD. Virtual entries are fully read-only.

</details>

<details>
<summary>maestro domain / workspace / knowhow</summary>

**domain** -- Domain glossary management:

```bash
maestro domain init                     # 初始化 .workflow/domain/glossary.yaml
maestro domain add "术语" "定义"         # 注册术语
maestro domain list                     # 列出术语
```

**workspace (ws)** -- Cross-workspace knowledge sharing:

```bash
maestro ws link ../other-project        # 链接另一个 Maestro 工作区
maestro ws unlink ../other-project
maestro ws list                         # 列出链接
maestro ws status                       # 共享状态
```

**knowhow (kh)** -- Knowledge reuse management with nine compatible types: session, tip, template, recipe, reference, decision, asset, blueprint, and document.

Nine compatible types are session, tip, template, recipe, reference, decision, asset, blueprint, and document; ordinary creation requires only type/title/content. CLI `--repo` selects the physical target and repeatable `--applies-to-repo` only records applicability. Host/MCP `targetRepoId` is an exact host-supplied UUID for an authorized linked write, not a CLI flag; omit it for current-repository writes and never infer it from cwd/name/alias/path.

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

Lightweight local Issue lifecycle management:

```bash
maestro issue create --title "登录失败" --body "..."   # 创建 issue
maestro issue list [--status open]                     # 列出 issue
```

> The full Issue closed-loop (discover → analyze → plan → execute → close) is driven by the `/maestro` issue chain.

</details>

---

## Project Management

<details>
<summary>maestro launcher</summary>

Unified Claude Code launcher, managing workflow profile and settings switching.

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

Hook management and evaluator execution. Supports three platforms: Claude Code, Codex, and Agy.

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

| Option | Description |
|------|------|
| `--target` | `claude` (default) or `codex` |
| `--level` | minimal / standard / full |
| `--global` | Install to global (default) |
| `--project` | Install to project-level |

> Codex hooks require `codex_hooks = true` enabled in `~/.codex/config.toml`. Not currently supported on Windows.

</details>

<details>
<summary>maestro overlay</summary>

Command Overlay management -- non-invasive patches for `.claude/commands`.

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

Unified project activity timeline -- aggregates git commits and sessions:

```bash
maestro timeline                    # 查看时间线
maestro timeline --limit 50         # 限制条数
```

</details>

---

## Team Collaboration

<details>
<summary>maestro collab (team)</summary>

Human team collaboration.

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

Agent team message bus.

```bash
maestro msg send "task done" -s <session> --from worker --to coordinator
maestro msg list -s <session> --last 10
maestro msg status -s <session>
maestro msg broadcast "meeting" -s <session> --from coordinator
```

</details>

---

## Configuration & Extensions

<details>
<summary>maestro config (cfg)</summary>

Unified configuration center, integrating Skills, Delegate, Hooks, Overlay, Specs, and Install configuration:

```bash
maestro config skill            # Skill 参数默认值（TUI）
maestro config delegate         # 委派工具配置
maestro config hooks            # Hook 配置
maestro config overlay          # Overlay 配置
```

**delegate-config (dc)** -- Delegate tool registration configuration (`maestro dc`).

</details>

<details>
<summary>maestro impeccable / ext / tool / command-help</summary>

**impeccable** -- Impeccable design tool utilities:

```bash
maestro impeccable context      # 加载 PRODUCT.md 与 DESIGN.md 上下文
```

**ext** -- Extension management:

```bash
maestro ext list                # 列出扩展
```

**tool** -- Tool interaction:

```bash
maestro tool list                       # 列出工具
maestro tool exec read_file '{"path":"README.md"}'
```

**command-help (ch)** -- Open the Maestro command reference guide in the browser:

```bash
maestro command-help
```

</details>

<details>
<summary>maestro brainstorm-visualize (bv)</summary>

Brainstorm HTML prototype visualization server:

```bash
maestro bv start --dir ./prototypes     # 启动服务
maestro bv status <execId>              # 查看状态
maestro bv stop <execId>                # 停止服务
```

</details>

---

## Knowledge Graph

<details>
<summary>maestro kg</summary>

UA knowledge graph CLI -- query the code structure semantic information in `.workflow/codebase/knowledge-graph.json`.

```bash
maestro kg stats                    # 图谱统计（节点数、边数、模块分布）
maestro kg query "UserService"      # 按名称/类型搜索节点
maestro kg explain "validateToken"  # 节点详情（依赖、调用者、模块）
maestro kg path "loginController" "db.query"  # 调用路径
maestro kg diff                     # 对比图谱快照差异
```

| Subcommand | Description |
|--------|------|
| `stats` | Graph statistics |
| `query <pattern>` | Search nodes by name/type |
| `explain <node>` | Node details |
| `path <from> <to>` | Call path between two nodes |
| `diff` | Graph snapshot diff |

</details>

---

## Related Guides

- [All Commands & Workflows](./command-usage-guide.md) — slash command and workflow integration
- [Ralph v2 Engine & Coordinator](./maestro-ralph-guide.md) — Session/Run closed-loop strategy
- [Artifact Directory Structure](./workflow-structure-guide.md) — `.workflow/` layout and session.json Schema
