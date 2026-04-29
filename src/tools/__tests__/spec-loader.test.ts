import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSpecs } from '../spec-loader.js';

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
  // Pre-create empty global dir to prevent autoInitSeeds from writing seed files
  if (!existsSync(GLOBAL_DIR)) mkdirSync(GLOBAL_DIR, { recursive: true });
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
    const result = loadSpecs('/nonexistent/path', undefined, undefined, undefined, undefined, TEST_OPTS);
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
