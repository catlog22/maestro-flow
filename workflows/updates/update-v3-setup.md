<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Setup: v3.0 — Knowledge System Configuration

v2→v3 迁移后的环境配置。验证并引导用户完成知识系统、CodeGraph、Hook 的安装和配置。

## Step 1: 统一搜索验证

```
1. 运行：maestro search --help 2>&1 | head -1
2. IF 可用 → 显示 "统一搜索：就绪（maestro search）"
3. IF 不可用 → 警告 "运行 maestro install --force 更新 CLI"
```

**迁移提示**：
```
以下命令已废弃，请使用 maestro search 替代：
  - spec search    → maestro search --type spec
  - knowhow search → maestro search --type knowhow
  - wiki search    → maestro search
```

## Step 2: MaestroGraph 初始化

```
1. 检测：maestro kg health
2. IF 已初始化 → 显示 "MaestroGraph：已就绪"
3. IF 未初始化：
     Bash: maestro kg sync
     显示 "MaestroGraph 索引已初始化"

注：代码分析引擎 (tree-sitter) 已内置，无需安装额外依赖。
```

## Step 3: Hook 升级

```
1. 运行：maestro hooks status 2>&1
2. IF standard 级别已安装 BUT 缺少 kg-sync 或 keyword-spec-injector：
     AskUserQuestion: "Hooks 需升级以包含 KG hooks，是否重新安装？"
     Options: [重新安装 / 跳过]
     IF 重新安装：
       Bash: maestro hooks install --level standard
       显示 "Hooks 已升级，包含 kg-sync + keyword-spec-injector"

3. IF 未安装任何 hooks：
     AskUserQuestion: "是否安装 standard 级别 Hooks？（推荐）"
     Options: [安装 / 跳过]
     IF 安装：
       Bash: maestro hooks install --level standard
```

### Hook 变更说明

| Hook | 事件 | 作用 |
|------|------|------|
| `kg-sync` | UserPromptSubmit | 用户输入时静默同步知识图谱（30 秒冷却） |
| `keyword-spec-injector` | UserPromptSubmit | 单次组合规范、Wiki、领域与 KG 代码上下文 |

`keyword-spec-injector` 现在统一提取 camelCase、snake_case、反引号符号和文件路径，并在同一个 budget 中组合规范、Wiki、领域与 CodeGraph 调用关系。

## Step 4: 验证

```
1. 验证统一搜索：maestro search "test" --limit 1
2. 验证 KG（如已安装）：maestro kg stats
3. 验证 Hooks：maestro hooks status
4. 显示最终状态：
     Knowledge System:
       Search:    maestro search（统一，BM25）
       CodeGraph: {已安装 | 未安装（可选）}
       KG Hooks:  {活跃 | 需重新安装}
```
