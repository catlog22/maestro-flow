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
