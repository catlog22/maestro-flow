import type { CommandExample } from '@/client/components/content/ExecutionFlow.js';

const examples: Record<string, CommandExample[]> = {
  'maestro': [
    {
      scenario: '全自动执行任务',
      command: 'maestro -y "实现用户认证系统"',
      steps: [
        { name: '意图解析', description: '解析用户输入的任务描述和标志位（-y, -c, --chain 等）', detail: '识别到 "实现" 关键词，自动选择实现类命令链' },
        { name: '状态读取', description: '读取 .workflow/state.json 和活跃会话状态，确定项目上下文', detail: '检测当前里程碑、阶段、已有分析结果' },
        { name: '链路选择', description: '根据意图和状态匹配预定义命令链（A-L），选择最优执行路径', detail: '匹配到 Chain B: analyze → plan → execute' },
        { name: '链路执行', description: '按顺序调用 Skill() 执行选中的命令链，每个命令的 -y 标志自动透传', detail: '依次执行 maestro-analyze → maestro-plan → maestro-execute' },
      ],
    },
  ],
  'maestro-init': [
    {
      scenario: '初始化新项目',
      command: 'maestro-init',
      steps: [
        { name: '状态检测', description: '自动检测项目状态：空目录 / 已有代码库 / 已初始化（.workflow/ 存在）', detail: '扫描项目根目录判断当前状态' },
        { name: '上游导入', description: '如果指定了 --from，从 brainstorm/blueprint 会话加载上下文包', detail: '可选步骤，导入先前分析结果' },
        { name: '目录创建', description: '创建 .workflow/ 目录结构，包含 state.json, config.json, specs/, scratch/', detail: '建立完整的工作流目录体系' },
        { name: '规范扫描', description: '扫描项目文件自动生成初始编码规范和架构规范', detail: '识别项目语言、框架、测试工具等' },
        { name: '状态写入', description: '写入初始 state.json，包含项目元数据、里程碑 v0.1.0 和阶段追踪', detail: '初始化完成，可进入 analyze/roadmap 阶段' },
      ],
    },
  ],
  'maestro-brainstorm': [
    {
      scenario: '多角色头脑风暴',
      command: 'maestro-brainstorm "在线教育平台"',
      steps: [
        { name: '主题解析', description: '解析主题或角色名参数，检测自动模式还是单角色模式', detail: '识别到文本主题，进入自动多角色模式' },
        { name: '框架生成', description: '生成分析框架，分配角色和维度映射', detail: '创建 4-6 个角色视角（如架构师、用户、安全、商业）' },
        { name: '多角色并行分析', description: '为每个角色视角生成并行分析代理，独立产出分析报告', detail: '每个角色从自身专业角度分析主题' },
        { name: '跨角色综合', description: '合并独立角色分析，识别共识和冲突点', detail: '标记各角色间的一致意见和分歧' },
        { name: '输出打包', description: '产出 .brainstorming/ 目录，包含各角色分析文件和统一综合文档', detail: '可通过 --from brainstorm:ID 导入下游命令' },
      ],
    },
  ],
  'maestro-analyze': [
    {
      scenario: '宏观需求分析',
      command: 'maestro-analyze "多租户架构改造"',
      steps: [
        { name: '模式检测', description: '检测分析模式 — 文本参数触发 Macro 宏观分析，数字参数触发 Micro 微观分析', detail: '文本参数 → Macro 模式：探索需求影响面' },
        { name: '上下文收集', description: '加载上游上下文包，读取代码库结构，扫描相关模块', detail: '构建完整的分析上下文' },
        { name: '多维度分析', description: 'Macro: 探索需求范围和影响区域；评估复杂度、风险、依赖关系', detail: '分析 6 个维度：复杂度/风险/依赖/测试/架构/性能' },
        { name: '范围裁决', description: '产出 scope_verdict（large/medium/small），决定后续路由', detail: 'large → roadmap 分解；medium/small → 直达 plan' },
        { name: '输出生成', description: '生成 analysis.md 叙述文档和 context.md 结构化上下文包', detail: '下游命令通过 --from analyze:ANL-xxx 消费' },
      ],
    },
    {
      scenario: '微观 Phase 级分析',
      command: 'maestro-analyze 1',
      steps: [
        { name: '模式检测', description: '数字参数触发 Micro 微观分析，定位到 Phase 1', detail: '读取 roadmap 中 Phase 1 的定义' },
        { name: '上下文收集', description: '加载 Phase 1 的上下文，扫描涉及的模块和文件', detail: '精确定位 Phase 涉及的代码范围' },
        { name: '6 维度评分', description: '对 Phase 进行 6 维度深度分析：复杂度、风险、依赖、测试、架构、性能', detail: '每个维度 1-5 分评分，附带详细说明' },
        { name: '输出生成', description: '生成 Phase 级 analysis.md 和 context.md，直接供 plan 消费', detail: '可直接执行 /maestro-plan 1 进入规划' },
      ],
    },
  ],
  'maestro-roadmap': [
    {
      scenario: '创建项目路线图',
      command: 'maestro-roadmap -y',
      steps: [
        { name: '需求解析', description: '解析需求文本并加载上游上下文（来自 analyze 或 brainstorm）', detail: '消费 analyze 宏观产出的 scope_verdict 和影响面分析' },
        { name: '需求分解', description: '将需求分解为里程碑级别的可交付物，支持渐进式或直接式分解', detail: '按功能边界划分独立可交付的版本节点' },
        { name: 'Phase 规划', description: '为每个里程碑定义执行阶段，包含范围、依赖和验收标准', detail: '每个 Phase 有明确的输入/输出和完成定义' },
        { name: '审查与精化', description: '展示路线图供用户审查，根据反馈迭代（-y 自动跳过）', detail: '支持 --revise 随时修订路线图' },
        { name: '持久化', description: '写入 roadmap.json 并更新 state.json 的里程碑/阶段结构', detail: '后续通过 /maestro-analyze N 对各 Phase 深入分析' },
      ],
    },
  ],
  'maestro-plan': [
    {
      scenario: '规划 Phase 实现方案',
      command: 'maestro-plan 1',
      steps: [
        { name: 'Explore 探索', description: '收集代码库上下文 — 读取相关文件、分析依赖关系、理解当前架构', detail: '自动识别涉及的模块、接口和测试文件' },
        { name: 'Clarify 澄清', description: '识别需求中的模糊点并提出澄清问题（-y 模式自动跳过）', detail: '确保所有歧义在规划前解决' },
        { name: 'Plan 规划', description: '将工作分解为波次（wave），定义并行/串行任务，产出 plan.json', detail: '每个任务有明确的修改范围、依赖和验证方式' },
        { name: 'Check 检查', description: '验证计划的碰撞风险、依赖完整性和规范合规性', detail: '检测任务间的文件修改冲突和遗漏' },
        { name: 'Confirm 确认', description: '向用户展示计划摘要，等待批准后进入执行（-y 自动批准）', detail: '计划确认后可执行 /maestro-execute 1' },
      ],
    },
  ],
  'maestro-execute': [
    {
      scenario: '执行 Phase 计划',
      command: 'maestro-execute 1',
      steps: [
        { name: '计划加载', description: '加载目标 Phase 目录下的 plan.json，验证任务定义完整性', detail: '检查 plan.json 格式和任务依赖关系' },
        { name: '波次调度', description: '按依赖顺序将任务编排到执行波次中', detail: '同波次内的任务可并行执行，波次间串行' },
        { name: '任务执行', description: '使用配置的方法（agent/codex/gemini/cli/auto）执行每个任务', detail: '每个任务独立执行，修改代码并产出产物' },
        { name: '验证门控', description: '对每个完成的任务运行内置验证检查', detail: '检查代码编译、测试通过、lint 合规' },
        { name: '原子提交', description: '按任务（或按波次）提交变更，附带描述性 commit 信息', detail: '每个提交可独立回滚，确保变更可追踪' },
      ],
    },
  ],
  'maestro-quick': [
    {
      scenario: '快速修复 Bug',
      command: 'maestro-quick "修复登录页密码验证逻辑"',
      steps: [
        { name: '任务解析', description: '解析任务描述，检测执行模式（默认 / --full / --discuss）', detail: '默认模式跳过完整规划，快速执行' },
        { name: '快速分析', description: '轻量级代码库扫描，识别受影响文件和修改方案', detail: '定位相关文件和函数' },
        { name: '实现', description: '直接执行修改 — 编辑代码、创建文件、运行命令', detail: '按分析结果修改代码' },
        { name: '验证', description: '运行相关测试和 lint 检查验证变更（--full 模式扩展验证范围）', detail: '确保修改不引入回归' },
        { name: '提交', description: '自动提交变更并附带描述性信息', detail: '一步完成 Bug 修复' },
      ],
    },
  ],
  'quality-review': [
    {
      scenario: '标准代码审查',
      command: 'quality-review 1 --level standard',
      steps: [
        { name: '范围检测', description: '识别目标 Phase 中变更的文件，确定审查范围', detail: '基于 git diff 识别变更' },
        { name: '规范加载', description: '加载相关的编码规范和架构约束作为审查上下文', detail: '从 specs/ 加载项目特定规范' },
        { name: '并行审查', description: '生成维度专用审查代理（正确性、安全、架构、性能、测试、风格）', detail: '多个代理并行审查不同维度' },
        { name: '严重性分级', description: '将发现分类为 BLOCK（必须修复）、WARN（建议修复）、INFO（建议）', detail: '按影响程度和修复优先级排序' },
        { name: '报告生成', description: '产出结构化 review.json，为 BLOCK 级问题自动创建 Issue', detail: '审查完成，可进入测试或修复流程' },
      ],
    },
  ],
  'quality-auto-test': [
    {
      scenario: '自动生成和执行测试',
      command: 'quality-auto-test 1',
      steps: [
        { name: '策略选择', description: '自动路由到测试来源：spec 驱动（从 PRD）/ gap 驱动（覆盖率）/ code 驱动（探索）', detail: '智能选择最合适的测试生成策略' },
        { name: '测试生成', description: '按 CSV 层级管线生成测试 — L0（静态）, L1（单元）, L2（集成）, L3（E2E）', detail: '渐进式从低层到高层生成' },
        { name: '并行执行', description: '按配置的并发数运行生成的测试，按层捕获结果', detail: '并行提升执行速度' },
        { name: '失败诊断', description: '对失败的测试自动诊断根因，区分代码 Bug 和测试 Bug', detail: '避免误报，精确定位问题' },
        { name: '迭代收敛', description: '修复测试 Bug 并重新运行，直到收敛或达到最大迭代次数', detail: '通常 2-3 轮迭代后稳定' },
      ],
    },
  ],
  'odyssey-debug': [
    {
      scenario: '深度调试复杂 Bug',
      command: 'odyssey-debug "WebSocket 连接间歇性断开"',
      steps: [
        { name: '考古', description: '从 git 历史、日志、错误信息和相关代码中收集证据，理解 Bug 时间线', detail: '追溯 Bug 引入时间和上下文变更' },
        { name: '假设生成', description: '基于收集的证据形成多个关于根因的假设', detail: '考虑多种可能的原因' },
        { name: '诊断', description: '通过定向代码阅读、插桩和复现尝试测试每个假设', detail: '逐一验证或排除假设' },
        { name: '修复实现', description: '为确认的根因实现修复，最小化影响范围', detail: '精确修复，避免引入新问题' },
        { name: '确认', description: '验证修复解决了原始问题且未引入回归', detail: '运行完整测试套件' },
        { name: '泛化', description: '扫描代码库中类似模式，查找可能有相同 Bug 的位置', detail: '预防性修复同类问题' },
        { name: '知识持久化', description: '记录 Bug 模式、修复方案和预防策略作为可复用知识', detail: '沉淀到知识库供未来参考' },
      ],
    },
  ],
  'odyssey-improve': [
    {
      scenario: '深度代码改进',
      command: 'odyssey-improve "优化 API 响应性能"',
      steps: [
        { name: '现状调查', description: '评估依赖健康度、复杂度热点、测试覆盖缺口、错误处理模式', detail: '全面了解当前状态' },
        { name: '6 维度审计', description: '并行深度审计：性能、安全、架构、可靠性、可观测性、可维护性', detail: '多维度交叉审查' },
        { name: '根因诊断', description: '对关键和高严重度发现进行假设驱动的根因分析', detail: '不修表面症状，找到根本原因' },
        { name: '改进实现', description: '按严重性层级为诊断的根因实现改进', detail: '从 critical → high → medium 逐级修复' },
        { name: '验证', description: '通过前后指标对比和回归测试量化改进效果', detail: '用数据证明改进有效' },
        { name: '泛化扫描', description: '从修复中提取模式，在 4 个层面扫描代码库中类似问题', detail: '语法/语义/结构/历史四层扫描' },
        { name: '发现分类', description: '对泛化扫描命中分类并路由到修复、创建 Issue 或跳过', detail: '确保每个发现都有处理结果' },
        { name: '知识记录', description: '持久化改进指标和工程经验供未来参考', detail: '记录 before/after 对比和最佳实践' },
      ],
    },
  ],
  'odyssey-planex': [
    {
      scenario: '需求驱动的迭代实现',
      command: 'odyssey-planex "实现 OAuth2 登录流程"',
      steps: [
        { name: '需求解析', description: '解析验收标准并建立可量化的成功条件', detail: '明确每个验收项的判定方法' },
        { name: '计划生成', description: '创建实现计划，包含任务分解和依赖排序', detail: '产出可执行的任务列表' },
        { name: '执行', description: '按计划实现任务，增量提交', detail: '每个任务独立提交' },
        { name: '严格验证', description: '逐项验证每个验收标准，附带实现证据', detail: '确保每个标准都有对应证据' },
        { name: '修复循环', description: '对未通过的标准：诊断缺口 → 生成修复计划 → 重新执行 → 重新验证（循环直到全部通过）', detail: '闭环迭代直到完全满足需求' },
        { name: '知识持久化', description: '记录需求到实现的映射和经验教训', detail: '沉淀需求实现最佳实践' },
      ],
    },
  ],
};

export function getCommandExamples(commandName: string): CommandExample[] | undefined {
  return examples[commandName];
}

export function hasCommandExamples(commandName: string): boolean {
  return commandName in examples;
}
