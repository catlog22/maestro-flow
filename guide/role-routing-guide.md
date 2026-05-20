---
title: "角色路由与工具配置指南"
---

基于角色的 CLI 工具路由配置，将工作类型（分析、审查、实现等）与具体 CLI 工具解耦。

---

## 概览

Maestro 通过 `--role` 替代 `--to` 进行工具选择：

- **工作类型与工具解耦** — 命令只声明"需要什么能力"，不绑定具体工具
- **配置驱动路由** — `cli-tools.json` 定义 fallback chain，工具增删无需改命令
- **工作空间覆盖** — 项目级配置覆盖全局配置

```
命令 --role analyze → cli-tools.json → fallbackChain: [codex, gemini, claude] → 第一个 enabled 工具
```

---

## 配置文件

### 路径优先级

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `{project}/.maestro/cli-tools.json` | 项目级覆盖 |
| 2 | `~/.maestro/cli-tools.json` | 全局配置 |
| 3 | 内置默认值 | `DEFAULT_ROLE_MAPPINGS` |

<details>
<summary>配置结构示例</summary>

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

</details>

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
3. fallbackChain 中第一个 enabled 工具
4. 兜底: 任意第一个 enabled 工具
```

---

## Domain Tags

用于 `maestro execute` 按文件领域自动分配执行工具：

| Tag | 匹配场景 |
|-----|----------|
| `frontend` | .tsx/.jsx/.vue/.css、UI 组件 |
| `backend` | .go/.rs/.java/.py、API、数据库 |
| `fullstack` | 通用，兜底匹配 |
| `devops` | CI/CD、容器、基础设施 |
| `data` | 数据管线、ETL、分析 |
| `mobile` | iOS/Android 原生 |
| `infra` | 云资源、IaC |

---

## 工具别名与 settingsFile

<details>
<summary>注册工具别名示例</summary>

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

- `baseTool` — 底层 CLI（决定用哪个 adapter）
- `settingsFile` — 传递给 CLI 的配置文件路径（当前仅 Claude 支持 `--settings`）

</details>

### TUI 管理

```bash
maestro delegate-config        # 启动 TUI
maestro dc                     # 短别名
maestro delegate-config show          # 文本输出
maestro delegate-config show --json   # JSON 格式
maestro delegate-config roles         # 查看角色映射
```

TUI 功能：**[1] Tools** / **[2] Roles** / **[3] Register**（注册别名）/ **[4] Ref** / **[5] Config**

---

## Workflow 中的 CLI 辅助调用

以下 workflow 在关键环节增加了可选的 CLI delegate 辅助分析。全部 `run_in_background: true` 异步执行，无 CLI 工具时自动跳过。

| Workflow | 环节 | 角色 | 功能 |
|----------|------|------|------|
| `review.md` | Step 6.5 | `review` | critical/high 交叉验证 |
| `debug.md` | Step 5.5 | `explore` | 广域证据收集 |
| `verify.md` | V0.8 | `analyze` | 反模式/完整性预扫描 |
| `plan.md` | P1 Step 5b | `explore` | 收集模式/依赖/冲突 |
| `test-gen.md` | Step 3.5 | `analyze` | 边界条件和边缘场景分析 |
| `execute.md` | E2.5 | `analyze` | wave 后语义验证 |
| `milestone-audit.md` | Step 5.5 | `analyze` | 跨阶段导入一致性检查 |

辅助调用原则：**补充而非替代** / **透明降级** / **异步不阻塞** / **角色路由**

---

## 使用示例

```bash
# 角色路由（推荐）
maestro delegate "分析认证模块漏洞" --role analyze --mode analysis

# 显式工具（向后兼容）
maestro delegate "分析认证模块漏洞" --to gemini --mode analysis

# --role 优先级低于 --to
maestro delegate "..." --to codex --role analyze   # 使用 codex
```

<details>
<summary>项目级配置覆盖示例</summary>

```bash
mkdir -p .maestro
cat > .maestro/cli-tools.json << 'EOF'
{
  "version": "1.1.0",
  "tools": { "gemini": { "enabled": false } },
  "roles": { "implement": { "fallbackChain": ["codex", "claude"] } }
}
EOF
```

</details>

### 自动初始化

```bash
maestro install --force
# 输出: Initialized cli-tools.json (auto-detected CLI availability)
```

---

## 解析优先级汇总

```
delegate 命令参数解析:
  --to <tool>   → 最高优先级
  --role <role> → cli-tools.json 角色映射
  无参数        → 第一个 enabled 工具

角色映射: 项目 config → 全局 config → DEFAULT_ROLE_MAPPINGS
工具状态: 项目 config → 全局 config
settingsFile: ToolEntry → CliRunOptions → AgentConfig → adapter --settings
```
