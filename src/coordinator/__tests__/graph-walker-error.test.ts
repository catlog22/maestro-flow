import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphWalker } from '../graph-walker.js';
import { DefaultExprEvaluator } from '../expr-evaluator.js';
import { DefaultOutputParser } from '../output-parser.js';
import type {
  ChainGraph, CommandExecutor, ExecuteRequest, ExecuteResult,
  PromptAssembler, AssembleRequest, WalkerState, WalkerEventEmitter,
  CoordinateEvent, GraphNode,
} from '../graph-types.js';
import type { GraphLoader } from '../graph-loader.js';
import type { WorkflowHookRegistry } from '../../hooks/workflow-hooks.js';

// ---------------------------------------------------------------------------
// Helpers (mirror graph-walker.test.ts conventions)
// ---------------------------------------------------------------------------

const evaluator = new DefaultExprEvaluator();
const parser = new DefaultOutputParser();

function mockLoader(graphs: Record<string, ChainGraph>): GraphLoader {
  return {
    async load(graphId: string): Promise<ChainGraph> {
      const g = graphs[graphId];
      if (!g) throw new Error(`Graph not found: ${graphId}`);
      return g;
    },
  } as unknown as GraphLoader;
}

function okAssembler(): PromptAssembler {
  return { async assemble(req: AssembleRequest) { return `prompt for ${req.node.cmd}`; } };
}

function throwingAssembler(msg: string): PromptAssembler {
  return { async assemble(_req: AssembleRequest) { throw new Error(msg); } };
}

function throwingExecutor(msg: string): CommandExecutor {
  return {
    async execute(_req: ExecuteRequest): Promise<ExecuteResult> { throw new Error(msg); },
    async abort() {},
  };
}

function collectEvents(): { events: CoordinateEvent[]; emitter: WalkerEventEmitter } {
  const events: CoordinateEvent[] = [];
  return { events, emitter: { emit: (e: CoordinateEvent) => events.push(e) } };
}

function makeHooks() {
  return {
    onError: { call: vi.fn().mockResolvedValue(undefined) },
    afterRun: { call: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeGraph(id: string, nodes: Record<string, GraphNode>): ChainGraph {
  return { id, name: `Test: ${id}`, version: '1.0', entry: Object.keys(nodes)[0], nodes };
}

function makeState(graphId: string, entry: string): WalkerState {
  return {
    session_id: 'test-session',
    graph_id: graphId,
    current_node: entry,
    status: 'running',
    context: {
      inputs: { workflowRoot: '.' },
      project: {
        initialized: false, current_phase: null, phase_status: 'pending',
        phase_artifacts: {}, execution: { tasks_completed: 0, tasks_total: 0 },
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
    step_mode: false,
    intent: 'test',
  };
}

function makeWalker(opts: {
  graphs: Record<string, ChainGraph>;
  executor: CommandExecutor;
  assembler?: PromptAssembler;
  emitter?: WalkerEventEmitter;
  sessionDir?: string;
  hooks?: ReturnType<typeof makeHooks>;
}): GraphWalker {
  return new GraphWalker(
    mockLoader(opts.graphs),
    opts.assembler ?? okAssembler(),
    opts.executor,
    null,
    parser,
    evaluator,
    opts.emitter,
    opts.sessionDir,
    undefined,
    undefined,
    opts.hooks as unknown as WorkflowHookRegistry,
  );
}

const simpleGraph = () =>
  makeGraph('simple', {
    run: { type: 'command', cmd: 'execute', next: 'done' },
    done: { type: 'terminal', status: 'success' },
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'graph-walker-error-test-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GraphWalker error barrier', () => {
  it('turns an executor spawn failure into a clean failed session (not an unhandled rejection)', async () => {
    const graph = simpleGraph();
    const { events, emitter } = collectEvents();
    const hooks = makeHooks();
    const walker = makeWalker({
      graphs: { simple: graph },
      executor: throwingExecutor('spawn ENOENT'),
      emitter,
      sessionDir: tmpDir,
      hooks,
    });

    const result = await walker.walkGraph(makeState('simple', 'run'), graph);

    // Barrier must convert the throw into a failed state, not rethrow.
    expect(result.status).toBe('failed');
    expect(result.recovery?.last_error).toBe('spawn ENOENT');

    // walker:error event emitted
    const errEvent = events.find((e) => e.type === 'walker:error');
    expect(errEvent).toBeDefined();
    expect((errEvent as Extract<CoordinateEvent, { type: 'walker:error' }>).error).toBe('spawn ENOENT');

    // onError hook notified
    expect(hooks.onError.call).toHaveBeenCalledTimes(1);
    const hookPayload = hooks.onError.call.mock.calls[0][0];
    expect(hookPayload.error.message).toBe('spawn ENOENT');

    // Failed state persisted to disk
    const persisted = JSON.parse(
      readFileSync(join(tmpDir, 'test-session', 'walker-state.json'), 'utf-8'),
    ) as WalkerState;
    expect(persisted.status).toBe('failed');
  });

  it('catches an assembler failure mid-handleCommand', async () => {
    const graph = simpleGraph();
    const { events, emitter } = collectEvents();
    const hooks = makeHooks();
    const walker = makeWalker({
      graphs: { simple: graph },
      executor: throwingExecutor('should not be reached'),
      assembler: throwingAssembler('assemble boom'),
      emitter,
      hooks,
    });

    const result = await walker.walkGraph(makeState('simple', 'run'), graph);

    expect(result.status).toBe('failed');
    expect(result.recovery?.last_error).toBe('assemble boom');
    expect(events.some((e) => e.type === 'walker:error')).toBe(true);
    expect(hooks.onError.call).toHaveBeenCalledTimes(1);
  });

  it('still runs the afterRun hook after a failure', async () => {
    const graph = simpleGraph();
    const hooks = makeHooks();
    const walker = makeWalker({
      graphs: { simple: graph },
      executor: throwingExecutor('boom'),
      hooks,
    });

    await walker.walkGraph(makeState('simple', 'run'), graph);
    expect(hooks.afterRun.call).toHaveBeenCalledTimes(1);
  });

  it('surfaces persistent state-persistence failures via console.error', async () => {
    // Make sessionDir a regular file so mkdirSync(sessionDir/<id>) throws.
    const fileAsDir = join(tmpDir, 'not-a-dir');
    writeFileSync(fileAsDir, 'blocker');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const graph = simpleGraph();
    const walker = makeWalker({
      graphs: { simple: graph },
      executor: throwingExecutor('boom'),
      sessionDir: fileAsDir,
    });

    const result = await walker.walkGraph(makeState('simple', 'run'), graph);

    expect(result.status).toBe('failed');
    const persistenceWarning = errSpy.mock.calls.some((args) =>
      String(args[0]).includes('state persistence failed'),
    );
    expect(persistenceWarning).toBe(true);
  });
});
