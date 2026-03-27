import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { GraphWalker } from '../graph-walker.js';
import { DefaultExprEvaluator } from '../expr-evaluator.js';
import { DefaultOutputParser } from '../output-parser.js';
import type {
  ChainGraph,
  CommandExecutor,
  ExecuteRequest,
  ExecuteResult,
  PromptAssembler,
  AssembleRequest,
  StepAnalyzer,
  WalkerState,
  WalkerContext,
  WalkerEventEmitter,
  CoordinateEvent,
  GraphNode,
} from '../graph-types.js';
import type { GraphLoader } from '../graph-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockExecutor(results?: Partial<ExecuteResult>[]): CommandExecutor & { calls: ExecuteRequest[] } {
  const queue = [...(results ?? [])];
  const calls: ExecuteRequest[] = [];
  return {
    calls,
    async execute(req: ExecuteRequest): Promise<ExecuteResult> {
      calls.push(req);
      const partial = queue.shift() ?? {};
      return {
        success: partial.success ?? true,
        raw_output: partial.raw_output ?? '--- COORDINATE RESULT ---\nSTATUS: SUCCESS\nSUMMARY: done\n',
        exec_id: partial.exec_id ?? `exec-${calls.length}`,
        duration_ms: partial.duration_ms ?? 100,
      };
    },
    async abort() {},
  };
}

function createMockAssembler(): PromptAssembler {
  return {
    async assemble(_req: AssembleRequest): Promise<string> {
      return `mock prompt for ${_req.node.cmd}`;
    },
  };
}

function createMockLoader(graphs: Record<string, ChainGraph>): GraphLoader {
  return {
    async load(graphId: string): Promise<ChainGraph> {
      const g = graphs[graphId];
      if (!g) throw new Error(`Graph not found: ${graphId}`);
      return g;
    },
    loadSync(graphId: string): ChainGraph {
      const g = graphs[graphId];
      if (!g) throw new Error(`Graph not found: ${graphId}`);
      return g;
    },
    listAll(): string[] { return Object.keys(graphs); },
  } as unknown as GraphLoader;
}

function createMockAnalyzer(): StepAnalyzer {
  return {
    async analyze() {
      return { quality_score: 85, issues: [], next_step_hints: {} };
    },
  };
}

function collectEvents(): { events: CoordinateEvent[]; emitter: WalkerEventEmitter } {
  const events: CoordinateEvent[] = [];
  return { events, emitter: { emit: (e: CoordinateEvent) => events.push(e) } };
}

function makeGraph(id: string, nodes: Record<string, GraphNode>, entry?: string): ChainGraph {
  return {
    id,
    name: `Test: ${id}`,
    version: '1.0',
    entry: entry ?? Object.keys(nodes)[0],
    nodes,
  };
}

const evaluator = new DefaultExprEvaluator();
const parser = new DefaultOutputParser();

function makeWalker(
  executor: CommandExecutor,
  loaderGraphs: Record<string, ChainGraph>,
  analyzer?: StepAnalyzer | null,
  emitter?: WalkerEventEmitter,
): GraphWalker {
  return new GraphWalker(
    createMockLoader(loaderGraphs),
    createMockAssembler(),
    executor,
    analyzer ?? null,
    parser,
    evaluator,
    emitter,
  );
}

function makeState(graphId: string, entry: string, overrides?: Partial<WalkerState>): WalkerState {
  return {
    session_id: 'test-session',
    graph_id: graphId,
    current_node: entry,
    status: 'running',
    context: {
      inputs: { workflowRoot: '.' },
      project: {
        initialized: false, current_phase: null, phase_status: 'pending',
        artifacts: {}, execution: { tasks_completed: 0, tasks_total: 0 },
        verification_status: 'pending', review_verdict: null, uat_status: 'pending',
        phases_total: 0, phases_completed: 0, accumulated_context: null,
      },
      result: null, analysis: null, visits: {}, var: {},
    },
    history: [],
    fork_state: null,
    delegate_stack: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tool: 'gemini',
    auto_mode: true,
    intent: 'test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphWalker', () => {

  // 1. Happy path: command -> terminal:success
  describe('happy path — command to terminal', () => {
    it('completes successfully with a simple two-node graph', async () => {
      const graph = makeGraph('simple', {
        run: { type: 'command', cmd: 'execute', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { simple: graph });
      const state = makeState('simple', 'run');

      const result = await walker.walkGraph(state, graph);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(executor.calls.length, 1);
      assert.strictEqual(executor.calls[0].cmd, 'execute');
      assert.ok(result.history.length >= 2);
      assert.strictEqual(result.history[0].node_id, 'run');
      assert.strictEqual(result.history[0].outcome, 'success');
    });
  });

  // 2. Decision branching
  describe('decision branching', () => {
    it('routes to correct branch based on result status', async () => {
      const graph = makeGraph('branch', {
        cmd: { type: 'command', cmd: 'check', next: 'decide' },
        decide: {
          type: 'decision',
          eval: 'result.status',
          edges: [
            { value: 'SUCCESS', target: 'ok' },
            { value: 'FAILURE', target: 'fail_term' },
            { default: true, target: 'fail_term' },
          ],
        },
        ok: { type: 'terminal', status: 'success' },
        fail_term: { type: 'terminal', status: 'failure' },
      });
      const executor = createMockExecutor();
      const { events, emitter } = collectEvents();
      const walker = makeWalker(executor, { branch: graph }, null, emitter);
      const state = makeState('branch', 'cmd');

      const result = await walker.walkGraph(state, graph);

      assert.strictEqual(result.status, 'completed');
      const decisionEvent = events.find(e => e.type === 'walker:decision');
      assert.ok(decisionEvent);
      assert.strictEqual((decisionEvent as Extract<CoordinateEvent, { type: 'walker:decision' }>).target, 'ok');
    });

    it('routes to failure branch when command fails', async () => {
      const graph = makeGraph('branch', {
        cmd: { type: 'command', cmd: 'check', next: 'decide' },
        decide: {
          type: 'decision',
          eval: 'result.status',
          edges: [
            { value: 'SUCCESS', target: 'ok' },
            { default: true, target: 'fail_term' },
          ],
        },
        ok: { type: 'terminal', status: 'success' },
        fail_term: { type: 'terminal', status: 'failure' },
      });
      const executor = createMockExecutor([{
        success: false,
        raw_output: '--- COORDINATE RESULT ---\nSTATUS: FAILURE\nSUMMARY: failed\n',
      }]);
      // Command fails => on_failure not set => state.status = 'failed' before reaching decide
      // Actually, command node has no on_failure, so walker sets status='failed'
      const walker = makeWalker(executor, { branch: graph });
      const state = makeState('branch', 'cmd');

      const result = await walker.walkGraph(state, graph);
      assert.strictEqual(result.status, 'failed');
    });
  });

  // 3. Loop with max_visits
  describe('loop with max_visits', () => {
    it('stops after exceeding max_visits', async () => {
      // Command always succeeds. Decision always loops back (var.escape never set).
      // After 2 visits to cmd, max_visits guard triggers failure.
      const graph = makeGraph('loop', {
        cmd: {
          type: 'command', cmd: 'retry', next: 'decide', max_visits: 2,
        },
        decide: {
          type: 'decision',
          eval: 'var.escape',
          edges: [
            { value: true, target: 'ok' },
            { default: true, target: 'cmd' },
          ],
        },
        ok: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { loop: graph });
      const state = makeState('loop', 'cmd');

      const result = await walker.walkGraph(state, graph);

      // Note: the command outputs FAILURE status, but executor.success defaults to true
      // So parsed status=FAILURE means we go to default edge (back to cmd)
      // After 2 visits, max_visits exceeded => failed
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.context.visits['cmd'], 2);
    });
  });

  // 4. Gate pass/fail
  describe('gate node', () => {
    it('passes through on_pass when condition is true', async () => {
      const graph = makeGraph('gated', {
        check: {
          type: 'gate',
          condition: 'var.ready == true',
          on_pass: 'ok',
          on_fail: 'fail_term',
        },
        ok: { type: 'terminal', status: 'success' },
        fail_term: { type: 'terminal', status: 'failure' },
      });
      const walker = makeWalker(createMockExecutor(), { gated: graph });
      const state = makeState('gated', 'check');
      state.context.var['ready'] = true;

      const result = await walker.walkGraph(state, graph);
      assert.strictEqual(result.status, 'completed');
    });

    it('routes to on_fail when condition is false', async () => {
      const graph = makeGraph('gated', {
        check: {
          type: 'gate',
          condition: 'var.ready == true',
          on_pass: 'ok',
          on_fail: 'fail_term',
        },
        ok: { type: 'terminal', status: 'success' },
        fail_term: { type: 'terminal', status: 'failure' },
      });
      const walker = makeWalker(createMockExecutor(), { gated: graph });
      const state = makeState('gated', 'check');
      state.context.var['ready'] = false;

      const result = await walker.walkGraph(state, graph);
      assert.strictEqual(result.status, 'failed');
    });

    it('pauses at waiting_gate when condition is false and wait=true', async () => {
      const graph = makeGraph('gated', {
        check: {
          type: 'gate',
          condition: 'var.ready == true',
          on_pass: 'ok',
          on_fail: 'fail_term',
          wait: true,
        },
        ok: { type: 'terminal', status: 'success' },
        fail_term: { type: 'terminal', status: 'failure' },
      });
      const walker = makeWalker(createMockExecutor(), { gated: graph });
      const state = makeState('gated', 'check');
      state.context.var['ready'] = false;

      const result = await walker.walkGraph(state, graph);
      assert.strictEqual(result.status, 'waiting_gate');
      assert.strictEqual(result.current_node, 'check');
    });
  });

  // 5. Eval node
  describe('eval node', () => {
    it('sets context variables and proceeds to next', async () => {
      const graph = makeGraph('eval-test', {
        setup: {
          type: 'eval',
          set: { 'var.count': '42', 'var.label': '"hello"' },
          next: 'done',
        },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { 'eval-test': graph });
      const state = makeState('eval-test', 'setup');

      const result = await walker.walkGraph(state, graph);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.context.var['count'], 42);
      assert.strictEqual(result.context.var['label'], 'hello');
    });

    it('sets nested paths like inputs.phase', async () => {
      const graph = makeGraph('eval-nest', {
        setup: {
          type: 'eval',
          set: { 'inputs.phase': '"execute"' },
          next: 'done',
        },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { 'eval-nest': graph });
      const state = makeState('eval-nest', 'setup');

      const result = await walker.walkGraph(state, graph);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.context.inputs['phase'], 'execute');
    });
  });

  // 6. Terminal delegate
  describe('terminal delegate', () => {
    it('switches to delegate graph and returns', async () => {
      const parentGraph = makeGraph('parent', {
        cmd: { type: 'command', cmd: 'init', next: 'delegate_out' },
        delegate_out: {
          type: 'terminal',
          status: 'delegate',
          delegate_graph: 'child',
          delegate_inputs: {},
        },
      });
      const childGraph = makeGraph('child', {
        child_cmd: { type: 'command', cmd: 'child-run', next: 'child_done' },
        child_done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor([
        { raw_output: '--- COORDINATE RESULT ---\nSTATUS: SUCCESS\nSUMMARY: init done\n' },
        { raw_output: '--- COORDINATE RESULT ---\nSTATUS: SUCCESS\nSUMMARY: child done\n' },
      ]);
      const { events, emitter } = collectEvents();
      const walker = makeWalker(executor, { parent: parentGraph, child: childGraph }, null, emitter);
      const state = makeState('parent', 'cmd');

      const result = await walker.walkGraph(state, parentGraph);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(executor.calls.length, 2);
      const delegateEvent = events.find(e => e.type === 'walker:delegate');
      assert.ok(delegateEvent, 'should emit walker:delegate event');
    });
  });

  // 7. Resume from waiting_command
  describe('resume from interrupted state', () => {
    it('continues walk from where it left off', async () => {
      const graph = makeGraph('resume-test', {
        cmd1: { type: 'command', cmd: 'step1', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'step2', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'resume-test': graph });

      // Simulate an interrupted state: already visited cmd1, now at cmd2
      const state = makeState('resume-test', 'cmd2');
      state.context.visits['cmd1'] = 1;
      state.history.push({
        node_id: 'cmd1', node_type: 'command',
        entered_at: new Date().toISOString(),
        exited_at: new Date().toISOString(),
        outcome: 'success', summary: 'step1 done',
      });

      const result = await walker.walkGraph(state, graph);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(executor.calls.length, 1);
      assert.strictEqual(executor.calls[0].cmd, 'step2');
    });
  });

  // 8. Events emitted correctly
  describe('event emission', () => {
    it('emits started, node_enter, node_exit, completed events', async () => {
      const graph = makeGraph('events', {
        cmd: { type: 'command', cmd: 'run', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const { events, emitter } = collectEvents();
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { events: graph }, null, emitter);
      const state = makeState('events', 'cmd');

      await walker.walkGraph(state, graph);

      const types = events.map(e => e.type);
      assert.ok(types.includes('walker:node_enter'));
      assert.ok(types.includes('walker:node_exit'));
      assert.ok(types.includes('walker:command'));
      assert.ok(types.includes('walker:completed'));
    });
  });

  // 9. Analyzer integration
  describe('analyzer integration', () => {
    it('populates analysis context when analyzer is provided and >1 command nodes', async () => {
      const graph = makeGraph('analyzed', {
        cmd1: { type: 'command', cmd: 'step1', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'step2', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const analyzer = createMockAnalyzer();
      const walker = makeWalker(executor, { analyzed: graph }, analyzer);
      const state = makeState('analyzed', 'cmd1');

      const result = await walker.walkGraph(state, graph);

      assert.strictEqual(result.status, 'completed');
      // Analyzer should have been called
      assert.ok(result.context.analysis !== null || result.history.some(h => h.quality_score === 85));
    });
  });

  // 10. Dry run via start()
  describe('dry run', () => {
    it('produces traversal plan without executing commands', async () => {
      const graph = makeGraph('dry', {
        cmd: { type: 'command', cmd: 'run', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { dry: graph });

      const result = await walker.start('dry', 'test intent', {
        tool: 'gemini',
        autoMode: true,
        dryRun: true,
        workflowRoot: '.',
      });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(executor.calls.length, 0);
      assert.ok(Array.isArray(result.context.var['dry_run_plan']));
      assert.ok((result.context.var['dry_run_plan'] as string[]).length > 0);
    });
  });
});
