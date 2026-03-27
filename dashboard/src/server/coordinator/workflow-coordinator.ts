// ---------------------------------------------------------------------------
// WorkflowCoordinator -- multi-agent replacement for CoordinateRunner
// Orchestrates: StateAnalyzer → IntentClassifier → Step Execution → QualityReviewer
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { AgentStoppedPayload, NormalizedEntry } from '../../shared/agent-types.js';
import type {
  CoordinateSession,
  CoordinateStep,
  CoordinateStepStatus,
  CoordinateSessionStatus,
} from '../../shared/coordinate-types.js';
import type { SSEEvent } from '../../shared/types.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { StateManager } from '../state/state-manager.js';

import { StateAnalyzerAgent } from './agents/state-analyzer-agent.js';
import { IntentClassifierAgent } from './agents/intent-classifier-agent.js';
import { QualityReviewerAgent } from './agents/quality-reviewer-agent.js';
import {
  CHAIN_MAP,
  TASK_TO_CHAIN,
  AUTO_FLAG_MAP,
  STEP_TIMEOUT_MS,
  detectTaskType,
  resolveArgs,
  resolveAgentType,
} from './chain-map.js';
import type { WorkflowSnapshot, StepAnalysis } from './types.js';
import { setPromptsDir, loadPrompt } from './prompts/index.js';

// [GRAPH_WALKER] Feature flag — set USE_GRAPH_WALKER=true to route through GraphWalker
const USE_GRAPH_WALKER = process.env.USE_GRAPH_WALKER === 'true';

// [GRAPH_WALKER] Lazy-loaded graph walker factory (dynamic imports avoid compile-time dependency)
async function createGraphWalker(agentManager: AgentManager, eventBus: DashboardEventBus, workflowRoot: string) {
  const { GraphWalker } = await import('../../../../src/coordinator/graph-walker.js');
  const { GraphLoader } = await import('../../../../src/coordinator/graph-loader.js');
  const { DefaultExprEvaluator } = await import('../../../../src/coordinator/expr-evaluator.js');
  const { DefaultOutputParser } = await import('../../../../src/coordinator/output-parser.js');
  const { DefaultPromptAssembler } = await import('../../../../src/coordinator/prompt-assembler.js');
  const { DashboardExecutor } = await import('./dashboard-executor.js');
  const { IntentRouter } = await import('../../../../src/coordinator/intent-router.js');

  const { homedir } = await import('node:os');

  const globalChainsRoot = resolve(homedir(), '.maestro', 'chains');
  const localChainsRoot = resolve(workflowRoot, 'chains');
  const chainsRoot = existsSync(localChainsRoot) ? localChainsRoot : globalChainsRoot;
  const templateDir = resolve(homedir(), '.maestro', 'templates', 'cli', 'prompts');

  const loader = new GraphLoader(chainsRoot);
  const executor = new DashboardExecutor(agentManager, eventBus);
  const assembler = new DefaultPromptAssembler(workflowRoot, templateDir);
  const evaluator = new DefaultExprEvaluator();
  const parser = new DefaultOutputParser();
  const router = new IntentRouter(loader, chainsRoot);

  // Bridge walker events → dashboard coordinate events for real-time UI updates
  const emitter = {
    emit(event: { type: string; [k: string]: unknown }) {
      // Forward raw walker events
      eventBus.emit(event.type as any, event);

      // Translate walker:command events → coordinate:step events for the UI
      if (event.type === 'walker:command') {
        const status = event.status as string;
        eventBus.emit('coordinate:step' as any, {
          sessionId: event.session_id,
          step: {
            cmd: event.cmd ?? event.node_id,
            status: status === 'completed' ? 'completed'
              : status === 'failed' ? 'failed'
              : 'running',
            summary: event.summary ?? null,
            qualityScore: event.quality_score ?? null,
          },
        });
      }
    },
  };

  const sessionDir = join(workflowRoot, '.workflow', '.maestro-coordinate');
  const walker = new GraphWalker(loader, assembler, executor, null, parser, evaluator, emitter, sessionDir);

  return { walker, router, executor };
}

// ---------------------------------------------------------------------------
// Start options (same interface as CoordinateRunner)
// ---------------------------------------------------------------------------

export interface CoordinateStartOpts {
  tool?: string;
  autoMode?: boolean;
  chainName?: string;
  phase?: string;
}

// ---------------------------------------------------------------------------
// WorkflowCoordinator
// ---------------------------------------------------------------------------

export class WorkflowCoordinator {
  private session: CoordinateSession | null = null;
  private activeProcessId: string | null = null;
  private stepTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshot: WorkflowSnapshot | null = null;
  private lastAnalysis: StepAnalysis | null = null;
  private readonly agentStoppedHandler: (event: SSEEvent) => void;

  private readonly stateAnalyzer: StateAnalyzerAgent;
  private readonly intentClassifier: IntentClassifierAgent;
  private readonly qualityReviewer: QualityReviewerAgent;

  // [GRAPH_WALKER] Lazily initialized graph walker components
  private graphWalker: Awaited<ReturnType<typeof createGraphWalker>> | null = null;
  private graphWalkerInitPromise: Promise<Awaited<ReturnType<typeof createGraphWalker>>> | null = null;

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly agentManager: AgentManager,
    private readonly stateManager: StateManager,
    private readonly workflowRoot: string,
  ) {
    setPromptsDir(workflowRoot);
    this.stateAnalyzer = new StateAnalyzerAgent(stateManager, workflowRoot, eventBus);
    this.intentClassifier = new IntentClassifierAgent();
    this.qualityReviewer = new QualityReviewerAgent();

    this.agentStoppedHandler = (event: SSEEvent) => {
      const payload = event.data as AgentStoppedPayload;
      this.handleAgentStopped(payload);
    };
    this.eventBus.on('agent:stopped', this.agentStoppedHandler);
  }

  // [GRAPH_WALKER] Lazy initialization — only created on first use when flag is on
  private async getGraphWalker() {
    if (this.graphWalker) return this.graphWalker;
    if (!this.graphWalkerInitPromise) {
      this.graphWalkerInitPromise = createGraphWalker(this.agentManager, this.eventBus, this.workflowRoot);
    }
    this.graphWalker = await this.graphWalkerInitPromise;
    return this.graphWalker;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async start(intent: string, opts?: CoordinateStartOpts): Promise<CoordinateSession> {
    if (this.session?.status === 'running') {
      throw new Error('A coordinate session is already running. Stop it first or wait for completion.');
    }

    // [GRAPH_WALKER] Delegate to graph walker path when feature flag is on
    if (USE_GRAPH_WALKER) {
      return this.startViaGraphWalker(intent, opts);
    }

    const tool = opts?.tool ?? 'claude';
    const autoMode = opts?.autoMode ?? false;
    const phase = opts?.phase ?? null;

    const sessionId = `coord-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

    // Initialize session in analyzing_state
    this.session = {
      sessionId,
      status: 'analyzing_state' as CoordinateSessionStatus,
      intent,
      chainName: null,
      tool,
      autoMode,
      currentStep: 0,
      steps: [],
      avgQuality: null,
    };
    this.emitStatus();

    // Phase 1: Analyze workflow state
    const snapshot = await this.stateAnalyzer.analyze();
    this.lastSnapshot = snapshot;
    this.session.snapshot = snapshot;

    // Phase 2: Classify intent
    this.session.status = 'classifying_intent' as CoordinateSessionStatus;
    this.emitStatus();

    let chainName: string;
    if (opts?.chainName) {
      if (!CHAIN_MAP[opts.chainName]) {
        throw new Error(`Unknown chain: ${opts.chainName}`);
      }
      chainName = opts.chainName;
    } else {
      const classification = await this.intentClassifier.classify(intent, snapshot);
      this.session.classification = classification;

      if (classification.clarificationNeeded && classification.clarificationQuestion) {
        this.session.status = 'awaiting_clarification' as CoordinateSessionStatus;
        this.emitStatus();
        this.eventBus.emit('coordinate:clarification_needed', {
          sessionId,
          question: classification.clarificationQuestion,
        });
        await this.persistState();
        return this.session;
      }

      chainName = classification.chainName;
    }

    // Build session steps
    const chainDefs = CHAIN_MAP[chainName];
    if (!chainDefs) {
      throw new Error(`No chain found for: ${chainName}`);
    }

    const steps: CoordinateStep[] = chainDefs.map((def, i) => ({
      index: i,
      cmd: def.cmd,
      args: resolveArgs(def.args ?? '', intent, phase ?? String(snapshot.currentPhase || '')),
      rawArgs: def.args ?? '',
      status: 'pending' as CoordinateStepStatus,
      processId: null,
      analysis: null,
      summary: null,
      qualityScore: null,
    }));

    this.session.chainName = chainName;
    this.session.steps = steps;
    this.session.status = 'running';

    await this.persistState();

    // Emit analysis event
    this.eventBus.emit('coordinate:analysis', {
      sessionId,
      intent,
      chainName,
      steps: chainDefs.map(d => ({ cmd: d.cmd, args: d.args ?? '' })),
    });
    this.emitStatus();

    // Execute first step
    await this.executeStep(0);
    return this.session;
  }

  async stop(): Promise<void> {
    // [GRAPH_WALKER] Delegate stop to graph walker when flag is on
    if (USE_GRAPH_WALKER && this.graphWalker) {
      await this.stopViaGraphWalker();
      return;
    }

    if (!this.session) return;
    this.clearStepTimeout();

    if (this.activeProcessId) {
      try {
        await this.agentManager.stop(this.activeProcessId);
      } catch { /* Agent may have already stopped */ }
      this.activeProcessId = null;
    }

    const runningStep = this.session.steps.find(s => s.status === 'running');
    if (runningStep) {
      runningStep.status = 'failed';
      this.emitStep(runningStep);
    }

    this.session.status = 'failed';
    this.emitStatus();
    await this.persistState();
  }

  async resume(sessionId?: string): Promise<CoordinateSession | null> {
    // [GRAPH_WALKER] Delegate resume to graph walker when flag is on
    if (USE_GRAPH_WALKER) {
      return this.resumeViaGraphWalker(sessionId);
    }

    const state = await this.loadState(sessionId);
    if (!state) return null;

    this.session = state;
    const pendingIdx = this.session.steps.findIndex(s => s.status === 'pending');
    if (pendingIdx < 0) {
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

  async clarify(sessionId: string, response: string): Promise<void> {
    if (!this.session || this.session.sessionId !== sessionId) return;
    if (this.session.status !== 'awaiting_clarification') return;

    // Re-classify with additional context
    const enrichedIntent = `${this.session.intent}\n\nUser clarification: ${response}`;
    const snapshot = this.lastSnapshot ?? await this.stateAnalyzer.analyze();

    this.session.status = 'classifying_intent' as CoordinateSessionStatus;
    this.emitStatus();

    const classification = await this.intentClassifier.classify(enrichedIntent, snapshot);
    this.session.classification = classification;

    const chainDefs = CHAIN_MAP[classification.chainName];
    if (!chainDefs) {
      this.session.status = 'failed';
      this.emitStatus();
      return;
    }

    const phase = String(snapshot.currentPhase || '');
    this.session.chainName = classification.chainName;
    this.session.steps = chainDefs.map((def, i) => ({
      index: i,
      cmd: def.cmd,
      args: resolveArgs(def.args ?? '', enrichedIntent, phase),
      rawArgs: def.args ?? '',
      status: 'pending' as CoordinateStepStatus,
      processId: null,
      analysis: null,
      summary: null,
      qualityScore: null,
    }));

    this.session.status = 'running';
    await this.persistState();

    this.eventBus.emit('coordinate:analysis', {
      sessionId,
      intent: enrichedIntent,
      chainName: classification.chainName,
      steps: chainDefs.map(d => ({ cmd: d.cmd, args: d.args ?? '' })),
    });
    this.emitStatus();

    await this.executeStep(0);
  }

  getSession(): CoordinateSession | null {
    return this.session ? { ...this.session, steps: this.session.steps.map(s => ({ ...s })) } : null;
  }

  destroy(): void {
    this.clearStepTimeout();
    this.eventBus.off('agent:stopped', this.agentStoppedHandler);
  }

  // -------------------------------------------------------------------------
  // [GRAPH_WALKER] Bridge methods — delegate to GraphWalker engine
  // -------------------------------------------------------------------------

  private async startViaGraphWalker(intent: string, opts?: CoordinateStartOpts): Promise<CoordinateSession> {
    const gw = await this.getGraphWalker();

    const graphId = opts?.chainName
      ? opts.chainName
      : gw.router.resolve(intent);

    const sessionId = `coord-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    this.session = {
      sessionId,
      status: 'running',
      intent,
      chainName: graphId,
      tool: opts?.tool ?? 'claude',
      autoMode: opts?.autoMode ?? false,
      currentStep: 0,
      steps: [],
      avgQuality: null,
    };
    this.emitStatus();
    await this.persistState();

    // Run walker in background — session returned immediately, UI gets step events via emitter
    void this.runGraphWalker(gw, graphId, intent, opts);

    return this.session;
  }

  private async runGraphWalker(
    gw: Awaited<ReturnType<typeof createGraphWalker>>,
    graphId: string,
    intent: string,
    opts?: CoordinateStartOpts,
  ): Promise<void> {
    try {
      const walkerState = await gw.walker.start(graphId, intent, {
        tool: opts?.tool ?? 'claude',
        autoMode: opts?.autoMode ?? false,
        workflowRoot: this.workflowRoot,
        inputs: {
          phase: opts?.phase ?? '',
          description: intent,
        },
      });

      if (!this.session) return;

      // Sync final WalkerState → CoordinateSession
      this.syncWalkerToSession(walkerState);
      this.emitStatus();
      await this.persistState();
    } catch (err) {
      if (!this.session) return;
      const message = err instanceof Error ? err.message : String(err);
      this.session.status = 'failed';
      this.eventBus.emit('coordinate:error', {
        error: message,
        context: 'graph_walker',
        step: this.session.currentStep,
        timestamp: Date.now(),
      });
      this.emitStatus();
      await this.persistState();
    }
  }

  /** Convert WalkerState history → CoordinateSession steps */
  private syncWalkerToSession(walkerState: { status: string; history: Array<{ node_id: string; node_type: string; entered_at: string; exited_at?: string; outcome?: string; exec_id?: string; summary?: string; quality_score?: number }> }): void {
    if (!this.session) return;

    this.session.steps = walkerState.history
      .filter(h => h.node_type === 'command')
      .map((h, i) => ({
        index: i,
        cmd: h.node_id,
        args: '',
        status: h.outcome === 'success' ? 'completed' as const
          : h.outcome === 'failure' ? 'failed' as const
          : 'skipped' as const,
        processId: h.exec_id ?? null,
        analysis: null,
        summary: h.summary ?? null,
        qualityScore: h.quality_score ?? null,
        startedAt: h.entered_at,
        completedAt: h.exited_at,
      }));

    this.session.status = walkerState.status === 'completed' ? 'completed'
      : walkerState.status === 'failed' ? 'failed'
      : 'paused';
  }

  private async stopViaGraphWalker(): Promise<void> {
    const gw = await this.getGraphWalker();
    await gw.walker.stop();
    if (this.session) {
      this.session.status = 'failed';
      this.emitStatus();
      await this.persistState();
    }
  }

  private async resumeViaGraphWalker(sessionId?: string): Promise<CoordinateSession | null> {
    const gw = await this.getGraphWalker();

    try {
      // Resume runs the walker to completion — returns final state
      const walkerState = await gw.walker.resume(sessionId);

      this.session = {
        sessionId: walkerState.session_id,
        status: 'running',
        intent: walkerState.intent,
        chainName: walkerState.graph_id,
        tool: walkerState.tool,
        autoMode: walkerState.auto_mode,
        currentStep: 0,
        steps: [],
        avgQuality: null,
      };

      this.syncWalkerToSession(walkerState);
      this.emitStatus();
      await this.persistState();
      return this.session;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Step execution
  // -------------------------------------------------------------------------

  private async executeStep(index: number): Promise<void> {
    if (!this.session) return;
    if (index >= this.session.steps.length) {
      this.completeSession();
      return;
    }

    const step = this.session.steps[index];
    this.session.currentStep = index;

    // Re-resolve args with fresh state for multi-step chains
    if (step.rawArgs) {
      const freshSnapshot = await this.stateAnalyzer.analyze();
      this.lastSnapshot = freshSnapshot;
      const phase = String(freshSnapshot.currentPhase || '');
      step.args = resolveArgs(step.rawArgs, this.session.intent, phase);
    }

    // Build prompt from template
    const prompt = await this.buildStepPrompt(step);

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
      step.startedAt = new Date().toISOString();
      this.activeProcessId = process.id;
      this.session.currentStep = index;

      this.emitStep(step);
      this.emitStatus();
      await this.persistState();

      this.setStepTimeout(step);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowCoordinator] Failed to spawn agent for step ${index}: ${message}`);
      this.eventBus.emit('coordinate:error', {
        error: message,
        context: 'spawn',
        step: index,
        timestamp: Date.now(),
      });

      step.status = 'failed';
      step.summary = `Spawn failed: ${message}`;
      this.activeProcessId = null;

      this.emitStep(step);
      this.session.status = 'failed';
      this.emitStatus();
      await this.persistState();
    }
  }

  // -------------------------------------------------------------------------
  // Step prompt builder — renders step-execution template
  // -------------------------------------------------------------------------

  private async buildStepPrompt(step: CoordinateStep): Promise<string> {
    if (!this.session) throw new Error('No active session');

    let args = step.args;
    const autoDirective = this.session.autoMode
      ? ' Auto-confirm all prompts. No interactive questions.'
      : '';

    if (this.session.autoMode) {
      const flag = AUTO_FLAG_MAP[step.cmd];
      if (flag && !args.includes(flag)) {
        args = args ? `${args} ${flag}` : flag;
      }
    }

    const previousHints = this.lastAnalysis?.nextStepHints ?? '';
    const snapshotSummary = this.lastSnapshot
      ? `Phase ${this.lastSnapshot.currentPhase} (${this.lastSnapshot.phaseStatus}) | ${this.lastSnapshot.phasesCompleted}/${this.lastSnapshot.phasesTotal} phases | ${this.lastSnapshot.progressSummary}`
      : '';

    try {
      const template = await loadPrompt('step-execution');
      return this.renderTemplate(template, {
        command: step.cmd,
        args,
        autoDirective,
        previousHints,
        intent: this.session.intent,
        chainName: this.session.chainName ?? '',
        stepIndex: String(step.index),
        totalSteps: String(this.session.steps.length),
        snapshot: snapshotSummary,
      });
    } catch {
      // Fallback if template missing
      let prompt = `/${step.cmd} ${args}`.trim() + autoDirective;
      if (previousHints) {
        prompt += `\n\n## Previous Step Hints\n${previousHints}`;
      }
      return prompt;
    }
  }

  /**
   * Render a mustache-lite template with {{var}} and {{#var}}...{{/var}} blocks.
   * Blocks are included only when the variable is non-empty.
   */
  private renderTemplate(template: string, vars: Record<string, string>): string {
    // Process conditional blocks: {{#key}}...{{/key}}
    let result = template.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_, key: string, content: string) => vars[key] ? content : '',
    );
    // Replace simple variables: {{key}}
    result = result.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => vars[key] ?? '',
    );
    return result.trim();
  }

  // -------------------------------------------------------------------------
  // Agent stopped handler
  // -------------------------------------------------------------------------

  private handleAgentStopped(payload: AgentStoppedPayload): void {
    if (!this.session || this.session.status !== 'running') return;

    const step = this.session.steps.find(
      s => s.processId === payload.processId && s.status === 'running',
    );
    if (!step) return;

    this.clearStepTimeout();
    this.activeProcessId = null;

    step.status = 'completed';
    step.completedAt = new Date().toISOString();
    if (step.startedAt) {
      step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
    }
    step.summary = payload.reason ?? 'Agent completed';

    // Extract step output for quality review
    const output = this.extractStepOutput(payload.processId);

    this.emitStep(step);

    // Quality review for multi-step chains (more than 1 step)
    if (this.session.steps.length > 1 && output) {
      this.session.status = 'reviewing' as CoordinateSessionStatus;
      this.emitStatus();

      void this.qualityReviewer.review(step, output).then(analysis => {
        this.lastAnalysis = analysis;
        step.analysis = JSON.stringify(analysis);
        step.qualityScore = analysis.qualityScore;
        this.emitStep(step);

        this.session!.status = 'running';
        this.advanceOrComplete(step.index);
      }).catch(() => {
        this.lastAnalysis = null;
        this.session!.status = 'running';
        this.advanceOrComplete(step.index);
      });
    } else {
      this.lastAnalysis = null;
      this.advanceOrComplete(step.index);
    }
  }

  private advanceOrComplete(stepIndex: number): void {
    if (!this.session) return;

    const nextIndex = stepIndex + 1;
    if (nextIndex < this.session.steps.length) {
      this.session.currentStep = nextIndex;
      this.emitStatus();
      void this.persistState().then(() => this.executeStep(nextIndex));
    } else {
      this.completeSession();
    }
  }

  // -------------------------------------------------------------------------
  // Output extraction from agent entry history
  // -------------------------------------------------------------------------

  private extractStepOutput(processId: string): string {
    const entries = this.agentManager.getEntries(processId);
    if (!entries || entries.length === 0) return '';

    const parts: string[] = [];

    for (const entry of entries) {
      if (entry.type === 'assistant_message') {
        const msg = entry as NormalizedEntry & { content?: string; message?: string };
        parts.push(msg.content ?? msg.message ?? '');
      } else if (entry.type === 'file_change') {
        const fc = entry as NormalizedEntry & { filePath?: string; action?: string };
        parts.push(`Modified: ${fc.filePath ?? 'unknown'} (${fc.action ?? 'edit'})`);
      } else if (entry.type === 'command_exec') {
        const ce = entry as NormalizedEntry & { command?: string };
        parts.push(`Ran: ${ce.command ?? 'unknown command'}`);
      }
    }

    const joined = parts.join('\n');
    return joined.length > 5000 ? joined.slice(-5000) : joined;
  }

  // -------------------------------------------------------------------------
  // Session lifecycle helpers
  // -------------------------------------------------------------------------

  private completeSession(): void {
    if (!this.session) return;

    const qualityScores = this.session.steps
      .map(s => {
        if (!s.analysis) return null;
        try {
          const parsed = JSON.parse(s.analysis);
          return typeof parsed.qualityScore === 'number' ? parsed.qualityScore : null;
        } catch {
          return null;
        }
      })
      .filter((v): v is number => v !== null);

    this.session.avgQuality = qualityScores.length > 0
      ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
      : null;

    const hasFailures = this.session.steps.some(s => s.status === 'failed');
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
      step.status = 'failed';
      step.summary = 'Step timed out';
      this.activeProcessId = null;
      this.emitStep(step);
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
      console.error(`[WorkflowCoordinator] Failed to persist state: ${message}`);
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
