---
title: "UI 生产系统指南"
---

Maestro UI 生产管线覆盖从设计原型到代码实现的全生命周期，通过三个核心命令构成完整的 `design -> craft -> codify` 工作流。

---

## 一、概述

### 管线架构

```
impeccable --chain build  →  impeccable (auto pipeline)  →  ui-codify
  design-ref/                critique/audit 驱动迭代         knowhow 资产
```

**Phase 管线位置**：`analyze -> ui-design -> plan -> execute -> verify`（设计先于规划）

`maestro-impeccable` 是 impeccable skill（23 命令 / 6 分类）的编排层，通过 critique/audit 评分驱动自动迭代循环。`--chain build` 产出的 `design-ref/` 会被 `maestro-plan` 自动检测，将设计 token 注入执行任务的 `read_first[]`。

---

## 二、命令详解

### 2.1 maestro-impeccable --chain build — UI 设计原型

生成多个风格变体的设计原型，用户选择后固化为可消费的设计系统。（原 `maestro-ui-design`，现已合并。）

```
/maestro-impeccable "<phase|topic>" --chain build [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `<phase\|topic>` | 必填 | Phase 编号 → phase 模式，文本 → scratch 模式 |
| `--styles N` | 3 | 风格变体数量（2-5） |
| `--stack` | html-tailwind | 技术栈约束 |
| `--targets` | 自动推断 | 逗号分隔的页面目标 |
| `--layouts N` | 2 | 每目标的布局变体（1-3，仅 full 模式） |
| `--full` | false | 强制 4 层管线 |
| `-y` | false | 跳过交互 |

**工作路径**：`--full` → 完整管线 | ui-ux-pro-max 可用 → 轻量委托 | 否则 → 回退完整管线

**设计流程**：收集需求 → 调用 ui-ux-pro-max 生成 N 个变体 → 用户选择 → 固化 token 文件

**design-ref/ 产物**：`MASTER.md`、`design-tokens.json`（OKLCH）、`animation-tokens.json`、`selection.json`、`layout-templates/`、`prototypes/`

**后续路由**：

| 下一步 | 命令 |
|--------|------|
| 基于设计规划 | `/maestro-plan {phase}` |
| 精调设计 | `/maestro-impeccable "{phase}" --chain improve` |

---

### 2.2 maestro-impeccable — UI 自动化生产管线

通过 critique/audit 评分驱动循环，编排 impeccable skill 的 23 个命令为自动化质量门控管线。

```
/maestro-impeccable <intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `<intent\|target>` | 必填 | 意图描述或目标路径 |
| `--chain` | 自动路由 | 强制指定链类型 |
| `--enhance` | — | enhance 链使用的具体命令 |
| `--threshold` | 26 | critique 通过阈值（满分 40） |
| `--max-loops` | 3 | 质量门控最大迭代次数 |

#### Chain 类型

| Chain | 执行序列 | 门控条件 |
|-------|----------|----------|
| **build** | teach? → shape → craft → critique → [loop] → audit → polish | score >= threshold 且 P0 == 0 |
| **improve** | critique → [loop] → polish → audit | score >= threshold 且 P0 == 0 |
| **enhance** | {cmd} → critique → polish? | score >= threshold |
| **harden** | harden → audit → polish | audit >= threshold x 0.5 |
| **live** | live | 无门控（交互式） |

`teach?` 仅在 PRODUCT.md 缺失时触发。

#### 意图自动路由

| 意图关键词 | Chain |
|-----------|-------|
| 新建、create、build、从零、landing、page | build |
| 改进、improve、fix、优化、iterate、迭代 | improve |
| 动画、颜色、排版、animate、color、enhance | enhance |
| 生产、production、harden、上线、i18n | harden |
| 实时、live、browser、浏览器 | live |

显式 `--chain` 优先级高于自动路由。

#### 评分驱动循环

```
执行 gate (critique/audit) → 解析评分 (critique: N/40, audit: N/20, P0/P1)
  → 评估门控 (score >= threshold AND P0 == 0)
    → PASS: 继续下一步
    → FAIL: 自动选取修复命令 → 逐个执行 → 重新 gate → 达 max_loops 则警告继续
```

<details>
<summary>完整映射表：Finding → Command</summary>

| 问题分类 | 命令 |
|---------|------|
| 视觉层次、布局、间距、对齐 | layout |
| 色彩、对比度、调色板 | colorize |
| 排版、字体、可读性 | typeset |
| 动画、运动、过渡、微交互 | animate |
| 文案、标签、错误信息 | clarify |
| 响应式、移动端、断点 | adapt |
| 性能、加载、速度 | optimize |
| 复杂度、过载、认知负荷 | distill |
| 乏味、缺乏个性 | bolder |
| 过激、过度刺激 | quieter |
| 引导、空状态、首次运行 | onboard |
| 边界情况、i18n、错误处理 | harden |
| 个性、愉悦感、惊喜 | delight |

不会被自动选取：teach、shape、craft、live、document、extract、overdrive、critique、audit
</details>

#### 状态机

```
S_PARSE → S_SETUP → S_CHAIN → S_GATE → S_REPORT
                       ↑          │
                       └─ S_REFINE ┘
```

#### 完成报告

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Chain complete: {chain_type}
 Critique : {score}/40 (trend: ↗/→/↘) | Audit: {score}/20
 Loops: {iterations} | Commands: {list}
 Status: PASS | PARTIAL — N issues remain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 2.3 maestro-ui-codify — UI 代码化

从现有源代码中逆向提取设计系统，生成参考包并固化为知识资产。

```
/maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `<source-path>` | 必填 | 包含 CSS/SCSS/JS/TS/HTML 的源目录 |
| `--package-name` | 自动生成 | 参考包名称 |
| `--output-dir` | `.workflow/reference_style` | 输出目录 |
| `--overwrite` | false | 覆盖已有包目录 |

#### 4 阶段管线

| 阶段 | 内容 | 产物 |
|------|------|------|
| **Phase 1** 验证 | 参数校验、路径验证、工作区创建 | — |
| **Phase 2** 并行提取 | Style（色彩/排版/间距）+ Animation（时长/缓动）+ Layout（布局模式） | 3 个 token JSON |
| **Phase 3** 参考包 | 复制 token + 生成交互式展示 | `preview.html` + `preview.css` |
| **Phase 4** 知识固化 | `codify-to-knowhow` skill | `knowhow-manifest.json` → knowhow + spec |

---

## 三、完整工作流

### design → craft → codify 串联

```bash
# Step 1: 设计原型
/maestro-impeccable "1" --chain build --styles 3 --targets home,dashboard,settings
# Step 2: 自动化生产（build chain）
/maestro-impeccable "新建 landing page" --chain build --threshold 28
# Step 3: 逆向提取设计系统
/maestro-ui-codify src/components --package-name my-design-system
```

**数据流向**：`ui-design` → `design-ref/` → `maestro-plan` 消费 → `ui-craft` 操作源码 → `ui-codify` 逆向提取，形成闭环。

### Phase 管线集成

```bash
/maestro-impeccable "1" --chain build  # 设计先行
/maestro-plan 1                         # 基于设计规划
/maestro-execute 1                      # 执行实现（含内置验证门控 E2.7）
```

### 单命令模式

```bash
# 改进现有 UI
/maestro-impeccable "优化首页布局" --chain improve
# 增强动效
/maestro-impeccable "添加交互动画" --chain enhance --enhance animate
# 生产加固
/maestro-impeccable "准备上线" --chain harden --threshold 30
# 逆向提取
/maestro-ui-codify src/ui --package-name company-components
```

---

## 四、使用场景

| 场景 | 命令 | 说明 |
|------|------|------|
| 新项目从零设计 UI | `impeccable --chain build` | 多方案选择后固化 |
| 已有设计需高质量实现 | `impeccable --chain build` | teach → polish 全自动 |
| 现有页面优化 | `impeccable --chain improve` | critique 驱动迭代 |
| 增强动效/排版/色彩 | `impeccable --chain enhance` | 单维度 + critique 验证 |
| 上线前加固 | `impeccable --chain harden` | audit 驱动边界处理 |
| 提取设计规范 | `ui-codify` | 逆向提取为知识资产 |
| 跨项目复用设计 | `ui-codify` + knowhow | 提取后通过知识系统共享 |

```bash
# 快速原型
/maestro-impeccable "Landing Page" --chain build -y --styles 2
# 迭代优化
/maestro-impeccable "优化 dashboard" --chain improve --threshold 30 --max-loops 5
# 设计沉淀
/maestro-ui-codify src --package-name project-design-v1
```
