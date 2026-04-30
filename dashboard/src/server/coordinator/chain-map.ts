// ---------------------------------------------------------------------------
// Chain Map — intent patterns, chain definitions, and classification helpers
// Intent patterns, chain definitions, and classification helpers
// ---------------------------------------------------------------------------

import type { AgentType } from '../../shared/agent-types.js';

// ---------------------------------------------------------------------------
// Chain step definition (mirrors maestro-coordinate.md chainMap entries)
// ---------------------------------------------------------------------------

export interface ChainStepDef {
  cmd: string;
  args?: string;
}

// ---------------------------------------------------------------------------
// Intent classification patterns (from maestro-coordinate.md Step 3a)
// Order matters: first match wins
// ---------------------------------------------------------------------------

export const INTENT_PATTERNS: Array<[string, RegExp]> = [
  ['state_continue',    /^(continue|next|go|继续|下一步)$/i],
  ['status',            /^(status|状态|dashboard)$/i],
  ['spec_generate',     /spec.*(generat|creat|build)|PRD|产品.*规格/i],
  ['brainstorm',        /brainstorm|ideate|头脑风暴|发散/i],
  ['analyze',           /analy[sz]e|feasib|evaluat|assess|discuss|分析|评估|讨论/i],
  ['ui_design',         /ui.*design|design.*ui|prototype|设计.*原型|UI.*风格/i],
  ['init',              /init|setup.*project|初始化|新项目/i],
  ['plan',              /plan(?!.*gap)|break.*down|规划|分解/i],
  ['execute',           /execute|implement|build|develop|code|实现|开发/i],
  ['verify',            /verif[iy]|validate.*result|验证|校验/i],
  ['review',            /\breview.*code|code.*review|代码.*审查/i],
  ['test_gen',          /test.*gen|generat.*test|add.*test|写测试/i],
  ['test',              /\btest|uat|测试|验收/i],
  ['debug',             /debug|diagnos|troubleshoot|fix.*bug|调试|排查/i],
  ['integration_test',  /integrat.*test|e2e|集成测试/i],
  ['refactor',          /refactor|tech.*debt|重构|技术债/i],
  ['sync',              /sync.*doc|refresh.*doc|同步/i],
  ['phase_transition',  /phase.*transit|next.*phase|推进|切换.*阶段/i],
  ['phase_add',         /phase.*add|add.*phase|添加.*阶段/i],
  ['milestone_audit',   /milestone.*audit|里程碑.*审计/i],
  ['milestone_complete', /milestone.*compl|完成.*里程碑/i],
  ['issue_analyze',     /analyze.*issue|issue.*root.*cause/i],
  ['issue_plan',        /plan.*issue|issue.*solution/i],
  ['issue_execute',     /execute.*issue|run.*issue/i],
  ['issue',             /issue|问题|缺陷|discover.*issue/i],
  ['codebase_rebuild',  /codebase.*rebuild|重建.*文档/i],
  ['codebase_refresh',  /codebase.*refresh|刷新.*文档/i],
  ['spec_setup',        /spec.*setup|规范.*初始化/i],
  ['spec_add',          /spec.*add|添加.*规范/i],
  ['spec_load',         /spec.*load|加载.*规范/i],
  ['spec_map',          /spec.*map|规范.*映射/i],
  ['knowhow_capture',   /knowhow.*captur|save.*knowhow|compact/i],
  ['knowhow',           /knowhow|知技/i],
  ['team_lifecycle',    /team.*lifecycle|团队.*生命周期/i],
  ['team_coordinate',   /team.*coordinat|团队.*协调/i],
  ['team_qa',           /team.*(qa|quality)|团队.*质量/i],
  ['team_test',         /team.*test|团队.*测试/i],
  ['team_review',       /team.*review|团队.*评审/i],
  ['team_tech_debt',    /team.*tech.*debt|团队.*技术债/i],
  ['quick',             /quick|small.*task|ad.?hoc|简单|快速/i],
];

// ---------------------------------------------------------------------------
// Chain map (from maestro-coordinate.md Step 3c)
// ---------------------------------------------------------------------------

export const CHAIN_MAP: Record<string, ChainStepDef[]> = {
  // Single-step chains
  'status':             [{ cmd: 'manage-status' }],
  'init':               [{ cmd: 'maestro-init' }],
  'analyze':            [{ cmd: 'maestro-analyze', args: '{phase}' }],
  'ui_design':          [{ cmd: 'maestro-ui-design', args: '{phase}' }],
  'plan':               [{ cmd: 'maestro-plan', args: '{phase}' }],
  'execute':            [{ cmd: 'maestro-execute', args: '{phase}' }],
  'verify':             [{ cmd: 'maestro-verify', args: '{phase}' }],
  'test_gen':           [{ cmd: 'quality-test-gen', args: '{phase}' }],
  'test':               [{ cmd: 'quality-test', args: '{phase}' }],
  'debug':              [{ cmd: 'quality-debug', args: '"{description}"' }],
  'integration_test':   [{ cmd: 'quality-integration-test', args: '{phase}' }],
  'refactor':           [{ cmd: 'quality-refactor', args: '"{description}"' }],
  'review':             [{ cmd: 'quality-review', args: '{phase}' }],
  'sync':               [{ cmd: 'quality-sync', args: '{phase}' }],
  'phase_transition':   [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'phase_add':          [{ cmd: 'maestro-phase-add', args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load', args: '"{description}"' }],
  'spec_map':           [{ cmd: 'spec-map' }],
  'knowhow_capture':    [{ cmd: 'manage-knowhow-capture', args: '"{description}"' }],
  'knowhow':            [{ cmd: 'manage-knowhow', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'maestro-analyze', args: '--gaps "{description}"' }],
  'issue_plan':         [{ cmd: 'maestro-plan', args: '--gaps' }],
  'issue_execute':      [{ cmd: 'maestro-execute', args: '' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],
  'team_lifecycle':     [{ cmd: 'team-lifecycle-v4', args: '"{description}"' }],
  'team_coordinate':    [{ cmd: 'team-coordinate', args: '"{description}"' }],
  'team_qa':            [{ cmd: 'team-quality-assurance', args: '"{description}"' }],
  'team_test':          [{ cmd: 'team-testing', args: '"{description}"' }],
  'team_review':        [{ cmd: 'team-review', args: '"{description}"' }],
  'team_tech_debt':     [{ cmd: 'team-tech-debt', args: '"{description}"' }],

  // Multi-step chains
  'spec-driven':          [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '--mode full "{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'brainstorm-driven':    [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'ui-design-driven':     [{ cmd: 'maestro-ui-design', args: '{phase}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'full-lifecycle':       [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'execute-verify':       [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'quality-loop':         [{ cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close':      [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap-driven':       [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'next-milestone':       [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {scratch_dir}' }, { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }],
};

// ---------------------------------------------------------------------------
// Task type -> named chain aliases (from maestro-coordinate.md)
// ---------------------------------------------------------------------------

export const TASK_TO_CHAIN: Record<string, string> = {
  'spec_generate': 'spec-driven',
  'brainstorm':    'brainstorm-driven',
};

// ---------------------------------------------------------------------------
// Auto-flag map for auto-confirm injection
// ---------------------------------------------------------------------------

export const AUTO_FLAG_MAP: Record<string, string> = {
  'maestro-analyze':       '-y',
  'maestro-brainstorm':    '-y',
  'maestro-ui-design':     '-y',
  'maestro-plan':          '--auto',
  'maestro-roadmap':       '-y',
  'quality-test':          '--auto-fix',
};

// ---------------------------------------------------------------------------
// Per-step timeout (10 minutes)
// ---------------------------------------------------------------------------

export const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/** Classify intent text into a task type using regex patterns */
export function detectTaskType(text: string): string {
  for (const [type, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'quick'; // fallback
}

/** Resolve arg placeholders ({phase}, {description}, {scratch_dir}) */
export function resolveArgs(template: string, intent: string, phase: string | null): string {
  return template
    .replace(/\{phase\}/g, phase ?? '')
    .replace(/\{description\}/g, intent)
    .replace(/\{scratch_dir\}/g, '');
}

/** Map tool name string to AgentType */
export function resolveAgentType(tool: string | null): AgentType {
  switch (tool) {
    case 'claude':
    case 'claude-code':
      return 'claude-code';
    case 'codex':
      return 'codex';
    case 'gemini':
      return 'gemini';
    case 'qwen':
      return 'qwen';
    case 'opencode':
      return 'opencode';
    default:
      return 'claude-code';
  }
}
