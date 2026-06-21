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

| 命令 | Guide 文档 | 状态 |
|------|-----------|------|
| maestro-analyze/plan/execute | `guide/command-usage-guide.md` (主干管线) | planned |
| maestro-init/roadmap/blueprint | `guide/quick-start-guide.md` | planned |
| maestro-ralph | `guide/maestro-ralph-guide.md` | planned |
| maestro (协调器) | `guide/maestro-coordinator-guide.md` | planned |
| manage-* | `guide/command-usage-guide.md` (管理) | planned |
| quality-* | `guide/command-usage-guide.md` (质量) | planned |
| delegate | `guide/delegate-async-guide.md` | planned |
| overlay/amend | `guide/overlay-guide.md` | planned |

> **注意**: Guide 文档目前尚未创建（标记为 planned），命令详情回退到 catalog 描述和 source 文件。

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
| execute 完成 | `/quality-review` | 执行完成，进入质量管线 |
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

### Meta (6)
- **workflow-skill-designer** — 设计 orchestrator+phases 工作流 skill
- **skill-iter-tune** — 迭代 execute-evaluate-improve 调优
- **prompt-generator** — 生成或转换 prompt 文件
- **skill-generator** — 创建新 skill（sequential/autonomous 模式）
- **skill-simplify** — SKILL.md 简化与功能完整性验证
- **skill-tuning** — 通用 skill 诊断和优化

### Team (25)
- **team-coordinate** — 通用团队协调，动态生成 role-specs
- **team-executor** — 团队执行，恢复会话
- **team-lifecycle-v4** — 完整生命周期流水线
- **team-quality-assurance** — QA 质量保障
- **team-review** — 多维度代码审查
- **team-tech-debt** — 技术债务识别和清理
- **team-testing** — 渐进式测试覆盖
- **team-adversarial-swarm** — ACO 群智能 + 对抗决策门
- **team-arch-opt** — 架构优化
- **team-brainstorm** — 头脑风暴
- **team-designer** — 团队 skill 生成器（v4 架构）
- **team-frontend** — 前端开发（内置 ui-ux-pro-max）
- **team-frontend-debug** — 前端调试（Chrome DevTools MCP）
- **team-interactive-craft** — 交互组件制作（零依赖）
- **team-issue** — Issue 解决
- **team-motion-design** — 动效设计
- **team-perf-opt** — 性能优化
- **team-planex** — Plan-and-Execute 管线
- **team-roadmap-dev** — 路线图驱动开发
- **team-swarm** — 群智能（ACO + Python 控制器）
- **team-ui-polish** — UI 打磨（Impeccable 标准）
- **team-uidesign** — UI 设计（Token→审计→实现）
- **team-ultra-analyze** — 深度协作分析
- **team-ux-improve** — UX 改进
- **team-visual-a11y** — 视觉无障碍 QA

### Knowledge (1)
- **codify-to-knowhow** — Manifest 驱动的知识资产生成

### Quality (2)
- **insight-challenge** — 对抗性审查
- **delegation-check** — 委派提示词分离违规检查

### Scholar (10)
- **scholar-writing** — 端到端学术论文写作
- **scholar-review** — 学术论文审查（自审 + 回复）
- **scholar-rebuttal-pro** — 审稿回复（证据策略）
- **scholar-ideation** — 研究构思
- **scholar-experiment** — 实验结果分析
- **scholar-citation-verify** — 四层引用验证
- **scholar-anti-ai-writing** — 去除 AI 写作痕迹
- **scholar-latex-organizer** — LaTeX 模板整理
- **scholar-publish** — 会议发表准备
- **scholar-thesis-docx** — 学位论文 Word 文档
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
