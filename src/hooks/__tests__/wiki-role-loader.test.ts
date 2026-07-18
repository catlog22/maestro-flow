/**
 * Wiki Category Loader — comprehensive tests
 *
 * Covers: loadWikiByCategory (category-based wiki knowledge loading from persisted index)
 * Guide coverage: Category 分类化检索 + 三层加载设计 (wiki-index.json → category filter → inject)
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadWikiByCategory } from '../wiki-role-loader.js';

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-wiki-category-'));
  mkdirSync(join(testDir, '.workflow'), { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function writeWikiIndex(entries: Array<{
  type: string;
  title: string;
  summary: string;
  category?: string;
  specCategory?: string;
  updated: string;
  status?: string;
}>): void {
  writeFileSync(
    join(testDir, '.workflow', 'wiki-index.json'),
    JSON.stringify({ entries }),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Basic category loading
// ---------------------------------------------------------------------------

describe('loadWikiByCategory — basic', () => {
  it('returns entries matching the requested category', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Auth API Design', summary: 'JWT refresh patterns', category: 'coding', updated: '2026-05-01' },
      { type: 'knowhow', title: 'Cache Strategy', summary: 'Redis caching layer', category: 'coding', updated: '2026-04-30' },
      { type: 'spec', title: 'Architecture Rules', summary: 'Layered arch', category: 'arch', updated: '2026-04-29' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).not.toBeNull();
    expect(result!.entryCount).toBe(2);
    expect(result!.content).toContain('Auth API Design');
    expect(result!.content).toContain('Cache Strategy');
    expect(result!.content).not.toContain('Architecture Rules');
  });

  it('returns null when no entries match the category', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Auth Design', summary: 'Content', category: 'coding', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'debug');
    expect(result).toBeNull();
  });

  it('returns null when wiki-index.json does not exist', () => {
    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).toBeNull();
  });

  it('returns null when entries array is empty', () => {
    writeWikiIndex([]);
    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON in wiki-index.json', () => {
    writeFileSync(
      join(testDir, '.workflow', 'wiki-index.json'),
      'not valid json',
      'utf-8',
    );
    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Content formatting
// ---------------------------------------------------------------------------

describe('loadWikiByCategory — content formatting', () => {
  it('formats entries with type, title, and summary', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Auth Pattern', summary: 'Use JWT with rotation', category: 'coding', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result!.content).toContain('# Wiki Knowledge (category: coding)');
    expect(result!.content).toContain('### [knowhow] Auth Pattern');
    expect(result!.content).toContain('Use JWT with rotation');
  });

  it('includes separator between multiple entries', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Entry A', summary: 'Summary A', category: 'coding', updated: '2026-05-01' },
      { type: 'spec', title: 'Entry B', summary: 'Summary B', category: 'coding', updated: '2026-04-30' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result!.content).toContain('---');
    expect(result!.content).toContain('Entry A');
    expect(result!.content).toContain('Entry B');
  });
});

// ---------------------------------------------------------------------------
// Sorting and limiting
// ---------------------------------------------------------------------------

describe('loadWikiByCategory — sorting and limits', () => {
  it('sorts entries by updated date (newest first)', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Old Entry', summary: 'Old', category: 'coding', updated: '2026-01-01' },
      { type: 'knowhow', title: 'New Entry', summary: 'New', category: 'coding', updated: '2026-05-10' },
      { type: 'knowhow', title: 'Mid Entry', summary: 'Mid', category: 'coding', updated: '2026-03-15' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    const contentLines = result!.content;
    const newIdx = contentLines.indexOf('New Entry');
    const midIdx = contentLines.indexOf('Mid Entry');
    const oldIdx = contentLines.indexOf('Old Entry');
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  it('limits to 10 entries maximum', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      type: 'knowhow',
      title: `Entry ${i + 1}`,
      summary: `Summary ${i + 1}`,
      category: 'debug',
      updated: `2026-05-${String(i + 1).padStart(2, '0')}`,
    }));

    writeWikiIndex(entries);

    const result = loadWikiByCategory(testDir, 'debug');
    expect(result!.entryCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Category filtering edge cases
// ---------------------------------------------------------------------------

describe('loadWikiByCategory — edge cases', () => {
  it('excludes deprecated and superseded entries', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Active Entry', summary: 'Current', category: 'coding', status: 'active', updated: '2026-05-03' },
      { type: 'knowhow', title: 'Deprecated Entry', summary: 'Old', category: 'coding', status: 'deprecated', updated: '2026-05-02' },
      { type: 'knowhow', title: 'Superseded Entry', summary: 'Old decision', category: 'coding', status: 'superseded', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).not.toBeNull();
    expect(result!.entryCount).toBe(1);
    expect(result!.content).toContain('Active Entry');
    expect(result!.content).not.toContain('Deprecated Entry');
    expect(result!.content).not.toContain('Superseded Entry');
  });

  it('handles entries without category field', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'No Category', summary: 'Content', updated: '2026-05-01' },
      { type: 'knowhow', title: 'Has Category', summary: 'Content', category: 'coding', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result!.entryCount).toBe(1);
    expect(result!.content).toContain('Has Category');
    expect(result!.content).not.toContain('No Category');
  });

  it('matches exact category string (no partial matching)', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Coding Entry', summary: 'Content', category: 'coding', updated: '2026-05-01' },
    ]);

    // "cod" should NOT match "coding"
    const result = loadWikiByCategory(testDir, 'cod');
    expect(result).toBeNull();
  });

  it('supports all spec categories', () => {
    const categories = ['coding', 'arch', 'debug', 'test', 'review', 'learning'];
    const entries = categories.map((cat, i) => ({
      type: 'knowhow',
      title: `Entry for ${cat}`,
      summary: `Content for ${cat}`,
      category: cat,
      updated: `2026-05-${String(i + 1).padStart(2, '0')}`,
    }));

    writeWikiIndex(entries);

    for (const cat of categories) {
      const result = loadWikiByCategory(testDir, cat);
      expect(result).not.toBeNull();
      expect(result!.entryCount).toBe(1);
      expect(result!.content).toContain(`Entry for ${cat}`);
    }
  });
});

// ---------------------------------------------------------------------------
// specCategory cross-system alignment
// ---------------------------------------------------------------------------

describe('loadWikiByCategory — specCategory', () => {
  it('matches entries by specCategory when category is a knowhow type', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Recipe with spec alignment', summary: 'Step-by-step auth guide', category: 'recipe', specCategory: 'coding', updated: '2026-05-01' },
      { type: 'knowhow', title: 'Tip without alignment', summary: 'Quick reminder', category: 'tip', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).not.toBeNull();
    expect(result!.entryCount).toBe(1);
    expect(result!.content).toContain('Recipe with spec alignment');
    expect(result!.content).not.toContain('Tip without alignment');
  });

  it('matches entries by either category or specCategory', () => {
    writeWikiIndex([
      { type: 'spec', title: 'Coding Spec', summary: 'Spec content', category: 'coding', updated: '2026-05-02' },
      { type: 'knowhow', title: 'Coding Recipe', summary: 'Recipe content', category: 'recipe', specCategory: 'coding', updated: '2026-05-01' },
      { type: 'knowhow', title: 'Unrelated Tip', summary: 'Tip content', category: 'tip', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).not.toBeNull();
    expect(result!.entryCount).toBe(2);
    expect(result!.content).toContain('Coding Spec');
    expect(result!.content).toContain('Coding Recipe');
    expect(result!.content).not.toContain('Unrelated Tip');
  });

  it('does not double-count entries where category and specCategory both match', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Double Match', summary: 'Both fields match', category: 'coding', specCategory: 'coding', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).not.toBeNull();
    expect(result!.entryCount).toBe(1);
  });

  it('returns null when no entries match by category or specCategory', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Recipe', summary: 'Content', category: 'recipe', specCategory: 'coding', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'debug');
    expect(result).toBeNull();
  });

  it('handles entries without specCategory field gracefully', () => {
    writeWikiIndex([
      { type: 'knowhow', title: 'Old Entry', summary: 'No specCategory', category: 'coding', updated: '2026-05-01' },
    ]);

    const result = loadWikiByCategory(testDir, 'coding');
    expect(result).not.toBeNull();
    expect(result!.entryCount).toBe(1);
  });
});
