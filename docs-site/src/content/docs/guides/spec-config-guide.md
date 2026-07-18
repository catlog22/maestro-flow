---
title: "📋 规范系统配置指南"
icon: "📋"
---

Maestro 规范系统配置参考，包含 Spec 系统、注入配置和分析配置。

---

## Spec 系统

### 作用域

| 作用域 | 目录 | 自动初始化 |
|-------|------|-----------|
| `project`（默认） | `.workflow/specs/` | 是 |
| `global` | `~/.maestro/specs/` | 是 |
| `team` | `.workflow/collab/specs/` | 否 |
| `personal` | `.workflow/collab/specs/{uid}/` | 否 |

**加载优先级**（由低到高）：global → project → team → personal。后层追加，不覆盖。

### 文件与 Category 映射

| 文件 | Category | 隐式角色 | 用途 |
|------|----------|---------|------|
| `coding-conventions.md` | coding | implement | 命名、导入、格式、模式 |
| `architecture-constraints.md` | arch | plan | 模块结构、层边界 |
| `review-standards.md` | review | review | 质量规则、检查清单 |
| `debug-notes.md` | debug | analyze | 调试技巧、根因记录 |
| `test-conventions.md` | test | test | 测试框架、覆盖率要求 |
| `learnings.md` | learning | implement | Bug、陷阱、经验教训 |
| `ui-conventions.md` | ui | implement | UI/UX 约定、设计令牌 |

### 条目格式

所有条目使用 `<spec-entry>` 闭合标签，**category** 为必需属性：

```markdown
<spec-entry category="coding" keywords="auth,token,rotation" date="2026-04-21">
### Token rotation needs email carried through refresh flow
Revoked column must be set rather than deleting tokens.
</spec-entry>
```

| 属性 | 必需 | 说明 |
|------|------|------|
| `category` | 是 | 单值：coding, arch, review, debug, test, learning, ui |
| `keywords` | 是 | 逗号分隔，小写，跨 category 发现 |
| `date` | 是 | `YYYY-MM-DD` |
| `source` | 否 | 来源（manual / agent / phase） |
| `ref` | 否 | 指向 knowhow 详情文档的路径 |

### Tool 发现

Tool 是标记了 `tool: true` YAML 头的 knowhow 文档。`spec load --category` 自动扫描 `knowhow/` 中匹配 category + tool 的条目，追加摘要。

```markdown
---
title: Payment Gateway Idempotency Verification
type: recipe
category: coding
keywords: [payment, gateway, idempotency, testing]
tool: true
---

## Steps
1. Generate idempotency key (UUID v4)
2. Submit charge request with key
3. Retry same request with same key -- assert identical response
4. Submit different amount with same key -- assert 409 conflict
```

---

## Spec 注入配置

### 注入流程

```
Session Start / Agent Spawn
        │
        ▼
loadSpecInjectionConfig()   ← .workflow/config.json
        │
        ▼
按 Agent 类型加载对应 Category
        │
        ▼
keyword 过滤 + 额外文档关联
        │
        ▼
注入到 additionalContext
```

### 默认 Agent → Category 映射

| Agent Type | 默认 Categories |
|------------|-----------------|
| `code-developer` | coding, learning, ui |
| `tdd-developer` | coding, test |
| `workflow-executor` | coding |
| `universal-executor` | coding, ui |
| `test-fix-agent` | coding, test |
| `cli-lite-planning-agent` | arch |
| `action-planning-agent` | arch |
| `workflow-planner` | arch |
| `workflow-reviewer` | review |
| `debug-explore-agent` | debug |
| `workflow-debugger` | debug |
| `general` (session 启动) | coding, learning |

### 配置 Schema

配置存储在 `.workflow/config.json` 的 `specInjection` 键中：

```json
{
  "specInjection": {
    "enabled": true,
    "globalKeywords": ["auth", "security"],
    "excludeKeywords": ["deprecated"],
    "agentCategoryMap": {
      "code-developer": ["coding", "learning", "ui"],
      "workflow-planner": ["arch"]
    },
    "extraDocs": {
      "coding": ["specs/coding-extra.md"],
      "arch": ["specs/arch-patterns.md"]
    },
    "alwaysInject": ["specs/critical-rules.md"]
  }
}
```

### CLI 配置

```bash
# 查看当前配置
maestro config get specInjection

# 设置全局关键词
maestro config set specInjection.globalKeywords "auth,security"

# 排除关键词
maestro config set specInjection.excludeKeywords "deprecated"

# 为 agent 添加额外 category
maestro config set specInjection.agentCategoryMap.code-developer '["coding", "learning", "ui"]'

# 添加额外文档
maestro config set specInjection.extraDocs.coding '["specs/coding-extra.md"]'
```

---

## Spec 分析配置

### 分析功能

Spec 分析系统记录每次 spec 注入调用、关键词匹配、hook 执行和 CLI 端点使用，提供命中率统计和关键词热力分布。

### 启用分析

```json
{
  "specAnalytics": {
    "enabled": true,
    "trackKeywords": true,
    "trackHookExecution": true,
    "retentionDays": 30
  }
}
```

### CLI 命令

```bash
# 查看分析统计
maestro spec analytics

# 查看关键词热力分布
maestro spec analytics --keywords

# 查看命中率
maestro spec analytics --hit-rate

# 清除分析数据
maestro spec analytics --clear
```

---

## CLI 参考

```bash
# Spec 基础操作
maestro spec init [--scope <scope>] [--uid <uid>]
maestro spec load [--category <cat>] [--keyword <kw>] [--scope <scope>] [--json]
maestro spec add <category> "<title>" "<content>" [--keywords kw1,kw2] [--ref <path>]
maestro spec list [--scope <scope>] [--uid <uid>]
maestro spec status [--scope <scope>] [--uid <uid>]

# Tool 发现
/spec add "<description>"
/maestro-ralph "<name>" | --category <cat>

# 分析
maestro spec analytics [--keywords] [--hit-rate] [--clear]
```

---

## 文件结构

```
~/.maestro/specs/                    # scope: global
    coding-conventions.md

.workflow/
├── specs/                           # scope: project
│   ├── coding-conventions.md        # category: coding
│   ├── architecture-constraints.md  # category: arch
│   ├── review-standards.md          # category: review
│   ├── debug-notes.md               # category: debug
│   ├── test-conventions.md          # category: test
│   └── learnings.md                 # category: learning
├── knowhow/                         # 广义知识
│   └── KNW-/TIP-/TPL-/RCP-/REF-/DCS-/AST-/BLP-/DOC-*.md
├── collab/specs/                    # scope: team
│   └── {uid}/                       # scope: personal
└── wiki-index.json                  # 持久化索引（自动生成）
```
