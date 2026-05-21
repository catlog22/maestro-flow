# Phase 2: Search & Present

查询 catalog.json 并格式化呈现结果。覆盖 Mode 1/2/3/6/7。

## Objective

- 根据 Phase 1 输出的 mode 和 query 搜索 catalog
- 读取 source 文件获取详情（Mode 2）
- 检测项目状态提供智能推荐（Mode 3）
- 格式化呈现搜索结果

## Execution

### Mode 1: Command Search

```
1. Read catalog.json
2. Search commands[] + cli_commands[]:
   - Filter by: name contains query (case-insensitive)
   - OR: description contains query
   - OR: category matches query
3. Sort by relevance (exact name match > starts with > contains)
4. Present top 5 results:
```

**输出格式**:

```markdown
找到 {N} 个匹配命令：

**/{command-name}** — {description}
  分类: {category} | 详细: {source file exists? → "查看详情 →" : "catalog only"}

**/{command-name-2}** — {description}
  ...
```

### Mode 2: Command Documentation

```
1. Locate command in catalog.json commands[] by name
2. Read the source file (e.g., "../../commands/maestro-analyze.md")
3. Extract key sections:
   - <purpose> content
   - argument-hint
   - usage examples from <context>
4. If a guide file references this command, read relevant section
5. Present structured documentation:
```

**输出格式**:

```markdown
## /{command-name}

**用途**: {description}

**参数**: {argument-hint}

**用法**:
{extracted examples or usage patterns}

**分类**: {category}

**相关 Guide**: {guide file name if applicable}
```

**Guide 映射**:

| 命令 | Guide 文档 |
|------|-----------|
| maestro-analyze/plan/execute/verify | `guide/command-usage-guide.md` (主干管线) |
| maestro-init/roadmap/blueprint | `guide/quick-start-guide.md` |
| maestro-ralph | `guide/maestro-ralph-guide.md` |
| maestro (协调器) | `guide/maestro-coordinator-guide.md` |
| manage-* | `guide/command-usage-guide.md` (管理) |
| quality-* | `guide/command-usage-guide.md` (质量) |
| delegate | `guide/delegate-async-guide.md` |
| overlay/amend | `guide/overlay-guide.md` |

### Mode 3: Smart Recommendations

```
1. Detect project state from Phase 1
2. Match state to workflow template from catalog.workflows
3. Present recommendations with WHY:
```

**状态 → 推荐映射**:

| 当前状态 | 推荐命令 | 原因 |
|---------|---------|------|
| 无 .workflow/ | `/maestro-init` | 项目未初始化，需要先创建工作区 |
| init 完成，无上游 context | `/maestro-brainstorm` 或 `/maestro-analyze "topic"` | 先探索再规划；brainstorm 用于发散，analyze 宏观用于代码库分析 |
| analyze 完成，scope_verdict=large | `/maestro-roadmap --from analyze:ANL-xxx` | 大范围需求，需要 Milestone > Phase 分解 |
| analyze 完成，scope_verdict=medium/small | `/maestro-plan --from analyze:ANL-xxx` | 跳过 roadmap，直接规划（Path C） |
| roadmap 完成，phase=pending | `/maestro-analyze 1` | 微观分析：Phase 级深入探索 |
| analyze (微观) 完成 | `/maestro-plan 1` | Phase 级规划 |
| plan 完成 | `/maestro-execute` | 规划完成，开始执行 |
| execute 完成 | `/maestro-verify` | 执行完成，验证成果 |
| verify 有 gaps | `/maestro-analyze --gaps` | 发现差距，重新分析 |
| verify 通过 | `/quality-review` | 进入质量管线 |
| quality 全通过 | `/maestro-milestone-audit` | 准备里程碑审计 |
| 所有 Phase 完成 | `/maestro-milestone-complete` | 里程碑可以关闭 |

### Mode 6: Skill & Agent Browsing

**Skills**:
```
1. Read catalog.json skills[]
2. If category specified: filter by category
3. Group by category: meta / team / knowledge
4. Present:
```

```markdown
## Skills ({total} 个)

### Meta (2)
- **workflow-skill-designer** — 设计 orchestrator+phases 工作流 skill
- **skill-iter-tune** — 迭代 execute-evaluate-improve 调优

### Team (6)
- **team-coordinate** — 通用团队协调，动态生成 role-specs
- **team-executor** — 团队执行，恢复会话
- **team-lifecycle-v4** — 8 角色完整生命周期
- **team-quality-assurance** — QA 质量保障流水线
- **team-review** — 多维度代码审查
- **team-tech-debt** — 技术债务识别和清理
- **team-testing** — 测试规划和执行

### Knowledge (1)
- **codify-to-knowhow** — Manifest 驱动的知识资产生成
```

**Agents**:
```
1. Read catalog.json agents[]
2. Group by category: workflow / team / planning / cli / ui
3. Present with category headers
```

### Mode 7: CLI Command Reference

```
1. Read catalog.json cli_commands[]
2. Group by category: setup / dashboard / execution / knowledge / config / team / visualization
3. Present table with command, alias, description:
```

```markdown
## CLI 终端命令 (21 个)

### 安装与更新 (setup)
| 命令 | 别名 | 用途 |
|------|------|------|
| `maestro install` | — | 安装 Maestro 资源 |
| `maestro uninstall` | — | 卸载已安装资源 |
| `maestro update` | — | 检查/安装最新版本 |
| `maestro launcher` | — | Claude Code 启动器 |

### 任务执行 (execution)
| 命令 | 别名 | 用途 |
|------|------|------|
| `maestro delegate` | — | 委派任务给 AI 智能体 |
| `maestro coordinate` | `coord` | 图工作流协调器 |
| `maestro cli` | — | 运行 CLI 智能体工具 |
| `maestro run` | — | 执行指定工作流 |
| `maestro serve` | — | 启动工作流服务器 |
...
```

## Error Handling

| 场景 | 处理 |
|------|------|
| 搜索无结果 | 模糊匹配最近命令，建议使用 `/maestro-help` 查看全部 |
| Source 文件不存在 | 仅提供 catalog 描述，标注 "详细信息不可用" |
| Catalog 读取失败 | 回退到 Glob 扫描 .claude/commands/*.md |

## Output

格式化的搜索/文档/推荐结果，直接展示给用户。
