# Scholar Rebuttal Pro - 使用指南

## 概述

**scholar-rebuttal-pro** 是一个增强版的学术论文审稿意见回复 skill，整合了 Agy/CLI 协作分析和多视角讨论机制，用于生成结构化、证据支撑的 rebuttal 文档。

## 核心特性

### 1. 五阶段工作流

```
Phase 1: 审稿意见解析与分类
   ↓ (使用 Agy CLI 语义分析)
Phase 2: 多视角讨论
   ↓ (作者/审稿人/专家三方视角)
Phase 3: 策略制定
   ↓ (Accept/Defend/Clarify/Experiment)
Phase 4: Rebuttal 撰写
   ↓ (会议特定模板 + 专业语气优化)
Phase 5: 质量验证
   ↓ (完整性/专业性/说服力评估)
```

### 2. CLI 协作分析

- **Phase 1**: Agy CLI 语义分析，自动分类审稿意见
- **Phase 2**: 多视角讨论（可选 team-ultra-analyze）
- **Phase 3**: CLI 搜索论文内容，提取支撑证据
- **Phase 5**: CLI 质量验证，生成改进建议

### 3. 多视角讨论

模拟三方视角进行讨论：
- **作者视角**: 如何最有效回应
- **审稿人视角**: 什么样的回复最有说服力
- **领域专家视角**: 技术准确性和学术规范

### 4. 会议特定策略

支持主流会议模板：
- **ML Conferences**: NeurIPS/ICML/ICLR
- **CV Conferences**: CVPR/ECCV/ICCV
- **NLP Conferences**: ACL/EMNLP
- **Generic**: 通用模板

## 使用方法

### 基本调用

```bash
# 方式 1: 直接调用 skill
scholar-rebuttal-pro

# 方式 2: 通过触发词
"帮我回复审稿意见"
"respond to reviewers"
"rebuttal"
```

### 输入格式

支持三种输入方式：

1. **文件路径**:
   ```
   reviews.txt
   reviewer-comments.md
   reviews.pdf
   ```

2. **内联文本**: 直接粘贴审稿意见

3. **结构化 JSON**: 预解析的审稿结构

### 交互式配置

Skill 启动时会询问三个配置：

#### 1. 自动模式
- **交互模式 (推荐)**: 每阶段后确认，可调整策略
- **自动模式**: 一次性执行所有阶段

#### 2. 论文来源
- **提供路径**: 指定论文 PDF/LaTeX 路径
- **当前目录**: 自动搜索当前目录
- **仅审稿意见**: 不分析论文内容

#### 3. 会议类型
- **ML Conferences**: NeurIPS/ICML/ICLR 策略
- **CV Conferences**: CVPR/ECCV/ICCV 策略
- **NLP Conferences**: ACL/EMNLP 策略
- **Generic**: 通用模板

## 输出产物

### Phase 1 输出
- `review-analysis.json` - 结构化分类结果
- `comment-classification.md` - 人类可读的分类报告

### Phase 2 输出
- `discussion-log.md` - 完整讨论记录
- `consensus-strategies.json` - 共识策略

### Phase 3 输出
- `strategy-matrix.md` - 策略矩阵
- `evidence-references.json` - 证据引用

### Phase 4 输出
- `rebuttal.md` - 最终 rebuttal 文档
- `rebuttal-draft-v1-{timestamp}.md` - 版本化草稿

### Phase 5 输出
- `quality-report.md` - 质量评估报告
- `improvement-suggestions.json` - 改进建议

所有输出文件位于: `.workflow/.scratchpad/`

## 架构设计

### Orchestrator + Phases 模式

```
scholar-rebuttal-pro/
├── SKILL.md                          # 协调器（纯协调逻辑）
└── phases/
    ├── 01-review-parsing.md          # Phase 1 完整执行协议
    ├── 02-multi-perspective-discussion.md  # Phase 2 + Compact Sentinel
    ├── 03-strategy-formulation.md    # Phase 3 + Compact Sentinel
    ├── 04-rebuttal-writing.md        # Phase 4 + Compact Sentinel
    └── 05-quality-validation.md      # Phase 5 完整执行协议
```

### 渐进式加载

- **SKILL.md**: 仅包含协调逻辑和 `Ref:` 标记
- **Phase 文件**: 按需加载，包含完整执行细节
- **Compact Recovery**: Phase 2/3/4 包含 sentinel 机制

### TodoWrite 模式

```json
// Phase 执行中（任务展开）
[
  {"content": "Phase 1: Review Parsing", "status": "completed"},
  {"content": "Phase 2: Multi-Perspective Discussion", "status": "in_progress"},
  {"content": "  → Author perspective", "status": "in_progress"},
  {"content": "  → Reviewer perspective", "status": "pending"},
  {"content": "  → Expert perspective", "status": "pending"},
  {"content": "Phase 3: Strategy Formulation", "status": "pending"}
]

// Phase 完成后（任务折叠）
[
  {"content": "Phase 1: Review Parsing", "status": "completed"},
  {"content": "Phase 2: Multi-Perspective Discussion", "status": "completed"},
  {"content": "Phase 3: Strategy Formulation", "status": "pending"}
]
```

## CLI 集成示例

### Phase 1 - 审稿意见分类

```bash
ccw cli -p "PURPOSE: Parse and classify reviewer comments by type and severity
TASK: • Parse comment structure • Classify by severity • Extract key concerns
MODE: analysis
CONTEXT: @reviews.txt
EXPECTED: JSON with classification results" \
--tool agy --mode analysis --rule analysis-analyze-technical-document
```

### Phase 3 - 证据搜索

```bash
ccw cli -p "PURPOSE: Search paper content for evidence supporting response strategies
TASK: • Locate relevant sections • Extract supporting data • Identify evidence gaps
MODE: analysis
CONTEXT: @paper.pdf
EXPECTED: Evidence map with file:line references" \
--tool agy --mode analysis
```

### Phase 5 - 质量验证

```bash
ccw cli -p "PURPOSE: Validate rebuttal quality (completeness, professionalism, persuasiveness)
TASK: • Check all comments addressed • Assess tone • Evaluate evidence strength
MODE: analysis
CONTEXT: @rebuttal.md
EXPECTED: Quality report with improvement suggestions" \
--tool agy --mode analysis
```

## 会议特定策略

### NeurIPS/ICML/ICLR (ML Conferences)
- 强调概念新颖性和 broader impact
- 理论严谨性和方法论贡献
- 实验彻底性和局限性讨论

### CVPR/ECCV/ICCV (CV Conferences)
- 严格一页限制
- 禁止外部链接
- Champion 审稿人策略

### ACL/EMNLP (NLP Conferences)
- 语言学意义和适当性
- 伦理考量和数据来源
- 实用性和可扩展性

### Generic Template
- 适用于所有会议的通用策略
- 四大响应策略: Accept/Defend/Clarify/Experiment
- 五大成功模式（基于 ICLR Spotlight 论文分析）

## 最佳实践

### 1. 准备工作
- 准备审稿意见文件（txt/md/pdf）
- 准备论文源文件（PDF/LaTeX）
- 了解目标会议的特定要求

### 2. 执行流程
- 使用交互模式（推荐）以便在每阶段后调整
- 仔细审查 Phase 2 的多视角讨论结果
- 在 Phase 3 验证证据引用的准确性
- Phase 4 后人工审查 rebuttal 草稿
- 根据 Phase 5 的改进建议优化

### 3. 质量保证
- 确保所有审稿意见都有回应
- 每个回应都有充分的证据支撑
- 保持专业、尊重的语气
- 避免过度承诺（只承诺可行的改进）

### 4. 会议特定注意事项
- **NeurIPS**: 强调 broader impact 和伦理考量
- **ICML**: 突出理论贡献和数学证明
- **ICLR**: 详细讨论局限性，披露 LLM 使用
- **CVPR**: 严格遵守一页限制，不使用外部链接
- **ACL**: 强调语言学意义和伦理声明

## 故障排除

### 问题 1: CLI 执行失败
**解决方案**: 检查 `~/.claude/cli-tools.json` 配置，确保 agy 工具已启用

### 问题 2: 论文路径无效
**解决方案**: 使用"仅审稿意见"模式，手动提供证据

### 问题 3: 会议模板未找到
**解决方案**: 使用 Generic 模板，手动调整会议特定要求

### 问题 4: Phase 执行中断
**解决方案**: Skill 支持断点恢复，重新调用会从中断处继续

## 扩展性

### 添加新会议模板

1. 在 `G:\github_lib\claude-scholar\skills\review-response\references\` 添加模板
2. 或在 `d:\ccws\.workflow\参考文档1\` 添加自定义模板
3. Phase 4 会自动搜索并加载

### 自定义响应策略

编辑 Phase 3 的策略映射规则，添加新的响应类型。

### 集成其他 CLI 工具

修改 Phase 1/3/5 的 CLI 调用，替换 `--tool agy` 为其他工具（qwen/codex）。

## 相关 Skills

- **scholar-review**: 论文自审和审稿流程
- **scholar-writing**: 端到端论文撰写
- **scholar-publish**: 会后准备（演讲/海报）

## 技术细节

### Compact Recovery 机制

Phase 2/3/4 包含 compact sentinel，防止长上下文压缩导致协议丢失：

```markdown
> **📌 COMPACT SENTINEL [Phase 2: multi-perspective-discussion]**
> This phase contains 4 execution steps (Step 2.1 — 2.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/02-multi-perspective-discussion.md")`
```

### Checkpoint 验证

关键执行步骤前包含 checkpoint：

```markdown
> **⚠️ CHECKPOINT**: Before proceeding, verify:
> 1. This phase is TodoWrite `in_progress` (active phase protection)
> 2. Full protocol (Step N.X — N.M) is in active memory, not just sentinel
> If only sentinel remains → `Read("phases/0N-xxx.md")` now.
```

## 版本信息

- **Skill Version**: 1.0.0
- **Created**: 2026-03-02
- **Based on**: claude-scholar review-response skill
- **Enhancements**: CLI integration, multi-perspective discussion, conference templates

## 贡献与反馈

如需改进或报告问题，请联系项目维护者。
