// ---------------------------------------------------------------------------
// LinkWalker — Step-by-step interactive walker wrapping GraphWalker concepts.
// Pauses at each command node, returns a preview, waits for user action.
// ---------------------------------------------------------------------------

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ChainGraph,
  CommandNode,
  WalkerState,
  WalkerContext,
  ProjectSnapshot,
  HistoryEntry,
  CommandExecutor,
  PromptAssembler,
  ExprEvaluator,
  OutputParser,
  StepAnalyzer,
  AssembleRequest,
  LinkStepPreview,
  LinkAction,
  LinkSessionState,
  LinkUpcomingStep,
  ChainModification,
  GraphNode,
} from './graph-types.js';
import type { GraphLoader } from './graph-loader.js';
import { LinkSession } from './link-session.js';

export interface LinkStartOptions {
  tool: string;
  workflowRoot: string;
  inputs?: Record<string, unknown>;
}

export class LinkWalker {
  private state: LinkSessionState | null = null;
  private graph: ChainGraph | null = null;
  private session: LinkSession | null = null;

  constructor(
    private readonly loader: GraphLoader,
    private readonly assembler: PromptAssembler,
    private readonly executor: CommandExecutor,
    private readonly outputParser: OutputParser,
    private readonly evaluator: ExprEvaluator,
    private readonly analyzer?: StepAnalyzer,
    private readonly sessionDir?: string,
  ) {}

  /**
   * Load graph, initialize state, advance to first command node, return preview.
   */
  async start(
    graphId: string,
    intent: string,
    options: LinkStartOptions,
  ): Promise<LinkStepPreview | null> {
    const sessionId = `link-${Date.now()}-${randomBytes(2).toString('hex')}`;
    const originalGraph = await this.loader.load(graphId);
    this.graph = structuredClone(originalGraph);
    this.session = new LinkSession(this.graph);

    const ctx = this.buildInitialContext(options);
    this.state = {
      session_id: sessionId,
      graph_id: graphId,
      current_node: this.graph.entry,
      status: 'running',
      context: ctx,
      history: [],
      fork_state: null,
      delegate_stack: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tool: options.tool,
      auto_mode: false,
      intent,
      link_mode: true,
      pending_preview: null,
      chain_modifications: [],
    };

    this.state.context.inputs['intent'] = intent;
    if (options.inputs) Object.assign(this.state.context.inputs, options.inputs);

    return this.advanceToNextCommand();
  }

  /**
   * Resume from saved session state.
   */
  async resume(sessionDir: string, sessionId?: string): Promise<LinkStepPreview | null> {
    let dir: string;
    if (sessionId) {
      dir = join(sessionDir, sessionId);
    } else {
      // Find latest link session
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(sessionDir, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && e.name.startsWith('link-'))
        .map(e => e.name)
        .sort()
        .reverse();
      if (dirs.length === 0) throw new Error('No link sessions found');
      dir = join(sessionDir, dirs[0]);
    }

    const stateRaw = readFileSync(join(dir, 'link-state.json'), 'utf-8');
    const graphRaw = readFileSync(join(dir, 'graph-snapshot.json'), 'utf-8');

    this.state = JSON.parse(stateRaw) as LinkSessionState;
    this.graph = JSON.parse(graphRaw) as ChainGraph;
    this.session = new LinkSession(this.graph);

    if (this.state.pending_preview) return this.state.pending_preview;
    return this.advanceToNextCommand();
  }

  /**
   * Execute the user's chosen action for the current step.
   * Returns the next step preview or null if walk is done.
   */
  async executeStep(action: LinkAction): Promise<LinkStepPreview | null> {
    if (!this.state || !this.graph || !this.session) {
      throw new Error('LinkWalker not started');
    }

    switch (action.type) {
      case 'execute':
        await this.executeCurrentCommand();
        break;

      case 'skip':
        this.skipCurrentCommand();
        break;

      case 'modify':
        this.session.modifyArgs(this.state.current_node, action.args);
        this.recordModification('modify_args', this.state.current_node, { args: action.args });
        return this.buildPreviewForCurrent();

      case 'add':
        this.addNode(action.after_node, action.cmd, action.args);
        return this.advanceToNextCommand();

      case 'remove':
        this.removeNode(action.node_id);
        return this.advanceToNextCommand();

      case 'quit':
        this.state.status = 'paused';
        this.state.updated_at = new Date().toISOString();
        this.save();
        return null;
    }

    if (this.state.status !== 'running') {
      this.save();
      return null;
    }

    return this.advanceToNextCommand();
  }

  getPreview(): LinkStepPreview | null {
    return this.state?.pending_preview ?? null;
  }

  addNode(afterNodeId: string, cmd: string, args?: string): void {
    if (!this.session || !this.state) throw new Error('LinkWalker not started');
    const newId = this.session.addNode(afterNodeId, cmd, args);
    this.recordModification('add', newId, { after: afterNodeId, cmd, args });
  }

  removeNode(nodeId: string): void {
    if (!this.session || !this.state) throw new Error('LinkWalker not started');
    if (nodeId === this.state.current_node) throw new Error('Cannot remove current node');
    this.session.removeNode(nodeId);
    this.recordModification('remove', nodeId);
  }

  modifyArgs(nodeId: string, newArgs: string): void {
    if (!this.session || !this.state) throw new Error('LinkWalker not started');
    this.session.modifyArgs(nodeId, newArgs);
    this.recordModification('modify_args', nodeId, { args: newArgs });
  }

  getUpcomingChain(): LinkUpcomingStep[] {
    if (!this.session || !this.state) return [];
    return this.session.traceCommandPath(this.state.current_node);
  }

  getState(): LinkSessionState | null {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Internal walk logic
  // ---------------------------------------------------------------------------

  private async buildPreviewForCurrent(): Promise<LinkStepPreview | null> {
    if (!this.state || !this.graph) return null;
    const nodeId = this.state.current_node;
    const node = this.graph.nodes[nodeId];
    if (!node || node.type !== 'command') return null;
    const preview = await this.buildPreview(nodeId, node);
    this.state.pending_preview = preview;
    this.save();
    return preview;
  }

  private async advanceToNextCommand(): Promise<LinkStepPreview | null> {
    if (!this.state || !this.graph) return null;

    // Walk through non-command nodes automatically
    while (this.state.status === 'running') {
      const nodeId = this.state.current_node;
      const node = this.graph.nodes[nodeId];
      if (!node) {
        this.state.status = 'failed';
        return null;
      }

      if (node.type === 'command') {
        const preview = await this.buildPreview(nodeId, node);
        this.state.pending_preview = preview;
        this.save();
        return preview;
      }

      // Auto-handle non-command nodes
      this.handleNonCommandNode(nodeId, node);
      if (this.state.status !== 'running') break;
    }

    // Completed or failed — no more commands
    this.state.pending_preview = null;
    this.save();
    return null;
  }

  private handleNonCommandNode(nodeId: string, node: GraphNode): void {
    if (!this.state || !this.graph) return;

    // max_visits guard to prevent infinite loops
    const maxVisits = this.graph.defaults?.max_visits ?? 10;
    const currentVisits = this.state.context.visits[nodeId] ?? 0;
    if (currentVisits >= maxVisits) {
      this.state.status = 'failed';
      console.error(`[link-walker] Max visits (${maxVisits}) exceeded for ${nodeId}`);
      return;
    }
    this.state.context.visits[nodeId] = currentVisits + 1;

    const entry: HistoryEntry = {
      node_id: nodeId,
      node_type: node.type,
      entered_at: new Date().toISOString(),
    };
    this.state.history.push(entry);

    switch (node.type) {
      case 'decision': {
        const strategy = node.strategy ?? 'expr';
        if (strategy === 'llm') {
          const def = node.edges.find(e => e.default);
          this.state.current_node = def?.target ?? '';
        } else {
          const val = node.eval ? this.evaluator.resolve(node.eval, this.state.context) : undefined;
          let matched = false;
          for (const edge of node.edges) {
            if (this.evaluator.match(edge, val, this.state.context)) {
              this.state.current_node = edge.target;
              matched = true;
              break;
            }
          }
          if (!matched) {
            this.state.status = 'failed';
            console.error(`[link-walker] Decision ${nodeId}: no matching edge for value=${JSON.stringify(val)}`);
          }
        }
        break;
      }
      case 'gate': {
        const passed = this.evaluator.evaluate(node.condition, this.state.context);
        this.state.current_node = passed ? node.on_pass : node.on_fail;
        break;
      }
      case 'eval': {
        for (const [key, expr] of Object.entries(node.set)) {
          const value = this.evaluator.resolve(expr, this.state.context);
          this.setContextValue(this.state.context, key, value);
        }
        this.state.current_node = node.next;
        break;
      }
      case 'fork': {
        // Linearize branches for interactive step-by-step walking
        const allBranches = node.branches;
        if (allBranches.length > 0) {
          // Chain branches: walk each branch's command nodes sequentially before join
          this.state.current_node = allBranches[0];
        } else {
          this.state.current_node = node.join;
        }
        break;
      }
      case 'join': {
        this.state.current_node = node.next;
        break;
      }
      case 'terminal': {
        this.state.status = node.status === 'success' ? 'completed' : 'failed';
        break;
      }
    }

    entry.exited_at = new Date().toISOString();
    entry.outcome = this.state.status === 'failed' ? 'failure' : 'success';
  }

  private async executeCurrentCommand(): Promise<void> {
    if (!this.state || !this.graph) return;

    const nodeId = this.state.current_node;
    const node = this.graph.nodes[nodeId];
    if (!node || node.type !== 'command') return;

    const entry: HistoryEntry = {
      node_id: nodeId,
      node_type: 'command',
      entered_at: new Date().toISOString(),
    };
    this.state.history.push(entry);
    this.state.context.visits[nodeId] = (this.state.context.visits[nodeId] ?? 0) + 1;

    const prevCmd = this.findPreviousCommand();
    const cmdIndex = this.countCommandsBefore(nodeId) + 1;
    const cmdTotal = this.countCommandNodes();

    const assembleReq: AssembleRequest = {
      node,
      node_id: nodeId,
      context: this.state.context,
      graph: { id: this.graph.id, name: this.graph.name },
      command_index: cmdIndex,
      command_total: cmdTotal,
      auto_mode: false,
      previous_command: prevCmd,
    };

    const prompt = await this.assembler.assemble(assembleReq);

    const execResult = await this.executor.execute({
      prompt,
      agent_type: 'claude-code',
      work_dir: (this.state.context.inputs['workflowRoot'] as string) ?? '.',
      approval_mode: 'suggest',
      timeout_ms: node.timeout_ms ?? this.graph.defaults?.timeout_ms ?? 300000,
      node_id: nodeId,
      cmd: node.cmd,
    });

    // Save raw output
    this.saveOutput(nodeId, execResult.raw_output);

    const parsed = this.outputParser.parse(execResult.raw_output, node);
    this.state.context.result = parsed.structured as unknown as Record<string, unknown>;

    // Optional step analysis
    if (this.analyzer && node.analyze !== false) {
      try {
        const analysis = await this.analyzer.analyze(node, execResult.raw_output, this.state.context, prevCmd);
        this.state.context.analysis = analysis as unknown as Record<string, unknown>;
        entry.quality_score = analysis.quality_score;
      } catch { /* analysis failure is non-fatal */ }
    }

    entry.exec_id = execResult.exec_id;
    entry.summary = parsed.structured.summary || undefined;
    entry.exited_at = new Date().toISOString();

    if (execResult.success && parsed.structured.status === 'SUCCESS') {
      entry.outcome = 'success';
      this.state.current_node = node.next;
    } else {
      entry.outcome = 'failure';
      if (node.on_failure) {
        this.state.current_node = node.on_failure;
      } else {
        this.state.current_node = node.next; // still advance in link mode
      }
    }
  }

  private skipCurrentCommand(): void {
    if (!this.state || !this.graph) return;

    const nodeId = this.state.current_node;
    const node = this.graph.nodes[nodeId];
    if (!node || node.type !== 'command') return;

    const entry: HistoryEntry = {
      node_id: nodeId,
      node_type: 'command',
      entered_at: new Date().toISOString(),
      exited_at: new Date().toISOString(),
      outcome: 'skipped',
      summary: 'Skipped by user',
    };
    this.state.history.push(entry);
    this.recordModification('skip', nodeId);
    this.state.current_node = node.next;
  }

  private async buildPreview(nodeId: string, node: CommandNode): Promise<LinkStepPreview> {
    const upcoming = this.session!.traceCommandPath(nodeId);
    const resolvedArgs = this.resolveArgs(node.args ?? '');

    const prevCmd = this.findPreviousCommand();
    const cmdIndex = this.countCommandsBefore(nodeId) + 1;
    const cmdTotal = this.countCommandNodes();

    const assembleReq: AssembleRequest = {
      node,
      node_id: nodeId,
      context: this.state!.context,
      graph: { id: this.graph!.id, name: this.graph!.name },
      command_index: cmdIndex,
      command_total: cmdTotal,
      auto_mode: false,
      previous_command: prevCmd,
    };

    const prompt = await this.assembler.assemble(assembleReq);
    const contextSummary = this.buildContextSummary();

    return {
      node_id: nodeId,
      cmd: node.cmd,
      description: node.description,
      resolved_args: resolvedArgs,
      prompt_preview: prompt,
      step_index: cmdIndex,
      total_steps: cmdTotal,
      upcoming: upcoming.slice(1), // exclude current
      context_summary: contextSummary,
    };
  }

  private buildContextSummary(): string {
    if (!this.state) return '';
    const lastCmd = this.state.history
      .filter(h => h.node_type === 'command' && h.outcome)
      .at(-1);
    if (!lastCmd) return 'No previous steps executed.';
    return `Previous: ${lastCmd.node_id} (${lastCmd.outcome})${lastCmd.summary ? ` — ${lastCmd.summary}` : ''}`;
  }

  private resolveArgs(args: string): string {
    if (!this.state) return args;
    return args.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const k = key.trim();
      const ctx = this.state!.context;
      if (k in ctx.inputs) return String(ctx.inputs[k]);
      if (k in ctx.var) return String(ctx.var[k]);
      return `{${k}}`;
    });
  }

  private findPreviousCommand(): AssembleRequest['previous_command'] | undefined {
    if (!this.state || !this.graph) return undefined;
    for (let i = this.state.history.length - 1; i >= 0; i--) {
      const h = this.state.history[i];
      if (h.node_type === 'command' && h.outcome && h.outcome !== 'skipped') {
        const node = this.graph.nodes[h.node_id];
        const cmd = node?.type === 'command' ? node.cmd : h.node_id;
        return {
          node_id: h.node_id,
          cmd,
          outcome: h.outcome,
          summary: h.summary,
        };
      }
    }
    return undefined;
  }

  private countCommandsBefore(nodeId: string): number {
    if (!this.state) return 0;
    const seen = new Set<string>();
    for (const entry of this.state.history) {
      if (entry.node_type === 'command') seen.add(entry.node_id);
    }
    seen.delete(nodeId);
    return seen.size;
  }

  private countCommandNodes(): number {
    if (!this.graph) return 0;
    return Object.values(this.graph.nodes).filter(n => n.type === 'command').length;
  }

  private setContextValue(ctx: WalkerContext, path: string, value: unknown): void {
    const parts = path.split('.');
    if (parts.length === 1) {
      ctx.var[parts[0]] = value;
      return;
    }
    const root = parts[0];
    const rest = parts.slice(1);
    let target: Record<string, unknown>;
    switch (root) {
      case 'inputs': target = ctx.inputs as Record<string, unknown>; break;
      case 'var': target = ctx.var as Record<string, unknown>; break;
      default: target = ctx.var as Record<string, unknown>; rest.unshift(root); break;
    }
    for (let i = 0; i < rest.length - 1; i++) {
      if (!(rest[i] in target) || typeof target[rest[i]] !== 'object') target[rest[i]] = {};
      target = target[rest[i]] as Record<string, unknown>;
    }
    target[rest[rest.length - 1]] = value;
  }

  private recordModification(
    action: ChainModification['action'],
    nodeId: string,
    detail?: Record<string, unknown>,
  ): void {
    if (!this.state) return;
    this.state.chain_modifications.push({
      action,
      node_id: nodeId,
      timestamp: new Date().toISOString(),
      detail,
    });
  }

  private buildInitialContext(options: LinkStartOptions): WalkerContext {
    let project: ProjectSnapshot = {
      initialized: false,
      current_phase: null,
      phase_status: 'pending',
      artifacts: {},
      execution: { tasks_completed: 0, tasks_total: 0 },
      verification_status: 'pending',
      review_verdict: null,
      uat_status: 'pending',
      phases_total: 0,
      phases_completed: 0,
      accumulated_context: null,
    };

    try {
      const stateFile = join(options.workflowRoot, '.workflow', 'state.json');
      const raw = JSON.parse(readFileSync(stateFile, 'utf-8'));
      if (raw && typeof raw === 'object') {
        project = { ...project, ...raw, initialized: true };
      }
    } catch { /* no state file */ }

    return {
      inputs: { workflowRoot: options.workflowRoot },
      project,
      result: null,
      analysis: null,
      visits: {},
      var: {},
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private save(): void {
    if (!this.sessionDir || !this.state || !this.graph) return;
    try {
      const dir = join(this.sessionDir, this.state.session_id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'link-state.json'), JSON.stringify(this.state, null, 2), 'utf-8');
      writeFileSync(join(dir, 'graph-snapshot.json'), JSON.stringify(this.graph, null, 2), 'utf-8');
      writeFileSync(
        join(dir, 'modifications.json'),
        JSON.stringify(this.state.chain_modifications, null, 2),
        'utf-8',
      );
    } catch { /* best-effort */ }
  }

  private saveOutput(nodeId: string, output: string): void {
    if (!this.sessionDir || !this.state) return;
    try {
      const dir = join(this.sessionDir, this.state.session_id, 'outputs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${nodeId}.txt`), output, 'utf-8');
    } catch { /* best-effort */ }
  }
}
