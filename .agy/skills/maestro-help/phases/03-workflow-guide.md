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

**新项目 — Path A** (复杂度: 高):

```markdown
## 新项目工作流

### 路径 A: 完整新项目
1. `/maestro-brainstorm "项目描述"` — 发散探索，多角色创意
2. `/maestro-blueprint` — (可选) 7-phase 正式规格文档化
3. `/maestro-init --from brainstorm:ID`
4. `/maestro-analyze "topic"` — 宏观分析，探索影响面 → scope_verdict
5. `/maestro-roadmap --from analyze:ANL-xxx` — 纯编排，Milestone > Phase 分解
6. `/maestro-analyze 1` — 微观分析，Phase 级深入
7. `/maestro-plan 1` → `/maestro-execute` → `/maestro-verify`

### 路径 E: 纯规格文档（不进执行链）
1. `/maestro-blueprint "project idea"` — 供人阅读和决策

### 路径 F: 纯探索（不进执行链）
1. `/maestro-brainstorm "idea"` — 供人决策
```

**旧项目大功能 — Path B** (复杂度: 高):

```markdown
## 旧项目大功能工作流

1. `/maestro-analyze "feature X"` — 宏观分析 → scope_verdict=large
2. `/maestro-roadmap --from analyze:ANL-xxx` — Milestone > Phase 分解
3. `/maestro-analyze 1` — 微观分析
4. `/maestro-plan 1` → `/maestro-execute` → `/maestro-verify`
```

**中等功能 — Path C** (复杂度: 中，跳过 roadmap):

```markdown
## 中等功能工作流

1. `/maestro-analyze "feature X"` — 宏观分析 → scope_verdict=medium
2. `/maestro-plan --from analyze:ANL-xxx` — 直达规划，跳过 roadmap
3. `/maestro-execute` → `/maestro-verify`

### 快速渠道（简单功能）
1. `/maestro-quick "功能描述"` — 一键完成

### 全自动
1. `/maestro -y "功能描述"` — 自动选择并执行完整流程
```

**小改动 — Path D** (复杂度: 低):

```markdown
## 小改动工作流

1. `/maestro-plan "fix auth bug"` — 直接规划
2. `/maestro-execute` → `/maestro-verify`

### 快速修复（已知问题）
1. `/maestro-quick "修复 Bug 描述"`
```

**Bug 追踪** (Issue 闭环):

```markdown
## Bug 追踪工作流

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
上游起源: brainstorm(发散) | blueprint(收敛) → 可选
理解层:   analyze "topic"(宏观) → scope_verdict 路由
编排层:   roadmap(可选，仅 scope_verdict=large 时建议)
执行层:   plan → execute → verify → quality → milestone-audit → milestone-complete
快速渠道: maestro-quick → (直接完成)
Issue 闭环: discover → create → analyze --gaps → plan --gaps → execute → close
全自动: /maestro -y → (自动路由)
```

#### Step 4.4: 关键概念说明

对不熟悉 Maestro 的用户，简要说明核心概念：

```markdown
## 核心概念

- **Roadmap**: 项目级常驻规划文档，包含多个 Milestone
- **Milestone**: 可独立交付的版本节点（v0.1.0-rc1），包含多个 Phase
- **Phase**: Milestone 内的同步屏障执行阶段，走 analyze → plan → execute → verify 生命周期
- **Task**: Phase 内的具体代码修改单元（wave DAG 管理并行）
- **Blueprint**: 正式规格文档化命令（7-phase 收敛），与 brainstorm 并列作为上游起源
- **Analyze 双层**: 宏观(文本参数)探索影响面产出 scope_verdict；微观(数字参数)Phase 级深入分析
- **scope_verdict**: analyze 宏观完成后的路由建议 — large→roadmap, medium/small→直达 plan
- **Overlay**: 非侵入式命令补丁，扩展命令行为而不修改源文件
- **Delegate**: 将子任务委派给外部 AI 工具（Gemini/Claude/Codex）
- **Spec**: 项目约束规则（coding/arch/debug/test），自动注入到工作流
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
| 3 | `/maestro-brainstorm` | 头脑风暴 | 新项目发散探索、多角色创意 |
| 4 | `/maestro-blueprint` | 规格文档化 | 正式 7-phase 收敛规格链 |
| 5 | `/maestro-analyze` | 双层分析 | 宏观: `"topic"` 探索影响面；微观: `1` Phase 级深入 |
| 6 | `/maestro-roadmap` | 路线图编排 | scope_verdict=large 时，Milestone > Phase 分解 |
| 7 | `/maestro-plan` | 规划 | 分析完成后生成执行计划，支持 `--from analyze:ANL-xxx` 直达 |
| 8 | `/maestro-execute` | 执行 | 计划完成后，执行实现 |
| 9 | `/maestro-verify` | 验证 | 执行完成后，检查成果 |
| 10 | `/maestro-quick` | 快速任务 | 简单任务跳过管线 |
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
