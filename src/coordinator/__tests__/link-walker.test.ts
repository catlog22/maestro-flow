import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LinkWalker } from '../link-walker.js';
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

function createMockAssembler(): PromptAssembler & { requests: AssembleRequest[] } {
  const requests: AssembleRequest[] = [];
  return {
    requests,
    async assemble(req: AssembleRequest): Promise<string> {
      requests.push(req);
      return `mock prompt for ${req.node.cmd}`;
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

function createMockAnalyzer(): StepAnalyzer & { callCount: number } {
  return {
    callCount: 0,
    async analyze() {
      (this as { callCount: number }).callCount++;
      return { quality_score: 85, issues: [], next_step_hints: {} };
    },
  };
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
  analyzer?: StepAnalyzer,
): LinkWalker {
  return new LinkWalker(
    createMockLoader(loaderGraphs),
    createMockAssembler(),
    executor,
    parser,
    evaluator,
    analyzer,
    undefined, // no sessionDir for tests
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinkWalker', () => {

  // 1. Start returns first command preview
  describe('start', () => {
    it('returns preview for the first command node', async () => {
      const graph = makeGraph('simple', {
        cmd1: { type: 'command', cmd: 'plan', args: '--phase 1', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { simple: graph });

      const preview = await walker.start('simple', 'test intent', { tool: 'claude', workflowRoot: '.' });

      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'plan');
      assert.strictEqual(preview.step_index, 1);
      assert.strictEqual(preview.total_steps, 2);
      assert.strictEqual(preview.upcoming.length, 1);
      assert.strictEqual(preview.upcoming[0].cmd, 'execute');
      // No commands should have been executed yet
      assert.strictEqual(executor.calls.length, 0);
    });

    it('skips non-command nodes to reach first command', async () => {
      const graph = makeGraph('eval-first', {
        setup: { type: 'eval', set: { 'var.x': '1' }, next: 'cmd1' },
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { 'eval-first': graph });

      const preview = await walker.start('eval-first', 'test', { tool: 'claude', workflowRoot: '.' });

      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'plan');
    });

    it('returns null for graph with no command nodes', async () => {
      const graph = makeGraph('empty', {
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { empty: graph });

      const preview = await walker.start('empty', 'test', { tool: 'claude', workflowRoot: '.' });

      assert.strictEqual(preview, null);
    });

    it('stores intent in context inputs', async () => {
      const graph = makeGraph('intent-test', {
        cmd: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { 'intent-test': graph });

      await walker.start('intent-test', 'build auth', { tool: 'claude', workflowRoot: '.' });

      const state = walker.getState();
      assert.ok(state);
      assert.strictEqual(state.context.inputs['intent'], 'build auth');
    });
  });

  // 2. Execute action
  describe('executeStep — execute', () => {
    it('executes current command and returns next preview', async () => {
      const graph = makeGraph('two-cmds', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'two-cmds': graph });

      await walker.start('two-cmds', 'test', { tool: 'claude', workflowRoot: '.' });
      const next = await walker.executeStep({ type: 'execute' });

      assert.strictEqual(executor.calls.length, 1);
      assert.strictEqual(executor.calls[0].cmd, 'plan');
      assert.ok(next);
      assert.strictEqual(next.cmd, 'execute');
    });

    it('returns null when last command reaches terminal', async () => {
      const graph = makeGraph('one-cmd', {
        cmd: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'one-cmd': graph });

      await walker.start('one-cmd', 'test', { tool: 'claude', workflowRoot: '.' });
      const next = await walker.executeStep({ type: 'execute' });

      assert.strictEqual(next, null);
      const state = walker.getState();
      assert.ok(state);
      assert.strictEqual(state.status, 'completed');
    });
  });

  // 3. Skip action
  describe('executeStep — skip', () => {
    it('skips current command and advances to next', async () => {
      const graph = makeGraph('skip-test', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'skip-test': graph });

      await walker.start('skip-test', 'test', { tool: 'claude', workflowRoot: '.' });
      const next = await walker.executeStep({ type: 'skip' });

      assert.strictEqual(executor.calls.length, 0); // nothing executed
      assert.ok(next);
      assert.strictEqual(next.cmd, 'execute');

      const state = walker.getState();
      assert.ok(state);
      const skipped = state.history.filter(h => h.outcome === 'skipped');
      assert.strictEqual(skipped.length, 1);
    });
  });

  // 4. Modify action (Issue #9 fix: should return preview, not execute)
  describe('executeStep — modify', () => {
    it('modifies args and returns updated preview without executing', async () => {
      const graph = makeGraph('modify-test', {
        cmd1: { type: 'command', cmd: 'plan', args: '--phase 1', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'modify-test': graph });

      await walker.start('modify-test', 'test', { tool: 'claude', workflowRoot: '.' });
      const preview = await walker.executeStep({ type: 'modify', args: '--phase 2 --fast' });

      // Should NOT have executed
      assert.strictEqual(executor.calls.length, 0);
      // Should return updated preview
      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'plan');
      assert.strictEqual(preview.resolved_args, '--phase 2 --fast');

      // Modification recorded
      const state = walker.getState();
      assert.ok(state);
      assert.strictEqual(state.chain_modifications.length, 1);
      assert.strictEqual(state.chain_modifications[0].action, 'modify_args');
    });
  });

  // 5. Add action
  describe('executeStep — add', () => {
    it('adds a node and returns preview of current step with updated upcoming', async () => {
      const graph = makeGraph('add-test', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'add-test': graph });

      const initial = await walker.start('add-test', 'test', { tool: 'claude', workflowRoot: '.' });
      assert.ok(initial);
      assert.strictEqual(initial.upcoming.length, 1); // execute

      const preview = await walker.executeStep({
        type: 'add', after_node: 'cmd1', cmd: 'review',
      });

      assert.ok(preview);
      // upcoming should now have review + execute
      assert.strictEqual(preview.upcoming.length, 2);
      assert.strictEqual(preview.upcoming[0].cmd, 'review');
      assert.strictEqual(preview.upcoming[1].cmd, 'execute');

      // No execution happened
      assert.strictEqual(executor.calls.length, 0);
    });
  });

  // 6. Remove action
  describe('executeStep — remove', () => {
    it('removes an upcoming node', async () => {
      const graph = makeGraph('remove-test', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'cmd3' },
        cmd3: { type: 'command', cmd: 'verify', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { 'remove-test': graph });

      await walker.start('remove-test', 'test', { tool: 'claude', workflowRoot: '.' });
      const preview = await walker.executeStep({ type: 'remove', node_id: 'cmd2' });

      assert.ok(preview);
      // upcoming should only have verify now
      assert.strictEqual(preview.upcoming.length, 1);
      assert.strictEqual(preview.upcoming[0].cmd, 'verify');
    });

    it('throws when removing current node', async () => {
      const graph = makeGraph('remove-current', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { 'remove-current': graph });

      await walker.start('remove-current', 'test', { tool: 'claude', workflowRoot: '.' });
      await assert.rejects(
        () => walker.executeStep({ type: 'remove', node_id: 'cmd1' }),
        /current node/i,
      );
    });
  });

  // 7. Quit action
  describe('executeStep — quit', () => {
    it('sets status to paused and returns null', async () => {
      const graph = makeGraph('quit-test', {
        cmd: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { 'quit-test': graph });

      await walker.start('quit-test', 'test', { tool: 'claude', workflowRoot: '.' });
      const result = await walker.executeStep({ type: 'quit' });

      assert.strictEqual(result, null);
      const state = walker.getState();
      assert.ok(state);
      assert.strictEqual(state.status, 'paused');
    });
  });

  // 8. Decision node auto-traversal
  describe('decision node traversal', () => {
    it('auto-resolves decision and continues to next command', async () => {
      const graph = makeGraph('decision', {
        cmd1: { type: 'command', cmd: 'check', args: '', next: 'decide' },
        decide: {
          type: 'decision',
          eval: 'result.status',
          edges: [
            { value: 'SUCCESS', target: 'cmd2' },
            { default: true, target: 'fail' },
          ],
        },
        cmd2: { type: 'command', cmd: 'next', args: '', next: 'done' },
        fail: { type: 'terminal', status: 'failure' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { decision: graph });

      await walker.start('decision', 'test', { tool: 'claude', workflowRoot: '.' });
      const next = await walker.executeStep({ type: 'execute' });

      assert.ok(next);
      assert.strictEqual(next.cmd, 'next');
    });
  });

  // 9. Gate node auto-traversal
  describe('gate node traversal', () => {
    it('passes gate when condition is true', async () => {
      const graph = makeGraph('gated', {
        setup: { type: 'eval', set: { 'var.ready': 'true' }, next: 'gate' },
        gate: { type: 'gate', condition: 'var.ready == true', on_pass: 'cmd1', on_fail: 'fail' },
        cmd1: { type: 'command', cmd: 'go', args: '', next: 'done' },
        fail: { type: 'terminal', status: 'failure' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { gated: graph });

      const preview = await walker.start('gated', 'test', { tool: 'claude', workflowRoot: '.' });

      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'go');
    });
  });

  // 10. Fork node linearization (Issue #14 fix)
  describe('fork node linearization', () => {
    it('walks into first branch instead of jumping to join', async () => {
      const graph = makeGraph('forked', {
        fork1: { type: 'fork', branches: ['branch_a', 'branch_b'], join: 'join1' },
        branch_a: { type: 'command', cmd: 'task-a', args: '', next: 'join1' },
        branch_b: { type: 'command', cmd: 'task-b', args: '', next: 'join1' },
        join1: { type: 'join', strategy: 'all', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { forked: graph });

      const preview = await walker.start('forked', 'test', { tool: 'claude', workflowRoot: '.' });

      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'task-a');
    });
  });

  // 11. node_id in AssembleRequest (Issue #5 fix)
  describe('node_id in AssembleRequest', () => {
    it('passes correct node_id to assembler', async () => {
      const graph = makeGraph('nodeid-test', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const assembler = createMockAssembler();
      const executor = createMockExecutor();
      const walker = new LinkWalker(
        createMockLoader({ 'nodeid-test': graph }),
        assembler,
        executor,
        parser,
        evaluator,
        undefined,
        undefined,
      );

      await walker.start('nodeid-test', 'test', { tool: 'claude', workflowRoot: '.' });

      // buildPreview calls assembler
      assert.strictEqual(assembler.requests.length, 1);
      assert.strictEqual(assembler.requests[0].node_id, 'cmd1');
    });
  });

  // 12. StepAnalyzer integration (Issue #16 fix)
  describe('StepAnalyzer integration', () => {
    it('calls analyzer after command execution', async () => {
      const graph = makeGraph('analyzed', {
        cmd: { type: 'command', cmd: 'plan', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const analyzer = createMockAnalyzer();
      const executor = createMockExecutor();
      const walker = new LinkWalker(
        createMockLoader({ analyzed: graph }),
        createMockAssembler(),
        executor,
        parser,
        evaluator,
        analyzer,
        undefined,
      );

      await walker.start('analyzed', 'test', { tool: 'claude', workflowRoot: '.' });
      await walker.executeStep({ type: 'execute' });

      assert.strictEqual(analyzer.callCount, 1);
      const state = walker.getState();
      assert.ok(state);
      assert.ok(state.context.analysis);
    });
  });

  // 13. Full walk: start → execute all → completion
  describe('full walk-through', () => {
    it('executes all commands to completion', async () => {
      const graph = makeGraph('full', {
        cmd1: { type: 'command', cmd: 'plan', args: '', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'cmd3' },
        cmd3: { type: 'command', cmd: 'verify', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { full: graph });

      let preview = await walker.start('full', 'test', { tool: 'claude', workflowRoot: '.' });

      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'plan');

      preview = await walker.executeStep({ type: 'execute' });
      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'execute');

      preview = await walker.executeStep({ type: 'execute' });
      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'verify');

      preview = await walker.executeStep({ type: 'execute' });
      assert.strictEqual(preview, null);

      const state = walker.getState();
      assert.ok(state);
      assert.strictEqual(state.status, 'completed');
      assert.strictEqual(executor.calls.length, 3);

      const executed = state.history.filter(h => h.node_type === 'command' && h.outcome === 'success');
      assert.strictEqual(executed.length, 3);
    });
  });

  // 14. Mixed actions walk
  describe('mixed actions walk', () => {
    it('supports skip, modify, execute in sequence', async () => {
      const graph = makeGraph('mixed', {
        cmd1: { type: 'command', cmd: 'plan', args: '--v1', next: 'cmd2' },
        cmd2: { type: 'command', cmd: 'execute', args: '', next: 'cmd3' },
        cmd3: { type: 'command', cmd: 'verify', args: '', next: 'done' },
        done: { type: 'terminal', status: 'success' },
      });
      const executor = createMockExecutor();
      const walker = makeWalker(executor, { mixed: graph });

      // Start at cmd1
      let preview = await walker.start('mixed', 'test', { tool: 'claude', workflowRoot: '.' });
      assert.ok(preview);

      // Skip cmd1
      preview = await walker.executeStep({ type: 'skip' });
      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'execute');

      // Modify cmd2 args — returns preview without executing
      preview = await walker.executeStep({ type: 'modify', args: '--fast' });
      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'execute');
      assert.strictEqual(preview.resolved_args, '--fast');

      // Now execute cmd2
      preview = await walker.executeStep({ type: 'execute' });
      assert.ok(preview);
      assert.strictEqual(preview.cmd, 'verify');

      // Execute cmd3
      preview = await walker.executeStep({ type: 'execute' });
      assert.strictEqual(preview, null);

      assert.strictEqual(executor.calls.length, 2); // cmd2 + cmd3
      const state = walker.getState();
      assert.ok(state);
      assert.strictEqual(state.status, 'completed');
    });
  });

  // 15. Description in preview
  describe('description in preview', () => {
    it('includes node description in preview', async () => {
      const graph = makeGraph('desc', {
        cmd: { type: 'command', cmd: 'plan', args: '', next: 'done', description: 'Create execution plan' },
        done: { type: 'terminal', status: 'success' },
      });
      const walker = makeWalker(createMockExecutor(), { desc: graph });

      const preview = await walker.start('desc', 'test', { tool: 'claude', workflowRoot: '.' });

      assert.ok(preview);
      assert.strictEqual(preview.description, 'Create execution plan');
    });
  });
});
