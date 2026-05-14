# UI 生产系统指南

Maestro UI 生产管线覆盖从设计原型到代码实现的全生命周期，通过三个核心命令构成完整的 `design -> craft -> codify` 工作流。

---

## 一、概述

### 管线架构

```
maestro-ui-craft --chain build   maestro-ui-craft         maestro-ui-codify
  设计原型生成                    自动化生产管线              设计系统代码化
       │                        │                        │
       ▼                        ▼                        ▼
  MASTER.md               impeccable skill          design-tokens.json
  design-tokens.json      critique/audit 评分        animation-tokens.json
  animation-tokens.json   自动迭代循环               layout-templates.json
  selection.json          质量门控驱动               knowhow 资产固化
       │                        │                        │
       └────────────────────────┴────────────────────────┘
                            知识沉淀
```

### 与 Phase 管线的集成

UI 生产系统在 Maestro Phase 管线中的位置：

```
analyze -> ui-design -> plan -> execute -> verify
                         ↑
                    设计先于规划
```

`maestro-ui-craft --chain build` 产出的 `design-ref/` 目录会被 `maestro-plan` 自动检测，将设计 token 和规范注入执行任务的 `read_first[]` 列表，确保实现严格遵循设计意图。

### 与 impeccable skill 的集成

`maestro-ui-craft` 是 impeccable skill 的编排层。Impeccable 提供 23 个命令横跨 6 个分类（build、evaluate、enhance、harden、live、setup），`maestro-ui-craft` 将这些命令链式串联，通过 critique/audit 评分驱动自动迭代循环。

---

## 二、命令详解

### 2.1 maestro-ui-craft --chain build — UI 设计原型

**定位**：生成多个风格变体的设计原型，用户选择后固化为可消费的设计系统。（原 `maestro-ui-design`，现已合并入 `maestro-ui-craft`。）

**命令语法**：

```
/maestro-ui-craft "<phase|topic>" --chain build [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y]
```

**参数说明**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `<phase\|topic>` | 必填 | Phase 编号进入 phase 模式，文本进入 scratch 模式 |
| `--styles N` | 3 | 风格变体数量（2-5） |
| `--stack <stack>` | html-tailwind | 技术栈约束 |
| `--targets <pages>` | 自动推断 | 逗号分隔的页面目标 |
| `--layouts N` | 2 | 每个目标的布局变体数（1-3，仅 full 模式） |
| `--refine` | false | 精调已有设计 |
| `--persist` | false | 生成带层级页面覆盖的设计 |
| `--full` | false | 强制使用完整 4 层管线 |
| `-y` | false | 自动模式，跳过交互 |

#### 工作路径自动选择

命令根据环境自动路由到不同的工作流：

| 条件 | 路径 | 说明 |
|------|------|------|
| `--full` 标志 | ui-design.md（完整管线） | 强制 4 层管线：style -> animation -> layout -> assembly |
| ui-ux-pro-max 可用 | ui-style.md（轻量委托） | 委托给 skill 生成设计系统，快速轻量 |
| ui-ux-pro-max 不可用 | ui-design.md（完整管线） | 自包含回退路径 |

#### 设计流程（轻量路径）

1. **收集需求**：从 phase 的 context.md、brainstorm、spec 中提取产品类型、行业、受众、风格关键词
2. **生成变体**：调用 ui-ux-pro-max `--design-system` 生成 N 个对比风格方案
3. **用户选择**：展示各方案摘要（模式、色彩、排版、动效），用户选择优胜方案
4. **固化设计**：
   - 提取 design-tokens.json（OKLCH 色彩、排版、间距、组件样式）
   - 生成 animation-tokens.json（时长、缓动、过渡、关键帧）
   - 映射到 design-ref/ 目录结构
   - 写入 selection.json 记录选择元数据

#### design-ref/ 目录结构

```
design-ref/
  MASTER.md                 # 完整设计系统规范
  design-tokens.json        # 生产级设计 token（OKLCH 色彩）
  animation-tokens.json     # 动效 token
  selection.json            # 用户选择记录
  layout-templates/         # 布局模板
  prototypes/               # HTML 原型文件
    variant-1-system.md     # 风格变体原始输出
    home.html               # 页面原型
```

#### PRODUCT.md 格式

`PRODUCT.md` 是 impeccable skill 的项目上下文文件，描述产品定位、目标用户和设计方向。当文件缺失时，craft 管线会自动触发 teach 命令进行交互式创建。

#### 后续路由

| 下一步 | 命令 |
|--------|------|
| 基于设计规划 | `/maestro-plan {phase}` |
| 精调已选设计 | `/maestro-ui-craft "{phase}" --chain improve` |
| 先分析再规划 | `/maestro-analyze {phase}` |

---

### 2.2 maestro-ui-craft — UI 自动化生产管线

**定位**：通过 critique/audit 评分驱动循环，将 impeccable skill 的 23 个命令编排为自动化质量门控管线。

**命令语法**：

```
/maestro-ui-craft <intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y]
```

**参数说明**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `<intent\|target>` | 必填 | 意图描述或目标路径 |
| `--chain <type>` | 自动路由 | 强制指定链类型 |
| `--enhance <cmd>` | — | enhance 链使用的具体命令 |
| `--threshold <score>` | 26 | critique 通过阈值（满分 40） |
| `--max-loops <n>` | 3 | 质量门控最大迭代次数 |
| `-y` | false | 自动模式 |

#### Chain 类型定义

| Chain | 执行序列 | 门控条件 |
|-------|----------|----------|
| **build** | teach? -> shape -> craft -> critique -> [refine loop] -> audit -> polish | critique >= threshold 且 P0 == 0 |
| **improve** | critique -> [refine loop] -> polish -> audit | critique >= threshold 且 P0 == 0 |
| **enhance** | {cmd} -> critique -> polish (if needed) | critique >= threshold |
| **harden** | harden -> audit -> polish | audit >= threshold x 0.5 |
| **live** | live | 无门控（交互式） |

`teach?` 表示条件执行——仅在 PRODUCT.md 缺失时触发。

#### 意图自动路由

| 意图关键词 | Chain |
|-----------|-------|
| 新建、create、build、从零、landing、feature、page | build |
| 改进、improve、fix、优化、iterate、better、迭代 | improve |
| 动画、颜色、排版、animate、color、type、bold、delight、enhance | enhance |
| 生产、production、harden、上线、ship、edge case、i18n | harden |
| 实时、live、browser、浏览器、variant | live |

显式 `--chain` 优先级高于自动路由。意图模糊且无 `-y` 时会询问用户确认。

#### 评分驱动循环机制

核心创新点——critique/audit 评分驱动自动迭代：

```
执行 gate 命令 (critique/audit)
       │
       ▼
  解析评分
  - critique: N/40 (Nielsen's heuristic)
  - audit: N/20 (dimension score)
  - P0/P1 问题计数
       │
       ▼
  评估门控
  - critique_pass = (score >= threshold) AND (P0_count == 0)
  - audit_pass    = (score >= threshold * 0.5) AND (P0_count == 0)
       │
       ├── PASS ──> 继续下一个 chain 步骤
       │
       └── FAIL ──> 自动选取修复命令
                    │
                    ├── 从 P0/P1 findings 提取建议命令
                    ├── 无建议则使用分类映射表
                    ├── 去重，每次迭代最多 3 个命令
                    ├── 按优先级排序（P0 优先）
                    ├── 逐个执行修复命令
                    └── 重新运行 gate 命令
                         │
                         └── 达到 max_loops ──> 强制继续并警告
```

#### Finding 到 Command 的映射表

当 critique/audit 未给出明确建议时，按问题分类自动选取命令：

| 问题分类 | 命令 |
|---------|------|
| 视觉层次、布局、间距、对齐 | layout |
| 色彩、对比度、调色板、单色 | colorize |
| 排版、字体、可读性、层次 | typeset |
| 动画、运动、过渡、微交互 | animate |
| 文案、标签、错误信息、UX 写作 | clarify |
| 响应式、移动端、断点、触控目标 | adapt |
| 性能、加载、速度、打包体积 | optimize |
| 复杂度、过载、杂乱、认知负荷 | distill |
| 乏味、保守、通用、缺乏个性 | bolder |
| 过激、压倒性、过度刺激 | quieter |
| 引导、空状态、首次运行、激活 | onboard |
| 边界情况、国际化、错误处理、溢出 | harden |
| 个性、记忆点、愉悦感、惊喜 | delight |

以下命令不会被自动选取（结构性/交互性命令）：teach、shape、craft、live、document、extract、overdrive、critique、audit。

#### 状态机

```
S_PARSE ──> S_SETUP ──> S_CHAIN ──> S_GATE ──> S_REPORT
                            │           │
                            │    ┌──────┘
                            │    ▼
                            │  S_REFINE ──> S_GATE
                            │
                            └──── (next step) ──> S_GATE
```

#### 产物路径

craft 的产物由 impeccable 命令直接修改源文件，不产生额外的中间产物。关键状态通过 TodoWrite 跟踪进度。

#### 完成报告

执行完毕后输出标准报告：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Chain complete: {chain_type}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Critique : {score}/40 (trend: ↗/→/↘)
 Audit    : {score}/20
 Loops    : {total_iterations}
 Commands : {executed_command_list}

 Status   : PASS | PARTIAL — N issues remain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 2.3 maestro-ui-codify — UI 代码化

**定位**：从现有源代码中逆向提取设计系统，生成参考包并固化为知识资产。

**命令语法**：

```
/maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]
```

**参数说明**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `<source-path>` | 必填 | 包含 CSS/SCSS/JS/TS/HTML 的源代码目录 |
| `--package-name <name>` | 自动生成 | 参考包名称 |
| `--output-dir <path>` | `.workflow/reference_style` | 输出目录 |
| `--overwrite` | false | 允许覆盖已存在的包目录 |

#### 4 阶段管线

```
Phase 1 (inline)        Phase 2 (3 个并行 Agent)   Phase 3 (Agent)         Phase 4 (固化)
  参数验证                ┌─ Style Agent             复制 token +            Manifest +
  ├─ 解析参数             ├─ Animation Agent         生成 preview            codify-to-knowhow
  ├─ 验证源路径           └─ Layout Agent
  ├─ 包名解析             ↓                          ↓                       ↓
  └─ 工作区准备           design-tokens.json         preview.html            knowhow-manifest.json
                          animation-tokens.json      preview.css             -> knowhow 文件
                          layout-templates.json                              -> spec 条目
```

**Phase 1 — 验证与准备**：参数校验、源路径验证、包名生成、工作区创建。

**Phase 2 — 并行提取**：三个 Agent 同时运行：
- **Style Agent**：提取色彩（OKLCH）、排版、间距、阴影、组件样式
- **Animation Agent**：提取时长、缓动、过渡、关键帧、交互动效
- **Layout Agent**：提取组件布局模式（通用/专用）

**Phase 3 — 参考包**：将 token 文件复制到包目录，生成 `preview.html` + `preview.css` 交互式展示。

**Phase 4 — 知识固化**：生成 `knowhow-manifest.json`，调用 `codify-to-knowhow` skill 将设计系统固化为知识资产和 spec 条目。

#### 产物路径

```
.workflow/reference_style/{package-name}/
  design-tokens.json        # 色彩、排版、间距、组件样式 token
  animation-tokens.json     # 动效 token（可选）
  layout-templates.json     # 布局模式
  preview.html              # 交互式设计展示
  preview.css               # 展示样式
  knowhow-manifest.json     # 知识资产清单
```

---

## 三、完整工作流

### design -> craft -> codify 串联

这是 UI 生产的标准管线，三个命令按序串联：

```bash
# Step 1: 设计原型
/maestro-ui-craft "1" --chain build --styles 3 --targets home,dashboard,settings

# Step 2: 基于 design-ref 自动生产（build chain）
/maestro-ui-craft "新建 landing page" --chain build --threshold 28

# Step 3: 从实现代码中提取设计系统作为参考
/maestro-ui-codify src/components --package-name my-design-system
```

**数据流向**：
- `ui-design` 产出 `design-ref/` 供 `maestro-plan` 消费
- `ui-craft` 通过 impeccable skill 直接操作源代码
- `ui-codify` 从成品代码中逆向提取设计知识，形成闭环

### 与 Phase 管线集成

UI 设计驱动的 Phase 管线（`ui-craft-build` chain graph）：

```
ui-design -> plan -> execute -> verify -> check_verify
```

对应的命令序列：

```bash
# 设计驱动的完整 Phase 管线
/maestro-ui-craft "1" --chain build  # 先设计
/maestro-plan 1                # 基于设计规划
/maestro-execute 1             # 执行实现
/maestro-verify 1              # 验证目标达成
```

设计先于规划的关键价值：`maestro-plan` 会检测 `design-ref/MASTER.md` 的存在，将设计 token 和规范注入每个执行任务的 `read_first[]`，确保实现严格遵循设计意图。

### 仅 craft 模式（已有设计）

如果设计已经就绪或不需要设计阶段：

```bash
# 改进现有 UI
/maestro-ui-craft "优化首页布局和色彩" --chain improve

# 增强动效
/maestro-ui-craft "添加交互动画" --chain enhance --enhance animate

# 生产加固
/maestro-ui-craft "准备上线" --chain harden --threshold 30
```

### 仅 codify 模式（逆向工程）

从已有代码库提取设计系统：

```bash
# 提取组件库的设计系统
/maestro-ui-codify src/ui --package-name company-components

# 提取并覆盖已有参考
/maestro-ui-codify src/styles --package-name v2-design --overwrite
```

---

## 四、使用场景

### 什么时候用哪个命令

| 场景 | 命令 | 说明 |
|------|------|------|
| 新项目需要从零设计 UI | `maestro-ui-craft --chain build` | 生成多个风格方案，选择后固化 |
| 已有设计，需要高质量实现 | `maestro-ui-craft --chain build` | 从 teach 到 polish 全自动 |
| 现有页面需要优化 | `maestro-ui-craft --chain improve` | critique 驱动迭代改进 |
| 需要增强动效/排版/色彩 | `maestro-ui-craft --chain enhance` | 单维度增强 + critique 验证 |
| 准备上线前的加固 | `maestro-ui-craft --chain harden` | audit 驱动边界情况处理 |
| 已有代码需要提取设计规范 | `maestro-ui-codify` | 逆向提取并固化为知识资产 |
| 需要跨项目复用设计系统 | `maestro-ui-codify` + knowhow | 提取后通过知识系统共享 |

### 单命令 vs 管线模式

**单命令**适合：
- 快速探索设计方向（`ui-design` scratch 模式）
- 针对性优化某个方面（`ui-craft --chain enhance`）
- 从现有代码提取设计资产（`ui-codify`）

**管线模式**适合：
- 全新功能的 UI 生产（`design -> craft -> codify`）
- Phase 级别的完整交付（`ui-craft-build` chain graph）
- 需要质量保证的迭代循环（`craft` 的自动 refine loop）

### 常用组合

```bash
# 快速原型验证（最短路径）
/maestro-ui-craft "Landing Page" --chain build -y --styles 2

# 完整新页面生产
/maestro-ui-craft "2" --chain build --targets home,profile,settings
/maestro-ui-craft "新建用户中心" --chain build -y

# 迭代优化现有页面
/maestro-ui-craft "优化 dashboard 布局" --chain improve --threshold 30 --max-loops 5

# 动效增强
/maestro-ui-craft "丰富交互体验" --chain enhance --enhance animate

# 设计知识沉淀
/maestro-ui-codify src --package-name project-design-v1
```
