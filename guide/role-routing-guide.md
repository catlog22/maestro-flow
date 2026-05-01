# 角色路由与工具配置指南

基于角色的 CLI 工具路由配置，将工作类型（分析、审查、实现等）与具体 CLI 工具解耦。

---

## 概览

Maestro 通过 `--role` 替代 `--to` 进行工具选择，实现：
- **工作类型与工具解耦** — 命令/skill 只声明"需要什么能力"，不绑定具体工具
- **配置驱动路由** — `cli-tools.json` 定义 fallback chain，新增/移除工具无需改命令
- **工作空间覆盖** — 项目级配置覆盖全局配置，不同项目可用不同工具组合

```
命令 --role analyze → cli-tools.json → fallbackChain: [codex, gemini, claude] → 第一个 enabled 的工具
```

---

## 配置文件

### 路径优先级

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `{project}/.maestro/cli-tools.json` | 项目级覆盖 |
| 2 | `~/.maestro/cli-tools.json` | 全局配置 |
| 3 | 内置默认值 | 代码中的 `DEFAULT_ROLE_MAPPINGS` |

### 配置结构

```json
{
  "version": "1.1.0",
  "tools": {
    "gemini": {
      "enabled": true,
      "primaryModel": "gemini-2.5-pro",
      "tags": ["fullstack", "frontend"],
      "type": "builtin"
    },
    "claude": {
      "enabled": true,
      "primaryModel": "claude-sonnet-4-20250514",
      "tags": ["fullstack"],
      "type": "builtin",
      "settingsFile": "~/.maestro/profiles/claude-review.json"
    },
    "codex": {
      "enabled": true,
      "primaryModel": "o3",
      "tags": ["fullstack", "backend"],
      "type": "builtin"
    }
  },
  "roles": {
    "review": { "fallbackChain": ["codex", "gemini", "claude"] },
    "brainstorm": { "fallbackChain": ["gemini", "codex", "claude"] }
  }
}
```

---

## 7 个固定角色

| 角色 | 用途 | 默认 fallback chain |
|------|------|---------------------|
| `analyze` | 代码分析、模式识别、根因诊断 | codex → gemini → claude |
| `explore` | 代码库探索、上下文收集、依赖追踪 | codex → gemini → claude |
| `review` | 代码审查、质量评估、安全扫描 | codex → gemini → claude |
| `implement` | 代码实现、bug 修复、重构 | codex → claude → gemini |
| `plan` | 任务分解、架构规划、方案设计 | codex → gemini → claude |
| `brainstorm` | 创意发散、多角度分析、方案探索 | gemini → codex → claude |
| `research` | 技术调研、API 文档、最佳实践 | gemini → codex → claude |

### 路由解析顺序

```
1. config.roles[role]     — 用户自定义 (cli-tools.json)
2. DEFAULT_ROLE_MAPPINGS  — 内置默认
3. fallbackChain 中第一个 enabled 的工具
4. 兜底: 任意第一个 enabled 工具
```

---

## Domain Tags

与角色独立，用于 `maestro execute` 按文件领域自动分配执行工具：

| Tag | 匹配场景 |
|-----|----------|
| `frontend` | .tsx/.jsx/.vue/.css、UI 组件、页面 |
| `backend` | .go/.rs/.java/.py、API、数据库 |
| `fullstack` | 通用，兜底匹配 |
| `devops` | CI/CD、容器、基础设施 |
| `data` | 数据管线、ETL、分析 |
| `mobile` | iOS/Android 原生 |
| `infra` | 云资源、IaC |

Execute E0.5 阶段读取 tags 构建动态选项：
```
frontend → 第一个有 "frontend" tag 的工具
backend  → 第一个有 "backend" tag 的工具
default  → "agent" (本地 Agent)
```

---

## 工具别名与 settingsFile

### 注册工具别名

通过 `maestro delegate-config` TUI 或直接编辑 `cli-tools.json`：

```json
{
  "tools": {
    "claude-review": {
      "enabled": true,
      "primaryModel": "claude-sonnet-4-20250514",
      "tags": ["fullstack"],
      "type": "builtin",
      "baseTool": "claude",
      "settingsFile": "~/.maestro/profiles/claude-review.json"
    }
  },
  "roles": {
    "review": { "tool": "claude-review" }
  }
}
```

- `baseTool` — 指定底层 CLI（决定用哪个 adapter）
- `settingsFile` — 传递给 CLI 的配置文件路径（当前仅 Claude 支持 `--settings`）

### TUI 管理

```bash
maestro delegate-config        # 启动 TUI
maestro dc                     # 短别名

# 子命令（非交互）
maestro delegate-config show          # 文本输出当前配置
maestro delegate-config show --json   # JSON 格式
maestro delegate-config roles         # 查看角色映射
```

TUI 功能：
- **[1] Tools** — 启用/禁用工具，编辑 domain tags
- **[2] Roles** — 查看/编辑角色 fallback chain 顺序
- **[3] Register** — 注册工具别名（名称 + settingsFile + 角色绑定）
- **[4] Ref** — 命令/skill 中的角色引用参考
- **[5] Config** — 全局 vs 工作空间配置源对比

---

## Workflow 中的 CLI 辅助调用

以下 workflow 在关键环节增加了可选的 CLI delegate 辅助分析。全部 `run_in_background: true` 异步执行，无 CLI 工具时自动跳过。

| Workflow | 环节 | 角色 | 功能 |
|----------|------|------|------|
| `review.md` | Step 6.5 | `review` | critical/high 发现交叉验证，检测遗漏 |
| `debug.md` | Step 5.5 | `explore` | debug agent 前广域证据收集 |
| `verify.md` | V0.8 | `analyze` | 结构验证前反模式/完整性预扫描 |
| `plan.md` | P1 Step 5b | `explore` | 与并行探索同步，收集模式/依赖/冲突 |
| `test-gen.md` | Step 3.5 | `analyze` | 测试计划前边界条件和边缘场景分析 |
| `execute.md` | E2.5 Check 4 | `analyze` | wave 后语义验证（循环依赖/死代码/破坏性变更） |
| `milestone-audit.md` | Step 5.5 | `analyze` | 跨阶段导入一致性和类型匹配检查 |

### 辅助调用设计原则

1. **补充而非替代** — CLI 结果合并到现有数据结构，不改变主流程逻辑
2. **透明降级** — `IF no CLI tools enabled: skip` 守卫确保无 CLI 时正常工作
3. **异步不阻塞** — `run_in_background: true`，结果通过 callback 回收
4. **角色路由** — 使用 `--role` 而非 `--to`，由配置决定实际工具

---

## 使用示例

### 基本 delegate 调用

```bash
# 角色路由（推荐）
maestro delegate "分析认证模块漏洞" --role analyze --mode analysis

# 显式工具（向后兼容）
maestro delegate "分析认证模块漏洞" --to gemini --mode analysis

# --role 优先级低于 --to
maestro delegate "..." --to codex --role analyze   # 使用 codex
```

### 项目级配置覆盖

```bash
# 在项目中创建工作空间配置
mkdir -p .maestro
cat > .maestro/cli-tools.json << 'EOF'
{
  "version": "1.1.0",
  "tools": {
    "gemini": { "enabled": false }
  },
  "roles": {
    "implement": { "fallbackChain": ["codex", "claude"] }
  }
}
EOF
# 该项目中 gemini 被禁用，implement 角色不会路由到 gemini
```

### 自动初始化

`maestro install` 会自动检测已安装的 CLI 工具并创建 `~/.maestro/cli-tools.json`：

```bash
maestro install --force
# 输出: Initialized cli-tools.json (auto-detected CLI availability)
```

检测逻辑：对每个工具执行 `<tool> --version`，可达则 `enabled: true`。

---

## 解析优先级汇总

```
delegate 命令参数解析:
  --to <tool>   → 最高优先级，直接使用指定工具
  --role <role> → 通过 cli-tools.json 角色映射解析
  无参数        → 第一个 enabled 工具

角色映射解析:
  项目 cli-tools.json roles[role] → 全局 cli-tools.json roles[role] → DEFAULT_ROLE_MAPPINGS[role]

工具 enabled 状态:
  项目 cli-tools.json tools[name] → 全局 cli-tools.json tools[name]

settingsFile 传递:
  ToolEntry.settingsFile → CliRunOptions.settingsFile → AgentConfig.settingsFile → adapter --settings 参数
```
