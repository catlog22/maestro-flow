/**
 * Spec CLI End-to-End Tests
 *
 * Tests the `maestro spec` command via subprocess execution.
 * Covers: init, add, load, list, status, --ref mode, --scope, --json
 * Guide coverage: CLI 参考 section — all spec subcommands
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let testDir: string;
const MAESTRO_BIN = join(process.cwd(), 'bin', 'maestro.js');

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-cli-spec-e2e-'));
  // Create .workflow to simulate maestro-managed project
  mkdirSync(join(testDir, '.workflow'), { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function runMaestro(args: string): string {
  try {
    return execSync(`node "${MAESTRO_BIN}" ${args}`, {
      cwd: testDir,
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env, HOME: testDir, USERPROFILE: testDir },
    });
  } catch (e: any) {
    return e.stdout || e.stderr || e.message;
  }
}

// ---------------------------------------------------------------------------
// spec init
// ---------------------------------------------------------------------------

describe('maestro spec init', () => {
  it('creates spec directory with seed files', () => {
    const output = runMaestro('spec init');
    expect(output).toContain('Seed files created');

    const specsDir = join(testDir, '.workflow', 'specs');
    expect(existsSync(specsDir)).toBe(true);

    const files = readdirSync(specsDir);
    expect(files).toContain('coding-conventions.md');
    expect(files).toContain('architecture-constraints.md');
    expect(files).toContain('learnings.md');
    expect(files).toContain('quality-rules.md');
    expect(files).toContain('debug-notes.md');
    expect(files).toContain('test-conventions.md');
    expect(files).toContain('review-standards.md');
  });

  it('reports already initialized when run twice', () => {
    runMaestro('spec init');
    const output = runMaestro('spec init');
    expect(output).toContain('already');
  });
});

// ---------------------------------------------------------------------------
// spec add
// ---------------------------------------------------------------------------

describe('maestro spec add', () => {
  it('adds entry to correct file', () => {
    runMaestro('spec init');
    const output = runMaestro('spec add coding "Use ESM imports" "Always use ESM." --keywords esm,imports');
    expect(output).toContain('Added to');
    expect(output).toContain('coding-conventions.md');
    expect(output).toContain('Use ESM imports');

    const content = readFileSync(join(testDir, '.workflow', 'specs', 'coding-conventions.md'), 'utf-8');
    expect(content).toContain('<spec-entry');
    expect(content).toContain('### Use ESM imports');
    expect(content).toContain('keywords="esm,imports"');
  });

  it('detects duplicate entries', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "Use camelCase" "For variables." --keywords naming');
    const output = runMaestro('spec add coding "Use camelCase" "Different content." --keywords naming');
    expect(output).toContain('Skipped duplicate');
  });

  it('routes different categories to different files', () => {
    runMaestro('spec init');
    runMaestro('spec add arch "No circular deps" "Modules must not cycle." --keywords modules,deps');
    runMaestro('spec add debug "Check logs" "Always check logs first." --keywords logging');

    const arch = readFileSync(join(testDir, '.workflow', 'specs', 'architecture-constraints.md'), 'utf-8');
    const debug = readFileSync(join(testDir, '.workflow', 'specs', 'debug-notes.md'), 'utf-8');

    expect(arch).toContain('No circular deps');
    expect(debug).toContain('Check logs');
  });

  it('rejects invalid category', () => {
    runMaestro('spec init');
    const output = runMaestro('spec add nonexistent "Bad" "Content" --keywords test');
    expect(output).toContain('Error');
  });

  it('supports --json output', () => {
    runMaestro('spec init');
    const output = runMaestro('spec add coding "JSON Test" "Content." --keywords test --json');
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.category).toBe('coding');
    expect(parsed.title).toBe('JSON Test');
  });

  it('supports --source attribute', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "Agent Find" "Found during analysis." --keywords discovery --source agent');

    const content = readFileSync(join(testDir, '.workflow', 'specs', 'coding-conventions.md'), 'utf-8');
    expect(content).toContain('source="agent"');
  });
});

// ---------------------------------------------------------------------------
// spec add --ref
// ---------------------------------------------------------------------------

describe('maestro spec add --ref', () => {
  it('creates ref entry referencing existing knowhow', () => {
    runMaestro('spec init');
    // Create a knowhow file first
    const knowhowDir = join(testDir, '.workflow', 'knowhow');
    mkdirSync(knowhowDir, { recursive: true });
    const knowhowFile = join(knowhowDir, 'AST-oauth-flow.md');
    const knowhowContent = `---
title: OAuth Flow
category: asset
---

Complete OAuth PKCE flow with token exchange...`;
    const { writeFileSync: wfs } = require('node:fs');
    wfs(knowhowFile, knowhowContent, 'utf-8');

    const output = runMaestro('spec add learning "OAuth Integration" "PKCE flow design." --keywords oauth,pkce --ref knowhow/AST-oauth-flow.md');
    expect(output).toContain('Added ref entry');
    expect(output).toContain('knowhow/AST-oauth-flow.md');

    const content = readFileSync(join(testDir, '.workflow', 'specs', 'learnings.md'), 'utf-8');
    expect(content).toContain('ref="knowhow/AST-oauth-flow.md"');
  });

  it('creates knowhow doc when --knowhow-type specified and file missing', () => {
    runMaestro('spec init');
    const output = runMaestro('spec add learning "API Design" "REST conventions." --keywords api,design --ref knowhow/DOC-api-design.md --knowhow-type document');

    expect(output).toContain('Created knowhow doc');

    const knowhowFile = join(testDir, '.workflow', 'knowhow', 'DOC-api-design.md');
    expect(existsSync(knowhowFile)).toBe(true);
    const knowhowContent = readFileSync(knowhowFile, 'utf-8');
    expect(knowhowContent).toContain('title: API Design');
    expect(knowhowContent).toContain('type: document');
  });
});

// ---------------------------------------------------------------------------
// spec load
// ---------------------------------------------------------------------------

describe('maestro spec load', () => {
  it('loads all specs without filter', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "Rule A" "Content A." --keywords naming');
    runMaestro('spec add arch "Rule B" "Content B." --keywords module');

    const output = runMaestro('spec load');
    expect(output).toContain('Rule A');
    expect(output).toContain('Rule B');
  });

  it('filters by --category', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "Code Rule" "Coding content." --keywords naming');
    runMaestro('spec add arch "Arch Rule" "Arch content." --keywords module');

    const output = runMaestro('spec load --category coding');
    expect(output).toContain('Code Rule');
    expect(output).not.toContain('Arch Rule');
  });

  it('filters by --keyword', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "Auth Rule" "Auth content." --keywords auth,token');
    runMaestro('spec add coding "Naming Rule" "Naming content." --keywords naming');

    const output = runMaestro('spec load --keyword auth');
    expect(output).toContain('Auth Rule');
    expect(output).not.toContain('Naming Rule');
  });

  it('supports --json output', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "JSON Rule" "Content." --keywords test');

    const output = runMaestro('spec load --json');
    const parsed = JSON.parse(output);
    expect(parsed.totalLoaded).toBeGreaterThan(0);
    expect(parsed.content).toContain('JSON Rule');
  });

  it('shows (No specs found) when empty', () => {
    // Don't init — will still auto-init but seed files have no entries
    runMaestro('spec init');
    const output = runMaestro('spec load --keyword nonexistent');
    expect(output).toContain('No specs found');
  });
});

// ---------------------------------------------------------------------------
// spec list
// ---------------------------------------------------------------------------

describe('maestro spec list', () => {
  it('lists all spec files', () => {
    runMaestro('spec init');
    const output = runMaestro('spec list');
    expect(output).toContain('coding-conventions.md');
    expect(output).toContain('architecture-constraints.md');
    expect(output).toContain('learnings.md');
    expect(output).toContain('8 files');
  });

  it('shows message when no specs directory exists', () => {
    // Remove .workflow to test missing case
    rmSync(join(testDir, '.workflow'), { recursive: true, force: true });
    mkdirSync(join(testDir, '.workflow'), { recursive: true }); // Recreate without specs
    const output = runMaestro('spec list');
    expect(output.toLowerCase()).toMatch(/no.*directory|run.*init/i);
  });
});

// ---------------------------------------------------------------------------
// spec status
// ---------------------------------------------------------------------------

describe('maestro spec status', () => {
  it('shows system status with file info', () => {
    runMaestro('spec init');
    runMaestro('spec add coding "Test Rule" "Content." --keywords test');

    const output = runMaestro('spec status');
    expect(output).toContain('coding-conventions.md');
    expect(output).toContain('chars');
  });

  it('reports not initialized when no specs directory', () => {
    rmSync(join(testDir, '.workflow'), { recursive: true, force: true });
    mkdirSync(join(testDir, '.workflow'), { recursive: true });
    const output = runMaestro('spec status');
    expect(output.toLowerCase()).toContain('not initialized');
  });
});
