# Phase 3: Workflow Guide

工作流推荐和新手引导。覆盖 Mode 4/5。

## Objective

- 根据用户任务推荐最合适的工作流
- 为新手提供入门指引
- 给出具体命令序列和说明

## Execution

### Mode 4: Workflow Guide

根据用户描述的任务类型推荐工作流：

#### Step 4.1: 任务分类

```javascript
// 任务类型识别
const taskPatterns = [
  { type: "new_project", patterns: ["新项目", "从头开始", "new project", "创建项目"] },
  { type: "feature", patterns: ["添加功能", "新功能", "add feature", "实现"] },
  { type: "bugfix", patterns: ["修复", "bug", "fix", "问题"] },
  { type: "refactor", patterns: ["重构", "refactor", "优化", "改进"] },
  { type: "analysis", patterns: ["分析", "analyze", "调查", "investigate"] },
  { type: "review", patterns: ["审查", "review", "检查", "check"] },
  { type: "test", patterns: ["测试", "test", "验证"] },
  { type: "explore", patterns: ["探索", "explore", "头脑风暴", "brainstorm"] },
  { type: "knowledge", patterns: ["知识", "knowhow", "学习", "learn"] },
]
```

#### Step 4.2: 推荐工作流

**新项目** (复杂度: 高):

```markdown
## 新项目工作流

### 路径 1: 最简路径（适合快速启动）
1. `/maestro-init` — 初始化 .workflow/ 目录
2. `/maestro-roadmap "项目目标" -y` — 生成路线图
3. 按里程碑执行: analyze → plan → execute → verify

### 路径 2: 从头脑风暴开始（适合需要创意探索）
1. `/maestro-brainstorm "项目描述"` — 多角色头脑风暴
2. `/maestro-init --from-brainstorm ANL-xxx` — 基于分析初始化
3. `/maestro-roadmap "创建路线图" -y`

### 路径 3: 完整规范链（适合大型项目）
1. `/maestro-init`
2. `/maestro-spec-generate` — 7 阶段规范生成
```

**功能开发** (复杂度: 中):

```markdown
## 功能开发工作流

### 主干管线（标准流程）
1. `/maestro-analyze [phase]` — 分析需求和现有代码
2. `/maestro-plan [phase]` — 生成执行计划
3. `/maestro-execute [phase]` — 执行实现
4. `/maestro-verify [phase]` — 验证成果

### 快速渠道（简单功能）
1. `/maestro-quick "功能描述"` — 一键完成

### 全自动
1. `/maestro -y "功能描述"` — 自动选择并执行完整流程
```

**Bug 修复** (复杂度: 低-中):

```markdown
## Bug 修复工作流

### 快速修复（已知问题）
1. `/maestro-quick "修复 Bug 描述"`

### Issue 闭环（需要追踪）
1. `/manage-issue-discover by-prompt "问题描述"` — 发现 Issue
2. `/manage-issue create --title "Bug 标题" --severity high` — 创建 Issue
3. `/maestro-analyze --gaps ISS-xxx` — 根因分析
4. `/maestro-plan --gaps` — 方案规划
5. `/maestro-execute` — 执行修复
6. `/manage-issue close ISS-xxx --resolution "Fixed"` — 关闭 Issue
```

**代码审查**:

```markdown
## 质量管线

1. `/quality-review [phase] --level standard` — 多维代码审查
2. `/quality-auto-test [phase]` — 自动测试（智能路由）
3. `/quality-test [phase]` — 业务测试（UAT）

### 测试失败修复循环
1. `/quality-debug --from-uat [phase]` — 诊断失败
2. `/maestro-plan [phase] --gaps` — 生成修复计划
3. `/maestro-execute [phase]` — 执行修复
4. `/quality-auto-test [phase] --re-run` — 重跑失败场景
```

#### Step 4.3: 工作流全景图

对需要全景视角的用户，展示 Mermaid 图：

```
主干管线: analyze → plan → execute → verify → quality (review/test) → milestone-audit → milestone-complete
快速渠道: maestro-quick → (直接完成)
Issue 闭环: discover → create → analyze --gaps → plan --gaps → execute → close
全自动: /maestro -y → (自动路由)
```

#### Step 4.4: 关键概念说明

对不熟悉 Maestro 的用户，简要说明核心概念：

```markdown
## 核心概念

- **Milestone**: 项目阶段，包含多个 Phase
- **Phase**: 单个工作单元，走 analyze → plan → execute → verify 生命周期
- **Overlay**: 非侵入式命令补丁，扩展命令行为而不修改源文件
- **Delegate**: 将子任务委派给外部 AI 工具（Gemini/Claude/Codex）
- **Spec**: 项目规范，自动注入到工作流中作为约束
- **Wiki**: 知识图谱，存储详细技术文档
- **Ralph**: 自适应决策引擎，动态调整执行链
```

### Mode 5: Beginner Onboarding

#### Step 5.1: 展示核心命令

从 `catalog.json essential_commands[]` 读取核心命令列表：

```markdown
## Maestro Flow 快速入门

### 10 个核心命令

| # | 命令 | 用途 | 何时使用 |
|---|------|------|---------|
| 1 | `/maestro` | 智能协调器 | 不确定用哪个命令时，告诉它你的目标 |
| 2 | `/maestro-init` | 初始化项目 | 首次使用，创建 .workflow/ 结构 |
| 3 | `/maestro-roadmap` | 生成路线图 | 初始化后，规划里程碑 |
| 4 | `/maestro-analyze` | 分析 | 开始一个 Phase 的分析 |
| 5 | `/maestro-plan` | 规划 | 分析完成后，生成执行计划 |
| 6 | `/maestro-execute` | 执行 | 计划完成后，执行实现 |
| 7 | `/maestro-verify` | 验证 | 执行完成后，检查成果 |
| 8 | `/maestro-quick` | 快速任务 | 简单任务跳过管线 |
| 9 | `/quality-review` | 代码审查 | 执行后进行质量检查 |
| 10 | `/manage-issue` | Issue 管理 | 追踪和解决 Bug |
```

#### Step 5.2: 快速入门路径

```markdown
### 5 分钟上手

1. **安装**: `maestro install --force`
2. **初始化**: `/maestro-init`
3. **开始工作**: `/maestro "你的任务描述"` — 自动选择最佳工作流

### 10 分钟深入

阅读 `guide/quick-start-guide.md` 了解完整功能。
```

#### Step 5.3: 分类浏览引导

```markdown
### 想了解更多？

- **全部命令**: `/maestro-help` 查看完整目录
- **工作流指南**: `/maestro-help workflow` 了解工作流选择
- **Skill 浏览**: `/maestro-help skills` 查看可用 Skill
- **CLI 命令**: `/maestro-help cli` 查看终端命令
```

## Output

结构化的工作流推荐或新手引导内容，直接展示给用户。
