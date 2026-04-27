# 快速入门指南

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

---

## 2. 项目初始化

### 最简路径

```bash
/maestro-init                          # 初始化 .workflow/ 目录
/maestro-roadmap "项目名称和目标" -y     # 生成路线图
```

### 从头脑风暴开始

```bash
/maestro-brainstorm "在线教育平台"       # 多角色头脑风暴
/maestro-init --from-brainstorm ANL-xxx # 基于头脑风暴初始化
/maestro-roadmap "创建路线图" -y
```

### 完整规范链（大型项目）

```bash
/maestro-init
/maestro-spec-generate                  # 7 阶段完整规范生成（PRD + 架构 + 路线图）
```

---

## 3. Phase 管线

项目的核心推进流程，每个 Phase 走 `分析 → 规划 → 执行 → 验证` 生命周期：

```bash
# 全量模式——覆盖当前里程碑所有 Phase
/maestro-analyze                        # 分析
/maestro-plan                           # 规划
/maestro-execute                        # 执行
/maestro-verify                         # 验证

# 逐 Phase 模式
/maestro-analyze 1                      # 只分析 Phase 1
/maestro-plan 1                         # 只规划 Phase 1
/maestro-execute 1                      # 只执行 Phase 1
```

### 一键全自动

```bash
/maestro -y "实现用户认证系统"
# 自动执行完整生命周期
```

### 免初始化模式（临时任务）

```bash
/maestro-analyze "实现 JWT 认证"         # scope=standalone，自动创建 state.json
/maestro-plan --dir scratch/20260420-analyze-jwt-...
/maestro-execute --dir scratch/20260420-plan-jwt-...
```

---

## 4. 质量管线

执行后运行质量验证，三轨测试互补：

```bash
# PRD-Forward：业务规则是否满足
/quality-business-test 1

# Code-Backward：代码是否工作
/quality-test 1

# Coverage-Backward：覆盖率是否足够
/quality-test-gen 1

# 代码审查
/quality-review 1 --level standard
```

### 测试失败修复循环

```bash
/quality-debug --from-business-test 1   # 诊断失败
/maestro-plan 1 --gaps                  # 生成修复计划
/maestro-execute 1                      # 执行修复
/quality-business-test 1 --re-run       # 重跑失败场景
```

---

## 5. Issue 闭环

独立于 Phase 管线的问题追踪系统，支持全自动闭环：

```bash
# 发现问题
/manage-issue-discover by-prompt "检查 API 错误处理"

# 创建 Issue
/manage-issue create --title "内存泄漏" --severity high

# 闭环处理
/maestro-analyze --gaps ISS-001          # 根因分析
/maestro-plan --gaps                     # 方案规划
/maestro-execute                         # 执行修复
/manage-issue close ISS-001 --resolution "Fixed"
```

**Commander Agent** 可自动推进未分析的 Issue，无需手动干预。

---

## 6. 快速任务

跳过 Phase 管线，直接完成任务：

```bash
# 最快路径
/maestro-quick "修复登录页 Bug"

# 带规划验证
/maestro-quick --full "重构 API 层"

# 带决策提取
/maestro-quick --discuss "数据库迁移策略"
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
/spec-setup

# 录入规范
/spec-add coding "所有 API 使用 Hono 框架"
/spec-add arch "通知模块使用事件驱动架构"
/spec-add learning "分页 offset=0 会越界"

# 加载规范
/spec-load --category coding
/spec-load --keyword auth
/spec-load --category coding --keyword naming
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
| `standard` | + 委托监控 + 会话上下文 + Skill 感知 + 协调器追踪 |
| `full` | + 工作流守卫（保护关键文件） |

---

## 11. Worktree 并行开发

里程碑级并行，不等 Bug 修完就启动下一阶段：

```bash
/maestro-fork -m 2                              # Fork M2 worktree
cd .worktrees/m2-production/
/maestro-analyze 3 && /maestro-plan 3 && /maestro-execute 3

cd /project
/maestro-merge -m 2                             # 合并回 main

# 同步 main 修复到 worktree
/maestro-fork -m 2 --sync
```

---

## 12. 里程碑管理

```bash
# 审计（跨 Phase 集成验证）
/maestro-milestone-audit

# 完成（归档并推进到下一里程碑）
/maestro-milestone-complete
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

## 14. 常用终端命令速查

| 命令 | 用途 |
|------|------|
| `maestro install` | 安装 |
| `maestro delegate "..." --to gemini` | 委托任务 |
| `maestro coordinate run "..." --chain default -y` | 图协调器 |
| `maestro overlay list` | Overlay 管理 |
| `maestro hooks status` | Hook 状态 |
| `maestro spec load --category coding` | 加载规范 |
| `maestro view` | Dashboard 看板 |
| `maestro launcher -w my-project` | Claude Code 启动器 |
| `maestro knowhow search "auth"` | 搜索持久记忆 |

---

## 15. 典型工作流一览

### 新项目

```bash
/maestro-init → /maestro-roadmap → /maestro-plan 1 → /maestro-execute 1 → /maestro-verify 1 → /maestro-milestone-audit
```

### 一键全自动

```bash
/maestro -y "实现用户认证系统"
```

### Bug 修复

```bash
/maestro-quick "修复移动端登录页布局问题"
```

### 问题发现与修复

```bash
/manage-issue-discover → /maestro-analyze --gaps ISS-xxx → /maestro-plan --gaps → /maestro-execute → close
```

### 并行开发

```bash
/maestro-fork -m 2 → (worktree 中开发) → /maestro-merge -m 2
```
