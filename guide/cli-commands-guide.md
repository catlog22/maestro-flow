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
| `delegate` | -- | 委派任务给 AI 智能体 |
| `explore` | -- | 轻量并行代码搜索（API 端点驱动） |
| `load` | -- | 统一知识加载（spec/knowhow/session/domain 等） |
| `search` | -- | 统一知识搜索（wiki + code 混合） |
| `knowledge` | -- | Run 知识关系、候选审查/晋升、统计与安全剪枝 |
| `search-daemon` | -- | 搜索守护进程管理（start/stop/status） |
| `embedding` | -- | 嵌入模型管理（status/warmup/rebuild） |
| `coordinate` | `coord` | 图工作流协调器 |
| `cli` | -- | 运行 CLI 智能体工具 |
| `run` | -- | Session/Run 生命周期、chain allocator 与 machine protocol |
| `session` | -- | Session 恢复、chain 与 orchestration meta 管理 |
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

## Dashboard（已退役）

Dashboard UI 不再发布，`maestro view` 和 `maestro stop` 已从命令帮助中隐藏。为兼容旧脚本，这两个命令仍可解析旧参数，但只显示退役提示，不会启动或终止进程。

查看当前工作流状态请使用：

- `maestro run brief` — 查看当前 Run 的恢复信息
- `maestro run check` — 检查当前 Run 的门禁与完成指引
- `maestro session status` — 查看 canonical Session/Run 状态

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
<summary>maestro knowledge</summary>

Run 知识生命周期与项目知识维护：

```bash
maestro knowledge stage knowhow "事务写入配方" --content-file recipe.md --type recipe --run <run-id>
maestro knowledge stage spec "规则" --content-file rule.md --run <run-id> --signal validated --signal-ids spec:S-1
maestro knowledge record spec:S-1 knowhow:K-9 --signal consumed --source search --run <run-id>
maestro knowledge review <session-id> [--refresh]
maestro knowledge review <session-id> --resolve KDC-... --as related --target <knowledge-id> --reason "确认关联"
maestro knowledge promote <session-id> --candidate KDC-...
maestro knowledge promote <session-id> --all
maestro knowledge audit --scope all --json          # read-only compatibility/identity/link/promotion diagnostics
maestro knowledge normalize --report .workflow/knowledge-normalize.json
# review the report, then explicitly apply the unchanged snapshot:
maestro knowledge normalize --report .workflow/knowledge-normalize.json --apply
```

`search` 和自动注入只代表 exposure；显式 `load` 自动记录为 consumed。`stage --signal --signal-ids` 在暂存 candidate 的同时记录 `cited` / `validated` / `contradicted` 等 Run 关系。`session done` 返回精确 candidate receipt，但不会直接写项目 spec/knowhow。`review` 展示 diversified matches、证据和可复制的下一步命令；`--refresh` 内含 reconcile；`--resolve` 内含裁决。`promote --all` 晋升所有 eligible 候选（observed-only 输出警告）。Audit 不修改语料；normalize 必须先保存/审阅报告，再独立 `--apply`。

最小创建面：ordinary Knowhow = `maestro knowhow add --type <type> --title "<title>" --content "<content>"`；ordinary Spec = `maestro spec add <category> "<title>" "<content>"`。九种 Knowhow 类型是 `session|tip|template|recipe|reference|decision|asset|blueprint|document`，其余 metadata 都是高级可选项。CLI `--repo` 接受 selector 并选择物理目标，repeatable `--applies-to-repo` 只记录适用范围。host/MCP `targetRepoId` 不是 CLI flag：当前仓库写省略它，仅在显式 linked physical write 且 host 给出 exact stable UUID + live corpus write capability 时传。禁止从 cwd/name/alias/path 推导或持久化 identity。

</details>

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
maestro search "hook" --category coding # 按类别过滤
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
maestro domain init                          # 初始化术语表
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

<details>
<summary>maestro run / maestro session</summary>

`run` 管理一次 command invocation；`session` 管理 canonical Session identity 与兼容管理，bounded lifecycle 和 orchestration authority 由 `execution` 持有。Wave 2 仍是 additive：capabilities 支持 Session writes `session/1.3` + `session/2.0`，但默认 writer 仍是 `session/1.3`，绝不会静默切换默认值。statusless `session/2.0` 只有在 `.workflow/config.json` 显式配置 `session-schema-selection/1.0`、`writer: "session/2.0"` 与 `session_statusless: true` 后才启用；只有带完整 Execution authority 的 Run mutation 写 `command-run/1.4`，并绑定 strict `execution/1.0` / `execution-lease/1.0`。

Schema compatibility 必须区分读取与写入。历史 `session/1.0`-`session/1.3` 与 `command-run/1.0`-`command-run/1.4` 继续走各自 strict compatibility path。未知未来 Session/Run 版本采用 opaque/best-effort read compatibility：passthrough reader 保留字段供旧 CLI 尽力投影，但命令仍可能因缺少旧 shape 所需字段而失败。read acceptance 既不代表完整语义兼容，也不代表所有未知读取都 fail closed。mutation 跨越 fail-closed mutation boundary，必须通过显式选择的 strict writer schema；Execution mutation 还必须带 exact locator、revision fence 与 lease claim。

先用 capability discovery 选择协议面：

```bash
maestro capabilities --json
```

它输出一行原始 `maestro-capabilities/1.0`：`session_schema_writes` exact 为 `session/1.3` + `session/2.0`，Execution writes 只有 `execution/1.0`，response writes 是 `run-response/1.0` + `run-response/1.1`；features exact 为 `execution_generation=true`、`core_execution_lease=true`、`execution_handoff=true`、`execution_operation_drain=true`、`session_statusless=true`、`legacy_session_aliases=true`。capability 支持不等于项目 writer 选择；没有下面的显式配置时，新 Session 仍写 `session/1.3`。

```json
{
  "session_schema": {
    "schema_version": "session-schema-selection/1.0",
    "writer": "session/2.0",
    "features": { "session_statusless": true }
  }
}
```

启用后，`maestro session create` 只能创建 identity：chain、engine、quality、auto 和 platform 都属于 Execution。已有 1.x Session 还必须通过独立的显式 migration gate；只改配置不会迁移已有 authority。

```bash
maestro session create "statusless topic" --id <id> --json
maestro session migrate --session <id> --to session/2.0
maestro session archive --session <id> --request-id <id> --actor <actor> \
  --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json
maestro session unarchive --session <id> --request-id <id> --actor <actor> \
  --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json
```

`session/2.0` identity 不存 Session `status` 或 `active_run_id`，只存 `current_execution_id`、`latest_execution_id` 与 archive metadata。`session list|show|status` 从 canonical Execution authority 输出 `derived_status`/derived availability、Execution status 与 active Run。archive/unarchive 使用 `session-archive-receipt/1.0`，要求两个 CAS revision 与 audit evidence，按 request ID replay，并用 `previous_receipt_hash` 串联 immutable receipt chain。

Execution generation 与 lease 的 canonical commands：

```bash
maestro execution start --session <id> --request-id <id> \
  --owner-id <owner> --owner-kind codex --json
maestro execution status --session <id> --execution <execution-id> --json
maestro execution lease heartbeat --session <id> --execution <execution-id> \
  --request-id <id> --expected-execution-revision <n> \
  --owner-id <owner> --owner-kind codex --lease-epoch <n> --lease-id <token> --json
maestro execution handoff prepare --session <id> --execution <execution-id> \
  --request-id <id> --expected-execution-revision <n> \
  --owner-id <owner> --owner-kind codex --lease-epoch <n> --lease-id <token> \
  --to-owner-id <owner> --claim-output <private-path>
maestro execution lease recover --session <id> --execution <execution-id> \
  --request-id <id> --expected-execution-revision <n> \
  --owner-id <owner> --owner-kind manual --stale-after-ms <n> --json
```

Command tree 是 `execution start|attach|status|pause|resolve|resume|seal`、`execution handoff prepare|accept|cancel`、`execution lease status|heartbeat|release|recover`。所有 mutation 要求 exact locator、idempotent request 与 `--expected-execution-revision`；leased mutation 还要求完整 owner/kind/`--lease-epoch`/private `--lease-id`。acquisition surface 可用 `--claim-output` 写 mode-0600 claim；status、普通 response 与 receipt 只显示 public lease/hash。`maestro execution seal` 只关闭一个 generation，不永久封闭 Session identity，并写入 immutable `execution-seal-receipt/1.0`，快照 sealed Runs、chain、gates、Artifact registry/content hashes、Evidence 与 corpus refs。receipt-backed recall/import 使用 `source-fence/1.1`，receipt-backed reuse 使用 `reuse-source-fence/1.1`；二者可跨后续 Session activity 保持有效，但 receipt、Run、Artifact、generation 或跨 Session 漂移都会 fail closed。Artifact aliases 始终是 Session-global，不冻结在某个 Execution 内。`session ... --execution` 与 `run status --execution` 是 deprecated aliases，新调用应使用 `maestro execution ...`。

session-source knowledge 也不依赖 permanent Session seal（永久 Session seal）。`maestro knowledge stage ... --session <id> --evidence <ref>` 写入 candidate snapshot；session-level reconciliation fresh 后，显式 `maestro knowledge promote <session-id> ...` 可在不 seal Session 的情况下提升。run-source candidate 仍要求 source Run sealed。Execution seal 或历史 Session seal 都不会隐式 promotion。

Execution-aware `run create|next|complete|decide` 还要求 `--execution <id> --generation <n>` 加上述 revision/lease options，输出 `run-response/1.1` 并写 `command-run/1.4`。整组 Execution options 都省略时保留 legacy `run-response/1.0` + `command-run/1.3`；partial options 返回 `COMMANDER_USAGE`，不会静默回退。

人类入口优先使用 `run start` / `run done` / `run edit`；`run create` / `run complete` 保留为稳定 machine protocol 和兼容面。

```bash
maestro run start "理解认证流程" --cmd learn --session 20260721-learn-auth --arg "src/auth"
maestro run start "修复登录链路" --chain analyze plan execute verify
maestro session create "修复登录链路" --chain analyze plan execute verify --engine manual
maestro run edit test review --after latest
maestro run done --verdict done-with-concerns --note "后续补充文档镜像"

maestro run prepare <step> --platform codex
maestro run create <command> --session <id> --intent "<intent>" --json
maestro run brief <run-id> --session <id> --json
maestro run check <run-id> --session <id> --json
maestro run complete <run-id> --session <id> --chain-proposal outputs/chain-proposal.json --json
maestro run seal-session <session-id> --json
maestro session status <session-id>
maestro session check <session-id>
maestro session evidence <session-id> --status accepted
maestro skills --platform codex --steps --json
```

`run brief` 的成功结果固定为 `brief-result/1.1`（读取兼容 `1.0`）：`session`/`run` 是 durable authority，
`guidance` 携带 prepare、workflow、完整 run-mode 以及 captured/current hash drift，
`execution_contract` 是 invocation、inputs、outputs、gates、reuse 的唯一结构化执行视图，
`continuity` 携带 handoff/anchor，`recovery.next` 与外层 envelope `next` 必须完全一致。
顶层只保留 human locator（`session_id/run_id/run_dir`）和 Pi bridge 使用的 canonical
`upstream` map；不再重复输出 args、argument requirements、reuse assessments、gate summary
或 outputs。

所有入口共享一种 Session 和一种 chain；历史 `engine` 只作兼容元数据。声明 `orchestration.chain_effects` 的 Skill 可产出 typed proposal，orchestrator 决定 accept/reject/revise，Runtime 通过 `run complete --chain-proposal` 将 Run seal、verdict 与链变更原子提交。`/maestro` 与 `/maestro-ralph` 可双向继续同一 Session，无需 promotion 或 engine rewrite。

Canonical paused recovery 必须按 `resolve` → `resume` 执行：

```bash
maestro session resolve --session <id> --decision <point-id> --disposition proceed \
  --request-id <id> --actor <name> --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json

maestro session resume --session <id> \
  --request-id <id> --actor <name> --reason "<reason>" --evidence <ref> \
  --expected-identity-revision <n> --expected-activity-revision <n> --json

maestro run next --session <id> --json
```

`resolve` 每次只处置一个 escalated decision（`--decision` + `proceed|retry`）或 failed step（`--step` + `retry|skip`），成功后 Session 仍为 `paused`。`resume` 只在所有 blocker 清空后转为 `running`。两者都不创建 Run；`run next` 是恢复后唯一的 chain allocator。若 Session 有 lease，两条命令都必须同时提供 `--execution-owner`、`--owner-epoch`、`--lease-id`。

#### Machine operation matrix（1.0 legacy + 1.1 additive）

| `operation` | CLI surface | 关键参数 / 行为 |
|-------------|-------------|-----------------|
| human wrapper | `run start` | 手写入口；单 Run 模式包装 `create`，链模式创建 Session 并可 dispatch 第一条 `next` |
| human wrapper | `run done` | 手写入口；包装 `complete --verdict`，完成当前 Run 后只返回 suggest-only next |
| human wrapper | `run edit` | 手写入口；插入/替换/跳过 pending chain step，不创建 Run |
| `create` | `run create`；legacy confirmed `run new` | `create` 需要 command；Session identity 建议显式传 `--session` |
| `next` | `run next` | 可选 `--session`/`--pick`；选择 pending step 并分配 chain Run |
| `complete` | `run complete` | 可选 run ID；支持 `--chain-proposal` 原子应用已接受 Skill proposal，并保留 request/revision/lease guards |
| `brief` | `run brief <run-id>` | 返回强校验的 `brief-result/1.1` Resume Packet（含 `knowledge_context`，读取兼容 `1.0`）；外层与结果层 next 一致 |
| `recall` | `run recall <command> --intent <text>` | 只读 advisory projection，不授权 mutation |
| `fork` | legacy `run recall-confirm fork` / `run fork` | confirmation-token 管理兼容面 |
| `import` | legacy `run recall-confirm import` / `run import` | confirmation-token 管理兼容面 |
| `check` | `run check <run-id>` | 幂等扫描 outputs 并求值 gates |
| `decide` | `run decide <point-id>` | 必填 `--session --verdict --confidence`；receipt-backed |
| `seal-session` | `run seal-session <session-id>` | 仅历史 `session/1.x` 兼容；不是 Wave 2 completion 或 promotion gate |
| `execution-seal` | `execution seal` | seal 一个 Execution generation 并写 `execution-seal-receipt/1.0` snapshot；Session identity 可继续复用 |
| `execution-operation-claim` / `execution-operation-heartbeat` / `execution-operation-release` / `execution-operation-status` | `execution operation claim|heartbeat|release|status` | 用 Execution revision + operation registry revision CAS 管理 root/child lineage；只有 claim success 返回 raw `operation_token`，registry/receipt/status 与持久化或日志投影只保留 hash 或删除 token |
| `session-archive` / `session-unarchive` | `session archive` / `session unarchive` | statusless identity lifecycle，要求 audited CAS flags 与 hash-linked receipt chain |
| `resolve` | `session resolve` | 必填 audit/revision flags 和且仅一个 recovery target；保持 paused |
| `resume` | `session resume` | 必填 audit/revision flags；只执行 paused → running |
| session creation | `session create --chain` | 简单命令链建 Session；`--chain-file` 仅用于高级 JSON definition |
| session query | `session status/check/evidence` | engine-neutral Session 状态、一致性检查与 Evidence Registry 查询 |
| `chain-insert` | `session chain insert` | 必填 `--session --after --command`；receipt-backed |
| `chain-replace` | `session chain replace` | 必填 `--session --step`；仅 pending step |
| `chain-skip` | `session chain skip` | 必填 `--session --step`；仅 pending step |
| `meta-update` | `session meta update` | 必填 `--session`，且至少一个 `--position-file`/`--decomposition-file` |
| `accept-reuse` | `run accept-reuse <run-id>` | 必填 request/revision guards、`--actor`、`--reason` 和至少一个 `--evidence`；receipt-backed |
| `plan-publish` | `plan publish <path>` | 发布不可变的 approved Markdown 为 sealed `plan/1.0` `current-plan` artifact。`session/3.0` 下驱动一次 producer Run（`session open --chain plan-publish` → `run next` → `run complete --advance`），将 artifact 注册进 Session Artifact Registry；legacy `session/1.x/2.0` 下可绑定 running Session 或自动创建 `execute -> verify` Session 并携带 Execution/lease authority。按 handoff key 幂等且 receipt-backed |

对 `decide`、recovery、chain 与 meta mutation，`--request-id` 提供幂等 transition receipt；`--expected-identity-revision`、`--expected-activity-revision` 与完整 lease triple 提供 fence。`resolve`/`resume` 将这些 audit/revision 字段设为必填；chain/meta mutation 接受同一组 guard options。

显式 `--json` 时，legacy/default surface 的 success、business error、replay 和 Commander usage 继续只写一行 strict `run-response/1.0`；stderr 为空，process status 与 envelope `exit_code` 一致。

Execution lifecycle、Execution-aware Run mutation 与 deprecated Execution aliases 使用 strict `run-response/1.1`。它接受全部 1.0 operations，并加入 `capabilities`、`session-create`、`session-archive`、`session-unarchive`、`execution-start`、`execution-attach`、`execution-status`、`execution-pause`、`execution-resolve`、`execution-resume`、`execution-seal`、`execution-handoff-prepare`、`execution-handoff-accept`、`execution-handoff-cancel`、`execution-lease-status`、`execution-lease-heartbeat`、`execution-lease-release`、`execution-lease-recover`、`execution-operation-claim`、`execution-operation-heartbeat`、`execution-operation-release`、`execution-operation-status`。1.1 增加 `disposition`、Execution locator、revision/lease fence 与 warnings，同样保持一行 stdout、空 stderr、exit parity；usage error 是 `COMMANDER_USAGE`、exit 2。`maestro capabilities --json` 则直接输出一行 capability JSON。

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
maestro spec add <category> "<title>" "<content>" --json  # --json 返回 sid
maestro spec supersede <old-sid> --by <new-sid>          # 演化替代
maestro spec history <sid>                          # 查看演化链
maestro spec health [--json]                             # 知识健康报告
maestro spec backfill-sid                                # 回填存量无 sid 条目
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

# 创建（spec / knowhow）
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
> **KG 集成**：当 `.workflow/codebase/knowledge-graph.json` 存在时，KG 节点、架构层、代码导览自动作为虚拟条目索引到 wiki，可通过 `wiki search`、`wiki list --query kg` 发现。

</details>

<details>
<summary>maestro kg</summary>

代码知识图谱查询。操作 `.workflow/codebase/knowledge-graph.json`（由 `maestro kg index` 的 KG 管道生成）。

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

知识复用管理。9 种兼容类型: session, tip, template, recipe, reference, decision, asset, blueprint, document。普通创建只要求 type/title/content。

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
<summary>maestro-ralph policy 与兼容 CLI</summary>

`/maestro-ralph` 是 canonical Session/Run 之上的 closed-loop policy，不拥有 Ralph 专属 Session。通用辅助能力使用中立 namespace；旧 `maestro ralph ...` 仅保留兼容窗口。

```bash
maestro session status <session-id>     # 通用 Session 状态
maestro session check <session-id>      # 通用 chain/Run/decision 检查
maestro session evidence <session-id>   # canonical Evidence Registry
maestro skills --platform codex --steps # 通用 Skill/step scanner
maestro run next --session <session-id> # 分配下一条 chain-bound Run
maestro run complete --session <session-id> --verdict done
```

| 子命令 | 说明 |
|--------|------|
| `maestro session status/check/evidence` | 查询任意 compatible Session，不按 engine 分型 |
| `maestro skills` | 扫描可用 Skill 与 Run-resolvable steps |
| `maestro run next/complete` | 所有 orchestrator 共享的 canonical Run lifecycle |
| `maestro ralph skills/session/check/next/complete` | deprecated compatibility aliases；新调用不要使用 |

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
