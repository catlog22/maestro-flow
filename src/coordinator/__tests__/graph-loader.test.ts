import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphLoader, GraphValidationError } from '../graph-loader.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function validGraph(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-chain',
    name: 'Test Chain',
    version: '1.0.0',
    entry: 'start',
    nodes: {
      start: { type: 'command', cmd: 'maestro-plan', next: 'done' },
      done: { type: 'terminal', status: 'success' },
    },
    ...overrides,
  };
}

let tmpDir: string;

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'graph-loader-test-'));
  return tmpDir;
}

function teardown(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeGraph(dir: string, graphId: string, data: unknown): string {
  const filePath = join(dir, `${graphId}.json`);
  const parentDir = join(filePath, '..');
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// 1. Load valid graph
// ---------------------------------------------------------------------------

describe('GraphLoader.load', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('loads a valid graph JSON and returns ChainGraph', async () => {
    const graph = validGraph();
    writeGraph(tmpDir, 'my-chain', graph);

    const loader = new GraphLoader(tmpDir);
    const result = await loader.load('my-chain');

    assert.strictEqual(result.id, 'test-chain');
    assert.strictEqual(result.name, 'Test Chain');
    assert.strictEqual(result.entry, 'start');
    assert.ok(result.nodes.start);
    assert.ok(result.nodes.done);
  });

  it('loads a graph in a subdirectory (graphId with /)', async () => {
    const graph = validGraph({ id: 'singles/plan' });
    writeGraph(tmpDir, 'singles/plan', graph);

    const loader = new GraphLoader(tmpDir);
    const result = await loader.load('singles/plan');

    assert.strictEqual(result.id, 'singles/plan');
  });
});

// ---------------------------------------------------------------------------
// 2. File not found
// ---------------------------------------------------------------------------

describe('GraphLoader — file not found', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('throws GraphValidationError for non-existent file', async () => {
    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('nonexistent'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  it('loadSync throws GraphValidationError for non-existent file', () => {
    const loader = new GraphLoader(tmpDir);
    assert.throws(
      () => loader.loadSync('nonexistent'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid JSON
// ---------------------------------------------------------------------------

describe('GraphLoader — invalid JSON', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('throws GraphValidationError for malformed JSON', async () => {
    const filePath = join(tmpDir, 'bad.json');
    writeFileSync(filePath, '{ not valid json }', 'utf-8');

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('bad'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('Invalid JSON'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Missing entry node
// ---------------------------------------------------------------------------

describe('GraphLoader — missing entry node', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('throws when entry references non-existent node', async () => {
    const graph = validGraph({ entry: 'missing_node' });
    writeGraph(tmpDir, 'bad-entry', graph);

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('bad-entry'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('Entry node "missing_node" not found'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Dangling next reference
// ---------------------------------------------------------------------------

describe('GraphLoader — dangling references', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('throws when command node.next references non-existent node', async () => {
    const graph = validGraph({
      nodes: {
        start: { type: 'command', cmd: 'plan', next: 'ghost' },
        done: { type: 'terminal', status: 'success' },
      },
    });
    writeGraph(tmpDir, 'dangling', graph);

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('dangling'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('"ghost"'));
        assert.ok(err.message.includes('non-existent'));
        return true;
      },
    );
  });

  it('throws when gate on_pass references non-existent node', async () => {
    const graph = validGraph({
      nodes: {
        start: { type: 'gate', condition: 'true', on_pass: 'ghost', on_fail: 'done' },
        done: { type: 'terminal', status: 'success' },
      },
    });
    writeGraph(tmpDir, 'dangling-gate', graph);

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('dangling-gate'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('"ghost"'));
        return true;
      },
    );
  });

  it('throws when decision edge target references non-existent node', async () => {
    const graph = validGraph({
      nodes: {
        start: {
          type: 'decision',
          edges: [{ target: 'ghost', value: 'yes' }],
        },
        done: { type: 'terminal', status: 'success' },
      },
    });
    writeGraph(tmpDir, 'dangling-decision', graph);

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('dangling-decision'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('"ghost"'));
        return true;
      },
    );
  });

  it('throws when fork branch references non-existent node', async () => {
    const graph = validGraph({
      nodes: {
        start: { type: 'fork', branches: ['ghost'], join: 'done' },
        done: { type: 'terminal', status: 'success' },
      },
    });
    writeGraph(tmpDir, 'dangling-fork', graph);

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('dangling-fork'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('"ghost"'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Missing required fields
// ---------------------------------------------------------------------------

describe('GraphLoader — missing required fields', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('throws when "nodes" is missing', async () => {
    const graph = { id: 'x', name: 'X', version: '1', entry: 'start' };
    writeGraph(tmpDir, 'no-nodes', graph);

    const loader = new GraphLoader(tmpDir);
    await assert.rejects(
      () => loader.load('no-nodes'),
      (err: unknown) => {
        assert.ok(err instanceof GraphValidationError);
        assert.ok(err.message.includes('"nodes"'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Cache behavior
// ---------------------------------------------------------------------------

describe('GraphLoader — cache', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns cached graph when mtime unchanged', async () => {
    const graph = validGraph();
    writeGraph(tmpDir, 'cached', graph);

    const loader = new GraphLoader(tmpDir);
    const first = await loader.load('cached');
    const second = await loader.load('cached');

    // Same reference = from cache
    assert.strictEqual(first, second);
  });

  it('reloads when mtime changes', async () => {
    const graph = validGraph();
    const filePath = writeGraph(tmpDir, 'mtime-test', graph);

    const loader = new GraphLoader(tmpDir);
    const first = await loader.load('mtime-test');

    // Update the file content and force a different mtime
    const updated = validGraph({ name: 'Updated Chain' });
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    // Force mtime change (add 2 seconds)
    const futureTime = new Date(Date.now() + 2000);
    utimesSync(filePath, futureTime, futureTime);

    const second = await loader.load('mtime-test');

    assert.notStrictEqual(first, second);
    assert.strictEqual(second.name, 'Updated Chain');
  });

  it('loadSync also uses cache', () => {
    const graph = validGraph();
    writeGraph(tmpDir, 'sync-cached', graph);

    const loader = new GraphLoader(tmpDir);
    const first = loader.loadSync('sync-cached');
    const second = loader.loadSync('sync-cached');

    assert.strictEqual(first, second);
  });
});

// ---------------------------------------------------------------------------
// 8. listAll
// ---------------------------------------------------------------------------

describe('GraphLoader.listAll', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('finds JSON files and returns graph IDs', () => {
    writeGraph(tmpDir, 'alpha', validGraph({ id: 'alpha' }));
    writeGraph(tmpDir, 'beta', validGraph({ id: 'beta' }));
    writeGraph(tmpDir, 'singles/plan', validGraph({ id: 'singles/plan' }));

    const loader = new GraphLoader(tmpDir);
    const ids = loader.listAll();

    assert.deepStrictEqual(ids, ['alpha', 'beta', 'singles/plan']);
  });

  it('excludes files starting with _', () => {
    writeGraph(tmpDir, 'valid', validGraph());
    writeGraph(tmpDir, '_router', { some: 'data' });

    const loader = new GraphLoader(tmpDir);
    const ids = loader.listAll();

    assert.deepStrictEqual(ids, ['valid']);
  });

  it('excludes directories starting with _', () => {
    writeGraph(tmpDir, 'top', validGraph());
    writeGraph(tmpDir, '_internal/hidden', validGraph());

    const loader = new GraphLoader(tmpDir);
    const ids = loader.listAll();

    assert.deepStrictEqual(ids, ['top']);
  });

  it('returns empty array for empty directory', () => {
    const loader = new GraphLoader(tmpDir);
    assert.deepStrictEqual(loader.listAll(), []);
  });
});
