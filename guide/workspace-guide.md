---
title: "跨工作空间知识共享指南"
---

Maestro 支持将多个项目的知识（Spec、Knowhow、Domain、Codebase）关联到当前工作空间，实现跨项目的知识检索、Spec 注入和 Wiki 聚合。所有共享为**只读**——当前工作空间仅读取关联项目的内容，不会写入。

---

## 快速开始

```bash
# 关联另一个 Maestro 项目
maestro workspace link ../shared-lib --name shared --share spec,knowhow,domain

# 查看关联状态
maestro workspace list

# 搜索关联工作空间的知识
maestro search "error handling"

# 仅搜索指定工作空间
maestro search "auth pattern" --workspace shared

# 解除关联
maestro workspace unlink shared
```

---

## 核心概念

### 配置存储

工作空间关联信息存储在 `.workflow/config.json` 的 `workspaces` 字段：

```json
{
  "workspaces": {
    "linked": [
      {
        "name": "shared-lib",
        "path": "../shared-lib",
        "share": ["spec", "knowhow", "domain"]
      },
      {
        "name": "backend-api",
        "path": "D:/projects/backend-api",
        "share": ["spec", "knowhow", "codebase", "domain"]
      }
    ]
  }
}
```

### 共享类型

| 类型 | 来源目录 | 用途 |
|------|---------|------|
| `spec` | `.workflow/specs/*.md` | 编码约束、架构规范 |
| `knowhow` | `.workflow/knowhow/**/*.md` | 经验文档、模板、决策记录 |
| `domain` | `.workflow/domain/glossary.json` | 领域术语表 |
| `codebase` | `.workflow/codebase/` | 代码知识图谱、模块索引 |

### ID 前缀与作用域

关联工作空间的条目使用 `ws:{name}:` 前缀防止 ID 碰撞，scope 统一为 `linked`：

| 本地条目 ID | 关联条目 ID |
|------------|------------|
| `spec:project:coding-conventions` | `ws:shared:spec:coding-conventions` |
| `knowhow-auth-pattern` | `ws:shared:knowhow-auth-pattern` |
| `domain-bounded-context` | `ws:shared:domain-bounded-context` |

---

## CLI 命令参考

### `maestro workspace link <path>`

关联一个 Maestro 工作空间。

```bash
maestro workspace link <path> [--name <name>] [--share <types>]
```

| 选项 | 默认值 | 说明 |
|------|-------|------|
| `--name <name>` | 目录名 | 工作空间标识（字母数字、连字符、下划线） |
| `--share <types>` | `spec,knowhow,domain` | 逗号分隔的共享类型 |

**验证规则**：
- 目标路径必须包含 `.workflow/` 目录
- 不允许自引用（关联自身）
- 名称在已关联列表中必须唯一
- share 类型必须是 `spec`、`knowhow`、`domain`、`codebase` 之一

<details>
<summary>示例</summary>

```bash
# 关联本地项目（相对路径）
maestro workspace link ../shared-lib --name shared --share spec,knowhow,domain

# 关联绝对路径，包含 codebase
maestro workspace link D:/projects/core-api --name core --share spec,knowhow,domain,codebase

# 自动以目录名作为名称
maestro workspace link ../common-utils
```

</details>

### `maestro workspace unlink <name>`

解除工作空间关联。

```bash
maestro workspace unlink shared
```

### `maestro workspace list`

列出所有关联工作空间及有效性状态。

```bash
maestro workspace list [--json]
```

输出示例：

```
Linked workspaces (2):

  ✓  shared-lib
       Path:  ../shared-lib → D:/projects/shared-lib
       Share: spec, knowhow, domain
  ✗ missing  old-project
       Path:  ../old-project → D:/projects/old-project
       Share: spec
```

### `maestro workspace status`

显示各关联工作空间的知识条目统计。

```bash
maestro workspace status [--json]
```

输出示例：

```
Workspace status (1):

  ✓  shared-lib  (D:/projects/shared-lib)
       Entries: spec: 3, knowhow: 12, domain: 8
```

---

## 知识聚合机制

### 搜索集成

`maestro search` 自动包含关联工作空间的知识条目。结果中标记来源：

```bash
$ maestro search "error handling"
Search: "error handling" (3 results)
  [spec] coding [ws:shared]  ws:shared:spec:coding-conventions-001  Error Handling  (24.99)
  [knowhow] recipe  knowhow-error-patterns  Error Pattern Library  (18.20)
  [domain] domain [ws:shared]  ws:shared:domain-error-code  Error Code  (15.33)
```

- `[ws:shared]` 标签标识来自关联工作空间的条目
- 使用 `--workspace <name>` 过滤仅显示指定工作空间的结果
- `--json` 输出包含 `workspace` 字段

### Wiki 聚合

`maestro wiki list` 同样聚合关联工作空间的条目：

```bash
# 列出所有 domain 条目（含关联工作空间）
maestro wiki list --type domain

# 搜索关联知识
maestro wiki search "auth pattern"
```

### Spec 注入

关联工作空间的 Spec 自动参与两个流程：

**1. CLI 加载**

```bash
$ maestro spec load --category coding
# Project Specs (5 loaded)

# Linked Specs (shared-lib)
### Error Handling Convention
> coding · error-handling, shared · 2026-06-15
All shared errors must extend BaseError class...

---

# Baseline Specs
### Local Coding Convention
> coding · naming · 2026-06-15
...
```

**2. Agent 自动注入**

Spec Injector Hook 在 agent 启动时自动加载关联 spec：

```
agent 启动
  → evaluateSpecInjection()
    → 加载 workspace config
    → 过滤 share.includes('spec') 的关联
    → 传递 linkedWorkspaces 给 loadSpecs()
      → 按层级合并：global → linked → baseline → team → personal
```

### 层级优先级

Spec 加载的层级优先级（由低到高）：

| 优先级 | 层 | 来源 |
|--------|-----|------|
| 1（最低） | Global | `~/.maestro/specs/` |
| 2 | Linked | 关联工作空间 `.workflow/specs/` |
| 3 | Baseline | 当前项目 `.workflow/specs/` |
| 4 | Team | `.workflow/collab/specs/` |
| 5（最高） | Personal | `.workflow/collab/specs/{uid}/` |

本地项目的规范始终优先于关联项目，关联项目优先于全局默认。

---

## 设计要点

### 只读共享

当前工作空间**永远不会**写入关联工作空间。所有操作（搜索、索引、注入）都是只读扫描。

### 不递归解析

如果工作空间 A 链接了 B，B 又链接了 C，A 只能看到 B 的知识，看不到 C。这避免了无限循环，保持行为可预测。

### 优雅降级

关联路径不存在时：
- **搜索/索引**：静默跳过（`MAESTRO_DEBUG=1` 时输出警告）
- **`workspace list`**：标记为 `✗ missing`
- **`workspace status`**：显示为 `valid: false`

### 缓存失效

WikiIndexer 监控关联工作空间目录的 mtime。当关联项目的 spec/knowhow/domain 文件发生变更时，下次搜索自动重建索引。

---

## 使用场景

### 场景 1：共享库规范

团队维护一个公共库 `shared-lib`，其 coding spec 定义了 API 风格和错误处理规范。所有使用该库的项目关联它：

```bash
maestro workspace link ../shared-lib --name shared --share spec
```

效果：agent 编写代码时自动获得共享库的编码规范。

### 场景 2：领域术语统一

多个微服务项目共享同一份 domain glossary：

```bash
maestro workspace link ../domain-model --name domain --share domain
```

效果：`maestro search` 能检索到统一的领域术语定义。

### 场景 3：跨项目知识复用

前端项目关联后端 API 项目，获取 API 设计的 knowhow 文档：

```bash
maestro workspace link ../backend-api --name api --share knowhow,spec
```

效果：搜索 "auth" 时能发现后端的 JWT 认证方案文档。

### 场景 4：代码结构参考

关联基础设施项目的 codebase 知识图谱：

```bash
maestro workspace link ../infra --name infra --share codebase
```

效果：`maestro wiki list --type knowhow` 能看到基础设施的模块结构。

---

## 常见问题

**Q: 关联路径支持相对路径吗？**

支持。相对路径基于当前工作目录解析。推荐使用相对路径（如 `../shared-lib`），方便团队成员在不同机器上使用。

**Q: 关联的工作空间需要是 Git 仓库吗？**

不需要。唯一要求是目标路径包含 `.workflow/` 目录（即 Maestro 初始化过的项目）。

**Q: 关联数量有限制吗？**

没有硬性限制。但每个关联工作空间都会增加索引构建时间。建议仅关联真正需要共享知识的项目。

**Q: 如何查看关联知识的具体内容？**

```bash
# 搜索并查看
maestro search "topic" --workspace shared-lib --json

# 或直接查看条目
maestro wiki get ws:shared-lib:spec:coding-conventions
```

**Q: 修改关联项目的文件后，搜索结果会自动更新吗？**

是的。WikiIndexer 通过 mtime 检测文件变化，会自动重建索引。无需手动刷新。
