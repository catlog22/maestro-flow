import { describe, it, expect } from 'vitest';
import { evaluateKgSync } from '../kg-sync-hook.js';
import { evaluateKgContextInjection } from '../kg-context-injector.js';

// ---------------------------------------------------------------------------
// evaluateKgSync — graceful degradation
// ---------------------------------------------------------------------------

describe('evaluateKgSync', () => {
  it('returns codegraph status for non-existent project path', async () => {
    const result = await evaluateKgSync('/tmp/non-existent-project-xyz-98765', 'test-session');
    expect(result.synced).toBe(false);
    expect(result.reason).toMatch(/^(codegraph-unavailable|codegraph-not-initialized|maestrograph-unavailable|maestrograph-not-initialized|no-changes)$/);
  });

  it('result shape includes synced and reason fields', async () => {
    const result = await evaluateKgSync('/tmp/non-existent-project-xyz-98765', 'test-session');
    expect(result).toHaveProperty('synced');
    expect(result).toHaveProperty('reason');
    expect(typeof result.synced).toBe('boolean');
    expect(typeof result.reason).toBe('string');
  });

  it('never throws on missing project', async () => {
    await expect(
      evaluateKgSync('/tmp/does-not-exist-at-all', 'test-sess'),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// evaluateKgContextInjection — graceful degradation
// ---------------------------------------------------------------------------

describe('evaluateKgContextInjection', () => {
  it('returns codegraph-unavailable or not-initialized for non-existent project path', async () => {
    const result = await evaluateKgContextInjection(
      'code-developer',
      'Check the `DatabaseConnection` class in src/graph/db/connection.ts',
      '/tmp/non-existent-project-xyz-98765',
    );
    expect(result.inject).toBe(false);
    expect(result.reason).toMatch(/^(codegraph-unavailable|codegraph-not-initialized|maestrograph-unavailable|maestrograph-not-initialized|no-matches)$/);
  });

  it('never throws on missing project', async () => {
    await expect(
      evaluateKgContextInjection(
        'code-developer',
        'some prompt with `SomeClass`',
        '/tmp/does-not-exist-at-all',
      ),
    ).resolves.not.toThrow();
  });

  it('result shape always includes inject and optional reason', async () => {
    const result = await evaluateKgContextInjection(
      'general',
      'prompt text',
      '/tmp/non-existent-project-xyz-98765',
    );
    expect(result).toHaveProperty('inject');
    expect(typeof result.inject).toBe('boolean');
    if (!result.inject) {
      expect(typeof result.reason).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Regex extraction helpers (tested via module internals exposed in behavior)
// ---------------------------------------------------------------------------

describe('file path extraction regex', () => {
  // The FILE_RE pattern in kg-context-injector.ts matches paths like:
  // ([\w\/\\.-]+\.(ts|tsx|js|jsx|py|go|rs|java))
  const FILE_RE = /([\w\/\\.-]+\.(ts|tsx|js|jsx|py|go|rs|java))/g;

  it('extracts .ts file paths', () => {
    const text = 'Look at src/hooks/index.ts for the exports';
    const matches = [...text.matchAll(FILE_RE)].map(m => m[1]);
    expect(matches).toContain('src/hooks/index.ts');
  });

  it('extracts multiple file paths', () => {
    const text = 'Compare src/graph/db/connection.ts with src/hooks/spec-injector.ts';
    const matches = [...text.matchAll(FILE_RE)].map(m => m[1]);
    expect(matches).toContain('src/graph/db/connection.ts');
    expect(matches).toContain('src/hooks/spec-injector.ts');
  });

  it('extracts .py and .go paths', () => {
    const text = 'Check backend/app/models.py and cmd/server.go';
    const matches = [...text.matchAll(FILE_RE)].map(m => m[1]);
    expect(matches).toContain('backend/app/models.py');
    expect(matches).toContain('cmd/server.go');
  });

  it('handles paths with dots in directory names', () => {
    const text = 'Edit src/v2.0/module.ts please';
    const matches = [...text.matchAll(FILE_RE)].map(m => m[1]);
    expect(matches).toContain('src/v2.0/module.ts');
  });

  it('does not match paths without valid extensions', () => {
    const text = 'Read the config.yaml and data.csv files';
    const matches = [...text.matchAll(FILE_RE)].map(m => m[1]);
    expect(matches).toHaveLength(0);
  });
});

describe('symbol extraction regex', () => {
  // The SYMBOL_RE pattern in kg-context-injector.ts matches: `(\w+)`
  // Then filters: length >= 3, not a common noise word
  const SYMBOL_RE = /`(\w+)`/g;
  const NOISE = new Set(['the', 'and', 'for', 'not', 'but', 'has', 'get', 'set', 'new', 'var', 'let', 'use']);

  function extractSymbols(text: string): string[] {
    const seen = new Set<string>();
    for (const m of text.matchAll(SYMBOL_RE)) {
      const s = m[1];
      if (s.length >= 3 && !NOISE.has(s.toLowerCase())) {
        if (!seen.has(s)) seen.add(s);
      }
    }
    return [...seen];
  }

  it('extracts backtick-delimited symbols', () => {
    const text = 'Use the `DatabaseConnection` class to connect';
    const symbols = extractSymbols(text);
    expect(symbols).toContain('DatabaseConnection');
  });

  it('filters short symbols (length < 3)', () => {
    const text = 'Call `fn` and `db` methods';
    const symbols = extractSymbols(text);
    expect(symbols).toHaveLength(0);
  });

  it('filters noise words', () => {
    const text = 'Use `the` and `get` and `set` helpers';
    const symbols = extractSymbols(text);
    expect(symbols).toHaveLength(0);
  });

  it('deduplicates symbols', () => {
    const text = 'Call `QueryBuilder` then `QueryBuilder` again';
    const symbols = extractSymbols(text);
    expect(symbols).toEqual(['QueryBuilder']);
  });

  it('extracts multiple distinct symbols', () => {
    const text = 'Use `IncrementalSync` with `DatabaseConnection` and `GraphTraverser`';
    const symbols = extractSymbols(text);
    expect(symbols).toContain('IncrementalSync');
    expect(symbols).toContain('DatabaseConnection');
    expect(symbols).toContain('GraphTraverser');
    expect(symbols).toHaveLength(3);
  });
});
