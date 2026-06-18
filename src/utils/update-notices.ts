/**
 * update-notices.ts — Version-keyed update notices for `maestro update`.
 *
 * Each notice describes what a release introduced and (optionally) interactive
 * actions the user can run after upgrading. The framework is invoked by
 * `maestro update` post-`npm install` so the running code is from the NEW
 * binary, ensuring the latest notice registry is loaded.
 *
 * Registry pattern mirrors migration-registry.ts. New notices are appended
 * at the bottom of this file and run automatically for any user whose old
 * version is below the notice's `version` field.
 */

import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoticeAction {
  /** Stable id (used in logs / skip lists). */
  id: string;
  /** One-line description shown to the user / used as prompt text. */
  description: string;
  /** Run without prompting when true. Use sparingly for non-destructive ops. */
  auto?: boolean;
  /** Default response when prompting (true = "Y/n", false = "y/N"). */
  defaultYes?: boolean;
  /** Returns a short summary line on success. Throw to mark as failed. */
  run: (ctx: NoticeContext) => Promise<string> | string;
}

export interface UpdateNotice {
  /** Version that introduced this notice (e.g. "0.4.9"). */
  version: string;
  /** Short title for the section header. */
  title: string;
  /** 1-5 short bullets shown before the actions. */
  highlights: string[];
  /** Interactive or auto actions to perform on upgrade. */
  actions: NoticeAction[];
}

export interface NoticeContext {
  fromVersion: string;
  toVersion: string;
  /** Whether the parent flow is non-interactive (CI/scripts). */
  nonInteractive: boolean;
}

export interface NoticeRunOptions {
  /** Don't execute actions, just print what would run. */
  dryRun?: boolean;
  /** Skip prompts; use each action's `defaultYes` value. */
  nonInteractive?: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const NOTICES: UpdateNotice[] = [];

export function registerNotice(notice: UpdateNotice): void {
  if (NOTICES.some(n => n.version === notice.version && n.title === notice.title)) return;
  NOTICES.push(notice);
}

export function listNotices(): readonly UpdateNotice[] {
  return [...NOTICES].sort((a, b) => compareSemver(a.version, b.version));
}

/**
 * Return notices that apply to the upgrade range (fromVersion, toVersion].
 * Pass an empty fromVersion ("" or "0.0.0") to list everything up to toVersion.
 */
export function planNotices(fromVersion: string, toVersion?: string): UpdateNotice[] {
  const from = fromVersion || '0.0.0';
  return listNotices().filter(n => {
    if (compareSemver(n.version, from) <= 0) return false;
    if (toVersion && compareSemver(n.version, toVersion) > 0) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Render the plan to stderr (header + highlights, no execution). */
export function printNoticePlan(plan: UpdateNotice[]): void {
  if (plan.length === 0) {
    console.error('  No pending update notices.');
    return;
  }
  console.error('');
  console.error(`  Update notices (${plan.length}):`);
  for (const notice of plan) {
    console.error('');
    console.error(`    ▸ v${notice.version} — ${notice.title}`);
    for (const h of notice.highlights) console.error(`        • ${h}`);
    if (notice.actions.length > 0) {
      console.error('      Actions:');
      for (const a of notice.actions) {
        const tag = a.auto ? '[auto]' : `[ask, default=${a.defaultYes ? 'Y' : 'N'}]`;
        console.error(`        ${tag} ${a.id} — ${a.description}`);
      }
    }
  }
  console.error('');
}

/**
 * Execute each notice's actions in order. Prompts the user for non-auto
 * actions unless opts.nonInteractive is true. Failures are logged but never
 * abort the loop — the rest of the notices still get a chance to run.
 */
export async function applyNotices(
  plan: UpdateNotice[],
  fromVersion: string,
  toVersion: string,
  opts: NoticeRunOptions = {},
): Promise<void> {
  if (plan.length === 0) return;

  const ctx: NoticeContext = {
    fromVersion,
    toVersion,
    nonInteractive: opts.nonInteractive ?? false,
  };

  let confirmFn: ((options: { message: string; default?: boolean }) => Promise<boolean>) | undefined;
  if (!opts.nonInteractive && !opts.dryRun) {
    try {
      const mod = await import('@inquirer/prompts');
      confirmFn = mod.confirm;
    } catch {
      // No prompts available — fall back to defaults
      ctx.nonInteractive = true;
    }
  }

  for (const notice of plan) {
    console.error('');
    console.error(`  ▸ v${notice.version} — ${notice.title}`);
    for (const h of notice.highlights) console.error(`      • ${h}`);
    console.error('');

    for (const action of notice.actions) {
      let shouldRun = action.auto ?? false;
      if (!shouldRun) {
        if (opts.dryRun) {
          console.error(`      [dry-run] ${action.id} — ${action.description}`);
          continue;
        }
        if (ctx.nonInteractive || !confirmFn) {
          shouldRun = action.defaultYes ?? false;
        } else {
          try {
            shouldRun = await confirmFn({
              message: action.description,
              default: action.defaultYes ?? true,
            });
          } catch {
            shouldRun = false; // user cancelled (Ctrl+C)
          }
        }
      }

      if (!shouldRun) {
        console.error(`      [skip] ${action.id}`);
        continue;
      }

      if (opts.dryRun) {
        console.error(`      [dry-run] ${action.id} — ${action.description}`);
        continue;
      }

      try {
        const summary = await action.run(ctx);
        console.error(`      [+] ${action.id}: ${summary}`);
      } catch (err) {
        console.error(`      [x] ${action.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function runShell(cmd: string): string {
  execSync(cmd, { stdio: 'inherit' });
  return cmd;
}

// ===========================================================================
// Registered notices — newest at the bottom
// ===========================================================================

registerNotice({
  version: '0.4.9',
  title: 'Antigravity CLI (agy) support',
  highlights: [
    '新增 agy 工具：Google Antigravity CLI 作为 delegate target',
    'cli-tools.json 升级时自动追加缺失工具条目（保留你已自定义的字段）',
    '`.agy/skills/` 含 57 个 commands + 11 个 skills（从 .claude/ 转换）',
    '`.agy/agents/` 含 22 个 sub-agent 定义（供 define_subagent 加载）',
    'Antigravity hooks 接口已预留（AGY_HOOK_DEFS / --agy-hooks 标志）',
  ],
  actions: [
    {
      id: 'install-agy-global',
      description: '为全局 ~/.gemini/ 安装 agy skills + agents + GEMINI.md 注入（约 5 MB）',
      defaultYes: true,
      run: () => runShell('maestro install --force --global --components agy-context,agy-skills,agy-agents,agy-md-chinese'),
    },
  ],
});

registerNotice({
  version: '0.4.11',
  title: 'Multi-CLI/IDE MCP registration + neutral .agents/ mirror',
  highlights: [
    '`install` 新增 7 个可选 MCP 目标：Cursor / Qoder / Trae / Kiro / Roo / VS Code Copilot / Gemini CLI',
    'ExtraMcpConfig 多选 TUI：默认全部不勾选，目标路径在 UI 中可见',
    '新增中性 `.agents/` 镜像（从 .claude/ 转换）+ 8 个 opt-in 组件给非 Claude IDE',
    'maestro-ralph 状态机重排：goal-checklist 与 status.json 单一信息源对齐',
    '新增快速入门页面（QuickStartPage）+ docs-site 布局/样式重构',
  ],
  actions: [
    {
      id: 'install-neutral-agents-global',
      description: '为全局 ~/.agents/ 安装中性 skills + agents（供 Cursor/Qoder/Trae/Kiro/Roo/VS Code 等通用 IDE 使用）',
      defaultYes: false,
      run: () => runShell('maestro install --force --global --components agents-standard-skills,agents-standard-agents'),
    },
  ],
});

registerNotice({
  version: '0.4.12',
  title: '工作流拓扑重构 + maestro-amend + context-package 统一',
  highlights: [
    'blueprint 独立命令、Milestone 层级重排、双层 analyze 架构',
    '新增 maestro-amend skill：生成工作流命令 overlay',
    'context-package 体系统一，harvest --prune 支持 state.json 管理',
    'analyze/brainstorm/roadmap 三命令新增 interview_protocol',
    'spec 工具 seed 模板单一来源 + YAML frontmatter 保证',
  ],
  actions: [],
});

registerNotice({
  version: '0.4.16',
  title: 'Ralph CLI 子命令族 + 三存储知识淘汰入口',
  highlights: [
    '新增 maestro ralph 子命令族（session/skills/next/check/complete）+ step 加载脚本化',
    '新增 manage-knowledge-audit 命令：spec / wiki / knowhow 三存储的对称淘汰入口',
    'ralph-execute 描述精简：A_EXEC_STEP 改为纯指令、路径展开 + emit 格式重设计',
    'statusline line 2 链式渲染简化，48h 过期 + 兼容旧 schema',
    'install manifest 记录 hook level，TUI 默认值从上次安装恢复',
  ],
  actions: [],
});

registerNotice({
  version: '0.4.18',
  title: '统一知识检索 + maestro-next 单链推荐',
  highlights: [
    '新增 codebase/session 虚拟节点：wiki 检索自动聚合源码与当前会话',
    '新增 workflows/finish-work.md：收尾工作流统一驱动 store-knowhow',
    '新增 maestro-next 命令：从命令池单链推荐下一步并执行',
    'ralph CLI 同时识别 maestro-* 与 ralph-* 两类 session',
    '统一 codex skills spawn_agents_on_csv 契约：强制 worker 终止 + 严格 output_schema',
  ],
  actions: [],
});

registerNotice({
  version: '0.4.19',
  title: 'team-swarm 蚁群智能 + Agy hooks 安装支持',
  highlights: [
    '新增 team-swarm 技能：ACO 驱动多智能体探索 + 信息素优化控制器',
    '安装器新增 Agy (Antigravity) hooks 配置步骤，与 Claude/Codex hooks 独立',
    'InstallFlow 改为按 scope+target 加载 manifest 默认值，避免跨 scope 污染',
    'maestro-next 命令优化：单链推荐改进 + 多源 session 识别',
  ],
  actions: [],
});

registerNotice({
  version: '0.4.20',
  title: 'UA 知识图谱集成 + Swarm Workflow 并行加速',
  highlights: [
    '新增 Understand-Anything 知识图谱：深度集成 Wiki 搜索与 codebase-rebuild 管道',
    '新增 maestro-swarm-workflow 并行加速层：8 个固定 Workflow 脚本覆盖核心命令',
    '新增 maestro-companion 技能：任务上下文管理与知识路由',
    'plan 命令修复：P3 agent 强制调用 + read_first/action 字段对齐',
  ],
  actions: [],
});

registerNotice({
  version: '0.4.21',
  title: '原生图索引模块 + 对抗蚁群工作流',
  highlights: [
    '移除 UA 外部依赖，创建原生 src/graph/ 模块：类型、合并、加载、查询、FsAnalyzer',
    '新增 maestro kg index 命令：本地代码库扫描生成 knowledge-graph.json',
    '图索引增强：调用图提取(calls)、测试配对(tested_by)、git 感知枚举、拓扑排序 tour',
    '新增 team-adversarial-swarm：ACO 蚁群 + 模块化 Workflow + 对抗决策门',
    '新增 maestro-universal-workflow：动态对抗工作流生成',
  ],
  actions: [],
});

registerNotice({
  version: '0.4.25',
  title: 'Spec 范围过滤 + Codegraph 图模块集成',
  highlights: [
    'spec load 新增范围过滤：按项目或全局维度加载规范',
    'codegraph 增强功能集成至原生 graph 模块（DB 迁移 + 查询优化）',
    '新增多个命令及中文描述，快速启动页面功能增强',
    '修复 AskUserQuestion 括注式写法导致交互被跳过的问题',
  ],
  actions: [],
});

NOTICES.push({
  version: '0.4.26',
  title: 'Delegate 代理配置 + Codex Adapter 修复',
  highlights: [
    'cli-tools.json 新增 proxy 配置：per-tool 代理开关，仅注入子进程环境变量',
    'Codex adapter 修复：Rust tracing stderr（RMCP/MCP 错误）归类为非致命诊断信息',
    'wiki/spec list 和 search 输出增强：增加上下文和描述显示',
  ],
  actions: [],
});

registerNotice({
  version: '0.5.0',
  title: '知识系统改革 + Install 管线重构 + 命令规范化',
  highlights: [
    '.agy/ 从 git 移除，install 时从 .claude/ 实时转换——镜像不再占版本库空间',
    '知识系统统一搜索入口 + KG Hook 自动注入 + CodeGraph 函数级调用图',
    'spec/knowhow 条目新增 title/description 属性，搜索结果更丰富',
    'ralph skills --platform 强制化：新增 agent/agy 平台，缺失时警告',
    'maestro-verify 合并到 maestro-execute 作为内置验证 gate',
  ],
  actions: [
    {
      id: 'reinstall-agy-global',
      description: '重新安装全局 agy skills + agents（.agy/ 不再从 git 获取，需从 .claude/ 实时生成）',
      defaultYes: true,
      run: () => runShell('maestro install --force --global --components agy-context,agy-skills,agy-agents,agy-md-chinese'),
    },
  ],
});

registerNotice({
  version: '0.5.3',
  title: 'MaestroGraph 知识图谱引擎 + Odyssey 长时命令族',
  highlights: [
    'MaestroGraph 自研 KG 引擎：9 语言提取器 + 24 框架 resolver + BM25F 搜索',
    '新增 Odyssey 5 命令：debug / improve / planex / ui / review-test-fix',
    'Domain 领域知识系统：glossary CRUD + 代码发现 + Hook 注入',
    'Install TUI 重设计：分组 Hub + Hooks 颗粒度 + Config Profile 导出导入',
    '跨工作空间知识共享：workspace link/unlink/list/status',
  ],
  actions: [
    {
      id: 'reinstall-commands-global',
      description: '重新安装全局 commands + skills + agents（含 Odyssey 全族 + Domain 系统）',
      defaultYes: true,
      run: () => runShell('maestro install --force --global --components agy-context,agy-skills,agy-agents,agy-md-chinese'),
    },
  ],
});

registerNotice({
  version: '0.5.32',
  title: 'Install Toggle 独立控制 + 脚本插件安全加固',
  highlights: [
    '新增 maestro install toggle：按技能/命令独立启禁用，三态 Tab 视图',
    '细粒度安装选择：每个新增技能独立可选 + 命令族分组选择',
    'KG 代码索引流式写入 + 原子提交，大仓库不再 OOM',
    'Odyssey 全族零遗留执行强化：6 项系统性修复消除过早停止',
    '脚本插件默认禁用（secure by default），需显式启用',
  ],
  actions: [],
});
