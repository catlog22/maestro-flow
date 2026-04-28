// ---------------------------------------------------------------------------
// WorkflowCoordinator -- multi-agent orchestration via GraphWalker
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  CoordinateSession,
  CoordinateSessionStatus,
} from '../../shared/coordinate-types.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { StateManager } from '../state/state-manager.js';

import { QualityReviewerAgent } from './agents/quality-reviewer-agent.js';
import { GraphWalkerFactory } from './graph-walker-factory.js';
import { WalkerEventBridge } from './walker-event-bridge.js';
import { DashboardStepAnalyzer } from './dashboard-step-analyzer.js';

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

  private readonly qualityReviewer: QualityReviewerAgent;

  // GraphWalker factory and lazily initialized components
  private readonly factory: GraphWalkerFactory;
  private graphWalker: Awaited<ReturnType<GraphWalkerFactory['create']>> | null = null;
  private graphWalkerInitPromise: Promise<Awaited<ReturnType<GraphWalkerFactory['create']>>> | null = null;

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly agentManager: AgentManager,
    private readonly stateManager: StateManager,
    private readonly workflowRoot: string,
  ) {
    this.factory = new GraphWalkerFactory();
    this.qualityReviewer = new QualityReviewerAgent();
  }

  // Lazy initialization — only created on first use
  private async getGraphWalker() {
    if (this.graphWalker) return this.graphWalker;
    if (!this.graphWalkerInitPromise) {
      const sessionDir = join(this.workflowRoot, '.workflow', '.maestro');
      this.graphWalkerInitPromise = this.factory.create({
        agentManager: this.agentManager,
        eventBus: this.eventBus,
        workDir: this.workflowRoot,
        emitter: new WalkerEventBridge('coordinate', this.eventBus),
        analyzer: new DashboardStepAnalyzer(this.qualityReviewer),
        sessionDir,
      });
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

    return this.startViaGraphWalker(intent, opts);
  }

  async stop(): Promise<void> {
    if (this.graphWalker) {
      await this.stopViaGraphWalker();
      return;
    }

    if (!this.session) return;
    this.session.status = 'failed';
    this.emitStatus();
    await this.persistState();
  }

  async resume(sessionId?: string): Promise<CoordinateSession | null> {
    return this.resumeViaGraphWalker(sessionId);
  }

  async clarify(_sessionId: string, _response: string): Promise<void> {
    // Clarification is handled via gate:waiting → WalkerEventBridge in graph walker path.
    // This stub preserves the API for routes/WS handlers that still reference it.
  }

  getSession(): CoordinateSession | null {
    return this.session ? { ...this.session, steps: this.session.steps.map(s => ({ ...s })) } : null;
  }

  destroy(): void {
    // No-op — graph walker manages its own lifecycle
  }

  // -------------------------------------------------------------------------
  // GraphWalker bridge methods
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
    gw: Awaited<ReturnType<GraphWalkerFactory['create']>>,
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

      // Sync final WalkerState -> CoordinateSession
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

  /** Convert WalkerState history -> CoordinateSession steps */
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
  // State persistence
  // -------------------------------------------------------------------------

  private get sessionDir(): string {
    if (!this.session) throw new Error('No active session');
    return join(this.workflowRoot, '.workflow', '.maestro', this.session.sessionId);
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
        stateDir = join(this.workflowRoot, '.workflow', '.maestro', sessionId);
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
}
