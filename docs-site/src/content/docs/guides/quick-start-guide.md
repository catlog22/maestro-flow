---
title: "快速入门指南"
icon: "🚀"
---

10 分钟了解 Maestro Flow 的核心功能和使用方法。

---

## 1. 安装

```bash
# 交互安装（推荐首次使用）
maestro install

# 一键全量安装
maestro install --force

# 只注册 MCP Server
maestro install mcp

# 安装 Hook 自动化（推荐 standard 级别）
maestro hooks install --level standard
```

安装后即可在 Claude Code 中使用 `/maestro-*` 系列斜杠命令和 `maestro` 终端命令。

### 可选技能包（按需安装）

`maestro install` 交互界面中，以下 3 个技能包默认不选中，按需勾选。每个技能在文档站都有单独介绍页（Team / Scholar / Meta 分类下可查），完整说明见[安装指南](/guides/install)。

**skills-extra-team（16 个团队协作技能）**：team-arch-opt、team-brainstorm、team-designer、team-frontend、team-frontend-debug、team-interactive-craft、team-issue、team-motion-design、team-perf-opt、team-planex、team-roadmap-dev、team-ui-polish、team-uidesign、team-ultra-analyze、team-ux-improve、team-visual-a11y

**skills-scholar（10 个学术技能）**：scholar-ideation、scholar-writing、scholar-experiment、scholar-citation-verify、scholar-anti-ai-writing、scholar-latex-organizer、scholar-review、scholar-rebuttal-pro、scholar-thesis-docx、scholar-publish

**skills-meta（5 个元技能）**：skill-generator、skill-simplify、skill-tuning、prompt-generator、delegation-check

```bash
# 安装组包后，逐个启用/禁用单个技能
maestro install toggle --type skill --list
maestro install toggle --type skill --enable scholar-writing
```

> 9 个内置团队技能（team-coordinate、team-executor、team-lifecycle-v4、team-quality-assurance、team-review、team-swarm、team-tech-debt、team-testing、team-adversarial-swarm）随核心组件自动安装，无需单独选择。

---

## 2. 项目初始化

### 最简路径

```bash
/maestro-init                          # 初始化 .workflow/ 目录
/maestro-ralph --roadmap "项目名称和目标" -y  # 生成路线图
```

### 从头脑风暴开始

```bash
/maestro-ralph --engine swarm --script wf-brainstorm "在线教育平台"  # 多角色头脑风暴
/maestro-init --from brainstorm:ANL-xxx                           # 基于头脑风暴初始化
/maestro-ralph --roadmap "创建路线图" -y
```

### 完整规范蓝图（大型项目）

```bash
/maestro-init
/maestro "生成规范蓝图"                   # 6 阶段规范蓝图（产品简报 + PRD + 架构 + 史诗）
```

---

## 3. Phase 管线

项目的核心推进流程，每个 Phase 走 `分析 → 规划 → 执行 → 验证` 生命周期：

```bash
# 全量模式——覆盖当前里程碑所有 Phase
/maestro-ralph --engine swarm --script wf-analyze  # 分析
/maestro-next                                      # 规划
/maestro-ralph continue                            # 执行
# 注：/maestro-verify 已于 v0.5.51 退役，验证集成进 maestro-ralph 决策门

# 逐 Phase 模式（micro 层：Phase 级深度分析）
/maestro-ralph --engine swarm --script wf-analyze 1  # 只分析 Phase 1（6 维度评分）
/maestro-next 1                                      # 只规划 Phase 1
/maestro-ralph continue 1                            # 只执行 Phase 1

# 宏观探索模式（macro 层：roadmap 之前使用）
/maestro "实现多租户架构"                            # 需求影响面探索 → scope_verdict 路由
```

### 一键全自动

```bash
/maestro -y "实现用户认证系统"
# 自动执行完整生命周期
```

### 免初始化模式（临时任务）

```bash
/maestro "实现 JWT 认证"                 # scope=standalone，自动创建 state.json
/maestro-next --dir scratch/20260420-analyze-jwt-...
/maestro-ralph continue --dir scratch/20260420-plan-jwt-...
```

---

## 4. 质量管线

执行后运行质量验证，三轨测试互补：

```bash
# 统一自动测试（智能路由：spec/gap/code）
/maestro-ralph --engine swarm 1

# 安全审计 / 测试
/security-audit 1

# 代码审查
/maestro-ralph --engine swarm --script wf-review 1
```

### 测试失败修复循环

```bash
/maestro-odyssey --mode debug --from-uat 1      # 诊断失败
/maestro-next 1 --gaps                  # 生成修复计划
/maestro-ralph continue 1              # 执行修复
/maestro-ralph --engine swarm 1 --re-run  # 重跑失败场景
```

---

## 5. Issue 闭环

独立于 Phase 管线的问题追踪系统，支持全自动闭环：

```bash
# 发现问题
/maestro-manage issue discover by-prompt "检查 API 错误处理"

# 创建 Issue
/maestro-manage issue create --title "内存泄漏" --severity high

# 闭环处理
/maestro-ralph --engine swarm --script wf-analyze --gaps ISS-001  # 根因分析
/maestro-next --gaps                     # 方案规划
/maestro-ralph continue                  # 执行修复
/maestro-manage issue close ISS-001 --resolution "Fixed"
```

**Commander Agent** 可自动推进未分析的 Issue，无需手动干预。

---

## 6. 快速任务

跳过 Phase 管线，直接完成任务：

```bash
# 最快路径
/maestro-next "修复登录页 Bug"

# 带规划验证
/maestro-next "重构 API 层" --full

# 带决策提取
/maestro-next --note "数据库迁移策略"
```

---

## 7. Delegate 异步委托

将任务委托给外部 AI 引擎（Gemini/Qwen/Codex/Claude/OpenCode）：

```bash
# 异步分析（立即返回）
maestro delegate "分析性能瓶颈" --to gemini --async

# 查看状态和结果
maestro delegate status gem-143022-a7f2
maestro delegate output gem-143022-a7f2

# 运行中追加上下文
maestro delegate message gem-143022-a7f2 "同时检查 utils 目录"

# 任务链——分析完自动修复
maestro delegate message gem-143022-a7f2 "修复所有高危问题" --delivery after_complete
```

### 支持的 --rule 模板

```bash
# 分析类
maestro delegate "..." --rule analysis-diagnose-bug-root-cause
maestro delegate "..." --rule analysis-analyze-code-patterns
maestro delegate "..." --rule analysis-assess-security-risks

# 规划类
maestro delegate "..." --rule planning-plan-architecture-design
maestro delegate "..." --rule planning-breakdown-task-steps

# 开发类
maestro delegate "..." --rule development-implement-feature --mode write
```

---

## 8. Spec 规范管理

项目级知识自动注入，Agent 启动时无需手动粘贴上下文：

```bash
# 初始化（扫描代码库生成规范文件）
/maestro-spec setup                                     # 已有项目：扫描代码库填充 specs
# 新项目可跳过 -- specs 由 analyze/plan/execute 渐进填充

# 录入规范
/maestro-spec add coding "所有 API 使用 Hono 框架"
/maestro-spec add arch "通知模块使用事件驱动架构"
/maestro-spec add learning "分页 offset=0 会越界"

# 加载规范
/maestro-spec load --role implement
/maestro-spec load --keyword auth
/maestro-spec load --role implement --keyword auth
```

**自动注入**：Hook 在 Agent 启动时按类型自动注入对应规范（coder→coding, tester→test, debugger→debug）。

---

## 9. Overlay 命令扩展

不修改原始命令文件，注入自定义步骤：

```bash
# 自然语言创建
/maestro-overlay "在 maestro-execute 后增加 CLI 验证"

# 管理
maestro overlay list                    # 交互式 TUI 查看
maestro overlay apply                   # 重新应用（幂等）
maestro overlay remove cli-verify       # 移除

# 团队分享
maestro overlay bundle -o team.json     # 打包
maestro overlay import-bundle team.json # 导入
```

---

## 10. Hooks 自动化

```bash
# 安装（推荐 standard）
maestro hooks install --level standard

# 查看状态
maestro hooks status

# 单独开关
maestro hooks toggle spec-injector off
```

| 级别 | 包含内容 |
|------|---------|
| `minimal` | 上下文监控 + 规范自动注入 |
| `standard` | + 委托监控 + 会话上下文 + Skill 感知 + 协调器追踪 + KG 同步 + KG 上下文注入 |
| `full` | + 工作流守卫（保护关键文件） |

---

## 11. Worktree 并行开发

里程碑级并行，不等 Bug 修完就启动下一阶段：

```bash
/maestro-fork -m 2                              # Fork M2 worktree
cd .worktrees/m2-production/
/maestro-ralph --engine swarm --script wf-analyze 3 && /maestro-next 3 && /maestro-ralph continue 3

cd /project
/maestro-merge -m 2                             # 合并回 main

# 同步 main 修复到 worktree
/maestro-fork -m 2 --sync
```

---

## 12. 里程碑管理

```bash
# 审计（跨 Phase 集成验证）
/maestro-session-seal

# 完成（归档并推进到下一里程碑）
/maestro-session-seal
```

---

## 13. Dashboard 看板

```bash
maestro view              # 浏览器看板
maestro view --tui        # 终端 UI
maestro stop              # 停止服务
```

展示 Phase 进度、Issue 状态（Backlog → In Progress → Review → Done），支持批量执行和 Agent 选择。

---

## 14. 知识搜索与代码图谱

### 统一搜索

```bash
maestro search "auth token"                        # BM25 全文搜索
maestro search "auth" --type spec                   # 仅搜索规范
maestro search "auth" --category coding             # 按分类过滤
```

**已废弃**：`spec search`、`knowhow search`、`wiki search` — 已统一为 `maestro search`。

### CodeGraph（可选）

函数级知识图谱，提供调用关系和符号查询：

```bash
# 安装（可选，启用函数级 KG）
npm install -g @colbymchenry/codegraph

# 初始化索引
maestro kg index --sqlite

# 查询
maestro kg search "validateToken"                   # 符号搜索
maestro kg context "validateToken"                  # 调用者/被调用者
```

安装后 Hook 自动保持图谱新鲜（`kg-sync` 增量同步 + `kg-context-injector` Agent 注入）。

---

## 15. 常用终端命令速查

| 命令 | 用途 |
|------|------|
| `maestro install` | 安装 |
| `maestro search "query"` | 统一知识搜索 |
| `maestro delegate "..." --to gemini` | 委托任务 |
| `maestro coordinate run "..." --chain default -y` | 图协调器 |
| `maestro overlay list` | Overlay 管理 |
| `maestro hooks status` | Hook 状态 |
| `maestro spec load --category coding` | 加载规范 |
| `maestro kg search "symbol"` | 代码图谱搜索 |
| `maestro view` | Dashboard 看板 |
| `maestro launcher -w my-project` | Claude Code 启动器 |

---

## 16. 典型工作流一览

### 新项目

```bash
/maestro-init → /maestro-ralph --roadmap → /maestro-next 1 → /maestro-ralph continue 1 → /maestro-session-seal
```

### 一键全自动

```bash
/maestro -y "实现用户认证系统"
```

### Bug 修复

```bash
/maestro-next "修复移动端登录页布局问题"
```

### 问题发现与修复

```bash
/maestro-manage issue discover → /maestro-ralph --engine swarm --script wf-analyze --gaps ISS-xxx → /maestro-next --gaps → /maestro-ralph continue → /maestro-manage issue close
```

### 并行开发

```bash
/maestro-fork -m 2 → (worktree 中开发) → /maestro-merge -m 2
```
