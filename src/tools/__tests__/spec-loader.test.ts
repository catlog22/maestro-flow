import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { loadSpecs, loadExtraDocs } from '../spec-loader.js';
import { SPEC_SEED_DOCS } from '../spec-seeds.js';

// ---------------------------------------------------------------------------
// Test project setup — temporary directory with spec files
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `maestro-test-spec-loader-${Date.now()}`);
const BASELINE_DIR = join(TEST_DIR, '.workflow', 'specs');
const GLOBAL_DIR = join(TEST_DIR, '.global-specs');
const TEAM_DIR = join(TEST_DIR, '.workflow', 'collab', 'specs');
const PERSONAL_DIR = join(TEST_DIR, '.workflow', 'collab', 'specs', 'alice');

/** Options to isolate tests from real ~/.maestro/specs/ */
const TEST_OPTS = { globalDir: GLOBAL_DIR };

function writeSpec(dir: string, filename: string, content: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf-8');
}

function setupBaseline(): void {
  // Write empty stubs for every seed filename so autoInitSeeds does not create
  // populated seed files in GLOBAL_DIR.  Individual global-layer tests overwrite
  // specific files with their own content via writeSpec().
  mkdirSync(GLOBAL_DIR, { recursive: true });
  for (const doc of SPEC_SEED_DOCS) {
    writeFileSync(join(GLOBAL_DIR, doc.filename), '');
  }
  writeSpec(BASELINE_DIR, 'coding-conventions.md', '# Coding Conventions\n\nUse camelCase.');
  writeSpec(BASELINE_DIR, 'learnings.md', '# Learnings\n\nPattern X works.');
}

function setupTeamSpecs(): void {
  writeSpec(TEAM_DIR, 'coding-conventions.md', '# Team Coding Conventions\n\nAlso use PascalCase for types.');
  writeSpec(TEAM_DIR, 'debug-notes.md', '# Team Debug Notes\n\nCheck logs first.');
}

function setupPersonalSpecs(): void {
  writeSpec(PERSONAL_DIR, 'coding-conventions.md', '# Alice Coding Conventions\n\nPrefer arrow functions.');
  writeSpec(PERSONAL_DIR, 'learnings.md', '# Alice Learnings\n\nFound bug in module X.');
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Single-directory (backward compatible) behavior
// ---------------------------------------------------------------------------

describe('loadSpecs — single directory (no uid)', () => {
  beforeEach(() => setupBaseline());
  afterEach(() => cleanup());

  it('loads all specs from baseline when no category or uid', () => {
    const result = loadSpecs(TEST_DIR, undefined, undefined, undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('Coding Conventions'));
    assert.ok(result.content.includes('Learnings'));
    assert.strictEqual(result.totalLoaded, 2);
  });

  it('filters by category', () => {
    const result = loadSpecs(TEST_DIR, 'coding', undefined, undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('Coding Conventions'));
    assert.ok(!result.content.includes('Learnings')); // 1:1 mapping, no always-include
    assert.strictEqual(result.totalLoaded, 1);
  });

  it('returns empty when no specs directory', () => {
    // Use a fresh temp dir with no .workflow/specs/ — guarantees no stray seed files
    const emptyProject = join(tmpdir(), `maestro-empty-proj-${Date.now()}`);
    mkdirSync(emptyProject, { recursive: true });
    const result = loadSpecs(emptyProject, undefined, undefined, undefined, undefined, TEST_OPTS);
    rmSync(emptyProject, { recursive: true, force: true });
    assert.strictEqual(result.content, '');
    assert.strictEqual(result.totalLoaded, 0);
  });

  it('does not include layer headers when only one layer has content', () => {
    const result = loadSpecs(TEST_DIR, undefined, undefined, undefined, undefined, TEST_OPTS);
    assert.ok(!result.content.includes('# Baseline Specs'));
    assert.ok(!result.content.includes('# Global Specs'));
    assert.ok(!result.content.includes('# Team Specs'));
    assert.ok(!result.content.includes('# Personal Specs'));
  });
});

// ---------------------------------------------------------------------------
// Three-layer behavior (uid provided)
// ---------------------------------------------------------------------------

describe('loadSpecs — three-layer (uid provided)', () => {
  beforeEach(() => {
    setupBaseline();
    setupTeamSpecs();
    setupPersonalSpecs();
  });
  afterEach(() => cleanup());

  it('loads from all three layers with layer headers', () => {
    const result = loadSpecs(TEST_DIR, undefined, 'alice', undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('# Baseline Specs'));
    assert.ok(result.content.includes('# Team Specs'));
    assert.ok(result.content.includes('# Personal Specs (alice)'));
  });

  it('concatenates content from all layers (append, not replace)', () => {
    const result = loadSpecs(TEST_DIR, undefined, 'alice', undefined, undefined, TEST_OPTS);
    // All three coding-conventions should appear
    assert.ok(result.content.includes('Use camelCase'));
    assert.ok(result.content.includes('Also use PascalCase'));
    assert.ok(result.content.includes('Prefer arrow functions'));
  });

  it('respects category filter across layers', () => {
    const result = loadSpecs(TEST_DIR, 'coding', 'alice', undefined, undefined, TEST_OPTS);
    // coding-conventions is coding category
    assert.ok(result.content.includes('Use camelCase'));
    assert.ok(result.content.includes('Also use PascalCase'));
    assert.ok(result.content.includes('Prefer arrow functions'));
    // learnings is learning category, not coding — 1:1 mapping
    assert.ok(!result.content.includes('Pattern X works'));
    // debug-notes is debug category, should NOT appear under coding
    assert.ok(!result.content.includes('Team Debug Notes'));
  });

  it('includes debug-notes only with debug category', () => {
    const result = loadSpecs(TEST_DIR, 'debug', 'alice', undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('Team Debug Notes'));
    // coding-conventions is NOT debug category
    assert.ok(!result.content.includes('Use camelCase'));
    // learnings is learning category, not loaded under debug
    assert.ok(!result.content.includes('Learnings'));
  });

  it('counts specs from all layers', () => {
    const result = loadSpecs(TEST_DIR, undefined, 'alice', undefined, undefined, TEST_OPTS);
    // baseline: coding-conventions + learnings = 2
    // team: coding-conventions + debug-notes = 2
    // personal: coding-conventions + learnings = 2
    assert.strictEqual(result.totalLoaded, 6);
  });

  it('handles missing team layer gracefully', () => {
    // Remove team specs directory
    rmSync(TEAM_DIR, { recursive: true, force: true });
    // Re-create personal (it was inside team dir)
    setupPersonalSpecs();

    const result = loadSpecs(TEST_DIR, undefined, 'alice', undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('# Baseline Specs'));
    // Team layer missing — should skip silently
    assert.ok(!result.content.includes('# Team Specs'));
    assert.ok(result.content.includes('# Personal Specs (alice)'));
  });

  it('handles missing personal layer gracefully', () => {
    const result = loadSpecs(TEST_DIR, undefined, 'bob', undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('# Baseline Specs'));
    assert.ok(result.content.includes('# Team Specs'));
    // bob has no personal specs
    assert.ok(!result.content.includes('# Personal Specs'));
  });

  it('falls back to single-dir behavior when uid is undefined', () => {
    const result = loadSpecs(TEST_DIR, undefined, undefined, undefined, undefined, TEST_OPTS);
    assert.ok(!result.content.includes('# Baseline Specs'));
    assert.ok(!result.content.includes('# Team Specs'));
    // Only baseline specs loaded
    assert.ok(result.content.includes('Use camelCase'));
    assert.ok(!result.content.includes('Also use PascalCase'));
    assert.strictEqual(result.totalLoaded, 2);
  });

  it('loads learnings only with learning category', () => {
    const result = loadSpecs(TEST_DIR, 'learning', 'alice', undefined, undefined, TEST_OPTS);
    // Learnings from baseline
    assert.ok(result.content.includes('Pattern X works'));
    // Learnings from personal
    assert.ok(result.content.includes('Found bug in module X'));
    // coding-conventions should NOT be included
    assert.ok(!result.content.includes('Use camelCase'));
  });
});

// ---------------------------------------------------------------------------
// Global layer: allPrimary — cross-category entries load in full
// ---------------------------------------------------------------------------

describe('loadSpecs — global layer loads across categories', () => {
  beforeEach(() => setupBaseline());
  afterEach(() => cleanup());

  it('loads arch spec from global layer when querying coding category', () => {
    // Add arch spec to global dir
    writeSpec(GLOBAL_DIR, 'architecture-constraints.md', '# Global Arch\n\nNo circular deps.');

    const result = loadSpecs(TEST_DIR, 'coding', undefined, undefined, undefined, TEST_OPTS);
    // Global arch spec must appear even though query category is coding
    assert.ok(result.content.includes('No circular deps'), 'global arch spec should load for coding queries');
    // Baseline coding spec also present
    assert.ok(result.content.includes('Coding Conventions'));
  });

  it('loads all global specs in full regardless of category', () => {
    writeSpec(GLOBAL_DIR, 'architecture-constraints.md', '# Global Arch\n\nLayer separation required.');
    writeSpec(GLOBAL_DIR, 'debug-notes.md', '# Global Debug\n\nAlways check logs.');

    const result = loadSpecs(TEST_DIR, 'coding', undefined, undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('Layer separation required'));
    assert.ok(result.content.includes('Always check logs'));
  });

  it('global layer has layer header when it contributes content alongside baseline', () => {
    writeSpec(GLOBAL_DIR, 'architecture-constraints.md', '# Global Arch\n\nConstraint here.');

    const result = loadSpecs(TEST_DIR, 'coding', undefined, undefined, undefined, TEST_OPTS);
    assert.ok(result.content.includes('# Global Specs'));
    assert.ok(result.content.includes('# Baseline Specs'));
  });

  it('global layer with no matching files does not emit headers', () => {
    // GLOBAL_DIR is empty (only pre-created, no files written)
    const result = loadSpecs(TEST_DIR, 'coding', undefined, undefined, undefined, TEST_OPTS);
    assert.ok(!result.content.includes('# Global Specs'));
  });
});

// ---------------------------------------------------------------------------
// loadExtraDocs — path resolution
// ---------------------------------------------------------------------------

describe('loadExtraDocs — path resolution', () => {
  const EXTRA_DIR = join(tmpdir(), `maestro-extradocs-${Date.now()}`);
  const EXTRA_FILE = join(EXTRA_DIR, 'my-rules.md');

  beforeEach(() => {
    mkdirSync(EXTRA_DIR, { recursive: true });
    writeFileSync(EXTRA_FILE, '# My Rules\n\nAlways prefer composition.');
  });

  afterEach(() => {
    if (existsSync(EXTRA_DIR)) rmSync(EXTRA_DIR, { recursive: true, force: true });
  });

  it('resolves absolute paths correctly', () => {
    const result = loadExtraDocs('/any/project/root', [EXTRA_FILE]);
    assert.ok(result.content.includes('Always prefer composition'));
    assert.strictEqual(result.count, 1);
  });

  it('resolves tilde paths relative to home directory', () => {
    // Only meaningful if the file lives under homedir(); use relative home path
    const home = homedir();
    if (!EXTRA_FILE.startsWith(home)) {
      // tmpdir is not under home — skip tilde test on this platform
      return;
    }
    const tildePath = '~/' + EXTRA_FILE.slice(home.length + 1);
    const result = loadExtraDocs('/any/project/root', [tildePath]);
    assert.ok(result.content.includes('Always prefer composition'));
    assert.strictEqual(result.count, 1);
  });

  it('resolves relative paths against projectPath', () => {
    const projectDir = join(tmpdir(), `maestro-relpath-${Date.now()}`);
    const relFile = 'docs/extra.md';
    const absRelFile = join(projectDir, relFile);
    mkdirSync(join(projectDir, 'docs'), { recursive: true });
    writeFileSync(absRelFile, '# Extra\n\nRelative content.');

    const result = loadExtraDocs(projectDir, [relFile]);
    assert.ok(result.content.includes('Relative content'));

    rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns empty for non-existent absolute path', () => {
    const result = loadExtraDocs('/any/project', ['/nonexistent/absolute/path.md']);
    assert.strictEqual(result.content, '');
    assert.strictEqual(result.count, 0);
  });
});
