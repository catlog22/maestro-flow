import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateKnowledgeGuard, loadKnowledgeGuardConfig } from '../guards/knowledge-guard.js';

const NOW = Date.parse('2026-09-15T12:00:00Z');

function freshSearchRow(projectRoot: string, lastUsed: string): void {
  const dir = join(projectRoot, '.workflow', 'learning');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'maestro-search.jsonl'),
    JSON.stringify({ command: 'maestro-search', frequency: 1, successRate: 1, avgDuration: 0, lastUsed, contexts: [] }) + '\n',
  );
}

describe('evaluateKnowledgeGuard', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-guard-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('warns on direct writes to .workflow/specs/', () => {
    const result = evaluateKnowledgeGuard(root, join(root, '.workflow/specs/learnings.md'), undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('bypass the knowledge pipeline'));
  });

  it('warns on direct writes to .workflow/knowhow/ (windows separators)', () => {
    const result = evaluateKnowledgeGuard(root, root + '\\.workflow\\knowhow\\TIP-1.md', undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('bypass the knowledge pipeline'));
  });

  it('stays silent for other .workflow state (sessions, learning)', () => {
    const result = evaluateKnowledgeGuard(root, join(root, '.workflow/sessions/s1/report.md'), undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 0);
  });

  it('warns on project files when no search was ever recorded', () => {
    const result = evaluateKnowledgeGuard(root, join(root, 'src/index.ts'), undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('Knowledge Gate'));
  });

  it('stays silent when a search happened within the window', () => {
    freshSearchRow(root, '2026-09-15T11:50:00Z');
    const result = evaluateKnowledgeGuard(root, join(root, 'src/index.ts'), undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 0);
  });

  it('warns when the last search is older than the window', () => {
    freshSearchRow(root, '2026-09-15T10:00:00Z');
    const result = evaluateKnowledgeGuard(root, join(root, 'src/index.ts'), undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 1);
  });

  it('honours a custom window', () => {
    freshSearchRow(root, '2026-09-15T10:00:00Z');
    const result = evaluateKnowledgeGuard(root, join(root, 'src/index.ts'), { windowMin: 180 }, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 0);
  });

  it('stays silent when disabled', () => {
    const result = evaluateKnowledgeGuard(root, join(root, 'src/index.ts'), { enabled: false }, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 0);
  });

  it('treats a malformed usage file as never-searched', () => {
    const dir = join(root, '.workflow', 'learning');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'maestro-search.jsonl'), 'not json\n');
    const result = evaluateKnowledgeGuard(root, join(root, 'src/index.ts'), undefined, { now: () => NOW });
    assert.strictEqual(result.warnings.length, 1);
  });
});

describe('loadKnowledgeGuardConfig', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-guard-cfg-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns defaults without config.json', () => {
    const cfg = loadKnowledgeGuardConfig(root);
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.windowMin, 30);
  });

  it('reads knowledgeGate overrides', () => {
    mkdirSync(join(root, '.workflow'), { recursive: true });
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({ knowledgeGate: { enabled: false, window_min: 120 } }));
    const cfg = loadKnowledgeGuardConfig(root);
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.windowMin, 120);
  });

  it('falls back to defaults on malformed config', () => {
    mkdirSync(join(root, '.workflow'), { recursive: true });
    writeFileSync(join(root, '.workflow', 'config.json'), '{bad');
    const cfg = loadKnowledgeGuardConfig(root);
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.windowMin, 30);
  });
});
