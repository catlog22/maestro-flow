# Maestro Flow 介绍

## 背景

7.0 版本半个月前就已发布，但总觉得缺了点什么，迟迟没有发帖介绍。期间尝试设计了不同形式的工作流（DDD、IDAW 等，最新版本已移除），但直觉告诉我那不是最终答案。直到最近学习了 GSD 工作流，才想明白 CCW 缺了什么——于是重新梳理了 CCW 的定位，以及下一代工作流的构想。

## 思考

在我看来，当前 CCW 更像一把 Superpower：依靠 ACE、CodexLens 等向量搜索能力，以**代码为唯一真理源**进行设计。这套思路灵活高效，我给它的定位是——适合**中小型项目和科研场景**。

对比 GSD，CCW 主要缺少两样东西：**规范化的产物复用**和**严格的步骤执行**。GSD 以路线图和代码为双重真相源进行设计，从理论上讲，这套规范更适合**大型项目和团队协作**。

## 融合：Maestro Flow

下一代工作流命名为 **Maestro Flow**，专注于 Claude 与 Codex 双引擎设计，融合了：

- **GSD** 的路线图驱动 + 阶段管线
- **CCW** 的多阶段 Spec 规范约束、头脑风暴、Issue 闭环工作流、全自动推进命令

其中 Codex 工作流进行了针对性的重新设计，解决多 Agent 协作的调度与一致性问题。新设计了 **Supervisor 机制**——你可以将 Supervisor 理解为一个特异化的 OpenClaw，用于控制工作流推进，具备长期记忆和自学习能力。

**36 个命令，4 大类别，覆盖项目全生命周期：**

| 类别 | 命令数 | 前缀 | 职责 |
|------|--------|------|------|
| **核心工作流** | 15 | `maestro-*` | 项目初始化、规划、执行、验证、阶段推进 |
| **管理** | 9 | `manage-*` | Issue 管理、代码库文档、内存、状态 |
| **质量** | 7 | `quality-*` | 代码审查、测试、调试、重构、同步 |
| **规范** | 4 | `spec-*` | 项目规范初始化、加载、映射、录入 |

全局入口 `/maestro` 是智能协调器，根据用户意图和项目状态自动选择最优命令链——一句话启动，全自动推进。

**命令全景图**展示了四条核心管线的衔接关系：

```
入口: /maestro (智能协调器，意图路由)
       │
       ├─→ 项目初始化: brainstorm → init → roadmap / spec-generate → [ui-design]
       │
       ├─→ Phase 管线 (每阶段循环):
       │     analyze → plan → execute → verify → review → test → phase-transition
       │       ↑                                    │
       │       └──── gaps/失败 → plan --gaps ───────┘
       │
       ├─→ Issue 闭环 (与 Phase 并行):
       │     discover → create → analyze → plan → execute → close
       │     (Commander Agent 可全自动驱动)
       │
       ├─→ 质量管线: review → test-gen → test → debug → integration-test
       │
       └─→ 快速渠道: /maestro-quick | analyze -q → plan --dir → execute --dir
```

Phase 管线和 Issue 闭环是两条并行工作流——Phase 执行中的 review/verify/test 会自动产出 Issue，Issue 修复后代码回注 Phase，由 Commander Agent 统一调度，形成**自驱动闭环**。

当前工作流已设计完毕，等待看板优化完毕后即可正式发布。
