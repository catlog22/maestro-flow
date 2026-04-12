import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findWorkspaceRoot, isMaestroWorkspace, resolveWorkspace } from '../workspace.js';

const TEST_DIR = join(tmpdir(), `maestro-test-workspace-${Date.now()}`);

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function makeState(dir: string, extra: Record<string, unknown> = {}): void {
  const wfDir = join(dir, '.workflow');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, 'state.json'), JSON.stringify({
    version: '1.0',
    phases_summary: { total: 4, completed: 1, in_progress: 1, pending: 2 },
    ...extra,
  }));
}

// ---------------------------------------------------------------------------
// isMaestroWorkspace
// ---------------------------------------------------------------------------

describe('isMaestroWorkspace', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  it('returns true for valid Maestro workspace', () => {
    makeState(TEST_DIR);
    assert.strictEqual(isMaestroWorkspace(TEST_DIR), true);
  });

  it('returns false when .workflow/ does not exist', () => {
    assert.strictEqual(isMaestroWorkspace(TEST_DIR), false);
  });

  it('returns false when state.json is missing', () => {
    mkdirSync(join(TEST_DIR, '.workflow'), { recursive: true });
    assert.strictEqual(isMaestroWorkspace(TEST_DIR), false);
  });

  it('returns false when state.json lacks version', () => {
    const wfDir = join(TEST_DIR, '.workflow');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'state.json'), JSON.stringify({ phases_summary: {} }));
    assert.strictEqual(isMaestroWorkspace(TEST_DIR), false);
  });

  it('returns false when state.json lacks phases_summary', () => {
    const wfDir = join(TEST_DIR, '.workflow');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'state.json'), JSON.stringify({ version: '1.0' }));
    assert.strictEqual(isMaestroWorkspace(TEST_DIR), false);
  });

  it('returns false when state.json is invalid JSON', () => {
    const wfDir = join(TEST_DIR, '.workflow');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'state.json'), 'not json');
    assert.strictEqual(isMaestroWorkspace(TEST_DIR), false);
  });
});

// ---------------------------------------------------------------------------
// findWorkspaceRoot
// ---------------------------------------------------------------------------

describe('findWorkspaceRoot', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  it('finds workspace in current directory', () => {
    makeState(TEST_DIR);
    assert.strictEqual(findWorkspaceRoot(TEST_DIR), TEST_DIR);
  });

  it('walks up to find workspace in parent', () => {
    makeState(TEST_DIR);
    const child = join(TEST_DIR, 'src', 'hooks');
    mkdirSync(child, { recursive: true });
    assert.strictEqual(findWorkspaceRoot(child), TEST_DIR);
  });

  it('returns null when no workspace exists', () => {
    const child = join(TEST_DIR, 'src');
    mkdirSync(child, { recursive: true });
    assert.strictEqual(findWorkspaceRoot(child), null);
  });

  it('rejects non-Maestro .workflow/ directories', () => {
    // Create a .workflow/ that lacks Maestro fingerprint
    mkdirSync(join(TEST_DIR, '.workflow'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.workflow', 'state.json'), JSON.stringify({ some: 'other tool' }));
    assert.strictEqual(findWorkspaceRoot(TEST_DIR), null);
  });

  it('prefers directory with .git/', () => {
    // Parent has .workflow + .git
    makeState(TEST_DIR);
    mkdirSync(join(TEST_DIR, '.git'), { recursive: true });

    // Child also has .workflow (nested project)
    const child = join(TEST_DIR, 'sub');
    makeState(child);

    // Starting from sub, should find sub first (it's closer) but return it since parent has .git
    // Actually starting from inside sub/src, it should find sub first
    const deep = join(child, 'src');
    mkdirSync(deep, { recursive: true });
    const result = findWorkspaceRoot(deep);
    // sub is found first (closest), no .git there, then parent has .git — returns parent
    // But firstMatch = sub, parent also matches with .git — returns parent immediately
    assert.strictEqual(result, TEST_DIR);
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspace
// ---------------------------------------------------------------------------

describe('resolveWorkspace', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  it('uses data.cwd when provided', () => {
    makeState(TEST_DIR);
    assert.strictEqual(resolveWorkspace({ cwd: TEST_DIR }), TEST_DIR);
  });

  it('returns null when cwd has no workspace', () => {
    assert.strictEqual(resolveWorkspace({ cwd: TEST_DIR }), null);
  });
});
