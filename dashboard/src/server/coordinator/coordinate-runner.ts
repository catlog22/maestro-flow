// ---------------------------------------------------------------------------
// CoordinateRunner -- intent classification + chain execution via Agent-as-Step
// Port of workflows/maestro-coordinate.md CLI logic to TypeScript
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentType, AgentStoppedPayload } from '../../shared/agent-types.js';
import type {
  CoordinateSession,
  CoordinateStep,
  CoordinateStepStatus,
  CoordinateSessionStatus,
} from '../../shared/coordinate-types.js';
import type { SSEEvent } from '../../shared/types.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';

// ---------------------------------------------------------------------------
// Chain step definition (mirrors maestro-coordinate.md chainMap entries)
// ---------------------------------------------------------------------------

interface ChainStepDef {
  cmd: string;
  args?: string;
}

// ---------------------------------------------------------------------------
// Start options
// ---------------------------------------------------------------------------

export interface CoordinateStartOpts {
  tool?: string;
  autoMode?: boolean;
  chainName?: string;
  phase?: string;
}

// ---------------------------------------------------------------------------
// Intent classification patterns (from maestro-coordinate.md Step 3a)
// Order matters: first match wins
// ---------------------------------------------------------------------------

const INTENT_PATTERNS: Array<[string, RegExp]> = [
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
  ['memory_capture',    /memory.*captur|save.*memory|compact/i],
  ['memory',            /memory|manage.*mem|记忆/i],
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

const CHAIN_MAP: Record<string, ChainStepDef[]> = {
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
  'phase_transition':   [{ cmd: 'maestro-phase-transition' }],
  'phase_add':          [{ cmd: 'maestro-phase-add', args: '"{description}"' }],
  'milestone_audit':    [{ cmd: 'maestro-milestone-audit' }],
  'milestone_complete': [{ cmd: 'maestro-milestone-complete' }],
  'codebase_rebuild':   [{ cmd: 'manage-codebase-rebuild' }],
  'codebase_refresh':   [{ cmd: 'manage-codebase-refresh' }],
  'spec_setup':         [{ cmd: 'spec-setup' }],
  'spec_add':           [{ cmd: 'spec-add', args: '"{description}"' }],
  'spec_load':          [{ cmd: 'spec-load', args: '"{description}"' }],
  'spec_map':           [{ cmd: 'spec-map' }],
  'memory_capture':     [{ cmd: 'manage-memory-capture', args: '"{description}"' }],
  'memory':             [{ cmd: 'manage-memory', args: '"{description}"' }],
  'issue':              [{ cmd: 'manage-issue', args: '"{description}"' }],
  'issue_analyze':      [{ cmd: 'manage-issue-analyze', args: '"{description}"' }],
  'issue_plan':         [{ cmd: 'manage-issue-plan', args: '"{description}"' }],
  'issue_execute':      [{ cmd: 'manage-issue-execute', args: '"{description}"' }],
  'quick':              [{ cmd: 'maestro-quick', args: '"{description}"' }],
  'team_lifecycle':     [{ cmd: 'team-lifecycle-v4', args: '"{description}"' }],
  'team_coordinate':    [{ cmd: 'team-coordinate', args: '"{description}"' }],
  'team_qa':            [{ cmd: 'team-quality-assurance', args: '"{description}"' }],
  'team_test':          [{ cmd: 'team-testing', args: '"{description}"' }],
  'team_review':        [{ cmd: 'team-review', args: '"{description}"' }],
  'team_tech_debt':     [{ cmd: 'team-tech-debt', args: '"{description}"' }],

  // Multi-step chains
  'spec-driven':        [{ cmd: 'maestro-init' }, { cmd: 'maestro-spec-generate', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'brainstorm-driven':  [{ cmd: 'maestro-brainstorm', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'ui-design-driven':   [{ cmd: 'maestro-ui-design', args: '{phase}' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'full-lifecycle':     [{ cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'maestro-phase-transition' }],
  'execute-verify':     [{ cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'quality-loop':       [{ cmd: 'maestro-verify', args: '{phase}' }, { cmd: 'quality-review', args: '{phase}' }, { cmd: 'quality-test', args: '{phase}' }, { cmd: 'quality-debug', args: '--from-uat {phase}' }, { cmd: 'maestro-plan', args: '{phase} --gaps' }, { cmd: 'maestro-execute', args: '{phase}' }],
  'milestone-close':    [{ cmd: 'maestro-milestone-audit' }, { cmd: 'maestro-milestone-complete' }],
  'roadmap-driven':     [{ cmd: 'maestro-init' }, { cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'next-milestone':     [{ cmd: 'maestro-roadmap', args: '"{description}"' }, { cmd: 'maestro-plan', args: '{phase}' }, { cmd: 'maestro-execute', args: '{phase}' }, { cmd: 'maestro-verify', args: '{phase}' }],
  'analyze-plan-execute': [{ cmd: 'maestro-analyze', args: '"{description}" -q' }, { cmd: 'maestro-plan', args: '--dir {scratch_dir}' }, { cmd: 'maestro-execute', args: '--dir {scratch_dir}' }],
};

// Task type -> named chain aliases (from maestro-coordinate.md)
const TASK_TO_CHAIN: Record<string, string> = {
  'spec_generate': 'spec-driven',
  'brainstorm':    'brainstorm-driven',
};

// ---------------------------------------------------------------------------
// Auto-flag map for auto-confirm injection
// ---------------------------------------------------------------------------

const AUTO_FLAG_MAP: Record<string, string> = {
  'maestro-analyze':       '-y',
  'maestro-brainstorm':    '-y',
  'maestro-ui-design':     '-y',
  'maestro-plan':          '--auto',
  'maestro-spec-generate': '-y',
  'quality-test':          '--auto-fix',
};

// ---------------------------------------------------------------------------
// Per-step timeout (10 minutes)
// ---------------------------------------------------------------------------

const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// CoordinateRunner
// ---------------------------------------------------------------------------

export class CoordinateRunner {
  private session: CoordinateSession | null = null;
  private activeProcessId: string | null = null;
  private stepTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly agentStoppedHandler: (event: SSEEvent) => void;

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly agentManager: AgentManager,
    private readonly workflowRoot: string,
  ) {
    // Subscribe to agent:stopped to detect step completion
    this.agentStoppedHandler = (event: SSEEvent) => {
      const payload = event.data as AgentStoppedPayload;
      this.handleAgentStopped(payload);
    };
    this.eventBus.on('agent:stopped', this.agentStoppedHandler);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Classify intent, resolve chain, create session, execute first step */
  async start(intent: string, opts?: CoordinateStartOpts): Promise<CoordinateSession> {
    if (this.session?.status === 'running') {
      throw new Error('A coordinate session is already running. Stop it first or wait for completion.');
    }

    const tool = opts?.tool ?? 'claude';
    const autoMode = opts?.autoMode ?? false;
    const phase = opts?.phase ?? null;

    // Classify intent
    const taskType = detectTaskType(intent);

    // Resolve chain name: forced > alias > direct
    let chainName: string;
    if (opts?.chainName) {
      if (!CHAIN_MAP[opts.chainName]) {
        throw new Error(`Unknown chain: ${opts.chainName}`);
      }
      chainName = opts.chainName;
    } else if (TASK_TO_CHAIN[taskType]) {
      chainName = TASK_TO_CHAIN[taskType];
    } else {
      chainName = taskType;
    }

    const chainDefs = CHAIN_MAP[chainName];
    if (!chainDefs) {
      throw new Error(`No chain found for: ${chainName}`);
    }

    // Build session — start with 'classifying' status so frontend can show progress
    const sessionId = `coord-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const steps: CoordinateStep[] = chainDefs.map((def, i) => ({
      index: i,
      cmd: def.cmd,
      args: resolveArgs(def.args ?? '', intent, phase),
      status: 'pending' as CoordinateStepStatus,
      processId: null,
      analysis: null,
      summary: null,
    }));

    this.session = {
      sessionId,
      status: 'classifying',
      intent,
      chainName,
      tool,
      autoMode,
      currentStep: 0,
      steps,
      avgQuality: null,
    };

    this.emitStatus();

    // Classification done — transition to running
    this.session.status = 'running';

    // Persist state
    await this.persistState();

    // Emit analysis event (intent classification result)
    this.eventBus.emit('coordinate:analysis', {
      sessionId,
      intent,
      chainName,
      steps: chainDefs.map((d) => ({ cmd: d.cmd, args: d.args ?? '' })),
    });

    // Emit initial status
    this.emitStatus();

    // Execute first step
    await this.executeStep(0);

    return this.session;
  }

  /** Stop the current session and kill the active agent */
  async stop(): Promise<void> {
    if (!this.session) return;

    this.clearStepTimeout();

    // Kill active agent if one is running
    if (this.activeProcessId) {
      try {
        await this.agentManager.stop(this.activeProcessId);
      } catch {
        // Agent may have already stopped
      }
      this.activeProcessId = null;
    }

    // Mark current running step as failed
    const runningStep = this.session.steps.find((s) => s.status === 'running');
    if (runningStep) {
      runningStep.status = 'failed';
      this.emitStep(runningStep);
    }

    this.session.status = 'failed';
    this.emitStatus();
    await this.persistState();
  }

  /** Resume a session from persisted state, continuing from first pending step */
  async resume(sessionId?: string): Promise<CoordinateSession | null> {
    const state = await this.loadState(sessionId);
    if (!state) return null;

    this.session = state;

    // Find first pending step
    const pendingIdx = this.session.steps.findIndex((s) => s.status === 'pending');
    if (pendingIdx < 0) {
      // All steps already done
      this.session.status = 'completed';
      this.emitStatus();
      return this.session;
    }

    this.session.status = 'running';
    this.session.currentStep = pendingIdx;
    this.emitStatus();

    await this.executeStep(pendingIdx);
    return this.session;
  }

  /** Get the current session snapshot */
  getSession(): CoordinateSession | null {
    return this.session ? { ...this.session, steps: this.session.steps.map((s) => ({ ...s })) } : null;
  }

  /** Clean up event subscriptions */
  destroy(): void {
    this.clearStepTimeout();
    this.eventBus.off('agent:stopped', this.agentStoppedHandler);
  }

  // -------------------------------------------------------------------------
  // Step execution (Agent-as-Step pattern)
  // -------------------------------------------------------------------------

  private async executeStep(index: number): Promise<void> {
    if (!this.session) return;
    if (index >= this.session.steps.length) {
      this.completeSession();
      return;
    }

    const step = this.session.steps[index];
    this.session.currentStep = index;

    // Build the prompt: slash command with resolved args
    const autoDirective = this.session.autoMode
      ? ' Auto-confirm all prompts. No interactive questions.'
      : '';
    let args = step.args;

    // Inject auto flags for known commands
    if (this.session.autoMode) {
      const flag = AUTO_FLAG_MAP[step.cmd];
      if (flag && !args.includes(flag)) {
        args = args ? `${args} ${flag}` : flag;
      }
    }

    const prompt = `/${step.cmd} ${args}`.trim() + autoDirective;

    // Determine agent type from tool name
    const agentType = resolveAgentType(this.session.tool);

    try {
      const process = await this.agentManager.spawn(agentType, {
        type: agentType,
        prompt,
        workDir: this.workflowRoot,
        approvalMode: this.session.autoMode ? 'auto' : 'suggest',
      });

      step.processId = process.id;
      step.status = 'running';
      this.activeProcessId = process.id;
      this.session.currentStep = index;

      this.emitStep(step);
      this.emitStatus();
      await this.persistState();

      // Set step timeout
      this.setStepTimeout(step);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CoordinateRunner] Failed to spawn agent for step ${index}: ${message}`);

      step.status = 'failed';
      step.summary = `Spawn failed: ${message}`;
      this.activeProcessId = null;

      this.emitStep(step);

      // Fail the session on spawn error
      this.session.status = 'failed';
      this.emitStatus();
      await this.persistState();
    }
  }

  // -------------------------------------------------------------------------
  // Agent stopped handler -- advances chain
  // -------------------------------------------------------------------------

  private handleAgentStopped(payload: AgentStoppedPayload): void {
    if (!this.session || this.session.status !== 'running') return;

    // Match processId to current running step
    const step = this.session.steps.find(
      (s) => s.processId === payload.processId && s.status === 'running',
    );
    if (!step) return;

    this.clearStepTimeout();
    this.activeProcessId = null;

    // Mark step completed (treat all stops as completed -- failure detection
    // would require parsing agent output which is out of scope here)
    step.status = 'completed';
    step.summary = payload.reason ?? 'Agent completed';

    this.emitStep(step);

    // Advance to next step or complete session
    const nextIndex = step.index + 1;
    if (nextIndex < this.session.steps.length) {
      this.session.currentStep = nextIndex;
      this.emitStatus();
      void this.persistState().then(() => this.executeStep(nextIndex));
    } else {
      this.completeSession();
    }
  }

  // -------------------------------------------------------------------------
  // Session lifecycle helpers
  // -------------------------------------------------------------------------

  private completeSession(): void {
    if (!this.session) return;

    // Compute average quality from step analyses (if any have numeric scores)
    const qualityScores = this.session.steps
      .map((s) => {
        if (!s.analysis) return null;
        try {
          const parsed = JSON.parse(s.analysis);
          return typeof parsed.quality_score === 'number' ? parsed.quality_score : null;
        } catch {
          return null;
        }
      })
      .filter((v): v is number => v !== null);

    this.session.avgQuality = qualityScores.length > 0
      ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
      : null;

    const hasFailures = this.session.steps.some((s) => s.status === 'failed');
    this.session.status = hasFailures ? 'failed' : 'completed';

    this.emitStatus();
    void this.persistState();
  }

  // -------------------------------------------------------------------------
  // Step timeout
  // -------------------------------------------------------------------------

  private setStepTimeout(step: CoordinateStep): void {
    this.clearStepTimeout();
    this.stepTimeoutTimer = setTimeout(() => {
      if (!this.session || step.status !== 'running') return;

      console.warn(`[CoordinateRunner] Step ${step.index} (${step.cmd}) timed out after ${STEP_TIMEOUT_MS}ms`);
      step.status = 'failed';
      step.summary = 'Step timed out';
      this.activeProcessId = null;

      this.emitStep(step);

      // Fail session on timeout
      this.session.status = 'failed';
      this.emitStatus();
      void this.persistState();
    }, STEP_TIMEOUT_MS);
  }

  private clearStepTimeout(): void {
    if (this.stepTimeoutTimer) {
      clearTimeout(this.stepTimeoutTimer);
      this.stepTimeoutTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // State persistence
  // -------------------------------------------------------------------------

  private get sessionDir(): string {
    if (!this.session) throw new Error('No active session');
    return join(this.workflowRoot, '.maestro-coordinate', this.session.sessionId);
  }

  private async persistState(): Promise<void> {
    if (!this.session) return;
    try {
      const dir = this.sessionDir;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'state.json'), JSON.stringify(this.session, null, 2), 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CoordinateRunner] Failed to persist state: ${message}`);
    }
  }

  private async loadState(sessionId?: string): Promise<CoordinateSession | null> {
    try {
      let stateDir: string;
      if (sessionId) {
        stateDir = join(this.workflowRoot, '.maestro-coordinate', sessionId);
      } else if (this.session) {
        stateDir = this.sessionDir;
      } else {
        return null;
      }
      const raw = await readFile(join(stateDir, 'state.json'), 'utf-8');
      return JSON.parse(raw) as CoordinateSession;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  private emitStatus(): void {
    if (!this.session) return;
    this.eventBus.emit('coordinate:status', { session: this.session });
  }

  private emitStep(step: CoordinateStep): void {
    if (!this.session) return;
    this.eventBus.emit('coordinate:step', {
      sessionId: this.session.sessionId,
      step,
    });
  }
}

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

/** Resolve arg placeholders ({phase}, {description}) */
function resolveArgs(template: string, intent: string, phase: string | null): string {
  return template
    .replace(/\{phase\}/g, phase ?? '')
    .replace(/\{description\}/g, intent)
    .replace(/\{scratch_dir\}/g, '');
}

/** Map tool name string to AgentType */
function resolveAgentType(tool: string | null): AgentType {
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
