/**
 * Spec Injector — vitest comprehensive tests
 *
 * Covers: evaluateSpecInjection (agent type → category mapping, wiki role loading, context budget)
 * Guide coverage: 自动注入机制 — PreToolUse:Agent hook, agent-type mapping, config override
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { evaluateSpecInjection } from '../spec-injector.js';
import { SPEC_SEED_DOCS } from '../../tools/spec-seeds.js';

/** Write empty stubs for all seed filenames so autoInitSeeds doesn't populate the dir. */
function makeEmptyGlobalDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-empty-global-'));
  for (const doc of SPEC_SEED_DOCS) writeFileSync(join(dir, doc.filename), '');
  return dir;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-injector-'));
  mkdirSync(join(testDir, '.workflow', 'specs'), { recursive: true });
  setupTestSpecs();
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function setupTestSpecs(): void {
  const specsDir = join(testDir, '.workflow', 'specs');
  writeFileSync(join(specsDir, 'coding-conventions.md'), `---
title: Coding Conventions
category: coding
---

# Coding Conventions

<spec-entry category="coding" keywords="naming,camelcase" date="2026-04-21">

### Use camelCase

Always use camelCase for variables.

</spec-entry>
`);
  writeFileSync(join(specsDir, 'architecture-constraints.md'), `---
title: Architecture Constraints
category: arch
---

# Architecture Constraints

<spec-entry category="arch" keywords="module,boundary" date="2026-04-21">

### No circular deps

Modules must not have circular dependencies.

</spec-entry>
`);
  writeFileSync(join(specsDir, 'test-conventions.md'), `---
title: Test Conventions
category: test
---

# Test Conventions

<spec-entry category="test" keywords="unit,vitest" date="2026-04-21">

### Use vitest

Use vitest for unit testing.

</spec-entry>
`);
  writeFileSync(join(specsDir, 'review-standards.md'), `---
title: Review Standards
category: review
---

# Review Standards

<spec-entry category="review" keywords="pr,checklist" date="2026-04-21">

### PR Review Checklist

Always check for test coverage.

</spec-entry>
`);
  writeFileSync(join(specsDir, 'debug-notes.md'), `---
title: Debug Notes
category: debug
---

# Debug Notes

<spec-entry category="debug" keywords="logging,trace" date="2026-04-21">

### Check logs first

Always start debugging by checking logs.

</spec-entry>
`);
}

// ---------------------------------------------------------------------------
// Agent type → category mapping
// ---------------------------------------------------------------------------

describe('evaluateSpecInjection — agent mapping', () => {
  it('injects coding specs for code-developer', () => {
    const result = evaluateSpecInjection('code-developer', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('coding');
    expect(result.content).toContain('Use camelCase');
  });

  it('injects coding + test specs for tdd-developer', () => {
    const result = evaluateSpecInjection('tdd-developer', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('coding');
    expect(result.categories).toContain('test');
    expect(result.content).toContain('Use camelCase');
    expect(result.content).toContain('Use vitest');
  });

  it('injects arch specs for workflow-planner', () => {
    const result = evaluateSpecInjection('workflow-planner', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('arch');
    expect(result.content).toContain('No circular deps');
  });

  it('injects review specs for workflow-reviewer', () => {
    const result = evaluateSpecInjection('workflow-reviewer', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('review');
    expect(result.content).toContain('PR Review Checklist');
  });

  it('injects debug specs for debug-explore-agent', () => {
    const result = evaluateSpecInjection('debug-explore-agent', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('debug');
    expect(result.content).toContain('Check logs first');
  });

  it('injects debug specs for workflow-debugger', () => {
    const result = evaluateSpecInjection('workflow-debugger', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('debug');
  });

  it('injects coding specs for universal-executor', () => {
    const result = evaluateSpecInjection('universal-executor', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('coding');
  });

  it('injects coding + test specs for test-fix-agent', () => {
    const result = evaluateSpecInjection('test-fix-agent', testDir);
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('coding');
    expect(result.categories).toContain('test');
  });
});

// ---------------------------------------------------------------------------
// Unknown agent / missing specs
// ---------------------------------------------------------------------------

describe('evaluateSpecInjection — edge cases', () => {
  it('returns inject: false for unknown agent type', () => {
    const result = evaluateSpecInjection('random-agent-name', testDir);
    expect(result.inject).toBe(false);
  });

  it('returns inject: false when no specs directory exists', () => {
    // Use isolated temp dirs; pre-populate global with empty stubs so autoInitSeeds
    // doesn't write full seed content (which would trigger injection).
    const emptyGlobal = makeEmptyGlobalDir();
    const emptyProject = mkdtempSync(join(tmpdir(), 'maestro-empty-project-'));
    const result = evaluateSpecInjection('code-developer', emptyProject, undefined, {
      globalSpecsDir: emptyGlobal,
    });
    rmSync(emptyGlobal, { recursive: true, force: true });
    rmSync(emptyProject, { recursive: true, force: true });
    expect(result.inject).toBe(false);
  });

  it('does not include unrelated categories', () => {
    const result = evaluateSpecInjection('code-developer', testDir);
    // code-developer only gets 'coding', not 'arch', 'debug', etc.
    expect(result.content).not.toContain('No circular deps');
    expect(result.content).not.toContain('Check logs first');
    expect(result.content).not.toContain('PR Review Checklist');
  });
});

// ---------------------------------------------------------------------------
// Config override
// ---------------------------------------------------------------------------

describe('evaluateSpecInjection — config override', () => {
  it('respects custom mapping in config', () => {
    const result = evaluateSpecInjection('my-custom-agent', testDir, undefined, {
      mapping: { 'my-custom-agent': { categories: ['test', 'debug'] } },
    });
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('test');
    expect(result.categories).toContain('debug');
    expect(result.content).toContain('Use vitest');
    expect(result.content).toContain('Check logs first');
  });

  it('merges config mapping with defaults', () => {
    // Override code-developer to also get arch
    const result = evaluateSpecInjection('code-developer', testDir, undefined, {
      mapping: { 'code-developer': { categories: ['coding', 'arch'] } },
    });
    expect(result.inject).toBe(true);
    expect(result.categories).toContain('coding');
    expect(result.categories).toContain('arch');
  });
});

// ---------------------------------------------------------------------------
// Wiki role loading integration
// ---------------------------------------------------------------------------

describe('evaluateSpecInjection — wiki category loading', () => {
  it('includes wiki knowledge when wiki-index.json exists', () => {
    writeFileSync(join(testDir, '.workflow', 'wiki-index.json'), JSON.stringify({
      entries: [
        { type: 'knowhow', title: 'Auth API Pattern', summary: 'JWT refresh design', category: 'coding', updated: '2026-05-01' },
      ],
    }), 'utf-8');

    const result = evaluateSpecInjection('code-developer', testDir);
    expect(result.inject).toBe(true);
    expect(result.content).toContain('Auth API Pattern');
    expect(result.content).toContain('Wiki Knowledge');
  });

  it('works without wiki-index.json (spec-only injection)', () => {
    // No wiki-index.json file
    const result = evaluateSpecInjection('code-developer', testDir);
    expect(result.inject).toBe(true);
    expect(result.content).toContain('Use camelCase');
    expect(result.content).not.toContain('Wiki Knowledge');
  });

  it('maps code-developer to coding category for wiki', () => {
    writeFileSync(join(testDir, '.workflow', 'wiki-index.json'), JSON.stringify({
      entries: [
        { type: 'knowhow', title: 'Coding Pattern', summary: 'For coders', category: 'coding', updated: '2026-05-01' },
        { type: 'knowhow', title: 'Plan Pattern', summary: 'For planners', category: 'arch', updated: '2026-05-01' },
      ],
    }), 'utf-8');

    const result = evaluateSpecInjection('code-developer', testDir);
    expect(result.content).toContain('Coding Pattern');
    expect(result.content).not.toContain('Plan Pattern');
  });

  it('maps workflow-planner to arch category for wiki', () => {
    writeFileSync(join(testDir, '.workflow', 'wiki-index.json'), JSON.stringify({
      entries: [
        { type: 'knowhow', title: 'Arch Pattern', summary: 'For planners', category: 'arch', updated: '2026-05-01' },
        { type: 'knowhow', title: 'Coding Pattern', summary: 'For coders', category: 'coding', updated: '2026-05-01' },
      ],
    }), 'utf-8');

    const result = evaluateSpecInjection('workflow-planner', testDir);
    expect(result.content).toContain('Arch Pattern');
    expect(result.content).not.toContain('Coding Pattern');
  });

  it('maps debug-explore-agent to debug category for wiki', () => {
    writeFileSync(join(testDir, '.workflow', 'wiki-index.json'), JSON.stringify({
      entries: [
        { type: 'knowhow', title: 'Debug Insight', summary: 'Debug pattern', category: 'debug', updated: '2026-05-01' },
      ],
    }), 'utf-8');

    const result = evaluateSpecInjection('debug-explore-agent', testDir);
    expect(result.content).toContain('Debug Insight');
  });
});
