import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LinkSession } from '../link-session.js';
import type { ChainGraph, GraphNode } from '../graph-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(nodes: Record<string, GraphNode>, entry?: string): ChainGraph {
  return {
    id: 'test',
    name: 'Test',
    version: '1.0',
    entry: entry ?? Object.keys(nodes)[0],
    nodes,
  };
}

function simpleChain(): ChainGraph {
  return makeGraph({
    cmd1: { type: 'command', cmd: 'plan', args: '--phase 1', next: 'cmd2' },
    cmd2: { type: 'command', cmd: 'execute', args: '', next: 'cmd3' },
    cmd3: { type: 'command', cmd: 'verify', args: '', next: 'done' },
    done: { type: 'terminal', status: 'success' },
  });
}

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe('LinkSession.addNode', () => {
  it('inserts a node between two existing nodes', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    const newId = session.addNode('cmd1', 'review');

    assert.ok(newId.startsWith('link-review-'));
    const newNode = graph.nodes[newId];
    assert.ok(newNode);
    assert.strictEqual(newNode.type, 'command');
    if (newNode.type === 'command') {
      assert.strictEqual(newNode.cmd, 'review');
      assert.strictEqual(newNode.next, 'cmd2'); // points to old successor
    }
    // cmd1 now points to the new node
    const cmd1 = graph.nodes['cmd1'];
    assert.strictEqual(cmd1.type, 'command');
    if (cmd1.type === 'command') {
      assert.strictEqual(cmd1.next, newId);
    }
  });

  it('inserts with args', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    const newId = session.addNode('cmd2', 'debug', '--verbose');

    const newNode = graph.nodes[newId];
    assert.ok(newNode);
    if (newNode.type === 'command') {
      assert.strictEqual(newNode.args, '--verbose');
    }
  });

  it('throws for non-existent after node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    assert.throws(() => session.addNode('nonexistent', 'test'), /not found/);
  });
});

// ---------------------------------------------------------------------------
// removeNode
// ---------------------------------------------------------------------------

describe('LinkSession.removeNode', () => {
  it('removes a middle node and reconnects', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    session.removeNode('cmd2');

    assert.strictEqual(graph.nodes['cmd2'], undefined);
    const cmd1 = graph.nodes['cmd1'];
    if (cmd1.type === 'command') {
      assert.strictEqual(cmd1.next, 'cmd3'); // skips over removed node
    }
  });

  it('removes entry node and updates graph.entry', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    session.removeNode('cmd1');

    assert.strictEqual(graph.entry, 'cmd2');
    assert.strictEqual(graph.nodes['cmd1'], undefined);
  });

  it('throws when removing terminal node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    assert.throws(() => session.removeNode('done'), /terminal/i);
  });

  it('throws for non-existent node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    assert.throws(() => session.removeNode('ghost'), /not found/);
  });
});

// ---------------------------------------------------------------------------
// modifyArgs
// ---------------------------------------------------------------------------

describe('LinkSession.modifyArgs', () => {
  it('changes args of a command node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    session.modifyArgs('cmd1', '--phase 2 --fast');

    const cmd1 = graph.nodes['cmd1'];
    if (cmd1.type === 'command') {
      assert.strictEqual(cmd1.args, '--phase 2 --fast');
    }
  });

  it('throws for non-command node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    assert.throws(() => session.modifyArgs('done', 'args'), /not a command/);
  });
});

// ---------------------------------------------------------------------------
// traceCommandPath
// ---------------------------------------------------------------------------

describe('LinkSession.traceCommandPath', () => {
  it('returns all command nodes from start to terminal', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path.length, 3);
    assert.strictEqual(path[0].cmd, 'plan');
    assert.strictEqual(path[1].cmd, 'execute');
    assert.strictEqual(path[2].cmd, 'verify');
  });

  it('returns remaining nodes from mid-chain start', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    const path = session.traceCommandPath('cmd2');

    assert.strictEqual(path.length, 2);
    assert.strictEqual(path[0].cmd, 'execute');
    assert.strictEqual(path[1].cmd, 'verify');
  });

  it('skips non-command nodes in the path', () => {
    const graph = makeGraph({
      cmd1: { type: 'command', cmd: 'plan', args: '', next: 'setup' },
      setup: { type: 'eval', set: { 'var.x': '1' }, next: 'cmd2' },
      cmd2: { type: 'command', cmd: 'execute', args: '', next: 'done' },
      done: { type: 'terminal', status: 'success' },
    });
    const session = new LinkSession(graph);

    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path.length, 2);
    assert.strictEqual(path[0].cmd, 'plan');
    assert.strictEqual(path[1].cmd, 'execute');
  });

  it('handles decision nodes by following default edge', () => {
    const graph = makeGraph({
      cmd1: { type: 'command', cmd: 'check', args: '', next: 'decide' },
      decide: {
        type: 'decision',
        eval: 'result.status',
        edges: [
          { value: 'SUCCESS', target: 'cmd2' },
          { default: true, target: 'cmd2' },
        ],
      },
      cmd2: { type: 'command', cmd: 'next', args: '', next: 'done' },
      done: { type: 'terminal', status: 'success' },
    });
    const session = new LinkSession(graph);

    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path.length, 2);
  });

  it('stops on cycle (visited set)', () => {
    const graph = makeGraph({
      cmd1: { type: 'command', cmd: 'loop', args: '', next: 'cmd1' },
    });
    const session = new LinkSession(graph);

    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path.length, 1);
    assert.strictEqual(path[0].cmd, 'loop');
  });

  it('includes description in traced steps', () => {
    const graph = makeGraph({
      cmd1: { type: 'command', cmd: 'plan', args: '', next: 'done', description: 'Create plan' },
      done: { type: 'terminal', status: 'success' },
    });
    const session = new LinkSession(graph);

    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path[0].description, 'Create plan');
  });
});

// ---------------------------------------------------------------------------
// Combined operations
// ---------------------------------------------------------------------------

describe('LinkSession combined operations', () => {
  it('add then trace shows the new node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    session.addNode('cmd1', 'review');
    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path.length, 4); // plan, review, execute, verify
    assert.strictEqual(path[0].cmd, 'plan');
    assert.strictEqual(path[1].cmd, 'review');
    assert.strictEqual(path[2].cmd, 'execute');
  });

  it('remove then trace skips the removed node', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    session.removeNode('cmd2');
    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path.length, 2); // plan, verify
    assert.strictEqual(path[0].cmd, 'plan');
    assert.strictEqual(path[1].cmd, 'verify');
  });

  it('modify then trace shows updated args', () => {
    const graph = simpleChain();
    const session = new LinkSession(graph);

    session.modifyArgs('cmd1', '--phase 99');
    const path = session.traceCommandPath('cmd1');

    assert.strictEqual(path[0].args_template, '--phase 99');
  });
});
