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

安装后即可在 Claude Code 或 Grok Build 中使用斜杠命令 / 技能，以及 `maestro` 终端命令。Grok 宿主：项目指令在 `.grok/rules/maestro.md`；项目级 MCP / hooks 需信任该文件夹。详见 [安装指南](/guides/install) 的 Grok Build 一节。

### 可选技能包（按需安装）

`maestro install` 交互界面中，**skills-scholar** 技能包默认不选中，按需勾选；完整说明见[安装指南](/guides/install)。

> v0.5.61 起 skill 面大幅精简：20 个零使用团队/辅助 skill 已删除，原 skills-extra-team / skills-meta 成员或并入核心、或移除；skills-extra-team、skills-meta 仅作为遗留空 bundle 保留。

**skills-scholar（10 个学术技能，选装）**：scholar-ideation、scholar-writing、scholar-experiment、scholar-citation-verify、scholar-anti-ai-writing、scholar-latex-organizer、scholar-review、scholar-rebuttal-pro、scholar-thesis-docx、scholar-publish

```bash
# 安装组包后，逐个启用/禁用单个技能
maestro install toggle --type skill --list
maestro install toggle --type skill --enable scholar-writing
```

> 8 个内置团队技能（team-arch-opt、team-coordinate、team-issue、team-lifecycle-v4、team-perf-opt、team-review、team-swarm、team-testing）随核心组件自动安装，无需单独选择。

---

## 2. 项目初始化

### 最简路径

```bash
/maestro-init                          # 初始化 .workflow/ 目录
/maestro "从需求开始做整个项目" -y      # spec-driven 链：init → roadmap --mode full → plan → execute → harvest
```

### 从头脑风暴开始

```bash
/maestro "brainstorm 在线教育平台"      # 多角色头脑风暴（brainstorm-driven 链）
/maestro-init --from-brainstorm SESSION-ID                  # 基于头脑风暴初始化
/maestro "创建路线图" -y                # roadmap-driven 链
```

### 完整规范蓝图（大型项目）

```bash
/maestro-init
/maestro "生成规范蓝图"                   # blueprint-driven 链：7 阶段规范蓝图（产品简报 + PRD + 架构 + 史诗）
```

---

## 3. Phase 管线

项目的核心推进流程，每个 Phase 走 `分析 → 规划 → 执行 → 审查 → 测试` 生命周期（验证已内聚于 `post-execute` 决策门）：

```bash
# 闭环模式——/maestro-ralph 构建完整生命周期链 + decision gate
/maestro-ralph "实现用户认证系统"     # analyze → plan → execute → ◆ → review → ◆ → test → seal

# 逐步模式（经 /maestro 路由单步链）
/maestro "analyze"                    # 分析
/maestro "plan phase 1"               # 规划
/maestro "execute"                    # 执行
# 注：/maestro-verify 已于 v0.5.51 退役，验证集成进 maestro-ralph 决策门

# 逐 Phase 模式（micro 层：Phase 级深度分析）
/maestro "analyze phase 1"            # 只分析 Phase 1
/maestro "plan phase 1"               # 只规划 Phase 1
/maestro "execute phase 1"            # 只执行 Phase 1

# 宏观探索模式（macro 层：roadmap 之前使用）
/maestro "实现多租户架构"              # analyze-macro → scope_verdict 路由
```

### 一键全自动

```bash
/maestro -y "实现用户认证系统"
# 自动分类意图 → 创建 canonical Session → 执行完整生命周期
```

### 免初始化模式（临时任务）

```bash
/maestro "实现 JWT 认证"                 # analyze-plan-execute 链，scope=standalone
maestro session start "实现 JWT 认证" --chain analyze plan execute   # CLI 直接建链
```

---

## 4. 质量管线

执行后运行质量验证，质量门由 Ralph 策略作为 decision 节点插入链中：

```bash
# 闭环模式（自动插入 quality gate）
/maestro-ralph "实现 X"     # execute → ◆post-execute → review → ◆post-review → test → ◆post-test

# 单步质量命令（经 /maestro 路由）
/maestro "review phase 1"               # 代码审查
/maestro "test phase 1"                 # UAT 测试
/maestro-odyssey --mode security "phase 1"   # 安全审计
```

### 测试失败修复循环

```bash
/maestro-odyssey --mode debug --from-uat 1      # 诊断失败
/maestro "review 有问题需要修"            # review-fix 链：plan --gaps → execute → review
/maestro "全面质量检查"                   # quality-loop 链：review → auto-test → test → debug → plan --gaps → execute
```

---

## 5. Issue 闭环

独立于 Phase 管线的问题追踪系统，支持全自动闭环：

```bash
# 发现问题
/maestro-issue discover by-prompt "检查 API 错误处理"

# 创建 Issue
/maestro-issue create --title "内存泄漏" --severity high

# 闭环处理（issue-full 链）
/maestro "fix issue ISS-001"     # analyze --gaps → plan --gaps → execute → review → close → harvest
/maestro-issue close ISS-001 --resolution "Fixed"
```

**Commander Agent** 可自动推进未分析的 Issue，无需手动干预。

---

## 6. 快速任务

跳过 Phase 管线，直接完成任务：

```bash
# 最快路径（纯路由：分类意图 → 路由到 companion / 单 Run / /maestro）
/maestro-next "修复登录页 Bug"

# 轻量执行（最小 Run 生命周期）
/maestro-companion "修复登录页 Bug"
```

---

## 7. Delegate 异步委托

将任务委托给外部 AI 引擎（Gemini / Qwen / Codex / Claude / OpenCode / Grok）：

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
# 初始化
maestro spec init                                       # 播种骨架文件（仅骨架，不扫描代码库）
maestro run skill specs-setup                           # 已有项目：扫描代码库，用检出的约定填充 specs
# 新项目可跳过 -- specs 由 analyze/plan/execute 渐进填充

# 录入规范（/maestro-spec 只做录入，category 自动推断，也可显式指定）
/maestro-spec coding "所有 API 使用 Hono 框架"
/maestro-spec arch "通知模块使用事件驱动架构"
/maestro-spec learning "分页 offset=0 会越界"

# 加载规范（CLI）
maestro spec load --category coding
maestro spec load --keyword auth
maestro spec load --category coding --keyword auth
```

**自动注入**：Hook 在 Agent 启动时按类型自动注入对应规范（coder→coding, tester→test, debugger→debug）。

---

## 9. Overlay 命令扩展

不修改原始命令文件，注入自定义步骤：

```bash
# 自然语言创建
/maestro-overlay "在 execute 后增加 CLI 验证"

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
/maestro "analyze phase 3" && /maestro "plan phase 3" && /maestro "execute phase 3"

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

## 13. 工作流状态

```bash
maestro run brief          # 当前 Run 的恢复信息
maestro run check          # 当前 Run 的门禁与完成指引
maestro session status     # canonical Session/Run 状态
```

Dashboard UI 已退役；工作流状态统一通过 Session/Run 命令查看。

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

安装后 Hook 自动保持图谱新鲜并提供上下文（`kg-sync` 增量同步 + `keyword-spec-injector` 单次 prompt 上下文组合）。

---

## 15. 常用终端命令速查

| 命令 | 用途 |
|------|------|
| `maestro install` | 安装 |
| `maestro search "query"` | 统一知识搜索 |
| `maestro delegate "..." --to gemini` | 委托任务 |
| `maestro session start "..." --chain analyze plan execute` | 建链并派发（人类入口） |
| `maestro session status` | canonical Session/Run 状态 |
| `maestro overlay list` | Overlay 管理 |
| `maestro hooks status` | Hook 状态 |
| `maestro spec load --category coding` | 加载规范 |
| `maestro kg search "symbol"` | 代码图谱搜索 |
| `maestro launcher -w my-project` | Claude Code 启动器 |

---

## 16. 典型工作流一览

### 新项目

```bash
/maestro-init → /maestro "从需求开始做整个项目" → /maestro-session-seal
# 或闭环：/maestro-ralph "实现 X" -y
```

### 一键全自动

```bash
/maestro -y "实现用户认证系统"
```

### Bug 修复

```bash
/maestro-next "修复移动端登录页布局问题"    # 路由到 companion / 单 Run / /maestro
```

### 问题发现与修复

```bash
/maestro-issue discover → /maestro "fix issue ISS-xxx" → /maestro-issue close
```

### 并行开发

```bash
/maestro-fork -m 2 → (worktree 中开发) → /maestro-merge -m 2
```
