import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphLoader } from '../graph-loader.js';
import { IntentRouter } from '../intent-router.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const INTENT_MAP = {
  version: '1.0.0',
  patterns: [
    { type: 'brainstorm', regex: 'brainstorm|ideate', flags: 'i', route: { graph: 'brainstorm-driven' } },
    { type: 'status', regex: '^status$', flags: 'i', route: { graph: 'singles/status' } },
    { type: 'continue', regex: '^(continue|next)$', flags: 'i', route: { strategy: 'state_router' as const } },
    { type: 'execute', regex: 'execute|implement|build', flags: 'i', route: { graph: 'singles/execute' } },
  ],
  fallback: { graph: 'singles/quick' },
};

let tmpDir: string;

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'intent-router-test-'));
  return tmpDir;
}

function teardown(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeIntentMap(dir: string, data: unknown): void {
  writeFileSync(join(dir, '_intent-map.json'), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. Pattern matching
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — pattern matching', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('matches "brainstorm a feature" to brainstorm-driven', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('brainstorm a feature'), 'brainstorm-driven');
  });

  it('matches "status" to singles/status', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('status'), 'singles/status');
  });

  it('matches "continue" to _router (state_router strategy)', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('continue'), '_router');
  });

  it('matches "implement auth" to singles/execute', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('implement auth'), 'singles/execute');
  });
});

// ---------------------------------------------------------------------------
// 2. Fallback
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — fallback', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns fallback graph for unknown intent', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('unknown intent xyz'), 'singles/quick');
  });
});

// ---------------------------------------------------------------------------
// 3. forceGraph
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — forceGraph', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns forceGraph directly, bypassing patterns', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('brainstorm something', 'quality-loop'), 'quality-loop');
  });
});

// ---------------------------------------------------------------------------
// 4. Missing _intent-map.json
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — missing intent map', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns default graph when _intent-map.json is missing', () => {
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('anything'), 'singles/quick');
  });
});

// ---------------------------------------------------------------------------
// 5. Cache — intent map read once
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — caching', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns consistent results across multiple calls (cached)', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('brainstorm'), 'brainstorm-driven');
    assert.strictEqual(router.resolve('status'), 'singles/status');
    assert.strictEqual(router.resolve('brainstorm again'), 'brainstorm-driven');
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid regex — skipped gracefully
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — invalid regex', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('skips pattern with invalid regex and continues matching', () => {
    const map = {
      version: '1.0.0',
      patterns: [
        { type: 'bad', regex: '(unclosed', flags: '', route: { graph: 'bad-graph' } },
        { type: 'good', regex: 'hello', flags: 'i', route: { graph: 'good-graph' } },
      ],
      fallback: { graph: 'singles/quick' },
    };
    writeIntentMap(tmpDir, map);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve('hello world'), 'good-graph');
  });
});

// ---------------------------------------------------------------------------
// 7. Empty intent
// ---------------------------------------------------------------------------

describe('IntentRouter.resolve — empty intent', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns fallback for empty string', () => {
    writeIntentMap(tmpDir, INTENT_MAP);
    const loader = new GraphLoader(tmpDir);
    const router = new IntentRouter(loader, tmpDir);

    assert.strictEqual(router.resolve(''), 'singles/quick');
  });
});
