---
title: "Maestro 命令使用指南"
---

Maestro 命令系统包含 53 个 slash 命令，分为 9 大类。本文档提供命令全景图和核心工作流导航。

## 命令总览

| 类别 | 命令数 | 前缀 | 职责 |
|------|--------|------|------|
| **核心工作流** | 16 | `maestro-*` | 项目初始化、规划、执行、验证、coordinate、milestones、overlays |
| **管理** | 12 | `manage-*` | Issue 生命周期、代码库文档、知识捕获、记忆管理、harvest、status |
| **质量** | 9 | `quality-*` | 代码审查、业务测试、UAT、调试、重构、复盘、同步 |
| **规范** | 3 | `spec-*` | 项目规范初始化、加载、录入 |
| **学习** | 5 | `learn-*` | 统一复盘（git+决策）、跟读学习、模式拆解、系统探究、多视角分析 |
| **知识图谱** | 2 | `wiki-*` | 连接发现、知识摘要 |

全局入口 `/maestro` 是智能协调器，根据用户意图和项目状态自动选择最优命令链。

---

## 命令全景图

```mermaid
graph TB
    subgraph entry["入口"]
        M["/maestro 智能协调器"]
    end

    subgraph init["项目初始化"]
        BS["/maestro-brainstorm"]
        INIT["/maestro-init"]
        RM["/maestro-roadmap"]
        SG["/maestro-spec-generate"]
        UID["/maestro-impeccable"]
    end

    subgraph pipeline["Milestone 管线"]
        AN["/maestro-analyze"]
        PL["/maestro-plan"]
        EX["/maestro-execute"]
        VF["/maestro-verify"]
    end

    subgraph quality["质量管线"]
        QR["/quality-review"]
        QAT["/quality-auto-test"]
        QT["/quality-test"]
        QD["/quality-debug"]
        QRF["/quality-refactor"]
        QS["/quality-sync"]
    end

    subgraph issue["Issue 闭环"]
        ID["/manage-issue-discover"]
        IC["/manage-issue create"]
        IA["/maestro-analyze --gaps"]
        IP["/maestro-plan --gaps"]
        IE["/maestro-execute"]
        ICL["/manage-issue close"]
    end

    subgraph milestone["里程碑"]
        MA["/maestro-milestone-audit"]
        MC["/maestro-milestone-complete"]
    end

    subgraph quick["快速渠道"]
        MQ["/maestro-quick"]
        LP["/workflow-lite-plan"]
    end

    M -->|意图路由| init
    M -->|意图路由| pipeline
    M -->|"continue"| pipeline
    M -->|quick| quick

    BS -.->|可选| INIT
    INIT --> RM
    INIT --> SG
    RM --> PL
    SG --> PL
    UID -.->|可选| PL

    AN -->|"多次"| AN
    AN --> PL
    PL -->|"多次 revise, 碰撞检测"| PL
    PL -->|"逐个执行, wave 并行"| EX
    EX --> VF
    VF --> QAT
    QAT --> QR
    QR --> QT
    QT -->|所有 Phase 完成| MA

    VF -->|"gaps"| AN
    QAT -->|"失败"| PL
    QT -->|"失败"| QD
    QD -->|"修复"| PL

    ID --> IC
    IC --> IA
    IA --> IP
    IP --> IE
    IE -->|resolved| ICL

    MA --> MC
    MC -->|下一 Milestone| AN
```

---

## 主干与 Issue 的交互关系

```mermaid
graph TB
    subgraph phase_pipeline["主干 Milestone 管线"]
        direction LR
        AN["analyze"] -->|"多次"| AN
        AN --> PL["plan"] -->|"revise"| PL -->|"逐个执行"| EX["execute"] --> VF["verify"]
        VF --> QBT["business-test"] --> QR["review"] --> QT["test"] --> MA["milestone-audit"]
    end

    subgraph issue_loop["Issue 闭环"]
        direction LR
        ID["discover"] --> IC["create"] --> IA["analyze --gaps"]
        IA --> IP["plan --gaps"] --> IE["execute"] --> ICL["close"]
    end

    subgraph shared["共享基础设施"]
        JSONL[("issues.jsonl")]
        CMD["Commander Agent"]
        SCHED["ExecutionScheduler"]
        WS["WebSocket"]
    end

    QR -->|"review 发现问题, auto-create Issue"| IC
    QBT -->|"业务规则失败, 创建 Issue"| IC
    QT -->|"test 失败, 创建 Issue"| IC
    VF -->|"verify gaps, 产生 Issue"| IC

    IC -->|"phase_id 关联, path=workflow"| phase_pipeline
    IE -->|"修复代码, 服务于 Phase"| EX

    CMD -->|"调度 Phase 任务"| SCHED
    CMD -->|"自动 analyze --gaps"| IA
    CMD -->|"自动 plan --gaps"| IP

    IC --> JSONL
    IA --> JSONL
    IP --> JSONL
    IE --> JSONL
```

### Issue 两种处理路径

| path | 含义 | 来源 | 生命周期 |
|------|------|------|----------|
| `standalone` | 独立 Issue，不绑定 Phase | 手动创建、`/manage-issue-discover`、外部导入 | 独立闭环，不影响 Phase 推进 |
| `workflow` | Phase 关联 Issue | `quality-review` auto-create、`quality-auto-test` 失败产生、Phase 验证产生 | 可能阻塞 milestone 完成 |

---

## 一、主干工作流

### 项目初始化

```
/maestro-init → /maestro-roadmap 或 /maestro-spec-generate
```

| 步骤 | 命令 | 作用 | 产出 |
|------|------|------|------|
| 0 | `/maestro-brainstorm` (可选) | 多角色头脑风暴 | guidance-specification.md |
| 1 | `/maestro-init` | 初始化 .workflow/ 目录 | state.json, project.md, specs/ |
| 2a | `/maestro-roadmap` | 轻量路线图 | roadmap.md |
| 2b | `/maestro-spec-generate` | 完整规范链（7 阶段） | PRD + 架构文档 + roadmap.md |

### Milestone 管线

```
analyze → plan → execute → verify → review → test → milestone-audit → milestone-complete
```

| 阶段 | 命令 | 产出 | Artifact |
|------|------|------|----------|
| 分析 | `/maestro-analyze` | context.md, analysis.md | ANL-{NNN} |
| 规划 | `/maestro-plan` | plan.json + TASK-*.json | PLN-{NNN} |
| 执行 | `/maestro-execute` | .summaries/, 代码变更 | EXC-{NNN} |
| 验证 | `/maestro-verify` | verification.json | VRF-{NNN} |
| 审计 | `/maestro-milestone-audit` | audit-report.md | — |
| 完成 | `/maestro-milestone-complete` | 归档到 milestones/ | — |

**Scope 路由**：无参数 = milestone 全量；数字 = 指定 phase；文本 = adhoc/standalone。`--dir` 直接指定上游产物路径。

### 五种使用模式

**A. 全量模式**：`analyze → plan → execute → verify`（一步覆盖所有 phase）

**B. 逐 Phase**：`analyze 1 → plan 1 → execute 1`（每个 phase 独立）

**C. 混合模式**：全量分析 + 逐 phase 执行 + 中途 adhoc

**D. 统一规划**：`analyze 1 → analyze 2 → plan → execute`（分析后统一规划）

**E. 独立模式**：`analyze "topic" → plan --dir → execute --dir`（无需 init/roadmap）

---

## 二、快速渠道

```bash
/maestro-quick "修复登录页面 bug"              # 最短路径
/maestro-quick --full "重构 API 层"            # 带规划验证
/maestro-quick --discuss "数据库迁移方案"       # 带决策提取

# Scratch 模式（无需 init）
/maestro-analyze "实现 JWT 认证"               # scope=standalone
/maestro-plan --dir scratch/20260420-analyze-xxx
/maestro-execute --dir scratch/20260420-plan-xxx

# Lite 链
/workflow-lite-plan "实现 Issue 闭环系统"      # 探索→规划→执行→测试
```

---

## 三、Issue 闭环

```
发现 → 创建 → 分析 → 规划 → 执行 → 关闭
```

```bash
/manage-issue-discover by-prompt "检查 API 的错误处理"
/manage-issue create --title "内存泄漏" --severity high
/maestro-analyze --gaps ISS-xxx                 # 根因分析
/maestro-plan --gaps                            # 方案规划
/maestro-execute                                # 执行修复
/manage-issue close ISS-xxx --resolution "Fixed"
```

**Commander Agent** 可自动推进未分析的 Issue，按 `execute > analyze > plan` 优先级调度。

---

## 四、质量管线

```bash
/maestro-execute → /maestro-verify → /quality-auto-test → /quality-review → /quality-test → /maestro-milestone-audit
```

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `/quality-auto-test {N}` | 智能路由测试（spec/gap/code） | `--re-run` `--dry-run` |
| `/quality-review {N}` | 分层代码审查 | `--level quick\|standard\|deep` |
| `/quality-test {N}` | 会话式 UAT | `--auto-fix` |
| `/quality-debug` | 假设驱动调试 | `--from-uat {N}` `--parallel` |
| `/quality-refactor` | 技术债务治理 | `[scope]` |

**修复循环**：`verify gaps → plan --gaps → execute → verify` 或 `test 失败 → debug → plan --gaps → execute`

---

## 五、协调器命令链

```bash
/maestro "实现用户认证模块"          # 意图识别 → 自动选择命令链
/maestro -y "添加 OAuth 支持"        # 全自动模式
/maestro continue                    # 自动执行下一步
```

| 链名 | 命令序列 | 适用场景 |
|------|----------|----------|
| `full-lifecycle` | init→spec-generate→...→milestone-audit | 全新项目 |
| `roadmap-driven` | init→roadmap→... | 轻量路线图 |
| `brainstorm-driven` | brainstorm→init→roadmap→... | 从头脑风暴开始 |
| `analyze-plan-execute` | analyze→plan→execute | 快速执行 |
| `quality-loop` | review→test→debug | 质量流水线 |
| `milestone-close` | milestone-audit→milestone-complete | 关闭里程碑 |
| `quick` | quick task | 即时小任务 |

---

## 六、规范与知识

```bash
/spec-setup                                     # 扫描项目生成规范
/spec-add coding "所有 API 使用 Hono 框架"       # 录入规范
/spec-load --role implement                     # 加载规范
/manage-codebase-refresh                        # 增量刷新代码库文档
/manage-knowhow search "认证"                   # 搜索知识复用
/manage-status                                  # 项目仪表板
```

---

## 专题指南

| 专题 | 指南 |
|------|------|
| 质量管线详细说明 | [Quality Pipeline Guide](./quality-pipeline-guide.md) |
| Issue 发现与闭环 | [Issue Discover Guide](./issue-discover-guide.md) |
| 学习工具集 | [Learn Tools Guide](./learn-tools-guide.md) |
| 知识图谱管理 | [Knowledge Management Guide](./knowledge-management-guide.md) |
| CLI 命令参考 | [CLI Commands Guide](./cli-commands-guide.md) |
| Spec 规范系统 | [Spec System Guide](./spec-system-guide.md) |
| Spec 注入机制 | [Spec Injection Guide](./spec-injection-guide.md) |
| MCP 工具参考 | [MCP Tools Guide](./mcp-tools-guide.md) |
| Delegate 异步委托 | [Delegate Async Guide](./delegate-async-guide.md) |
| Overlay 命令扩展 | [Overlay Guide](./overlay-guide.md) |
| Hooks 自动化 | [Hooks Guide](./hooks-guide.md) |
