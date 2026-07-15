# Session-Run 架构参考

> 基于实际代码的架构文档。描述 Session/Run 生命周期、命令路由机制（prepare + workflow）、以及跨平台 Skill 转换管线。

---

## 一、Session-Run 数据模型

### 1.1 磁盘布局

```
.workflow/
├── state.json                                    # 项目级：sessions[] + active_session_id
└── sessions/
    └── {YYYYMMDD}-{slug}/                        # Session 目录
        ├── session.json                          # Session 状态
        ├── gates.json                            # Gate 注册表
        ├── artifacts.json                        # 产物注册表
        ├── evidence.json                         # 证据注册表
        ├── specs/  knowhow/                      # Session 级知识（惰性创建）
        └── runs/
            └── {YYYYMMDD}-{NNN}-{command}/       # Run 目录
                ├── run.json                      # Run 元信息 + 合约
                ├── report.md                     # 人类可读报告
                ├── outputs/                      # 正式产物
                ├── evidence/                     # 证据附件（惰性）
                └── work/                         # 临时草稿（惰性）
```

### 1.2 ID 生成规则

| ID 类型 | 格式 | 生成逻辑 | 源码 |
|---------|------|----------|------|
| Session ID | `YYYYMMDD-{slug}` | `dateId()` + `slug(intent, command)` | `runtime.ts:205-215` |
| Run ID | `YYYYMMDD-{NNN}-{command}` | `dateId()` + 3 位序号 + `slug(command)` | `runtime.ts:549` |

**slug 函数**（`runtime.ts:157`）：NFKD 正规化 → 小写 → 仅保留 `a-z0-9`（中文等非 ASCII 字符被替换为连字符）→ 去首尾连字符 → 截断 64 字符。空结果使用 fallback（command 名）。

**Session ID 校验**（`runtime.ts:190-197`）：显式传入的 `--session` 必须匹配 `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` 且长度 ≤128。

### 1.3 Session 解析四级优先

`resolveSessionId()`（`runtime.ts:199`）按以下优先级解析 Session：

```
1. --session 显式 ID       → 直接使用（不存在则新建）
2. intent slug 匹配        → 在 running/paused sessions 中匹配相同 intent slug
3. active_session_id 优先  → 匹配结果中优先返回 active session
4. 自动生成                → YYYYMMDD-{slug(intent, command)}，冲突时追加 -02/-03/...
```

### 1.4 生命周期

```
prepare ──→ create ──→ brief ──→ [执行] ──→ check ──→ complete ──→ seal-session
(只读预览)   (分配ID)   (恢复包)   (领域工作)   (门禁评估)  (完成Run)    (锁定Session)
```

---

## 二、CLI 命令（`src/commands/run.ts`）

| 子命令 | 签名 | 功能 |
|--------|------|------|
| `prepare` | `<step> [--platform] [--workflow-root]` | 只读预览：返回 prepare 内容 + workflow 内容 + 合约 + 引用 |
| `create` | `<command> [args...] [--session] [--intent] [--parent-run]` | 创建 Run：解析 Session → 注册 Gate → 收集上游 → 返回 run_id + run_dir |
| `brief` | `<run-id> [--session]` | 恢复包：返回 Run 元信息 + 上游 artifact 快照 + 已产出扫描 |
| `check` | `<run-id> [--session] [--stage]` | 扫描 outputs/ + 评估 exit gate → 返回通过/失败/阻断 |
| `complete` | `<run-id> [--session]` | check + 标记 Run 完成 + 更新 state.json |
| `seal-session` | `<session-id>` | 锁定 Session：所有 Run 必须已完成，产物变为不可变 |
| `list` | `[--workflow-root]` | 列出所有 Session 及其 Run |

### 2.1 createRun 数据流

```
CreateRunOptions
  ├── projectRoot, command, sessionId?, intent?, args[]
  │
  ▼
resolveSessionId()      ← 四级优先解析
  │
  ▼
store.createSession()   ← 不存在则创建
  │
  ▼
resolveCommandSource()  ← 查找 prepare/workflow/contract
  │
  ▼
store.update(sessionId) ← 事务写入
  ├── nextSequence()    ← 扫描 runs/ 目录确定序号
  ├── registerRunGates()← 从 contract 派生 entry/exit gates
  ├── collectUpstream() ← 从 artifacts.json 收集 consumes 依赖
  └── 写入 run.json + 返回 CreateRunResult
```

**返回值**（`CreateRunResult`）：
```typescript
{
  session_id: string;
  run_id: string;
  run_dir: string;            // 相对路径
  upstream: Record<string, UpstreamArtifact>;  // alias → artifact
  entry_gates: { passed, failed, skipped, blocking };
  // + 可选字段：workflow, prepare, runMode, refs, platform
}
```

---

## 三、命令路由机制（prepare + workflow）

### 3.1 三层文件体系

每个可执行步骤由三类文件组成：

| 文件类型 | 目录 | 用途 | 示例 |
|----------|------|------|------|
| **Command** | `.claude/commands/*.md` | Claude 入口定义（frontmatter + 领域逻辑） | `odyssey.md` |
| **Prepare** | `prepare/*.md` | 预任务思考提示（只读阶段注入） | `prepare/odyssey-planex.md` |
| **Workflow** | `workflows/*.md` | 执行时工作流内容（create 阶段注入） | `workflows/odyssey-planex.md` |

### 3.2 resolveCommandSource（`contract.ts:91`）

将 command 名解析为 prepare 文件 + contract：

```
输入: commandName (e.g. "odyssey")
  │
  ▼ 正规化: 去 "/" 前缀和 ".md" 后缀
  │
  ▼ 生成候选名: [normalized, maestro-prefixed/unprefixed]
  │
  ▼ 搜索优先级（第一个命中的文件）:
  │   1. .workflow/prepare/{name}.md         （项目级 prepare）
  │   2. ~/.maestro/prepare/{name}.md        （全局 prepare）
  │   3. {projectRoot}/prepare/{name}.md     （仓库内 prepare）
  │   4. .claude/commands/{name}.md          （项目级 command）
  │   5. .claude/skills/{name}/SKILL.md      （项目级 skill）
  │   6. resolveStepContent().prepare        （workflow association 回溯）
  │   7. ~/.claude/commands/{name}.md        （全局 command）
  │   8. ~/.claude/skills/{name}/SKILL.md    （全局 skill）
  │
  ▼ 提取 contract: <contract> 标签 > YAML 代码块 > frontmatter
  │
  ▼ 返回: { path, raw, contentHash, contract }
```

### 3.3 resolveStepContent（`contract.ts:233`）

将 step 名解析为 prepare + workflow + runMode + refs 四件套：

```
输入: stepName (e.g. "odyssey-planex")
  │
  ▼ 搜索 prepare 目录: [.workflow/prepare, ~/.maestro/prepare, ./prepare]
  ▼ 搜索 workflow 目录: [.workflow/workflows, ~/.maestro/workflows, ./workflows]
  │
  ▼ 直接匹配: workflows/{stepName}.md
  │   └── 未命中 → 关联匹配: 扫描所有 workflow 文件的 frontmatter
  │       └── 匹配 commands: [stepName] 字段
  │
  ▼ Workflow Association（workflow frontmatter）:
  │   name: odyssey-planex
  │   prepare: odyssey-planex       ← 指定 prepare 文件名
  │   commands: [<alias>]           ← 可选：命令别名触发（同目录多文件认领同名会抛错）
  │
  ▼ 平台覆盖: {name}.codex.md 优先于 {name}.md
  │
  ▼ run-mode: workflows/run-mode.md（或平台覆盖 run-mode.codex.md）
  │
  ▼ refs: 从 prepare 文件 frontmatter 提取引用列表
  │
  ▼ 返回: { prepare, workflow, runMode, refs }
```

### 3.4 平台覆盖（Platform Override）

`prepare/` 和 `workflows/` 支持平台特化版本：

```
prepare/odyssey-planex.md          ← 默认（Claude）
prepare/odyssey-planex.codex.md    ← Codex 覆盖
workflows/odyssey-planex.md        ← 默认
workflows/odyssey-planex.codex.md  ← Codex 覆盖
```

当 `--platform codex` 时，`.codex.md` 文件优先加载。后缀映射定义在 `skill-converter.ts:1068`：

| 平台 | 后缀 |
|------|------|
| codex | `.codex.md` |
| agy | `.agy.md` |
| pi | `.pi.md` |

### 3.5 Contract 系统

每个 command/prepare 文件可声明合约：

```yaml
contract:
  consumes:                      # 上游依赖
    - kind: analysis
      alias: current-analysis
      required: true
  produces:                      # 本步产出
    - kind: plan
      primary: true
      alias: current-plan
  gates:                         # 额外门禁
    entry:
      - artifact-exists-check
    exit:
      - all-tests-pass
```

- **consumes** → 运行时从 `artifacts.json` 的 alias 解析上游 artifact，注入 `upstream` 返回值。每个 required consume 隐式生成一个 entry gate。
- **produces** → 注册为 exit gate，`check` 时扫描 `outputs/` 验证对应 kind 是否存在。`role` 值：`primary`（默认交接）| `evidence` | `report` | `attachment`。
- **gates.entry/exit** → 注册为 Run 级门禁。可以是简单字符串（生成 non-required、non-blocking、初始 skipped 的 manual Gate）或完整对象。

**Gate 检查类型**（`schemas.ts:69-82`）：

| type | 说明 | 示例 |
|------|------|------|
| `artifact` | 检查 artifact 是否存在/已 sealed | `{ type: "artifact", kind: "plan", alias: "current-plan" }` |
| `file` | 检查文件是否存在 | `{ type: "file", path: "outputs/report.md", exists: true }` |
| `schema` | 验证 artifact 符合 JSON Schema | `{ type: "schema", artifact_ref: "...", schema_id: "..." }` |
| `session` | 检查 session 文件状态 | `{ type: "session", path: "session.json", ... }` |
| `command` | 执行外部命令检查退出码 | `{ type: "command", argv: ["npm", "test"], expect_exit: 0 }` |
| `manual` | 人工确认 | `{ type: "manual", prompt: "确认测试全部通过？" }` |
| `decision` | 决策点检查 | `{ type: "decision", point: "scope-review", outcome: "approved" }` |

> **隐式 Gate**：每个 `consumes[]` 中 `required: true` 的条目自动生成 artifact-availability entry gate。当 contract 无 `consumes` 时，所有已注册 alias 的 artifact 都注入 upstream（非空集）。

---

## 四、安装管线（`src/core/install-executor.ts`）

### 4.1 组件定义（`component-defs.ts`）

| 组件 ID | 源路径 | 安装目标 | 安装方式 |
|---------|--------|----------|----------|
| `commands` | `.claude/commands/` | `~/.claude/commands/`（global）或 `.claude/commands/`（project） | 直接复制 |
| `prepare` | `prepare/` | `~/.maestro/prepare/` | 直接复制（始终 global） |
| `workflows` | `workflows/` | `~/.maestro/workflows/` | 直接复制（始终 global） |
| `codex-skills` | `.codex/skills/` | 项目 `.codex/skills/` | 直接复制（非从 .claude 转换） |
| `codex-agents` | `.codex/agents/` | 项目 `.codex/agents/` | 直接复制 |

> **注**：`.codex/` 目录内容通过 `buildCodexSkills()` 从 `.claude/` 离线转换生成，但安装时是直接复制已转换的文件，不是安装时实时转换。`buildAgySkills()`/`buildPiSkills()` 同理用于 `.agy/`/`.pi/` 的离线构建。

### 4.2 安装流程

```
maestro install [--component <id>]
  │
  ▼ scanComponents() — 加载组件定义，按 selectedComponentIds 过滤
  │
  ▼ 卸载 prior manifest 中的旧文件
  │
  ▼ 创建并提前写入新 manifest（crash recovery）
  │
  ▼ 对每个组件:
  │   ├── 有 build() 回调 → 调用构建器（离线转换）
  │   ├── inject: true → injectDocFile()（标签注入 CLAUDE.md/AGENTS.md）
  │   └── 否则 → copyRecursive()（带 fileFilter 过滤）
  │
  ▼ pruneOrphans() — 移除目标中源已不存在的文件
```

**关键约束**：prepare/ 和 workflows/ 始终安装到全局 `~/.maestro/`；commands 可选 global 或 project 模式。

---

## 五、Skill 转换管线（`src/core/skill-converter.ts`）

### 5.1 源与目标

| 源 | 目标 | 说明 |
|----|------|------|
| `.claude/commands/*.md` | `.codex/skills/{name}/SKILL.md` | 单文件 → 目录包装 |
| `.claude/skills/{name}/SKILL.md` | `.codex/skills/{name}/SKILL.md` | 结构保持 |
| `.claude/agents/{name}.md` | `.codex/agents/{name}.md` | 代理定义 |

### 5.2 平台 Profile

每个目标平台定义一个 `ConversionProfile`：

```typescript
interface ConversionProfile {
  bodyReplacements: BodyReplacement[];      // 正文正则替换对
  frontmatterToolMap: Record<string, string>; // allowed-tools 映射
  removedTools: Set<string>;                 // 目标平台不支持的工具
  subagentTools: string[];                   // Agent 编排时注入的工具
  rewriteAgentCalls: boolean;                // AST 级 Agent() 调用重写
  rewriteSkillCalls: boolean;                // AST 级 Skill() 调用重写
  snakeCaseUnknown: boolean;                 // 未知工具名是否转 snake_case
}
```

### 5.3 Codex 转换（主要平台）

**Frontmatter 工具映射**（`CODEX_PROFILE.frontmatterToolMap`）：

| Claude 工具 | Codex 工具 |
|-------------|-----------|
| `AskUserQuestion` | `request_user_input` |
| `Agent` | `spawn_agent` |
| `Skill` | `spawn_agent` |
| `SendMessage` | `send_message` |
| `TaskCreate` | `create_goal` |
| `TaskUpdate` | `update_goal` |
| `TaskList` | `list_agents` |
| `TaskGet` | `wait_agent` |
| `TaskStop` | `interrupt_agent` |
| `TodoWrite` | `update_plan` |

**正文替换**（除上述映射外的额外规则）：
- `SendMessage({ to:` → `followup_task({ target:`
- `ralph skills --platform claude` → `ralph skills --platform codex`
- `<goal_tracking>` 块替换为 Codex 专用版本
- `spawn_agents_on_csv` 调用强制注入 `max_runtime_seconds: 3600`
- `wait_agent` 调用强制注入 `timeout_ms: 3600000`

**移除的工具**（Codex 不支持）：
`ExitPlanMode`, `EnterPlanMode`, `ExitWorktree`, `EnterWorktree`, `NotebookEdit`, `Monitor`, `PushNotification`, `RemoteTrigger`, `ScheduleWakeup`, `CronCreate/Delete/List`, `ToolSearch`, `LSP`

### 5.4 其他平台

| 平台 | Profile | 特点 |
|------|---------|------|
| **agy** | `AGY_PROFILE` | AST 级 Agent()/Skill() 重写；工具名用 `$camelCase`；subagent 用 `antigravity_subagent` |
| **pi** | `PI_PROFILE` | `teammate()` 替代 Agent；`todo()` 替代 TaskCreate/Update；host mirror 协议 |
| **agents-standard** | `AGENTS_STANDARD_PROFILE` | 开放标准格式；snake_case 工具名 |

### 5.5 转换管线

**离线构建**（Codex 为例，`convertTextCodex` 实际顺序）：

```
对每个源文件:
  1. 分离 frontmatter 和 body
  2. 检测 Agent/Goal 编排模式
  3. rewriteAgentCallSitesCodex — Agent() 正则重写为 spawn_agent()
  4. rewriteSkillCallSitesCodex — Skill() 正则重写为 spawn_agent()
  5. applyBodyReplacements — 通用正则替换（工具名、超时注入等）
  6. 重写 allowed-tools（frontmatterToolMap + removedTools + subagentTools 注入）
  7. 注入 Agent/Goal 提示注释
  8. stripToolTags — 移除 [@ask] [@subagent] 等 authoring 标记
  9. 写入目标路径
```

> **注**：所谓"AST 级重写"实际全部由正则表达式完成（`skill-converter.ts:369-426`）。`Agent` 在 allowed-tools 中不仅映射为 `spawn_agent`，还会注入全部 7 个 subagent tools。

**运行时转换**：`transformContentForPlatform()` 函数（`skill-converter.ts:1236`）在 `maestro run prepare --platform` 时动态转换 prepare/workflow 内容。即使命中了 `.codex.md` 平台覆盖文件，runtime 仍会再次执行此转换（override + conversion，非原样直通）。

---

## 六、完整执行流程

以 `maestro run create odyssey-planex --session 20260715-odyssey-planex-auth --intent "实现认证模块"` 为例：

```
1. CLI 解析 (run.ts:42-69)
   command = "odyssey-planex"
   opts.session = "20260715-odyssey-planex-auth"
   opts.intent = "实现认证模块"
   positionalArgs = []

2. createRun (runtime.ts:538)
   intent = "实现认证模块"
   │
   ├── validateSessionSlug("20260715-odyssey-planex-auth") → OK
   ├── resolveSessionId → 直接返回 "20260715-odyssey-planex-auth"
   ├── store.createSession() → 创建 session 目录 + session.json（在 command 解析前）
   └── resolveCommandSource("odyssey-planex")
       → 命中 prepare/odyssey-planex.md（模式专属 contract）
       → 提取 contract（consumes/produces/gates.exit）

3. 受锁保护的 JSON batch write（目录脚手架不在回滚边界内）
   sequence = 1 (首个 run)
   runId = "20260715-001-odyssey-planex"
   runDir = ".workflow/sessions/20260715-odyssey-planex-auth/runs/20260715-001-odyssey-planex"
   │
   ├── 创建 run 目录 + outputs/ + evidence/ + work/
   ├── 同步创建 report.md 和 diagnostics.ndjson
   ├── 从 contract.consumes 注册 entry gates
   ├── 从 contract.produces 注册 exit gates
   ├── 收集 upstream artifacts
   └── 写入 run.json

4. 返回 CreateRunResult
   { session_id, run_id, run_dir, upstream, entry_gates }
   注：workflow/prepare/runMode/refs 不在 createRun 返回值中，
   而是通过后续 briefRun 或 prepareStep 加载

5. LLM 加载 workflow 内容（via briefRun 或 prepareStep）→ 执行 → 写入 outputs/

6. maestro run check → 扫描 outputs/ + 评估 gate
7. maestro run complete → check + 标记完成 + 更新 state.json
```

---

## 七、`--session` 使用规范

`run-mode.md` 规定所有 `session-mode: run` 命令必须显式传入 `--session`：

```bash
# 格式: YYYYMMDD-{command}-{topic}，ASCII only
# 编写策略: ≤64 字符（run-mode.md 规范）；runtime hard limit: 128 字符
maestro run create <command> \
  --session YYYYMMDD-<command>-<topic> \
  --intent "<短描述>" \
  -- <command-specific-flags>

# 示例（odyssey 系列使用模式限定名，不再通过 -- --mode 传递）
maestro run create odyssey-planex \
  --session 20260715-odyssey-planex-auth \
  --intent "实现认证模块"
```

**不传 `--session` 时**：runtime 从 `--intent`（或 command 名）自动 slug 生成。纯中文 intent 会退化为 command 名作为 fallback（如 `20260715-odyssey-planex`）。

**校验规则**：`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`，拒绝大写、空格、特殊字符。

**自动生成路径的安全注意**：自动生成的 session ID 经过 `slug()` 处理后不会包含 `..` 或路径分隔符，但 `slug()` 的 fallback 参数（command 名）未经同等校验。Command 名来源于 CLI positional arg，`resolveCommandSource` 仅移除开头 `/` 和 `.md` 后缀，不拒绝 `..`。对安全敏感场景建议对 command 名做 containment 检查。

---

## 八、`session-mode: run` 契约要求

所有声明 `session-mode: run` 的 command 和 stateful skill 必须遵守：

1. **`<required_reading>` 引用 canonical `run-mode.md`** — 不得内联复制 Session/Run 生命周期
2. **`maestro run create` 前置** — 任何领域工作前必须先 create run
3. **产物边界** — 正式产物只进 `{run_dir}/outputs/`；证据进 `{run_dir}/evidence/`
4. **协议文件只读** — `session.json`、`run.json`、`artifacts.json` 由 runtime 拥有，不得直接编辑
5. **`check` → `complete` 顺序** — `check` blocking 时禁止 `complete`；run 未完成时禁止报告成功
